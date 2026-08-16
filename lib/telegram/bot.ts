import { Bot, InputFile } from "grammy";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { merchantRules, senderRules, transactions, unclassifiedEmails } from "../schema";
import { CATEGORIES } from "../categories";
import { normaliseMerchant } from "../merchant";
import {
  categoryKeyboard,
  reduceCandidatesKeyboard,
  splitKeyboard,
} from "./keyboards";
import { formatPendingReport, formatRangeReport } from "./reports";
import { currentMonthRange, last7DaysRange, todayRange } from "../sgt";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");

export const bot = new Bot(token);

const OWNER_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/** ARCHITECTURE.md §6: ignore any chat_id that isn't Nat's — single-user
 * product, no reason to process anyone else's messages or callbacks. */
bot.use(async (ctx, next) => {
  const chatId = ctx.chat?.id?.toString();
  if (!OWNER_CHAT_ID || chatId !== OWNER_CHAT_ID) return;
  await next();
});

async function markTagged(txId: number, category: string, split: "solo" | "joint") {
  const [tx] = await db.select().from(transactions).where(eq(transactions.id, txId));
  if (!tx) return;

  await db
    .update(transactions)
    .set({ category, split, status: "tagged", taggedAt: new Date() })
    .where(eq(transactions.id, txId));

  if (tx.merchantRaw) {
    const key = normaliseMerchant(tx.merchantRaw);
    const [existing] = await db.select().from(merchantRules).where(eq(merchantRules.merchantNormalised, key));
    if (existing) {
      await db
        .update(merchantRules)
        .set({ category, defaultSplit: split, hitCount: existing.hitCount + 1, updatedAt: new Date() })
        .where(eq(merchantRules.merchantNormalised, key));
    } else {
      await db.insert(merchantRules).values({ merchantNormalised: key, category, defaultSplit: split });
    }
  }
}

bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  const [action, ...rest] = data.split(":");

  try {
    switch (action) {
      case "c": {
        // FR-8 step 1: category chosen, now ask split.
        const [txId, catIdxStr] = rest;
        const category = CATEGORIES[Number(catIdxStr)];
        await db.update(transactions).set({ category }).where(eq(transactions.id, Number(txId)));
        await ctx.editMessageReplyMarkup({ reply_markup: splitKeyboard(Number(txId)) });
        await ctx.answerCallbackQuery(`Category: ${category}`);
        return;
      }
      case "s": {
        // FR-8 step 2 / continuation of "ov": split chosen, done.
        const [txId, split] = rest;
        const [tx] = await db.select().from(transactions).where(eq(transactions.id, Number(txId)));
        if (!tx?.category) {
          await ctx.answerCallbackQuery("Pick a category first");
          return;
        }
        await markTagged(Number(txId), tx.category, split as "solo" | "joint");
        await ctx.editMessageText(`✅ Tagged: ${tx.category} · ${split === "solo" ? "Solo" : "Joint"}`);
        await ctx.answerCallbackQuery("Tagged");
        return;
      }
      case "cf": {
        // FR-7: confirm the pre-filled category/split in one tap.
        const [txId] = rest;
        const [tx] = await db.select().from(transactions).where(eq(transactions.id, Number(txId)));
        if (!tx?.merchantRaw) return;
        const key = normaliseMerchant(tx.merchantRaw);
        const [rule] = await db.select().from(merchantRules).where(eq(merchantRules.merchantNormalised, key));
        if (!rule) {
          await ctx.answerCallbackQuery("No rule found — pick a category");
          await ctx.editMessageReplyMarkup({ reply_markup: categoryKeyboard(Number(txId)) });
          return;
        }
        if (rule.defaultSplit) {
          await markTagged(Number(txId), rule.category, rule.defaultSplit as "solo" | "joint");
          await ctx.editMessageText(`✅ Tagged: ${rule.category} · ${rule.defaultSplit === "solo" ? "Solo" : "Joint"}`);
        } else {
          await db.update(transactions).set({ category: rule.category }).where(eq(transactions.id, Number(txId)));
          await ctx.editMessageReplyMarkup({ reply_markup: splitKeyboard(Number(txId)) });
        }
        await ctx.answerCallbackQuery("Confirmed");
        return;
      }
      case "ov": {
        // FR-8: override the pre-fill, show the full category picker.
        const [txId] = rest;
        await ctx.editMessageReplyMarkup({ reply_markup: categoryKeyboard(Number(txId)) });
        await ctx.answerCallbackQuery();
        return;
      }
      case "i": {
        // FR-10: ignore.
        const [txId] = rest;
        await db.update(transactions).set({ status: "ignored", taggedAt: new Date() }).where(eq(transactions.id, Number(txId)));
        await ctx.editMessageText("🚫 Ignored");
        await ctx.answerCallbackQuery("Ignored");
        return;
      }
      case "r": {
        // FR-21: reduce — show a short list of recent debit transactions to net against.
        const [txId] = rest;
        const candidates = await db
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.direction, "debit"),
              isNull(transactions.reducesTransactionId),
              sql`${transactions.id} != ${Number(txId)}`,
            ),
          )
          .orderBy(desc(transactions.occurredAt))
          .limit(5);

        if (candidates.length === 0) {
          await ctx.answerCallbackQuery("No recent transactions to reduce");
          return;
        }
        const options = candidates.map((c) => ({
          id: c.id,
          label: `${(c.sgdAmountCents / 100).toFixed(2)} — ${c.merchantRaw ?? "?"} (${c.occurredAt.toISOString().slice(0, 10)})`,
        }));
        await ctx.editMessageText("Reduce which transaction?", {
          reply_markup: reduceCandidatesKeyboard(Number(txId), options),
        });
        await ctx.answerCallbackQuery();
        return;
      }
      case "rt": {
        // FR-21: target chosen — link and close out the reducing row.
        const [sourceId, targetId] = rest;
        await db
          .update(transactions)
          .set({ reducesTransactionId: Number(targetId), status: "tagged", taggedAt: new Date() })
          .where(eq(transactions.id, Number(sourceId)));
        await ctx.editMessageText(`↩️ Reduces #${targetId}`);
        await ctx.answerCallbackQuery("Linked");
        return;
      }
      case "cancel": {
        const [txId] = rest;
        await ctx.editMessageText(`Transaction #${txId} — use /pending to revisit`);
        await ctx.answerCallbackQuery();
        return;
      }
      case "ti": {
        // FR-20a: ignore this (sender, subject) pattern permanently.
        const [uneId] = rest;
        const [row] = await db.select().from(unclassifiedEmails).where(eq(unclassifiedEmails.id, Number(uneId)));
        if (!row) return;
        await db
          .insert(senderRules)
          .values({ sender: row.sender, subject: row.subject ?? "", action: "ignore" })
          .onConflictDoUpdate({
            target: [senderRules.sender, senderRules.subject],
            set: { action: "ignore" },
          });
        await db.update(unclassifiedEmails).set({ status: "ignored" }).where(eq(unclassifiedEmails.id, Number(uneId)));
        await ctx.editMessageText("🚫 Will ignore this type going forward");
        await ctx.answerCallbackQuery("Ignoring this type");
        return;
      }
      case "tn": {
        // FR-20b: queue for a real parser, stop re-alerting on this pattern.
        const [uneId] = rest;
        const [row] = await db.select().from(unclassifiedEmails).where(eq(unclassifiedEmails.id, Number(uneId)));
        if (!row) return;
        await db
          .insert(senderRules)
          .values({ sender: row.sender, subject: row.subject ?? "", action: "needs_parser" })
          .onConflictDoUpdate({
            target: [senderRules.sender, senderRules.subject],
            set: { action: "needs_parser" },
          });
        await db.update(unclassifiedEmails).set({ status: "needs_parser" }).where(eq(unclassifiedEmails.id, Number(uneId)));
        await ctx.editMessageText("🔧 Queued — won't alert again until this is fixed");
        await ctx.answerCallbackQuery("Queued");
        return;
      }
      default:
        await ctx.answerCallbackQuery();
    }
  } catch (err) {
    console.error("callback_query handler error", err);
    await ctx.answerCallbackQuery("Something went wrong").catch(() => {});
  }
});

/** FR-11 (description edit) and FR-22 (FX amend) — both driven by
 * replying directly to the original transaction message, no extra state
 * store needed since Telegram already tracks the reply target. */
bot.on("message:text", async (ctx) => {
  const replyToId = ctx.message.reply_to_message?.message_id;
  if (!replyToId) return; // not a reply — command handlers below cover the rest

  const [tx] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.telegramMessageId, replyToId));
  if (!tx) return;

  const text = ctx.message.text.trim();
  const isBareNumber = /^\d+(\.\d{1,2})?$/.test(text);

  if (tx.fxSource === "spot_estimate" && isBareNumber) {
    const sgdAmountCents = Math.round(parseFloat(text) * 100);
    await db
      .update(transactions)
      .set({ sgdAmountCents, fxSource: "confirmed" })
      .where(eq(transactions.id, tx.id));
    await ctx.reply(`✅ Updated #${tx.id} to SGD ${text} (confirmed)`, { reply_to_message_id: replyToId });
    return;
  }

  await db.update(transactions).set({ description: text }).where(eq(transactions.id, tx.id));
  await ctx.reply(`✅ Description updated for #${tx.id}`, { reply_to_message_id: replyToId });
});

bot.command("today", async (ctx) => {
  const { start, end } = todayRange();
  await ctx.reply(await formatRangeReport("Today", start, end), { parse_mode: "Markdown" });
});

bot.command("week", async (ctx) => {
  const { start, end } = last7DaysRange();
  await ctx.reply(await formatRangeReport("Last 7 days", start, end), { parse_mode: "Markdown" });
});

bot.command("month", async (ctx) => {
  const { start, end } = currentMonthRange();
  await ctx.reply(await formatRangeReport("This month", start, end), { parse_mode: "Markdown" });
});

bot.command("pending", async (ctx) => {
  await ctx.reply(await formatPendingReport(), { parse_mode: "Markdown" });
});

// FR-19: on-demand only, never automatic. Nat forwards this himself —
// no standing access, no second chat wired up.
bot.command("partner", async (ctx) => {
  const { start, end } = currentMonthRange();
  const report = await formatRangeReport("Shared this month", start, end);
  await ctx.reply(`${report}\n\n_Forward this to share — nothing is sent automatically._`, {
    parse_mode: "Markdown",
  });
});

// FR-16 (P2): CSV export for the current month by default.
bot.command("export", async (ctx) => {
  const { start, end } = currentMonthRange();
  const rows = await db
    .select()
    .from(transactions)
    .where(and(sql`${transactions.occurredAt} >= ${start}`, sql`${transactions.occurredAt} < ${end}`))
    .orderBy(desc(transactions.occurredAt));

  const header = "id,occurred_at,bank,merchant,amount,currency,sgd_amount,direction,category,split,status\n";
  const body = rows
    .map((r) =>
      [
        r.id,
        r.occurredAt.toISOString(),
        r.bank,
        (r.merchantRaw ?? "").replace(/,/g, ";"),
        (r.amountCents / 100).toFixed(2),
        r.currency,
        (r.sgdAmountCents / 100).toFixed(2),
        r.direction,
        r.category ?? "",
        r.split ?? "",
        r.status,
      ].join(","),
    )
    .join("\n");

  const csv = header + body;
  await ctx.replyWithDocument(new InputFile(Buffer.from(csv, "utf-8"), "tallymymoney-export.csv"));
});
