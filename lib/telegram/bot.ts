import { Bot, InputFile } from "grammy";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { merchantRules, senderRules, transactions, unclassifiedEmails } from "../schema";
import { CATEGORIES } from "../categories";
import { normaliseMerchant } from "../merchant";
import {
  categoryKeyboard,
  pendingKeyboard,
  reduceCandidatesKeyboard,
  rulesKeyboard,
  splitKeyboard,
} from "./keyboards";
import { formatPendingReport, formatRangeReport } from "./reports";
import { currentMonthRange, last7DaysRange, todayRange } from "../sgt";
import { resendUnnotified, retryUnparsed } from "../recovery";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");

export const bot = new Bot(token);

// Trimmed and stripped of any surrounding quote characters: a stray
// space, newline, or quote pasted into Vercel's env var field is
// invisible there but breaks a strict string comparison. Confirmed
// 2026-08-20 as the likely cause of commands being silently rejected
// while outgoing notifications (which pass this same value straight to
// Telegram's API, which is more forgiving) worked fine.
const OWNER_CHAT_ID = process.env.TELEGRAM_CHAT_ID?.trim().replace(/^["']|["']$/g, "");

/** ARCHITECTURE.md §6: ignore any chat_id that isn't Nat's — single-user
 * product, no reason to process anyone else's messages or callbacks.
 * Logs a rejection so a chat_id/env-var mismatch shows up directly in
 * Vercel's function logs instead of looking like total silence with no
 * way to tell why. */
bot.use(async (ctx, next) => {
  const chatId = ctx.chat?.id?.toString();
  if (!OWNER_CHAT_ID || chatId !== OWNER_CHAT_ID) {
    console.log(
      `Rejected update: incoming chat_id=${chatId ?? "(none)"}, configured TELEGRAM_CHAT_ID=${OWNER_CHAT_ID ?? "(unset)"}`,
    );
    return;
  }
  await next();
});

/** Without this, grammY's default behaviour on an unhandled error is to
 * log it to console and still return 200 to Telegram — so a thrown
 * error (bad DATABASE_URL, a Neon query failure, anything) looks
 * identical to the bot doing nothing at all, and the only way to see it
 * is digging through Vercel's function logs. Send it to the chat
 * instead, so a command that fails says so instead of going silent. */
bot.catch((err) => {
  console.error("Unhandled bot error", err.error);
  if (!OWNER_CHAT_ID) return;
  const message = err.error instanceof Error ? err.error.message : String(err.error);
  bot.api.sendMessage(OWNER_CHAT_ID, `⚠️ Something broke: ${message}`).catch(() => {});
});

/** Confirmed 2026-08-19: Nat wants a plain-language summary after tagging,
 * not a bare "Category · Split" label — e.g. "$20.30 paid at Cabcharge
 * Asia (Joint)". */
function describeTagged(
  tx: { sgdAmountCents: number; merchantRaw: string | null; direction: string },
  split: "solo" | "joint",
): string {
  const amount = `$${(tx.sgdAmountCents / 100).toFixed(2)}`;
  const who = tx.merchantRaw ?? "unknown";
  const splitLabel = split === "solo" ? "Solo" : "Joint";
  const verb = tx.direction === "debit" ? "paid at" : "received from";
  return `✅ ${amount} ${verb} ${who} (${splitLabel})`;
}

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
        await ctx.editMessageText(describeTagged(tx, split as "solo" | "joint"));
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
          await ctx.editMessageText(describeTagged(tx, rule.defaultSplit as "solo" | "joint"));
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
      case "resend": {
        await ctx.answerCallbackQuery("Re-sending…");
        const { sent, failed } = await resendUnnotified();
        await ctx.reply(
          sent === 0 && failed === 0
            ? "Nothing to re-send — every saved transaction has been alerted."
            : `🔄 Re-sent ${sent} missed alert(s)${failed > 0 ? `, ${failed} still failing` : ""}.`,
        );
        return;
      }
      case "reparse": {
        await ctx.answerCallbackQuery("Retrying…");
        const { recovered, stillFailing } = await retryUnparsed();
        await ctx.reply(
          recovered === 0 && stillFailing === 0
            ? "Nothing stuck — no unparsed emails waiting."
            : `🔁 Recovered ${recovered} transaction(s). ${stillFailing} still can't be read — forward those on so a parser can be built.`,
        );
        return;
      }
      case "rc": {
        // /rules: clear one sender_rule by its position in that listing.
        const [idxStr] = rest;
        const rules = await db.select().from(senderRules).orderBy(desc(senderRules.createdAt));
        const rule = rules[Number(idxStr)];
        if (!rule) {
          await ctx.answerCallbackQuery("Already cleared");
          return;
        }
        await db
          .delete(senderRules)
          .where(and(eq(senderRules.sender, rule.sender), eq(senderRules.subject, rule.subject)));
        await ctx.editMessageText(`✅ Cleared [${rule.action}] ${rule.sender} — "${rule.subject}"`);
        await ctx.answerCallbackQuery("Cleared");
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
        await ctx.editMessageText("🔧 Queued — won't alert again until this is fixed. Look for 🔴 tallymymoney-needs-parser in Gmail in a few minutes to find and forward it on.");
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

bot.command("help", async (ctx) => {
  await ctx.reply(
    [
      "*Commands*",
      "/today — Today's spending",
      "/week — Last 7 days",
      "/month — This month, by category",
      "/pending — Transactions and email patterns awaiting action",
      "/partner — Shareable summary for this month",
      "/export — CSV export for this month",
      "/rules — List/clear ignore or needs-parser rules",
    ].join("\n"),
    { parse_mode: "Markdown" },
  );
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
  await ctx.reply(await formatPendingReport(), {
    parse_mode: "Markdown",
    reply_markup: pendingKeyboard(),
  });
});

// Lets Nat see and undo "ignore"/"needs_parser" sender_rules from the
// bot instead of raw SQL — needed now that a stale rule can silently
// block a whole bank's alerts (see the dispatch-first note in
// app/api/ingest/route.ts).
bot.command("rules", async (ctx) => {
  const rules = await db.select().from(senderRules).orderBy(desc(senderRules.createdAt));
  if (rules.length === 0) {
    await ctx.reply("No active sender rules.");
    return;
  }
  const lines = rules.map((r, i) => `${i}. [${r.action}] ${r.sender} — "${r.subject}"`);
  await ctx.reply(lines.join("\n"), { reply_markup: rulesKeyboard(rules.length) });
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
