#!/usr/bin/env bash
# Stopper KUN vores egen klynge, via dens egen datamappe. Rører intet
# andet og sletter ingenting — data overlever et stop.
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/cloud/miljoe.sh
if su postgres -s /bin/bash -c "$PGBIN/pg_ctl -D '$BOFINDA_PGDATA' status" >/dev/null 2>&1; then
  su postgres -s /bin/bash -c "$PGBIN/pg_ctl -D '$BOFINDA_PGDATA' -m fast -w stop" >/dev/null
  echo "✓ testbasen stoppet"
else
  echo "· testbasen kørte ikke"
fi
