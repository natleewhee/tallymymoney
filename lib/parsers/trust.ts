// Trust: single sender (from_us@trustbank.sg), three prose templates —
// domestic spend, overseas spend, and partial reversal. No card/account
// last-4 anywhere in any template; only the card product name
// ("Freedom"). Confirmed sufficient by Nat for a single-card setup —
// see SPIKE-01-RESULTS.md and FR-21's note in ARCHITECTURE.md.

import type { BankParser, InboundEmail, ParsedTransaction } from "./types";
import { bestText, cleanMerchant } from "./types";
import { stripHtml } from "./html";
import { parseTrustDate } from "./dates";

function parseAmount(s: string): number {
  const m = s.match(/SGD\s*([\d,]+\.\d+)/i);
  if (!m) throw new Error(`No SGD amount found in: "${s}"`);
  return Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
}

function parseGenericAmount(s: string): number {
  const m = s.match(/([\d,]+\.\d+)/);
  if (!m) throw new Error(`No amount found in: "${s}"`);
  return Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
}

function parseSpend(text: string): ParsedTransaction | null {
  // "You've spent SGD 20.30 at Cabcharge Asia Pte Ltd SINGAPORE SG on
  //  16 Aug 2026 12:45SGT with Freedom credit card."
  const m = text.match(
    /You[''`]?ve spent\s+(SGD\s*[\d,]+\.\d+)\s+at\s+(.+?)\s+on\s+(\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}\s+\d{1,2}:\d{2}SGT)\s+with\s+([^\n.]+?)\s+card/i,
  );
  if (!m) return null;
  const [, amountStr, merchant, dateStr, cardName] = m;
  return {
    amountCents: parseAmount(amountStr),
    currency: "SGD",
    direction: "debit",
    merchantRaw: cleanMerchant(merchant),
    bank: "Trust",
    accountIdentifier: cardName.trim(), // e.g. "Freedom" — no last-4 available, by design
    occurredAt: parseTrustDate(dateStr),
  };
}

function parseOverseasSpend(text: string): ParsedTransaction | null {
  // "0% FX fees! You've spent CNY 1025.88 using Freedom credit card at
  //  WEIXIN*Shanghai Pala     ShenZhen     CN on 19 Aug 2026 10:01SGT.
  //  You'll receive estimated S$0.97 and up to 15% bonus cashback*."
  // Different word order from domestic spend ("using {card} credit card
  // at {merchant}" vs domestic's "at {merchant} ... with {card} card"),
  // and the currency is never SGD here — that's the whole point of this
  // template. FX conversion happens downstream in /api/ingest (FR-2),
  // not in this parser.
  const m = text.match(
    /You[''`]?ve spent\s+([A-Z]{3})\s*([\d,]+\.\d+)\s+using\s+([^\n]+?)\s+credit card at\s+(.+?)\s+on\s+(\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}\s+\d{1,2}:\d{2}SGT)/i,
  );
  if (!m) return null;
  const [, currency, amountStr, cardName, merchant, dateStr] = m;
  return {
    amountCents: parseGenericAmount(amountStr),
    currency: currency.toUpperCase(),
    direction: "debit",
    merchantRaw: cleanMerchant(merchant),
    bank: "Trust",
    accountIdentifier: cardName.trim(),
    occurredAt: parseTrustDate(dateStr),
  };
}

function parsePartialReversal(text: string): ParsedTransaction | null {
  // "We've partially reversed your purchase at Cabcharge Asia Pte Ltd
  //  SINGAPORE SG on 16 Aug 2026 12:45SGT. SGD 0.30 is released to your
  //  Freedom credit card."
  const m = text.match(
    /We[''`]?ve partially reversed your purchase at\s+(.+?)\s+on\s+(\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}\s+\d{1,2}:\d{2}SGT)\.\s*(SGD\s*[\d,]+\.\d+)\s+is released to your\s+([^\n.]+?)\s+card/i,
  );
  if (!m) return null;
  const [, merchant, dateStr, amountStr, cardName] = m;
  return {
    amountCents: parseAmount(amountStr),
    currency: "SGD",
    direction: "credit",
    merchantRaw: cleanMerchant(merchant),
    bank: "Trust",
    accountIdentifier: cardName.trim(),
    occurredAt: parseTrustDate(dateStr),
  };
}

export const trustParser: BankParser = {
  bank: "Trust",
  matchesSender(from: string): boolean {
    return /@trustbank\.sg$/i.test(from.trim()) || /<[^>]*@trustbank\.sg>/i.test(from);
  },
  parse(email: InboundEmail): ParsedTransaction | null {
    const text = bestText(email, stripHtml);
    if (!text) return null;

    return parseSpend(text) ?? parseOverseasSpend(text) ?? parsePartialReversal(text) ?? null;
  },
};
