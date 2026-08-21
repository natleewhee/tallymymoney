// Confirmed 2026-08-19: when Nat taps Needs Parser in Telegram (FR-20b),
// the source email should get a visible Gmail label so he knows which
// one to forward for a real parser to get built. The bot (Vercel) has no
// Gmail access — only Apps Script, running inside the dedicated inbox,
// does. So this is a small polling queue: Apps Script's pollInbox calls
// GET here, acts on Gmail, then POSTs back what it did.
//
// Extended 2026-08-21 to carry the reverse instruction too. A label that
// only ever goes on is worse than no label — once the parser is built
// and the email reparsed, the red flag stays on a thread that is no
// longer stuck, and the inbox slowly fills with false alarms. Both
// directions ride the same 5-minute poll rather than adding a second
// endpoint and a second round trip.

import { db } from "@/lib/db";
import { gmailLabelRemovals, unclassifiedEmails } from "@/lib/schema";
import { and, eq, inArray } from "drizzle-orm";
import { pendingLabelRemovals } from "@/lib/gmail-labels";

export const runtime = "nodejs";

function checkSecret(req: Request): boolean {
  const secret = req.headers.get("x-ingest-secret");
  return !!secret && secret === process.env.INGEST_SECRET;
}

export async function GET(req: Request): Promise<Response> {
  if (!checkSecret(req)) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }

  const items = await db
    .select({ id: unclassifiedEmails.id, emailMessageId: unclassifiedEmails.emailMessageId })
    .from(unclassifiedEmails)
    .where(
      and(eq(unclassifiedEmails.status, "needs_parser"), eq(unclassifiedEmails.labeledInGmail, false)),
    );

  const removals = await pendingLabelRemovals();

  return Response.json({ items, removals });
}

interface AckBody {
  /** unclassified_emails ids the label was just applied to. */
  ids?: number[];
  /** gmail_label_removals ids the label was just taken off. */
  removalIds?: number[];
}

export async function POST(req: Request): Promise<Response> {
  if (!checkSecret(req)) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }

  let body: AckBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids : [];
  const removalIds = Array.isArray(body.removalIds) ? body.removalIds : [];
  if (ids.length === 0 && removalIds.length === 0) {
    return Response.json({ error: "nothing to acknowledge" }, { status: 400 });
  }

  if (ids.length > 0) {
    await db
      .update(unclassifiedEmails)
      .set({ labeledInGmail: true })
      .where(inArray(unclassifiedEmails.id, ids));
  }

  if (removalIds.length > 0) {
    // Kept as rows with removed_at set rather than deleted, so a thread
    // is never re-queued for removal by a later run.
    await db
      .update(gmailLabelRemovals)
      .set({ removedAt: new Date() })
      .where(inArray(gmailLabelRemovals.id, removalIds));
  }

  return Response.json({ status: "ok", labelled: ids.length, unlabelled: removalIds.length });
}
