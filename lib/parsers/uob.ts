// UOB: single sender (unialerts@uobgroup.com), three prose templates
// confirmed by real samples — card spend, PayNow received, and a
// transaction reversal. Domain guess was correct on the first sample
// (see SPIKE-01-RESULTS.md).

import type { BankParser, InboundEmail, ParsedTransaction } from "./types";
import { bestText, cleanMerchant } from "./types";
import { stripHtml } from "./html";
import { parseUobGiroDate, parseUobLongDate, parseUobRefundDate, parseUobReversalDate, parseUobShortDate } from "./dates";

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
  //
  // Currency is captured rather than pinned to SGD — confirmed real
  // sample: a foreign-currency card charge ("A transaction of CNY
  // 2,138.00 was made...") uses this exact template, just with a
  // non-SGD currency. FX conversion happens downstream in /api/ingest
  // (FR-2), same as every other foreign-currency parser here.
  const m = text.match(
    /A transaction of\s+([A-Z]{3})\s*([\d,]+\.\d+)\s+was made with your UOB Card ending\s+([A-Za-z0-9]+)\s+on\s+(\d{2}\/\d{2}\/\d{2})\s+at\s+(.+?)\.?\s*(?:If unauthorised|$)/i,
  );
  if (!m) return null;
  const [, currency, amountStr, last4, dateStr, merchant] = m;
  return {
    amountCents: Math.round(parseFloat(amountStr.replace(/,/g, "")) * 100),
    currency: currency.toUpperCase(),
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

/** "A refund of SGD416.76 from Klook Travel has been made to your UOB
 * card ending 0997 on 11 Aug 2026. The refund will be posted in your
 * next statement." Confirmed real sample — distinct from parseCardReversal:
 * a merchant-initiated refund posted to the statement, not an immediate
 * transaction reversal, and worded (and dated) differently. Currency
 * pinned to SGD, same as card spend — no foreign-currency refund sample
 * seen yet. */
function parseRefund(text: string, receivedAt: Date): ParsedTransaction | null {
  const m = text.match(
    /A refund of\s+(SGD\s*[\d,]+\.\d+)\s+from\s+(.+?)\s+has been made to your UOB card ending\s+([A-Za-z0-9]+)\s+on\s+(\d{1,2}\s+[A-Za-z]{3,}\s+\d{4})\.?/i,
  );
  if (!m) return null;
  const [, amountStr, merchant, last4, dateStr] = m;
  return {
    amountCents: parseAmount(amountStr),
    currency: "SGD",
    direction: "credit",
    merchantRaw: cleanMerchant(merchant),
    bank: "UOB",
    accountIdentifier: last4,
    occurredAt: parseUobRefundDate(dateStr, receivedAt),
  };
}

/** "A transaction of SGD552.06 was debited from your a/c XXXXXX6835 at
 * 06:54PM 7-Sep-2026, SGT. Ref: Inward DR - GIRO, IRAS, TAXS S9200902E,
 * Income Tax." A bank-account GIRO/direct-debit alert — distinct from
 * every other template here, which are all card alerts. UOB also alerts
 * on the linked deposit account itself, not just the card. The "Ref:"
 * field carries whatever description the counterparty's own reference
 * supplies (here, IRAS's reference for an income tax payment) and
 * becomes merchantRaw as-is — there's no separate merchant-name field to
 * extract it from. Only "debited" is confirmed by a real sample; a
 * symmetric "credited" (e.g. an inward GIRO payment) isn't handled here
 * since no such sample has been seen yet. */
function parseGiroDebit(text: string): ParsedTransaction | null {
  // Ref capture uses [\s\S] rather than "." — the real sample line-wraps
  // mid-reference ("S9200902E,\nIncome Tax."), which "." can't cross
  // since it never matches a newline (same class of bug fixed in
  // lib/parsers/trust.ts; see docs/solutions/logic-errors/).
  const m = text.match(
    /A transaction of\s+SGD\s*([\d,]+\.\d+)\s+was debited from your a\/c\s+([A-Za-z0-9]+)\s+at\s+(\d{1,2}:\d{2}(?:AM|PM))\s+(\d{1,2}-[A-Za-z]{3}-\d{4}),\s*SGT\.\s*Ref:\s*([\s\S]+?)\.?\s*(?:If unauthorised|$)/i,
  );
  if (!m) return null;
  const [, amountStr, account, timeStr, dateStr, ref] = m;
  return {
    amountCents: Math.round(parseFloat(amountStr.replace(/,/g, "")) * 100),
    currency: "SGD",
    direction: "debit",
    merchantRaw: cleanMerchant(ref),
    bank: "UOB",
    accountIdentifier: account.replace(/^X+/i, ""),
    occurredAt: parseUobGiroDate(timeStr, dateStr),
  };
}

/** "Your accumulated transit transactions of SGD 1.86 has been billed to
 * your UOB card ending 4859 on 30/08/26." EZ-Link/SimplyGo fares
 * accumulate over a period and bill as one lump sum rather than per-ride
 * — confirmed real sample. No merchant name is ever given, same as
 * PayNow-received (not a parse gap); date-only, same borrowed-time
 * treatment as parseCardSpend since the bank vouches only for the day. */
function parseTransitBilling(text: string, receivedAt: Date): ParsedTransaction | null {
  // "billed to your\nUOB card" — the real sample line-wraps between
  // "your" and "UOB", so that gap needs \s+ too, not a literal space
  // (same class of bug as the GIRO parser's Ref field above).
  const m = text.match(
    /Your accumulated transit transactions of\s+SGD\s*([\d,]+\.\d+)\s+has been billed to your\s+UOB card ending\s+([A-Za-z0-9]+)\s+on\s+(\d{2}\/\d{2}\/\d{2})\.?/i,
  );
  if (!m) return null;
  const [, amountStr, last4, dateStr] = m;
  return {
    amountCents: Math.round(parseFloat(amountStr.replace(/,/g, "")) * 100),
    currency: "SGD",
    direction: "debit",
    merchantRaw: null,
    bank: "UOB",
    accountIdentifier: last4,
    occurredAt: parseUobShortDate(dateStr, receivedAt),
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

    return (
      parseCardSpend(text, email.receivedAt) ??
      parsePayNowReceived(text) ??
      parseCardReversal(text) ??
      parseRefund(text, email.receivedAt) ??
      parseGiroDebit(text) ??
      parseTransitBilling(text, email.receivedAt) ??
      null
    );
  },
};
