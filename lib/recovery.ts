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
import { convertToSgd } from "./fx";
import { notifyNewTransaction } from "./telegram/notify";

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
 * `htmlBody || textBody`, so which field it came from is no longer
 * recorded — infer it, since bestText() prefers plain text and running
 * an HTML strip over plain text would mangle it. */
function toInboundEmail(row: {
  sender: string;
  subject: string | null;
  rawEmail: string;
  receivedAt: Date;
}): InboundEmail {
  const looksLikeHtml = /<[a-z][\s\S]*>/i.test(row.rawEmail);
  return {
    from: row.sender,
    subject: row.subject ?? "",
    textBody: looksLikeHtml ? "" : row.rawEmail,
    htmlBody: looksLikeHtml ? row.rawEmail : "",
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
    const { transaction } = dispatch(email);
    if (!transaction) {
      stillFailing += 1;
      continue;
    }

    let sgdAmountCents = transaction.amountCents;
    let fxSource = "na";
    let fxRate: string | null = null;
    if (transaction.currency !== "SGD") {
      const fx = await convertToSgd(transaction.currency, transaction.amountCents);
      if (fx) {
        sgdAmountCents = fx.sgdAmountCents;
        fxSource = fx.fxSource;
        fxRate = String(fx.fxRate);
      } else {
        fxSource = "spot_estimate";
        fxRate = "1";
      }
    }

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
          bank: transaction.bank,
          accountIdentifier: transaction.accountIdentifier,
          occurredAt: transaction.occurredAt,
          rawEmail: row.rawEmail,
        })
        .returning({ id: transactions.id });

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
      console.error(`retry failed for unclassified email ${row.id}`, err);
      stillFailing += 1;
    }
  }

  return { recovered, stillFailing };
}
