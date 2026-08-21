CREATE TABLE IF NOT EXISTS "tag_undo_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_id" integer NOT NULL,
	"prev_category" text,
	"prev_split" text,
	"prev_status" text NOT NULL,
	"prev_tagged_at" timestamp with time zone,
	"merchant_key" text,
	"rule_existed" boolean DEFAULT false NOT NULL,
	"prev_rule_category" text,
	"prev_rule_split" text,
	"prev_rule_hit_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tag_undo_log" ADD CONSTRAINT "tag_undo_log_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
