# Fjerde runde: fokus i lysbordet, og et landkort der kan afprøves

Bygger på `99731e9`. To uafhængige opgaver.

## 1. Lysbordet var ikke en modal — det påstod bare at være det

**Fundet, reproduceret før rettelsen** på en bolig med fem billeder, på
begge bredder:

| | |
|---|---|
| fokus flyttes ind ved åbning | ✗ fokus blev stående på `BUTTON.flere` |
| Tab kan ikke forlade lysbordet | ✗ 21 af 30 tryk landede udenfor — «Boligen», «Faciliteter», «Pris pr. m²» |
| Shift+Tab ditto | ✗ 20 af 30 |
| fokus vender tilbage ved lukning | ✗ fokus faldt til `<body>` |

Lysbordet var et `<div role="dialog" aria-modal="true">`. Attributten
lover tre ting, et div ikke kan holde.

**Rettelsen** er et rigtigt `<dialog>` åbnet med `showModal()`. Browseren
giver alle tre. Det er den samme løsning som filtervinduet i
`app/Filterdialog.tsx` — der skal være ét svar på «hvordan laver vi en
modal», ikke to. En håndskrevet fokusfælde ville være det andet udtryk
for det samme spørgsmål.

To ting følger af det:

- **Dialogen er monteret bestandigt** og åbnes og lukkes med metoderne.
  Lod vi React afmontere den, ville browseren aldrig se `close()` — og så
  er der ingen til at give fokus tilbage. Indholdet renderes stadig kun
  når den er åben, så 1600px-varianterne først hentes ved åbning.
- **Escape står ikke længere i keydown-lytteren.** En modal dialog sender
  `cancel`, som `onCancel` fører gennem `luk`. Én vej ud.

CSS'en nulstiller UA-stilen for `dialog` (fit-content, margin auto, ramme,
1em polstring, CanvasText), så udseendet er uændret. `display: grid` står
på `[open]`: uden betingelsen ville UA-reglen
`dialog:not([open]) { display: none }` blive slået ud, og lysbordet stod
åbent hele tiden.

**Bevaret og målt:** åbning på det første billede (1 / 5), piletast (2 / 5),
miniature (1 / 5), Escape.

**Ny kontrol:** `scripts/cloud/lysbordkontrol.mjs` følger brugerens trin —
åbn, vælg sidste miniature, tab 30 gange frem og 30 tilbage, Escape — på
1440 og 390 px. Skrevet **før** rettelsen og fejlede på netop de fire
fokuslinjer.

Tre påstande, der antog at `.lysbord` **forsvinder** fra DOM'en, er rettet
til at måle `open` og `display`. Dialogen er monteret med vilje nu, så
«findes ikke» er ikke længere målet på, om den er lukket — og de nye
påstande er skrappere: de fanger også en lukket dialog, der blev stående
synlig.

## 2. Landkortet stod tomt i previewet

**Det var ikke kortet, der var i stykker.** `staging-demo.sql` indsatte 16
fiktive boliger uden koordinater, og `LAES-MIG.md` sagde det rent ud:
*«Der er ingen koordinater eller DAR-identifikatorer. Datasættet afprøver
derfor ikke kortplacering.»* Der var ikke noget at sætte på kortet.

**`staging-demo-koordinater.sql`** giver koordinater til 8 af de 16. De
øvrige 8 bliver bevidst uden, så begge situationer kan afprøves i det
samme preview:

| Søgning | Boliger | Kortet |
|---|---:|---|
| 9001 Prøveby · 4 lejligheder | 4 | ét mærke med tallet 4 |
| 9001 Prøveby · 4 værelser | 4 | intet mærke — nævnt i noten under kortet |
| 9002 Attrapby · 4 lejligheder | 4 | ét mærke med tallet 4 |
| 9003 Fiktivby · 4 rækkehuse | 4 | intet kort, men en forklaring |

En søgning på 9001 viser altså **begge tilstande på én skærm**.

**Koordinaterne gives pr. GRUPPE, ikke pr. bolig.** Målt: de 16 danner
fire gruppekort, og kortet viser ét mærke pr. KORT med gruppens antal. Fik
kun nogle af en gruppes boliger en koordinat, ville mærket forsvinde den
dag repræsentanten skifter — den vælges på billedantal, så kendt total,
så alder.

**Værdierne er fixtureværdier**, af samme slags som
`address_match_level='unit'` i det oprindelige datasæt. De ligger i et
regelmæssigt gitter med 0,004° / 0,006° mellemrum nord for Aalborg.
Gitteret er med vilje: fire mærker på snorlige rækker ligner ikke rigtige
adresser. Ingen af punkterne svarer til en rigtig adresse.

**Sikkerhed, efterprøvet.** Hver sætning kræver **både** et id fra
`manifest.json` **og** demokildens `source_id`. Målt i testbasen efter
kørslen: `0` rigtige boliger ramt. Filen er idempotent — anden kørsel gav
8 × `UPDATE 1` med de samme værdier — og har en udkommenteret
tilbagerulning nederst.

**Den kan ikke køres af et byg.** Det er ikke en migration, ligger ikke i
`db/migrations`, og `erDesignpreview()` afgrænser i forvejen demodata til
`VERCEL_ENV === 'preview'` på netop staging-projektet.

### Ny kontrol: viser kortet de samme boliger som listen?

`scripts/cloud/kortsynk.mjs`. Kortet og listen er to visninger af ét
resultat, bygget af hver sin løkke i `app/page.tsx` — `maerker` og
`visninger`. To udtryk for det samme spørgsmål.

Invarianten, målt på tre stadig snævrere søgninger:

```
alle boliger   47 mærker, 48 kort · 98 på kortet, 102 i listen · 4 uden mærke nævnt
+ prisfilter   48 mærker, 48 kort · 98 på kortet,  98 i listen · liste 102→98
+ areal        48 mærker, 48 kort · 74 på kortet,  74 i listen · liste 98→74
```

Aldrig flere mærker end kort, kortet dækker aldrig flere boliger end
listen, boliger uden mærke er altid nævnt, og et snævrere filter giver
hverken flere kort eller flere mærker.

Mobil: listevisning skjuler kortet, kortvisning skjuler listen, og skiftet
ændrer ikke resultatet (102 boliger begge veje).

Demodataene har eksakte tal: 16 boliger → 4 gruppekort → 2 mærker à 4, og
de 8 uden koordinat nævnt under kortet. Filter «lejlighed» → 8 boliger,
alle 8 på kortet, ingen note. Filter «værelse» → 4 boliger, 0 mærker,
«Kortet kan ikke vise denne søgning».

**Negativ kontrol:** koordinaterne blev rullet tilbage med filens egen
rollback, og **5 påstande blev røde** — nøjagtig den tilstand, previewet
har i dag. Derefter sat tilbage og kørt grøn igen.

Findes demokilden ikke i basen, springes blokken over **med en linje**,
ikke i tavshed. Og overskriften viser de **målte** tal, ikke skrevne: er
koordinaterne væk, står der `(16 boliger, 0 med koordinat)` og en advarsel.

### Én logline rettet

`kortkontrol.mjs` sluttede med «testdata gendannet (N rækker har stadig
indflytning eller forbehold)». Den talte **hver eneste** række i basen med
en indflytningspris — så med demodataene inde stod der «16 rækker», som om
oprydningen var mislykkedes. Den havde ikke rørt dem. Den tæller nu kun de
to prøverækker: «0 af 2».

## Kontroller

Isoleret testmiljø, produktionsbyg, syntetiske data **plus** demodataene
og deres koordinater.

| Kontrol | Resultat |
|---|---|
| `npx tsc --noEmit` | rent |
| `npm test` (PGlite) | ALT GRØNT |
| `kortkontrol.mjs` | 124 |
| `filterkontrol.mjs` | 129 |
| `browserkontrol.mjs` · `…-pagination.mjs` · `lancering.mjs` | grønne |
| `fotokontrol.mjs` | alt grønt |
| `lysbordkontrol.mjs` **(ny)** | alle fokuskontroller bestået |
| `kortsynk.mjs` **(ny)** | liste og kort siger det samme |

## Udeståender

1. **Koordinaterne er ikke indsat i staging.** Jeg har hverken adgang
   eller nøgle herfra, og et tidligere forsøg blev afvist med
   `cannot execute INSERT in a read-only transaction`. Filen skal køres i
   Supabases SQL Editor på projekt `prgmenbwabwkgitjclrj`.
2. **Kortfliserne er kun set som lokale testfliser.** Hvordan mærkerne
   ligger på et rigtigt kort over Aalborg er ikke set.
3. **To mærker er et tyndt kort.** De 16 demoboliger danner fire grupper,
   så flere mærker kræver flere demoboliger med andre vejnavne eller
   værelsestal — det ville være en ændring af det eksisterende datasæt.
