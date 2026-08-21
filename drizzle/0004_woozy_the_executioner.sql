CREATE TABLE IF NOT EXISTS "settlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"joint_total_cents" bigint NOT NULL,
	"half_cents" bigint NOT NULL,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_settlements_period" ON "settlements" USING btree ("period_start","period_end");