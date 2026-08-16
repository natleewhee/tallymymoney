CREATE TABLE IF NOT EXISTS "merchant_rules" (
	"merchant_normalised" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"default_split" text,
	"hit_count" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sender_rules" (
	"sender" text NOT NULL,
	"subject" text NOT NULL,
	"action" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sender_rules_sender_subject_pk" PRIMARY KEY("sender","subject"),
	CONSTRAINT "sender_rule_action_check" CHECK ("sender_rules"."action" IN ('ignore','needs_parser'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_message_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" char(3) DEFAULT 'SGD' NOT NULL,
	"sgd_amount_cents" bigint NOT NULL,
	"fx_source" text DEFAULT 'na' NOT NULL,
	"fx_rate" numeric,
	"direction" text NOT NULL,
	"merchant_raw" text,
	"merchant_normalised" text,
	"description" text,
	"category" text,
	"split" text,
	"bank" text NOT NULL,
	"account_identifier" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reduces_transaction_id" integer,
	"raw_email" text,
	"telegram_message_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tagged_at" timestamp with time zone,
	CONSTRAINT "transactions_email_message_id_unique" UNIQUE("email_message_id"),
	CONSTRAINT "direction_check" CHECK ("transactions"."direction" IN ('debit','credit')),
	CONSTRAINT "split_check" CHECK ("transactions"."split" IN ('solo','joint','ignored') OR "transactions"."split" IS NULL),
	CONSTRAINT "status_check" CHECK ("transactions"."status" IN ('pending','tagged','ignored')),
	CONSTRAINT "fx_source_check" CHECK ("transactions"."fx_source" IN ('na','spot_estimate','confirmed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "unclassified_emails" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_message_id" text NOT NULL,
	"sender" text NOT NULL,
	"subject" text,
	"raw_email" text NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unclassified_emails_email_message_id_unique" UNIQUE("email_message_id"),
	CONSTRAINT "unclassified_status_check" CHECK ("unclassified_emails"."status" IN ('pending_review','ignored','needs_parser'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_reduces_transaction_id_transactions_id_fk" FOREIGN KEY ("reduces_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tx_occurred" ON "transactions" USING btree ("occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tx_status" ON "transactions" USING btree ("status") WHERE "transactions"."status" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tx_fx_estimate" ON "transactions" USING btree ("id") WHERE "transactions"."fx_source" = 'spot_estimate';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_unclassified" ON "unclassified_emails" USING btree ("status") WHERE "unclassified_emails"."status" != 'ignored';