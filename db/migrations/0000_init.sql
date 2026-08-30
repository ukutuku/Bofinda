CREATE TYPE "public"."address_match_level" AS ENUM('unit', 'access', 'failed');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('active', 'delisted');--> statement-breakpoint
CREATE TYPE "public"."property_type" AS ENUM('lejlighed', 'hus', 'raekkehus', 'vaerelse', 'studiebolig', 'andet');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('feed', 'spider', 'native');--> statement-breakpoint
CREATE TYPE "public"."sub_status" AS ENUM('trialing', 'active', 'past_due', 'canceled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('tenant', 'landlord', 'admin');--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"landlord_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "favorites" (
	"user_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"external_url" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"source_type" "source_type" NOT NULL,
	"external_key" text NOT NULL,
	"source_url" text NOT NULL,
	"landlord_id" uuid,
	"address_raw" text NOT NULL,
	"street" text,
	"house_number" text,
	"floor" text,
	"door" text,
	"postal_code" text,
	"city" text,
	"unit_address_uuid" text,
	"access_address_uuid" text,
	"address_match_level" "address_match_level" DEFAULT 'failed' NOT NULL,
	"lat" numeric(10, 7),
	"lng" numeric(10, 7),
	"property_type" "property_type",
	"size_m2" integer,
	"rooms" integer,
	"available_from" timestamp,
	"rent_monthly" integer,
	"utilities_heat" integer,
	"utilities_water" integer,
	"utilities_electricity" integer,
	"total_monthly" integer,
	"total_monthly_components" text[],
	"move_in_cost" integer,
	"amenities" jsonb DEFAULT '[]'::jsonb,
	"open_house_at" timestamp with time zone,
	"description" text,
	"contact_email" text,
	"contact_phone" text,
	"is_blurred" boolean DEFAULT true NOT NULL,
	"status" "listing_status" DEFAULT 'active' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delisted_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "listing_total_monthly_honest" CHECK (
    "listings"."total_monthly" is null
    or ("listings"."rent_monthly" is not null
        and cardinality("listings"."total_monthly_components") > 0)),
	CONSTRAINT "listing_address_level_honest" CHECK (
    ("listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null)
    or ("listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null)
    or "listings"."address_match_level" = 'failed')
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"body" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text,
	"criteria" jsonb NOT NULL,
	"notify_push" boolean DEFAULT true NOT NULL,
	"notify_email" boolean DEFAULT true NOT NULL,
	"last_notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"source_type" "source_type" NOT NULL,
	"base_url" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"status" "sub_status" NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" "user_role" DEFAULT 'tenant' NOT NULL,
	"stripe_customer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_users_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_landlord_id_users_id_fk" FOREIGN KEY ("landlord_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_images" ADD CONSTRAINT "listing_images_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_landlord_id_users_id_fk" FOREIGN KEY ("landlord_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conv_tenant_idx" ON "conversations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "conv_landlord_idx" ON "conversations" USING btree ("landlord_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fav_pk" ON "favorites" USING btree ("user_id","listing_id");--> statement-breakpoint
CREATE INDEX "img_listing_idx" ON "listing_images" USING btree ("listing_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_source_key_idx" ON "listings" USING btree ("source_id","external_key");--> statement-breakpoint
CREATE INDEX "listing_dedup_unit_idx" ON "listings" USING btree ("unit_address_uuid") WHERE "listings"."address_match_level" = 'unit';--> statement-breakpoint
CREATE INDEX "listing_dedup_access_idx" ON "listings" USING btree ("access_address_uuid","size_m2","rooms","rent_monthly") WHERE "listings"."address_match_level" = 'access';--> statement-breakpoint
CREATE INDEX "listing_full_economy_idx" ON "listings" USING btree ("status","total_monthly") WHERE "listings"."total_monthly" is not null;--> statement-breakpoint
CREATE INDEX "listing_fresh_idx" ON "listings" USING btree ("status","first_seen_at");--> statement-breakpoint
CREATE INDEX "listing_geo_idx" ON "listings" USING btree ("postal_code","status");--> statement-breakpoint
CREATE INDEX "msg_conv_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "search_user_idx" ON "saved_searches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sub_user_idx" ON "subscriptions" USING btree ("user_id");