# Mærkaten «ny»: hvor mange kort ville hedde «Ny i dag»?

*30. september 2026. Tallene i afsnit 4 kommer fra den **syntetiske**
testbase (280 opdigtede boliger), ikke fra produktionen. Produktionen kan
ikke nås herfra. Afsnit 6 er et **skøn**, ikke en måling.*

## 0. Svaret først

- **Af hele bestanden bliver «Ny i dag» aldrig flertallet.** Andelen er
  nye pr. døgn delt med bestanden. Med de tal, repoet har, er skønnet
  cirka 1,3–1,9 % ved skønnet (25–35 nye pr. døgn), og 1–5 % over hele
  følsomhedstabellen i afsnit 6.
- **På forsidens første side bliver det flertallet.** Siden er sorteret med
  de nyeste først, så de 48 kort er netop dem med størst chance for at få
  mærkaten. Det nuværende vindue på 72 t dækker **alle 48 kort**, så snart
  der kommer mindst 16 nye boliger i døgnet. Et vindue på 24 t dækker
  flertallet af dem fra omkring 24 nye i døgnet. Den første række står
  med «Ny i dag» næsten uanset tallene.
- **Designlagets omdøbning er forkert.** Den læser `siden()`s afrundede
  tekst i stedet for datoen. Derfor hedder alt under 23 t 29,5 min
  «Ny i dag», også en bolig, vi så kl. 12 i går. Se afsnit 2.
- **Kortets egen påstand holder ikke på forsiden.** Den siger, at mærkaten
  «gælder få kort ad gangen» og betyder noget, «netop fordi den er
  sjælden». Mærkaten er sjælden i bestanden, men samler sig lige dér, hvor
  listen begynder. Se afsnit 9.
- **Produktionstallet mangler.** Hvor mange nye boliger der kommer pr. døgn,
  står intet sted i repoet. Scriptet måler det med én kommando (afsnit 7).

## 1. Logikken, som den er

| Hvad | Hvor | Hvordan |
|---|---|---|
| Kortets alder | `app/Boligkort.tsx:153` | `paaMarkedet = b.hosKilden ?? b.foerstSet`, dvs. kildens dato (`source_created_at`), ellers `first_seen_at` |
| Mærkat eller ej | `app/Boligkort.tsx:154` | `Date.now() − paaMarkedet < 3 døgn` (72 t, rullende) |
| Teksten | `app/Boligkort.tsx:216-217` | `ny {siden(paaMarkedet)}`, fx «ny for 20 timer siden» |
| Gruppekortet | `app/Boligkort.tsx:396, 453-454` · `lib/soeg.ts:850-851` | Alderen er gruppens nyeste medlem, `max(coalesce(source_created_at, first_seen_at))`. Mærkaten lyder «ny bolig {siden(…)}» |
| Sorteringen «nyeste» | `lib/soeg.ts:408` (grupper: `:680`) | `NYHEDSDATO desc nulls last` |
| `NYHEDSDATO` | `lib/soeg.ts:374-375` | `coalesce(source_created_at, BAGKATALOG ? null : first_seen_at)` |
| `BAGKATALOG` | `lib/soeg.ts:355-363` · `lib/indkoering.ts` | Boligen har ingen kildedato og blev set senest `INDKOERING_TIMER` (24) efter kildens første kørsel. `native` er undtaget |

**Hvad `siden()` præcis siger** (`app/Boligkort.tsx:75-86`). Funktionen
runder først millisekunder til minutter, så minutter til timer og så timer
til døgn. Grænserne er derfor ikke hele timer. Tabellen er regnet ud af
formlen, og prøven efterprøver fire af grænserne:

| Tekst | Alder |
|---|---|
| «lige nu» | under 30 s |
| «for N min. siden» | 30 s – 59 min 30 s |
| «for 1 time siden» | 59,5 min – 1 t 29,5 min |
| «for N timer siden» | til 23 t 29,5 min |
| «for 1 dag siden» | 23 t 29,5 min – 35 t 29,5 min |
| «for 2 dage siden» | 35 t 29,5 min – 59 t 29,5 min |
| «for 3 dage siden» | 59 t 29,5 min – 72 t (så falder mærkaten af) |

«1 dag» betyder altså 23,5–35,5 timer. Det har intet med kalenderen at
gøre.

## 2. Fejlen i omdøbningen

Omdøbningen står i `docs/designforslag/greb.js:44-50` (HEAD) og i
runde 2-lagets kopi af samme fil. Den læser den færdige tekst: indeholder den
`min.`, `time` eller `lige nu`, bliver den til «Ny i dag». «1 dag» bliver
til «Ny i går», og ellers står der «Ny · N dage».

**Den er forkert på tre måder.** Alle tre er efterprøvet i prøven, med
referencetidspunktet 30. september kl. 08:00 dansk tid:

1. **«Ny i dag» er rullende under 23,5 t, ikke i dag.** Kl. 08:00 dækker det
   alt, vi har set siden kl. 08:30 i går. Prøvens bolig r2 blev set kl. 12
   i går og kaldes «Ny i dag»; kalenderen siger «i går». Det samme gælder
   r11, set kl. 23 i går. Om morgenen er størstedelen af «Ny i dag» altså
   gårsdagens boliger.
2. **«Ny i går» dækker 23,5–35,5 t.** Kl. 08:00 rækker det tilbage til i
   forgårs kl. 20:30. Prøvens bolig r4 blev set kl. 22 i forgårs og kaldes
   «Ny i går». Omvendt får en bolig fra i dag kl. 00:00–00:30 teksten
   «Ny i går» mellem 23:30 og midnat.
3. **Den gætter datoen ud fra en tekst, vi selv har bygget.** Det er samme
   fejl som at genparse `address_raw` for native, og CLAUDE.md forbyder
   netop det: oplysningen findes, men den smides væk og gættes igen.

I scriptets udskrift hedder kolonnen «ord ≠ kalender». Hvor mange kort den
rammer i produktionen, afhænger af klokkeslættet: flest om morgenen og
næsten ingen om aftenen.

**Rettelsen hører til Frontend, og jeg har ikke lavet den.** Teksten skal
regnes af datoen. Kalenderdagen i København findes allerede som
`kalenderdag()` i `lib/dato.ts:45`, og `nu` skal komme fra siden. Resultatet
er 0 dage → «Ny i dag», 1 → «Ny i går», ellers «Ny · N dage». Det skal
beregnes ét sted, som begge korttyper bruger.

**To fejl, der var der i forvejen, følger med:**

- **Mærkaten mangler indkøringsvagten.** Det er allerede noteret i
  `docs/designforslag/GREB.md:203`, og prøven bekræfter det: bolig r11 er
  bagkatalog og har `NYHEDSDATO` = null, men kortet skriver alligevel
  «ny for 9 timer siden». Når en kilde uden egne datoer kobles på, står
  hele dens bagkatalog med «ny» i tre døgn. Sorteringen og mærkaten svarer
  hver sin vej på det samme spørgsmål.
- **Enkeltkortet og gruppekortet bruger hver sit ur.** Kommentaren i
  `app/Boligkort.tsx:148` siger «aldrig fra Date.now(): referenceNow kommer
  eksplicit fra siden». Alligevel regner enkeltkortet `nyligt` med
  `Date.now()` (`:154`), og det gør `siden()` også (`:77`). Gruppekortet
  bruger derimod `nu` (`:396`). I praksis er forskellen millisekunder, men
  det er to udtryk for det samme spørgsmål. Scriptet fastfryser
  `Date.now()` til `nu` under gengivelsen, så begge korttyper måles mod
  samme tidspunkt.

## 3. Målescriptet `maal-ny.mjs`

Scriptet går gennem sidens egne funktioner og har intet eget prædikat for
«synlig» eller «ny»:

- `soeg()` og `soegGrupperet()` bruger `hvorVist`: aktive boliger uden
  fejlet adresse og med dubletter fjernet.
- Forsidens filtre kommer fra `filtreFraParametre({})`.
- Antallet af kort pr. side, `PR_SIDE`, læses direkte ud af `app/page.tsx`.
  Det er 48.
- `NYHEDSDATO` og `kalenderdag()` importeres fra appen.
- **Mærkaten læses af det rigtige kort.** `Kort` og `Visningskort`
  gengives med `renderToStaticMarkup`, og teksten i `.m-ny` tages ud af
  markuppen. For hvert kort tjekkes desuden, at den gengivne mærkat passer
  med 72-t-reglen.

**Scriptet kan ikke skrive:**

- Koden indeholder kun `select`.
- Under `--base` sættes forbindelsen til
  `default_transaction_read_only = on`, og det efterprøves med `SHOW` både
  før og efter målingen.
- Transaction-pooleren på port 6543 afvises, fordi den ikke kan holde en
  skrivebeskyttet session.
- `--proeve` afviser at køre, hvis `DATABASE_URL` er sat.

**Prøven (`--proeve`)** kører i PGlite og sår 18 boliger fordelt på tre
kilder, med et fast tidspunkt (30. september, 06:00 UTC):

- boliger på hver side af `siden()`s grænser (2 t, 20 t, 23 t 40 min, 34 t,
  50 t, 70 t, 80 t og 10 døgn)
- én bolig, hvor kildens egen dato vinder over vores
- én bagkatalog-bolig fra en kilde, der stadig kører ind
- et dublet-par og én afmeldt bolig
- en gruppe på to
- en bolig set kl. 01:30 dansk tid, som er 23:30 UTC dagen før. Den fanger
  en kalender, der er regnet i UTC.

Prøven består med exit 0. Tre bevidste fejl gjorde den rød hver gang, med
exit 1:

| Indført fejl | Hvad prøven fangede |
|---|---|
| Kalenderen regnet i UTC | `a.kalender-i-dag` |
| 72 t ændret til 48 t | Krydstjekket og `b.hul` |
| Kildens dato ignoreret | `a.under-24t` og krydstjekket |

## 4. Resultat mod den lokale base — SYNTETISK

Målt 30. september 2026 kl. 17.08 dansk tid mod `127.0.0.1:55432/bofinda_test`
(loopback, ikke produktionen). Udskriften kommer igen med `--base` mod testbasen.

| | Mærkat (< 72 t) | «Ny i dag»: designlaget | «Ny i dag»: < 24 t | «Ny i dag»: kalenderdag |
|---|---|---|---|---|
| a) Alle synlige boliger (279) | 36 · 12,9 % | 0 | 0 | 0 |
| b) Samme, regnet af `NYHEDSDATO` | 36 · 12,9 % | — | 0 | 0 |
| c) Forsiden, første 3 kort | 3/3 | 0 | 0 | 0 |
| c) Forsiden, første 12 kort | 12/12 | 0 | 0 | 0 |
| c) Forsiden, side 1 (48 kort) | 32/48 · 66,7 % | 0 | 0 | 0 |
| d) Postnr- og bysøgninger, side 1 (8 søgninger) | snit 18,5 % · median 17,4 % | 0 | 0 | 0 |

**Seedet kan ikke svare på spørgsmålet.** `scripts/cloud/saa.mjs` giver
alle boliger en alder i hele dage, mindst 1 (`:145, 192, 217`). Den nyeste
bolig er derfor lige over 24 t gammel, og ingen kan hedde «Ny i dag».
Derfor så brugeren «Ny i går» overalt. Alligevel viser seedet
**mekanismen**: kun 12,9 % af bestanden har mærkaten, men den sidder på
12 af de første 12 kort og på 32 af 48 på side 1.

## 5. Produktionstal i repoet

**Bestanden:**

| Dato | Tal | Hvor |
|---|---|---|
| 4. sep. 2026 | 1.226 synlige | `CLAUDE.md:86-87` |
| 6. sep. 2026, 07:28 UTC | 1.468 synlige, 1.446 unikke | `docs/supply-baseline-2026-09-06.md:1, 12, 14` |
| 8. sep. 2026 | «1.814 boliger» og 985 kort (1,84 bolig pr. kort) | `lib/soeg.ts:970-972` · commit `96d3e31` |
| 12. sep. 2026 | 1.782 synlige («opgivet måling … udført uden for denne session») | commit `3dba93a` |
| 23. sep. 2026 | **1.864 synlige** | `lib/grundlag.ts:19` |

**Tilgangen (nye pr. døgn pr. kilde) står ingen steder.**
`npm run puls` regner den ud (`scripts/puls.mjs:35-40`), men dens udskrift
er aldrig gemt. Den grupperer desuden på `first_seen_at` uden
bagkatalogvagt, så første import tæller med som «nye».

Bestandens udvikling kan ikke bruges i stedet. Hoppet mellem 4. og 8.
september er nye kilder: home, CEJ, Heimstaden, Birch, Laros og Alabu kom
til 6.–7. september (`adapters/index.ts`, git-loggen). Fra 12. til 23.
september er der ikke tilføjet kilder, og nettotilvæksten er +82 på 11
døgn, altså +7,5 pr. døgn. Det er kun en nedre grænse for tilgangen, og kun
hvis de to målinger tæller det samme.

**Kilderne:** registret har **11** rigtige kilder, ikke seks
(`adapters/index.ts:51-119`). Kun fire af dem sætter `source_created_at`:
cej, findbolig, lokalbolig og propstep. For de øvrige syv er «ny» det
tidspunkt, vi så boligen.

## 6. Skøn

**Tilgangen:** I en stabil bestand er nye pr. døgn (N) lig bestanden (S)
delt med den gennemsnitlige tid på markedet (L). Andelen af bestanden
under 24 t er da cirka 1/L, og andelen under 72 t cirka 3/L.

**Det eneste tal i repoet, der siger noget om L,** er «en medianalder på
37 dage ved første syn» for varslerne i én prøvekørsel — 68 falske varsler
ud af 87, ikke hele bagkataloget (`lib/alarm.ts:29-31`,
`CLAUDE.md:325-326`; målingens dato er ikke oplyst, men den står i repoet
fra 6. september):

- Hvis levetiderne falder som en eksponentialfordeling, giver det
  L ≈ 37 / ln 2 ≈ 53 døgn.
- Hvis alle lever lige længe, giver det L ≈ 74 døgn.
- Lange haler, som LokalBoligs annoncer fra september 2025
  (`lib/soeg.ts:1671`), får medianalderen til at overdrive L. Den rigtige
  L er derfor nok snarere lavere, og så er tilgangen højere.

**Et bud er N ≈ 25–35 nye pr. døgn.** Det er et skøn på en model, ikke en
måling.

Med S = 1.864 (23. september):

| L (døgn) | Nye pr. døgn | Andel af bestanden < 24 t | Andel < 72 t | Forsiden: kort med mærkat (72 t) | Forsiden: «Ny i dag» (< 24 t) |
|---|---|---|---|---|---|
| 20 | 93 | 5,0 % | 15,0 % | 48/48 | 48/48 |
| 30 | 62 | 3,3 % | 10,0 % | 48/48 | 48/48 |
| 39 | 48 | 2,6 % | 7,7 % | 48/48 | 48/48 (grænsen) |
| **53** | **35** | **1,9 %** | **5,7 %** | **48/48** | **≈ 35/48 (73 %)** |
| **74** | **25** | **1,4 %** | **4,1 %** | **48/48** | **≈ 25/48 (52 %)** |
| 117 | 16 | 0,9 % | 2,6 % | 48/48 (grænsen) | ≈ 16/48 (33 %) |
| 180 | 10 | 0,6 % | 1,7 % | ≈ 31/48 | ≈ 10/48 |

Tallene for forsiden er et **loft**. En ny bolig, der lander i en gruppe,
giver ikke et nyt kort (8. september var der 1,84 bolig pr. kort).

**Sådan skal tabellen læses:**

- **Bestanden:** «Ny i dag» er aldrig flertallet, heller ikke tæt på.
- **Forsidens side 1 med 72-t-mærkaten:** alle 48 kort har den, så snart
  der kommer mindst 16 nye i døgnet. Det sker for enhver L under cirka
  117 døgn.
- **Forsidens side 1 med «Ny i dag» (< 24 t):** flertallet ved mindst 24
  nye i døgnet (L under cirka 78). Den første række (3 kort) er fuld ved
  blot 3 nye i døgnet.
- **«Ny i dag» efter kalenderdag afhænger af klokkeslættet.** Kl. 08 er
  næsten intet «i dag», mens det om eftermiddagen nærmer sig tallet for
  24 t, fordi boligerne kommer i arbejdstiden.
- **Smalle søgninger er anderledes.** Har en søgning under 48 boliger, står
  de alle på side 1, og andelen med mærkat er da bare cirka 3/L, altså
  4–6 %. Her er mærkaten sjælden og siger noget. Kun de største byer
  nærmer sig forsidens billede. København og Frederiksberg havde 396
  boliger 6. september (`docs/supply-baseline-2026-09-06.md:12`), og det
  giver cirka 3·35·396/1.446 ≈ 29 af 48 kort med mærkat.

## 7. Kommandoen til John

Kør den fra roden af checkout'et, hvor `.env` ligger. Scriptet skal ligge
et sted inde i repoet, så `postgres` og `drizzle-orm` kan findes, fx
`docs/designforslag/maalinger/maal-ny.mjs`:

```bash
cd ~/Bofinda
ROD=$PWD npx tsx --tsconfig tsconfig.scripts.json --env-file=.env \
  docs/designforslag/maalinger/maal-ny.mjs --base
```

- Scriptet bruger `DATABASE_URL_DIRECT` fra `.env` og nægter port 6543.
- Det skriver intet: forbindelsen står som read-only, og den tredje linje i
  udskriften skal sige `read-only: on`.
- **Kør den to gange, ca. kl. 08 og ca. kl. 17.** «Ny i dag» efter
  kalenderdag og «ord ≠ kalender» afhænger af klokkeslættet.
- Lokalt tog en kørsel 2,9 s med 8 søgninger. Produktionen har flere
  hundrede postnumre og byer, og tiden der er ikke målt.
- Prøven køres med `--proeve` og uden `--env-file` (samme kommando i
  øvrigt). Den skal slutte med «alle facit stemmer» og exit 0.

**Tallene til beslutningen:**

- afsnit **c)**, «alle 48»: mærkat og de tre «Ny i dag»
- afsnit **d)**, «begge»: median for mærkat og for «Ny i dag» kalender
- tabellen **pr. kilde**, kolonnen `7d/7`: synlige boliger fra de seneste 7
  døgn delt med 7. Det er et loft for, hvor mange nye der kommer pr. døgn,
  men undervurderer det, fordi boliger, der kom og gik inden for ugen, ikke
  er med. Den erstatter skønnet i afsnit 6.
- linjen **«bærer «ny» på kortet i dag, men er bagkatalog»** i b):
  indkøringshullet

## 8. Beslutningsregel

**Mål på den side, brugeren ser, ikke på bestanden.** Bestandens andel er
altid lav (1/L), så den ville godkende mærkaten også dér, hvor den sidder
på hvert kort.

1. **Står mærkaten (72 t) på over halvdelen af kortene på forsidens side 1,
   skal 72-t-vinduet væk.** Det forventer jeg ud fra afsnit 6.
2. **Reservér mærkaten til «Ny i dag» efter kalenderdag i København.**
   Regn den af `NYHEDSDATO`, så indkøringsvagten kommer med, og af `nu`, ikke
   af `siden()`s tekst. Lav «i går» og «N dage» om til en rolig
   metalinje. Mål så igen.
3. **Står «Ny i dag» stadig på over halvdelen af side 1 under «nyeste»
   (målt om eftermiddagen), skal mærkaten ikke vises pr. kort på den
   sortering.** Listen er allerede ordnet efter alder, så mærkaten følger
   kortets plads og bærer i alt én oplysning for hele listen: hvor de nye
   holder op. Vis den i stedet som ét skel i listen, fx «I dag · 31» over
   de første kort og «Tidligere» ved overgangen. Behold mærkaten pr. kort
   i to tilfælde:
   - under andre sorteringer (pris, areal, indflytning), hvor den faktisk
     skelner
   - i søgninger, hvor medianen i d) er under 50 %

   Pladsen på fotoet kan så gå til «Kan overtages nu», som GREB.md:204
   allerede foreslår som mærkat nr. 2.
4. **Tærsklen er 50 % af den viste side, og den gælder alle mærkater på
   fotoet.** En mærkat på flertallet af kortene skelner ikke. Det er samme
   tanke som reglen i CLAUDE.md: «Et filter, der aldrig kan give træf, er
   værre end intet filter».

## 9. Kortets påstand

Påstanden står i `app/Boligkort.tsx:207-208` og i
`docs/resultatdesign.md:55-57`: mærkaten er «tidsbestemt og gælder få kort
ad gangen, så den betyder noget, netop fordi den er sjælden».

**Den holder for bestanden:** skønnet er 4–6 % under 72 t, og i den
syntetiske base er det 12,9 %.

**Den holder ikke for en liste sorteret med de nyeste først.** «Nyeste» er
standardsorteringen (`lib/soeg.ts:408, 680`). Forsiden viser de 48 kort med
den højeste `NYHEDSDATO`, altså netop de kort, der har størst chance for at
få mærkaten:

- **I den syntetiske base** har 12,9 % af bestanden mærkaten, men den sidder
  på 12 af de første 12 kort og på 32 af 48 på side 1.
- **I produktionen** sidder den ifølge skønnet på alle 48, så snart der
  kommer mindst 16 nye boliger i døgnet.

På en liste sorteret efter alder følger mærkaten kortets plads: alle kort
før et bestemt punkt har den, ingen efter. Den siger derfor ikke noget om
det enkelte kort, kun hvor punktet ligger. Påstanden gælder kun for
sorteringer, der ikke er «nyeste», og for smalle søgninger. Kommentaren
bør sige det. Endnu bedre er det at indrette visningen efter det
(afsnit 8, punkt 3).

---

Filer: `maal-ny.mjs` (scriptet, i denne mappe). Prøvens og målingens
udskrifter blev ikke gemt i repoet; de kommer igen med `--proeve` og `--base`.
