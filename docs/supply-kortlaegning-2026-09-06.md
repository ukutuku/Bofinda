# Supply-kortlægning — 6. september 2026

Research-fase, ingen kode. Grundlag: 14 parallelle undersøgelsesspor over 30+ kandidater,
kørt under faste regler (kun GET, højst 12 sider pr. kandidat, mindst 1,5 s mellem kald,
robots.txt læst først, ingen login/CAPTCHA-omgåelse). Status er ALTID aflæst efter kildens
egen semantik — HTTP 200 er ikke bevis på aktualitet (HomeConnector-reglen). Overlap er
MÅLT mod de 1.468 synlige Bofinda-boliger (adresse+postnr, id-mønstre, billedværter,
platform-fingeraftryk). De to største målte fund (Heimstaden, Birch) er efterprøvet af
uafhængige modbevisere, som begge bekræftede tallene.

**Korrektion i syntesen:** to agenter omtalte umøblerede helårslejemål som et "forbehold
for segmentet". Det er omvendt: umøbleret helårsleje er Bofindas kernesegment. Møbleret
korttidsudlejning (LifeX, HousingAnywhere, Hay4You) er delsegmentet, der kræver en
beslutning.

## 1. Baseline (frosset)

Se `docs/supply-baseline-2026-09-06.md` og `scripts/supply-baseline.ts`. Hovedtal:
**1.446 unikke synlige boliger** (1.468 synlige, 22 krydskilde-dubletter) fra 7 kilder.
Geografi: kbh_frb 396 · stor_kbh 348 · aarhus **54** · odense 93 · aalborg **72** · rest 483.
Depositum- og forudbetalt-dækning er **0 % i alle nuværende kilder** — et hul i præcis
det, Bofinda differentierer sig på (ærlig indflytningspris).

Mål: 2.500–3.000 gode, unikke aktuelle boliger uden at sænke datakvaliteten.

## 2. Kandidaterne (30 undersøgt, 23 scoret)

| kilde | fundet | aktuelle¹ | netto nye² | overlap | sikkerhed | indsats |
|---|---|---|---|---|---|---|
| Heimstaden | 198 | 198 | ~198³ | lavt (0/198 målt) | målt + modbevist | lav |
| Birch Ejendomme | 59 | 59 | 59 | lavt (0/59 målt) | målt + modbevist | lav |
| CEJ (bolig.io) | 63 | 34 | 34 | lavt (0/63 målt) | målt | lav |
| EDC Lejeindeks | 12.191 | 12.191⁴ | ~11.300⁴ | lavt (5/67 stikprøve) | delvist målt | lav |
| RealMæglerne | 36 | 34 | 34 | lavt (0 målt) | målt | lav |
| Taurus Ejendomsforvaltning | 36 | 36 | 36 | lavt | delvist målt | lav |
| danbolig | 44 | 44 | ~38 | lavt (4/30 = propstep) | målt | moderat |
| Barfoed Group | 58 | 17 | 17 | lavt (0/17 målt) | målt ×2 | moderat |
| LifeX (møbleret co-living) | 100 | 21 | 21 | lavt | målt | lav |
| Calum (Aalborg) | 15 | 15 | 15 | lavt | målt | lav |
| Postbyen | 160 | 12 | 12 | lavt (0/160 målt) | målt | lav |
| Civica (Fyn, almen) | 9 | 9 | 9 | lavt (0/9 målt) | målt | lav |
| Jeudan | 5 | 5 | 5 | lavt (0 målt) | målt | lav |
| CityApartment | 34 | 5 | 5 | lavt (0 målt) | delvist målt | moderat |
| Kereby | 13 | 4 | 4 | lavt (0/58 målt) | målt | lav |
| Housing Denmark | 74 | 74 | ~72 | lavt (0/3) | delvist målt | moderat |
| HousingAnywhere | 51 | 51 | 51 | lavt | delvist målt | moderat |
| Boligzonen | 10.650 | 10.650⁴ | ~9.700⁴ | moderat (Kbh 50 %!) | delvist målt | moderat |
| Lejebolig.dk | 9.648 | 9.648⁴ | ~8.500⁴ | moderat (~12 % målt) | delvist målt | høj |
| Akutbolig.dk | ~3.221 | ukendt | ukendt | moderat | delvist målt | høj |
| Nordbjerg Aarhus | 172 | 0 | 0 (feed til genudbud) | lavt | målt | lav |
| Danica Ejendomme | ukendt | ukendt | ukendt | lavt | delvist målt | moderat |
| Danmark Bolig (LBF) | ukendt | ukendt | ukendt | højt (org-niveau) | delvist målt | moderat |

Undersøgt og **afvist/0 nye**: DEAS (= findbolig.nu bogstaveligt, 158/158 GUID-match),
ATP + PFA/pensionskasser (udlejes via DEAS/findbolig — målt: Arenahaven ligger allerede
i grundlaget), Bellakvarter (venteliste → home City Projektafdeling = vores home-kanal),
Ikano Bolig og Olav de Linde (**Propstep-frontends** — tenant-subdomæner,
app.propstep.com-billeder, Mongo-id-format), Nybolig (robots forbyder søgesiden),
Lejerbo direkte (robots forbyder /api), Boligdeal (andenhåndsdata bag betalingsvæg,
modelfotos), Hay4You (10 møblerede enheder, ingen offentlige data — evt. manuel aftale),
noli.dk (en restaurant i Ikast; NREP's Noli Studios er kun i Finland), Carlsberg Byen,
Nicolinehus, Domis, UNITY, Bolighub/Risskov Brynet (bot-challenges, respekteret),
minlejebolig/apbolig (certifikatfejl).

¹ efter kildens egen statussemantik. ² efter måling mod grundlaget. ³ heraf 12 studie-
og 6 ungdomsboliger (modbeviserens nuance). ⁴ kildens egen tæller; ikke modbevist.

## 3. Teknisk adgang — de vigtigste

- **Heimstaden**: ét GET til `/ledige-lejeboliger/` giver hele inventaret som indlejret
  JSON (`var _rentals`) med status («Klar til udlejning»), LedigPrDato (64 «Ledig nu»,
  134 fremtidige datoer — 0 i fortiden), leje, m2, koordinater, billeder
  (boligspot.b-cdn.net). Backend: Unik Bolig. Detaljesider serverrenderede med depositum
  (3 mdr.), forudbetalt (1 md.) og aconto.
- **Birch**: åbent JSON-feed `bolig-feed?onlyvacant=1` (5 sider = 59 enheder), eksplicit
  `Status:"Ledig"` + ledig-fra-dato pr. enhed. Egen Umbraco. Modbeviserens nuance: alle
  59 har FREMTIDIG overtagelsesdato (01.10.2026–01.02.2027) — ligner nybyggeri under
  indkøring; vores availability-domæne klassificerer dem korrekt som «senere».
- **CEJ**: bolig.io-white-label; hele udbuddet streames i HTML'ens `__remixContext`
  (2 GET-kald), status `available`/`reserved`, fuld økonomi inkl. depositum/forudbetalt,
  DAWA-adresser. **KRITISK**: payloaden lækker persondata om boligsøgende
  (reservation.lead: navne, e-mails, telefonnumre). En adapter må ALDRIG gemme de felter,
  og CEJ/bolig.io bør orienteres om lækket.
- **EDC Lejeindeks** (edc.dk/lejebolig): komplet struktureret JSON i hver SSR-side inkl.
  fuld adresse, depositum (mdr. + kr.), forudbetalt, aconto, «Ledig fra»-dato og
  isRented/isContractSigned-flag; GET-pagination verificeret; tilladende robots. MEN:
  18 % af stikprøven er aggregerede boligportal.dk-annoncer (source-felt findes — skal
  filtreres fra), og tallet 12.191 er kildens eget, ikke modbevist.
- **RealMæglerne**: åbent GET-JSON-feed (`/boliglistfeed?Udbudsform=Leje`), StatusKode=A.
- **Taurus**: fuld struktureret data pr. bolig (adresse, husnr, A/C, depositum, status,
  overtagelsesdato, møbleret-flag), robots tillader alt.
- **danbolig**: 44 boliger, men søge-API'et er POST-only (skal afklares); platform
  Umbraco + Mindworking (samme familie som home, eget tenant). 4/30 målt = propstep-
  dubletter (kroneidentisk leje/m2) — danbolig udgiver delvist via Propstep.
- **Jeudan**: åbent JSON-API (nova-api.jeudan.dk). **OBS: samme nova-api som C.W. Obel**
  — dedupér på lease-id, og afklar om én tilladelse dækker begge, ellers gentages
  C.W. Obel-fejlen.

## 4. Overlap — hovedmålinger

- 0-overlap MÅLT (adresse+postnr, fuzzy manuelt efterprøvet): Heimstaden 0/198,
  Birch 0/59, CEJ 0/63, Kereby 0/58, Barfoed 0/17, Civica 0/9, Postbyen 0/160,
  RealMæglerne 0, Jeudan 0.
- **DEAS = findbolig.nu**: grundlagets 158 findbolig-GUID'er matcher 1:1 produktionens —
  bogstaveligt samme site. 0 nye.
- **Propstep-kundelisten** afslører frontends, der ligner nye kilder, men ikke er det:
  Ikano, Olav de Linde, AG Gruppen, Nordhusene, Newsec, PKA, NIAM, Akademiker Pension,
  K-Fastigheter, BoStad. Vejen er at udvide VORES propstep-spor med tenant-accountId'er,
  ikke nye scrapes.
- Aggregatorer krydsposter vores kilder: Boligzonen matcher 50 % i København (home,
  findbolig, lokalbolig, dacas krydsposter dér); Lejebolig.dk ~12 % målt.
- EDC: 5/67 (7,5 %) i stikprøven, alle Odense/lokalbolig-porteføljer.

## 5. Availability-værdi

Bedst dokumenterede signaler: Heimstaden (status + dato pr. bolig, dagligt opdateret),
Birch (Ledig + dato), CEJ (available/reserved + availableFrom + reservation.dueOn),
EDC (Ledig fra + isRented/isContractSigned), Taurus (status + overtagelsesdato),
RealMæglerne (StatusKode + FoersteAnnonceringsDato → målbar til-/afgang), Kereby
(available/reserved/completed — førsteklasses semantik), CityApartment («Available
from» + fuld økonomi). Svagest: Jeudan (ingen dato), danbolig (ingen lejestart i feed),
LifeX/HousingAnywhere (booking-styret). Alle nye kilder skal have en kildekontrakt
med struktureret belæg som de eksisterende syv.

## 6. Netto-nye-regnestykket

| trin | boliger |
|---|---|
| I dag (unikke synlige) | 1.446 |
| + Sprint A: Heimstaden ~198 + Birch 59 + CEJ 34 | ~1.737 |
| + Sprint B (målte små): RealMæglerne 34, Taurus 36, danbolig ~38, Barfoed 17 | ~1.862 |
| + opportunistiske: Calum 15, LifeX 21, Postbyen 12, Civica 9, Jeudan 5, CityApartment 5, Kereby 4 | ~1.933 |
| + EDC Lejeindeks (filtreret for boligportal-sager og dubletter) | **>3.000** |

**Ærlig konklusion: målet 2.500–3.000 kan IKKE nås med rene udlejerkilder alene.**
Alle målte udlejerkilder tilsammen giver ~1.900. Vejen til 2.500–3.000 går gennem én
volumenbeslutning: EDC Lejeindeks (teknisk letteste kilde, tilladende robots, fulde
økonomifelter — men kildens tal er ubekræftet og kræver en kvalitetsprobe +
rettighedsdialog først) eller en AFTALE med en aggregator (Boligzonen/Lejebolig.dk
forbyder scraping i vilkårene — kun aftalevejen findes dér).

## 7. Geografi og vægtningsforslag

Foreslået værdivægt pr. ny bolig (skal godkendes): **aarhus 1,5 · kbh_frb 1,3 ·
aalborg 1,2 · odense 1,1 · stor_kbh 1,0 · rest 0,6**. Begrundelse: Aarhus er landets
næststørste lejemarked, men baselinens tyndeste bucket (54); København har størst
efterspørgsel; rest-provins er værdifuld, men mindre søgt.

Hvem lukker hullerne: **Aarhus** ← Birch 24, CEJ 16, danbolig 16, Heimstaden 7, EDC 597⁴.
**Aalborg** ← Calum 15, Heimstaden 12, EDC⁴. **Odense** ← Heimstaden 13, Barfoed 6,
Civica 5, EDC 669⁴. **Kbh** ← Heimstaden 33, CEJ 21, LifeX 21, Postbyen 12.

## 8. Rettigheds- og driftsrisiko

- **Aftale i hus** (mundtlig, optaget — omfang står [UDFYLDES] og SKAL udfyldes før byg,
  jf. Balder-lektionen): CEJ, Kereby, Jeudan, CityApartment. CEJ kræver også afklaring
  af, om platformejeren bolig.io skal give lov.
- **Tilladende robots, eget site, ingen aftale**: Heimstaden (undlad /api/-stier;
  sitemap-stien under /api/feed/ er disallowed trods annoncering i sitemap-indekset —
  brug listesiden), Birch, RealMæglerne, Taurus, Barfoed, Civica, Postbyen, LifeX, EDC.
- **Kræver afklaring**: danbolig (POST-API), Danica (POST-API), Danmark Bolig (POST).
- **Forbudt/blokeret uden aftale**: Boligzonen (vilkår forbyder bots + blokerer
  aggregator-bots ved navn), Lejebolig.dk (vilkår forbyder crawl til konkurrerende
  virksomhed + TDM-forbehold; dyb paginering robots-forbudt), Nybolig (robots forbyder
  søgesiden), Lejerbo (/api robots-forbudt), Housing Denmark (Disallow for ClaudeBot
  m.fl., adresser bevidst skjult), Calum (BoligPortal-whitelabel → BoligPortals vilkår),
  Akutbolig (login-gated), HousingAnywhere (ToS-risiko), Boligdeal (andenhåndsdata).
- **Persondata**: CEJ-payloaden lækker lead-data (må aldrig gemmes; orientér CEJ);
  findbolig-adapterens allowlist-princip gøres obligatorisk for alle nye adaptere.

## 9. Scoring og TOP 10

Score = 4·Volumen + 2·Måling + 2·Overlap + 1,5·Geografi + 1,5·Datafelter +
2·Rettigheder + 1·Indsats (maks. 70). Delscorer 0–5; straf indbygget for ubekræftede
tal (M), overlap (O), forbudt adgang (R) og login/venteliste (V/R).

| # | kilde | V | M | O | G | D | R | I | score |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Heimstaden | 5 | 5 | 5 | 2,8 | 5 | 4 | 5 | **64,7** |
| 2 | Birch Ejendomme | 4 | 5 | 5 | 3,2 | 4,5 | 4 | 5 | **60,5** |
| 3 | CEJ | 3 | 4 | 5 | 3,8 | 5 | 4,5 | 5 | **57,2** |
| 4 | EDC Lejeindeks | 5 | 2 | 5 | 2,6 | 5 | 3 | 5 | **56,4** |
| 5 | RealMæglerne | 3 | 4 | 5 | 2,6 | 3,5 | 4 | 5 | 52,1 |
| 6 | Taurus | 3 | 2,5 | 5 | 2,8 | 5 | 4 | 5 | 51,7 |
| 7 | LifeX | 2 | 4 | 5 | 4,3 | 2 | 4 | 5 | 48,5 |
| 8 | Barfoed Group | 2 | 4 | 5 | 2,7 | 4,5 | 4 | 3 | 47,8 |
| 9 | Calum | 2 | 4 | 5 | 4,0 | 5 | 1,5 | 5 | 47,5 |
| 10 | Postbyen | 1 | 4 | 5 | 4,3 | 3,5 | 4 | 5 | 46,7 |

Uden for top 10: Jeudan 46,5 · Housing Denmark 46,5 · danbolig 46,0 · Kereby 46,0 ·
CityApartment 45,2 · HousingAnywhere 44,7 · Nordbjerg 44,5 · Civica 43,1 ·
Boligzonen 40,9 · Lejebolig.dk 38,0 · Akutbolig 35,4 · Danica 24,1 · Danmark Bolig 17,5.

## 10. Sprints og anbefaling

**Sprint A — de første 3 kilder (anbefales præcist):**
1. **Heimstaden** — ~198 målt og modbevist, 0 overlap, én GET, fulde økonomifelter.
2. **Birch Ejendomme** — 59 målt og modbevist, 0 overlap, åbent feed, lukker
   Aarhus-hullet (24) og Trekantsområdet.
3. **CEJ** — 34 målt, 0 overlap, aftalen er i hus, rigeste felter (depositum +
   forudbetalt, som INGEN nuværende kilde har). Forudsætning: udfyld tilladelsens
   omfang + persondata-allowlist fra dag ét.

Sprint A giver ~285–291 netto nye (~1.737 i alt) og lukker samtidig baseline-hullet
på depositum/forudbetalt.

**Sprint B**: EDC Lejeindeks — men FØRST en kvalitetsprobe (30–50 sager: er de aktuelle,
er adresserne ægte, virker boligportal-filtreringen?) og en rettighedsdialog med EDC.
Dernæst danbolig (efter POST-afklaring), RealMæglerne, Taurus, Barfoed.

**Opportunistisk**: Propstep-tenant-tjek (dækker vores harvest Ikano/Olav de Linde/PKA
m.fl.? Udvid med accountId'er — billigste vej til nye boliger overhovedet); Jeudan +
CityApartment + Kereby (aftaler i hus — byg, når omfang er udfyldt; Jeudan dedupes mod
nova-api); Civica; Postbyen + Nordbjergs data.xml (billigste genudbuds-feeds); LifeX
(hvis møbleret delsegment ønskes); Danica-kontakt; Danmark Bolig (ét skånsomt
POST-testkald efter beslutning).

**Ikke nu**: Boligzonen, Lejebolig.dk, Akutbolig, Boligdeal (vilkår/adgang), Nybolig,
Lejerbo direkte, Housing Denmark, HousingAnywhere, Hay4You, Calum (indtil
BoligPortal-rettigheder er afklaret), DEAS/ATP/PFA/Bellakvarter (allerede dækket —
byg IKKE dubletkanaler).

## Brugerhandlinger (uden for kode)

1. Udfyld omfang i `docs/kildetilladelser.md` for CEJ, Kereby, Jeudan, CityApartment.
2. Orientér CEJ/bolig.io om persondata-lækket i deres offentlige payload.
3. Beslut EDC-sporet (kvalitetsprobe + evt. kontakt til EDC).
4. Beslut om møbleret korttid (LifeX m.fl.) hører hjemme i Bofinda.
