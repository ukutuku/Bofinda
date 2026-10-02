# Fældetabellen — én fil pr. række

Tabellen «Dækker ét tilfælde mindre, end man tror» i CLAUDE.md er
**genereret** af filerne her. Ret filen, ikke tabellen.

## En ny række

1. Læg en fil `faelder/<slug>.md`. Filnavnet er `slug(navn)` fra
   `lib/slug.ts`: æ → ae, ø → oe, å → aa, alt andet end a-z0-9 → bindestreg.
   `værktøjets-kvittering` ligger i `vaerktoejets-kvittering.md`.
2. Kør `npm run faelder`. Den skriver blokken i CLAUDE.md.
3. `npm test` er rød, hvis du glemte trin 2, eller hvis filen ikke kan læses.

```
---
navn: værktøjets-kvittering
form: 3
faelde: `Successfully rebased and updated refs/heads/…`
kort: (valgfri) én sætning, der står efter navnet i formlisten
kostet: (valgfri) nej — fundet ved en måling, før nogen prøve var bygget på den
---
Teksten i kolonnen «Hvad den IKKE dækker». Linjeskift bliver til
mellemrum, så den må gerne brydes. En lodret streg skrives \| som i
tabellen — ellers splitter den rækken, og filen afvises.
```

- `form` er `1`, `2`, `3`, `4` eller `ikke-vaern`. Formernes overskrifter og
  beskrivelser står i `FORMER` i `scripts/faelder.ts`. En ny form er en
  bevidst ændring dér.
- `kostet` udelades for en fælde, der har kostet mindst én omgang. Den
  sætning står under formlisterne, med undtagelserne navngivet.
- Rækkefølgen i tabellen er form og derefter navn i dansk orden. Der er
  ingen numre: navnet er identifikatoren.

## Når to grene støder sammen

To grene, der hver lægger en fil, kolliderer kun i den genererede blok i
CLAUDE.md. Tag en af siderne og kør `npm run faelder`. Blokken er
bestemt af filerne alene, så resultatet er det samme, uanset hvilken side
du tog.

## Prosaen omkring tabellen

Afsnittene efter tabellen er stadig skrevet i hånden. Prøven tjekker, at
hvert navn med bindestreg, de nævner i `**…**` eller `` `…` ``, findes som
række. Omdøber du en række, skal teksten, der nævner den, med.

## Åben post: den næste sektion — IKKE bygget

faelder/ løser én sektion af CLAUDE.md. Her står, hvor den næste ville
passe, og hvorfor den ikke er bygget. **Én sektion ad gangen:** denne
skal først have vist, at den virker gennem en rigtig fletning.

**Målt 2. oktober 2026.** Ejeren talte kl. 13.35 tolv af nitten åbne PR'er,
der skriver i CLAUDE.md: #38 #48 #50 #51 #52 #54 #55 #56 #57 #59 #60 #61.
Samme tolv er efterprøvet herfra kort efter. Den tyvende, #62, var kommet
til og rører ikke filen. CLAUDE.md er 115.078 bytes på main (`b39329a`).

**At tolv skriver i filen, er ikke det samme som at tolv støder sammen.**
Git fletter hunk for hunk; kun hunks, der overlapper eller ligger op ad
hinanden, giver konflikt. Hvert par af de elleve, der bygger på den
nuværende main, er prøveflettet med `git merge-tree`. #38 er ikke med: den
står på `45a161a`, fra før rækkerne fik navne, og konflikter med main selv.

| sted | skrives af | par i konflikt |
|---|---|---|
| CLAUDE.md · fældeafsnittet | 6 — #50 #52 #55 #56 #59 #61 | **7** |
| CLAUDE.md · «Må aldrig ske» | 7 — #48 #50 #51 #54 #57 #59 #60 | **0** |
| CLAUDE.md · «Testbasen» | 2 — #50 #60 | 1 |
| package.json · `test:kerne` | 6 — #50 #52 #56 #57 #60 #61 | **13** |
| package.json · øvrige scripts | — | 4 |

(Et afsnit er den `## `-overskrift, der står over hunkens første linje i
main. Parrene er målt to ad gangen, ikke i en rækkefølge.)

Tre ting står i tabellen:

- **Fældeafsnittet var det sted, der støder sammen**, og det er det, denne
  mappe er til. Lander #61, bliver fem PR'er beskidte i CLAUDE.md —
  #50 #52 #55 #56 #59, netop de fem, der skriver rækker — og #57 og #60 i
  package.json. Opløsningen i CLAUDE.md er mekanisk: en fil og
  `npm run faelder`. To af dem, #52 og #56, lægger en
  ny form (5 og 6), og det er en ændring i `FORMER`, ikke kun en fil.
- **«Må aldrig ske» har samme form og lige så mange skrivere, men nul
  konflikter.** Punkterne er selvstændige, hvert med sin fede overskrift,
  og de syv PR'er indsætter dem forskellige steder. Den er den næste
  kandidat efter FORM, ikke efter måling. Byg den, den dag en prøvefletning
  viser par i konflikt dér.
  «Noterede kilder» har også samme form (én post pr. kilde), og ingen åben
  PR skriver i den. Bemærk, at kildenoterne står under TO `## `-overskrifter:
  «Noterede kilder» og «LokalBolig». Den sidste har sit eget niveau og
  rummer også de undersøgte kilder. En opdeling skal samle dem først. #57
  skriver i «LokalBolig».
- **Det sted, der støder mest sammen, ligger ikke i CLAUDE.md.** Det er
  `test:kerne` i package.json: én værdi på 755 tegn, som hver PR med en ny
  prøve skriver i, og den står i 13 af de 17 par, hvor package.json
  konflikter. Det er samme form som tabellen var: ét fælles sted, alle
  føjer til. **#49 bygger svaret** uafhængigt af denne mappe og med samme
  mønster: hver prøvefil bærer sit eget `// gruppe:`-mærke, kæden udledes
  af filerne, og `test:kerne` bliver 61 tegn i stedet for 755. Den skal
  lande FØR denne PR; begrundelsen står i #61.

### Trufne valg — så de ikke genbesluttes

Begge er tilbageholdenhed, og den slags er svær at se som arbejde. Derfor
står de her som beslutninger, besluttet 2. oktober 2026.

- **Afsnitstilskrivningen er IKKE automatiseret.** Målingen ovenfor lægger
  hver hunk på den `## `-overskrift, der står over den. Det er en grov
  regel: en hunk i tabellen og en i prosaen under samme overskrift ser
  ens ud. Og det er et øjebliksbillede, der er forældet ved næste push. Et
  script, der kørte den på hver PR, ville give et tal, der så præcist ud
  og ikke var det. I stedet skriver hver session i sin PR-tekst, hvilke
  afsnit af CLAUDE.md den rører, og om den har rækker i tabellen.
- **«Må aldrig ske» er IKKE delt op.** Formen passer, men målingen bad
  ikke om det: syv skrivere og nul konfliktpar. At dele den nu ville løse
  et problem, der ikke er målt, i en fil, syv åbne PR'er skriver i. Byg
  den, når en prøvefletning viser par i konflikt dér.

Grundfejlen, de to valg værner imod, er at tælle berørte filer og slutte
om konflikter. Det er form 1 igen: et tal, der svarer på et smallere
spørgsmål end det, man læser det som.

**Mål igen, før noget af det bygges** — tallene ovenfor er et øjebliksbillede:

```sh
git fetch origin '+refs/pull/*/head:refs/remotes/pr/*'
git merge-tree --write-tree --name-only refs/remotes/pr/50 refs/remotes/pr/61
# exit 1 = konflikt; de konfliktende filer står på linjerne efter træ-id'et
```
