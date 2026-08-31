#!/bin/bash
# Én importkoersel. Kaldes af launchd hver time.
# launchd giver ingen PATH og intet arbejdskatalog — begge saettes her.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

LOG="logs/import.log"
mkdir -p logs

# Hold loggen under 20 MB. Én rotation er nok til tre doegn.
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG")" -gt 20000000 ]; then
  mv "$LOG" "$LOG.1"
fi

{
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') ==="
  npm run --silent import 2>&1
  echo "--- afsluttet $(date '+%H:%M:%S') (exit $?)"
  echo
} >> "$LOG"
