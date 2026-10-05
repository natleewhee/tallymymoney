// FR-1 through FR-4/FR-20: the whole capture pipeline in one route.
// Apps Script (apps-script/forward-to-ingest.gs) POSTs here every 5
// minutes for each unprocessed thread in the dedicated inbox.

import { db } from "@/lib/db";
import { transactions, unclassifiedEmails, senderRules } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { dispatch, type InboundEmail } from "@/lib/parsers";
import { resolveSgdAmount } from "@/lib/fx";
import { normaliseMerchant } from "@/lib/merchant";
import { notifyNewTransaction, notifyNotice, notifyParseFailure, notifyUnclassified } from "@/lib/telegram/notify";
import { isUniqueViolation, secretsMatch } from "@/lib/db-utils";

export const runtime = "nodejs";

interface IngestBody {
  messageId: string;
  from: string;
  subject: string;
  textBody?: string;
  htmlBody?: string;
  receivedAt: string; // ISO 8601, from the email's Date header
}

export async function POST(req: Request): Promise<Response> {
  const secret = req.headers.get("x-ingest-secret");
  if (!secretsMatch(secret, process.env.INGEST_SECRET)) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }

  let body: IngestBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.messageId || !body.from || !body.receivedAt) {
    return Response.json({ error: "missing required fields" }, { status: 400 });
  }

  const email: InboundEmail = {
    from: body.from,
    subject: body.subject ?? "",
    textBody: body.textBody ?? "",
    htmlBody: body.htmlBody ?? "",
    receivedAt: new Date(body.receivedAt),
  };

  // FR-4/FR-20: has Nat already classified this (sender, subject) pattern?
  const [rule] = await db
    .select()
    .from(senderRules)
    .where(and(eq(senderRules.sender, email.from), eq(senderRules.subject, email.subject)));

  if (rule?.action === "ignore") {
    return Response.json({ status: "ignored-by-rule" });
  }

  // Always try to parse first, even under a "needs_parser" rule. That
  // rule fingerprints on (sender, subject), but UOB (and potentially
  // other banks) reuse one generic subject for every transaction type —
  // "UOB - Transaction Alert" regardless of merchant. A rule created
  // from one genuinely-broken sample (e.g. a merchant name the old regex
  // choked on) would otherwise silently swallow every future email that
  // matches the same (sender, subject), including ones the parser
  // handles fine. Confirmed 2026-08-19 as the cause of a missed UOB
  // transaction. Parsing first means a parser fix immediately un-blocks
  // future good emails without Nat having to clear the rule by hand.
  const { bank, transaction, notice } = dispatch(email);

  if (!transaction) {
    // Recognised as a real event that will never become a transaction —
    // a declined attempt, a card-verification failure — so it never
    // touches unclassified_emails or FR-4/R3 triage at all. Nat just
    // needs to know now.
    if (notice) {
      try {
        await notifyNotice(notice);
      } catch (err) {
        console.error("notice email received but Telegram send failed", err);
      }
      return Response.json({ status: "notice-sent" });
    }

    if (rule?.action === "needs_parser") {
      try {
        await db.insert(unclassifiedEmails).values({
          emailMessageId: body.messageId,
          sender: email.from,
          subject: email.subject,
          rawEmail: email.htmlBody || email.textBody,
          bodyFormat: email.htmlBody ? "html" : "text",
          status: "needs_parser",
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
      return Response.json({ status: "queued-needs-parser" });
    }

    // FR-4: first sighting of an unrecognised pattern, or a known sender
    // whose shape our parser doesn't recognise (R3 — parser drift).
    let inserted: { id: number } | undefined;
    try {
      const [row] = await db
        .insert(unclassifiedEmails)
        .values({
          emailMessageId: body.messageId,
          sender: email.from,
          subject: email.subject,
          rawEmail: email.htmlBody || email.textBody,
          bodyFormat: email.htmlBody ? "html" : "text",
          status: "pending_review",
        })
        .returning({ id: unclassifiedEmails.id });
      inserted = row;
    } catch (err) {
      if (isUniqueViolation(err)) return Response.json({ status: "duplicate" });
      throw err;
    }

    // A failed notification must not fail the request. The row is already
    // stored, so a 500 here would make Apps Script retry the email
    // forever while the unique constraint rejects every retry — the
    // alert would be lost permanently. Surfacing it through /pending is
    // recoverable; an infinite retry loop is not.
    try {
      if (bank) {
        await notifyParseFailure(inserted!.id, bank, email.subject, email.receivedAt);
      } else {
        await notifyUnclassified(inserted!.id, email.from, email.subject, email.receivedAt);
      }
    } catch (err) {
      console.error("triage notification failed; recoverable via /pending", err);
    }
    return Response.json({ status: "triaged", unclassifiedId: inserted!.id });
  }

  // FR-2/FR-22: spot-convert anything not already in SGD.
  const { sgdAmountCents, fxSource, fxRate } = await resolveSgdAmount(transaction.currency, transaction.amountCents);

  let newTxId: number;
  try {
    const [row] = await db
      .insert(transactions)
      .values({
        emailMessageId: body.messageId,
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
        rawEmail: email.htmlBody || email.textBody,
      })
      .returning({ id: transactions.id });
    newTxId = row.id;
  } catch (err) {
    if (isUniqueViolation(err)) return Response.json({ status: "duplicate" });
    throw err;
  }

  // Same reasoning as the triage notification above: the transaction row
  // exists now, so throwing here would strand it — Apps Script retries,
  // the Message-ID unique constraint returns "duplicate", and the alert
  // is never sent again. notifyNewTransaction only stamps
  // telegram_message_id after a successful send, so a null there marks
  // exactly the rows that still need re-sending (see /pending).
  try {
    await notifyNewTransaction(newTxId);
  } catch (err) {
    console.error(`transaction ${newTxId} saved but not notified; recoverable via /pending`, err);
    return Response.json({ status: "created-not-notified", transactionId: newTxId });
  }
  return Response.json({ status: "created", transactionId: newTxId });
}
