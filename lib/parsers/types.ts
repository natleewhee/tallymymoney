export interface InboundEmail {
  from: string;
  subject: string;
  textBody: string; // may be empty — some real DBS samples are HTML-only
  htmlBody: string; // may be empty — plain-text-only mail
  /** The email's own Date header — used to disambiguate dates that omit
   * a year (DBS table shape), never to itself become occurredAt when a
   * real transaction date is present in the body. */
  receivedAt: Date;
}

export interface ParsedTransaction {
  amountCents: number;
  currency: string; // ISO 4217, e.g. 'SGD', 'JPY'
  direction: "debit" | "credit";
  merchantRaw: string | null;
  bank: string;
  accountIdentifier: string | null;
  occurredAt: Date;
}

export interface BankParser {
  bank: string;
  /** Does this parser's bank own this sender address? Checked before parse(). */
  matchesSender(from: string): boolean;
  /**
   * Try to extract a transaction. Return null if this email is
   * recognisably from this bank but isn't a transaction shape this
   * parser knows — the caller treats that the same as "no parser
   * matched" and routes to unclassified_emails (FR-4).
   */
  parse(email: InboundEmail): ParsedTransaction | null;
}

/** Prefer the plain-text body; fall back to a stripped HTML body. Two of
 * the nine real samples (DBS, via Amazon SES) had no plain-text part at
 * all — see SPIKE-01-RESULTS.md. */
export function bestText(email: InboundEmail, stripHtml: (html: string) => string): string {
  if (email.textBody.trim()) return email.textBody;
  if (email.htmlBody.trim()) return stripHtml(email.htmlBody);
  return "";
}

/** Collapses the irregular whitespace runs seen in HTML-derived merchant
 * strings (e.g. Trust: "Cabcharge Asia Pte Ltd   SINGAPORE    SG") into
 * single spaces. Confirmed necessary by real samples, not speculative. */
export function cleanMerchant(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}
