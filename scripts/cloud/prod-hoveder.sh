#!/usr/bin/env bash
# Cachebeskyttelsen på det endelige HTTP-svar, målt mod `next start`.
# `next dev` sætter selv no-store på alting og ville skjule fejlen.
# Genbruger buildet i .next — bygger ikke selv.
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/cloud/miljoe.sh
URL="$(test_url)"
krav_isoleret "$URL"
DATABASE_URL_DIRECT="$URL" DATABASE_URL="$URL" \
  BILLED_HEMMELIGHED=kun-til-proever-ikke-en-hemmelighed \
  node scripts/cloud/prod-hoveder.mjs
