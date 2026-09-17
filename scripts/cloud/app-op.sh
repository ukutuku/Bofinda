#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Starter appen mod testmiljøet — og kun mod det.
#
#  MAALING_AKTIV=1 sættes FØRST efter at forbindelsen er efterprøvet.
#  Rækkefølgen er hele pointen: målingen må aldrig kunne tændes mod en
#  base, ingen har set på. Variablerne lever i denne ene proces og
#  skrives ikke til nogen fil.
# ═══════════════════════════════════════════════════════════════
#
#  `--produktion` starter det byggede output i stedet for dev-serveren.
#  Det er den rigtige flade at TAGE SKAERMBILLEDER af: `next dev` lægger
#  sin egen udviklingsmarkør nederst i hjørnet af hver eneste side, og
#  et skærmbillede med den på dokumenterer ikke det, brugeren ser.
#  Dev bliver standarden — den genindlæser ved en ændring.
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/cloud/miljoe.sh
hemmeligheder

TILSTAND=dev
if [ "${1:-}" = "--produktion" ]; then
  TILSTAND=produktion
  [ -d .next ] || { echo "FEJL: der er intet byg. Kør 'npm run build' først." >&2; exit 1; }
  # `NEXT_PUBLIC_*` bages ind i klientbundtet ved BYG, ikke ved start.
  # Variablerne nedenfor sættes kun på processen, og et byg lavet uden
  # dem bærer standardværdierne — altså OpenStreetMaps rigtige fliser.
  # Så henter browseren fra tile.openstreetmap.org midt i en kontrol, der
  # ellers er isoleret på loopback. Det skete og kostede tre kald.
  # Byg med scripts/cloud/byg.sh, som sætter dem.
  if grep -rqs 'tile\.openstreetmap\.org' .next/static; then
    echo "FEJL: bygget bærer OpenStreetMaps flise-URL — det er ikke isoleret." >&2
    echo "      Kør 'bash scripts/cloud/byg.sh' i stedet for 'npm run build'." >&2
    exit 1
  fi
fi

URL="$(test_url)"
krav_isoleret "$URL"          # ← afviser alt andet end 127.0.0.1:55432/bofinda_test

# Ikke kun formen på strengen: SPØRG basen, hvem den er. En URL kan pege
# på det rigtige og alligevel ramme noget andet.
DATABASE_URL="$URL" node --input-type=module -e '
  import postgres from "postgres"
  const sql = postgres(process.env.DATABASE_URL, { ssl: false, max: 1, onnotice: () => {} })
  const [{ d, a, p, n }] = await sql`select current_database() d,
    inet_server_addr()::text a, inet_server_port() p,
    (select count(*)::int from listings) n`
  if (d !== "bofinda_test" || Number(p) !== 55432) {
    console.error(`FEJL: forbundet til ${d} på ${a}:${p} — ikke testbasen`); process.exit(1)
  }
  console.log(`✓ verificeret: ${d} på ${a ?? "loopback"}:${p}, ${n} boliger`)
  await sql.end()
' || { echo "FEJL: kunne ikke verificere testbasen — appen startes IKKE." >&2; exit 1; }

# Aktivserveren skal køre, ellers bliver billederne en tavs mangel.
if ! curl -sf --noproxy '*' -m 3 "http://127.0.0.1:$BOFINDA_AKTIVPORT/sund" >/dev/null; then
  echo "→ starter testaktiverne"
  BOFINDA_AKTIVPORT=$BOFINDA_AKTIVPORT nohup node scripts/cloud/aktiver.mjs \
    > "$BOFINDA_LOG/aktiver.log" 2>&1 &
  for _ in $(seq 1 20); do
    curl -sf --noproxy '*' -m 1 "http://127.0.0.1:$BOFINDA_AKTIVPORT/sund" >/dev/null && break
    sleep 0.5
  done
fi

# Mailattrappen. Den skal køre FØR appen, for appen får dens adresse med
# som miljøvariabel — og en adresse til noget, der ikke svarer, ville
# gøre en afsendelse til en timeout i stedet for en mail.
mkdir -p "$BOFINDA_LOG"
if ! curl -sf --noproxy '*' -m 3 "http://127.0.0.1:$BOFINDA_MAILPORT/sund" >/dev/null; then
  echo "→ starter mailattrappen"
  BOFINDA_MAILPORT=$BOFINDA_MAILPORT nohup node scripts/cloud/mailattrap.mjs \
    > "$BOFINDA_LOG/mailattrap.log" 2>&1 &
  for _ in $(seq 1 20); do
    curl -sf --noproxy '*' -m 1 "http://127.0.0.1:$BOFINDA_MAILPORT/sund" >/dev/null && break
    sleep 0.5
  done
fi
if ! curl -sf --noproxy '*' -m 3 "http://127.0.0.1:$BOFINDA_MAILPORT/sund" >/dev/null; then
  echo "FEJL: mailattrappen svarer ikke på 127.0.0.1:$BOFINDA_MAILPORT." >&2
  echo "      Appen startes IKKE: uden den ville en afsendelse gå ud af maskinen." >&2
  exit 1
fi

mkdir -p "$BOFINDA_LOG"
TILSTAND_KOMMANDO=$([ "$TILSTAND" = produktion ] && echo start || echo dev)

# Porten SKAL være fri. Var den optaget, ville næste kontrol få svar fra
# den gamle proces — som peger på en base, der måske ikke findes mere —
# og opstarten ville melde «✓ appen svarer» om noget helt andet. Det
# skete, og det kostede en falsk grøn browserkontrol.
if node -e '
  import("node:net").then(({ default: net }) => {
    const s = net.connect(Number(process.argv[1]), "127.0.0.1")
    s.on("connect", () => { s.destroy(); process.exit(0) })
    s.on("error", () => process.exit(1))
    setTimeout(() => { s.destroy(); process.exit(1) }, 1500)
  })' "$BOFINDA_APPPORT" 2>/dev/null; then
  echo "FEJL: port $BOFINDA_APPPORT er allerede optaget." >&2
  echo "      Kør scripts/cloud/app-ned.sh først." >&2
  exit 1
fi

echo "→ starter appen ($TILSTAND) på http://127.0.0.1:$BOFINDA_APPPORT"

# ── Miljøet for netop denne proces ──────────────────────────────
# Ingen produktionshemmeligheder. Supabase-nøglen er en ATTRAP — login,
# Storage og mail er IKKE produktionsverificeret i dette miljø, og må
# ikke omtales som om de er.
#
# MAILEN GÅR TIL LOOPBACK OG INGEN ANDRE STEDER. `MAIL_API_BASE` peger
# på attrappen, og `lib/mail.ts` AFVISER enhver værdi, der ikke er
# loopback — den falder ikke tilbage til Resend. Nøglen og afsenderen er
# attrapper; de skal være sat, fordi `maaSendeTil` kræver det, men de
# bruges kun til at komme forbi den dør, ikke til at nå nogen.
#
# Før kørte miljøet UDEN nøgle, så afsendelsen fejlede. Det så sikkert
# ud og var det på en dårlig måde: prøven kunne kun måle, at forløbet
# ikke kunne gennemføres — aldrig at det virkede.
env -u VERCEL -u VERCEL_ENV \
  MAIL_API_BASE="http://127.0.0.1:$BOFINDA_MAILPORT/emails" \
  RESEND_API_KEY="attrap_kun_til_cloudtest" \
  ALARM_AFSENDER="Bofinda testmiljoe <ingen-svar@bofinda.invalid>" \
  DATABASE_URL="$URL" \
  DATABASE_URL_DIRECT="$URL" \
  BILLED_HEMMELIGHED="$BOFINDA_BILLED_HEMMELIGHED" \
  NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:$BOFINDA_AKTIVPORT" \
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="sb_publishable_ATTRAP_kun_til_cloudtest" \
  NEXT_PUBLIC_FLISE_URL="http://127.0.0.1:$BOFINDA_AKTIVPORT/flise/{z}/{x}/{y}.png" \
  NEXT_PUBLIC_FLISE_KREDIT="Testfliser — lokalt genereret, ikke OpenStreetMap" \
  NEXT_PUBLIC_BASE_URL="http://127.0.0.1:$BOFINDA_APPPORT" \
  MAALING_AKTIV=1 \
  MAALING_IMPRESSION_PCT=100 \
  NODE_EXTRA_CA_CERTS=./certs/rapidssl-tls-rsa-ca-g1.pem \
  setsid npx next "$TILSTAND_KOMMANDO" -p "$BOFINDA_APPPORT" -H 127.0.0.1 \
  > "$BOFINDA_LOG/app.log" 2>&1 &

APPPID=$!
echo "$APPPID" > "$BOFINDA_TEST_ROD/app.pid"

# ── Procesgruppen, UDEN kapløb ──────────────────────────────────
# Procesgruppen og ikke kun pid'en: `next` er en kæde af processer, og
# en TERM til toppen efterlader serveren kørende. Underprocessen hedder
# oven i købet `next-server (v15.x)`, så dens kommandolinje bærer ikke
# porten — kun gruppen kan nå den.
#
# MEN GRUPPEN MÅ IKKE AFLÆSES FOR TIDLIGT. `setsid` kalder setsid(2)
# FØRST efter sin egen exec, og indtil da ligger barnet i DENNE skals
# procesgruppe — som er kalderens. Et `ps` umiddelbart efter kunne
# derfor nå at notere kalderens gruppe som «appens», og en oprydning,
# der sendte TERM til den gruppe, ville ramme den, der startede os, i
# stedet for appen. Målt med samme konstruktion: 0 af 300 i tomgang,
# 39 af 200 under CPU-belastning.
#
# En sessionsleder er altid leder af sin egen procesgruppe, så den
# rigtige gruppe er kendetegnet ved pgid == pid. Der ventes derfor, til
# kernen selv siger det. Gør den ikke det, har vi ingen gruppe at stå
# inde for — og så stoppes appen igen frem for at køre videre uden ejer.
#
# Aflæst i /proc og ikke med `ps`: oplysningen er den samme, og den
# kræver ikke procps i billedet. `sed 's/^.*) //'` er grådig og skærer
# derfor forbi det SIDSTE ')', så et procesnavn med en parentes i ikke
# forskyder felterne.
pgid_af() { sed 's/^.*) //' "/proc/$1/stat" 2>/dev/null | awk '{ print $3 }'; }
EGEN_PGID=$(pgid_af $$)
APPPGID=""
for _ in $(seq 1 100); do
  p=$(pgid_af "$APPPID" || true)
  if [ -n "$p" ] && [ "$p" = "$APPPID" ] && [ "$p" != "$EGEN_PGID" ]; then APPPGID="$p"; break; fi
  kill -0 "$APPPID" 2>/dev/null || break
  sleep 0.05
done
echo "$APPPGID" > "$BOFINDA_TEST_ROD/app.pgid"
for _ in $(seq 1 60); do
  # Døde vores egen proces, er der ingen grund til at vente på et svar —
  # og et svar ville i så fald komme fra nogen anden.
  if ! kill -0 "$APPPID" 2>/dev/null; then
    echo "FEJL: app-processen døde under opstart. Log:" >&2
    tail -20 "$BOFINDA_LOG/app.log" >&2
    exit 1
  fi
  if curl -sf --noproxy '*' -m 2 -o /dev/null "http://127.0.0.1:$BOFINDA_APPPORT/privatliv"; then
    echo "✓ appen svarer på http://127.0.0.1:$BOFINDA_APPPORT"; exit 0
  fi
  sleep 1
done
echo "FEJL: appen svarede ikke inden for 60 s. Log: $BOFINDA_LOG/app.log" >&2
tail -20 "$BOFINDA_LOG/app.log" >&2
exit 1
