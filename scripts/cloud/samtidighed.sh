#!/usr/bin/env bash
# Ægte samtidighed på auth-bindingen, mod den isolerede lokale PostgreSQL.
# PGlite kan ikke prøve det — den kører på én forbindelse.
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/cloud/miljoe.sh
URL="$(test_url)"
krav_isoleret "$URL"
DATABASE_URL_DIRECT="$URL" BILLED_HEMMELIGHED=kun-til-proever-ikke-en-hemmelighed \
  npx tsx --tsconfig tsconfig.scripts.json scripts/cloud/samtidighed.ts
