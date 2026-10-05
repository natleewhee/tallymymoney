// Card benefit tracker — the database half. Pure date/threshold maths is
// in lib/benefit-logic.ts; Telegram rendering is in lib/telegram/benefits.ts.
//
// Two design rules from the pivot discussion, enforced here:
//  1. benefit_periods are created CHECK-ON-READ (ensureCurrentBenefitPeriod),
//     not by a cron. Anything that looks at a benefit calls it first, so
//     the current period always exists when it matters. The daily cron
//     calls it too, but only so reminders have something to look at.
//  2. Challenge progress is DERIVED from `transactions` every time — there
//     is no card_challenge_id column. Spend counts normally AND toward any
//     challenge whose window it falls in.

import { and, asc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { db } from "./db";
import {
  appSettings,
  benefitPeriods,
  cardBenefits,
  cardChallengeAdjustments,
  cardChallenges,
  cards,
  transactions,
  type BenefitPeriod,
  type Card,
  type CardBenefit,
  type CardChallenge,
} from "./schema";
import { periodBounds, type Cadence, type ResetAnchor } from "./benefit-logic";

export async function getPrimaryCard(): Promise<Card | undefined> {
  const [card] = await db.select().from(cards).orderBy(asc(cards.id)).limit(1);
  return card;
}

/** Creates the period containing `asOf` if it doesn't exist yet, and marks
 * any earlier period that has fully elapsed while still 'open' as
 * 'expired'. Expired periods are never deleted or reset — a missed credit
 * should stay visible as history, not silently vanish. 'partial' periods
 * keep their status when they elapse (the used amount is the record). */
export async function ensureCurrentBenefitPeriod(benefitId: number, asOf: Date = new Date()): Promise<BenefitPeriod> {
  const [benefit] = await db.select().from(cardBenefits).where(eq(cardBenefits.id, benefitId));
  if (!benefit) throw new Error(`Benefit ${benefitId} not found`);
  const [card] = await db.select().from(cards).where(eq(cards.id, benefit.cardId));

  await db
    .update(benefitPeriods)
    .set({ status: "expired" })
    .where(
      and(eq(benefitPeriods.benefitId, benefitId), eq(benefitPeriods.status, "open"), lte(benefitPeriods.periodEnd, asOf)),
    );

  const { start, end } = periodBounds(benefit.cadence as Cadence, benefit.resetAnchor as ResetAnchor, asOf, {
    renewalDate: card?.renewalDate ?? null,
    createdAt: benefit.createdAt,
  });

  const find = async () =>
    (
      await db
        .select()
        .from(benefitPeriods)
        .where(and(eq(benefitPeriods.benefitId, benefitId), eq(benefitPeriods.periodStart, start)))
    )[0];

  const existing = await find();
  if (existing) return existing;

  // idx_benefit_period_unique makes a concurrent duplicate insert a no-op
  // (two webhook deliveries checking at once); re-read either way.
  await db
    .insert(benefitPeriods)
    .values({ benefitId, periodStart: start, periodEnd: end })
    .onConflictDoNothing();
  const created = await find();
  if (!created) throw new Error(`Could not create period for benefit ${benefitId}`);
  return created;
}

export interface BenefitWithPeriod {
  benefit: CardBenefit;
  period: BenefitPeriod;
}

export async function listBenefitsWithCurrentPeriods(asOf: Date = new Date()): Promise<BenefitWithPeriod[]> {
  const benefits = await db.select().from(cardBenefits).orderBy(asc(cardBenefits.id));
  const out: BenefitWithPeriod[] = [];
  for (const benefit of benefits) {
    out.push({ benefit, period: await ensureCurrentBenefitPeriod(benefit.id, asOf) });
  }
  return out;
}

/** Qualifying spend on the card between [start, end): debits minus
 * credits (a refund un-qualifies its purchase), excluding ignored rows,
 * rows flagged excluded_from_qualifying_spend (annual fee, cash advance),
 * and placeholder-FX rows whose SGD figure is a 1:1 guess. Scoped to
 * the card's last-4 once Nat has set it; until then, every Amex row. */
export async function qualifyingSpendCents(card: Card | undefined, start: Date, end: Date): Promise<number> {
  const conds = [
    eq(transactions.bank, "Amex"),
    gte(transactions.occurredAt, start),
    lt(transactions.occurredAt, end),
    sql`${transactions.status} != 'ignored'`,
    sql`coalesce(${transactions.excludedFromQualifyingSpend}, false) = false`,
    sql`${transactions.fxSource} != 'placeholder'`,
  ];
  if (card?.accountLast4) conds.push(eq(transactions.accountIdentifier, card.accountLast4));
  const [{ total }] = await db
    .select({
      total: sql<number>`coalesce(sum(case when ${transactions.direction} = 'debit' then ${transactions.sgdAmountCents} else -${transactions.sgdAmountCents} end), 0)::bigint`,
    })
    .from(transactions)
    .where(and(...conds));
  return Number(total);
}

export interface ChallengeProgress {
  challenge: CardChallenge;
  spentCents: number;
  adjustmentCents: number;
  /** spent + adjustments — what the board shows and the target is checked against. */
  totalCents: number;
  configured: boolean;
  met: boolean;
}

export async function challengeProgress(challenge: CardChallenge, card?: Card): Promise<ChallengeProgress> {
  const theCard = card ?? (await db.select().from(cards).where(eq(cards.id, challenge.cardId)))[0];
  const [{ adj }] = await db
    .select({ adj: sql<number>`coalesce(sum(${cardChallengeAdjustments.amountCents}), 0)::bigint` })
    .from(cardChallengeAdjustments)
    .where(eq(cardChallengeAdjustments.challengeId, challenge.id));
  const adjustmentCents = Number(adj);

  if (!challenge.periodStart || !challenge.periodEnd) {
    return { challenge, spentCents: 0, adjustmentCents, totalCents: adjustmentCents, configured: false, met: !!challenge.metAt };
  }
  const spentCents = await qualifyingSpendCents(theCard, challenge.periodStart, challenge.periodEnd);
  const totalCents = spentCents + adjustmentCents;
  const reached = challenge.targetSpendCents !== null && totalCents >= challenge.targetSpendCents;

  // Record the first time the target is reached. Never cleared
  // automatically — a later refund might dip the derived total, but
  // whether Amex still honours the bonus is Nat's call, not ours.
  if (reached && !challenge.metAt) {
    await db.update(cardChallenges).set({ metAt: new Date() }).where(eq(cardChallenges.id, challenge.id));
  }
  return { challenge, spentCents, adjustmentCents, totalCents, configured: true, met: reached || !!challenge.metAt };
}

export async function listChallengeProgress(): Promise<ChallengeProgress[]> {
  const card = await getPrimaryCard();
  const rows = await db.select().from(cardChallenges).orderBy(asc(cardChallenges.id));
  const out: ChallengeProgress[] = [];
  for (const c of rows) out.push(await challengeProgress(c, card));
  return out;
}

export async function addChallengeAdjustment(challengeId: number, amountCents: number, note: string | null): Promise<void> {
  await db.insert(cardChallengeAdjustments).values({ challengeId, amountCents, note });
}

export async function markChallengeMet(challengeId: number): Promise<CardChallenge | undefined> {
  const [row] = await db
    .update(cardChallenges)
    .set({ metAt: new Date() })
    .where(eq(cardChallenges.id, challengeId))
    .returning();
  return row;
}

/** Records usage against a period.
 *  - amountCents given and the benefit has a dollar value: adds to
 *    used_cents; 'used' once the full value is reached, else 'partial'.
 *  - manual_running_total benefits: adds to used_cents as a running
 *    total; status stays 'open' (there's no "used up" for spend tiers).
 *  - otherwise (checklist, cycle experience, or "mark fully used"):
 *    marks 'used' outright. */
export async function recordPeriodUsage(
  periodId: number,
  amountCents: number | null,
  note: string | null = null,
): Promise<{ period: BenefitPeriod; benefit: CardBenefit } | null> {
  const [period] = await db.select().from(benefitPeriods).where(eq(benefitPeriods.id, periodId));
  if (!period) return null;
  const [benefit] = await db.select().from(cardBenefits).where(eq(cardBenefits.id, period.benefitId));
  if (!benefit) return null;

  let usedCents = period.usedCents;
  let status = period.status;
  if (benefit.trackingMode === "manual_running_total") {
    usedCents += amountCents ?? 0;
  } else if (benefit.amountCents !== null) {
    usedCents = amountCents === null ? benefit.amountCents : Math.min(benefit.amountCents, usedCents + amountCents);
    status = usedCents >= benefit.amountCents ? "used" : "partial";
  } else {
    status = "used";
  }

  const [updated] = await db
    .update(benefitPeriods)
    .set({ usedCents, status, usedAt: new Date(), note: note ?? period.note })
    .where(eq(benefitPeriods.id, periodId))
    .returning();
  return { period: updated, benefit };
}

/** Case-insensitive name lookup for /usebenefit and /addspend-style text
 * commands. Returns every match so the caller can ask to disambiguate. */
export async function findBenefitsByName(ref: string): Promise<CardBenefit[]> {
  const all = await db.select().from(cardBenefits).orderBy(asc(cardBenefits.id));
  const q = ref.trim().toLowerCase();
  const exact = all.filter((b) => b.name.toLowerCase() === q);
  return exact.length > 0 ? exact : all.filter((b) => b.name.toLowerCase().includes(q));
}

// ---- app_settings helpers ----

export async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

export async function deleteSetting(key: string): Promise<void> {
  await db.delete(appSettings).where(eq(appSettings.key, key));
}
