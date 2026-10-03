#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Runde 3's billeder og målinger, taget om med én kommando mod den
#  kørende app (scripts/cloud/op.sh). Rører ingen fil i appen.
#
#      docs/designforslag/gengivelse/runde3.sh <udmappe> [png|jpeg] [dpr]
#
#  foer        siden, som den er — 1440, 390, 360, alle fire sider
#  runde2      laget fra b5d5f50 (runde 2), forsiden i 390 og 360
#  efter-baand runde 3, telefonvariant A — 1440, 390, 360, alle sider
#  efter-moerk runde 3, telefonvariant B — forsiden i 390 og 360
#  foto        maal-foto.mjs --selvproeve (kan målingen både bestå og afvise?)
#
#  Kør igen, når netværket er åbent og basen har rigtige annoncer: så er
#  det de samme billeder og tal, bare af det, brugerne ser.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
UD="${1:?brug: runde3.sh <udmappe> [png|jpeg] [dpr]}"; FMT="${2:-png}"; DPR="${3:-1}"
HER="$(cd "$(dirname "$0")" && pwd)"; ROD="$(cd "$HER/../../.." && pwd)"
source "$ROD/scripts/cloud/miljoe.sh"
export DATABASE_URL_DIRECT="$(test_url)"; krav_isoleret "$DATABASE_URL_DIRECT"
mkdir -p "$UD"

# Runde 2's lag, som det blev committet — til sammenligning, ikke til brug.
R2="$UD/.runde2-lag"; mkdir -p "$R2"
for f in forslag.css greb.css greb.js; do git -C "$ROD" show "b5d5f50:docs/designforslag/$f" > "$R2/$f"; done

skud() { node "$HER/app-skud.mjs" "$UD/$1" "$2" "$FMT" "$DPR" "${@:3}"; }
skud foer        foer  --bredder 1440,390,360
skud runde2      efter --lag "$R2" --bredder 390,360 --sider forside
skud efter-baand efter --mobil baand --bredder 1440,390,360
skud efter-moerk efter --mobil moerk --bredder 390,360 --sider forside
node "$HER/maal-foto.mjs" "$UD/foto" --selvproeve
echo "FÆRDIG: $UD"
