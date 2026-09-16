# Tredje runde: galleriknappen — og hvad før/efter-billederne faktisk viser

Bygger på `057ec43`. Tre afgrænsede punkter.

## 1. Galleriknappen sagde et tal, der var regnet af noget andet

**Fundet.** På mobil viste galleriet ét foto og en knap med teksten
«+1 billeder» — selv om boligen havde fire. En læser fik at vide, at der
var to i alt.

**Årsagen** er den fælde, `CLAUDE.md` har et helt afsnit om: to udtryk,
der svarer på det samme spørgsmål, hver for sig korrekte, og som driver
fra hinanden.

| Spørgsmålet | Det ene udtryk | Det andet |
|---|---|---|
| Hvor mange billeder vises? | `vist = billeder.slice(0, 3)` i JS | `.galleri > button:not(:first-child):not(.flere) { display: none }` i CSS under 720 px |

`rest = billeder.length - vist.length` regnede altså med **tre** synlige
ruder. CSS'en viser **én** på en telefon. Begge tal var rigtige om hver
sin ting.

**Rettelsen.** Knappen siger det samlede antal: **«Se alle 4 billeder»**.
Det er sandt ved enhver bredde, uanset hvor mange ruder CSS'en viser, og
det er ét tal fra én kilde. `billeder` er allerede filtreret gennem
`billedUrl()` i `page.tsx`, så tallet er dem, der faktisk kan vises — ikke
rækkerne i `listing_images`.

**Lysbordet åbner nu på det første billede.** `setAaben(vist.length)`
hvilede på den samme antagelse: med den gamle kode åbnede knappen på
**4 / 4**, altså det sidste billede, og på en telefon sprang den de to
over, brugeren aldrig havde set. Målt i den negative kontrol nedenfor.

**Ét billede** får ingen knap. «Se alle 1 billeder» er hverken dansk eller
en handling, og det ene foto åbner selv lysbordet ved klik. Det er nu
prøvet, ikke bare antaget.

## 2. Kontrollerne — og de tre, der ikke kunne fejle

24 nye påstande i `fotokontrol.mjs`, på begge bredder:

| | desktop | mobil |
|---|---|---|
| knappens tekst | «Se alle 4 billeder» | «Se alle 4 billeder» |
| synlige ruder | 3 | **1** |
| berøringsmål | 131 × 44 px | 131 × 44 px |
| lysbordet åbner på | 1 / 4 | 1 / 4 |
| ét billede: knap | ingen | ingen |
| ét billede: tæller | 1 / 1 | 1 / 1 |
| stående motiv i lysbordet | 540 × 810, contain, forhold 0,67 | 270 × 405, contain, forhold 0,67 |

**Negativ kontrol.** Den gamle knap blev sat tilbage, appen bygget om, og
kontrollen kørt: **6 påstande blev røde**, heriblandt
«mobil · 1 rude(r) vises, og knappen siger stadig 4 — knappen siger
«+1 billeder»» og «lysbordet åbner på det FØRSTE billede — tælleren siger
«4 / 4»». Den rigtige kode blev derefter sat tilbage og kørt grøn igen.

**Tre af mine egne nye påstande kunne ikke fejle.** Et adversarielt review
fandt dem, og de er skrevet om:

- *«teksten klippes ikke»* målte `scrollWidth > clientWidth`. Pillen har
  ingen breddebegrænsning og vokser med sin tekst, så tallet er altid 0.
  Måler nu to ting, der faktisk kan gå galt: at knappen bliver på én linje
  (højde ≤ 52 px), og at den er smallere end galleriet.
- *«tallet er uafhængigt af hvor mange ruder der vises»* fulgte allerede af
  den foregående påstand og sagde intet om ruder. Binder nu de to tal
  sammen: **1 rude på mobil, 3 på desktop, og knappen siger 4 begge
  steder.** Den fejler både hvis tallet regnes af ruderne igen, og hvis
  nogen fjerner `display: none` i CSS'en.
- Prøvenavnet hed stadig «+N billeder» om en knap, der siger noget andet.

Og et falsk fallback: `a?.click() ?? b?.click()` er ikke et fallback —
`click()` giver `undefined`, så `??` falder igennem, og **begge** klik
fyrer. Rettet til at vælge elementet først.

## 3. Hvad før/efter-billederne faktisk viser

Den vedlagte LAESMIG sagde «samme visninger, samme data». Det var ikke
præcist nok, og gennemgangen fandt det: i flere par står **andre boliger**
på den samme plads.

**Årsagen er efterprøvet, og det er ikke en fejl i produktet.**
Sorteringen «Nyeste» har et deterministisk sidste led:

```
lib/soeg.ts:408   NYHEDSDATO desc nulls last, first_seen_at desc, id desc
```

To af prøveboligerne deler **både** nyhedsdato og `first_seen_at` til
millisekundet:

```
Udlejervej 17 17 | 2026-09-13 | 2026-09-13 20:30:55.283+00 | b7a55148
Manglervej 5     | 2026-09-13 | 2026-09-13 20:30:55.283+00 | 0253c790
```

Så falder rækkefølgen til `id desc` — og `scripts/cloud/saa.mjs:119`
laver et nyt `randomUUID()` ved hver såning. Datasættets **indhold** er
reproducerbart (fast frø, samme 280 boliger, samme totaler), men
**id'erne er det ikke**. FØR-billederne blev taget før en genstart af
testmiljøet, EFTER-billederne efter — altså mod to forskellige såninger,
og de to boliger byttede plads.

For én og samme database er rækkefølgen fuldt forudsigelig. Det er dét,
`id desc` findes for.

**Det er ikke rettet her**, fordi det ligger uden for denne opgave. Vil
man have par, der kan sammenlignes plads for plads, er der to veje:
et deterministisk id i såningen, eller at tage begge billedsæt i samme
kørsel mod samme base. Den sidste er gratis.

Den rettede LAESMIG siger nu for hvert par, hvad der kan sammenlignes, og
hvad der ikke kan.

## Et fund uden for opgaven, som er værd at kende

**Kortets badge og galleriets knap udtrækker værten på to forskellige
måder.** Begge spørger «ligger dette billede på en tilladt vært?», men:

- badgen på søgekortet tæller i SQL med `VISBAR_VAERT`
  (`lib/soeg.ts:81`), en POSIX-regex på strengen;
- galleriets knap tæller det array, `billedUrl()` → `vaertTilladt()`
  (`lib/billede.ts:139`) slap igennem, altså `new URL().host`.

`new URL().host` normaliserer: små bogstaver, standardport fjernet,
userinfo fjernet, indledende blanktegn trimmet. Regexen gør ingen af
delene, og `^https?://` er versalfølsom. Seks URL-former tælles derfor af
det ene udtryk og ikke af det andet — blandt dem en URL med linjeskift i
`data-lazy-src`, som Dacas-adapteren kopierer ordret.

Samme uenighed rammer `b.forside` og repræsentantvalgets rangering.

**Målt i testbasen: ingen af de seks former forekommer.** Alle 585
billedrækker har små bogstaver, intet blanktegn, ingen userinfo — og
porten er 55433, altså ikke standard, så begge udtryk beholder den.
Uenigheden er **latent, ikke aktiv**. Produktionsdataene kan ikke måles
herfra.

Det er ikke rettet her: en ændring rammer både SQL'en, `forside` og
repræsentantvalget, og det er ikke en drive-by.

## Kontroller

| Kontrol | Resultat |
|---|---|
| `npx tsc --noEmit` | rent |
| `npm test` (PGlite) | ALT GRØNT |
| `kortkontrol.mjs` | 124 |
| `filterkontrol.mjs` | 129 |
| `browserkontrol.mjs` · `…-pagination.mjs` · `lancering.mjs` | grønne |
| `fotokontrol.mjs` | grøn, inkl. 24 nye påstande om galleriknappen |
