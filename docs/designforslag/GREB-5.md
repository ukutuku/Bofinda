# Runde 5: B er valgt, og tre regler bliver mekaniske

1. oktober 2026. Del A er godkendt som #39. Runde 4 står i
[GREB-4.md](GREB-4.md). Alt herunder er målt mod `main`'s app (45a161a) og
den isolerede testbase.

## 1 · Telefonens hero er B

**B er standarden, og porten er grunden til, at det er forsvarligt.**
Rettet 2. oktober 2026. Her stod først «valgt på kompositionen, ikke på
tallene». Det var for beskedent. Tallene peger samme vej, og det, der
gjorde A værd at overveje, er bygget.

**Tallene** fra [GREB-3](GREB-3.md), første boligkorts top i px:

| | I dag | B | A | A mere end B |
|---|---|---|---|---|
| 390 | 571 | 573 (+2) | 671 (+100) | **98** |
| 360 | 571 | 596 (+25) | 684 (+113) | **88** |

Omkring 30 px af hver variants tillæg er luft mellem søgekortet og
«Nyeste boliger». Begge varianter har 32 px, appen i dag har 2. Det er en
rettelse, ikke en omkostning ved heroen. Trækkes luften fra, koster
heroen selv:

| | B | A |
|---|---|---|
| 390 | −28 px | +70 px |
| 360 | −5 px | +83 px |

To forbehold, så tallene ikke siger mere, end de gør:

- **Det er B's hero, der er lavere end i dag, ikke kortet.** Kortet står
  2 px lavere end i dag på 390 og 25 px lavere på 360, fordi luften
  kommer oveni. På 360 er B's hero omtrent som i dag (−5), ikke højere.
- **Afgørelsen hviler på afstanden mellem A og B, og den holder i begge
  bredder:** 88–98 px på det mål, der afgør, om nogen ser en bolig uden at
  rulle.

**A's argument var robusthed:** teksten står på papir, så kontrasten kan
aldrig gå tabt. Men den robusthed er
[`maal-foto.mjs`](gengivelse/maal-foto.mjs). Den afviser med exit 1 et
foto, der ikke kan bære B, og selvprøven viser, at den kan sige nej. A var
varianten for den, der ikke kan måle fotoet. Vi kan måle det.

**Afvises et foto, nogen gerne vil bruge, er det samtalen.** Afvisningen
skal ikke føre til en permanent variant, der koster 70–100 px. Dommen
siger det selv: «fotoet kan ikke bære teksten. Det er en samtale om
fotoet, ikke om en anden variant».

Kompositionen peger samme vej. I B står der en rigtig bolig på første
skærm, og foto, tekst og kort er ét objekt. A var tre stablede blokke, og
3:1-udsnittet skar rummet over. Men det er tallene og porten, der gør
valget forsvarligt, ikke smagen.

**Variant A er fjernet:**

- `greb.css` § 6 har kun B. Klassen `.m-baand` findes ikke mere.
- `greb.js` sætter ingen klasse.
- `runde4.sh` tager ikke A, og `kredit-udrulning.mjs` prøver ikke A.

**Forbeholdet om kontrasten overvåges af `maal-foto.mjs`, ikke af en
antagelse.** Tallet 5,48 var runde 3's øjenbryn i hvid à .84. B's tekst er
nu ren hvid, og på det nuværende foto, i alle ni telefonbredder (320–900),
er den laveste kontrast:

| Tekst | Mod fotoet | Over et helt hvidt foto |
|---|---|---|
| Øjenbryn | 6,26–7,27:1 | 4,69:1 |
| h1 | 5,90–7,15:1 | 4,69:1 |
| Manchet | 6,15–6,74:1 | 4,69:1 |

Ved hvert fotoskift måler `maal-foto.mjs` mod AA i alle bredder og over det
værst tænkelige foto:

- **Kræver fotoet mere slør end loftet 0,60, er dommen AFVIST:** «kræver
  slør 0,65 > loftet 0,6 — fotoet kan ikke bære teksten. Det er en
  samtale om fotoet, ikke om en anden variant: vælg et andet, eller tal om
  det».
- **Der er ingen variant at falde tilbage på.** Før hed den dom «KUN A».

Selvprøven: alle otte tilfælde fik deres facit. Det er B, B · OVERVÅGES og
AFVIST ad seks veje: for tyndt slør, for tykt slør, over loftet, bred
skærm, rettighederne og krediteringen.

**Krediteringsprøven:** syv tilstande i seks bredder har præcis én synlig,
læselig kreditering, og alle otte modprøver blev røde.

## 2 · B's færdige form: rettelserne fra del A og titlen

Gendrivelsen af #39 fandt fejl, som også var designlagets. De er ført ind
her:

- **Fokusringen:** ingen fælles blæk-ring, og ringen i den valgte
  sorteringspille er hvid.
- **Understregningen** står i `--daempet` og gælder også de fire links, der
  før kun blev kendt på deres teal.
- **`.m-vent` er taget ud**, så «vises ikke» ikke ligner «udgivet».
- **Noten om tavse kilder** har `globals.css`' egne to farver.
- **Leaflets links** har to klasser.

**Søgesidens titel var lagets egen fejl.** Laget satte titlen til 32/28 px
over `globals.css`' 22/20 px, og ved den størrelse brækker bynavnet. Den
«rettelse», laget lagde ved siden af, kunne ikke virke mod `globals.css`'
`nowrap`. Nu gælder titelstørrelsen kun over 620 px, og den virkningsløse
regel er fjernet. [GREB-3.md](GREB-3.md) er rettet, der hvor påstanden
står.

| Søgesidens første kort | Uden lag | Med laget, runde 4 | Med laget nu |
|---|---|---|---|
| 390 | 361 px | 398 px | **379 px** |
| 360 | 361 px | 434 px | **377 px** |
| 1440 | 380 px | 398 px | 398 px (titlen er stor over 620 px) |

## 3 · En gengivelse mod rigtige annoncer er en kopi af kildens billeder

**Reglen:** et skærmbillede af en side med rigtige annoncer er en kopi af
kildens billeder, uanset hvem der laver det, og hvorfor. Det må ikke
committes, ikke udgives i et artefakt og ikke lægges i `docs/` (CLAUDE.md:
«Kopiér aldrig kildens billeder»). Rækken er foreslået til fældetabellen
på #22.

**Den mekaniske form** er `hero-maal.mjs` › `skaermbillede`. Alle fire
værktøjer, der skriver billeder (`app-skud.mjs`, `kredit-udrulning.mjs`,
`maal-foto.mjs` og `foto.mjs`), går gennem den.

- **Hvad der må skrives:** kun en side, hvor hvert billede er vores. Det
  betyder loopback (heltefotoet i `public/` og testaktivernes syntetiske
  mønstre og fliser) samt `data:`, `blob:` og `file:`.
- **Proxyer:** `/api/billede` og `/_next/image` afgøres på den adresse, de
  henter.
- **Ellers skrives filen ikke.** Tallene måles stadig, og `maal.json` lister
  de afviste under `afviste`.
- **Vagten er forsigtig:** den ser på hele siden, også uden for et
  klip.

[`gengivelse/proev-kildebilleder.mjs`](gengivelse/proev-kildebilleder.mjs)
prøver vagten mod `main`'s app:

| Tilfælde | Resultat |
|---|---|
| Testbasens forside | skrives (0 fremmede billeder) |
| Kildens billede direkte | afvist |
| Kildens billede gennem `/api/billede` | afvist |
| Kildens billede som CSS-baggrund | afvist |
| Kildens billede i `<picture>` | afvist |

Med vagten tømt blev de fire kildetilfælde røde.

**Hvad den ikke dækker:** på `main` skriver 16 værktøjer i `scripts/cloud/`
skærmbilleder med 69 kald, og ingen af dem har vagten. De kører i dag mod
testbasen, men intet forhindrer en kørsel mod rigtige annoncer.

### Efter gennemsynet: to huller lukket

**1 · Adresser uden vært havde en faldback, ingen havde valgt.** Prædikatet
regnede `data:`, `blob:` og `file:` som «vores». Men et rasterbillede uden
vært kan være en kopi af hvad som helst; fotomålingen laver selv
`data:`-JPEG'er af et foto. Nu har hver adresse én af tre domme, og kun
«egen» må skrives:

| Dom | Hvad |
|---|---|
| egen | http(s) på loopback; `data:image/svg+xml` uden indlejret raster (ikonerne i `mask-image`) |
| fremmed | http(s) på enhver anden vært |
| ukendt — **afvist** | `data:`-raster, `blob:`, `file:`, SVG med `<image>`/`<foreignObject>`, enhver anden ordning |

Vagten læste desuden kun `background-image`. Nu læser den også
`mask-image`, `border-image`, `list-style-image` og `content`. Ikonerne
står netop i `mask-image`.

**2 · Vagten stoppede skrivning, ikke udgivelse.** Når vagten skriver et
billede, kvitterer den nu for det: filens SHA-256 står i
`.billedkontrol.jsonl` i samme mappe.
[`kontroller-billeder.mjs`](gengivelse/kontroller-billeder.mjs) godkender
kun billeder med en kvittering, der passer til bytene. Et billede skrevet
før vagten, af et værktøj uden om den eller ændret bagefter afvises. Det
gør reglen uafhængig af, hvem der tilføjer et nyt skrivested.
Artefaktbyggeren kører kontrollen på hvert billede, før det kopieres. Siger
den nej, bygges intet (prøvet: exit 1, `index.html` urørt).

**Konsekvensen, målt:** ingen af grenens 213 billeder og ingen af
artefaktets 63 publicerede billeder har en kvittering. De er skrevet før
vagten fandtes. De er alle syntetiske, men de kan ikke udgives igen uden
at blive taget om.

Prøven har nu 14 tilfælde, alle grønne:

- de ti fra før, plus `data:`-raster, SVG med raster, `blob:` og en ren SVG;
- kvitteringskæden: et skrevet billede godkendes, mens billeder uden
  kvittering og ændrede billeder afvises.

Modprøve: med «ukendt» vendt til «egen» blev de tre tilfælde uden vært
røde.

### Afslutningen: kvitteringen bærer reglen, og kontrollen rejser med repoet

**Kvitteringen bærer prædikatets version.** Før bar den filens hash, men
ikke dommens grundlag. Når prædikatet blev ændret, gjaldt gamle
kvitteringer stadig for billeder, som den nye regel ville afvise. Det var
stiltiende fredning, samme klasse som `collversion`.

Nu skriver vagten `praedikat: 2` i hver kvittering. Kontrollen godkender
kun kvitteringer udstedt under den nuværende version. En kvittering under
v1 eller uden version afvises med «kvitteret under en anden regel».

Versionen og prædikatet står sammen i
[`billedkontrol.mjs`](gengivelse/billedkontrol.mjs), med et aftryk:
SHA-256 af `fremmedeBilleder`' kildetekst. Er prædikatet ændret, uden at
versionen er hævet, nægter kontrollen at køre. En ændring kan derfor ikke
glemme at gøre de gamle domme ugyldige. Også en kosmetisk ændring kræver et
nyt nummer. Det er prisen for, at ingen skal afgøre, om en ændring
«tæller».

| Version | Commit | Regel |
|---|---|---|
| v1 | `260622d` | dom på vært alene |
| v2 | `996eef1` | tre domme, `data:`-raster, `blob:` og `file:` afvist, `mask-image` læst |

**Kontrollen ligger i `npm test`, ikke i en krog.** En pre-commit-krog
følger ikke med en klon. `npm test` gør, og første led er nu
[`proev-billedkontrol.mjs`](gengivelse/proev-billedkontrol.mjs). Den
kræver hverken browser, app eller database.

Første del kører `kontroller-billeder.mjs --repo docs`. I repoet godkendes
et billede **kun**, hvis det står på
[`billedundtagelser.json`](gengivelse/billedundtagelser.json) med sine
bytes, en grund og en dato. Et nyt billede afvises, også med gyldig
kvittering, for bevisbilleder lever i artefaktet (§ 5).

Listen har 370 poster: grenens 213 og 157 fra `main`, alle uden
kvittering. De er ikke grønne af sig selv. Hver post siger, hvorfor
billedet ligger der, og hvornår det kom til. Posterne fra `main` siger
udtrykkeligt, at herkomsten ikke er efterset. Listen blev lukket
1. oktober 2026:

- en post dateret senere afvises;
- en post for en fil, der er væk, afvises;
- et undtaget billede, der ændres, afvises.

Listen kan derfor kun skrumpe, og kun med vilje.

Anden del beviser på en kopi i `/tmp`, at kontrollen kan fejle. Alle
tolv tilfælde gav det forventede:

| Tilfælde | Dom |
|---|---|
| kvittering under v2 | godkendt |
| kvittering under v1 | afvist |
| kvittering uden version | afvist |
| kvittering for andre bytes | afvist |
| ingen kvittering | afvist |
| undtaget billede | godkendt |
| nyt billede **med** gyldig kvittering | afvist |
| undtaget billede, ændret bagefter | afvist |
| undtagelse dateret efter lukningen | afvist |
| undtagelse uden grund | afvist |
| undtagelse for en fil, der er væk | afvist |
| prædikatet ændret uden ny version | afvist |

Modprøve i det rigtige repo: én JPEG lagt i `docs/designforslag/` gav
exit 1 med «et nyt billede i repoet».

`runde4.sh` nægter desuden en udmappe inde i repoet (exit 2), så fejlen
fanges, før kørslen begynder, og ikke først i `npm test`.

**Ved merge:** `"test"`-linjen konflikterer med `main`, og begge oplagte
løsninger er grønne og forkerte. Den rigtige står ordret i
[`FLETNING.md`](FLETNING.md), både for `main` før og efter #49. Prøven
[`proev-testkaede.mjs`](gengivelse/proev-testkaede.mjs) gør de forkerte
løsninger røde. Den kaldes fra `scripts/test-redigering.ts`, som alle tre
kæder kører, så fletningen ikke kan fjerne den tavst.

**De 157 fra `main` har en frist, ikke en undtagelse.** Deres herkomst er
«ikke efterset», og 90 dage efter lukningen, den 30. december 2026, bliver
kontrollen rød for hver af dem, ingen har set på. Så skal billedet
eftersees, hvorefter posten får herkomsten «kendt» med en grund, eller
fjernes. Grenens 213 har herkomsten «kendt» og ingen frist. Kontrollen
skriver fristen ud ved hver kørsel.

## 4 · Testbasen tømmes, og tømningen måles

[`gengivelse/toem-testbase.sh`](gengivelse/toem-testbase.sh) sletter de
syntetiske boliger fra testbasen. Det er dem fra `test-`-kilderne, de
seedede udlejerannoncer og enhver bolig med et billede fra testaktivernes
stribemønstre. Samtaler slettes først, for de sletter ikke kaskadevis.
Bagefter tæller scriptet de tre slags hver for sig og afbryder med exit 1,
hvis én af dem ikke er 0.

`runde4.sh <udmappe> --rigtige propstep,dacas,balder` kører i denne
rækkefølge:

1. tøm testbasen;
2. importér hver kilde (`importer-testbase.sh`);
3. kontrollér, at der er 0 syntetiske tilbage og mindst én aktiv bolig.

Først derefter måles der. Kørslen giver tal, ikke billeder (§ 3).

Prøvet på testbasen 1. oktober:

| Trin | Med stribemønster | Fra test-kilder | Native | Aktive | Exit |
|---|---|---|---|---|---|
| Kontrol før tømning | 237 | 244 | 36 | 280 | 1 |
| Tømning og kontrol | 0 | 0 | 0 | 0 | 0 |
| `--kontrol --rigtige` uden import | 0 | 0 | 0 | 0 | 1 (ingen aktive) |

Bagefter blev testbasen sået igen med `scripts/cloud/saa.mjs` (280 boliger).

## 5 · Billedernes vægt i git — besluttet

**Besluttet 1. oktober 2026:**

- de 213 billeder bliver, hvor de er;
- der lægges ingen flere bevisbilleder i repoet;
- fremtidige bevisbilleder lever i artefaktet.

**Hvorfor de 213 bliver:** historikken er allerede pushet. At fjerne
billederne fra den kræver omskrevet historik, og omskrevet historik er
værre end vægten. Hver eksisterende klon og hver henvisning til en commit
ville knække. Vægten koster plads, omskrivningen koster tillid til, at en
commit-id betyder det samme i morgen.

**Hvorfor der ikke kommer flere:** vægten er et biprodukt af, at netværket
er lukket. Mod rigtige annoncer skriver `runde4.sh` ingen billeder (§ 3),
så de 25 MB findes kun, fordi kørslerne har måttet gå mod testbasens
syntetiske boliger. Det er ikke en praksis, der skal fortsætte, og
bevisbilledet hører ikke hjemme i git:

- artefaktet viser det;
- git husker det for altid.

**Sådan holdes beslutningen** (§ 3, «Afslutningen»):

- `npm test` afviser ethvert billede i `docs/`, der ikke står på den
  lukkede undtagelsesliste, også et med gyldig kvittering;
- `runde4.sh` nægter at skrive i repoet.

Beslutningen hviler altså ikke på, at nogen husker den.

Tallene, den blev truffet på:

| | |
|---|---|
| `.git` i denne klon | 67 MB (37,3 MiB pakket + 27,9 MiB løse objekter) |
| `main`, alle blobs | 33,0 MB (heraf billeder 31,7 MB) |
| Grenens egne blobs | 25,6 MB, heraf 220 billedversioner på 25,0 MB |
| Billeder i grenens HEAD | 213 filer, 24,5 MB |
| Én kørsel af `runde4.sh` mere, som i dag | 5–12,5 MB oveni, for altid |

Genkodning, squash-merge og at skære til `greb4/` var de andre veje. De
er ikke valgt. Den første og den sidste ville også ændre filer, der
allerede er i historikken. Squash-merge er et valg for den, der merger.

## Filer

| Fil | Hvad |
|---|---|
| [`greb.css`](greb.css), [`greb.js`](greb.js) | B alene; #39's rettelser; den virkningsløse titelregel er fjernet |
| [`forslag.css`](forslag.css) | titelstørrelsen kun over 620 px; #39's rettelser |
| [`gengivelse/hero-maal.mjs`](gengivelse/hero-maal.mjs) | `fremmedeBilleder` (tre domme) og `skaermbillede` (med kvittering) |
| [`gengivelse/billedkontrol.mjs`](gengivelse/billedkontrol.mjs) | kvitteringens format, prædikatets version og aftryk |
| [`gengivelse/kontroller-billeder.mjs`](gengivelse/kontroller-billeder.mjs) | udgivelseskontrollen: artefakt (kvittering under nuværende regel) og `--repo` (lukket undtagelsesliste) |
| [`gengivelse/billedundtagelser.json`](gengivelse/billedundtagelser.json) | 370 billeder uden kvittering, hver med grund, dato og herkomst; lukket 1. oktober, de 157 uefterséte har frist 30. december |
| [`gengivelse/proev-billedkontrol.mjs`](gengivelse/proev-billedkontrol.mjs) | `npm test`'s første led: repoet og seksten modprøver, fristen med |
| [`gengivelse/proev-testkaede.mjs`](gengivelse/proev-testkaede.mjs) | test-kæden kan ikke flettes uden billedkontrollen; elleve modprøver |
| [`gengivelse/test-billedkontrol.ts`](gengivelse/test-billedkontrol.ts) | den samme kontrol som prøvefil med `// gruppe: kerne/2`, til #49's afledte kæde |
| [`FLETNING.md`](FLETNING.md) | fletningen ind i `main`: `"test"`-linjen ordret, `kraevMaal`, syv konflikter, ti poster |
| [`gengivelse/proev-kildebilleder.mjs`](gengivelse/proev-kildebilleder.mjs) | prøven af vagten |
| [`gengivelse/toem-testbase.sh`](gengivelse/toem-testbase.sh) | tømningen og kontrollen |
| [`gengivelse/runde4.sh`](gengivelse/runde4.sh) | `--rigtige`; A er ude; nægter udmappe i repoet |
| [`gengivelse/maal-foto.mjs`](gengivelse/maal-foto.mjs) | over loftet er AFVIST |
| [`GREB-3.md`](GREB-3.md) | titelpåstanden rettet, hvor den står |
| [`GREB-4.md`](GREB-4.md) | «A er rigtig, når maal-foto siger KUN A» rettet, hvor den står |
| [`gengivelse/app-skud.mjs`](gengivelse/app-skud.mjs) | `await kraevMaal`, så den virker mod `main`'s async vagt |
| `scripts/test-redigering.ts` | kalder test-kædens prøve (fem linjer øverst) |
