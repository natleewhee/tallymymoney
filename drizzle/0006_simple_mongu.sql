CREATE TABLE IF NOT EXISTS "holidays" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"pinned_chat_id" text,
	"pinned_message_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "holiday_id" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_holidays_active" ON "holidays" USING btree ("id") WHERE "holidays"."ended_at" IS NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_holiday_id_holidays_id_fk" FOREIGN KEY ("holiday_id") REFERENCES "public"."holidays"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tx_holiday" ON "transactions" USING btree ("holiday_id") WHERE "transactions"."holiday_id" IS NOT NULL;