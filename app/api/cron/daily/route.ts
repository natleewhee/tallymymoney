// ARCHITECTURE.md §5: Vercel Hobby allows one daily cron, not the 5-minute
// interval the ideation dump assumed. This route exits immediately unless
// it's the 1st of the month (SGT), when it sends the previous month's
// report per FR-14. Cheaper than fighting the free-tier scheduler.

import { bot } from "@/lib/telegram/bot";
import { formatRangeReport } from "@/lib/telegram/reports";
import { previousMonthRange } from "@/lib/sgt";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }

  const nowSgt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  if (nowSgt.getUTCDate() !== 1) {
    return Response.json({ status: "no-op", reason: "not the 1st" });
  }

  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    return Response.json({ status: "error", reason: "TELEGRAM_CHAT_ID not set" }, { status: 500 });
  }

  const { start, end, label } = previousMonthRange();
  const report = await formatRangeReport(`Monthly Report — ${label}`, start, end);
  await bot.api.sendMessage(chatId, report, { parse_mode: "Markdown" });

  return Response.json({ status: "sent", period: label });
}
