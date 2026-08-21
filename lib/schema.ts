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
      "fx_source_check",
      sql`${table.fxSource} IN ('na','spot_estimate','confirmed')`,
    ),
    index("idx_tx_occurred").on(table.occurredAt.desc()),
    index("idx_tx_status").on(table.status).where(sql`${table.status} = 'pending'`),
    index("idx_tx_fx_estimate")
      .on(table.id)
      .where(sql`${table.fxSource} = 'spot_estimate'`),
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
  },
  (table) => [
    check(
      "unclassified_status_check",
      sql`${table.status} IN ('pending_review','ignored','needs_parser')`,
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

// FR-19 settle-up: one row per month Nat has confirmed he and his partner
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

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type MerchantRule = typeof merchantRules.$inferSelect;
export type UnclassifiedEmail = typeof unclassifiedEmails.$inferSelect;
export type SenderRule = typeof senderRules.$inferSelect;
export type TagUndoEntry = typeof tagUndoLog.$inferSelect;
export type GmailLabelRemoval = typeof gmailLabelRemovals.$inferSelect;
export type Settlement = typeof settlements.$inferSelect;
