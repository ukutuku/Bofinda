#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Hele testmiljøet fra bunden, i ét kald. Idempotent hele vejen:
#  kør den igen, og den samler op, hvor den slap.
#
#      scripts/cloud/op.sh          base + skema + data + app
#      scripts/cloud/op.sh --uden-app     kun base, skema og data
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/cloud/miljoe.sh

[ -d node_modules ] || { echo "→ npm ci"; npm ci; }

./scripts/cloud/db-op.sh
URL="$(test_url)"
krav_isoleret "$URL"
DATABASE_URL_DIRECT="$URL" node scripts/cloud/klargoer.mjs
DATABASE_URL_DIRECT="$URL" BOFINDA_AKTIV_BASE="http://127.0.0.1:$BOFINDA_AKTIVPORT" \
  node scripts/cloud/saa.mjs

if [ "${1:-}" = "--uden-app" ]; then
  echo "✓ base, skema og data klar (appen ikke startet)"; exit 0
fi
./scripts/cloud/app-op.sh
echo
echo "  app:        http://127.0.0.1:$BOFINDA_APPPORT"
echo "  testaktiver http://127.0.0.1:$BOFINDA_AKTIVPORT"
echo "  browserkontrol:  scripts/cloud/kontrol.sh"
