# Frontend-lancering v2 — før og efter

Visuel dokumentation for [PR #6](https://github.com/ukutuku/Bofinda/pull/6).
Billederne ligger i [`eksempler/`](eksempler/).

## Hvilke kodeversioner

| | Kode | Hvad det er |
|---|---|---|
| **FØR** | [`3dba93a`](https://github.com/ukutuku/Bofinda/commit/3dba93a) | Product UI v1 plus de to tekstpræciseringer. Udgangspunktet for v2. |
| **EFTER** | opfølgningen oven på [`8d7b51d`](https://github.com/ukutuku/Bofinda/commit/8d7b51d) | Lanceringskandidaten med de tre CSS-rettelser. Den fulde HEAD står i PR #6. |

Før-billederne er taget én gang på `3dba93a` og er **ikke** genfremstillet
her — de er de samme filer, som målingerne i PR #6 blev læst af.

## Sådan er de taget

Mod det isolerede Cloud-testmiljø på loopback (`scripts/cloud/op.sh`), med
`next start` på det byggede output — ikke `next dev`, som tegner sin egen
udviklingsmarkør i hjørnet af hver side.

Samtykkebanneret er afvist med den **rigtige** knap, «Kun det nødvendige».
Det er aldrig skjult med CSS: et skærmbillede, hvor noget er gemt for at se
pænt ud, dokumenterer ikke den side, brugeren får.

Hvert billede er **det, man ser uden at scrolle** — 1440 × 1000 px og
390 × 844 px. Fuldsidesbillederne findes i kørslens eget output og er ikke
taget med her; en liste med 48 kort bliver 13.000 px høj og kan ikke
bruges til at vurdere noget.

## Parrene

### Forside

| Før | Efter |
|---|---|
| [`forside-desktop-foer.png`](eksempler/forside-desktop-foer.png) | [`forside-desktop-efter.png`](eksempler/forside-desktop-efter.png) |
| [`forside-mobil-foer.png`](eksempler/forside-mobil-foer.png) | [`forside-mobil-efter.png`](eksempler/forside-mobil-efter.png) |

Søgefeltet er flyttet op som sidens handling, og de tre tal er gået fra
tre statistikkort til én linje. Afstanden til første boligkort: 870 → 682 px
(desktop) og 1.175 → 773 px (mobil).

### Søgeresultater med aktive filtre

| Før | Efter |
|---|---|
| [`resultater-filtre-desktop-foer.png`](eksempler/resultater-filtre-desktop-foer.png) | [`resultater-filtre-desktop-efter.png`](eksempler/resultater-filtre-desktop-efter.png) |
| [`resultater-filtre-mobil-foer.png`](eksempler/resultater-filtre-mobil-foer.png) | [`resultater-filtre-mobil-efter.png`](eksempler/resultater-filtre-mobil-efter.png) |

Søgningen er `?sted=Attrapby&prisMin=8000&prisMax=20000&vaerelser=2&areal=40&sorter=pris_op`.
De fire aktive filtre står nu som chips med kryds, sorteringen kan skiftes
uden at åbne panelet, og på mobil er grundlagstallene almindelig tekst i
stedet for tre bordede piller.

### Boligdetalje

| Før | Efter |
|---|---|
| [`boligdetalje-desktop-foer.png`](eksempler/boligdetalje-desktop-foer.png) | [`boligdetalje-desktop-efter.png`](eksempler/boligdetalje-desktop-efter.png) |
| [`boligdetalje-mobil-foer.png`](eksempler/boligdetalje-mobil-foer.png) | [`boligdetalje-mobil-efter.png`](eksempler/boligdetalje-mobil-efter.png) |

Samme bolig i begge: **Enkeltvej 104 58, 9001 Prøveby N**, 8.400 kr./md.
Galleriets højde er sat ned fra 470 til 400 px, så titlen, nøgletallene og
begyndelsen af økonomien kan ses uden at scrolle.

## Fotokontrollen — delvist gennemført

**Se [`fotokontrol.md`](fotokontrol.md).** Ét af tre udvalgte danske
fotografier er nået frem og er kørt igennem kort, galleri, billedknap og
lysbord på 390 og 1440 px — **37 kontroller, alle grønne, ingen produktfejl
fundet.** Billederne ligger i [`fotokontrol/`](fotokontrol/).

Motivet er Johannes Sejers sommerhus ved Vesterhavet, 2048 × 1638 px,
liggende, SHA256 efterprøvet mod de afkodede bytes.

**De to stående motiver mangler stadig** — stuen i København og
badeværelset i Holbæk lå ikke i tekstpakken. Dermed er det hårdeste
tilfælde, et stående fotografi i en liggende ramme, ikke set med et
fotografi. Geometrien for det er målt med en genereret stående form; se
[`geometri/`](geometri/).

Skærmbillederne i denne mappe (`eksempler/`) viser stadig de ensfarvede
testaktiver — de er før/efter-dokumentation for layoutet, ikke fotokontrol.

## Hvad billederne ellers ikke viser

Adresser, bynavne og beløb er **syntetiske**: 264 opdigtede boliger fra
testfrøet, ikke de rigtige. Chippernes tekst med rigtige kildenavne og
lange bynavne er ikke set. Datasættet bygges på ny ved hver opsætning, så
de relative aldersmærkater («ny for 1 dag siden») kan afvige en dag mellem
et før- og et efter-billede.

Der er ingen tokens, adgangskoder, mailadresser eller personoplysninger i
billederne. Kortfliserne er lokalt genererede testfliser, ikke
OpenStreetMap.
