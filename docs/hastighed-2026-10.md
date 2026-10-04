# Hastighed · oktober 2026

Arbejdsgren `claude/keen-edison-ajg10p`, grundlag `main` @ 31b5680. Målt 4. oktober 2026.

**Det her er laboratoriemålinger, ikke brugerdata.** Bofinda har ingen
feltmåling af hastighed (ingen RUM, ingen Web Vitals fra rigtige besøg).
Alle browsertal nedenfor er målt i Chromium på én maskine, mod en lokal base
med syntetiske boliger og med simuleret netværk og CPU. De siger, hvor
meget en ændring flytter et tal under ens forhold — ikke hvor hurtig siden
er hos en bruger i Aalborg på 4G.

## Kort fortalt

Median over 5 runder skiftevis før/efter, samme byg-opsætning, samme data.
Mobil = 390×844, DPR 3, 1,6 Mbit/s, 150 ms, 4× CPU. Desktop = 1350×940,
10 Mbit/s, 40 ms. «Første besøg» = tom browsercache.

| | Før | Efter |
|---|---|---|
| Forsiden, LCP, mobil, første besøg | 5.284 ms | **3.860 ms** (−27 %) |
| Forsiden, LCP, desktop, første besøg | 1.196 ms | **652 ms** (−45 %) |
| Forsiden, overført ved første besøg (mobil) | 1.026 kB | **732 kB** |
| Søgeresultater, LCP, mobil, første besøg | 2.724 ms | **1.376 ms** (−49 %) |
| Gruppeside, LCP, mobil, første besøg | 1.940 ms | **1.536 ms** (−21 %) |
| Galleri: åbn lysbordet, mobil | 1.602 ms | **806 ms** (−50 %) |
| Første byte efter en søgning, mobil | 236 ms | **83 ms** (−65 %) |
| Boligsiden, serverens første byte, simuleret 80 ms databaserundtur | 508 ms | **177 ms** (−65 %) |
| Områdeside, serverens første byte, samme simulering | 1.618 ms | **1.294 ms** (−20 %) |

Boligsidens LCP i browseren og alle genbesøg: ingen sikker forskel.

## Måleforhold

| | |
|---|---|
| Byg | `next build` via `scripts/cloud/byg.sh` (produktionsbyg, testflise-URL), `next start` |
| Før | `main` @ 31b5680, port 3100 |
| Efter | arbejdsgrenen, port 3101 — samme byg-variabler, samme base, samme aktivserver |
| Base | lokal Postgres 16 (`scripts/cloud/db-op.sh`), 280 syntetiske boliger (frø 20260908) |
| Billeder | 585 billedrækker peget på 48 fotolignende JPEG'er (1600×1067, gns. 222 kB, beskæringer af forsidefotoet), én unik URL pr. række — se «Billederne i testbasen» |
| Browser | Chromium 141.0.7390.37 (`/opt/pw-browsers/chromium`) via playwright-core |
| Mobil | 390×844, DPR 3, touch; 1,6 Mbit/s ned, 750 kbit/s op, 150 ms (DevTools-drosling pr. forespørgsel); CPU 4× |
| Desktop | 1350×940, DPR 1; 10 Mbit/s, 40 ms; ingen CPU-drosling |
| Første besøg | ny browserkontekst, tom HTTP-cache |
| Genbesøg | samme kontekst, `about:blank` imellem, HTTP-cachen bevaret |
| Runder | 5, skiftevis A-B og B-A, efter én opvarmningsrunde pr. app |
| Tal | median, med spændet (min–maks) over runderne |

Serveren er varm i alle målinger (opvarmning først). Billedproxyen har
lokalt ingen cache, så hvert billede skaleres af `sharp` ved hver
forespørgsel — ens for før og efter. I produktionen cacher Vercels CDN
billedsvarene (målt: `x-vercel-cache: MISS` 1,6 s → `HIT` 50 ms).

### Billederne i testbasen

Testbasens 585 billedrækker pegede på fire genererede PNG'er på ~6 kB,
som gik igen på alle boliger. Billedbytes og billedprioritet kunne derfor
ikke måles: browseren hentede den samme lille fil igen og igen. Til
målingen blev rækkerne peget på 48 beskæringer af forsidefotoet (Pexels,
bearbejdning tilladt) i en mappe UDEN FOR repoet
(`/var/lib/bofinda-test/fotos`, aktivserverens `/foto/`), med en
forespørgselsstreng pr. række, så hver række er en unik URL. Ændringen
ligger kun i den lokale testbase og gælder før og efter ens. De oprindelige
URL'er blev sat tilbage efter målingen, før browserkontrollerne kørte.

## Før og efter

Median (min–maks) over 5 runder. «Forskel» kaldes kun en forbedring eller
forværring, når de to spænd ikke overlapper; ellers «ingen sikker
forskel». Tabellerne er genereret af de rå målinger (`tabeller.py`), ikke
skrevet af.

### Sider

| Side | Profil | Cache | LCP før (ms) | LCP efter (ms) | Forskel | FCP før → efter | Overført kB | CLS maks | Runder |
|---|---|---|---|---|---|---|---|---|---|
| Forside | mobil | første besøg | 5.284 (5.276–5.284) | 3.860 (3.852–3.876) | −1.424 ms (−27 %) | 1.696 → 1.728 | 1.026 → 732 | 0,000 → 0,000 | 5 |
| Forside | mobil | genbesøg | 552 (516–616) | 552 (524–604) | uændret | 396 → 416 | 56 → 56 | 0,000 → 0,000 | 5 |
| Forside | desktop | første besøg | 1.196 (1.136–1.212) | 652 (648–688) | −544 ms (−45 %) | 572 → 556 | 1.255 → 873 | 0,000 → 0,000 | 5 |
| Forside | desktop | genbesøg | 248 (220–276) | 276 (232–308) | ingen sikker forskel | 196 → 256 | 56 → 56 | 0,000 → 0,000 | 5 |
| Søgeresultater | mobil | første besøg | 2.724 (2.684–2.780) | 1.376 (1.324–1.568) | −1.348 ms (−49 %) | 1.472 → 1.344 | 479 → 437 | 0,000 → 0,000 | 5 |
| Søgeresultater | mobil | genbesøg | 376 (360–440) | 444 (348–568) | ingen sikker forskel | 364 → 364 | 52 → 52 | 0,000 → 0,000 | 5 |
| Søgeresultater | desktop | første besøg | 644 (576–776) | 456 (412–480) | −188 ms (−29 %) | 440 → 456 | 628 → 629 | 0,000 → 0,000 | 5 |
| Søgeresultater | desktop | genbesøg | 220 (192–248) | 208 (184–224) | ingen sikker forskel | 220 → 208 | 52 → 52 | 0,000 → 0,000 | 5 |
| Boligside | mobil | første besøg | 1.140 (1.096–1.220) | 1.156 (1.052–1.168) | uændret | 1.140 → 1.140 | 199 → 199 | 0,000 → 0,000 | 5 |
| Boligside | mobil | genbesøg | 484 (432–492) | 488 (432–532) | uændret | 484 → 488 | 9 → 9 | 0,000 → 0,000 | 5 |
| Boligside | desktop | første besøg | 340 (328–368) | 360 (332–392) | ingen sikker forskel | 336 → 352 | 287 → 287 | 0,000 → 0,000 | 5 |
| Boligside | desktop | genbesøg | 160 (140–168) | 156 (140–176) | ingen sikker forskel | 160 → 156 | 9 → 9 | 0,000 → 0,000 | 5 |
| Gruppeside | mobil | første besøg | 1.940 (1.936–1.968) | 1.536 (1.520–1.552) | −404 ms (−21 %) | 912 → 932 | 321 → 321 | 0,000 → 0,002 | 5 |
| Gruppeside | mobil | genbesøg | 376 (348–416) | 388 (344–404) | ingen sikker forskel | 376 → 388 | 9 → 9 | 0,000 → 0,000 | 5 |
| Gruppeside | desktop | første besøg | 488 (428–544) | 368 (356–388) | −120 ms (−25 %) | 316 → 312 | 363 → 363 | 0,000 → 0,001 | 5 |
| Gruppeside | desktop | genbesøg | 152 (148–164) | 132 (132–152) | ingen sikker forskel | 152 → 132 | 9 → 9 | 0,000 → 0,000 | 5 |

CLS-tallet 0,002 på gruppesiden er skrift-skiftet — se «Resterende».

### Forløb

Søgning: skriv i søgefeltet og tryk Enter. Filter: åbn filtervinduet,
vælg en boligtype, «Vis resultater». Galleri: åbn lysbordet og tryk
«næste» tre gange med et sekunds pause. Tiderne efter en handling regnes
fra den nye sides navigationsstart.

| Forløb | Profil | Måling | Før (ms) | Efter (ms) | Forskel |
|---|---|---|---|---|---|
| Søgning fra forsiden | mobil | første byte efter handlingen | 236 (227–242) | 83 (59–106) | −153 ms (−65 %) |
| Søgning fra forsiden | mobil | LCP efter handlingen | 624 (568–832) | 420 (396–684) | ingen sikker forskel |
| Filter → «Vis resultater» | mobil | første byte efter handlingen | 223 (206–237) | 65 (53–100) | −159 ms (−71 %) |
| Filter → «Vis resultater» | mobil | LCP efter handlingen | 552 (532–748) | 476 (412–648) | ingen sikker forskel |
| Galleri | mobil | åbn lysbordet, til billedet er vist | 1.602 (1.518–1.745) | 806 (789–812) | −796 ms (−50 %) |
| Galleri | mobil | «næste» 1 | 11 (8–31) | 10 (8–29) | ingen sikker forskel |
| Galleri | mobil | «næste» 2 | 8 (8–10) | 7 (6–7) | −1 ms (−12 %) |
| Galleri | mobil | «næste» 3 | 10 (8–14) | 8 (8–16) | ingen sikker forskel |
| Søgning fra forsiden | desktop | første byte efter handlingen | 107 (99–120) | 78 (61–117) | ingen sikker forskel |
| Søgning fra forsiden | desktop | LCP efter handlingen | 336 (212–364) | 288 (244–312) | ingen sikker forskel |
| Filter → «Vis resultater» | desktop | første byte efter handlingen | 96 (94–110) | 59 (56–89) | −37 ms (−39 %) |
| Filter → «Vis resultater» | desktop | LCP efter handlingen | 264 (248–320) | 252 (236–268) | ingen sikker forskel |
| Galleri | desktop | åbn lysbordet, til billedet er vist | 393 (264–470) | 323 (269–335) | ingen sikker forskel |
| Galleri | desktop | «næste» 1 | 2 (2–4) | 2 (2–3) | uændret |
| Galleri | desktop | «næste» 2 | 2 (2–3) | 2 (1–3) | uændret |
| Galleri | desktop | «næste» 3 | 2 (2–3) | 2 (1–2) | uændret |

## Flaskehalsene og rettelserne

### 1 · Forsidens hero-foto var 636 kB til alle skærme

**Fundet.** `public/hero-stue.jpg` (2048×1365, baseline-JPEG) var forsidens
LCP-element på mobil og desktop. Samme fil til alle skærme, ingen srcset,
og browseren startede den med prioritet `Low`. På den simulerede
telefonforbindelse tog den alene fra 227 til 5.240 ms at hente og delte
linjen med de kortbilleder, Chrome henter tidligt trods `loading="lazy"`.

**Rettet.** WebP-varianter i 640–2048 px (`public/hero/`), lavet af
`scripts/hero-varianter.ts`, som tjekker originalens sha256 først.
Originalen er urørt og stadig `src`. `<img>` har fået `srcset` og `sizes`;
React forhentede allerede fotoet med et `<link rel=preload>`, og det gør
den nu med srcset'en, så telefonen forhenter den rigtige variant.

**`fetchPriority="high"` blev prøvet og fravalgt.** Et forsøg med tre
byg — før, efter med og efter uden — 5 runder skiftevis: LCP var den
samme med og uden (mobil 3.856 mod 3.860 ms, desktop 636 mod 636 ms), mens
FCP på mobil var 1.692 ms med og 1.552 ms uden (spænd 1.524–1.748 mod
1.460–1.688). Prioriteten gav altså ingen gevinst og en risiko for at tage
linjen fra den CSS, første maling venter på. Den mindre fil er hele
gevinsten. Rå tal i afleveringens `raa/browser-abc/`.

**Kvaliteten er bevaret, ikke skønnet:**

- *Pixeltæthed.* `sizes` er sat efter den bredde, billedet TEGNES i, ikke
  rammens. Med `object-fit: cover` i en ramme på ~400 css-px's højde tegnes
  billedet ~600 css-px bredt på en telefon. Målt i Chromium: 360, 390 og
  414 px gav 600, 600 og 564 css-px. En telefon på 390 px med DPR 3 vælger
  derfor 1920-varianten — ikke en mindre fil end den kan vise. `100vw`
  ville have givet 1280 og et synligt tab (2,1 mod 3,4 px pr. css-px).
- *Kodning.* WebP kvalitet 90. ffmpeg-ssim mod originalen i 2048 (yuv444p):
  Y 0,982, alle kanaler 0,990. Kvalitet 85 gav Y 0,969 og blev fravalgt.
- *Det, brugeren ser.* Skærmbilleder af `.hero` før og efter, samme mål:
  gennemsnitlig forskel 0,23/255 (390@3), 0,58/255 (1350@1) og 0,41/255
  (1440@2); højst 0,25 % af kanalværdierne afviger mere end 8.

**Design bør godkende** — det er deres flade, og et tal er ikke et øje.
Skærmbillederne ligger ved afleveringen.

### 2 · LCP-billederne blev bestilt for sent og delte linjen

**Fundet.** Alle kortbilleder var `loading="lazy"`, også det øverste på en
resultatside. Et lazy billede kan først bestilles, når layoutet er regnet,
så de første kort startede samtidig ved første maling, alle med prioritet
`Low`, og delte linjen. På mobil kom søgesidens første kortbillede ~1,2 s
efter FCP og var sidens LCP; gruppesiden ~1,0 s. Boligsidens første
galleribillede startede tidligt, men med lav prioritet. I lysbordet tog
det 2,6 s på én prøvebolig og 1,6 s på den, A/B-målingen bruger, at åbne
det første billede på mobil: hovedbilledet (1600 px)
delte linjen med to forhentede 1600-naboer og fire-fem miniaturer i
800 px — til ruder på 74×54 css-px.

**Rettet.**

- Det øverste kort på en resultatside og en gruppeside får
  `loading="eager"` (ny prop `billedprioritet`; ikke `position`, som er
  analysens globale plads). React forhenter det så fra HTML'en i stedet
  for efter layoutet. Forsiden giver den ikke — dér er hero-fotoet LCP.
  Resultatsiden giver den heller ikke, når brugeren har VALGT kortet
  (`?kort=1`): så skjuler telefonen listen, og et eager billede hentes
  også under `display: none`.
- **`fetchPriority="high"` blev prøvet og fravalgt her også.** 10 runder,
  tre byg: LCP med og uden «high» var ens (søgning mobil 1.394 mod 1.418
  ms, gruppe mobil 1.536 mod 1.532 ms, desktop inden for spændet).
  Galleriets første billede fik den også prøvet uden målbar effekt —
  billedet er færdigt før første maling — og er tilbage som før.
- Lysbordets hovedbillede får `fetchPriority="high"`; miniaturerne bruger
  400-varianten med `fetchPriority="low"`. Naboerne forhentes først, når
  billedet er vist (eller fejlet), og én ad gangen: den næste, så den
  forrige. Bladrer brugeren videre, annulleres det, der stadig hentes til
  det forrige billede. Begge dele er målt frem: med begge naboer på én
  gang efter visningen ventede første «næste» ~0,49 s; med én ad gangen
  uden annullering ventede andet «næste» ~0,26 s.
- Det skjulte landkort på mobil hentede Leaflet og fliser: under
  `display: none` giver `getBoundingClientRect()` nuller, og
  afstandsprøven kaldte det «nær». Nu afvises en flade uden layoutboks.
  Det er også et OSM-spørgsmål: politikken tillader kun fliser til det
  udsnit, brugeren ser. Resize-lytteren fanger, hvis skærmen bliver bred
  nok til at vise kortet.

### 3 · Serverens databaserundture

**Fundet.** Siderne er `force-dynamic`, og forespørgslerne kører bevidst
efter hinanden (CLAUDE.md). Talt i testbasens statement-log, varm cache:
forsiden 4, søgning 4 (op til 7 med filtre), boligsiden 3 (2 uden kendt
total og areal), gruppesiden 2.

**Hver forespørgsel koster TO rundture til basen.** Med `prepare: false`
(påkrævet bag Supavisor i transaction mode) sender postgres.js 3.4.9 først
`Parse + Describe + Flush`, venter på svaret og sender så `Bind + Execute`
(`node_modules/postgres/src/connection.js:238`:
`q.describeFirst = q.onlyDescribe || (parameters.length && !q.prepared)`).
Drizzle parameteriserer alt, så det gælder hver forespørgsel.

Efterprøvet lokalt med en TCP-proxy, der lægger 40 ms i hver retning (80 ms
rundtur) foran testbasen — en SIMULERING, ikke en måling af produktionen:

| Side | Før (ms) | Efter (ms) | Forskel |
|---|---|---|---|
| / | 804 (791–829) | 807 (799–852) | uændret |
| /?sted=Attrapby | 801 (788–807) | 805 (788–824) | uændret |
| /bolig/0d72345f-7b0b-4760-a385-0d8239777529 | 508 (503–514) | 177 (175–187) | −331 ms (−65 %) |
| /gruppe?b=08a006d2-5a71-49b4-87bd-4ebe903c52b8&postnr=9001 | 345 (343–359) | 346 (343–354) | uændret |
| /lejeboliger/9001 | 1.618 (1.610–1.628) | 1.294 (1.275–1.312) | −325 ms (−20 %) |

Forsiden, søgningen og gruppesiden er uændrede her, som de skal være: deres
antal forespørgsler er ikke rørt. Søgningens gevinst er rundturen i
browseren (307'eren), ikke serveren. Områdesiden vandt mindre end
forespørgselstallet lovede (13 → 7 burde give ~0,96 s): formentlig fordi
Next 15.5 streamer metadata, så `generateMetadata` og siden kørte deres
dubletter samtidig gennem puljen. Det er en formodning, ikke målt.

**Produktionen, udefra.** Fem GET pr. side mod bofinda.dk fra containeren,
4. oktober 2026 (rå tal i afleveringens `raa/produktion/ttfb-raa.tsv`). Serverventetid
(time_starttransfer − time_pretransfer, median): `/privatliv` (statisk,
CDN) ≈ 75 ms, `/` ≈ 1.190 ms, `/?sted=2300` ≈ 950 ms, `/bolig/…` ≈ 530 ms,
`/gruppe?b=…` ≈ 405 ms. Svarene bærer `x-vercel-id: iad1::iad1` — funktionen
kører i Vercels region iad1 (Washington). Modellen «antal forespørgsler × 2
× rundtur» passer på alle fire sider med en rundtur på ~75–80 ms. Det er en
SLUTNING: basens region er ikke målt (ingen adgang, og login mod
produktionens pooler er med vilje ikke forsøgt). Ligger basen i EU, er
det største enkeltgreb ikke i koden — se «Til Git & Release».

**Rettet i koden** (uden at røre rækkefølgen eller `prepare`):

- Boligsidens median (`kvadratmeterpris`) caches i 5 minutter pr.
  postnummer med samme tag og levetid som `facetter` og `forsidetal`
  (`app/cache.ts`). Svaret er offentligt — median og antal — og
  `MINDST_TIL_SAMMENLIGNING` håndhæves før cachen. Boligen selv caches ikke.
- `hentBolig` henter billederne i samme sætning (`json_agg … order by
  position`). Boligsiden går dermed fra 3 forespørgsler til 1 ved et
  cachetræf.
- Søgeformularen sender ikke længere sine tomme felter. Før svarede siden
  307 til den rene adresse ved hver søgning og hvert «Vis resultater» — en
  fuld rundtur mere. Reglen ligger nu ét sted (`lib/soegeadresse.ts`) og
  bruges både af serverens redirect, der bliver stående for den, der ikke
  har JavaScript, og af formularen (`app/RenSoegeformular.tsx`).
- Områdesiden (`/lejeboliger/[slug]`, ikke blandt de fire målte sider, men
  den side søgemaskinerne sender folk til) hentede områdelisten tre gange
  og statistikken to gange pr. visning. De er nu memoiseret pr. request med
  React `cache()`, ligesom sidens `sideudsnit` allerede var — ingen deling
  mellem requests, altså ingen ændring i datafriskhed.

Forespørgsler pr. visning, talt i testbasens statement-log (anden visning,
så Next' 5-minutters cache er varm; `parse`/`bind`/`execute` talt som én):

| Side | Før | Efter |
|---|---|---|
| `/` | 4 | 4 |
| `/?sted=Attrapby` | 4 | 4 |
| `/?sted=Attrapby&overtagelse=nu&elevator=1` | 7 | 7 |
| `/bolig/…` med kendt total og areal | 3 | 1 (2 ved første visning i postnummeret, 5 min.) |
| `/bolig/…` uden | 2 | 1 |
| `/gruppe?b=…` | 2 | 2 |
| `/lejeboliger/9001` og `/lejeboliger/attrapby` | 13 | 7 |

Den synlige tekst på alle otte sider er byte-ens før og efter (HTML uden
`<script>`/`<style>`, tags fjernet, mellemrum samlet).

## Kontrol

Alt på det endelige træ og det endelige byg.

| Kontrol | Resultat |
|---|---|
| `npx tsc --noEmit` og `-p tsconfig.scripts.json` | exit 0, exit 0 |
| `npm test` | exit 0 · 1.528 ✓ · 0 ✗ · 32 prøver, 4 grupper |
| `next build` (via `scripts/cloud/byg.sh`) | grønt; ingen OSM-URL i klientbundtet; First Load JS uændret (delt 103 kB; `/` 106 kB, `/bolig/[id]` 107 kB); sidekode `/` 838 B → 1,21 kB, `/bolig/[id]` 1,93 → 2,04 kB |
| Synlig tekst før/efter, 8 sider | byte-ens |
| HTML for de fire målte sider, målt byg mod endeligt byg | ens bortset fra byg-id og et id pr. request |
| Skærmbilleder af `.hero`, 390@3, 1350@1, 1440@2 | samme mål; gns. forskel 0,23–0,58/255 |

**Repoets egne browserkontroller** (`scripts/cloud/*.mjs`), kørt mod før og
efter med testbasens oprindelige data:

| Kontrol | Før | Efter |
|---|---|---|
| herokontrol | 49 ✓ · 0 ✗ | 49 ✓ · 0 ✗ |
| fotokontrol (4 fotos, ét stående) | 103 ✓ · 0 ✗ | 103 ✓ · 0 ✗ |
| lysbordkontrol | 28 ✓ · 0 ✗ | 28 ✓ · 0 ✗ |
| kortkontrol | 113 ✓ · 0 ✗ | 113 ✓ · 0 ✗ |
| filterkontrol | 121 ✓ · 0 ✗ | 121 ✓ · 0 ✗ |
| beliggenhedkontrol | 43 ✓ · 0 ✗ | 43 ✓ · 0 ✗ |
| browserkontrol | 28 ✓ · 0 ✗ | 28 ✓ · 0 ✗ |

`fotokontrol` slutter med vilje med exit 2 uden rigtige fotografier i
testmiljøet; den blev derfor også kørt med fire beskæringer af forsidefotoet,
ét af dem stående, så lysbordsprøven faktisk kørte.

**Modprøver** — hvert nyt værn er gjort rødt med vilje og grønt igen:

| Mutation | Udfald |
|---|---|
| en hero-variant fjernet | `test-hastighed`: rød på «findes» og «ingen forældet variant» |
| `renSoegning` samler ikke gentagne navne | `test-hastighed`: rød på netop det tilfælde |
| `import { db }` i `lib/soegeadresse.ts` | `test-rene-filer`: rød på filen og på prøven, der importerer den |
| `order by` fjernet i `hentBolig`s `json_agg` | `test-redigering`: rød på galleri-rækkefølgen (1 af 580) |
| samme, men uden at flytte rækken i heapen | grøn — derfor flyttes den; prøvens kommentar siger hvorfor |
| samme, før indeks/bitmap blev slået fra i prøven | grøn — fælden «gentagelsesprøven»; rettet i prøven |

## Til Git & Release

1. **Funktionsregion.** `x-vercel-id` siger iad1. Bekræft basens region i
   Supabase (værtsnavnet i `DATABASE_URL`: `aws-0-<region>.pooler…`). Ligger
   den i EU, så flyt funktionerne dertil (Vercel-projektets indstilling
   eller `regions` i `vercel.json`) og mål bagefter i produktionen.
   Ifølge modellen er det ~150–160 ms pr. forespørgsel, altså ~1,1 s på
   forsiden og ~1,1 s på en områdeside selv efter rettelsen (7
   forespørgsler). Billedproxyens kolde vej (hent fra danske kildeværter +
   sharp, målt 1,6 s ved et `MISS`) ville også få kortere vej. Ikke
   ændret her: det er deployment-konfiguration.
2. **Ingen migrationer.** Rettelserne kræver ingen skemaændring og intet
   nyt indeks. Kortlægningen af indekserne mod prædikaterne i `hvor()`,
   `lib/omraade.ts` og boligsiden fandt intet manglende indeks, der
   betyder noget ved ~1.500 synlige boliger: alt, der kan bruge et
   btree-indeks, har et, og resten (`coalesce`-prisen, `ILIKE '%by%'`,
   `jsonb_exists_any(coalesce(…))`) kan ikke bruge ét i sin nuværende
   form. Prisen ligger i forespørgslernes form og i rundturene. Kandidater
   til senere — et partielt indeks på aktive rækker (afmeldte slettes
   aldrig, så hver dedup-scanning vokser med historikken), og
   `listing_full_economy_idx`, som ingen brugervendt forespørgsel ser ud
   til at bruge — er betinget af EXPLAIN ANALYZE mod produktionens
   datamængde, og ingen af dem er efterprøvet. CLAUDE.md forbyder
   `collate "da-x-icu"` på et indeks.
3. **Analysen: `map_interaction` falder på mobil.** Det skjulte landkort
   sendte zoom- og pan-events ved sin programmatiske første visning, uden
   at nogen havde rørt det (Leaflets `_resetView` fyrer `zoomend` og
   `moveend`). Det kort bygges ikke længere, så de events forsvinder. Faldet
   er en rettelse af tallet, ikke et tab af brug. Analysens ejer bør vide
   det, før tragten læses. Selve lytterne er ikke rørt.
4. **CLAUDE.md** bør have reglen om de to rundture pr. forespørgsel ved
   siden af «Sider med flere forespørgsler kører dem efter hinanden», og
   tallet for boligsidens forespørgsler opdateres. Ikke rettet her: filen
   er fælles for flere sessioner.

## Filoverlap til integrationen

| Fil | Ændring | Ejer at orientere |
|---|---|---|
| `app/page.tsx` | hero-`<img>`: srcset/sizes; prop til første kort; `RenSoegeformular` i formularen; redirectet bruger `renSoegning` | Design (hero, ingen visuel ændring) |
| `app/Boligkort.tsx` | prop `billedprioritet` på `Kort`/`Gruppekort`/`Visningskort`; kun `loading` | Design (ingen visuel ændring; se skrift-forskydningen under «Resterende») |
| `app/bolig/[id]/Galleri.tsx` | lysbordets prioritet, forhentning efter visning, `mini` til miniaturer | Design (ingen visuel ændring) |
| `app/bolig/[id]/page.tsx` | `mini`-URL; median via `kvadratmeterprisCached` | — |
| `app/gruppe/page.tsx` | prop til første kort | — |
| `app/Landkort.tsx` | afstandsprøven afviser en flade uden layoutboks | — |
| `app/cache.ts` | `kvadratmeterprisCached` | — |
| `app/lejeboliger/[slug]/page.tsx` | område, områdeliste og statistik memoiseret pr. request | — |
| `lib/omraade.ts` | `findOmraade`/`naboer` tager en allerede hentet områdeliste (valgfrit) | — |
| `lib/soeg.ts` | `hentBolig`: billeder i samme sætning | — |
| `docs/kildetilladelser.md` | de afledte hero-filer | — |
| Nye | `lib/hero.ts`, `lib/soegeadresse.ts`, `app/RenSoegeformular.tsx`, `scripts/hero-varianter.ts`, `scripts/test-hastighed.ts`, `public/hero/*.webp` | — |

**Målte konflikter med åbne grene.** `git merge-tree --write-tree` mod
hver grens hoved 4. oktober 2026, sammenholdt med de konflikter, grenen
allerede har mod `main`, så kun de konflikter, denne ændring tilføjer,
står her:

| Gren | Konflikter mod `main` i forvejen | Nye konflikter pga. denne ændring |
|---|---|---|
| `skive/s4-brugeromraade` @ 5e830bf (brugerområdet) | 0 | `app/Boligkort.tsx`, `app/page.tsx`, `app/gruppe/page.tsx`, `app/lejeboliger/[slug]/page.tsx` |
| `bjaergning/tastaturbetjening-a11y` @ 394e8ee | 9 filer | de samme fire |
| `arbejde/oktober` @ 444720e | 4 filer | `app/Boligkort.tsx` |

For brugerområdet er alle fire additive: begge sider tilføjer en ny prop
på de samme linjer — `billedprioritet` her, `favorit` dér — og på
områdesiden står `naboer(o, 8, …)` og `favoritIder()` side om side.
Opløsningen er at beholde begge. En prøvefletning løst sådan gav
`tsc --noEmit` exit 0; de løste filer ligger i afleveringens
`integration/`. Brugerområdet gør siderne personlige (favoritstatus i
HTML'en), og det skærper kun reglen om, at HTML aldrig må deles i en
cache: denne ændrings caches er på dataniveau og indeholder intet om
brugeren.

**Intet i Auth/brugerområdet er rørt** (`app/udlejer/**`, `lib/auth.ts`,
`middleware.ts`, `app/Samtykke.tsx`). Ingen svar, der læser cookies eller
en bruger, er blevet cachet: den eneste nye cache er medianen, et
offentligt aggregat over postnummeret.

## Resterende problemer og begrænsninger

**I produktet, ikke rettet her:**

1. **Funktionsregionen** (se «Til Git & Release») er den største enkelte
   post på alle server-renderede sider og på billedproxyens kolde vej.
2. **Forsidens LCP på mobil er stadig ~3,9 s ved første besøg** på 1,6
   Mbit/s. En telefon med DPR 3 får 1920-varianten (327 kB), fordi den kan
   vise den. Mindre filer kræver en kvalitetsbeslutning, og den er Designs:
   1280-varianten (174 kB) giver 2,1 px pr. css-px mod 3,2 i dag; AVIF
   kræver et `<picture>`, og så skal `.hero-billede img`'s CSS med. Chrome
   henter desuden de første kortbilleder under folden samtidig med fotoet.
3. **Første maling venter på CSS.** På boligsiden er LCP lig FCP (~1,1 s
   mobil): billedet er færdigt før første maling. `globals.css` (67,6 kB
   minificeret) blokerer alle sider, og `leaflet.css` blokerer `/` og
   `/bolig/[id]`, også hvor intet kort vises. CSS er Designs.
4. **Skrift-skiftet giver en forskydning på 1–2 px** på gruppesiden ved
   første besøg på mobil (CLS 0,0021 i 4–6 af 10 runder; før 0). Det
   tidlige kortbillede deler linjen med skriftfilen, så Inter i nogle
   kørsler kommer efter første maling. Langt under grænsen for «god»
   (0,1), men nyt. Design bør vide det.
5. **Serverforespørgsler, der ikke er rørt:** forsiden og søgningen har
   stadig 4 (op til 7), gruppesiden 2. Kandidater, efterprøvet i koden af
   kortlægningen, men hverken bygget eller målt: slå `availabilityGrundlag`
   og `opsummering` sammen (de har samme WHERE), og lad `gruppevindue` og
   `korteneFor` blive én sætning. Hver sparer én forespørgsel = to rundture.
   Begge rører tal med mange regler i CLAUDE.md og bør være egne opgaver.
6. **Middleware kører på filer i `public/`** — også forsidefotoet og dets
   varianter — og sætter cookies på dem for samtykkende brugere. En
   undtagelse i matcheren er ligetil, men den styrer analysens session og
   ligger op ad samtykket. Ikke rørt.
7. **Samtykkebanneret renderer siden to gange** (server action + reload).
   Frontend/samtykke. Ikke rørt.
8. **`Cache-Control: no-store`** på de dynamiske sider kan holde dem ude af
   back/forward-cachen. Ikke målt.
9. **`public/`-filer revalideres ved hvert besøg** (`max-age=0`). En
   `headers()`-regel for `/hero/` ville spare en rundtur ved genbesøg, men
   `docs/kildetilladelser.md` bygger en OSM-påstand på, at `next.config.ts`
   ingen `headers()` har. Ikke rørt.

**I målingen:**

- 280 syntetiske boliger mod ~1.470 aktive i produktionen. Databasetider
  herfra siger intet om produktionens; derfor er de ikke brugt.
- Lokal `next start` taler HTTP/1.1; produktionen taler HTTP/2 bag Vercels
  CDN. Prioritering og deling af linjen opfører sig forskelligt.
- Kun Chromium. Ingen Safari, ingen Firefox, ingen fysiske telefoner.
- Billederne er beskæringer af ét foto; størrelserne svarer til kildernes,
  men motivet er ikke deres.
- Genbesøg varierer: samme byg gav 370 og 432 ms i median på mobil
  søgning i to kørsler. Forskelle under ~60 ms ved genbesøg er støj.
- Ingen feltdata. Skal hastighed måles hos brugerne, kræver det en RUM-
  måling (fx Web Vitals) — med samtykke og en linje i privatlivspolitikken.
