ALTER TABLE "saved_searches" ADD COLUMN "unsubscribe_token" text DEFAULT gen_random_uuid()::text NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD COLUMN "unsubscribed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "search_token_unik" ON "saved_searches" USING btree ("unsubscribe_token");