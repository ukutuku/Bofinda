#!/usr/bin/env bash
# Hero-kontrollen mod det kørende testmiljø. Kører UDEN hero-miljøvariabler
# med vilje: standardfotoet i public/ skal virke uden opsætning.
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/cloud/miljoe.sh
env -u NEXT_PUBLIC_HERO_FOTO -u NEXT_PUBLIC_HERO_FOTO_KREDIT \
  BOFINDA_APP_BASE="http://127.0.0.1:$BOFINDA_APPPORT" \
  node scripts/cloud/herokontrol.mjs "${BOFINDA_SKAERM:-skaermbilleder}/hero"
