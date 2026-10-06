CREATE TABLE IF NOT EXISTS "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "benefit_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"benefit_id" integer NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"used_cents" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"used_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "benefit_period_status_check" CHECK (status IN ('open','used','partial','expired'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_benefits" (
	"id" serial PRIMARY KEY NOT NULL,
	"card_id" integer NOT NULL,
	"name" text NOT NULL,
	"amount_cents" bigint,
	"cadence" text NOT NULL,
	"tracking_mode" text NOT NULL,
	"reset_anchor" text DEFAULT 'calendar' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "benefit_cadence_check" CHECK (cadence IN ('one_time','bimonthly','semi_annual','annual')),
	CONSTRAINT "benefit_tracking_mode_check" CHECK (tracking_mode IN ('auto_suggest','manual_log','manual_running_total','one_time_checklist')),
	CONSTRAINT "benefit_reset_anchor_check" CHECK (reset_anchor IN ('calendar','cardmember_year'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_challenge_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"challenge_id" integer NOT NULL,
	"amount_cents" bigint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_challenges" (
	"id" serial PRIMARY KEY NOT NULL,
	"card_id" integer NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"target_spend_cents" bigint,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"deadline_basis" text,
	"met_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenge_type_check" CHECK (type IN ('min_spend','bonus_month'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"account_last4" text,
	"annual_fee_cents" bigint,
	"renewal_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "excluded_from_qualifying_spend" boolean;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "benefit_periods" ADD CONSTRAINT "benefit_periods_benefit_id_card_benefits_id_fk" FOREIGN KEY ("benefit_id") REFERENCES "public"."card_benefits"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_benefits" ADD CONSTRAINT "card_benefits_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_challenge_adjustments" ADD CONSTRAINT "card_challenge_adjustments_challenge_id_card_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."card_challenges"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_challenges" ADD CONSTRAINT "card_challenges_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_benefit_period_unique" ON "benefit_periods" USING btree ("benefit_id","period_start");