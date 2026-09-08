#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Stopper KUN de processer, dette miljø selv startede.
#
#  Ikke via `ss`: den findes ikke i cloud-containeren, og et opslag,
#  der stille finder ingenting, meldte «✓ stoppet» om processer, der
#  kørte videre — hvorefter næste opstart ramte EADDRINUSE og lod den
#  GAMLE app svare på en base, der var slettet.
#
#  I stedet: procesgruppen fra opstarten, og derefter /proc-scanning
#  efter vores egne kendetegn. Begge dele er præcise nok til aldrig at
#  ramme en fremmed proces.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/cloud/miljoe.sh

stoppet=0

# 1 · Procesgruppen, hvis app-op.sh nåede at skrive den.
if [ -f "$BOFINDA_TEST_ROD/app.pgid" ]; then
  pgid=$(cat "$BOFINDA_TEST_ROD/app.pgid")
  if kill -TERM -- "-$pgid" 2>/dev/null; then
    echo "· stoppet procesgruppe $pgid"; stoppet=$((stoppet + 1))
  fi
  rm -f "$BOFINDA_TEST_ROD/app.pgid"
fi

# 2 · Vores egne kendetegn i /proc. Mønstrene navngiver BÅDE kommandoen
#     og vores egne portnumre — en fremmed next-proces på en anden port
#     rammes ikke.
#
#     Pid'erne samles FØRST og dræbes bagefter: scanner og dræber man i
#     samme løkke, kan scriptet nå at ramme sin egen proceskæde, og en
#     proces, der forsvinder undervejs, får læsningen til at fejle.
egne=" $$ $PPID "
mine=""
for d in /proc/[0-9]*; do
  pid=${d#/proc/}
  case "$egne" in *" $pid "*) continue ;; esac
  cmd=$(cat "$d/cmdline" 2>/dev/null | tr '\0' ' ') || continue
  [ -n "$cmd" ] || continue
  for m in "next dev -p $BOFINDA_APPPORT" "scripts/cloud/aktiver.mjs"; do
    case "$cmd" in *"$m"*) mine="$mine $pid" ;; esac
  done
done
for pid in $mine; do
  kill -TERM "$pid" 2>/dev/null && { echo "· stoppet pid $pid"; stoppet=$((stoppet + 1)); } || true
done

# 3 · Efterprøv. En nedtagning, der ikke kan bevise sit resultat, er
#     præcis den fejl, der kostede en falsk grøn browserkontrol.
sleep 1
for p in "$BOFINDA_APPPORT" "$BOFINDA_AKTIVPORT"; do
  if node -e '
    import("node:net").then(({ default: net }) => {
      const s = net.connect(Number(process.argv[1]), "127.0.0.1")
      s.on("connect", () => { s.destroy(); process.exit(0) })
      s.on("error", () => process.exit(1))
      setTimeout(() => { s.destroy(); process.exit(1) }, 1500)
    })' "$p" 2>/dev/null; then
    echo "ADVARSEL: port $p svarer stadig — noget kører videre." >&2
    exit 1
  fi
done
rm -f "$BOFINDA_TEST_ROD/app.pid"
echo "✓ app og testaktiver stoppet ($stoppet processer). Basen kører videre — brug db-ned.sh"
