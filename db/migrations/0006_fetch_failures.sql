CREATE TABLE "fetch_failures" (
	"source_id" uuid NOT NULL,
	"external_key" text NOT NULL,
	"url" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"first_failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retry_after" timestamp with time zone NOT NULL,
	"last_error" text,
	CONSTRAINT "fetch_failures_source_id_external_key_pk" PRIMARY KEY("source_id","external_key")
);
--> statement-breakpoint
ALTER TABLE "crawl_runs" ADD COLUMN "skipped_count" integer;--> statement-breakpoint
ALTER TABLE "fetch_failures" ADD CONSTRAINT "fetch_failures_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fetch_failure_retry_idx" ON "fetch_failures" USING btree ("source_id","retry_after");