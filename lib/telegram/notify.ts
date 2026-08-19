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
  const fxNote = tx.fxSource === "spot_estimate" ? "\n⚠️ SGD amount is an estimate — reply with the real figure once confirmed" : "";

  const lines = [
    `${directionEmoji} *${tx.direction === "debit" ? "New transaction" : "Money in"}*`,
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
      `${text}\n\n📌 Known merchant → *${rule.category}*${rule.defaultSplit ? ` / ${rule.defaultSplit}` : ""}`,
      { parse_mode: "Markdown", reply_markup: confirmOrOverrideKeyboard(tx.id) },
    );
    await db.update(transactions).set({ telegramMessageId: msg.message_id }).where(eq(transactions.id, tx.id));
    return;
  }

  const msg = await bot.api.sendMessage(CHAT_ID, text, {
    parse_mode: "Markdown",
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
    "❓ *Unrecognised email*",
    "",
    `From: ${sender}`,
    `Subject: ${subject ?? "(none)"}`,
    `Date: ${formatSgtDateTime(emailDate)}`,
    "",
    "Is this a transaction email I should learn, or should I ignore this type going forward?",
  ].join("\n");
  await bot.api.sendMessage(CHAT_ID, text, {
    parse_mode: "Markdown",
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
    "⚠️ *Couldn't read this one*",
    "",
    `Bank: ${bank}`,
    `Subject: ${subject ?? "(none)"}`,
    `Date: ${formatSgtDateTime(emailDate)}`,
    "",
    "This sender is known, but the email didn't match any parser shape — the bank may have changed its template.",
  ].join("\n");
  await bot.api.sendMessage(CHAT_ID, text, {
    parse_mode: "Markdown",
    reply_markup: triageKeyboard(unclassifiedId),
  });
}
