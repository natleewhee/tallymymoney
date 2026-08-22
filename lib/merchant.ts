// Acquirers confirmed (not guessed) to append a per-transaction reference
// after a literal "*" that carries no merchant signal — every Grab ride
// or Shopee order would otherwise become its own merchant key, which is
// why one-tap confirm rarely fires for the merchants you'd want it to.
// Deliberately a narrow allowlist rather than a blanket "everything
// before *" rule: WEIXIN*<name> is the opposite case — the part after
// the * is the real merchant — so collapsing on * alone would break it.
const REF_INJECTING_PREFIXES = ["GRAB", "SHOPEE"];

/** Collapse whitespace, case-fold, and strip the acquirer noise that
 * otherwise fragments merchant memory. Confirmed necessary by real
 * DBS/Trust samples — acquirer-truncated codes and HTML-derived
 * whitespace runs both need normalising before a merchant string can key
 * merchant_rules consistently. See SPIKE-01-RESULTS.md. */
export function normaliseMerchant(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim().toUpperCase();

  for (const prefix of REF_INJECTING_PREFIXES) {
    if (s.startsWith(`${prefix}*`) || s.startsWith(`${prefix} *`)) {
      s = prefix;
      break;
    }
  }

  // Trailing store number, e.g. "NTUC FAIRPRICE #123" — otherwise every
  // branch visited multiplies the same merchant into a new key.
  s = s.replace(/\s*#\d+$/, "");

  return s;
}
