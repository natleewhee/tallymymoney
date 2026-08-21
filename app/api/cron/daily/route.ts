// ARCHITECTURE.md §5: Vercel Hobby allows one daily cron, not the 5-minute
// interval the ideation dump assumed. So this one invocation does two
// jobs: a pipeline heartbeat every day, and the previous month's report
// on the 1st (SGT) per FR-14.
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
import { formatRangeReport } from "@/lib/telegram/reports";
import { formatSgtDateTime, previousMonthRange } from "@/lib/sgt";

export const runtime = "nodejs";

/** How long the pipeline may be silent before that itself is the news.
 * Deliberately not tight: a genuinely quiet day shouldn't cry wolf, but
 * a two-day gap on an account that normally sees several transactions a
 * day is worth surfacing. */
const QUIET_HOURS_BEFORE_ALERT = 36;

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

  // --- Monthly report: 1st of the month, SGT ---
  const nowSgt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  if (nowSgt.getUTCDate() !== 1) {
    return Response.json({ status: "no-op", reason: "not the 1st", heartbeat });
  }

  const { start, end, label } = previousMonthRange();
  try {
    const report = await formatRangeReport(`Monthly Report — ${label}`, start, end);
    await bot.api.sendMessage(chatId, report);
  } catch (err) {
    // Unguarded, a Neon cold-start timeout or a Telegram blip here would
    // throw, return 500, and there is no retry — the month's report would
    // simply never arrive and nothing would say so.
    console.error(`monthly report for ${label} failed to send`, err);
    return Response.json({ status: "report-failed", period: label, heartbeat }, { status: 500 });
  }

  return Response.json({ status: "sent", period: label, heartbeat });
}
