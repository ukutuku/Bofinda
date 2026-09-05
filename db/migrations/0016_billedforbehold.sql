-- Kilden oplyser selv, at billederne kan vaere fra en anden bolig.
-- Se noten i db/schema.ts: her staar kun AT forbeholdet findes.
alter table "listings" add column if not exists "images_may_differ"
  boolean not null default false;
