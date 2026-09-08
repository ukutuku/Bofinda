#!/usr/bin/env bash
# Måler datasættet gennem appens egen søgning. Kræver ikke, at appen kører.
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/cloud/miljoe.sh
URL="$(test_url)"
krav_isoleret "$URL"
DATABASE_URL_DIRECT="$URL" BILLED_HEMMELIGHED=kun-til-maaling-ikke-en-hemmelighed \
  npx tsx --tsconfig tsconfig.scripts.json scripts/cloud/tjek.ts
