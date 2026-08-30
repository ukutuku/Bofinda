CREATE TYPE "public"."application_type" AS ENUM('regular', 'waiting_list');--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "utilities_other" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "application_type" "application_type";--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "rent_model" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "source_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "source_updated_at" timestamp with time zone;