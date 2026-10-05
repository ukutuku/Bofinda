# Hastighed · oktober 2026

Arbejdsgren `claude/keen-edison-ajg10p`, grundlag `main` @
`31b5680d2362fe380dc3d49431f923608a097ceb`. Runde 1 målt 4. oktober 2026;
runde 2 (rettelser efter kontrollen) samme dag. **Til kontrol — ikke en
releasegodkendelse.**

**Det her er laboratoriemålinger, ikke brugerdata.** Bofinda har ingen
feltmåling af hastighed (ingen RUM, ingen Web Vitals fra rigtige besøg).
Alle browsertal nedenfor er målt i Chromium på én maskine, mod en lokal base
med syntetiske boliger og med simuleret netværk og CPU. Databaselatens er
SIMULERET med en proxy. De siger, hvor meget en ændring flytter et tal under
ens forhold — ikke hvor hurtig siden er hos en bruger i Aalborg på 4G.
Produktionstallene (fem GET pr. side fra containeren) står for sig og er
heller ikke brugerdata.

## Runde 2 — rettet efter kontrollen

Afleveringen af `440c73e` blev kontrolleret og ikke godkendt. Kontrollen
fandt to fejl i koden og fire mangler i rapporten. De er rettet, og to
fejl mere i rapporten blev fundet undervejs; resten af ændringen er urørt.

| Fund | Rettelse | Efterprøvet |
|---|---|---|
| **Galleriets forhentning stoppede først ved næste hovedbilledes load.** Et billedskift, en lukning eller en afmontering lod den gamle kæde hente videre, og dens færdig-kald startede den næste nabo til et billede, ingen så. | Kæden ligger nu i `app/bolig/[id]/forhentning.ts` (ren logik) og stoppes ved skift, lukning og afmontering. Det viste billedes hentning afbrydes ikke, og det billede, brugeren lige har forladt, hentes færdigt ét skridt (målt: 1.064 → 453 ms på næste-næste-forrige). | 47 påstande i `scripts/test-galleri-forhentning.ts`, 6 modprøver, kontrolpakkens egen harness og en browser mod produktionsbyg (se «Galleriet i en rigtig browser») |
| **Prismedianens cache lovede «højst fem minutter».** Udokumenteret. | Målt på Next 15.5.24: stale-while-revalidate uden øvre alder. En fejlet genberegning beholder den gamle værdi, og et grundlag under 5 blev vist i over fem minutter. **Cachen er fjernet**; medianen regnes ved hver visning som på `main`. | se «Priscachen, efterprøvet» |
| Regionen stod som dokumenteret største flaskehals og målt besparelse | Nu en hypotese og et undersøgelsesemne | — |
| Regnestykket «~1,1 s på forsiden» | 4 × 150–160 ms = **600–640 ms**; 7 forespørgsler = **1.050–1.120 ms** | — |
| Supply-overlappet manglede | Tilføjet som filoverlap (ikke en efterprøvet konflikt) | — |
| Skærmbillederne til Design manglede | Vedlagt: hero før/efter og skrift-skiftet på gruppesiden | — |
| (fundet undervejs) Skrift-skiftet på gruppesiden stod som en NY forskydning | Målt igen: skiftet findes også på `main`; det nye er, at skriften kommer ~240 ms senere | se «Til Design» |
| (fundet undervejs) «Modellen passer på alle fire sider» | Forkert: den forklarer højst bolig- og gruppesiden | se «Produktionen, udefra» |

**Revisioner.** Grundlag `31b5680d2362fe380dc3d49431f923608a097ceb`
(uændret — basen er ikke skiftet). Runde 1: `440c73e30da4937be2c356ca27cd1fe0e5e1727a`
(afvist). Runde 2: `8e4b1af8ee8f6964e414cec941a50304b9d93e38` og
`08f87155dc0a5a1ee5355f8795b60ef24517d770` (koden) og den commit, der
lægger denne rapport (fulde SHA'er i afleveringens `patches/revisioner.txt`).
Ingen af dem er pushet.

**Hvad der er målt igen, og hvad der er genbrugt.** Runde 2 rører kun
boligsiden: `app/bolig/[id]/Galleri.tsx`, den nye `forhentning.ts`,
`app/bolig/[id]/page.tsx` (medianen) og `app/cache.ts` (tilbage til `main`).
`git diff --stat 440c73e 08f87155` på forsidens, søgningens, gruppesidens
og områdesidens kode — `app/page.tsx`, `app/Boligkort.tsx`, `app/gruppe`,
`app/lejeboliger`, `app/Landkort.tsx`, `lib/soeg.ts`, `lib/omraade.ts`,
`lib/hero.ts`, `lib/soegeadresse.ts`, `app/RenSoegeformular.tsx`, `public/`,
`app/layout.tsx`, `app/globals.css` — er tom. Runde 1's tal for de sider og
for søge- og filterforløbet gælder derfor uændret og er genbrugt. Målt igen,
under samme forhold for før og efter:

- galleriforløbene (åbn, bladr, hurtige skift, spring via miniature, skift
  før load, luk og genåbn, fejl, navigation, betjening),
- boligsiden i browseren (første besøg og genbesøg),
- boligsidens serverventetid under simuleret databaselatens.

De oprindelige målinger fra runde 1 er bevaret uændret; runde 2 ligger for
sig (`maalinger-endelig-revision/` i afleveringen).

## Kort fortalt

Median over runderne, samme byg-opsætning og samme data for før og efter.
Mobil = 390×844, DPR 3, 1,6 Mbit/s, 150 ms, 4× CPU. Desktop = 1350×940,
10 Mbit/s, 40 ms. «Første besøg» = tom browsercache. «Før» = `main` @ 31b5680.

| | Før | Efter | Kilde |
|---|---|---|---|
| Forsiden, LCP, mobil, første besøg | 5.284 ms | **3.860 ms** (−27 %) | runde 1, 5 runder |
| Forsiden, LCP, desktop, første besøg | 1.196 ms | **652 ms** (−45 %) | runde 1 |
| Forsiden, overført ved første besøg (mobil) | 1.026 kB | **732 kB** | runde 1 |
| Søgeresultater, LCP, mobil, første besøg | 2.724 ms | **1.376 ms** (−49 %) | runde 1 |
| Gruppeside, LCP, mobil, første besøg | 1.940 ms | **1.536 ms** (−21 %) | runde 1 |
| Første byte efter en søgning, mobil | 236 ms | **83 ms** (−65 %) | runde 1 |
| Galleri: åbn lysbordet, mobil, første besøg | 2.625 ms | **1.144 ms** (−56 %) | runde 2, endeligt byg, 3 runder |
| Galleri: spring via miniature, mobil, første besøg | 891 ms | **560 ms** (−37 %) | runde 2 |
| Boligsiden, serverens første byte, simuleret 80 ms databaserundtur | 511 ms | **347 ms** (−32 %) | runde 2, 7 runder |
| Områdeside, serverens første byte, samme simulering | 1.618 ms | **1.294 ms** (−20 %) | runde 1 |

**To steder er det endelige byg langsommere end `main`** (runde 2, første
besøg): næste-næste-forrige inden for 300 ms på mobil, 314 → 458 ms, og
næste ×3 inden for 300 ms på desktop, 416 → 547 ms. Begge er prisen for, at
hovedbilledet hentes først: `main` henter begge naboer allerede ved
åbningen — derfor dens 2,6 s — og har dem klar, når brugeren trykker hurtigt
lige efter. Se «Galleriet i en rigtig browser».

Boligsidens LCP i browseren og alle genbesøg: ingen sikker forskel.
**Runde 1's tal for boligsidens server (508 → 177 ms) og for lysbordet
(1.602 → 806 ms) gælder ikke længere:** det første hvilede på den fjernede
cache, det andet er målt igen på det endelige byg.

## Måleforhold

| | |
|---|---|
| Byg | `next build` via `scripts/cloud/byg.sh` (produktionsbyg, testflise-URL), `next start` |
| Før | `main` @ 31b5680 |
| Efter, runde 1 | 440c73e (arbejdsgrenens første aflevering) |
| Efter, runde 2 | 08f87155 (endelig revision); hvert byg lavet af `git archive` af commit'en i en ren mappe — se `byggebinding.txt` |
| Base | lokal Postgres 16 (`scripts/cloud/db-op.sh`), 280 syntetiske boliger (frø 20260908) |
| Billeder | 585 billedrækker peget på 48 fotolignende JPEG'er (1600×1067, gns. 222 kB, beskæringer af forsidefotoet), én unik URL pr. række — se «Billederne i testbasen» |
| Browser | Chromium 141.0.7390.37 (`/opt/pw-browsers/chromium`) via playwright-core |
| Mobil | 390×844, DPR 3, touch; 1,6 Mbit/s ned, 750 kbit/s op, 150 ms (DevTools-drosling pr. forespørgsel); CPU 4× |
| Desktop | 1350×940, DPR 1; 10 Mbit/s, 40 ms; ingen CPU-drosling |
| Første besøg | ny browserkontekst, tom HTTP-cache |
| Genbesøg | samme kontekst, `about:blank` imellem, HTTP-cachen bevaret |
| Runder | runde 1: 5, skiftevis A-B og B-A. Runde 2: galleriet 3, boligsiden 5, serverlatens 7 — rækkefølgen af byg skiftet hver runde |
| Tal | median, med spændet (min–maks) over runderne |
| Boliger | runde 1's sider og runde 2's boligside/latens: `0d72345f` (5 billeder, kendt total og areal, så medianen regnes). Runde 2's galleri: `a450f8e4` (5 billeder) — tallene sammenlignes kun inden for samme kørsel |

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
Fotografierne er deterministiske: `vaerktoej/fotos-lav.mjs` (frø 20261004)
gengiver de brugte filer byte for byte (efterprøvet mod `maalefotos.sha256`),
og `fotos-paa.sql`/`fotos-af.sql` er afbildningen og tilbagelægningen.

## Før og efter — runde 1

Median (min–maks) over 5 runder; efter = 440c73e. «Forskel» kaldes kun en
forbedring eller forværring, når de to spænd ikke overlapper; ellers
«ingen sikker forskel». Tabellerne er genereret af de rå målinger
(`tabeller.py`), ikke skrevet af. **Boligsidens rækker og galleriets
rækker er overhalet af runde 2** (koden er ændret dér); resten gælder
uændret, fordi forsidens, søgningens og gruppesidens kode ikke er rørt
siden 440c73e.

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

CLS-tallet 0,002 på gruppesiden er skrift-skiftet. Det findes også på `main`, men blev dér udeladt af CLS — se «Til Design».

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

## Runde 2 — galleriet i en rigtig browser

`galleri-maal.mjs` følger hver 1600px-forespørgsel med Chrome DevTools
Protocol (start, modtagne bytes, færdig, afbrudt) og tidsstempler hver
handling med samme ur. Første besøg = ny kontekst. Tiden er fra handlingen,
til det rigtige billede er hentet og malet. «Ikke vist» = 1600px-hentninger
af et billede, forløbet aldrig viste.

**Kørsel 1 — valget af regel** (A = `main`, E1 = 440c73e, F = 8e4b1af,
F2 = måle-variant af F med det forladte billede beholdt; første besøg, 3
runder; fuld tabel i `galleri/tabeller.md`):

| Forløb | Profil | A | E1 | F | F2 |
|---|---|---|---|---|---|
| Næste, næste, forrige (150 ms) | mobil | 312 (311–314) | 466 (428–470) | **1.064 (1.057–1.072)** | 453 (442–455) |
| Næste ×3 (150 ms) | mobil | 937 (923–952) | 1.109 (1.052–1.126) | 897 (875–912) | 875 (870–900) |
| Spring via miniature | mobil | 912 (896–930) | 803 (800–806) | 581 (561–584) | 559 (555–583) |
| Åbn og skift før hovedbilledet | desktop | 574 (561–652) | 467 (454–472) | 448 (442–449) | 491 (490–519) |

F afbrød det halvt hentede billede, brugeren forlod, og måtte hente det
forfra, når brugeren gik tilbage. F2 beholder det ét skridt. Øvrige forløb
overlapper. Desktop-rækken «åbn og skift før hovedbilledet» skiller F og F2,
men forespørgselsforløbet er det samme i begge — de to hovedbilleder hentes
parallelt, og ingen forhentning starter, før billede 2 er færdigt — så
forskellen ligger i billedsvarene (billede 2 færdigt ved 434–442 mod
471–508 ms) og ikke i reglen. F2's regel blev committet som 08f87155.

**Kørsel 2 — den endelige revision mod `main`** (byggebundet: det målte byg
er 08f87155; 3 runder; `galleri-endelig/`):

| Forløb | Profil | Trin | Før (`main`) | Efter (08f87155) |
|---|---|---|---|---|
| Åbn + «næste» ×3 med 1 s pause | mobil | åbn | 2.625 (2.582–2.658) | **1.144 (1.135–1.158)** |
| | mobil | «næste» 1–3 | 10 / 10 / 10 | 10 / 7 / 9 |
| | desktop | åbn | 571 (562–577) | **396 (370–397)** |
| Næste, næste, forrige (150 ms) | mobil | til vist | **314 (312–318)** | 458 (441–469) |
| | desktop | til vist | 313 (303–313) | 304 (303–312) |
| Næste ×3 (150 ms) | mobil | til vist | 933 (925–935) | **881 (877–883)** |
| | desktop | til vist | **416 (414–447)** | 547 (512–563) |
| Spring via miniature (1 → 3) | mobil | til vist | 891 (877–938) | **560 (555–576)** |
| | desktop | til vist | 313 (297–330) | **247 (247–280)** |
| Åbn og skift før hovedbilledet | mobil | til vist | 2.917 (2.801–2.983) | **1.685 (1.682–1.692)** |
| | desktop | til vist | 600 (588–620) | **466 (447–486)** |
| Luk med Esc, genåbn efter 4 s | mobil | åbn / genåbn | 2.618 / 23 | **1.135** / 21 |
| | desktop | åbn / genåbn | 569 / 4 | **378** / 4 |

Fed = sikker forskel (spændene overlapper ikke). Genbesøg: to sikre
forskelle, begge små og i det endelige bygs favør — åbn på desktop 14 → 12 ms
og åbn i luk-forløbet på mobil 88 → 63 ms; resten af genbesøgene overlapper.
I de to «150 ms»-forløb udgør selve tastetrykkene 300 ms af tiden.

**Livscyklussen** — det, kontrollen fandt, målt i browseren:

| Kontrol (3 kørsler pr. profil) | `main` | 440c73e | F | 08f87155 |
|---|---|---|---|---|
| 1600-hentninger startet EFTER Esc, mobil | 0 | **3 af 3 kørsler** | 0 | 0 |
| Spring 1 → 3: hentning af andet end billede 3 og dets naboer EFTER springet, mobil / desktop | 0 / 0 | **3 / 1** | 0 / 0 | 0 / 0 |
| Nabo fejler → kæden fortsætter til den forrige | 3 / 3 | 3 / 3 | 3 / 3 | 3 / 3 |
| Betjening: pile, knap, miniature, swipe (mobil), Esc, fokus tilbage | 3 / 3 | 3 / 3 | 3 / 3 | 3 / 3 |

(440c73e og F fra kørsel 1, 08f87155 fra kørsel 2.) En hentning «efter
navigation væk» blev registreret i 1 af 3 desktop-kørsler for 440c73e, F og
08f87155: naboen blev færdig 9–21 ms EFTER, at navigationen var startet,
men mens siden stadig levede med lysbordet åbent, og den gyldige kæde
startede næste nabo; browseren afbrød den 30–40 ms senere ved nedlukningen,
med 0 bytes overført. Afmontering i React kan ikke ses i browseren her:
appen har ingen klientnavigation (ingen `next/link`), så siden forlades
altid med en fuld navigation. React-afmonteringen er prøvet med
hook-attrapper og modprøve (`galleri-stop-vaek`).

**Hentninger** (første besøg, median startet / afbrudt / ikke vist · bytes
af ikke viste): spring via miniature på mobil 5 / 0 / 3 · 310 kB på `main`
mod 5 / 1 / 3 · 206 kB på 08f87155; næste-næste-forrige 5 / 0 / 3 · 271 kB
mod 4 / 1 / 2 · 71 kB. `main` henter mere, fordi den forhenter begge naboer
ved åbningen. Fuld tabel i `galleri-endelig/tabeller.md`.

## Runde 2 — boligsiden

**I browseren** (bolig `0d72345f`, 5 runder, `bolig-browser/`): ingen sikker
forskel mellem `main`, 440c73e og 08f87155 i FCP, LCP eller CLS, mobil
eller desktop, første besøg eller genbesøg. LCP på mobil, første besøg:
1.100 / 1.092 / 1.136 ms (spænd 1.036–1.180). Det endelige byg overfører
1 kB mere (forhentningens kode). Mod en lokal base uden latens fylder
forespørgslerne for lidt til at ses i browseren — det gør de i simuleringen
nedenfor.

**Serverens første byte med simuleret databaselatens** (latensproxy 40 ms
hver vej, 7 runder, `latens/`):

| Side | `main` | 440c73e | 08f87155 |
|---|---|---|---|
| `/bolig/0d72345f…` (med medianen) | 511 ms (508–513) | 179 ms (176–183) | **347 ms (341–353)** |
| `/bolig/a450f8e4…` (uden) | 342 ms (338–367) | 179 ms (174–183) | **178 ms (176–182)** |

**Forespørgsler pr. visning** (talt med `taelleproxy.mjs`, Parse-beskeder,
3 visninger hver): `0d72345f` 3 / 1 / **2**, `a450f8e4` 2 / 1 / **1**.
440c73e's 1 var et cachetræf på medianen; den cache er fjernet (se
«Priscachen, efterprøvet»). Gevinsten, der er tilbage, er billederne i
samme sætning som boligen: én forespørgsel = to rundture = ~160 ms i
simuleringen.

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
  forrige. Med begge naboer på én gang efter visningen ventede første
  «næste» ~0,49 s; med én ad gangen uden annullering ventede andet «næste»
  ~0,26 s (runde 1).
- **Runde 2: kæden hører til det viste billede.** I 440c73e lå
  annulleringen i starten af den NÆSTE kæde — en forældet forhentning løb
  videre efter et skift, en lukning eller en afmontering, og dens
  færdig-kald startede den næste nabo til et billede, ingen så (målt i
  browseren: billede 5 hentet efter Esc i 3 af 3 kørsler). Nu ligger
  kæden i `app/bolig/[id]/forhentning.ts` og stoppes ved skift, lukning og
  afmontering: `skift`/`stop` fjerner kaldene fra alt, der hentes, og
  afbryder det, undtagen det billede, der NU vises (browserens `<img>` deler
  hentningen), og det, brugeren lige har forladt (det, man går tilbage til —
  afbrudt måtte det hentes forfra: 1.064 mod 453 ms, se «Runde 2 — galleriet
  i en rigtig browser»). Kommer hovedbilledets load fra cachen før
  effekten, der melder skiftet, gør skiftet til samme billede ingenting.
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
rundtur) foran testbasen — en SIMULERING, ikke en måling af produktionen.
Runde 1 (efter = 440c73e; **boligsidens række er overhalet** af runde 2:
347 ms uden den fjernede cache, se «Runde 2 — boligsiden»):

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

**Produktionen, udefra — og hvad der IKKE vides.** Tre slags oplysninger,
holdt adskilt:

| | Hvad | Status |
|---|---|---|
| **Målt** | Fem GET pr. side mod bofinda.dk fra containeren, 4. oktober 2026 kl. 07:21–07:25 UTC (`runde1-oprindelig/raa/produktion/ttfb-raa.tsv` og `produktion-get/` i afleveringen). Serverventetid = `time_starttransfer − time_pretransfer`, median (min–maks): `/privatliv` (statisk, CDN) 76 ms (62–113), `/` 1.189 ms (1.067–1.278), `/?sted=2300` 954 ms (875–1.034), `/bolig/…` 526 ms (508–546), `/gruppe?b=…` 403 ms (398–413). | målt, men kun 5 GET pr. side fra én maskine |
| **Målt** | Alle svar bærer `x-vercel-id: iad1::iad1::…` — funktionen svarede fra Vercels region iad1 (Washington). | en header, ikke en konfiguration |
| **Ukendt** | Hvor basen ligger. Ingen adgang til Supabase-projektet, og login mod produktionens pooler er med vilje ikke forsøgt. | ikke målt |
| **Model** | postgres.js sender to rundture pr. forespørgsel (`prepare: false`, se ovenfor). Med en rundtur på ~75–80 ms bliver det 150–160 ms pr. forespørgsel. | en slutning, ikke en måling |

**Modellen forklarer højst to af de fire sider — ikke alle fire, som der
stod før.** Rundturen på ~75–80 ms er ikke målt: den er valgt, så modellen
kommer i nærheden af boligsiden (2 eller 3 forespørgsler på `main`, afhængigt
af om boligen har kendt total og areal — ikke undersøgt for den målte bolig:
300–480 ms mod målt 526 ms) og gruppesiden (2: 300–320 ms mod målt 403 ms).
At den passer dér, er altså ikke et bevis. Den samme rundtur forklarer ikke
forsiden (4 forespørgsler: 600–640 ms mod målt 1.189 ms) eller søgningen (4:
600–640 ms mod målt 954 ms). Den forskel er ikke forklaret. En kold
`facetter`/`forsidetal`-cache (fem forespørgsler mere) eller gengivelsestid
er mulige forklaringer, men ingen af dem er målt.

**Regionen er derfor en hypotese og et undersøgelsesemne — ikke en
dokumenteret flaskehals og ikke en målt besparelse.** Hvis basen ligger
langt fra iad1, og hvis rundturen er ~75–80 ms, koster hver forespørgsel
150–160 ms: **600–640 ms** på forsiden (4 forespørgsler) og **1.050–1.120 ms**
på en side med 7 (søgning med filtre, eller områdesiden efter rettelsen).
Hvor meget en flytning sparer, kan først siges, når basens placering er
kendt, og der er målt bagefter.

**Rettet i koden** (uden at røre rækkefølgen eller `prepare`):

- `hentBolig` henter billederne i samme sætning (`json_agg … order by
  position`). Boligsiden går fra 3 forespørgsler til 2 (fra 2 til 1 uden
  kendt total og areal). I 440c73e var medianen desuden cachet, så siden
  kom ned på 1; den cache er fjernet (se «Priscachen, efterprøvet»).
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

Forespørgsler pr. visning, talt i testbasens statement-log (runde 1) og med
`taelleproxy.mjs` (runde 2, boligsiden); anden visning, så `facetter`- og
`forsidetal`-cachen er varm:

| Side | Før | Efter |
|---|---|---|
| `/` | 4 | 4 |
| `/?sted=Attrapby` | 4 | 4 |
| `/?sted=Attrapby&overtagelse=nu&elevator=1` | 7 | 7 |
| `/bolig/…` med kendt total og areal | 3 | 2 |
| `/bolig/…` uden | 2 | 1 |
| `/gruppe?b=…` | 2 | 2 |
| `/lejeboliger/9001` og `/lejeboliger/attrapby` | 13 | 7 |

Den synlige tekst på alle otte sider var byte-ens før og efter i runde 1 (HTML
uden `<script>`/`<style>`, tags fjernet, mellemrum samlet). I runde 2 er
boligsidens synlige tekst byte-ens på `main`, 440c73e og 08f87155 for begge
målte boliger (`kontrol/synlig-tekst-bolig.txt`).

## Priscachen, efterprøvet

440c73e cachede boligsidens median i `unstable_cache` med `revalidate: 300`
og skrev, at tallet højst var fem minutter gammelt. Det var ikke
dokumenteret, og det holder ikke.

**Kilden** (`node_modules/next/dist/server/web/spec-extension/unstable-cache.js`
i den låste Next 15.5.24, linje 145–193): en forældet post RETURNERES til
den aktuelle forespørgsel, og genberegningen startes i baggrunden. Fejler
den, logges `revalidating cache with key: …`, og den gamle værdi bliver
liggende.

**Målt på et produktionsbyg af 440c73e** mod testbasen gennem en fejlproxy
(`priscache/`; «sandhed» = den rigtige `kvadratmeterpris()` direkte mod
basen):

| Trin | Sandhed | Vist |
|---|---|---|
| Første visning | 169 kr/m², 49 boliger | 169, 49 |
| Medianen ændret i basen, inden for 300 s | 190 | **169** (cachetræf) |
| Første visning efter 5 min 21 s uden trafik | 190 | **169** (stale-while-revalidate) |
| Næste visning | 190 | 190 |
| Genberegningen afbrudt, 3 visninger | 220 | **190** ×3 (fejlen slugt) |
| Fejlen ophørt: første / næste visning | 220 | **190** / 220 |
| Ægte genstart af samme byg | 190 | **169** (filcachen overlever) |
| Grundlaget faldet til 4 boliger (under `MINDST_TIL_SAMMENLIGNING`) | ingen sammenligning | **«baseret på 49 boliger»** |
| … første visning efter 5 min 12 s | ingen | **«baseret på 49 boliger»** |
| … næste visning | ingen | ingen |

**Invalideringen, der faktisk sker:** ingen på efterspørgsel —
`revalidateTag('bestand')` kaldes intet sted, og det eneste
`revalidatePath('/udlejer/boliger')` rammer ikke `/bolig/…`; importøren kører
uden Next. Kun tid, og kun som stale-while-revalidate: den første visning
efter udløbet får den gamle værdi, uanset hvor gammel den er, og en fejlet
genberegning forlænger den.

**Beslutning:** cachen er fjernet. En sammenligning, der vises under
grænsen, er netop det, CLAUDE.md siger aldrig må ske. Medianen regnes ved
hver visning som på `main`; billederne i samme sætning bliver. Vercels
datacache er ikke målt — tallene gælder Next' egen filcache lokalt.

Samme mekanisme bruges af `facetterCached` og `forsidetalCached` fra
`main`, som ikke er rørt. Kommentaren i `app/cache.ts` og CLAUDE.md siger
«højst fem minutter bagud» om dem; målingen her viser, at mekanismen ikke
giver en øvre grænse. Ikke rettet her (ingen generel cacheomlægning) — se
«Resterende».

## Kontrol

På den endelige revision og dens byg, medmindre andet står.

| Kontrol | Resultat |
|---|---|
| `npx tsc --noEmit` og `-p tsconfig.scripts.json` | exit 0 og exit 0 (`kontrol/tsc-*-08f8715.log`) |
| `npm test` på 08f87155 | exit 0 · 1.577 ✓ · 0 ✗ · 33 prøver, 4 grupper (`kontrol/npm-test-08f8715.log`; runde 1: 1.528 ✓) |
| `scripts/test-galleri-forhentning.ts` alene | exit 0 · 47 ✓ · 0 ✗ |
| Kontrolpakkens egen harness (`proev-galleri.cjs`, tilpasset kopi) | på 440c73e: 6 af 6 forventede observationer, alle tre defekter reproduceret (exit 0). På den endelige: kontrollerne reproduceret, de tre defekter IKKE (3 af 6, exit 1 — harnessens exitkode kræver, at defekterne findes). Originalen stopper på sin blob-vagt (`3cf1fce`, exit 1); tilpasningen er en `require`-shim for `./forhentning` og ingen anden ændring (`proev-galleri-r2.diff`) |
| `next build` (via `scripts/cloud/byg.sh`) | exit 0; ingen OSM-URL i klientbundtet. `/bolig/[id]`: sidekode 1,93 kB (`main`) → 2,04 (440c73e) → 2,36 kB, First Load JS 107 → 107 → **108 kB** (forhentningens kode, ~0,3 kB). Øvrige ruter som i runde 1 |
| Synlig tekst før/efter, 8 sider (runde 1) | byte-ens |

**Repoets egne browserkontroller** (`scripts/cloud/*.mjs`) mod det
endelige byg med testbasens oprindelige data, samme tal som `main` i runde 1:

| Kontrol | `main` (runde 1) | 08f87155 |
|---|---|---|
| herokontrol | 49 ✓ · 0 ✗ | 49 ✓ · 0 ✗ |
| fotokontrol (4 fotos, ét stående) | 103 ✓ · 0 ✗ | 103 ✓ · 0 ✗ |
| lysbordkontrol | 28 ✓ · 0 ✗ | 28 ✓ · 0 ✗ |
| kortkontrol | 113 ✓ · 0 ✗ | 113 ✓ · 0 ✗ |
| filterkontrol | 121 ✓ · 0 ✗ | 121 ✓ · 0 ✗ |
| beliggenhedkontrol | 43 ✓ · 0 ✗ | 43 ✓ · 0 ✗ |
| browserkontrol | 28 ✓ · 0 ✗ | 28 ✓ · 0 ✗ |

`fotokontrol` slutter med vilje med exit 2 uden rigtige fotografier; den
blev derfor også kørt med fire beskæringer af forsidefotoet, ét stående
(exit 0).

**Modprøver** — hvert nyt værn gjort rødt med vilje gennem
`scripts/modproeve.mjs`, der bygger sit eget arbejdstræ af indekset:

| Mutation | Udfald |
|---|---|
| en hero-variant fjernet (runde 1) | `test-hastighed`: rød på «findes» og «ingen forældet variant» |
| `renSoegning` samler ikke gentagne navne (runde 1) | `test-hastighed`: rød på netop det tilfælde |
| `import { db }` i `lib/soegeadresse.ts` (runde 1) | `test-rene-filer`: rød på filen og på prøven, der importerer den |
| `order by` fjernet i `hentBolig`s `json_agg` (runde 1) | `test-redigering`: rød på galleri-rækkefølgen |
| `galleri-skift-vaek` — lysbordet melder ikke skift/lukning | fanget · 10 røde |
| `galleri-stop-vaek` — ingen stop ved afmontering | fanget · 2 røde |
| `forhentning-kald-bliver` — afbrydelsen fjerner ikke kaldene | fanget · 12 røde |
| `forhentning-behold-vaek` — det viste billede afbrydes også | fanget · 5 røde |
| `forhentning-samme-billede` — skift til samme billede stopper kæden | fanget · 1 rød |
| `forhentning-forladt-afbrydes` — det forladte billede afbrydes | fanget · 3 røde |

**En modprøve slap igennem, og det ændrede koden.** Første udgave havde et
kædenummer oven i afbrydelsen. Modprøven, der fjernede nummerets tjek, blev
grøn: så længe `skift`/`stop` fjerner kaldene fra alt, der hentes, kan et
forældet færdig-kald aldrig komme, og nummeret kunne aldrig afgøre noget.
Det er taget ud, og modprøven er rettet mod den mekanisme, der virker.
Undervejs afviste kørerens vagt 4 også en modprøve, hvis holdepunkt var
forældet efter en ændring — rettet og kørt igen.

## Til Git & Release

1. **Region — et undersøgelsesemne, ikke en anbefaling.** `x-vercel-id`
   siger iad1; basens placering er ukendt. Bekræft den i Supabase
   (værtsnavnet i `DATABASE_URL`: `aws-0-<region>.pooler…`). Ligger den
   langt fra iad1, er en flytning af funktionerne (Vercel-projektets
   indstilling eller `regions` i `vercel.json`) værd at prøve — og måle
   bagefter i produktionen. Hvis rundturen er ~75–80 ms, er det 150–160 ms
   pr. forespørgsel: **600–640 ms** på forsiden (4) og **1.050–1.120 ms**
   på en side med 7. Det er en model, ikke en målt besparelse; se
   «Produktionen, udefra». Ikke ændret her: det er deployment-konfiguration.
2. **Ingen migrationer.** Rettelserne kræver ingen skemaændring og intet
   nyt indeks. Kortlægningen af indekserne mod prædikaterne i `hvor()`,
   `lib/omraade.ts` og boligsiden fandt intet manglende indeks, der
   betyder noget ved ~1.500 synlige boliger: alt, der kan bruge et
   btree-indeks, har et, og resten (`coalesce`-prisen, `ILIKE '%by%'`,
   `jsonb_exists_any(coalesce(…))`) kan ikke bruge ét i sin nuværende
   form. Kandidater til senere — et partielt indeks på aktive rækker og
   `listing_full_economy_idx`, som ingen brugervendt forespørgsel ser ud
   til at bruge — er betinget af EXPLAIN ANALYZE mod produktionens
   datamængde og ikke efterprøvet. CLAUDE.md forbyder
   `collate "da-x-icu"` på et indeks.
3. **Analysen: `map_interaction` falder på mobil.** Det skjulte landkort
   sendte zoom- og pan-events ved sin programmatiske første visning, uden
   at nogen havde rørt det. Det kort bygges ikke længere, så de events
   forsvinder. Faldet er en rettelse af tallet, ikke et tab af brug.
4. **CLAUDE.md** (fælles for flere sessioner, ikke rettet her): reglen om
   de to rundture pr. forespørgsel hører ved siden af «Sider med flere
   forespørgsler kører dem efter hinanden»; boligsidens forespørgselstal er
   2 (1 uden kendt total og areal); og «`facetter()` og `forsidetal()`
   caches i fem minutter» bør sige, at det er stale-while-revalidate uden
   øvre alder.

## Filoverlap til integrationen

| Fil | Ændring (endelig revision mod `main`) | Ejer at orientere |
|---|---|---|
| `app/page.tsx` | hero-`<img>`: srcset/sizes; prop til første kort; `RenSoegeformular` i formularen; redirectet bruger `renSoegning` | Design (hero, ingen visuel ændring) |
| `app/Boligkort.tsx` | prop `billedprioritet` på `Kort`/`Gruppekort`/`Visningskort`; kun `loading` | Design (se skrift-skiftet under «Til Design») |
| `app/bolig/[id]/Galleri.tsx` | lysbordets prioritet; forhentningen gennem `./forhentning`; `mini` til miniaturer | Design (ingen visuel ændring) |
| `app/bolig/[id]/forhentning.ts` | NY: forhentningens livscyklus, ren logik | — |
| `app/bolig/[id]/page.tsx` | `mini`-URL; kommentar om, at medianen ikke caches (kaldet er som på `main`) | Supply (se nedenfor) |
| `app/gruppe/page.tsx` | prop til første kort | — |
| `app/Landkort.tsx` | afstandsprøven afviser en flade uden layoutboks | — |
| `app/lejeboliger/[slug]/page.tsx` | område, områdeliste og statistik memoiseret pr. request | — |
| `lib/omraade.ts` | `findOmraade`/`naboer` tager en allerede hentet områdeliste (valgfrit) | — |
| `lib/soeg.ts` | `hentBolig`: billeder i samme sætning | Supply (se nedenfor) |
| `scripts/test-rene-filer.ts` | fem poster i `LOEFTER` | Supply (se nedenfor) |
| `docs/kildetilladelser.md` | de afledte hero-filer | — |
| Nye | `lib/hero.ts`, `lib/soegeadresse.ts`, `app/RenSoegeformular.tsx`, `scripts/hero-varianter.ts`, `scripts/test-hastighed.ts`, `scripts/test-galleri-forhentning.ts`, seks filer i `modproever/`, `public/hero/*.webp` | — |

`app/cache.ts` er IKKE længere ændret (byte-ens med `main`).

**Supply-sporet — filoverlap, IKKE en efterprøvet konflikt.** Supplys
revision `0f213771f318fb138b3209f2e6bafcc42cf3f761` rører tre af de samme
filer som denne ændring:

| Fil | Denne ændring (endelig revision) |
|---|---|
| `app/bolig/[id]/page.tsx` | `mini`-URL'en til galleriet; kommentaren om, at medianen ikke caches (selve kaldet er tilbage som på `main`) |
| `lib/soeg.ts` | `hentBolig`: billederne i samme sætning (`json_agg … order by position`) |
| `scripts/test-rene-filer.ts` | fem poster i `LOEFTER` (tre fra runde 1, to fra runde 2) |

Revisionen findes ikke i denne klon og ikke på remoten (`git fetch origin
0f21377…` → «not our ref»). Der er derfor hverken kørt en prøvefletning
eller læst Supplys linjer; hvad Supply ændrer i hver af de tre filer, er
ikke set herfra. Andre sessioners grene er ikke flettet ind.

**Ved integrationen skal begge sider bevares:** Supplys domænebaserede
overtagelsesrettelse, det fælles `referenceNow` og at der IKKE falder
tilbage til afviste datoer — sammen med rettelserne her (`hentBolig`s
billeder i samme sætning, `mini`-URL'en, ingen tværgående cache på
medianen). Efter fletningen bør `npm test` køres, og `test-redigering`s
prøve af galleriets rækkefølge gennem `hentBolig` skal være grøn.

**Målte konflikter med åbne grene.** `git merge-tree --write-tree` mod
hver grens hoved, kørt igen på den endelige revision (klonen er ikke
shallow, 579 commits; `integration/merge-tree-endelig-revision.txt`):

| Gren | Konflikter mod `main` i forvejen | Nye konflikter pga. denne ændring |
|---|---|---|
| `skive/s4-brugeromraade` @ 5e830bf | 0 | `app/Boligkort.tsx`, `app/page.tsx`, `app/gruppe/page.tsx`, `app/lejeboliger/[slug]/page.tsx` — samme fire som 440c73e |
| `bjaergning/tastaturbetjening-a11y` @ 394e8ee | 9 filer | de samme fire |
| `arbejde/oktober` @ 444720e | 4 filer | `app/Boligkort.tsx` |

Runde 2 tilføjer ingen konflikter: `app/bolig/[id]/page.tsx` flettes rent
med alle tre. For brugerområdet er de fire additive (`billedprioritet` her,
`favorit` dér, side om side); runde 1's løste filer ligger i
`integration/runde1-proevefletning/`. Intet i Auth/brugerområdet er rørt,
og ingen svar, der læser cookies eller en bruger, caches — runde 2 fjerner
endda den eneste nye cache.

## Til Design

Intet visuelt er tegnet om. To ting skal Design se og tage stilling til —
et tal under en tærskel er ikke en godkendelse:

1. **Forsidens hero før og efter** (`skaermbilleder/hero-*.png`, 390@3,
   1350@1 og 1440@2). Efter-billedet er WebP q90-varianten, som telefonen
   vælger. Målt forskel: gennemsnitligt 0,23–0,58/255 pr. kanal.
2. **Skrift-skiftet på gruppesiden** (`skaermbilleder/skrift-skift/`).
   **Rettelse til runde 1:** der stod, at forskydningen var ny. Det er den
   ikke. Målt i 10 første besøg pr. byg (mobilprofilen): skiftet fra
   reserveskrift til Inter flytter de SAMME fem tekstknuder med de samme
   1–3 px — brødkrummen 3 px til højre og 1 px op, overskriften og
   indledningen 2 px op, og i det første kort én tekst 1 px op og én 19 px
   bredere — og browseren giver det samme layout-shift-tal
   (0,0021) i alle 20 kørsler, på `main` og på den endelige revision.
   Forskellen er, (a) at browseren på `main` markerede alle 10 skift
   `hadRecentInput` og derfor udelod dem af CLS, mens det endelige byg kun
   fik markeringen i 1 af 10 — der var intet brugerinput, og siden sætter
   ikke flaget; hvorfor det sættes, er ikke undersøgt — og (b) at skriften
   kommer senere: skriftfilen er færdig efter 1.171 mod 1.411 ms (median),
   fordi det tidlige kortbillede deler linjen med den, så teksten står med
   reserveskrift i ~528 ms efter første maling mod ~304 ms på `main`.
   Vedlagt: `dpr3-*-reserveskrift.png` og `dpr3-*-inter.png` (1170×1800,
   skriftfilen holdt tilbage og sluppet, billederne hentet — forskellen er
   alene skriften), `dpr3-*-forskel-x4.png` og `dpr3-Ffinal-side-om-side.png`;
   `naturlig-*` er udsnit af de rigtige, uforstyrrede indlæsninger
   (skærmoptagelsens billede lige før og lige efter skiftet, 390×844), og
   `opsummering.txt` har tallene. CLS-tallet er lavt (0,0021), men tallet
   er ikke en godkendelse: om reserveskriften må stå et kvart sekund
   længere, og om skiftet skal undgås (fx med en tilpasset reserveskrift),
   er Designs afgørelse. Intet er tegnet om.

## Resterende problemer og begrænsninger

**I produktet, ikke rettet her:**

1. **Regionen** er en hypotese, ikke en dokumenteret flaskehals (se «Til
   Git & Release»). Forsidens og søgningens serverventetid i produktionen
   (~1,2 og ~0,95 s) er ikke forklaret af modellen.
2. **Galleriets byttehandel.** Hovedbilledet først gør åbningen 1,5 s
   hurtigere på mobil, men et meget hurtigt tryk lige efter åbningen kan
   vente på en nabo, `main` havde hentet parallelt: næste-næste-forrige på
   mobil 314 → 458 ms, næste ×3 på desktop 416 → 547 ms. Ikke afbødet:
   det ville kræve at hente naboer samtidig med hovedbilledet, hvilket er
   det, runde 1 målte som 1,6 s åbning.
3. **Forsidens LCP på mobil er stadig ~3,9 s ved første besøg** på 1,6
   Mbit/s. En telefon med DPR 3 får 1920-varianten (327 kB). Mindre filer
   er en kvalitetsbeslutning for Design.
4. **Første maling venter på CSS.** `globals.css` (67,6 kB minificeret)
   blokerer alle sider, og `leaflet.css` blokerer `/` og `/bolig/[id]`,
   også hvor intet kort vises. CSS er Designs.
5. **Skrift-skiftet** (se «Til Design»): ikke nyt, men reserveskriften står
   længere (~304 → ~528 ms efter første maling på gruppesiden, mobil).
6. **`facetter`/`forsidetal`-cachen** er samme stale-while-revalidate uden
   øvre alder som den fjernede median. Forsidens tal kan derfor være ældre
   end de fem minutter, kommentaren lover. Ikke rørt.
7. **Serverforespørgsler, der ikke er rørt:** forsiden og søgningen har
   stadig 4 (op til 7), gruppesiden 2. Kandidater, hverken bygget eller
   målt: slå `availabilityGrundlag` og `opsummering` sammen, og lad
   `gruppevindue` og `korteneFor` blive én sætning.
8. **Middleware kører på filer i `public/`** og sætter cookies på dem for
   samtykkende brugere. Ikke rørt.
9. **Samtykkebanneret renderer siden to gange.** Frontend/samtykke. Ikke rørt.
10. **`Cache-Control: no-store`** på de dynamiske sider kan holde dem ude af
    back/forward-cachen. Ikke målt.
11. **Et højreswipe i lysbordet navigerede tilbage i historikken** i
    emuleret Chromium (mobilprofilen) — ens på `main` og den endelige
    revision. Med en tom historik virker swipet som forrige billede. Ikke
    undersøgt på fysiske telefoner; ikke rørt.

**I målingen:**

- 280 syntetiske boliger mod ~1.470 aktive i produktionen. Databasetider
  herfra siger intet om produktionens.
- Lokal `next start` taler HTTP/1.1; produktionen taler HTTP/2 bag Vercels
  CDN. Prioritering og deling af linjen opfører sig forskelligt.
- Kun Chromium. Ingen Safari, ingen Firefox, ingen fysiske telefoner.
- Billederne er beskæringer af ét foto.
- Genbesøg varierer: forskelle under ~60 ms ved genbesøg er støj.
- Byg i to forskellige mapper er ikke byte-ens (modul-id og
  server action-hash afhænger af mappen). Runde 2's gallerital er derfor
  målt på selve det endelige byg og ikke overført fra varianten.
- Ingen feltdata. Skal hastighed måles hos brugerne, kræver det en
  RUM-måling — med samtykke og en linje i privatlivspolitikken.
