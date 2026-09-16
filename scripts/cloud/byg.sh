#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Bygger appen TIL TESTMILJØET.
#
#  Findes, fordi `NEXT_PUBLIC_*` bages ind i klientbundtet ved byg og
#  ikke ved start. app-op.sh sætter flise-URL'en på processen, men
#  Landkort.tsx er en klientkomponent, så den værdi er allerede låst
#  fast, når appen starter. Et byg lavet med `npm run build` bærer
#  standardværdien — OpenStreetMaps rigtige fliser — og så henter
#  browseren udefra midt i en kontrol, der ellers kun rører loopback.
#
#  Ingen database og ingen hemmeligheder: et byg skal kunne lykkes uden
#  en base, og det er netop dét, der gør, at ingenting opdager en
#  migration, der aldrig blev kørt. Kun de offentlige variabler.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/cloud/miljoe.sh

env -u VERCEL -u VERCEL_ENV -u DATABASE_URL -u DATABASE_URL_DIRECT \
  NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:$BOFINDA_AKTIVPORT" \
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="sb_publishable_ATTRAP_kun_til_cloudtest" \
  NEXT_PUBLIC_FLISE_URL="http://127.0.0.1:$BOFINDA_AKTIVPORT/flise/{z}/{x}/{y}.png" \
  NEXT_PUBLIC_FLISE_KREDIT="Testfliser — lokalt genereret, ikke OpenStreetMap" \
  NEXT_PUBLIC_BASE_URL="http://127.0.0.1:$BOFINDA_APPPORT" \
  npm run build

if grep -rqs 'tile\.openstreetmap\.org' .next/static; then
  echo "FEJL: bygget bærer stadig OpenStreetMaps flise-URL." >&2
  exit 1
fi
echo "✓ byg klar til testmiljøet — ingen OpenStreetMap-URL i klientbundtet"
