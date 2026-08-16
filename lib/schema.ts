// Schema as specified in docs/ARCHITECTURE.md §4. Keep the two in sync —
// if you change one, change the other and note why in ARCHITECTURE.md.

import { sql } from "drizzle-orm";
import {
  bigint,
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

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type MerchantRule = typeof merchantRules.$inferSelect;
export type UnclassifiedEmail = typeof unclassifiedEmails.$inferSelect;
export type SenderRule = typeof senderRules.$inferSelect;
