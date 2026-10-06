// Amex Platinum Charge benefit tracker — everything Telegram-facing:
// the /benefits board, its buttons, the reply-with-an-amount prompts, the
// ingest-time "Apply to <benefit>?" suggestion, the single pinned
// "needs attention soon" banner, and the cron's reminders.
//
// Plain text only, same as notify.ts (merchant strings can contain
// Markdown-active characters).
//
// Kept out of bot.ts the same way reports.ts and notify.ts are: bot.ts
// registers thin command/callback wrappers that call into here, and this
// module only touches `bot` inside functions — the same runtime-only
// circular import notify.ts already has with bot.ts.

import { InlineKeyboard, type Context } from "grammy";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { cardChallenges, transactions } from "../schema";
import { bot } from "./bot";
import {
  addChallengeAdjustment,
  challengeProgress,
  deleteSetting,
  ensureCurrentBenefitPeriod,
  findBenefitsByName,
  getPrimaryCard,
  getSetting,
  listBenefitsWithCurrentPeriods,
  listChallengeProgress,
  markChallengeMet,
  recordPeriodUsage,
  setSetting,
  type BenefitWithPeriod,
  type ChallengeProgress,
} from "../cards";
import {
  ATTENTION_WINDOW_DAYS,
  POSTING_BUFFER_DAYS,
  REMINDER_DAYS_LEFT,
  daysLeft,
  fmtDollars,
  fmtPeriod,
  matchesBenefitHeuristic,
  paceCheck,
  parseAmountCents,
  progressBar,
} from "../benefit-logic";
import { formatSgtDateTime } from "../sgt";

const DAY_MS = 24 * 60 * 60 * 1000;
const PIN_CHAT_KEY = "benefit_pin_chat_id";
const PIN_MESSAGE_KEY = "benefit_pin_message_id";
const PROMPT_PREFIX = "prompt:";

type PromptKind = "credit_amount" | "running_total";
interface Prompt {
  kind: PromptKind;
  periodId: number;
  label: string;
}

function chatId(): string {
  const id = process.env.TELEGRAM_CHAT_ID?.trim().replace(/^["']|["']$/g, "");
  if (!id) throw new Error("TELEGRAM_CHAT_ID is not set");
  return id;
}

/** Telegram button text is truncated on phones anyway; keep labels short. */
function shortName(name: string): string {
  return name.length > 28 ? `${name.slice(0, 27)}…` : name;
}

/** Posted-by deadline with the safety buffer applied. */
function bufferedDeadline(end: Date): Date {
  return new Date(end.getTime() - POSTING_BUFFER_DAYS * DAY_MS);
}

function fmtDay(d: Date): string {
  return new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", day: "numeric", month: "short", year: "numeric" }).format(d);
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

function challengeLine(p: ChallengeProgress, asOf: Date): string {
  const c = p.challenge;
  if (p.met) return `🎯 ${c.label}: ✅ met`;
  if (!p.configured) return `🎯 ${c.label}: ⚙️ window not set — needs the card's approval date`;
  const target = c.targetSpendCents ?? 0;
  const end = c.periodEnd!;
  const start = c.periodStart!;
  if (asOf.getTime() < start.getTime()) return `🎯 ${c.label}: opens ${fmtDay(start)}`;
  if (asOf.getTime() >= end.getTime()) return `🎯 ${c.label}: ❌ window closed at ${fmtDollars(p.totalCents)}/${fmtDollars(target)}`;
  const adj = p.adjustmentCents !== 0 ? ` (incl. ${fmtDollars(p.adjustmentCents)} manual)` : "";
  const deadline = c.type === "min_spend" ? ` — aim to finish by ${fmtDay(bufferedDeadline(end))}` : ` (${fmtPeriod(start, end)})`;
  return `🎯 ${c.label}: ${fmtDollars(Math.max(0, p.totalCents))}/${fmtDollars(target)} ${progressBar(p.totalCents, target)}${adj}${deadline}`;
}

function creditLine({ benefit, period }: BenefitWithPeriod): string {
  const amount = benefit.amountCents ?? 0;
  const when = fmtPeriod(period.periodStart, period.periodEnd);
  if (period.status === "used") return `💵 ${benefit.name}: ✅ used (period: ${when})`;
  return `💵 ${benefit.name}: ${fmtDollars(period.usedCents)}/${fmtDollars(amount)} ${progressBar(period.usedCents, amount)} (period: ${when})`;
}

export async function buildBenefitsBoard(asOf: Date = new Date()): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const card = await getPrimaryCard();
  if (!card) {
    return {
      text: "No card set up yet. Run scripts/seed-amex-platinum.mjs once (see its header comment), then /benefits again.",
      keyboard: new InlineKeyboard(),
    };
  }

  const challenges = await listChallengeProgress();
  const items = await listBenefitsWithCurrentPeriods(asOf);
  const kb = new InlineKeyboard();
  const lines: string[] = [`💳 ${card.name.toUpperCase()}`];
  if (!card.accountLast4) lines.push("⚠️ Card last digits not set — counting every Amex transaction.");
  if (!card.renewalDate) lines.push("⚠️ Renewal date not set — cardmember-year items use calendar years.");

  // 1. Dollar credits: challenges + auto_suggest credits.
  lines.push("", "DOLLAR CREDITS & SPEND CHALLENGES");
  for (const p of challenges) {
    lines.push(challengeLine(p, asOf));
    if (!p.met && p.configured) kb.text(`✅ Mark met: ${shortName(p.challenge.label)}`, `cm:${p.challenge.id}`).row();
  }
  for (const item of items.filter((i) => i.benefit.trackingMode === "auto_suggest")) {
    lines.push(creditLine(item));
    if (item.period.status !== "used") kb.text(`💵 Mark used manually: ${shortName(item.benefit.name)}`, `bm:${item.period.id}`).row();
  }

  // 2. Cycle experiences.
  const cycles = items.filter((i) => i.benefit.trackingMode === "manual_log");
  if (cycles.length > 0) {
    lines.push("", "CYCLE EXPERIENCES");
    for (const { benefit, period } of cycles) {
      const when = fmtPeriod(period.periodStart, period.periodEnd);
      lines.push(period.status === "used" ? `🍽 ${benefit.name}: used ✅ (${when})` : `🍽 ${benefit.name}: cycle open (${when})`);
      if (period.status !== "used") kb.text(`📝 Log usage: ${shortName(benefit.name)}`, `bl:${period.id}`).row();
    }
  }

  // 3. Status & memberships — running totals, then un-enrolled checklist items.
  const running = items.filter((i) => i.benefit.trackingMode === "manual_running_total");
  const checklist = items.filter((i) => i.benefit.trackingMode === "one_time_checklist");
  const pending = checklist.filter((i) => i.period.status !== "used");
  const done = checklist.filter((i) => i.period.status === "used");
  if (running.length + pending.length > 0) {
    lines.push("", "STATUS & MEMBERSHIPS");
    for (const { benefit, period } of running) {
      lines.push(`🏅 ${benefit.name}: ${fmtDollars(period.usedCents)} logged (${fmtPeriod(period.periodStart, period.periodEnd)})`);
      kb.text(`➕ Update spend: ${shortName(benefit.name)}`, `bu:${period.id}`).row();
    }
    for (const { benefit, period } of pending) {
      lines.push(`☐ ${benefit.name}`);
      kb.text(`☑️ Mark enrolled: ${shortName(benefit.name)}`, `be:${period.id}`).row();
    }
  }
  if (done.length > 0) {
    lines.push("", `SET UP ✅ (${done.length}): ${done.map((i) => i.benefit.name).join(", ")}`);
  }

  return { text: lines.join("\n"), keyboard: kb };
}

// ---------------------------------------------------------------------------
// Pinned "needs attention soon" banner
// ---------------------------------------------------------------------------

/** Only items inside ATTENTION_WINDOW_DAYS (14 days — see benefit-logic.ts):
 *  - an auto_suggest credit or manual_log cycle still open/partial and
 *    closing within the window;
 *  - an unmet min_spend challenge whose BUFFERED posted-by deadline is
 *    within the window;
 *  - an unmet bonus_month challenge that is open and closing within it.
 * Running totals and checklist items have no hard deadline worth pinning. */
export async function attentionItems(asOf: Date = new Date()): Promise<string[]> {
  const out: string[] = [];
  for (const { benefit, period } of await listBenefitsWithCurrentPeriods(asOf)) {
    if (benefit.trackingMode !== "auto_suggest" && benefit.trackingMode !== "manual_log") continue;
    if (period.status !== "open" && period.status !== "partial") continue;
    const d = daysLeft(period.periodEnd, asOf);
    if (d > ATTENTION_WINDOW_DAYS) continue;
    const last = fmtDay(new Date(period.periodEnd.getTime() - 1));
    if (benefit.amountCents !== null) {
      out.push(`⏳ ${benefit.name}: ${fmtDollars(benefit.amountCents - period.usedCents)} unused — ends in ${d}d (${last})`);
    } else {
      out.push(`⏳ ${benefit.name}: this cycle not used yet — ends in ${d}d (${last})`);
    }
  }
  for (const p of await listChallengeProgress()) {
    const c = p.challenge;
    if (p.met || !p.configured || asOf.getTime() < c.periodStart!.getTime() || asOf.getTime() >= c.periodEnd!.getTime()) continue;
    const deadline = c.type === "min_spend" ? bufferedDeadline(c.periodEnd!) : c.periodEnd!;
    const d = daysLeft(deadline, asOf);
    if (d > ATTENTION_WINDOW_DAYS) continue;
    const remaining = Math.max(0, (c.targetSpendCents ?? 0) - p.totalCents);
    out.push(`🎯 ${c.label}: ${fmtDollars(remaining)} to go — ${c.type === "min_spend" ? "aim to post by" : "ends"} ${fmtDay(deadline)} (${d}d)`);
  }
  return out;
}

async function bannerText(asOf: Date): Promise<string> {
  const items = await attentionItems(asOf);
  const head = `📌 AMEX — NEEDS ATTENTION (next ${ATTENTION_WINDOW_DAYS} days)`;
  const body = items.length > 0 ? items : ["Nothing due soon ✅"];
  return [head, "", ...body, "", `Updated ${formatSgtDateTime(asOf)} · /benefits for everything`].join("\n");
}

function isMessageGone(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /message to (?:edit|pin|delete) not found|message_id_invalid/i.test(message);
}

/** Best-effort, never throws — same treatment the old holiday banner had.
 * Edits the one pinned message in place. If it's missing (never created,
 * or Nat deleted it), only re-creates it when `create` is set — i.e. from
 * /benefits, where Nat is actively looking — so a background event (ingest,
 * cron) never surprises him with a fresh pin. */
export async function refreshBenefitBanner(opts: { create?: boolean } = {}): Promise<void> {
  try {
    const text = await bannerText(new Date());
    const storedChat = await getSetting(PIN_CHAT_KEY);
    const storedMsg = await getSetting(PIN_MESSAGE_KEY);

    if (storedChat && storedMsg) {
      try {
        await bot.api.editMessageText(storedChat, Number(storedMsg), text);
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("message is not modified")) return;
        if (!isMessageGone(err)) throw err;
        // Deleted from the chat — forget it so we stop retrying forever.
        await deleteSetting(PIN_CHAT_KEY);
        await deleteSetting(PIN_MESSAGE_KEY);
      }
    }

    if (!opts.create) return;
    const target = chatId();
    const msg = await bot.api.sendMessage(target, text);
    await bot.api.pinChatMessage(target, msg.message_id, { disable_notification: true });
    await setSetting(PIN_CHAT_KEY, target);
    await setSetting(PIN_MESSAGE_KEY, String(msg.message_id));
  } catch (err) {
    console.error("could not refresh benefit banner", err);
  }
}

// ---------------------------------------------------------------------------
// Ingest-time suggestion
// ---------------------------------------------------------------------------

/** After an Amex transaction is stored: offer (never apply) it against any
 * open auto_suggest credit it plausibly matches — see
 * matchesBenefitHeuristic for how low-confidence that match is. Then
 * refresh the pin, since challenge progress just moved. */
export async function notifyBenefitSuggestions(txId: number): Promise<void> {
  const [tx] = await db.select().from(transactions).where(eq(transactions.id, txId));
  if (!tx || tx.direction !== "debit" || tx.bank !== "Amex") return;

  for (const { benefit, period } of await listBenefitsWithCurrentPeriods()) {
    if (benefit.trackingMode !== "auto_suggest") continue;
    if (period.status !== "open" && period.status !== "partial") continue;
    if (!matchesBenefitHeuristic(benefit.name, tx)) continue;
    const remaining = (benefit.amountCents ?? 0) - period.usedCents;
    await bot.api.sendMessage(
      chatId(),
      [
        `🤔 Could this count toward ${benefit.name}?`,
        "",
        `${tx.merchantRaw ?? "(no merchant)"} — ${fmtDollars(tx.sgdAmountCents)}${tx.currency !== "SGD" ? ` (${tx.currency})` : ""}`,
        `${fmtDollars(remaining)} of this period's credit left.`,
        "",
        "Low-confidence guess from the merchant/amount only — check the credit was saved to the card and the T&Cs fit.",
      ].join("\n"),
      {
        reply_markup: new InlineKeyboard()
          .text(`✅ Apply to ${shortName(benefit.name)}`, `ba:${period.id}:${tx.id}`)
          .text("❌ Not this one", `bn:${tx.id}`),
      },
    );
  }
  await refreshBenefitBanner();
}

// ---------------------------------------------------------------------------
// Callbacks, prompts and commands (wired up from bot.ts)
// ---------------------------------------------------------------------------

async function rerenderBoard(ctx: Context): Promise<void> {
  const { text, keyboard } = await buildBenefitsBoard();
  try {
    await ctx.editMessageText(text, { reply_markup: keyboard });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("message is not modified")) throw err;
  }
}

async function sendPrompt(ctx: Context, prompt: Prompt, question: string): Promise<void> {
  const msg = await ctx.reply(question, { reply_markup: { force_reply: true, selective: true } });
  await setSetting(`${PROMPT_PREFIX}${msg.message_id}`, JSON.stringify(prompt));
}

/** Returns true if the callback belonged to the benefit tracker. */
export async function handleBenefitCallback(ctx: Context, action: string, rest: string[]): Promise<boolean> {
  switch (action) {
    case "ba": {
      const [periodId, txId] = rest.map(Number);
      const [tx] = await db.select().from(transactions).where(eq(transactions.id, txId));
      if (!tx) {
        await ctx.answerCallbackQuery("Transaction not found");
        return true;
      }
      const res = await recordPeriodUsage(periodId, tx.sgdAmountCents, `tx #${tx.id}`);
      if (!res) {
        await ctx.answerCallbackQuery("Benefit period not found");
        return true;
      }
      await ctx.editMessageText(
        `✅ Applied ${tx.merchantRaw ?? `#${tx.id}`} to ${res.benefit.name} — ${fmtDollars(res.period.usedCents)}/${fmtDollars(res.benefit.amountCents ?? 0)} used this period.`,
      );
      await ctx.answerCallbackQuery("Applied");
      await refreshBenefitBanner();
      return true;
    }
    case "bn": {
      await ctx.editMessageText("👍 Not applied to any credit.");
      await ctx.answerCallbackQuery();
      return true;
    }
    case "bm": {
      const periodId = Number(rest[0]);
      await ctx.answerCallbackQuery();
      await sendPrompt(
        ctx,
        { kind: "credit_amount", periodId, label: "credit" },
        "Reply to this message with the amount used (e.g. 200), or \"full\" to mark the whole credit used.",
      );
      return true;
    }
    case "bu": {
      const periodId = Number(rest[0]);
      await ctx.answerCallbackQuery();
      await sendPrompt(
        ctx,
        { kind: "running_total", periodId, label: "spend" },
        "Reply to this message with the qualifying spend to ADD to the running total (e.g. 450).",
      );
      return true;
    }
    case "bl":
    case "be": {
      const res = await recordPeriodUsage(Number(rest[0]), null);
      if (!res) {
        await ctx.answerCallbackQuery("Not found");
        return true;
      }
      await ctx.answerCallbackQuery(action === "bl" ? `Logged: ${res.benefit.name}` : `Enrolled: ${res.benefit.name}`);
      await rerenderBoard(ctx);
      await refreshBenefitBanner();
      return true;
    }
    case "cm": {
      const row = await markChallengeMet(Number(rest[0]));
      await ctx.answerCallbackQuery(row ? "Marked met" : "Not found");
      await rerenderBoard(ctx);
      await refreshBenefitBanner();
      return true;
    }
    default:
      return false;
  }
}

/** Handles a reply to one of sendPrompt's messages. Returns false if the
 * replied-to message wasn't a benefit prompt, so the caller can carry on. */
export async function handlePromptReply(ctx: Context, replyToId: number, text: string): Promise<boolean> {
  const key = `${PROMPT_PREFIX}${replyToId}`;
  const raw = await getSetting(key);
  if (!raw) return false;
  const prompt = JSON.parse(raw) as Prompt;

  const isFull = prompt.kind === "credit_amount" && /^full$/i.test(text.trim());
  const cents = isFull ? null : parseAmountCents(text);
  if (!isFull && cents === null) {
    await ctx.reply("Couldn't read that as an amount — reply again with a number like 120 or 120.50.");
    return true;
  }
  const res = await recordPeriodUsage(prompt.periodId, cents, "manual");
  await deleteSetting(key);
  if (!res) {
    await ctx.reply("That benefit period no longer exists.");
    return true;
  }
  const { benefit, period } = res;
  await ctx.reply(
    benefit.trackingMode === "manual_running_total"
      ? `✅ ${benefit.name}: running total now ${fmtDollars(period.usedCents)}.`
      : `✅ ${benefit.name}: ${fmtDollars(period.usedCents)}/${fmtDollars(benefit.amountCents ?? 0)} (${period.status}).`,
  );
  await refreshBenefitBanner();
  return true;
}

export async function handleBenefitsCommand(ctx: Context): Promise<void> {
  const { text, keyboard } = await buildBenefitsBoard();
  await ctx.reply(text, { reply_markup: keyboard });
  await refreshBenefitBanner({ create: true });
}

/** /usebenefit <name> [amount] — mark a benefit used without waiting for an
 * ingest prompt (e.g. a credit that posted without an alert, or a Table
 * for Two booked yesterday). Amount adds to a dollar credit or running
 * total; omitted, the current period is marked fully used. */
export async function handleUseBenefitCommand(ctx: Context, args: string): Promise<void> {
  const m = args.trim().match(/^(.+?)(?:\s+(\S*\d[\d,.]*))?$/);
  if (!m) {
    await ctx.reply("Usage: /usebenefit <benefit name> [amount]\ne.g. /usebenefit wine 200  ·  /usebenefit table for two");
    return;
  }
  const [, name, amountStr] = m;
  const cents = amountStr ? parseAmountCents(amountStr) : null;
  if (amountStr && cents === null) {
    await ctx.reply(`Couldn't read "${amountStr}" as an amount.`);
    return;
  }
  const matches = await findBenefitsByName(name);
  if (matches.length === 0) {
    await ctx.reply(`No benefit matches "${name}". See /benefits.`);
    return;
  }
  if (matches.length > 1) {
    await ctx.reply(`"${name}" matches several — be more specific:\n${matches.map((b) => `• ${b.name}`).join("\n")}`);
    return;
  }
  const period = await ensureCurrentBenefitPeriod(matches[0].id);
  const res = await recordPeriodUsage(period.id, cents, "via /usebenefit");
  if (!res) return;
  const { benefit, period: p } = res;
  await ctx.reply(
    benefit.amountCents !== null || benefit.trackingMode === "manual_running_total"
      ? `✅ ${benefit.name}: ${fmtDollars(p.usedCents)}${benefit.amountCents !== null ? `/${fmtDollars(benefit.amountCents)}` : " logged"} (${p.status}).`
      : `✅ ${benefit.name} marked used for ${fmtPeriod(p.periodStart, p.periodEnd)}.`,
  );
  await refreshBenefitBanner();
}

/** /cardadjust [challenge] <+/-amount> [note] — manual correction to a
 * challenge's derived progress, e.g. "/cardadjust spend +500 missed email".
 * No challenge name (or the word "spend") means the current min-spend
 * challenge. Stored as a separate adjustment row, never a fake transaction. */
export async function handleCardAdjustCommand(ctx: Context, args: string): Promise<void> {
  const m = args.trim().match(/^(.*?)\s*([+-]\s*\$?[\d,]+(?:\.\d{1,2})?|\$?[\d,]+(?:\.\d{1,2})?)(?:\s+(.*))?$/);
  if (!m) {
    await ctx.reply("Usage: /cardadjust [challenge] <+/-amount> [note]\ne.g. /cardadjust spend +500 missed alert");
    return;
  }
  const [, nameRaw, amountRaw, note] = m;
  const negative = amountRaw.trim().startsWith("-");
  const cents = parseAmountCents(amountRaw.replace(/^[+-]\s*/, ""));
  if (cents === null) {
    await ctx.reply(`Couldn't read "${amountRaw}" as an amount.`);
    return;
  }
  const name = nameRaw.trim().toLowerCase();

  const all = await db.select().from(cardChallenges);
  let challenge;
  if (!name || name === "spend") {
    const progress = await listChallengeProgress();
    challenge =
      progress.find((p) => p.challenge.type === "min_spend" && !p.met)?.challenge ??
      all.find((c) => c.type === "min_spend");
  } else {
    const hits = all.filter((c) => c.label.toLowerCase().includes(name));
    if (hits.length > 1) {
      await ctx.reply(`"${nameRaw}" matches several challenges:\n${hits.map((c) => `• ${c.label}`).join("\n")}`);
      return;
    }
    challenge = hits[0];
  }
  if (!challenge) {
    await ctx.reply("No matching challenge. See /benefits.");
    return;
  }
  await addChallengeAdjustment(challenge.id, negative ? -cents : cents, note?.trim() || null);
  const p = await challengeProgress(challenge);
  await ctx.reply(
    `✅ ${challenge.label}: ${negative ? "-" : "+"}${fmtDollars(cents)} adjustment. Now ${fmtDollars(p.totalCents)}/${fmtDollars(challenge.targetSpendCents ?? 0)}.`,
  );
  await refreshBenefitBanner();
}

// ---------------------------------------------------------------------------
// Cron
// ---------------------------------------------------------------------------

/** Daily: one "closing soon" message for every auto_suggest/manual_log
 * period still open (or partial) whose days-left is exactly one of
 * REMINDER_DAYS_LEFT (7 and 1) — a heads-up and a last call, not a daily
 * drip. Returns how many items were reminded about. */
export async function sendClosingReminders(asOf: Date = new Date()): Promise<number> {
  const lines: string[] = [];
  for (const { benefit, period } of await listBenefitsWithCurrentPeriods(asOf)) {
    if (benefit.trackingMode !== "auto_suggest" && benefit.trackingMode !== "manual_log") continue;
    if (period.status !== "open" && period.status !== "partial") continue;
    const d = daysLeft(period.periodEnd, asOf);
    if (!REMINDER_DAYS_LEFT.includes(d)) continue;
    const left = benefit.amountCents !== null ? `${fmtDollars(benefit.amountCents - period.usedCents)} unused` : "not used this cycle";
    lines.push(`• ${benefit.name}: ${left} — ${d === 1 ? "LAST DAY today" : `${d} days left`}`);
  }
  if (lines.length === 0) return 0;
  await bot.api.sendMessage(chatId(), ["⏰ AMEX BENEFITS CLOSING", "", ...lines, "", "No rollover — /benefits to log usage."].join("\n"));
  return lines.length;
}

/** Weekly (Mondays SGT, called by the cron) pace check for min_spend
 * challenges. Silent unless paceCheck says meaningfully behind — see
 * benefit-logic.ts paceCheck for the two triggers. Weekly rather than
 * daily because the answer rarely changes day to day and a daily "you're
 * behind" is exactly the noise this is meant to avoid. */
export async function sendPaceReminders(asOf: Date = new Date()): Promise<number> {
  let sent = 0;
  for (const p of await listChallengeProgress()) {
    const c = p.challenge;
    if (c.type !== "min_spend" || p.met || !p.configured || c.targetSpendCents === null) continue;
    if (asOf.getTime() < c.periodStart!.getTime() || asOf.getTime() >= c.periodEnd!.getTime()) continue;
    const pace = paceCheck(p.totalCents, c.targetSpendCents, c.periodStart!, c.periodEnd!, asOf);
    if (!pace.behind) continue;
    await bot.api.sendMessage(
      chatId(),
      [
        `🐢 BEHIND PACE — ${c.label}`,
        "",
        `${fmtDollars(Math.max(0, p.totalCents))}/${fmtDollars(c.targetSpendCents)} ${progressBar(p.totalCents, c.targetSpendCents)}`,
        `Why: ${pace.reason}`,
        `To finish: ~${fmtDollars(pace.requiredWeeklyCents)}/week, posted by ${fmtDay(bufferedDeadline(c.periodEnd!))} (${POSTING_BUFFER_DAYS}-day posting buffer).`,
        c.deadlineBasis ? `Rule: ${c.deadlineBasis}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    sent += 1;
  }
  return sent;
}
