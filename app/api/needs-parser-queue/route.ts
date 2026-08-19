// Confirmed 2026-08-19: when Nat taps Needs Parser in Telegram (FR-20b),
// the source email should get a visible Gmail label so he knows which
// one to forward for a real parser to get built. The bot (Vercel) has no
// Gmail access — only Apps Script, running inside the dedicated inbox,
// does. So this is a small polling queue: Apps Script's pollInbox calls
// GET here for unlabelled needs_parser rows, labels the corresponding
// Gmail thread, then POSTs the ids back here to mark them done.

import { db } from "@/lib/db";
import { unclassifiedEmails } from "@/lib/schema";
import { and, eq, inArray } from "drizzle-orm";

export const runtime = "nodejs";

function checkSecret(req: Request): boolean {
  const secret = req.headers.get("x-ingest-secret");
  return !!secret && secret === process.env.INGEST_SECRET;
}

export async function GET(req: Request): Promise<Response> {
  if (!checkSecret(req)) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }

  const rows = await db
    .select({ id: unclassifiedEmails.id, emailMessageId: unclassifiedEmails.emailMessageId })
    .from(unclassifiedEmails)
    .where(
      and(eq(unclassifiedEmails.status, "needs_parser"), eq(unclassifiedEmails.labeledInGmail, false)),
    );

  return Response.json({ items: rows });
}

interface AckBody {
  ids: number[];
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
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return Response.json({ error: "ids must be a non-empty array" }, { status: 400 });
  }

  await db
    .update(unclassifiedEmails)
    .set({ labeledInGmail: true })
    .where(inArray(unclassifiedEmails.id, body.ids));

  return Response.json({ status: "ok", acked: body.ids.length });
}
