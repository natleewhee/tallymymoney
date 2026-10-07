// Schema as specified in docs/ARCHITECTURE.md §4. Keep the two in sync —
// if you change one, change the other and note why in ARCHITECTURE.md.

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  type AnyPgColumn,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    emailMessageId: text("email_message_id").notNull().unique(),

    // Original amount, original currency.
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("SGD"),

    // FR-2/FR-22: what every report actually sums. Equal to amountCents
    // when currency = 'SGD'; otherwise a spot-rate conversion at ingest
    // time, amendable later via FR-22 once Nat checks the real statement.
    sgdAmountCents: bigint("sgd_amount_cents", { mode: "number" }).notNull(),
    fxSource: text("fx_source").notNull().default("na"),
    fxRate: numeric("fx_rate"),

    direction: text("direction").notNull(),
    merchantRaw: text("merchant_raw"),
    merchantNormalised: text("merchant_normalised"),
    description: text("description"),
    category: text("category"),
    split: text("split"),
    bank: text("bank").notNull(),

    // Usually a last-4. Trust never gives one — store the card/product
    // name instead (e.g. "Freedom"), confirmed sufficient by Nat for a
    // single-card setup.
    accountIdentifier: text("account_identifier"),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("pending"),

    // FR-21: set when this row is a manually-tagged refund/reversal
    // against an earlier row. Reporting nets it off the referenced
    // transaction and excludes this row from independent totals.
    reducesTransactionId: integer("reduces_transaction_id").references(
      (): AnyPgColumn => transactions.id,
    ),

    // Benefit tracker: true for rows that post as Amex transactions but
    // must not count toward a min-spend challenge (the annual fee, cash
    // advances, Amex's own fee reversals). Null = counts, the normal case.
    // Set by hand (SQL or a future command) — nothing auto-detects these.
    excludedFromQualifyingSpend: boolean("excluded_from_qualifying_spend"),

    rawEmail: text("raw_email"),
    telegramMessageId: bigint("telegram_message_id", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    taggedAt: timestamp("tagged_at", { withTimezone: true }),
  },
  (table) => [
    check("direction_check", sql`${table.direction} IN ('debit','credit')`),
    check(
      "split_check",
      sql`${table.split} IN ('solo','joint','ignored') OR ${table.split} IS NULL`,
    ),
    check("status_check", sql`${table.status} IN ('pending','tagged','ignored')`),
    check(
      // 'placeholder': no live rate and nothing in this currency to
      // borrow a rate from (defect 11) — unlike 'spot_estimate' this
      // isn't a real conversion at all, so reports must exclude it from
      // totals rather than silently summing a number that could be off
      // by an unbounded factor. Both still need confirming via FR-22.
      "fx_source_check",
      sql`${table.fxSource} IN ('na','spot_estimate','placeholder','confirmed')`,
    ),
    index("idx_tx_occurred").on(table.occurredAt.desc()),
    index("idx_tx_status").on(table.status).where(sql`${table.status} = 'pending'`),
    index("idx_tx_fx_estimate")
      .on(table.id)
      .where(sql`${table.fxSource} IN ('spot_estimate','placeholder')`),
  ],
);

// Merchant memory: the feature that keeps tagging to one tap (FR-7/FR-9).
export const merchantRules = pgTable("merchant_rules", {
  merchantNormalised: text("merchant_normalised").primaryKey(),
  category: text("category").notNull(),
  defaultSplit: text("default_split"),
  hitCount: integer("hit_count").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Undo support for tagging. Tagging writes in two places — the
// transaction row and the merchant rule that pre-fills future visits to
// the same merchant — so a mistap doesn't just mislabel one purchase, it
// poisons every future one. Reverting needs the prior state of both, and
// neither is recoverable after the write, so it's snapshotted here first.
// One row per tag action; /undo pops the most recent and deletes it.
export const tagUndoLog = pgTable("tag_undo_log", {
  id: serial("id").primaryKey(),
  transactionId: integer("transaction_id")
    .notNull()
    .references((): AnyPgColumn => transactions.id),

  // Prior state of the transaction row.
  prevCategory: text("prev_category"),
  prevSplit: text("prev_split"),
  prevStatus: text("prev_status").notNull(),
  prevTaggedAt: timestamp("prev_tagged_at", { withTimezone: true }),

  // Prior state of the merchant rule. merchantKey is null when the
  // transaction had no merchant to key on (UOB PayNow-received, for
  // instance), in which case no rule was touched and there's nothing to
  // restore. ruleExisted distinguishes "update an existing rule back to
  // these values" from "no rule existed, delete the one we created".
  merchantKey: text("merchant_key"),
  ruleExisted: boolean("rule_existed").notNull().default(false),
  prevRuleCategory: text("prev_rule_category"),
  prevRuleSplit: text("prev_rule_split"),
  prevRuleHitCount: integer("prev_rule_hit_count"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// FR-4/FR-20: anything that didn't become a transaction — an
// unrecognised (sender, subject) pair, or a previously-working pattern
// that returned nothing this time.
export const unclassifiedEmails = pgTable(
  "unclassified_emails",
  {
    id: serial("id").primaryKey(),
    emailMessageId: text("email_message_id").notNull().unique(),
    sender: text("sender").notNull(),
    subject: text("subject"),
    rawEmail: text("raw_email").notNull(),
    status: text("status").notNull().default("pending_review"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Confirmed 2026-08-19: when Nat taps Needs Parser, the source email
    // gets a visible Gmail label so he can find it to forward over.
    // Apps Script polls needs-parser-queue for rows where this is still
    // false, labels the Gmail thread, then acks — see that route and
    // apps-script/forward-to-ingest.gs.
    labeledInGmail: boolean("labeled_in_gmail").notNull().default(false),

    // Which of textBody/htmlBody rawEmail was taken from, set at ingest
    // time. Null for rows written before this column existed — recovery.ts
    // falls back to its old regex guess only for those. Recorded rather
    // than re-derived because the guess (looksLikeHtml) can misfire on
    // plain text that happens to contain something like <jane@x.com>.
    bodyFormat: text("body_format"),
  },
  (table) => [
    check(
      "unclassified_status_check",
      sql`${table.status} IN ('pending_review','ignored','needs_parser')`,
    ),
    check(
      "body_format_check",
      sql`${table.bodyFormat} IN ('text','html') OR ${table.bodyFormat} IS NULL`,
    ),
    index("idx_unclassified")
      .on(table.status)
      .where(sql`${table.status} != 'ignored'`),
  ],
);

// Work queue for taking the "needs parser" label back off a Gmail thread
// once the email is no longer stuck — a parser was built and the email
// reparsed, or Nat decided to ignore that type instead.
//
// Needs its own table rather than a flag on unclassified_emails because
// a successful reparse DELETES that row, taking the Gmail message id
// with it — so the instruction to unlabel has to outlive the thing it
// refers to. Same polling shape as the labelling direction: only Apps
// Script can touch Gmail, so the app can do no more than leave a note.
export const gmailLabelRemovals = pgTable("gmail_label_removals", {
  id: serial("id").primaryKey(),
  emailMessageId: text("email_message_id").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Null until Apps Script confirms the label is off the thread.
  removedAt: timestamp("removed_at", { withTimezone: true }),
});

// FR-20a/FR-20b: Nat's one-time classification of a (sender, subject)
// pattern, applied to every future email matching it.
export const senderRules = pgTable(
  "sender_rules",
  {
    sender: text("sender").notNull(),
    subject: text("subject").notNull(),
    action: text("action").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("sender_rule_action_check", sql`${table.action} IN ('ignore','needs_parser')`),
    primaryKey({ columns: [table.sender, table.subject] }),
  ],
);

// FR-19 settle-up: no longer written by anything — /partner and the
// monthly report's settle button were removed in the Amex-only pivot.
// Kept (not dropped) so historical settlements aren't destroyed.
//
// Original note: one row per month Nat has confirmed he and his partner
// have squared up. periodStart/periodEnd are full calendar-month bounds
// (see sgt.ts currentMonthBounds) so a settlement's identity doesn't
// drift depending on which day of the month /partner is used.
export const settlements = pgTable(
  "settlements",
  {
    id: serial("id").primaryKey(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    jointTotalCents: bigint("joint_total_cents", { mode: "number" }).notNull(),
    halfCents: bigint("half_cents", { mode: "number" }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_settlements_period").on(table.periodStart, table.periodEnd),
  ],
);

// ---------------------------------------------------------------------------
// Card benefit tracker (Amex Platinum Charge pivot, 2026-10).
//
// Challenge progress is a DERIVED query against `transactions` (filtered
// by account_last4, date range and excluded_from_qualifying_spend) — there
// is deliberately no card_challenge_id on transactions. Card spend counts
// normally AND toward any challenge window it falls in; unlike the old
// holiday_id tag, nothing is ever pulled out of anything else.
// ---------------------------------------------------------------------------

export const cards = pgTable("cards", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // Null until Nat fills it in. While null, challenge progress counts every
  // Amex-bank transaction (single-card setup), not one specific card.
  accountLast4: text("account_last4"),
  annualFeeCents: bigint("annual_fee_cents", { mode: "number" }),
  // Anchors reset_anchor = 'cardmember_year' benefits. Null → those fall
  // back to calendar years (flagged on the /benefits board).
  renewalDate: timestamp("renewal_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cardChallenges = pgTable(
  "card_challenges",
  {
    id: serial("id").primaryKey(),
    cardId: integer("card_id").notNull().references(() => cards.id),
    type: text("type").notNull(),
    label: text("label").notNull(),
    targetSpendCents: bigint("target_spend_cents", { mode: "number" }),
    // Nullable: the welcome-bonus windows hang off the card's approval
    // date, which Nat sets after seeding. Null period = "not configured".
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    deadlineBasis: text("deadline_basis"),
    metAt: timestamp("met_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [check("challenge_type_check", sql`type IN ('min_spend','bonus_month')`)],
);

// Manual corrections from /cardadjust (e.g. "+500" for a charge whose
// alert email never parsed). Summed on top of the derived transaction
// total — kept separate so the correction is visible and reversible,
// rather than faking a transaction row.
export const cardChallengeAdjustments = pgTable("card_challenge_adjustments", {
  id: serial("id").primaryKey(),
  challengeId: integer("challenge_id").notNull().references(() => cardChallenges.id),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cardBenefits = pgTable(
  "card_benefits",
  {
    id: serial("id").primaryKey(),
    cardId: integer("card_id").notNull().references(() => cards.id),
    name: text("name").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }),
    cadence: text("cadence").notNull(),
    trackingMode: text("tracking_mode").notNull(),
    resetAnchor: text("reset_anchor").notNull().default("calendar"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    check("benefit_cadence_check", sql`cadence IN ('one_time','bimonthly','semi_annual','annual')`),
    check(
      "benefit_tracking_mode_check",
      sql`tracking_mode IN ('auto_suggest','manual_log','manual_running_total','one_time_checklist')`,
    ),
    check("benefit_reset_anchor_check", sql`reset_anchor IN ('calendar','cardmember_year')`),
  ],
);

// Created check-on-read by lib/cards.ts ensureCurrentBenefitPeriod — no
// cron is needed for correctness. Elapsed open periods are marked
// 'expired', never deleted, so missed credits stay visible as history.
// periodEnd is EXCLUSIVE (SGT midnight after the last valid day).
export const benefitPeriods = pgTable(
  "benefit_periods",
  {
    id: serial("id").primaryKey(),
    benefitId: integer("benefit_id").notNull().references(() => cardBenefits.id),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    usedCents: bigint("used_cents", { mode: "number" }).notNull().default(0),
    status: text("status").notNull().default("open"),
    usedAt: timestamp("used_at", { withTimezone: true }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("benefit_period_status_check", sql`status IN ('open','used','partial','expired')`),
    // Check-on-read can race (two webhook deliveries at once); the unique
    // index makes the second insert fail instead of duplicating a period.
    uniqueIndex("idx_benefit_period_unique").on(table.benefitId, table.periodStart),
  ],
);

// Tiny key/value store: the single pinned benefit-banner's chat/message
// ids, plus "awaiting a reply" prompts (key prompt:<message_id>) for the
// tap-a-button-then-reply flows on /benefits — same reply-to-message idea
// the FX amend flow uses, but those prompts aren't transactions.
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Card = typeof cards.$inferSelect;
export type CardChallenge = typeof cardChallenges.$inferSelect;
export type CardBenefit = typeof cardBenefits.$inferSelect;
export type BenefitPeriod = typeof benefitPeriods.$inferSelect;

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type MerchantRule = typeof merchantRules.$inferSelect;
export type UnclassifiedEmail = typeof unclassifiedEmails.$inferSelect;
export type SenderRule = typeof senderRules.$inferSelect;
export type TagUndoEntry = typeof tagUndoLog.$inferSelect;
export type GmailLabelRemoval = typeof gmailLabelRemovals.$inferSelect;
export type Settlement = typeof settlements.$inferSelect;
