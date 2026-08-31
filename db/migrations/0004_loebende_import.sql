ALTER TABLE "crawl_runs" ADD COLUMN "new_count" integer;--> statement-breakpoint
ALTER TABLE "crawl_runs" ADD COLUMN "updated_count" integer;--> statement-breakpoint
ALTER TABLE "crawl_runs" ADD COLUMN "delisted_count" integer;--> statement-breakpoint
ALTER TABLE "crawl_runs" ADD COLUMN "touched_count" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "last_fetched_at" timestamp with time zone;