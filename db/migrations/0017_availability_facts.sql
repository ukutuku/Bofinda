-- Snapshot af kildens availability-facts. NULL = ikke hoestet endnu,
-- '{}' = hoestet, kilden gav ingen. Se noten i db/schema.ts.
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "availability_facts" jsonb;
