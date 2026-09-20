#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Betalingens kapløbsprøver på RIGTIG, isoleret PostgreSQL.
#
#  De kan ikke køre under `npm test`: PGlite er én forbindelse i én
#  proces, og to «samtidige» transaktioner serialiseres, før de når
#  hinanden. Prøven ville være grøn, uanset om vagten fandtes.
#
#  Scriptet rejser den lokale testklynge (idempotent) og giver prøven
#  dens forbindelsesstreng. Prøven opretter sin EGEN database i
#  klyngen, kører migrationerne i den og sletter den igen til sidst.
#
#      npm run test:kaploeb
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/cloud/miljoe.sh

./scripts/cloud/db-op.sh
URL="$(test_url)"
krav_isoleret "$URL"
BOFINDA_TESTBASE_URL="$URL" \
  npx tsx --tsconfig tsconfig.scripts.json scripts/test-betaling-kaploeb.ts
