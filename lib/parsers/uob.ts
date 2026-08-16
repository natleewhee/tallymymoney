// UOB: single sender (unialerts@uobgroup.com), two prose templates
// confirmed by real samples — card spend and PayNow received. Domain
// guess was correct on the first sample (see SPIKE-01-RESULTS.md).

import type { BankParser, InboundEmail, ParsedTransaction } from "./types";
import { bestText, cleanMerchant } from "./types";
import { stripHtml } from "./html";
import { parseUobLongDate, parseUobShortDate } from "./dates";

function parseAmount(s: string): number {
  const m = s.match(/SGD\s*([\d,]+\.\d+)/i);
  if (!m) throw new Error(`No SGD amount found in: "${s}"`);
  return Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
}

function parseCardSpend(text: string): ParsedTransaction | null {
  // "A transaction of SGD 149.90 was made with your UOB Card ending 0997
  //  on 09/08/26 at TOKU NORI."
  const m = text.match(
    /A transaction of\s+(SGD\s*[\d,]+\.\d+)\s+was made with your UOB Card ending\s+([A-Za-z0-9]+)\s+on\s+(\d{2}\/\d{2}\/\d{2})\s+at\s+([^\n.]+?)\.?\s*(?:If unauthorised|$)/i,
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
    occurredAt: parseUobShortDate(dateStr),
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

export const uobParser: BankParser = {
  bank: "UOB",
  matchesSender(from: string): boolean {
    return /@uobgroup\.com$/i.test(from.trim()) || /<[^>]*@uobgroup\.com>/i.test(from);
  },
  parse(email: InboundEmail): ParsedTransaction | null {
    const text = bestText(email, stripHtml);
    if (!text) return null;

    return parseCardSpend(text) ?? parsePayNowReceived(text) ?? null;
  },
};
