#!/usr/bin/env bash
# Browserkontrollen mod det kørende testmiljø. Skærmbillederne lander i
# skaermbilleder/ (gitignored) — de er output, ikke kildekode.
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/cloud/miljoe.sh
hemmeligheder
URL="$(test_url)"
krav_isoleret "$URL"
DATABASE_URL_DIRECT="$URL" \
  BOFINDA_APP_BASE="http://127.0.0.1:$BOFINDA_APPPORT" \
  BOFINDA_SKAERM="${BOFINDA_SKAERM:-skaermbilleder}" \
  node scripts/cloud/browserkontrol.mjs
