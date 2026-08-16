// DBS is the most-sampled bank (4 sub-types, 2 sending addresses) and the
// one place a guessed sender domain turned out wrong (dbs.com.sg guessed,
// dbs.com confirmed) — see SPIKE-01-RESULTS.md. Every regex below is
// built directly against the real samples in spike-01-samples/03, 04, 07,
// 08, not invented.
//
// Two shapes observed:
//   (a) "Date & Time: / Amount: / From: / To:" table — PayLah spend,
//       card spend, PayNow sent (samples 03, 04, 08)
//   (b) inline "You have received SGD X via PayNow on <date> SGT." with
//       From:/To: lines below, no table — PayNow received (sample 07)
//
// Direction/merchant/account are inferred from which of From:/To: names
// an instrument Nat owns ("card ending", "Wallet", "Account ... ending").
// That heuristic is confirmed against all four real samples, not a guess
// about a fifth case we haven't seen.

import type { BankParser, InboundEmail, ParsedTransaction } from "./types";
import { bestText, cleanMerchant } from "./types";
import { stripHtml } from "./html";
import { parseDbsTableDate } from "./dates";

const OWN_INSTRUMENT = /(card ending|wallet|account.*ending|a\/c.*ending)/i;

function extractEnding(s: string): string | null {
  const m = s.match(/ending\s+([A-Za-z0-9]+)/i);
  return m ? m[1] : null;
}

function parseAmount(s: string): number {
  const m = s.match(/SGD\s*([\d,]+\.\d+)/i);
  if (!m) throw new Error(`No SGD amount found in: "${s}"`);
  return Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
}

function parseTableShape(text: string, receivedAt: Date): ParsedTransaction | null {
  const dtMatch = text.match(/Date\s*&\s*Time:\s*([^\n(]+?)\s*\(SGT\)/i);
  const amtMatch = text.match(/Amount:\s*(SGD\s*[\d,]+\.\d+)/i);
  const fromMatch = text.match(/From:\s*([^\n]+)/i);
  const toMatch = text.match(/To:\s*([^\n]+)/i);
  if (!dtMatch || !amtMatch || !fromMatch || !toMatch) return null;

  const fromValue = fromMatch[1].trim();
  const toValue = toMatch[1].trim();
  const occurredAt = parseDbsTableDate(dtMatch[1], receivedAt);
  const amountCents = parseAmount(amtMatch[1]);

  const toIsOwnAccount = OWN_INSTRUMENT.test(toValue) && /your/i.test(toValue);
  if (toIsOwnAccount && !OWN_INSTRUMENT.test(fromValue)) {
    // Money arriving into an account of Nat's — credit.
    return {
      amountCents,
      currency: "SGD",
      direction: "credit",
      merchantRaw: cleanMerchant(fromValue),
      bank: "DBS",
      accountIdentifier: extractEnding(toValue),
      occurredAt,
    };
  }

  // Default: money leaving an instrument of Nat's — debit. True for
  // PayLah spend, card spend, and PayNow sent in every real sample seen.
  return {
    amountCents,
    currency: "SGD",
    direction: "debit",
    merchantRaw: cleanMerchant(toValue),
    bank: "DBS",
    accountIdentifier: extractEnding(fromValue),
    occurredAt,
  };
}

function parseInlineReceivedShape(text: string, receivedAt: Date): ParsedTransaction | null {
  // "You have received SGD 200.00 via PayNow on 11 Aug 2026 17:17 SGT."
  const m = text.match(
    /You have received\s+(SGD\s*[\d,]+\.\d+)\s+via PayNow on\s+\d{1,2}\s+[A-Za-z]{3,}\s+(\d{4})\s+(\d{1,2}:\d{2})\s*SGT/i,
  );
  if (!m) return null;
  const amountCents = parseAmount(m[1]);

  const fromMatch = text.match(/From:\s*([^\n]+)/i);
  const toMatch = text.match(/To:\s*([^\n]+)/i);

  // The date in this shape includes the year already, unlike the table
  // shape — reuse parseDbsTableDate by stripping the year back out, since
  // it already handles "D MMM HH:mm" with a reference-year fallback and
  // the year here is explicit anyway.
  const dateMatch = text.match(/on\s+(\d{1,2}\s+[A-Za-z]{3,})\s+(\d{4})\s+(\d{1,2}:\d{2})\s*SGT/i);
  if (!dateMatch) return null;
  const [, dayMonth, yearStr, time] = dateMatch;
  const occurredAt = parseDbsTableDate(`${dayMonth} ${time}`, new Date(Date.UTC(Number(yearStr), 0, 1)));

  return {
    amountCents,
    currency: "SGD",
    direction: "credit",
    merchantRaw: fromMatch ? cleanMerchant(fromMatch[1]) : null,
    bank: "DBS",
    accountIdentifier: toMatch ? extractEnding(toMatch[1]) : null,
    occurredAt,
  };
}

export const dbsParser: BankParser = {
  bank: "DBS",
  matchesSender(from: string): boolean {
    return /@dbs\.com$/i.test(from.trim()) || /<[^>]*@dbs\.com>/i.test(from);
  },
  parse(email: InboundEmail): ParsedTransaction | null {
    const text = bestText(email, stripHtml);
    if (!text) return null;

    const inline = parseInlineReceivedShape(text, email.receivedAt);
    if (inline) return inline;

    const table = parseTableShape(text, email.receivedAt);
    if (table) return table;

    return null; // recognised sender, unrecognised shape -> FR-4 triage
  },
};
