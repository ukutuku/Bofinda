# Boligkort, resultattop og filtre

Udgangspunkt: `296ff4d29d85c87e29e50a3a8abd25111099f9bb` på
`feature/frontend-lancering-v2`. Ændringen kom ind som en patch fra et andet
arbejde og er derefter rettet og efterprøvet i det isolerede testmiljø.

## Ændringen

- Kortene har billedet øverst ved alle listebredder. Den vandrette variant ved
  brede lister er fjernet. De eksisterende én/to kolonner og kompakte kort uden
  foto er bevaret. Billedets `srcset` tilbyder nu både 400 og 800 px.
- Indflytningsprisen står på sin egen, sekundære linje. Det gentagne antal
  boliger på gruppekortets foto er fjernet — tallet står allerede i
  overskriften og i «Se de N adresser».
- Resultatantallet står ét sted: i sidetitlen. Den separate «N boliger
  fundet»-linje og den gentagne `h2` er væk. `.begraensning` bliver stående —
  «Viser 48 af 62 kort — 76 boliger matcher søgningen» er et udsagn om
  udsnittet, ikke en anden overskrift, og den vises kun, når listen er
  beskåret.
- Sorteringen er samlet i én menu af almindelige links (`<details>`) over
  listen, som også virker uden JavaScript. Filtervinduet har ingen
  sorteringsmenu mere og hedder derfor «Filtre».
- Faciliteter og statusvalg står som piller. Prisgrænserne deler en række på
  mobil, og Kilde har sin egen fulde bredde. Valgpiller har et gulv på
  44 × 44 px; rullemenuer er mindst 46 px høje.
- »Kun venteliste« og »Kun reserverede« beskriver den eksisterende filtrering.
  »Specificeret aconto« erstatter »Hele økonomien oplyst«, fordi filteret kun
  kræver husleje og mindst én navngiven aconto-post — den gamle etiket lovede
  mere, end filteret måler. Aktive filterchips bruger de samme betegnelser.
- Prisfilterets forklaring nævner husleje og oplyst aconto til udlejer.
- Ukendt aconto, elforbehold, billedforbehold, blandede gruppers forklaringer
  og gruppelinks med filtre er bevaret. Søge- og prislogikken er ikke ændret.

## Fem rettelser oven på patchen

Patchen blev gennemgået mod reglerne i `CLAUDE.md`, før den blev anvendt, og
målt bagefter. Fem ting blev rettet.

**1. Grundlagslinjerne var skjult, ikke fjernet — og de skal være synlige.**
Patchen samlede de syv `filtergrundlag`-linjer i en lukket
`<details>«Om oplysningerne»`. Målt: 7 linjer, alle 7 inde i den lukkede
boks, 0 på skærmen. De inline-erstatninger, patchen satte i stedet, var
svagere end det, de erstattede:

- faciliteterne nævnte kun 1 af 3 grupper — og den, der manglede, var
  mellemgruppen »oplyser faciliteter uden det«, som reglen i `CLAUDE.md`
  udtrykkeligt er skrevet om;
- status-noterne havde slet ingen tal;
- aconto-grundlaget var erstattet af en definition.

Reglen er, at der skal stå under afkrydsningen, hvor mange der oplyser det,
hvor mange der oplyser faciliteter uden det, og hvor mange der tier og derfor
forsvinder — og at de tre tal skal gå op med det samlede antal. Linjerne er
derfor sat tilbage på skærmen under hver pille-række, og `<details>`-boksen er
fjernet. Efterprøvet på 76 boliger i testbasen:

| Linje | Oplyser | Uden | Tier | Sum |
| --- | ---: | ---: | ---: | ---: |
| Elevator | 34 | 18 | 24 | 76 |
| Venteliste | 0 | 0 | 76 | 76 |
| Reserverede | 0 | 0 | 76 | 76 |
| Specificeret aconto | 59 | 10 | 7 | 76 |

Linjerne står samlet under pillerækken i stedet for at være interleavet
mellem afkrydsningerne — så meget af forenklingen er rigtig og er bevaret.
De er sat ned i vægt, ikke skåret ned. `.filtergrundlag` har et indryk på
25 px fra dengang det stod under en afkrydsning; det nulstilles, og
nulstillingen er skrevet med højere specificitet end den regel, den skal
slå — ikke bare senere i filen. Det er den kaskadefælde, der står
beskrevet seks andre steder i `globals.css`.

**2. `.optaelling` var fjernet.** »69 med kendt total · 0 med indflytningspris
· 6.110–24.010 kr/md« er et forbehold om resultatsættets datakvalitet, ikke en
gentagelse af resultatantallet. Den er sat tilbage — nu som mærkater, ikke som
en tællelinje, så der stadig kun er ét resultatantal på siden.

**3. `srcset` kunne udpege en bredde, værten ikke leverer.** `billedUrl()`
skærer stille ned til nærmeste tilladte bredde i `BREDDER_PR_VAERT`; den
fejler ikke. For en vært med et loft på 400 ville `«800w»` derfor pege på den
samme 400 px-fil som `«400w»`, og browseren ville strække den. Deskriptoren
afledes nu af `breddeTilladt()` — samme kilde, som ruten håndhæver.
**I dag er ingen vært under 800**, så vagten ændrer intet: den er ikke dækket
af en kontrol, fordi den falske gren ikke kan nås med den nuværende værtsliste.

**4. Nulstillingsprøven kunne ikke fejle.** Kontrollen af »Ryd filtre« kørte på
`?sted=Prøveby N` — en søgning uden filtre. Linket peger dér på præcis den
adresse, det kom fra, så prøven bestod, uanset om knappen ryddede noget.
Søgningen bærer nu fire filtre, og prøven måler, at hvert eneste er væk
bagefter, at området står, at chipperne er væk, og at der stadig er
resultater. `sorter` måles for sig: en orden er ikke et filter, og den dag
nogen vil lade ordenen overleve, skal prøven ikke fejle for en rigtig ændring.

**5. Sorteringen var stadig to menuer.** Opgaven beder om én
sorteringsmenu. Patchen samlede de seks sorteringspiller over listen til én
`<details>`-menu — men lod `<select name="sorter">` blive stående nede i
filtervinduet. To steder at lede, to steder at rette.

Feltet kunne ikke bare slettes. Vinduet er en GET-formular, og en
GET-formular sender kun sine egne felter: uden noget, der bar ordenen med,
ville hvert eneste tryk på «Vis resultater» stille søgningen tilbage til
«nyeste», uden at brugeren havde rørt sorteringen. Rullemenuen er derfor
erstattet af et skjult felt, og menuen over listen er nu det eneste sted,
sorteringen vælges. Vinduet hedder følgelig «Filtre» og ikke længere
«Filter og sortering» — det sorterer ikke mere.

Kontrollen måler begge halvdele: at vinduet ikke har en anden
sorteringsmenu, og at ordenen står tilbage efter et filtertryk.

Kilde-feltet delte rækken med sorteringen. Alene i et to-spaltet gitter
stod det i venstre halvdel med en tom spalte ved siden af; det har nu sin
egen fuldbredde-række.

## Hvad der faktisk er målt

Alt er kørt mod det isolerede testmiljø på loopback: PostgreSQL på
`127.0.0.1:55432/bofinda_test`, produktionsbyg serveret af `next start` på
`127.0.0.1:3100`. Syntetiske boliger og genererede testbilleder — ingen
rigtige annoncer, ingen produktionsdata.

| Kontrol | Resultat |
| --- | --- |
| `npx tsc --noEmit` | rent |
| `npm test` (PGlite) | ALT GRØNT |
| `scripts/cloud/kortkontrol.mjs` | 118 kontroller (114 før + 4 om prishierarkiet) |
| `scripts/cloud/filterkontrol.mjs` | 119 kontroller (103 før + 8 om sorteringsmenuen, 2 om nulstillingen, 2 negative, 4 om ordenen) |
| `scripts/cloud/browserkontrol.mjs` | ALT GRØNT |
| `scripts/cloud/browserkontrol-pagination.mjs` | ALT GRØNT |
| `scripts/cloud/lancering.mjs` | alt grønt |

Dækket af de kontroller: 390, 768, 1100 og 1440 px med og uden landkort (20
visninger, 0 vandret overløb); kort uden foto; stående og liggende fotos i ét
billedformat ved alle bredder; en 39 tegns vej med husnummer, etage og dør;
ukendt pris og ukendt aconto; grupper med forskellige arealer, ledigdatoer og
aconto-poster; sorteringsmenuen (lukket som udgangspunkt, 44 px mål, bevarer
filtrene, nulstiller sidetallet, markerer valget efter genindlæsning);
filterdialogens fokus ved åbning, fokusfælde over 25 tab-tryk, Escape,
fokusretur til knappen, kladde der ikke anvendes og forsvinder, «Vis
resultater», nulstilling, tilbage/frem og brug uden JavaScript; paginering.

Målt layout: 20 visninger (4 bredder × 5 sider), **0 vandret overløb** i
alle. 1440 px med kort: kortspalte 546 px, 2 kortspalter à 355 px. 1100 px
med kort: 352 og 2 à 330. 390 og 768 px med kort: listen skjules, kortet
fylder bredden. Filtervinduet er 390×1000 (fuldskærm) på mobil og 720×760
centreret fra 768 px og op.

Grundlagslinjerne blev talt på skærmen efter ændringen: **5 linjer, heraf 0 i
en lukket `<details>`** — mod 7 af 7 skjult, da patchen kom ind.

To negative kontroller står og beviser, at detektorerne kan fejle: fokusprøven
rejser en `show()`-dialog i stedet for `showModal()` og skal opdage fokus bag
den, og nulstillingsprøven fodres med et «Ryd filtre», der ikke har ryddet
noget, og skal opdage det.

**Ikke målt:** rigtige licenserede fotos i boligkortene. Testmiljøet serverer
kun genererede billeder, og produktionens værtsallowlist er ikke rørt.
