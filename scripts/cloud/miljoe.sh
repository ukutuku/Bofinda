# ═══════════════════════════════════════════════════════════════
#  Fælles definitioner for Cloud-testmiljøet. Sources af de andre
#  scripts — køres aldrig alene.
#
#  ALT her peger på loopback. Der er ingen vej herfra til produktionen:
#  værtsnavn, port og databasenavn er skrevet ind, og `krav_isoleret`
#  afviser enhver anden URL. Et manglende DATABASE_URL giver en fejl,
#  aldrig et fald tilbage til noget andet.
# ═══════════════════════════════════════════════════════════════

# Datamappen ligger UDEN FOR repoet med vilje: en databasefil kan ikke
# committes ved et uheld, hvis den aldrig har været i træet.
BOFINDA_TEST_ROD="${BOFINDA_TEST_ROD:-/var/lib/bofinda-test}"
BOFINDA_PGDATA="$BOFINDA_TEST_ROD/pgdata"
BOFINDA_LOG="$BOFINDA_TEST_ROD/log"

# 55432, ikke 5432. En fejlrettet forbindelse skal ramme ingenting frem
# for en tilfældig anden base.
BOFINDA_PGPORT=55432
BOFINDA_PGDB=bofinda_test
BOFINDA_PGBRUGER=bofinda_test

BOFINDA_AKTIVPORT=55433   # lokale testaktiver: billeder og kortfliser
BOFINDA_APPPORT=3100

PGBIN=/usr/lib/postgresql/16/bin

# Hemmeligheder genereres på maskinen, gemmes uden for repoet og
# udskrives aldrig. De er ikke produktionsnøgler og må heller ikke
# forveksles med nogen.
BOFINDA_HEMFIL="$BOFINDA_TEST_ROD/hemmeligheder.env"

hemmeligheder() {
  if [ ! -f "$BOFINDA_HEMFIL" ]; then
    mkdir -p "$BOFINDA_TEST_ROD"
    umask 077
    {
      echo "BOFINDA_PGKODE=$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")"
      echo "BOFINDA_BILLED_HEMMELIGHED=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
    } > "$BOFINDA_HEMFIL"
    chmod 600 "$BOFINDA_HEMFIL"
  fi
  . "$BOFINDA_HEMFIL"
}

# Forbindelsesstrengen til testbasen — den ENESTE, opsætningen accepterer.
# sslmode=disable er ærligt: loopback går ikke over nettet, og tlsFor() i
# db/client.ts fravælger allerede TLS for loopback af samme grund.
test_url() {
  hemmeligheder
  echo "postgres://${BOFINDA_PGBRUGER}:${BOFINDA_PGKODE}@127.0.0.1:${BOFINDA_PGPORT}/${BOFINDA_PGDB}?sslmode=disable"
}

# Værnet. Kaldes af hvert script, der rører data.
krav_isoleret() {
  local u="${1:-}"
  [ -n "$u" ] || { echo "FEJL: ingen DATABASE_URL. Der er ingen standardbase." >&2; exit 1; }
  node -e '
    const u = new URL(process.argv[1])
    const ok = ["127.0.0.1","localhost","[::1]"].includes(u.hostname)
      && u.port === process.argv[2]
      && u.pathname === "/" + process.argv[3]
    if (!ok) {
      console.error("FEJL: målet er ikke den isolerede testbase.")
      console.error("      forventet 127.0.0.1:" + process.argv[2] + "/" + process.argv[3])
      console.error("      fik       " + u.hostname + ":" + u.port + u.pathname)
      process.exit(1)
    }
  ' "$u" "$BOFINDA_PGPORT" "$BOFINDA_PGDB" || exit 1
}
