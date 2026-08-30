CREATE TYPE "public"."crawl_run_status" AS ENUM('running', 'ok', 'failed');--> statement-breakpoint
CREATE TABLE "crawl_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"discovered_count" integer,
	"extracted_count" integer,
	"error_count" integer DEFAULT 0 NOT NULL,
	"status" "crawl_run_status" DEFAULT 'running' NOT NULL,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "crawl_runs" ADD CONSTRAINT "crawl_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crawl_run_source_recent_idx" ON "crawl_runs" USING btree ("source_id","started_at" DESC NULLS LAST);