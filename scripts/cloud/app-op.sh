#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Starter appen mod testmiljøet — og kun mod det.
#
#  MAALING_AKTIV=1 sættes FØRST efter at forbindelsen er efterprøvet.
#  Rækkefølgen er hele pointen: målingen må aldrig kunne tændes mod en
#  base, ingen har set på. Variablerne lever i denne ene proces og
#  skrives ikke til nogen fil.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/cloud/miljoe.sh
hemmeligheder

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

mkdir -p "$BOFINDA_LOG"

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

echo "→ starter appen på http://127.0.0.1:$BOFINDA_APPPORT"

# ── Miljøet for netop denne proces ──────────────────────────────
# Ingen produktionshemmeligheder. Ingen RESEND_API_KEY: alarmmail hører
# ikke til her, og en halvt konfigureret afsender er værre end ingen.
# Supabase-nøglen er en ATTRAP — login, Storage og mail er IKKE
# produktionsverificeret i dette miljø, og må ikke omtales som om de er.
env -u VERCEL -u VERCEL_ENV \
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
  setsid npx next dev -p "$BOFINDA_APPPORT" -H 127.0.0.1 \
  > "$BOFINDA_LOG/app.log" 2>&1 &

APPPID=$!
echo "$APPPID" > "$BOFINDA_TEST_ROD/app.pid"
# Procesgruppen, ikke kun pid'en: `next dev` er en kæde af fire
# processer, og en TERM til toppen efterlader serveren kørende.
ps -o pgid= -p "$APPPID" 2>/dev/null | tr -d ' ' > "$BOFINDA_TEST_ROD/app.pgid" || true
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
