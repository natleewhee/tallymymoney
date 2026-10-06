import type { BankParser, InboundEmail, ParsedTransaction } from "./types";
import { dbsParser } from "./dbs";
import { uobParser } from "./uob";
import { trustParser } from "./trust";
import { citibankParser } from "./citibank";
import { amexParser } from "./amex";

// Amex-only pivot (2026-10): only the Amex Platinum Charge is tracked now,
// both to stay within hosting/DB quota and because the bot is a card
// benefit tracker rather than a general spend tracker. The Gmail-side
// forwarding filter is narrowed separately in Apps Script; this list is
// the app-side guarantee that nothing else becomes a transaction even if
// a non-Amex email still arrives (it falls through to FR-4 triage, where
// "Ignore this type" silences it for good).
export const parsers: BankParser[] = [amexParser];

/** DORMANT — not dispatched. Kept as working reference code (and still
 * covered by tests/parsers.test.ts via dispatchWith) in case a bank is
 * ever brought back; deleting them was out of scope for the pivot. */
export const legacyParsers: BankParser[] = [dbsParser, uobParser, trustParser, citibankParser];

export interface DispatchResult {
  bank: string | null;
  transaction: ParsedTransaction | null;
  /** Set when parse() found no transaction but the parser's optional
   * parseNotice() recognised the shape anyway — a declined attempt, a
   * card-verification failure, anything real but with no money that
   * ever moved. Nothing belongs in the ledger for it, but Nat should
   * still hear about it immediately rather than it being filed as
   * FR-4/R3 triage (which would misleadingly ask him to forward it on
   * "so a parser can be built" for a shape that's already understood and
   * will never become a transaction). */
  notice: string | null;
}

/** Finds the bank by sender, then tries to parse. Distinguishes "no bank
 * recognised this sender at all" (bank: null) from "a bank recognised
 * the sender but the shape is new" (bank set, transaction: null) —
 * both are FR-4 triage cases, but the distinction is useful for
 * unclassified_emails.note. */
export function dispatch(email: InboundEmail): DispatchResult {
  return dispatchWith(parsers, email);
}

/** dispatch() against an explicit parser list — lets the dormant
 * legacyParsers keep their regression tests without being live. */
export function dispatchWith(list: BankParser[], email: InboundEmail): DispatchResult {
  for (const parser of list) {
    if (parser.matchesSender(email.from)) {
      // The amount and date helpers throw on an unrecognised shape rather
      // than returning null. Uncaught, that propagates out of /api/ingest
      // as a 500: Apps Script then never labels the thread, retries it
      // forever, and no triage notification is ever sent — the email
      // silently disappears. A throw means exactly what a null means
      // here (this parser can't read this email), so treat it that way
      // and let FR-4 triage do its job.
      try {
        const transaction = parser.parse(email);
        if (transaction) return { bank: parser.bank, transaction, notice: null };
        const notice = parser.parseNotice?.(email) ?? null;
        return { bank: parser.bank, transaction: null, notice };
      } catch (err) {
        console.error(`${parser.bank} parser threw, routing to triage`, err);
        return { bank: parser.bank, transaction: null, notice: null };
      }
    }
  }
  return { bank: null, transaction: null, notice: null };
}

export type { BankParser, InboundEmail, ParsedTransaction };
