// FR-1 through FR-4/FR-20: the whole capture pipeline in one route.
// Apps Script (apps-script/forward-to-ingest.gs) POSTs here every 5
// minutes for each unprocessed thread in the dedicated inbox.

import { db } from "@/lib/db";
import { transactions, unclassifiedEmails, senderRules } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { dispatch, type InboundEmail } from "@/lib/parsers";
import { convertToSgd } from "@/lib/fx";
import { notifyNewTransaction, notifyParseFailure, notifyUnclassified } from "@/lib/telegram/notify";

export const runtime = "nodejs";

interface IngestBody {
  messageId: string;
  from: string;
  subject: string;
  textBody?: string;
  htmlBody?: string;
  receivedAt: string; // ISO 8601, from the email's Date header
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  return code === "23505";
}

export async function POST(req: Request): Promise<Response> {
  const secret = req.headers.get("x-ingest-secret");
  if (!secret || secret !== process.env.INGEST_SECRET) {
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

  if (rule?.action === "needs_parser") {
    try {
      await db.insert(unclassifiedEmails).values({
        emailMessageId: body.messageId,
        sender: email.from,
        subject: email.subject,
        rawEmail: email.htmlBody || email.textBody,
        status: "needs_parser",
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
    return Response.json({ status: "queued-needs-parser" });
  }

  const { bank, transaction } = dispatch(email);

  if (!transaction) {
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
          status: "pending_review",
        })
        .returning({ id: unclassifiedEmails.id });
      inserted = row;
    } catch (err) {
      if (isUniqueViolation(err)) return Response.json({ status: "duplicate" });
      throw err;
    }

    if (bank) {
      await notifyParseFailure(inserted!.id, bank, email.subject, email.receivedAt);
    } else {
      await notifyUnclassified(inserted!.id, email.from, email.subject, email.receivedAt);
    }
    return Response.json({ status: "triaged", unclassifiedId: inserted!.id });
  }

  // FR-2/FR-22: spot-convert anything not already in SGD.
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
      // No live rate and no prior transaction in this currency to borrow
      // from — genuinely rare. 1:1 is a placeholder, not a real
      // conversion; still flagged as an estimate so FR-15/FR-22 catch it.
      sgdAmountCents = transaction.amountCents;
      fxSource = "spot_estimate";
      fxRate = "1";
    }
  }

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

  await notifyNewTransaction(newTxId);
  return Response.json({ status: "created", transactionId: newTxId });
}
