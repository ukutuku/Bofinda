#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Importér ÉN kilde til den isolerede testbase — og kun den.
#
#      docs/designforslag/gengivelse/importer-testbase.sh <slug>
#
#  Målet står i scriptets navn og i scriptet selv. Det kommer aldrig fra
#  .env og aldrig fra det, der tilfældigvis er eksporteret i skallen:
#    · DATABASE_URL_DIRECT sættes HER, af test_url, og krav_isoleret
#      afviser alt andet end 127.0.0.1:55432/bofinda_test;
#    · er DATABASE_URL, DATABASE_URL_DIRECT eller RESEND_API_KEY sat i
#      forvejen, afbrydes der med exit 3 — skallen har nøgler til noget
#      uden for containeren, og så er den forkerte skal at importere fra
#      (samme vagt og samme kode som scripts/proeve-storage/vagter.ts på
#      grenen claude/tender-noether-tjb6fs);
#    · importøren kaldes direkte, ikke gennem `npm run import`, som kører
#      med --env-file-if-exists=.env.
#  scripts/import.ts matcher og SENDER alarmer i samme kørsel. Uden
#  RESEND_API_KEY i processen er der intet at sende med.
#
#  Før ca32bb2 stod importen i GREB-3.md som fem løse linjer, hvor
#  vagten var én af dem. En kommando i dokumentation er en kommando,
#  nogen kører — og nogen kopierer kun den sidste linje.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
SLUG="${1:?brug: importer-testbase.sh <slug>   (fx propstep, dacas, balder)}"
for v in DATABASE_URL DATABASE_URL_DIRECT RESEND_API_KEY; do
  if [ -n "${!v:-}" ]; then
    echo "FEJL: $v er sat i skallen. Importen til testbasen sætter selv sit mål;" >&2
    echo "      kør den i en skal uden produktionens nøgler (fx uden 'source .env')." >&2
    exit 3
  fi
done
HER="$(cd "$(dirname "$0")" && pwd)"; ROD="$(cd "$HER/../../.." && pwd)"
source "$ROD/scripts/cloud/miljoe.sh"
URL="$(test_url)"; krav_isoleret "$URL"
cd "$ROD"
echo "→ importerer «$SLUG» til $(node -e 'const u=new URL(process.argv[1]);console.log(u.hostname+":"+u.port+u.pathname)' "$URL") (den isolerede testbase)"
exec env DATABASE_URL_DIRECT="$URL" NODE_EXTRA_CA_CERTS=./certs/rapidssl-tls-rsa-ca-g1.pem \
  npx tsx scripts/import.ts "$SLUG"
