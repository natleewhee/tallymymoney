// ============================================================================
// UNVERIFIED PARSER — NO REAL AMEX SAMPLE HAS EVER BEEN SEEN.
//
// Every other parser in this directory was calibrated against a real
// forwarded email (docs/spike-01-samples/). This one was written blind,
// from the commonly-reported shape of American Express Singapore's
// transaction alert:
//
//   "A new transaction of SGD 123.45 was made on your Card ending 12345
//    at MERCHANT NAME on 05 Oct 2026."
//
// The first time a real Amex alert fails to parse it will land in FR-4/R3
// triage as "COULDN'T READ THIS ONE" (bank: Amex). When that happens,
// recalibrate using the same workflow as the DBS/UOB real-sample fixes:
//   1. Tap "Needs parser", forward the email, save it as a new numbered
//      fixture in docs/spike-01-samples/ (replacing
//      15-amex-TEMPLATE-needs-real-sample.txt as the reference).
//   2. Fix the regex(es) below to the real wording; add a test against
//      the real fixture in tests/parsers.test.ts.
//   3. /pending → "Retry stuck emails" to recover anything that queued.
// See docs/LESSONS.md and docs/solutions/logic-errors/ for why "looks
// right" regexes need a real sample before they're trusted.
// ============================================================================

import type { BankParser, InboundEmail, ParsedTransaction } from "./types";
import { bestText, cleanMerchant } from "./types";
import { stripHtml } from "./html";
import { parseAmexDate } from "./dates";

/** The assumed card-spend template. Deliberately loose where the real
 * wording is least certain:
 *  - "new " optional, "on/with your Card" both accepted — wording varies
 *    between issuers' reported samples and we can't check which Amex SG
 *    uses.
 *  - Card ending is 4-5 alphanumerics: Amex numbers are 15 digits and
 *    Amex itself usually quotes the last 5, unlike Visa/Mastercard's 4.
 *  - Currency captured, not pinned to SGD — the Global Dining Credit is
 *    for overseas dining, so foreign-currency charges are expected; FX
 *    conversion happens downstream in /api/ingest like every other bank.
 *  - All gaps are \s+ rather than literal spaces: real UOB/Trust samples
 *    line-wrapped mid-sentence, and "." can't cross a newline (see
 *    docs/solutions/logic-errors/). Merchant uses [\s\S]+? for the same
 *    reason, anchored on the trailing " on <date>". */
function parseCardSpend(text: string, receivedAt: Date): ParsedTransaction | null {
  const m = text.match(
    /A\s+(?:new\s+)?(?:charge|transaction)\s+of\s+([A-Z]{3})\s*([\d,]+(?:\.\d{1,2})?)\s+(?:was|has\s+been)\s+(?:made|charged)\s+(?:on|with|to)\s+your\s+(?:American\s+Express\s+)?(?:Platinum\s+)?Card\s+ending(?:\s+in)?\s+([A-Za-z0-9]{4,5})\s+at\s+([\s\S]+?)\s+on\s+(\d{1,2}\s+[A-Za-z]{3,}\s+\d{4})/i,
  );
  if (!m) return null;
  const [, currency, amountStr, last4, merchant, dateStr] = m;
  return {
    amountCents: Math.round(parseFloat(amountStr.replace(/,/g, "")) * 100),
    currency: currency.toUpperCase(),
    direction: "debit",
    merchantRaw: cleanMerchant(merchant),
    bank: "Amex",
    accountIdentifier: last4,
    occurredAt: parseAmexDate(dateStr, receivedAt),
  };
}

export const amexParser: BankParser = {
  bank: "Amex",
  /** americanexpress.com and its subdomains (e.g.
   * email.americanexpress.com) — the exact alert sender is unconfirmed,
   * so match the domain rather than a specific mailbox. aexp.com is
   * Amex's other sending domain. */
  matchesSender(from: string): boolean {
    return /[@.](?:americanexpress|aexp)\.com\b/i.test(from);
  },
  parse(email: InboundEmail): ParsedTransaction | null {
    const text = bestText(email, stripHtml);
    if (!text) return null;
    // Some issuers put the whole alert sentence in the subject only, with
    // a marketing-heavy body. Try the body first, then the subject.
    return parseCardSpend(text, email.receivedAt) ?? parseCardSpend(email.subject, email.receivedAt) ?? null;
  },
};
