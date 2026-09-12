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

## ⚠ Fotokontrollen er IKKE bestået

**Forsøgt 12. september 2026 — se [`fotokontrol.md`](fotokontrol.md).**
De udvalgte danske fotografier kunne ikke hentes: sessionens
egress-politik afviser både `unsplash.com` og `images.pexels.com` med 403
på CONNECT. Der er ikke prøvet igen og ikke søgt uden om.

Geometrien er i stedet målt med genererede former i stående og liggende
format og i lys og mørk tone — 26 kontroller, alle grønne. Det svarer på
beskæring, stræk, højde og overløb, men ikke på, hvordan et rigtigt motiv
ser ud. Billederne ligger i [`geometri/`](geometri/).

Kontrollen kan køres færdig med ét kald, den dag filerne findes:
`node scripts/cloud/fotokontrol.mjs`.


**Alle billeder i mapperne viser ensfarvede testaktiver**, genereret af
`scripts/cloud/aktiver.mjs` — diagonale bånd i én farve, ikke boligfotos.

De siger derfor **intet** om, hvordan boligkortets billedkolonne og
detaljesidens galleri bærer et rigtigt fotografi med anden beskæring,
kontrast, lysstyrke og højde. Det gælder især:

- galleriets nye `max-height: 400px` med et rigtigt motiv,
- «+N billeder»-knappens læsbarhed oven på et lyst motiv — kontrasten er
  målt mod både helt hvidt og helt sort underlag, men ikke set,
- kortets 248 px billedkolonne med et foto i et andet sideforhold.

Fotokontrollen må ikke markeres bestået, før nogen har set kandidaten med
rigtige boligbilleder. Der er ikke hentet fotografier til denne opgave, og
produktionsdata er ikke rørt.

## Hvad billederne ellers ikke viser

Adresser, bynavne og beløb er **syntetiske**: 264 opdigtede boliger fra
testfrøet, ikke de rigtige. Chippernes tekst med rigtige kildenavne og
lange bynavne er ikke set. Datasættet bygges på ny ved hver opsætning, så
de relative aldersmærkater («ny for 1 dag siden») kan afvige en dag mellem
et før- og et efter-billede.

Der er ingen tokens, adgangskoder, mailadresser eller personoplysninger i
billederne. Kortfliserne er lokalt genererede testfliser, ikke
OpenStreetMap.
