#!/usr/bin/env bash
# Pagination- og analytics-kontrollen. Kører ved siden af den generelle
# scripts/cloud/kontrol.sh, ikke i stedet for den.
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/cloud/miljoe.sh
hemmeligheder
URL="$(test_url)"
krav_isoleret "$URL"
DATABASE_URL_DIRECT="$URL" \
  BOFINDA_APP_BASE="http://127.0.0.1:$BOFINDA_APPPORT" \
  BOFINDA_SKAERM="${BOFINDA_SKAERM:-skaermbilleder}" \
  node scripts/cloud/browserkontrol-pagination.mjs
