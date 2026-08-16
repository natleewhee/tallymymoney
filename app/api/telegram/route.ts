import { webhookCallback } from "grammy";
import { bot } from "@/lib/telegram/bot";

// ARCHITECTURE.md §6: verify Telegram's secret token header. The
// TELEGRAM_WEBHOOK_SECRET value here must match what's passed to
// setWebhook's secret_token when the webhook is registered — see
// README's deployment section.
export const runtime = "nodejs";

const handleUpdate = webhookCallback(bot, "std/http", {
  secretToken: process.env.TELEGRAM_WEBHOOK_SECRET,
});

export async function POST(req: Request): Promise<Response> {
  return handleUpdate(req);
}
