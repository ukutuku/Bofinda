#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Før/efter af designforslaget, fra en vilkårlig checkout.
#
#      docs/designforslag/gengivelse/gengiv.sh <checkout> <udmappe> [forslag.css]
#
#  Gengiver de rigtige komponenter (Boligkort, boligsiden, gruppesiden)
#  mod PGlite i processen — ingen server, ingen base, ingen .env — og
#  tager skærmbilleder med den checkoutens egen globals.css. Gives et
#  forslag, lægges det ovenpå, og der tages et sæt «efter» også.
#
#  FORMAT=jpeg DPR=2 giver skarpere billeder til en skærm med høj
#  opløsning. Standard er png ved 1×, som de øvrige billeder i docs/.
#
#  Sæt BEHOLD=<mappe> for at beholde de samlede HTML-sider bagefter,
#  fx til målinger. Ellers ryddes arbejdsmappen op.
#
#  Checkouten skal have node_modules. For en anden gren:
#      git worktree add --detach /tmp/ku origin/opgave/kontakt-ui
#      ln -s "$PWD/node_modules" /tmp/ku/node_modules
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
HER="$(cd "$(dirname "$0")" && pwd)"
ROD="$(cd "${1:?checkout}" && pwd)"
UD="$(mkdir -p "${2:?udmappe}" && cd "$2" && pwd)"
FORSLAG="${3:-}"
[ -n "$FORSLAG" ] && FORSLAG="$(cd "$(dirname "$FORSLAG")" && pwd)/$(basename "$FORSLAG")"
if [ -n "${BEHOLD:-}" ]; then
  A="$(mkdir -p "$BEHOLD" && cd "$BEHOLD" && pwd)"
else
  A="$(mktemp -d)"; trap 'rm -rf "$A"' EXIT
fi

node "$HER/fonte.mjs" "$A"
for hvad in kort side-kendt side-klump gruppe; do
  ud="$A/$hvad.html"; [ "$hvad" = kort ] && ud="$A/kort.json"
  ( cd "$ROD" && env -u DATABASE_URL -u DATABASE_URL_DIRECT ROD="$ROD" \
      BILLED_HEMMELIGHED=gengivelse-kun-til-skaermbilleder \
      NODE_OPTIONS="--import $HER/css-krog.mjs" \
      node_modules/.bin/tsx --tsconfig tsconfig.scripts.json "$HER/markup.mjs" "$hvad" > "$ud" )
  echo "✓ $hvad gengivet"
done
node "$HER/saml.mjs" "$A" "$ROD/app/globals.css"
node "$HER/foto.mjs" "$A" foer "$UD/foer" "${FORMAT:-png}" "${DPR:-1}"
if [ -n "$FORSLAG" ]; then
  node "$HER/saml.mjs" "$A" "$ROD/app/globals.css" "$FORSLAG" 'IBM Plex Sans'
  node "$HER/foto.mjs" "$A" efter "$UD/efter" "${FORMAT:-png}" "${DPR:-1}"
fi
