// ARCHITECTURE.md §5: Vercel Hobby allows one daily cron, not the 5-minute
// interval the ideation dump assumed. This invocation runs the pipeline
// heartbeat. (The weekly month-to-date nudge and the 1st-of-month spend
// report were removed in the Amex-only pivot — the bot no longer does
// spend summaries.)
//
// The heartbeat exists because every failure path in this system ends in
// a console.error and a Vercel log nobody reads — and the component most
// likely to break, the Gmail-side Apps Script, has no channel to Telegram
// at all. If it stops forwarding, or /api/ingest starts rejecting, or the
// database becomes unreachable, nothing currently says so; the bot simply
// goes quiet, which is indistinguishable from a quiet spending week.
// See docs/LESSONS.md — this is the structural answer to that bug class,
// rather than hunting silent failures one at a time.

import { desc } from "drizzle-orm";
import { bot } from "@/lib/telegram/bot";
import { db } from "@/lib/db";
import { transactions, unclassifiedEmails } from "@/lib/schema";
import { formatSgtDateTime } from "@/lib/sgt";

export const runtime = "nodejs";

/** How long the pipeline may be silent before that itself is the news.
 * Was 36h when every bank's alerts flowed through; now only one Amex
 * card is forwarded, and a few days without using it is normal, so 36h
 * would cry wolf constantly. A week of silence is still worth a look. */
const QUIET_HOURS_BEFORE_ALERT = 7 * 24;

/** Last time anything at all arrived through the pipe. Counts unparsed
 * emails too — an email that arrived and failed to parse still proves
 * Gmail, Apps Script, the ingest route and the database are all alive,
 * which is exactly what this check is asking about. */
async function lastPipelineActivity(): Promise<Date | null> {
  const [tx] = await db
    .select({ at: transactions.createdAt })
    .from(transactions)
    .orderBy(desc(transactions.createdAt))
    .limit(1);

  const [email] = await db
    .select({ at: unclassifiedEmails.receivedAt })
    .from(unclassifiedEmails)
    .orderBy(desc(unclassifiedEmails.receivedAt))
    .limit(1);

  const candidates = [tx?.at, email?.at].filter((d): d is Date => !!d);
  if (candidates.length === 0) return null;
  return new Date(Math.max(...candidates.map((d) => d.getTime())));
}

export async function GET(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }

  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    return Response.json({ status: "error", reason: "TELEGRAM_CHAT_ID not set" }, { status: 500 });
  }

  // --- Heartbeat: runs every day, before anything that might throw ---
  let heartbeat: string;
  try {
    const lastSeen = await lastPipelineActivity();
    if (lastSeen === null) {
      // Nothing has ever arrived. Not necessarily broken — could be a
      // fresh database — so say what's true rather than raising an alarm.
      heartbeat = "empty";
    } else {
      const quietHours = (Date.now() - lastSeen.getTime()) / 3_600_000;
      if (quietHours >= QUIET_HOURS_BEFORE_ALERT) {
        await bot.api.sendMessage(
          chatId,
          [
            "🔌 Nothing has come through in a while",
            "",
            `Last email seen: ${formatSgtDateTime(lastSeen)}`,
            `That's about ${Math.floor(quietHours)} hours ago.`,
            "",
            "If you've spent anything since then, the pipeline is stuck. Worth checking, in order:",
            "1. Apps Script → Executions (script.google.com, in the tallymymoney inbox)",
            "2. The Gmail filter is still forwarding",
            "3. Vercel → Logs for /api/ingest",
          ].join("\n"),
        );
        heartbeat = "alerted";
      } else {
        heartbeat = "ok";
      }
    }
  } catch (err) {
    // A heartbeat that fails silently is worse than none — it would be
    // the exact failure mode it exists to catch.
    console.error("heartbeat check failed", err);
    heartbeat = "check-failed";
  }

  return Response.json({ status: "ok", heartbeat });
}
