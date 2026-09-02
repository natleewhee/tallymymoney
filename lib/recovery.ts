// Recovery paths for the two ways an email can end up stranded:
//
//   1. The transaction was saved but its Telegram alert never sent (the
//      bot was misconfigured, Telegram was down, the chat id was wrong).
//      Those rows have telegram_message_id IS NULL and are invisible
//      until re-sent — the ingest route can't retry them itself, since
//      the Message-ID unique constraint makes every redelivery a no-op.
//
//   2. The email didn't parse and was filed in unclassified_emails. Once
//      a parser is fixed, nothing re-reads those rows, so a fix only
//      helps future emails and the backlog stays stuck.
//
// Both are recoverable because raw_email is retained (ARCHITECTURE.md §4).

import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "./db";
import { transactions, unclassifiedEmails } from "./schema";
import { dispatch, type InboundEmail } from "./parsers";
import { resolveSgdAmount } from "./fx";
import { normaliseMerchant } from "./merchant";
import { notifyNewTransaction, notifyNotice } from "./telegram/notify";
import { queueLabelRemoval } from "./gmail-labels";
import { isUniqueViolation } from "./db-utils";

/** Re-sends alerts for transactions that were stored but never announced. */
export async function resendUnnotified(): Promise<{ sent: number; failed: number }> {
  const stranded = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(isNull(transactions.telegramMessageId), eq(transactions.status, "pending")));

  let sent = 0;
  let failed = 0;
  for (const row of stranded) {
    try {
      await notifyNewTransaction(row.id);
      sent += 1;
    } catch (err) {
      console.error(`resend failed for transaction ${row.id}`, err);
      failed += 1;
    }
  }
  return { sent, failed };
}

/** Rebuilds the parser input from a stored raw_email. Ingest keeps
 * `htmlBody || textBody`, so which field it came from isn't recoverable
 * from the content alone — item 18: newer rows record it directly in
 * body_format at ingest time, so this only has to guess (and can misfire
 * on plain text containing something like <jane@example.com>) for rows
 * written before that column existed. */
function toInboundEmail(row: {
  sender: string;
  subject: string | null;
  rawEmail: string;
  receivedAt: Date;
  bodyFormat: string | null;
}): InboundEmail {
  const isHtml = row.bodyFormat ? row.bodyFormat === "html" : /<[a-z][\s\S]*>/i.test(row.rawEmail);
  return {
    from: row.sender,
    subject: row.subject ?? "",
    textBody: isHtml ? "" : row.rawEmail,
    htmlBody: isHtml ? row.rawEmail : "",
    receivedAt: row.receivedAt,
  };
}

/** Re-runs the current parsers over every email still sitting in
 * unclassified_emails. Anything that now parses becomes a real
 * transaction and its unclassified row is cleared; anything that still
 * doesn't is left exactly as it was. */
export async function retryUnparsed(): Promise<{ recovered: number; stillFailing: number }> {
  const stuck = await db
    .select()
    .from(unclassifiedEmails)
    .where(ne(unclassifiedEmails.status, "ignored"));

  let recovered = 0;
  let stillFailing = 0;

  for (const row of stuck) {
    const email = toInboundEmail(row);
    const { transaction, notice } = dispatch(email);
    if (!transaction) {
      // A row filed before a parser recognised this as a no-transaction
      // notice (a decline, a card-verification failure) — same cleanup
      // as a normal recovery, minus the insert: send the notice now,
      // then clear the row so it stops being counted as stuck.
      if (notice) {
        try {
          await notifyNotice(notice);
        } catch (err) {
          console.error(`notice for unclassified email ${row.id} not sent`, err);
        }
        if (row.labeledInGmail) {
          await queueLabelRemoval(row.emailMessageId);
        }
        await db.delete(unclassifiedEmails).where(eq(unclassifiedEmails.id, row.id));
        recovered += 1;
        continue;
      }
      stillFailing += 1;
      continue;
    }

    const { sgdAmountCents, fxSource, fxRate } = await resolveSgdAmount(transaction.currency, transaction.amountCents);

    try {
      const [inserted] = await db
        .insert(transactions)
        .values({
          emailMessageId: row.emailMessageId,
          amountCents: transaction.amountCents,
          currency: transaction.currency,
          sgdAmountCents,
          fxSource,
          fxRate,
          direction: transaction.direction,
          merchantRaw: transaction.merchantRaw,
          merchantNormalised: transaction.merchantRaw ? normaliseMerchant(transaction.merchantRaw) : null,
          bank: transaction.bank,
          accountIdentifier: transaction.accountIdentifier,
          occurredAt: transaction.occurredAt,
          rawEmail: row.rawEmail,
        })
        .returning({ id: transactions.id });

      // Queue the Gmail label removal BEFORE deleting the row — the
      // delete takes emailMessageId with it, and that id is the only way
      // Apps Script can find the thread. Only when the label was
      // actually applied; otherwise there's nothing to take off.
      if (row.labeledInGmail) {
        await queueLabelRemoval(row.emailMessageId);
      }

      await db.delete(unclassifiedEmails).where(eq(unclassifiedEmails.id, row.id));
      recovered += 1;

      // Notified last and separately: a send failure must not undo the
      // recovery, and resendUnnotified() will pick the row up after.
      try {
        await notifyNewTransaction(inserted.id);
      } catch (err) {
        console.error(`recovered transaction ${inserted.id} not notified`, err);
      }
    } catch (err) {
      // Item 19: the insert above and the delete that follows it aren't
      // transactional (no Neon HTTP-driver wrapper anywhere in this
      // codebase). If a *previous* run's delete failed after its insert
      // succeeded, this row is stale — the transaction already exists —
      // and this insert hits email_message_id's unique constraint. Left
      // uncaught, that row would be recounted as "stillFailing" on every
      // future run forever, and the message ("can't be read — forward it
      // on") would be false: the parser worked fine, only the cleanup
      // didn't finish.
      if (isUniqueViolation(err)) {
        const [existing] = await db
          .select({ id: transactions.id, telegramMessageId: transactions.telegramMessageId })
          .from(transactions)
          .where(eq(transactions.emailMessageId, row.emailMessageId));

        if (row.labeledInGmail) {
          await queueLabelRemoval(row.emailMessageId);
        }
        await db.delete(unclassifiedEmails).where(eq(unclassifiedEmails.id, row.id));
        recovered += 1;

        // The interrupted run may never have reached its own notify
        // step either — finish that too rather than leaving the
        // recovered transaction silently unannounced.
        if (existing && existing.telegramMessageId === null) {
          try {
            await notifyNewTransaction(existing.id);
          } catch (notifyErr) {
            console.error(`recovered transaction ${existing.id} not notified`, notifyErr);
          }
        }
        continue;
      }

      console.error(`retry failed for unclassified email ${row.id}`, err);
      stillFailing += 1;
    }
  }

  return { recovered, stillFailing };
}
