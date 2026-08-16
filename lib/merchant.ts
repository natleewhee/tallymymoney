/** Collapse whitespace, case-fold. Confirmed necessary by real DBS/Trust
 * samples — acquirer-truncated codes and HTML-derived whitespace runs
 * both need normalising before a merchant string can key merchant_rules
 * consistently. See SPIKE-01-RESULTS.md. */
export function normaliseMerchant(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().toUpperCase();
}
