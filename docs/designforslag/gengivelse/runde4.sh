#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Runde 4's billeder og målinger, taget om med én kommando mod den
#  kørende app (scripts/cloud/op.sh). Rører ingen fil i appen.
#
#      docs/designforslag/gengivelse/runde4.sh <udmappe> [png|jpeg] [dpr]
#      docs/designforslag/gengivelse/runde4.sh <udmappe> --rigtige propstep,dacas,balder
#
#  --rigtige: TØM testbasen for de syntetiske boliger, importér de
#  navngivne kilder (importer-testbase.sh), og MÅL, at der ingen syntetiske
#  er tilbage og mindst én aktiv bolig (toem-testbase.sh). Først derefter
#  tages målingerne. Kildernes billeder skrives IKKE: værktøjerne afviser
#  ethvert skærmbillede, der viser en kildes billede (hero-maal.mjs ›
#  skaermbillede), så kørslen giver tal, ikke billeder. Testbasen sås
#  igen af scripts/cloud/op.sh.
#
#  Målet er den isolerede testbase, sat HER (test_url + krav_isoleret), og
#  appen er den lokale (BOFINDA_APPPORT fra miljoe.sh) — aldrig fra .env
#  eller skallen. Står en anden app i skallen, afbrydes der (exit 3).
#
#  foer       siden, som den er — forsiden i 1440, 390, 360
#  runde2     laget fra b5d5f50 — forsiden i 390 og 360
#  runde3-b   laget fra 9efcb4e med telefonvariant B (.m-moerk) — 390, 360
#  b          B, den valgte hero — 1440, 390, 360, alle fire sider
#             (variant A, fotobåndet, er fravalgt 1. oktober og tages ikke)
#  kredit     kredit-udrulning.mjs: alle udrulningstilstande + modprøver
#  foto       maal-foto.mjs --selvproeve
#  maal       maalinger/proev-maal.mjs: vagten om navngivne mål
#
#  Hver forsideskud måler første boligkort ved folden (hero-maal.mjs ›
#  foersteKort) og fejler, hvis krediteringen ikke står præcis én gang.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
UD="${1:?brug: runde4.sh <udmappe> [png|jpeg] [dpr] | <udmappe> --rigtige <slug,…>}"; shift
RIGTIGE=""
if [ "${1:-}" = "--rigtige" ]; then RIGTIGE="${2:?--rigtige kræver kilderne, fx propstep,dacas}"; set --; fi
FMT="${1:-png}"; DPR="${2:-1}"
HER="$(cd "$(dirname "$0")" && pwd)"; ROD="$(cd "$HER/../../.." && pwd)"
# Bevisbilleder lever i artefaktet, ikke i git (GREB-5 § 5). Udmappen må
# derfor ikke ligge i repoet; npm test ville alligevel afvise billederne.
case "$(realpath -m "$UD")/" in "$ROD"/*)
  echo "FEJL: $UD ligger i repoet. Bevisbilleder lever i artefaktet (GREB-5 § 5) — vælg en mappe uden for $ROD." >&2; exit 2;; esac
source "$ROD/scripts/cloud/miljoe.sh"
export DATABASE_URL_DIRECT="$(test_url)"; krav_isoleret "$DATABASE_URL_DIRECT"
# Appen, der fotograferes og måles, er den lokale — også den sættes HER.
# Står en anden i skallen, er det den forkerte skal at måle fra.
APP="http://127.0.0.1:$BOFINDA_APPPORT"
if [ -n "${BOFINDA_APP_BASE:-}" ] && [ "$BOFINDA_APP_BASE" != "$APP" ]; then
  echo "FEJL: BOFINDA_APP_BASE=$BOFINDA_APP_BASE i skallen; runde4.sh måler kun $APP." >&2; exit 3
fi
export BOFINDA_APP_BASE="$APP"
mkdir -p "$UD"

if [ -n "$RIGTIGE" ]; then
  "$HER/toem-testbase.sh"
  # Importen sætter selv sit mål og afviser en skal med DATABASE_URL_DIRECT.
  for slug in ${RIGTIGE//,/ }; do env -u DATABASE_URL_DIRECT "$HER/importer-testbase.sh" "$slug"; done
  "$HER/toem-testbase.sh" --kontrol --rigtige
fi

# Tidligere lag, som de blev committet — til sammenligning, ikke til brug.
lag() { mkdir -p "$UD/$1"; for f in forslag.css greb.css greb.js; do git -C "$ROD" show "$2:docs/designforslag/$f" > "$UD/$1/$f"; done; }
lag .runde2-lag b5d5f50
lag .runde3-lag 9efcb4e

skud() { node "$HER/app-skud.mjs" "$UD/$1" "$2" "$FMT" "$DPR" "${@:3}"; }
skud foer     foer  --bredder 1440,390,360 --sider forside
skud runde2   efter --lag "$UD/.runde2-lag" --bredder 390,360 --sider forside
skud runde3-b efter --lag "$UD/.runde3-lag" --mobil moerk --bredder 390,360 --sider forside
skud b        efter --bredder 1440,390,360
node "$HER/kredit-udrulning.mjs" "$UD/kredit"
node "$HER/maal-foto.mjs" "$UD/foto" --selvproeve
node "$HER/../maalinger/proev-maal.mjs"
echo "FÆRDIG: $UD"
