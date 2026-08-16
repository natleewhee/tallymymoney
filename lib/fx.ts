// FR-2/FR-22: spot-rate conversion at ingest, clearly flagged as an
// estimate, amendable once Nat checks the real posted statement amount.
// Frankfurter (ECB reference rates) — free, no API key. See
// ARCHITECTURE.md §5 and SPIKE-01-RESULTS.md for why this exists at all
// (a real Citibank sample had no SGD figure whatsoever).

import { desc, eq, and, isNotNull } from "drizzle-orm";
import { db } from "./db";
import { transactions } from "./schema";

export interface FxResult {
  sgdAmountCents: number;
  fxRate: number;
  fxSource: "spot_estimate";
}

async function fetchSpotRate(currency: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.frankfurter.app/latest?from=${encodeURIComponent(currency)}&to=SGD`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { rates?: Record<string, number> };
    return data.rates?.SGD ?? null;
  } catch {
    return null; // network error, timeout, unsupported currency — fall through
  }
}

/** A stale rate beats no transaction at all — the estimate is getting
 * corrected via FR-22 regardless, so "wrong by a few percent" and
 * "missing" aren't meaningfully different outcomes here. */
async function fallbackCachedRate(currency: string): Promise<number | null> {
  const [row] = await db
    .select({ fxRate: transactions.fxRate })
    .from(transactions)
    .where(and(eq(transactions.currency, currency), isNotNull(transactions.fxRate)))
    .orderBy(desc(transactions.occurredAt))
    .limit(1);
  return row?.fxRate ? Number(row.fxRate) : null;
}

/** Converts a foreign-currency amount to an estimated SGD figure.
 * Returns null only if there is truly no rate available anywhere —
 * live lookup failed AND no prior transaction in this currency exists to
 * borrow a rate from. Callers should treat that as "flag for later,
 * don't block ingestion." */
export async function convertToSgd(currency: string, amountCents: number): Promise<FxResult | null> {
  const rate = (await fetchSpotRate(currency)) ?? (await fallbackCachedRate(currency));
  if (rate === null) return null;
  return {
    sgdAmountCents: Math.round(amountCents * rate),
    fxRate: rate,
    fxSource: "spot_estimate",
  };
}
