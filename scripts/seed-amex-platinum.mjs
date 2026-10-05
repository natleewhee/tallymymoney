// ONE-OFF: seeds Nat's Amex Platinum Charge (Singapore, 2026 terms) into
// the benefit-tracker tables (cards, card_challenges, card_benefits).
// NOT run automatically by anything — run it by hand, once, after
// migration 0009_benefit_tracker has been applied:
//
//   DATABASE_URL=postgresql://... node scripts/seed-amex-platinum.mjs
//
// Same HTTPS driver as scripts/migrate-http.mjs. Not fully idempotent —
// it only refuses to run if a card with this name already exists, so a
// second run doesn't duplicate everything. To re-seed, delete the rows
// first.
//
// ===================== FILL THESE IN BEFORE RUNNING =====================
// Leave as null if unknown; the bot works without them and the /benefits
// board flags what's missing. You can also UPDATE the rows later.
//
// Last digits of the card as they appear in Amex alert emails (Amex
// usually quotes the last 5). While null, challenge progress counts every
// Amex transaction — fine for a single-card setup.
const ACCOUNT_LAST4 = null; // TODO(Nat): e.g. "12345"
//
// Card approval date, "YYYY-MM-DD" (SGT). The welcome-bonus windows are
// computed from this; while null they're stored with NULL periods and
// show as "window not set" — they are NOT meaningful until this is set.
const APPROVAL_DATE = null; // TODO(Nat): e.g. "2026-09-15"
//
// Membership renewal (anniversary) date, "YYYY-MM-DD". Anchors the
// cardmember-year benefits (Paragon, Comoclub, Sands, status perks).
const RENEWAL_DATE = null; // TODO(Nat): usually approval date + 1 year
// ========================================================================

import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const CARD_NAME = "Amex Platinum Charge";

/** SGT midnight of a YYYY-MM-DD date plus `months` (day clamped), as an
 * ISO string. Periods are stored with an EXCLUSIVE end, matching
 * lib/benefit-logic.ts. */
function sgtDatePlusMonths(ymd, months) {
  const [y, m, d] = ymd.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay)) - 8 * 3600 * 1000).toISOString();
}

const existing = await sql`SELECT id FROM cards WHERE name = ${CARD_NAME}`;
if (existing.length > 0) {
  console.error(`A "${CARD_NAME}" card already exists (id ${existing[0].id}) — refusing to seed twice.`);
  process.exit(1);
}

const [card] = await sql`
  INSERT INTO cards (name, account_last4, annual_fee_cents, renewal_date)
  VALUES (${CARD_NAME}, ${ACCOUNT_LAST4}, 174400, ${RENEWAL_DATE ? sgtDatePlusMonths(RENEWAL_DATE, 0) : null})
  RETURNING id`;
console.log(`Card #${card.id} created.`);

// --- Welcome-bonus challenges. Period placeholders until APPROVAL_DATE set.
const giftA = APPROVAL_DATE
  ? [sgtDatePlusMonths(APPROVAL_DATE, 0), sgtDatePlusMonths(APPROVAL_DATE, 6)]
  : [null, null];
// "15th membership month" = months 14→15 after approval.
const giftB = APPROVAL_DATE
  ? [sgtDatePlusMonths(APPROVAL_DATE, 14), sgtDatePlusMonths(APPROVAL_DATE, 15)]
  : [null, null];

await sql`
  INSERT INTO card_challenges (card_id, type, label, target_spend_cents, period_start, period_end, deadline_basis)
  VALUES
    (${card.id}, 'min_spend', 'Welcome bonus: S$10k in 6 months', 1000000, ${giftA[0]}, ${giftA[1]},
     'Spend must be POSTED (not just made) within the 6-month window — build in a ~5 day buffer before the real deadline.'),
    (${card.id}, 'bonus_month', 'Welcome bonus B: min S$1 spend in the 15th membership month', 100, ${giftB[0]}, ${giftB[1]},
     NULL)`;
console.log(`Challenges created${APPROVAL_DATE ? "" : " (periods NULL — set APPROVAL_DATE and update them)"}.`);

// --- Benefits.
const benefits = [
  ["Airline Credit", 10000, "semi_annual", "auto_suggest", "calendar",
    "S$100 per 6mo (Jan-Jun, Jul-Dec), max S$200/yr, no rollover. Must be SAVED to the card before transactions count. Single txn >=S$300, SIA/Scoot in-app/online only, SGD. Expires 31 Dec 2026."],
  ["Global Dining Credit", 20000, "annual", "auto_suggest", "calendar",
    "Max S$200/yr, redemption period 2 Mar - 31 Dec 2026 (partial first year). Overseas dine-in only, participating restaurant list, direct payment only (no QR/app). Must be saved first. Expires 31 Dec 2026."],
  ["Platinum Wine Credit", 20000, "semi_annual", "auto_suggest", "calendar",
    "S$200 per 6mo, max S$400/yr, no rollover. Only at Platinum Wine Website (Vivino), single txn >=S$300, SGD, direct payment. Must be saved first. Expires 31 Dec 2026."],
  ["Table for Two", null, "bimonthly", "manual_log", "calendar",
    "1 free meal for 2, every 2 months (Jan-Feb/Mar-Apr/May-Jun/Jul-Aug/Sep-Oct/Nov-Dec), 6x/yr. Booked via Amex Experiences App, QR-redeemed at restaurant — NOT a card transaction, nothing to auto-detect. No rollover."],
  ["Paragon Club Prestige", null, "annual", "manual_running_total", "cardmember_year",
    "Needs S$10k spend AT PARAGON MALL TENANTS SPECIFICALLY within 6mo of upgrade to renew Prestige tier for 12mo (then S$25k/12mo ongoing). NOT general card spend — track manually."],
  ["Comoclub C5", null, "annual", "manual_running_total", "cardmember_year",
    "Needs S$25k spend AT COMO GROUP + COMOCLUB PARTNER RESTAURANTS SPECIFICALLY within 12mo to maintain C5 tier. NOT general card spend — track manually."],
  ["Sands LifeStyle Prestige", null, "annual", "manual_running_total", "cardmember_year",
    "S$1,500 spend in first 3mo, then S$5,000/12mo thereafter, likely Marina-Bay-Sands-specific spend (not fully confirmed) — track manually."],
  ["Pan Pacific DISCOVERY Platinum", null, "annual", "one_time_checklist", "cardmember_year",
    "Enroll via Amex Experiences App by 31 Dec 2026. Normally needs 10 nights or US$5,000/yr at Pan Pacific hotels to maintain — track manually if relevant."],
  ["Marriott Bonvoy Gold Elite", null, "one_time", "one_time_checklist", "calendar",
    "Complimentary Gold Elite status via card enrolment. Standing status — nothing to track once enrolled/confirmed."],
  ["Hilton Honors Gold", null, "one_time", "one_time_checklist", "calendar",
    "Complimentary Gold status via card enrolment. Standing status — nothing to track once enrolled/confirmed."],
  ["Radisson Rewards Premium", null, "one_time", "one_time_checklist", "calendar",
    "Complimentary Premium tier via card enrolment. Standing status — nothing to track once enrolled/confirmed."],
  ["Hertz Gold Plus Rewards Five Star", null, "one_time", "one_time_checklist", "calendar",
    "Complimentary Five Star status via card enrolment. Standing status — nothing to track once enrolled/confirmed."],
  ["Tower Club Singapore access", null, "one_time", "one_time_checklist", "calendar",
    "Standing access to Tower Club Singapore for Platinum Cardmembers. Nothing to track once confirmed."],
  ["Bicester Collection access", null, "one_time", "one_time_checklist", "calendar",
    "Standing Bicester Collection (VIP shopping villages) privileges. Nothing to track once enrolled/confirmed."],
  ["Global Lounge Collection access", null, "one_time", "one_time_checklist", "calendar",
    "Standing airport lounge access (Centurion, Priority Pass etc.) via the Global Lounge Collection. Nothing to track once enrolled/confirmed."],
];

for (const [name, amount, cadence, mode, anchor, notes] of benefits) {
  await sql`
    INSERT INTO card_benefits (card_id, name, amount_cents, cadence, tracking_mode, reset_anchor, notes)
    VALUES (${card.id}, ${name}, ${amount}, ${cadence}, ${mode}, ${anchor}, ${notes})`;
}
console.log(`${benefits.length} benefits created.`);
console.log("Done. Open /benefits in Telegram — benefit periods are created on first view.");
