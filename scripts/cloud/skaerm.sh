#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/cloud/miljoe.sh
URL="$(test_url)"
krav_isoleret "$URL"
DATABASE_URL_DIRECT="$URL" node scripts/cloud/skaerm.mjs "${1:-skaermbilleder/nu}"
