import type { BankParser, InboundEmail, ParsedTransaction } from "./types";
import { dbsParser } from "./dbs";
import { uobParser } from "./uob";
import { trustParser } from "./trust";
import { citibankParser } from "./citibank";

// Amex isn't here — no sample has ever been seen from it (SPIKE-01-RESULTS.md).
// An email from an unrecognised sender falls through to FR-4 triage in
// /api/ingest, same as a recognised sender whose shape doesn't match.
export const parsers: BankParser[] = [dbsParser, uobParser, trustParser, citibankParser];

export interface DispatchResult {
  bank: string | null;
  transaction: ParsedTransaction | null;
}

/** Finds the bank by sender, then tries to parse. Distinguishes "no bank
 * recognised this sender at all" (bank: null) from "a bank recognised
 * the sender but the shape is new" (bank set, transaction: null) —
 * both are FR-4 triage cases, but the distinction is useful for
 * unclassified_emails.note. */
export function dispatch(email: InboundEmail): DispatchResult {
  for (const parser of parsers) {
    if (parser.matchesSender(email.from)) {
      // The amount and date helpers throw on an unrecognised shape rather
      // than returning null. Uncaught, that propagates out of /api/ingest
      // as a 500: Apps Script then never labels the thread, retries it
      // forever, and no triage notification is ever sent — the email
      // silently disappears. A throw means exactly what a null means
      // here (this parser can't read this email), so treat it that way
      // and let FR-4 triage do its job.
      try {
        return { bank: parser.bank, transaction: parser.parse(email) };
      } catch (err) {
        console.error(`${parser.bank} parser threw, routing to triage`, err);
        return { bank: parser.bank, transaction: null };
      }
    }
  }
  return { bank: null, transaction: null };
}

export type { BankParser, InboundEmail, ParsedTransaction };
