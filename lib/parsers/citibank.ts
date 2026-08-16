// Citibank: single confirmed sender (alerts@citibank.com.sg — the one
// domain guess in STRATEGY.md that turned out correct on the first real
// sample). Structured, colon-aligned key-value text.
//
// The one real sample seen is a FOREIGN-CURRENCY charge (JPY) with no
// SGD figure anywhere — card-network FX posts days later. This parser
// therefore returns whatever currency the email actually states; SGD
// conversion happens in the ingest route via FR-2/FR-22's spot-rate
// step, not here. See SPIKE-01-RESULTS.md.

import type { BankParser, InboundEmail, ParsedTransaction } from "./types";
import { bestText, cleanMerchant } from "./types";
import { stripHtml } from "./html";
import { parseCitiDate } from "./dates";

function parseCardCharge(text: string): ParsedTransaction | null {
  const amtMatch = text.match(/Transaction amount\s*:\s*([A-Z]{3})\s*([\d,]+\.\d+)/i);
  const dateMatch = text.match(/Transaction date\s*:\s*(\d{2}\/\d{2}\/\d{2})/i);
  const timeMatch = text.match(/Transaction time\s*:\s*(\d{2}:\d{2}:\d{2})/i);
  const detailsMatch = text.match(/Transaction\s+details\s*:\s*([^\n]+)/i);
  const acctMatch = text.match(/Account Number\s*:\s*([X\d-]+)/i);
  if (!amtMatch || !dateMatch || !timeMatch) return null;

  const [, currency, amountStr] = amtMatch;
  const amountCents = Math.round(parseFloat(amountStr.replace(/,/g, "")) * 100);
  const last4 = acctMatch ? acctMatch[1].split("-").pop() ?? null : null;

  return {
    amountCents,
    currency: currency.toUpperCase(),
    direction: "debit", // every real sample and the ideation dump agree Citi Alerts of this subject line are charges
    merchantRaw: detailsMatch ? cleanMerchant(detailsMatch[1]) : null,
    bank: "Citibank",
    accountIdentifier: last4,
    occurredAt: parseCitiDate(dateMatch[1], timeMatch[1]),
  };
}

export const citibankParser: BankParser = {
  bank: "Citibank",
  matchesSender(from: string): boolean {
    return /@citibank\.com\.sg$/i.test(from.trim()) || /<[^>]*@citibank\.com\.sg>/i.test(from);
  },
  parse(email: InboundEmail): ParsedTransaction | null {
    const text = bestText(email, stripHtml);
    if (!text) return null;

    return parseCardCharge(text);
  },
};
