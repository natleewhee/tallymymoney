CREATE TABLE IF NOT EXISTS "gmail_label_removals" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_message_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "gmail_label_removals_email_message_id_unique" UNIQUE("email_message_id")
);
