#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Rejser den isolerede testbase. Idempotent: findes klyngen, startes
#  den bare; kører den allerede, gør scriptet ingenting.
#
#  KUN LOOPBACK. listen_addresses er 127.0.0.1, og pg_hba giver kun
#  adgang derfra. Basen er ikke tilgængelig uden for maskinen.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/cloud/miljoe.sh
hemmeligheder

mkdir -p "$BOFINDA_TEST_ROD" "$BOFINDA_LOG"
chown -R postgres:postgres "$BOFINDA_TEST_ROD"

somp() { su postgres -s /bin/bash -c "$1"; }

if [ ! -s "$BOFINDA_PGDATA/PG_VERSION" ]; then
  echo "→ initdb (ny klynge)"
  # Adgangskoden går gennem en fil, ikke gennem kommandolinjen: argv er
  # synligt i ps for alle på maskinen.
  pwfil="$BOFINDA_TEST_ROD/.initpw"
  (umask 077; printf '%s' "$BOFINDA_PGKODE" > "$pwfil"); chown postgres:postgres "$pwfil"
  somp "$PGBIN/initdb -D '$BOFINDA_PGDATA' -U postgres --auth-local=trust --auth-host=scram-sha-256 --pwfile='$pwfil' -E UTF8 --locale=C" >/dev/null
  rm -f "$pwfil"

  # Loopback og intet andet. Skrevet ind, ikke arvet fra en standard.
  cat >> "$BOFINDA_PGDATA/postgresql.conf" <<CONF

# ── Bofinda Cloud-testmiljø ────────────────────────────────────
listen_addresses = '127.0.0.1'
port = $BOFINDA_PGPORT
unix_socket_directories = '$BOFINDA_TEST_ROD'
fsync = off                  # et testmiljø, ikke data nogen savner
full_page_writes = off
synchronous_commit = off
CONF
  # Kun loopback i pg_hba. Ingen 'host all all 0.0.0.0/0'.
  cat > "$BOFINDA_PGDATA/pg_hba.conf" <<HBA
local   all   all                  trust
host    all   all   127.0.0.1/32   scram-sha-256
host    all   all   ::1/128        scram-sha-256
HBA
  chown postgres:postgres "$BOFINDA_PGDATA/pg_hba.conf"
fi

if somp "$PGBIN/pg_ctl -D '$BOFINDA_PGDATA' status" >/dev/null 2>&1; then
  echo "→ basen kører allerede (port $BOFINDA_PGPORT)"
else
  echo "→ starter postgres på 127.0.0.1:$BOFINDA_PGPORT"
  somp "$PGBIN/pg_ctl -D '$BOFINDA_PGDATA' -l '$BOFINDA_LOG/postgres.log' -w -t 30 start" >/dev/null
fi

# Rolle og database — begge idempotente.
psqlp() { somp "$PGBIN/psql -h '$BOFINDA_TEST_ROD' -p $BOFINDA_PGPORT -U postgres -d postgres -tAc \"$1\""; }
if [ "$(psqlp "select 1 from pg_roles where rolname='$BOFINDA_PGBRUGER'")" != "1" ]; then
  echo "→ opretter rollen $BOFINDA_PGBRUGER"
  somp "$PGBIN/psql -h '$BOFINDA_TEST_ROD' -p $BOFINDA_PGPORT -U postgres -d postgres -c \"create role $BOFINDA_PGBRUGER login password '$BOFINDA_PGKODE' superuser\"" >/dev/null
fi
if [ "$(psqlp "select 1 from pg_database where datname='$BOFINDA_PGDB'")" != "1" ]; then
  echo "→ opretter databasen $BOFINDA_PGDB"
  psqlp "create database $BOFINDA_PGDB owner $BOFINDA_PGBRUGER" >/dev/null
fi

echo "✓ testbasen kører: 127.0.0.1:$BOFINDA_PGPORT/$BOFINDA_PGDB (kun loopback)"
