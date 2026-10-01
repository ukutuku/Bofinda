#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Tøm den isolerede testbase for de SYNTETISKE boliger — og MÅL bagefter,
#  at den er tom. Ellers er «første kort» stadig syntetisk, og det
#  opdages først i billederne.
#
#      gengivelse/toem-testbase.sh                    tøm, og kontrollér
#      gengivelse/toem-testbase.sh --kontrol          kontrollér kun
#      gengivelse/toem-testbase.sh --kontrol --rigtige
#                                  … og kræv mindst én aktiv bolig (efter
#                                  en import)
#
#  Syntetisk er (scripts/cloud/saa.mjs): boliger fra test-kilderne, de
#  seedede udlejerannoncer (native), og enhver bolig med et billede fra
#  testaktivernes stribemønstre (en loopback-vært). Kontrollen tæller de
#  tre hver for sig og afbryder med exit 1, hvis én af dem ikke er 0.
#  Målet er testbasen, sat HER (test_url + krav_isoleret) — aldrig fra
#  .env eller skallen. Testbasen sås igen af scripts/cloud/op.sh.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
HER="$(cd "$(dirname "$0")" && pwd)"; ROD="$(cd "$HER/../../.." && pwd)"
source "$ROD/scripts/cloud/miljoe.sh"
URL="$(test_url)"; krav_isoleret "$URL"
sql() { "$PGBIN/psql" "$URL" -v ON_ERROR_STOP=1 -qAt "$@"; }
STRIBE="'^https?://(127\.0\.0\.1|localhost)[:/]'"

if [ "${1:-}" != "--kontrol" ]; then
  sql <<SQL
begin;
create temp table syntetiske on commit drop as
  select l.id from listings l left join sources s on s.id = l.source_id
  where s.slug like 'test-%' or l.source_type = 'native'
     or exists (select 1 from listing_images i where i.listing_id = l.id and i.external_url ~ $STRIBE);
-- Samtaler sletter ikke kaskadevis (conversations → listings: no action).
delete from conversations where listing_id in (select id from syntetiske);
delete from listings where id in (select id from syntetiske);
commit;
SQL
fi

read -r STRIBER TESTKILDER NATIVE AKTIVE < <(sql -F ' ' -c "select
  (select count(distinct listing_id) from listing_images where external_url ~ $STRIBE),
  (select count(*) from listings l join sources s on s.id = l.source_id where s.slug like 'test-%'),
  (select count(*) from listings where source_type = 'native'),
  (select count(*) from listings where status = 'active')")
echo "testbasen: $STRIBER med stribemønster · $TESTKILDER fra test-kilder · $NATIVE native · $AKTIVE aktive i alt"
if [ "$STRIBER" != 0 ] || [ "$TESTKILDER" != 0 ] || [ "$NATIVE" != 0 ]; then
  echo "FEJL: testbasen er ikke tom for syntetiske boliger. Kørslen fortsætter ikke." >&2; exit 1
fi
if [ "${2:-}" = "--rigtige" ] && [ "$AKTIVE" = 0 ]; then
  echo "FEJL: ingen aktive boliger efter importen. Der er intet rigtigt at måle." >&2; exit 1
fi
