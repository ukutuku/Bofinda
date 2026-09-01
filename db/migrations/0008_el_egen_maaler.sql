ALTER TABLE "listings" ADD COLUMN "electricity_own_meter" boolean;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listing_el_enten_eller" CHECK (
    "listings"."electricity_own_meter" is not true or "listings"."utilities_electricity" is null);