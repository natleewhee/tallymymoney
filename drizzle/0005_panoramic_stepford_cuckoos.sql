ALTER TABLE "transactions" DROP CONSTRAINT "fx_source_check";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_tx_fx_estimate";--> statement-breakpoint
ALTER TABLE "unclassified_emails" ADD COLUMN "body_format" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tx_fx_estimate" ON "transactions" USING btree ("id") WHERE "transactions"."fx_source" IN ('spot_estimate','placeholder');--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "fx_source_check" CHECK ("transactions"."fx_source" IN ('na','spot_estimate','placeholder','confirmed'));--> statement-breakpoint
ALTER TABLE "unclassified_emails" ADD CONSTRAINT "body_format_check" CHECK ("unclassified_emails"."body_format" IN ('text','html') OR "unclassified_emails"."body_format" IS NULL);