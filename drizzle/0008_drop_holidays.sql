-- Amex-only pivot: holiday mode removed. Column/index/FK first, then the table.
-- Every statement is idempotent because scripts/migrate-http.mjs replays all files.
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_holiday_id_holidays_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_tx_holiday";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN IF EXISTS "holiday_id";--> statement-breakpoint
DROP TABLE IF EXISTS "holidays" CASCADE;
