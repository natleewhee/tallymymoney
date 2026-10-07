// Pure date/threshold logic for the card benefit tracker — no database,
// no Telegram, so tests/benefits.test.ts can cover it directly. The
// DB-touching half lives in lib/cards.ts.
//
// All period boundaries are SGT calendar days (Amex SG's terms are stated
// in Singapore dates). period_end is EXCLUSIVE: SGT midnight after the
// last valid day, so "Jul–Dec" is [1 Jul 00:00 SGT, 1 Jan 00:00 SGT).

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type Cadence = "one_time" | "bimonthly" | "semi_annual" | "annual";
export type ResetAnchor = "calendar" | "cardmember_year";

/** Window for "needs attention soon" on the pinned banner: an open credit
 * or cycle closing, or a challenge deadline, within this many days. Two
 * weeks is enough lead time to book a Table for Two slot or plan a
 * S$300 SIA/Vivino purchase, without the pin listing half the board. */
export const ATTENTION_WINDOW_DAYS = 14;

/** Cron sends a "closing soon" reminder only on these days-left values,
 * not every day inside the window — one heads-up a week out and a last
 * call, no daily noise. The pin covers the in-between. */
export const REMINDER_DAYS_LEFT = [7, 1];

/** Amex counts min-spend by POSTED date, which can lag the purchase by
 * several days. Pace and deadline maths treat the window as ending this
 * many days early so a last-minute purchase doesn't miss. */
export const POSTING_BUFFER_DAYS = 5;

/** Pace-check trigger 1: percent of target spent trails percent of window
 * elapsed by more than this. */
export const PACE_BEHIND_THRESHOLD = 0.15;

/** Pace-check trigger 2: if the required weekly spend to finish exceeds
 * what Nat typically puts on the card in a week, he's behind even if the
 * percentage gap looks fine. CONFIGURABLE GUESS — S$500/week; Nat should
 * set this to his real typical weekly Amex spend. */
export const TYPICAL_WEEKLY_SPEND_CENTS = 50_000;

function sgtParts(d: Date): { y: number; m0: number; day: number } {
  const s = new Date(d.getTime() + SGT_OFFSET_MS);
  return { y: s.getUTCFullYear(), m0: s.getUTCMonth(), day: s.getUTCDate() };
}

/** SGT midnight of (year, month0, day) as a real UTC instant. month0/day
 * may overflow — Date.UTC normalises. */
export function sgtDate(y: number, m0: number, day = 1): Date {
  return new Date(Date.UTC(y, m0, day) - SGT_OFFSET_MS);
}

/** Adds whole calendar months in SGT, clamping the day (31 Aug + 6mo →
 * 28/29 Feb, not 3 Mar). */
export function addMonthsSgt(d: Date, months: number): Date {
  const { y, m0, day } = sgtParts(d);
  const targetLen = new Date(Date.UTC(y, m0 + months + 1, 0)).getUTCDate();
  return sgtDate(y, m0 + months, Math.min(day, targetLen));
}

/** The period containing `asOf` for a benefit's cadence/anchor.
 *  - calendar: semi_annual = Jan–Jun / Jul–Dec, bimonthly = Jan–Feb,
 *    Mar–Apr…, annual = calendar year (all per the 2026 Amex SG terms).
 *  - cardmember_year: anniversary to anniversary of `renewalDate`. With
 *    no renewal date set yet, falls back to calendar (caller flags it).
 *  - one_time: a single open-ended period from `createdAt`, so a
 *    checklist item has exactly one row to mark enrolled. */
export function periodBounds(
  cadence: Cadence,
  anchor: ResetAnchor,
  asOf: Date,
  opts: { renewalDate?: Date | null; createdAt?: Date } = {},
): { start: Date; end: Date } {
  if (cadence === "one_time") {
    const created = opts.createdAt ?? asOf;
    const { y, m0, day } = sgtParts(created);
    return { start: sgtDate(y, m0, day), end: sgtDate(2100, 0, 1) };
  }

  const months = cadence === "bimonthly" ? 2 : cadence === "semi_annual" ? 6 : 12;

  if (anchor === "cardmember_year" && opts.renewalDate) {
    const { y, m0, day } = sgtParts(opts.renewalDate);
    const anchorStart = sgtDate(y, m0, day);
    // Estimate how many whole periods after the anchor asOf falls, then
    // nudge by one either way for day-of-month edge cases.
    const now = sgtParts(asOf);
    let i = Math.floor(((now.y - y) * 12 + (now.m0 - m0)) / months);
    if (addMonthsSgt(anchorStart, months * i).getTime() > asOf.getTime()) i -= 1;
    if (addMonthsSgt(anchorStart, months * (i + 1)).getTime() <= asOf.getTime()) i += 1;
    const start = addMonthsSgt(anchorStart, months * i);
    const next = addMonthsSgt(anchorStart, months * (i + 1));
    return { start, end: next };
  }

  const { y, m0 } = sgtParts(asOf);
  const startM0 = Math.floor(m0 / months) * months;
  return { start: sgtDate(y, startM0), end: sgtDate(y, startM0 + months) };
}

/** Whole days from asOf until `end` (exclusive bound), rounded up — a
 * period ending at tonight's midnight has 1 day left today. */
export function daysLeft(end: Date, asOf: Date): number {
  return Math.ceil((end.getTime() - asOf.getTime()) / DAY_MS);
}

/** "1 Jul–31 Dec" for an exclusive-end period. */
export function fmtPeriod(start: Date, endExclusive: Date): string {
  const f = (d: Date) =>
    new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", day: "numeric", month: "short" }).format(d);
  return `${f(start)}–${f(new Date(endExclusive.getTime() - 1))}`;
}

export function fmtDollars(cents: number): string {
  const v = cents / 100;
  return `$${Number.isInteger(v) ? v.toLocaleString("en-SG") : v.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Ten-cell text bar. Plain Unicode — every bot message is plain text
 * (see notify.ts), so no Markdown-dependent rendering. */
export function progressBar(done: number, target: number, width = 10): string {
  const frac = target > 0 ? Math.max(0, Math.min(1, done / target)) : 0;
  const filled = Math.round(frac * width);
  return "▓".repeat(filled) + "░".repeat(width - filled);
}

export interface PaceResult {
  behind: boolean;
  reason: string | null;
  spentFrac: number;
  elapsedFrac: number;
  requiredWeeklyCents: number;
}

/** Pace check for a min-spend challenge. "Meaningfully behind" means
 * EITHER
 *   (a) % of target spent trails % of (buffered) window elapsed by more
 *       than PACE_BEHIND_THRESHOLD, OR
 *   (b) remaining spend ÷ remaining weeks exceeds TYPICAL_WEEKLY_SPEND_CENTS.
 * The window end is pulled in by POSTING_BUFFER_DAYS (posted-by deadline).
 * Already-met or not-yet-started challenges are never behind. */
export function paceCheck(
  spentCents: number,
  targetCents: number,
  start: Date,
  end: Date,
  asOf: Date,
  typicalWeeklyCents = TYPICAL_WEEKLY_SPEND_CENTS,
): PaceResult {
  const effEnd = end.getTime() - POSTING_BUFFER_DAYS * DAY_MS;
  const total = effEnd - start.getTime();
  const elapsedFrac = total > 0 ? Math.max(0, Math.min(1, (asOf.getTime() - start.getTime()) / total)) : 1;
  const spentFrac = targetCents > 0 ? spentCents / targetCents : 1;
  const remaining = Math.max(0, targetCents - spentCents);
  const weeksLeft = Math.max(1 / 7, (effEnd - asOf.getTime()) / (7 * DAY_MS));
  const requiredWeeklyCents = Math.ceil(remaining / weeksLeft);

  const base = { spentFrac, elapsedFrac, requiredWeeklyCents };
  if (remaining === 0 || asOf.getTime() < start.getTime()) return { behind: false, reason: null, ...base };
  if (elapsedFrac - spentFrac > PACE_BEHIND_THRESHOLD) {
    return {
      behind: true,
      reason: `${Math.round(spentFrac * 100)}% spent vs ${Math.round(elapsedFrac * 100)}% of the window gone`,
      ...base,
    };
  }
  if (requiredWeeklyCents > typicalWeeklyCents) {
    return {
      behind: true,
      reason: `needs ${fmtDollars(requiredWeeklyCents)}/week to finish vs ~${fmtDollars(typicalWeeklyCents)} typical`,
      ...base,
    };
  }
  return { behind: false, reason: null, ...base };
}

export interface SuggestableTx {
  merchantRaw: string | null;
  currency: string;
  sgdAmountCents: number;
}

/** LOW-CONFIDENCE ingest-time match of a transaction to an auto_suggest
 * benefit, by benefit name. Only ever used to OFFER a one-tap "Apply to
 * X?" prompt — never applied automatically. Merchant strings are guesses
 * (no real Amex samples yet), and none of the T&C conditions that need
 * saving the credit, in-app booking, or a participating-restaurant list
 * can be checked from an email.
 *  - Airline Credit: SIA/Scoot merchant, SGD, single txn >= S$300.
 *  - Platinum Wine Credit: Vivino/"Platinum Wine" merchant, SGD, >= S$300.
 *  - Global Dining Credit: any foreign-currency charge >= S$300 equivalent
 *    (overseas dine-in shaped; the merchant name alone can't tell a
 *    restaurant from a hotel, so this one is the noisiest). */
export function matchesBenefitHeuristic(benefitName: string, tx: SuggestableTx): boolean {
  const merchant = (tx.merchantRaw ?? "").toUpperCase();
  const name = benefitName.toLowerCase();
  const bigEnough = tx.sgdAmountCents >= 30_000;
  if (name.includes("airline")) {
    return bigEnough && tx.currency === "SGD" && /SINGAPORE\s*AIR|SINGAPOREAIR|\bSIA\b|SCOOT/.test(merchant);
  }
  if (name.includes("wine")) {
    return bigEnough && tx.currency === "SGD" && /VIVINO|PLATINUM\s*WINE/.test(merchant);
  }
  if (name.includes("dining")) {
    return bigEnough && tx.currency !== "SGD";
  }
  return false;
}

/** Parses a reply like "120", "$120.50", "S$1,200" into cents, or null. */
export function parseAmountCents(text: string): number | null {
  const m = text.trim().match(/^[+]?(?:S?\$)?\s*([\d,]+(?:\.\d{1,2})?)$/i);
  if (!m) return null;
  const cents = Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
  return Number.isFinite(cents) && cents > 0 ? cents : null;
}
