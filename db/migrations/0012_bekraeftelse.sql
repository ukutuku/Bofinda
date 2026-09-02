ALTER TABLE "saved_searches" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD COLUMN "confirm_token" text DEFAULT gen_random_uuid()::text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "search_confirm_unik" ON "saved_searches" USING btree ("confirm_token");