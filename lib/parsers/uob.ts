// UOB: single sender (unialerts@uobgroup.com), three prose templates
// confirmed by real samples — card spend, PayNow received, and a
// transaction reversal. Domain guess was correct on the first sample
// (see SPIKE-01-RESULTS.md).

import type { BankParser, InboundEmail, ParsedTransaction } from "./types";
import { bestText, cleanMerchant } from "./types";
import { stripHtml } from "./html";
import { parseUobLongDate, parseUobReversalDate, parseUobShortDate } from "./dates";

function parseAmount(s: string): number {
  const m = s.match(/SGD\s*([\d,]+\.\d+)/i);
  if (!m) throw new Error(`No SGD amount found in: "${s}"`);
  return Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
}

function parseCardSpend(text: string, receivedAt: Date): ParsedTransaction | null {
  // "A transaction of SGD 149.90 was made with your UOB Card ending 0997
  //  on 09/08/26 at TOKU NORI." Merchant is anchored on the trailing
  // ". If unauthorised" marker rather than excluding periods outright —
  // real Singapore company names routinely embed one (e.g. "CRAVE FOODS
  // PTE. LTD.", confirmed 2026-08-19), and the old exclusion silently
  // failed to match the whole email whenever one showed up.
  const m = text.match(
    /A transaction of\s+(SGD\s*[\d,]+\.\d+)\s+was made with your UOB Card ending\s+([A-Za-z0-9]+)\s+on\s+(\d{2}\/\d{2}\/\d{2})\s+at\s+(.+?)\.?\s*(?:If unauthorised|$)/i,
  );
  if (!m) return null;
  const [, amountStr, last4, dateStr, merchant] = m;
  return {
    amountCents: parseAmount(amountStr),
    currency: "SGD",
    direction: "debit",
    merchantRaw: cleanMerchant(merchant),
    bank: "UOB",
    accountIdentifier: last4,
    occurredAt: parseUobShortDate(dateStr, receivedAt),
  };
}

function parsePayNowReceived(text: string): ParsedTransaction | null {
  // "You have received SGD 7.00 in your PayNow-linked account ending 6835
  //  on 11-AUG-2026 01:44PM."
  const m = text.match(
    /You have received\s+(SGD\s*[\d,]+\.\d+)\s+in your PayNow-linked account ending\s+([A-Za-z0-9]+)\s+on\s+(\d{1,2}-[A-Za-z]{3}-\d{4}\s+\d{1,2}:\d{2}(?:AM|PM))/i,
  );
  if (!m) return null;
  const [, amountStr, last4, dateStr] = m;
  return {
    amountCents: parseAmount(amountStr),
    currency: "SGD",
    direction: "credit",
    merchantRaw: null, // genuinely absent in every real sample — confirmed by Nat, not a parse gap
    bank: "UOB",
    accountIdentifier: last4,
    occurredAt: parseUobLongDate(dateStr),
  };
}

/** "A transaction of 0.00 CNY made with your UOB card ending 9515 on 22
 * Aug 26, 1:09PM at Alipay has been reversed." Confirmed real sample:
 * card verification holds (the exact case FR-10 names as an Ignore
 * candidate — a foreign-currency card-link check that settles at zero)
 * come through this template. Recorded as a credit like any other
 * reversal/refund (FR-21's "anything that isn't a clean new expense")
 * rather than special-cased on amount === 0 — a non-zero reversal is the
 * same shape and deserves the same treatment, and Nat already has
 * Ignore/Reduce to route either case from the normal tagging flow. Unlike
 * card spend, currency isn't pinned to SGD — stated directly in the text,
 * same as Citibank's foreign-currency sample. */
function parseCardReversal(text: string): ParsedTransaction | null {
  const m = text.match(
    /A transaction of\s+([\d,]+\.\d+)\s+([A-Z]{3})\s+made with your UOB card ending\s+([A-Za-z0-9]+)\s+on\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{2},\s+\d{1,2}:\d{2}(?:AM|PM))\s+at\s+(.+?)\s+has been reversed\.?/i,
  );
  if (!m) return null;
  const [, amountStr, currency, last4, dateStr, merchant] = m;
  return {
    amountCents: Math.round(parseFloat(amountStr.replace(/,/g, "")) * 100),
    currency: currency.toUpperCase(),
    direction: "credit",
    merchantRaw: cleanMerchant(merchant),
    bank: "UOB",
    accountIdentifier: last4,
    occurredAt: parseUobReversalDate(dateStr),
  };
}

export const uobParser: BankParser = {
  bank: "UOB",
  matchesSender(from: string): boolean {
    return /@uobgroup\.com$/i.test(from.trim()) || /<[^>]*@uobgroup\.com>/i.test(from);
  },
  parse(email: InboundEmail): ParsedTransaction | null {
    const text = bestText(email, stripHtml);
    if (!text) return null;

    return parseCardSpend(text, email.receivedAt) ?? parsePayNowReceived(text) ?? parseCardReversal(text) ?? null;
  },
};
