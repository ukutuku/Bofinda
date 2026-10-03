#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Stager KUN hvis valideringen bestod.
#
#      scripts/stage-gyldig.sh <fil> [<fil> ...]
#      scripts/stage-gyldig.sh --tjek '<kommando>' <fil> [<fil> ...]
#      scripts/stage-gyldig.sh --modproev        # beviser at porten lukker
#
#  ── HVORFOR FILEN FINDES ──────────────────────────────────────
#  Under en rebase blev `package.json`s konflikt loest af et script, der
#  validerede resultatet og STOPPEDE, da valideringen fejlede. Vagten var
#  korrekt roed. Men `git add` stod som naeste saetning i samme kald, saa
#  den koerte ALLIGEVEL — og stagede filen MED konfliktmarkoerer.
#  `rebase --continue` gik igennem, og commit'en havde ugyldig JSON.
#
#  Dommen var rigtig. Der var bare ingen port, den kunne lukke.
#
#  Det er ikke en fejl i valideringen og kan derfor ikke rettes ved at
#  validere bedre. Rettelsen er at gøre staging AFHAENGIG af exitkoden i
#  stedet for at lade den staa efter den: de to maa ikke kunne koeres som
#  to selvstaendige saetninger, for saa afgoer raekkefoelgen i filen
#  resultatet frem for dommen.
#
#  Samme form som `process.exit()` inde i et `try`: `finally` springes
#  over, og oprydningen, der var skrevet, loeb aldrig.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

ud() { printf '%s\n' "$*"; }
fejl() { printf '%s\n' "$*" >&2; }

ekstra=''
if [ "${1:-}" = '--tjek' ]; then
  ekstra="${2:?--tjek kraever en kommando}"; shift 2
fi

# ── Modproeven. Porten beviser sig selv i en midlertidig git-base.
#    scripts/test-stage-gyldig.mjs kalder den fra den afledte proevekaede.
if [ "${1:-}" = '--modproev' ]; then
  arb="$(mktemp -d)"
  trap 'rm -rf "$arb"' EXIT
  git -C "$arb" init -q
  git -C "$arb" config user.email p@proeve.invalid
  git -C "$arb" config user.name 'Proeve'
  here="$(cd "$(dirname "$0")" && pwd)"

  # 1 · en fil MED konfliktmarkoerer maa ikke kunne stages.
  #     Filen er med vilje IKKE .json: en konfliktloest .json er ogsaa
  #     ugyldig JSON, saa JSON-tjekket ville fange den, selv med
  #     markoer-vagten fjernet — og tilfaeldet ville staa som bevis.
  #     Maalt: med .json var dette punkt groent, naar markoer-vagten
  #     blev fjernet. Med .txt er der kun én vagt, der kan fyre.
  printf 'a\n<<<<<<< HEAD\n1\n=======\n2\n>>>>>>> anden\n' > "$arb/x.txt"
  ko=0; (cd "$arb" && "$here/stage-gyldig.sh" x.txt) >/dev/null 2>&1 || ko=$?
  st="$(git -C "$arb" diff --cached --name-only)"
  [ "$ko" -ne 0 ] || { fejl '✗ markoerer: porten gav 0'; exit 1; }
  [ -z "$st" ]    || { fejl "✗ markoerer: staged alligevel: $st"; exit 1; }
  ud "  ✓ konfliktmarkoerer → exit $ko, intet staged"

  # 2 · ugyldig JSON maa ikke kunne stages
  printf '{ "a": }\n' > "$arb/y.json"
  ko=0; (cd "$arb" && "$here/stage-gyldig.sh" y.json) >/dev/null 2>&1 || ko=$?
  st="$(git -C "$arb" diff --cached --name-only)"
  [ "$ko" -ne 0 ] || { fejl '✗ ugyldig JSON: porten gav 0'; exit 1; }
  [ -z "$st" ]    || { fejl "✗ ugyldig JSON: staged alligevel: $st"; exit 1; }
  ud "  ✓ ugyldig JSON → exit $ko, intet staged"

  # 3 · en fejlende --tjek maa ikke kunne stages
  printf '{ "a": 1 }\n' > "$arb/z.json"
  ko=0; (cd "$arb" && "$here/stage-gyldig.sh" --tjek 'false' z.json) >/dev/null 2>&1 || ko=$?
  st="$(git -C "$arb" diff --cached --name-only)"
  [ "$ko" -ne 0 ] || { fejl '✗ fejlende --tjek: porten gav 0'; exit 1; }
  [ -z "$st" ]    || { fejl "✗ fejlende --tjek: staged alligevel: $st"; exit 1; }
  ud "  ✓ fejlende --tjek → exit $ko, intet staged"

  # 4 · og den SKAL stage, naar alt bestaar — ellers er porten blot en mur
  ko=0; (cd "$arb" && "$here/stage-gyldig.sh" z.json) >/dev/null 2>&1 || ko=$?
  st="$(git -C "$arb" diff --cached --name-only)"
  [ "$ko" -eq 0 ]    || { fejl "✗ gyldig fil: exit $ko"; exit 1; }
  [ "$st" = 'z.json' ] || { fejl "✗ gyldig fil blev IKKE staged: '$st'"; exit 1; }
  ud "  ✓ gyldig fil → exit 0, staged"

  # 5 · og en markdown-understregning er ikke en konflikt. Uden den
  #     praecisering lukkede porten for enhver .md med en setext-h1 —
  #     en port, der altid er lukket, bliver aabnet med --no-verify.
  printf 'Overskrift\n=======\n\ntekst\n' > "$arb/t.md"
  ko=0; (cd "$arb" && "$here/stage-gyldig.sh" t.md) >/dev/null 2>&1 || ko=$?
  st="$(git -C "$arb" diff --cached --name-only | tr '\n' ' ')"
  [ "$ko" -eq 0 ] || { fejl "✗ setext-markdown: exit $ko"; exit 1; }
  case " $st " in *' t.md '*) ;; *) fejl "✗ setext-markdown blev IKKE staged: '$st'"; exit 1 ;; esac
  ud "  ✓ markdown-understregning → exit 0, staged"

  ud '  ALT GROENT — porten lukker, og den aabner'
  exit 0
fi

[ "$#" -gt 0 ] || { fejl 'brug: stage-gyldig.sh [--tjek <kmd>] <fil> ...'; exit 2; }

# ── Valideringen. Hvert led skal bestaa, FOER noget stages.
for f in "$@"; do
  [ -f "$f" ] || { fejl "stage-gyldig: $f findes ikke"; exit 1; }
  # Git skriver «<<<<<<< ` med et maerkat efter. Det er dem, der er
  # entydige. Et bart `=======` er OGSAA en setext-understregning i
  # markdown, saa den taeller kun, naar en af de entydige ogsaa er i
  # filen — ellers lukkede porten for enhver .md med en h1.
  if grep -nE '^(<<<<<<<|>>>>>>>|\|\|\|\|\|\|\|) ' -- "$f" >/dev/null 2>&1; then
    fejl "stage-gyldig: $f har konfliktmarkoerer — intet staged"
    grep -nE '^(<<<<<<<|>>>>>>>|\|\|\|\|\|\|\|) |^=======$' -- "$f" | head -5 >&2
    exit 1
  fi
  case "$f" in
    *.json)
      if ! node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$f" 2>/dev/null; then
        fejl "stage-gyldig: $f er ikke gyldig JSON — intet staged"
        exit 1
      fi
      ;;
  esac
done

if [ -n "$ekstra" ]; then
  if ! sh -c "$ekstra"; then
    fejl "stage-gyldig: --tjek fejlede ($ekstra) — intet staged"
    exit 1
  fi
fi

# ── Først her. Naas kun, fordi hvert `exit 1` ovenfor ligger foer.
git add -- "$@"
ud "stage-gyldig: $# fil(er) staged efter bestaaet validering"
