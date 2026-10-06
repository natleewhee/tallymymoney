// Every message here is PLAIN TEXT — no parse_mode, deliberately.
//
// These messages interpolate bank-supplied merchant strings, and card
// networks routinely put Markdown-active characters in them:
// "WEIXIN*Shanghai Pala" (a real sample in spike-01), "AMAZON*MKTPLACE",
// "SQ *COFFEEBAR". Under parse_mode:"Markdown" an odd number of asterisks
// makes Telegram reject the whole sendMessage with HTTP 400, which means
// the transaction is saved to the database and Nat is never told it
// exists — /api/ingest catches the throw, logs it, and Apps Script sees a
// 2xx and marks the email done. An even number is worse in its own way:
// it renders as bold and silently eats the characters.
//
// Bold headers are not worth losing transactions over. If formatting is
// ever wanted back, it must come with escaping of every interpolated
// bank-derived value — see docs/LESSONS.md.

import { eq } from "drizzle-orm";
import { db } from "../db";
import { merchantRules, transactions } from "../schema";
import { bot } from "./bot";
import {
  confirmOrOverrideKeyboard,
  newTransactionKeyboard,
  triageKeyboard,
} from "./keyboards";
import { normaliseMerchant } from "../merchant";
import { formatSgtDateTime } from "../sgt";

const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function fmtAmount(amountCents: number, currency: string): string {
  return `${currency} ${(amountCents / 100).toFixed(2)}`;
}

/** FR-6/7/8: notify on a newly-ingested transaction. Pre-fills
 * category/split when the merchant has been seen before (FR-7); shows
 * the full category picker otherwise (FR-8). */
export async function notifyNewTransaction(txId: number): Promise<void> {
  if (!CHAT_ID) throw new Error("TELEGRAM_CHAT_ID is not set");

  const [tx] = await db.select().from(transactions).where(eq(transactions.id, txId));
  if (!tx) throw new Error(`Transaction ${txId} not found`);

  const merchantKey = tx.merchantRaw ? normaliseMerchant(tx.merchantRaw) : null;
  const rule = merchantKey
    ? (await db.select().from(merchantRules).where(eq(merchantRules.merchantNormalised, merchantKey)))[0]
    : undefined;

  const directionEmoji = tx.direction === "debit" ? "💳" : "💰";
  const fxNote =
    tx.fxSource === "spot_estimate"
      ? "\n⚠️ SGD amount is an estimate — reply with the real figure once confirmed"
      : tx.fxSource === "placeholder"
        ? "\n🚫 No FX rate was available — this SGD amount is a 1:1 placeholder and is excluded from your totals until you reply with the real figure"
        : "";

  const lines = [
    `${directionEmoji} ${tx.direction === "debit" ? "NEW TRANSACTION" : "MONEY IN"}`,
    "",
    `Amount: ${fmtAmount(tx.amountCents, tx.currency)}${tx.currency !== "SGD" ? ` (≈ SGD ${(tx.sgdAmountCents / 100).toFixed(2)})` : ""}`,
    `Merchant: ${tx.merchantRaw ?? "(none given)"}`,
    `Bank: ${tx.bank}${tx.accountIdentifier ? ` (${tx.accountIdentifier})` : ""}`,
    `Date: ${formatSgtDateTime(tx.occurredAt)}`,
    fxNote,
  ].filter(Boolean);

  const text = lines.join("\n");

  if (rule) {
    const msg = await bot.api.sendMessage(
      CHAT_ID,
      `${text}\n\n📌 Known merchant → ${rule.category}${rule.defaultSplit ? ` / ${rule.defaultSplit}` : ""}`,
      { reply_markup: confirmOrOverrideKeyboard(tx.id) },
    );
    await db.update(transactions).set({ telegramMessageId: msg.message_id }).where(eq(transactions.id, tx.id));
    return;
  }

  const msg = await bot.api.sendMessage(CHAT_ID, text, {
    reply_markup: newTransactionKeyboard(tx.id),
  });
  await db.update(transactions).set({ telegramMessageId: msg.message_id }).where(eq(transactions.id, tx.id));
}

/** FR-4/FR-20: a new (sender, subject) pattern, never seen before.
 * Shows the email's own date/time so Nat can find it in the dedicated
 * inbox — the received timestamp from Apps Script, not "now". */
export async function notifyUnclassified(
  unclassifiedId: number,
  sender: string,
  subject: string | null,
  emailDate: Date,
): Promise<void> {
  if (!CHAT_ID) throw new Error("TELEGRAM_CHAT_ID is not set");
  const text = [
    "❓ UNRECOGNISED EMAIL",
    "",
    `From: ${sender}`,
    `Subject: ${subject ?? "(none)"}`,
    `Date: ${formatSgtDateTime(emailDate)}`,
    "",
    "Is this a transaction email I should learn, or should I ignore this type going forward?",
  ].join("\n");
  await bot.api.sendMessage(CHAT_ID, text, {
    reply_markup: triageKeyboard(unclassifiedId),
  });
}

/** R3: a sender we know, in a shape our parser doesn't recognise —
 * distinct message from notifyUnclassified so it's clear this is parser
 * drift on a previously-working pattern, not a brand-new sender. */
export async function notifyParseFailure(
  unclassifiedId: number,
  bank: string,
  subject: string | null,
  emailDate: Date,
): Promise<void> {
  if (!CHAT_ID) throw new Error("TELEGRAM_CHAT_ID is not set");
  const text = [
    "⚠️ COULDN'T READ THIS ONE",
    "",
    `Bank: ${bank}`,
    `Subject: ${subject ?? "(none)"}`,
    `Date: ${formatSgtDateTime(emailDate)}`,
    "",
    "This sender is known, but the email didn't match any parser shape — the bank may have changed its template.",
  ].join("\n");
  await bot.api.sendMessage(CHAT_ID, text, {
    reply_markup: triageKeyboard(unclassifiedId),
  });
}

/** FR-22, /estimates: re-announces a transaction still carrying an
 * unconfirmed FX estimate, with the reply-to-confirm prompt front and
 * centre — /pending's resend of untagged transactions already carries
 * this for anything not yet tagged, but a transaction that's already
 * been tagged has no route back to it at all, since tagging edits the
 * original message away (confirmed 2026-08-20: the "reply with the real
 * figure" prompt only ever existed on the original notification, which
 * editMessageText overwrites the moment a category is picked).
 *
 * Deliberately not notifyNewTransaction: that shows the full category
 * picker, which would misleadingly imply an already-tagged transaction
 * needs re-tagging. This is just the amount and the ask. */
export async function notifyFxPending(txId: number): Promise<void> {
  if (!CHAT_ID) throw new Error("TELEGRAM_CHAT_ID is not set");

  const [tx] = await db.select().from(transactions).where(eq(transactions.id, txId));
  if (!tx) return;

  const isPlaceholder = tx.fxSource === "placeholder";
  const text = [
    isPlaceholder ? `🚫 NO FX RATE AVAILABLE — #${tx.id}` : `💱 SGD ESTIMATE UNCONFIRMED — #${tx.id}`,
    "",
    `Merchant: ${tx.merchantRaw ?? "(none given)"}`,
    `Original: ${fmtAmount(tx.amountCents, tx.currency)}`,
    isPlaceholder
      ? `Placeholder (excluded from totals): SGD ${(tx.sgdAmountCents / 100).toFixed(2)}`
      : `Estimated: SGD ${(tx.sgdAmountCents / 100).toFixed(2)}`,
    `Date: ${formatSgtDateTime(tx.occurredAt)}`,
    "",
    "Reply to this message with the real SGD figure from your statement to confirm.",
  ].join("\n");

  const msg = await bot.api.sendMessage(CHAT_ID, text);
  // Re-stamped so a reply lands here rather than on whatever message
  // last held this id — same reasoning as /pending's resend.
  await db.update(transactions).set({ telegramMessageId: msg.message_id }).where(eq(transactions.id, tx.id));
}

/** A parser's parseNotice() result — a shape that's understood but never
 * becomes a transaction (a declined attempt, a card-verification
 * failure). No transaction to link a reply to, so this is just the
 * message, sent as-is. */
export async function notifyNotice(text: string): Promise<void> {
  if (!CHAT_ID) throw new Error("TELEGRAM_CHAT_ID is not set");
  await bot.api.sendMessage(CHAT_ID, text);
}
