# Boligkortet og resultatlayoutet

Samlet designændring, september 2026. Skærmbilleder i `docs/kortdesign/`,
kontrollog i `docs/kortdesign/kortkontrol.log`.

Alt herunder er målt i det isolerede testmiljø på loopback
(`scripts/cloud/*`, 264 syntetiske boliger) på det byggede output, ikke i
dev-serveren. Før- og efterbillederne er taget på **samme data og samme
bredde**.

---

## 1 · Resultatlayout: højst to kolonner, målt på listeområdet

Gitteret stod som `repeat(auto-fill, minmax(286px, 1fr))`, som tæller så
mange kort, der kan være. Det gav:

| Bredde | Landkort | Liste | Før | Efter |
|---|---|---|---|---|
| 390 | ja | 346 px | 1 à 346 px | 1 à 346 px |
| 768 | stablet under | 724 px | 2 à 352 px | 2 à 352 px |
| 1100 | ja | 684 px | 2 à 332 px | 2 à 332 px |
| 1100 | nej | 1056 px | **3 à 339 px** | 2 à 518 px |
| 1440 | ja | 928 px | **3 à 296 px** | 2 à 454 px |
| 1440 | nej | 1300 px | **4 à 310 px** | 2 à 640 px |

Et kort på 296 px er ikke et kort, det er en spalte: adressen brækker,
prisen og indflytningsprisen kan ikke stå ved siden af hinanden, og fotoet
bliver 166 px højt.

**En container kan ikke forespørge sin egen bredde.** `.liste` bar
`container-type: inline-size`, men en `@container`-regel om `.liste`s egne
kolonner ville aldrig fyre. Derfor er `.listeomraade` lagt uden om — et lag,
hvis eneste opgave er at kunne måles. Det findes tre steder: søgesiden,
gruppesiden og områdesiderne. Kolonnetallet afgøres ét sted.

Reglen i `CLAUDE.md` — kortene brydes efter deres egen bredde, ikke efter
vinduets — er intakt: forespørgslen går på listeområdet, som bliver smalt,
når landkortet står ved siden af. Ingen `@media` er involveret.

### Sidegevinst: de tre eksisterende containerforespørgsler virkede ikke

`@container (max-width: 460px)` og `(max-width: 250px)` var **unavngivne**,
og den nærmeste container var `.liste`. Ved to kolonner over 620 px så
forespørgslen altså 620 px, mens kortet var 300. Reglerne fyrede aldrig.
Containerne hedder nu `listeomraade` og `boligkort`, og kortets indre
justeringer forespørger kortet.

### Det brede kort er vandret

Over 1020 px listebredde er hvert kort ~500 px, og et 16/9-foto i fuld
bredde ville være 280 px højt — på 1440 px uden landkort 360 px. To kort i
højden per skærm er ikke en resultatliste. Vandret er fotoet 240 px bredt,
og korthøjden ved 1440 px uden landkort er 229–295 px. Den samme liste i
lodret form — 928 px med landkortet ved siden af — er 464–528 px.

### Kort uden foto strækkes ikke

`.liste` har `align-items: start`. Før blev et kort uden foto strakt til
rækkens højde. Målt som forholdet mellem det højeste kort uden foto og det
højeste med foto i samme visning:

| Bredde | Landkort | Før | Efter |
|---|---|---|---|
| 768 | stablet under | 1,01 | 0,65 |
| 1100 | nej | 0,99 | 0,77 |
| 1440 | ja | 0,99 | 0,48 |
| 1440 | nej | 0,99 | 0,90 |

Ved 768 px faldt kortet uden foto fra 471 til 304 px — 167 px, der før var
tom søjle. Kontrollen måler det på blandede rækker: et kort uden foto må
ikke have samme højde som et med.

---

## 2 · Informationshierarki

Rækkefølgen er nu foto → adresse → by → boligtype, værelser, m² →
månedspris → indflytningspris → forbehold → kilde.

**Faktachipsene flyttede op over beløbet.** Før gik kortet fra adresse til
pris og fortalte først bagefter, hvad prisen var for.

**Skillelinjerne gik fra to til én.** Chiprækken havde en `border-top`, og
foden har en. To streger i et kort er inddeling, der er blevet dekoration.
Afstanden gør arbejdet; foden beholder sin ene. Kontrollen tæller dem.

**Gentagelsen på gruppekortet.** Antallet stod tre steder: mærkatet på
fotoet, stedlinjen («9003 Attrapby · 4 boliger») og linket («Se de 4
adresser»). Stedlinjen er nu postnummer og by; antal og type står i
chiprækken, hvor hierarkiet vil have dem. Mærkatet og linket bliver — de er
signalet på fotoet og handlingen.

**«hver» på værelseschippen.** Er gruppens type `vaerelse`, skrev de to
første chips ellers «4 værelser · 5 værelser»: fire udlejede værelser med
fem rum i hvert, men samme ord om to forskellige ting. Ordet siger, at
tallet gælder per bolig. Værelsestallet er en nøgledel i grupperingen, så
alle medlemmer har det samme — «hver» er efterprøvet, ikke et forbehold.

**Statusmærkaterne er der stadig, alle fire.** «ny», «venteliste»,
«reserveret» og «bopælspligt» er oplysninger, ikke pynt. At skjule
«reserveret» for at begrænse antallet af mærkater ville være projektets egen
ærlighedsregel vendt på hovedet.

---

## 3 · Billeder

**Rammen har ét forhold per visning.** 16/9 i den lodrette form, 1/1 i den
vandrette. Første forsøg lod fotoet fylde rækkens højde, så spalten ikke
stod halvtom ved siden af en høj tekst — og så fik hvert kort sin egen
billedform: målt 0,82 · 0,83 · 0,85 · 0,89 · 0,90 · 0,93 · 0,96 · 1,03 ·
1,06 på den samme side. En
ramme, der retter sig efter tekstens længde, er ikke en ramme. Kontrollen
måler spændet mellem forholdene og kræver det under 0,02.

**Stående og liggende er prøvet.** 600×900 og 1800×600 lægges i rammen, og
billedets kasse skal være rammens kasse på millimeteren, med `object-fit:
cover`. Testaktivernes ruder er kvadratiske — bliver de rektangler, er noget
strakt. Prøven skriver i testbasen og skriver tilbage igen.

**Ingen opdigtede billeder.** Kortet uden foto har ingen pladsholder og
intet eksempelbillede. Det står i sin egen højde med en strammere krop, så
formen læser som et valg. Mangler kilden billeder, står det i stedlinjen —
det er en oplysning, ikke en dekoration.

**Billedforbeholdet er bevaret** og står 0–8 px under det foto, det handler
om, på alle fire bredder. Det fandtes ikke i testdataene, så det stod
utestet; kontrollen sætter det nu og skriver tilbage.

---

## 4 · Priser og grupper — uændret

Intet i priselogikken er rørt. Efterprøvet i kontrollen og i `npm test`:

- Grøn total = «kr/md til udlejer». Kendes totalen ikke, står huslejen i
  sort med «kr/md i husleje» — de to kan ikke forveksles på afstand.
- «Udlejer oplyser ikke aconto — spørg om varme og vand.» står, hvor den
  stod.
- El-forbeholdets fire tilstande kommer stadig fra `eltilstand`.
- Gruppens «fra X» bliver til hele spændet over 25 %.
- Gruppelinket bærer filtrene: `/gruppe?b=<id>&by=Attrapby`. Nøglen er
  fortsat udledt af repræsentantens bolig-id.
- «N af M boliger matcher din søgning» står uændret på det blandede kort.
- Gruppens antal, areal og værelser foregiver ikke at beskrive én bolig:
  antallet er mærket som antal, arealet som spænd, værelserne med «hver».

**Ingen afkortning.** Kontrollen læser `text-overflow`, `-webkit-line-clamp`
og `scrollWidth > clientWidth` på pris, indflytningspris, `.ukendt`, `.el`,
`.poster`, `.gruppe-match` og `.gruppe-flere` på alle fire bredder. Nul
træffere.

---

## 5 · Interaktion — uændret

Kortet er ét `<a>`. Kontrollen fejler, hvis der er et `a`, `button`,
`input`, `select`, `textarea`, `[tabindex]` eller `[role=button]` inde i
det. Der er ingen favoritknap og ingen billedpile — hverken før eller nu.
Tastaturfokus giver 2 px ring på alle fire bredder. `id` og `data-bolig`
til landkortets sammenkobling er urørt.

---

## 6 · Hvad der faktisk er kørt

| Kontrol | Resultat |
|---|---|
| `node scripts/cloud/kortkontrol.mjs` (ny) | 120 kontroller grønne |
| `npm test` | ALT GRØNT |
| `scripts/cloud/kontrol.sh` (browserkontrol) | ALT GRØNT |
| `scripts/cloud/kontrol-pagination.sh` | ALT GRØNT |
| `scripts/cloud/lancering.mjs` | alt grønt |
| `npx tsc --noEmit` | rent |

Dækket: 390, 768, 1100 og 1440 px, med og uden landkort, på søgesiden,
forsiden, områdesiden og gruppesiden. Enkeltkort, gruppekort, kort uden
foto, lang adresse, kendt og ukendt aconto, stående og liggende foto,
indflytningspris, billedforbehold, navigation fra et filtreret gruppekort.

**Ikke kørt:** `npm run test:prod` (skriver i produktionen) og de fire
prøver, der måler det rigtige udbud. Ingen Vercel-preview — værten er
spærret af miljøpolitikken.

### Fejl fundet undervejs i mine egne målinger

To målefejl, begge rettet, begge dokumenteret i kontrollen:

1. `getBoundingClientRect()` regner transformer med, og
   `.kort:hover .kort-billede img` skalerer 1,025. Musen lå tilfældigt over
   et kort efter et klik, og kontrollen meldte «463×261 ≠ 452×254» om et
   billede, der sad præcist — 452 · 1,025 = 463,3. Musen flyttes nu væk, og
   rammen måles på `offsetWidth`/`clientWidth`, som ingen transform rører.
2. Prøven for billedformater valgte to boliger med `order by id limit 2`.
   De stod hverken på første side eller som enkeltkort, så prøven målte
   ingenting og meldte sig grøn på kontroller, der aldrig kørte. Boligerne
   vælges nu fra siden.

### En fejl i testopsætningen, ikke i designet

`NEXT_PUBLIC_*` bages ind i klientbundtet ved **byg**, ikke ved start.
`app-op.sh` satte flise-URL'en på processen, men `Landkort.tsx` er en
klientkomponent, så værdien var allerede låst. Et byg med `npm run build`
bar standardværdien, og browserkontrollen hentede tre fliser fra
`tile.openstreetmap.org` midt i et miljø, der ellers kun rører loopback.

`scripts/cloud/byg.sh` bygger nu med de rigtige variabler, og `app-op.sh`
nægter at starte et byg, der bærer OpenStreetMaps URL.

---

## Filer

| Fil | Ændring |
|---|---|
| `app/globals.css` | `.listeomraade`, kolonneloft, vandret kort, kompakt variant uden foto, chiprækken over beløbet, navngivne containere |
| `app/Boligkort.tsx` | Chiprækken flyttet op og omordnet på begge korttyper; gruppens antal og type flyttet fra stedlinjen til chiprækken; «hver» på værelseschippen |
| `app/page.tsx`, `app/gruppe/page.tsx`, `app/lejeboliger/[slug]/page.tsx` | `.listeomraade` om listen |
| `scripts/cloud/kortkontrol.mjs` | Ny kontrol, 120 målinger |
| `scripts/cloud/byg.sh`, `scripts/cloud/app-op.sh` | Byg til testmiljøet uden eksterne flise-URL'er |
