#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Prøven for to raekker i faeldetabellen.
#
#      bash scripts/proev-kvitteringen.sh
#      bash scripts/proev-kvitteringen.sh --modproev
#
#  Begge raekker goer MAALBARE paastande, og en raekke, hvis paastand
#  ingen kan efterproeve, er en note og ikke et vaern. Derfor denne fil.
#
#  · `værktøjets-kvittering`  — de fem kommandoer med et --continue,
#    at det ER dem alle, og at hver af dem kvitterer exit 0 paa et
#    indhold med konfliktmarkoerer, men afviser det SAMME indhold
#    ustaged.
#  · `gitignore-skråstregen`  — at `git status --ignored` siger `!!`
#    for det, moensteret rammer, og tier for det, det ikke rammer.
#
#  Den roerer ikke repoet: hvert tilfaelde faar sit eget midlertidige
#  repo under `mktemp -d`, og den skriver intet uden for det.
# ═══════════════════════════════════════════════════════════════
set -uo pipefail

MARK='^(<<<<<<<|>>>>>>>|\|\|\|\|\|\|\|) |^=======$'
FORVENTET='am cherry-pick merge rebase revert'
fejl=0
ok()  { printf '  ✓ %s%s\n' "$1" "${2:+  — $2}"; }
nej() { printf '  ✗ %s%s\n' "$1" "${2:+  — $2}"; fejl=$((fejl+1)); }
tjek() { if [ "$1" = ja ]; then ok "$2" "${3:-}"; else nej "$2" "${3:-}"; fi; }

# ── A · hvilke kommandoer har et --continue? ────────────────────
# Gits egen liste, ikke en huskeliste. `filter-branch` venter ti sekunder
# paa sin advarsel; den dokumenterede variabel nedenfor fjerner ventetiden.
# `git help` gav her exit 0, men kun en besked om manglende manualsider.
# En manglende hjaelpetekst maa ikke taelles som fravaer af --continue.
# `$()` og ikke et roer: med `pipefail` er exitkoden for
# `git <c> -h | grep -q` **git's**, ikke grep's — `git <c> -h` slutter
# 129, saa `if`-en var falsk, ogsaa naar grep ramte. Foerste udgave af
# denne fil fandt derfor NUL kommandoer. Det er `rørets-exitkode` i den
# retning, hvor `pipefail` goer en VIRKENDE pipeline roed.
har_continue() { # $1 = kommando
  local h kode
  h="$(FILTER_BRANCH_SQUELCH_WARNING=1 timeout 5 git "$1" -h 2>&1)"; kode=$?
  case "$kode" in 124|137) return 2 ;; esac
  [ -n "$h" ] || return 2
  if [ "$1" = filter-branch ]; then
    case "$h" in *"usage: git filter-branch "*) ;; *) return 2 ;; esac
  fi
  case "$h" in *--continue*) return 0 ;; *) return 1 ;; esac
}
# Baade antallet og saettet skrives UD af funktionen. Foerste udgave
# taldte i en variabel, men funktionen kaldes i `$()` — altsaa en
# subshell — saa forælderens taeller blev aldrig sat, og daekningen stod
# som «af 0 kommandoer», mens proeven bestod. Et daekningstal, der er
# nul, fordi det blev taldt i et andet skal, er ikke en daekning.
samlet() { # skriver «<antal>|<saet>|<manglende hjaelp>»
  local fundet='' mangler='' c kode n=0
  while read -r c; do
    n=$((n+1))
    har_continue "$c"; kode=$?
    case "$kode" in 0) fundet="$fundet $c" ;; 2) mangler="$mangler $c" ;; esac
  done < <({ git --list-cmds=main; git --list-cmds=others; } 2>/dev/null | sort -u)
  printf '%s|%s|%s' "$n" "$(printf '%s' "$fundet" | tr ' ' '\n' | grep . | sort -u | tr '\n' ' ' | sed 's/ $//')" "$mangler"
}

# ── B · ét tilfaelde: samme bytes, staged mod ustaged ───────────
sag() { # $1 = kommando
  local arb; arb="$(mktemp -d)"
  (
    cd "$arb" || exit 9
    git init -q -b hoved . && git config user.email p@p.invalid && git config user.name P
    printf 'en\n' > f.txt && git add -A && git commit -qm base
    case "$1" in
      rebase|merge|cherry-pick|am)
        git checkout -q -b gren && printf 'gren\n' > f.txt && git commit -qam g
        git checkout -q hoved && printf 'hoved\n' > f.txt && git commit -qam h ;;
      revert)
        printf 'to\n'  > f.txt && git commit -qam anden
        printf 'tre\n' > f.txt && git commit -qam tredje ;;
    esac
    start() {
      case "$1" in
        rebase)      git checkout -q gren; git rebase hoved ;;
        merge)       git merge gren ;;
        cherry-pick) git cherry-pick gren ;;
        revert)      git revert --no-edit 'HEAD~1' ;;
        # Patchen inde i $arb, men ignoreret af git: laa den i `p/`
        # usporet, taldte den med i `git status`, og paastanden blev
        # falsk af proevens eget forlaeg og ikke af git. Og laa den i
        # `$arb/..`, laa den uden for det, der ryddes — en laekage.
        am)          printf '.patch/\n' >> .git/info/exclude
                     git format-patch -1 gren -o .patch >/dev/null 2>&1
                     git am --3way .patch/*.patch ;;
      esac >/dev/null 2>&1
    }
    # 1 · USTAGED, byte-identisk indhold → skal afvise
    start "$1"
    GIT_EDITOR=true git "$1" --continue >/dev/null 2>&1; u=$?
    # 2 · samme bytes, nu staged → kvitterer
    git add f.txt
    kvit=$(GIT_EDITOR=true git "$1" --continue 2>&1); s=$?
    m=$(git show HEAD:f.txt 2>/dev/null | grep -cE "$MARK")
    st=$(git status --porcelain | wc -l | tr -d ' ')
    printf '%s|%s|%s|%s|%s' "$u" "$s" "$m" "$st" "$(printf '%s' "$kvit" | head -1)"
  )
  rm -rf "$arb"
}

if [ "${1:-}" = '--modproev' ]; then
  # Kan proeven blive roed? Vendes det forventede saet, skal A fejle.
  FORVENTET='am cherry-pick merge rebase'
  printf '  modproeve: det forventede saet er vendt (revert fjernet)\n'
fi

printf '\n══ A · kommandoerne med et --continue ══\n'
IFS='|' read -r SCANNET FUNDET MANGLER <<< "$(samlet)"
tjek "$([ "$SCANNET" -gt 0 ] && [ -z "$MANGLER" ] && echo ja || echo nej)" \
  'opregningen er ikke tom; ingen afviste hjaelpekald' "${MANGLER:-$SCANNET kommandoer}"
tjek "$([ "$FUNDET" = "$FORVENTET" ] && echo ja || echo nej)" \
  "saettet er praecis det forventede (af $SCANNET kommandoer)" "fundet: «$FUNDET»"

printf '\n══ B · hver af dem: indekset, aldrig indholdet ══\n'
for c in am cherry-pick merge rebase revert; do
  IFS='|' read -r u s m st kvit <<< "$(sag "$c")"
  g=ja
  [ "$u" -ne 0 ] || g=nej      # ustaged skal afvise
  [ "$s" -eq 0 ] || g=nej      # staged skal kvittere
  [ "$m" -eq 3 ] || g=nej      # og commit'en baerer markoererne
  [ "$st" -eq 0 ] || g=nej     # mens traeet ser rent ud
  tjek "$g" "$c --continue" "ustaged exit $u · staged exit $s · markoerer $m · status $st · «$kvit»"
done

printf '\n══ C · gitignore: spoerg git, laes ikke moensteret ══\n'
arb="$(mktemp -d)"
(
  cd "$arb" || exit 9
  git init -q . && mkdir -p .skjult synlig && : > .skjult/x && : > synlig/x
  printf 'synlig\n' > .gitignore
  rammer=$(git status --porcelain --ignored synlig | grep -c '^!!')
  printf 'skjult\n' > .gitignore          # UDEN punktum — rammer ikke .skjult
  rammer_ej=$(git status --porcelain --ignored .skjult | grep -c '^!!')
  printf 'skjult\n.skjult\n' > .gitignore # MED punktum
  rammer_med=$(git status --porcelain --ignored .skjult | grep -c '^!!')
  printf '**/*\n' > .gitignore        # Git-wildcards matcher ogsaa punktum-praefikset
  rammer_wildcard=$(git status --porcelain --ignored .skjult | grep -c '^!!')
  printf '%s|%s|%s|%s' "$rammer" "$rammer_ej" "$rammer_med" "$rammer_wildcard"
) > "$arb/.ud"
IFS='|' read -r r rej rmed rwildcard < "$arb/.ud"; rm -rf "$arb"
tjek "$([ "$r" -ge 1 ] && echo ja || echo nej)" 'et moenster, der rammer, giver `!!`' "$r"
tjek "$([ "$rej" -eq 0 ] && echo ja || echo nej)" 'uden punktum rammer det IKKE .skjult — og tier' "$rej"
tjek "$([ "$rmed" -ge 1 ] && echo ja || echo nej)" 'med punktum rammer det' "$rmed"
tjek "$([ "$rwildcard" -ge 1 ] && echo ja || echo nej)" 'wildcard **/* rammer ogsaa .skjult' "$rwildcard"

printf '\n  git %s\n' "$(git --version | awk '{print $3}')"
if [ "$fejl" -eq 0 ]; then printf '  ALT GROENT\n'; else printf '  %s FEJL\n' "$fejl"; fi
exit $([ "$fejl" -eq 0 ] && echo 0 || echo 1)
