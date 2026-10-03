# Farverevision — hvad står der faktisk på skærmen

**Data er syntetiske** (isoleret lokal Postgres, 280 boliger; byerne Attrapby, Prøveby N/S, Fiktivby). Appen kørte med `next dev` på 127.0.0.1:3100.

Målt 2026-09-30T15:14:53.100Z i Chromium via playwright-core. Hver hex er **målt med `getComputedStyle` i browseren**, ikke læst i CSS'en. Kilden (fil:linje) er fundet med Chromes egen kaskade (CDP `CSS.getMatchedStylesForNode`: den vindende deklaration og dens `var()`-kæde) og derefter slået op i filerne; linjenummeret er deklarationens linje.

- **Før** = siden som den er på grenen (kun `nextjs-portal` skjult).
- **Runde 2** = `runde2-lag/forslag.css` + `greb.css` indsat med `addStyleTag`, `greb.js` + `__bofindaForslag({})`. De tre lagfiler er byte-identiske med `docs/designforslag/*` i HEAD (b5d5f50). Arbejdskopien i repoet har uindcheckede ændringer til de samme filer (bl.a. `--flade-groen` → `--handlingsflade`, ordmærket → `--blaek`); **de er ikke målt her**.
- Sider: `/`, `/?sted=Attrapby`, `/bolig/12ef9b7d-e0d1-46c0-ade6-2b1b2e3d887c` (flest billeder), `/bolig/01bf6b41-cdc3-46f5-bb74-c26a9d71a27f` (uden billeder). Bredder 1440 og 390. Samtykkecookie sat til «nej» før målingen (efterprøvet).
- Kortet på søgesiden vises ikke i 390 uden at være valgt, så markørerne i 390 er målt på `/?sted=Attrapby&kort=1` (ekstra side, kun til elementtabellen). Boligsiderne har selv et kort med én markør.
- Lagkontrol: i runde 2 fandtes `.soeg-faner`, `.ub-kort` og 3 × `.soegefelt-ekstra` på forsiden i begge bredder; ingen samtykkebanner på nogen side.

## 1 · Svaret: er «Søg» samme token som --kendt?

**Nej.** I runde 2 er «Søg»-knappens baggrund **#083a34** = `--flade-groen` (defineret i runde2-lag/greb.css:16). `--kendt` er **#0f4d43** (runde2-lag/forslag.css:33). De er to tokens med to værdier; ΔE00 mellem dem er **6.21**.

- Værdien #083a34 er den samme hex som **før**-tilstandens `--accent-mrk` (app/globals.css:22 = #083a34) — altså førhenværende hover-farve for knapperne.
- I **før** er «Søg» #0f4d43 = `--accent` — samme hex som runde 2's `--kendt`.
- `--flade-groen` har eget navn og en egen kommentar i runde2-lag/greb.css:13-15 («Mørk teal som FLADE … Fladen er afsender: ét bånd og én primær handling pr. side. Aldrig i tekst, aldrig på et tal.»). Farveafsnittet i runde2-lag/forslag.css:30-43 nævner den ikke (ordet «flade» står kun i forslag.css:250, om en anden flade); dér står «Alt, der er en handling, er blæk».

- Hover: «Søg» går i runde 2 til **#0b4a42** = `--flade-groen-hover` (greb.css:17). ΔE00 mellem den og `--kendt` er **1.27** — tættere på `--kendt` end hvilefarven er (6.21).
- Hvor #083a34 ellers står i runde 2 (fejningen): `a.knap` (Se annoncen hos Prøvekilde Gam…, bolig-med-billeder/bolig-uden-billeder); `button.soegeknap` (Søg…, forside/soeg); `section.udlejerbaand` (For udlejereUdlej din bolig på…, forside).

Kort, med de fire elementer (hvilefarve; detaljer og kilder i afsnit 2):

| Element | Før | Runde 2 |
|---|---|---|
| «Opret annonce», baggrund | #0f4d43 · --accent: #0f4d43 | #14161a · --accent: var(--blaek) → --blaek: #14161a |
| «Søg», baggrund | #0f4d43 · --accent: #0f4d43 | #083a34 · --flade-groen: #083a34 |
| Ordmærket, tekst | #0f4d43 · --accent: #0f4d43 | #0f4d43 · --kendt: #0f4d43 |
| Nål a, søgefeltet | #0f4d43 × 0.72 (tegnet #527f78) · --accent: #0f4d43 | #14161a × 0.72 (tegnet #56575a) · --accent: var(--blaek) → --blaek: #14161a |
| Nål b, boligsiden | #5f6672 × 0.6 (tegnet #9c9fa5) · currentColor = color fra «.detalje-hoved .sted» (var(--daempet) → #5f6672) | #4d5452 × 0.6 (tegnet #919492) · currentColor = color fra «.detalje-hoved .sted» (var(--daempet) → #4d5452) |
| Nål c, kortmarkør | #0f4d43 · --accent: #0f4d43 | #14161a · --accent: var(--blaek) → --blaek: #14161a |

## 2 · De fire elementer — før og runde 2

Hex er computed-værdien. «Tegnet» er den farve, der faktisk lægges på skærmen, når elementet har opacitet < 1: sammensat med opaciteten over den første uigennemsigtige baggrund bag det. Er værdien ens på alle sider og bredder, står den én gang; ellers står varianterne med sted.

| Element | Del | Før hex | Runde 2 hex | Token (før → runde 2) | Kilde før · runde 2 |
|---|---|---|---|---|---|
| «Opret annonce» (header) | baggrund | #0f4d43 | #14161a | --accent: #0f4d43 → --accent: var(--blaek) → --blaek: #14161a | **før:** `.topnav a.nav-primaer, .tophandlinger .nav-primaer { background: var(--accent) }` app/globals.css:152 · `--accent: #0f4d43` app/globals.css:20<br>**runde 2:** `.topnav a.nav-primaer, .tophandlinger .nav-primaer { background: var(--accent) }` app/globals.css:152 · `--accent: var(--blaek)` runde2-lag/forslag.css:41 · `--blaek: #14161a` runde2-lag/forslag.css:34 |
| «Opret annonce» (header) | tekst | #ffffff | #ffffff | #fff → #fff | **før:** `.topnav a.nav-primaer, .tophandlinger .nav-primaer { color: #fff }` app/globals.css:152<br>**runde 2:** `.topnav a.nav-primaer, .tophandlinger .nav-primaer { color: #fff }` app/globals.css:152 |
| «Søg»-knappen | baggrund | #0f4d43 | #083a34 | --accent: #0f4d43 → --flade-groen: #083a34 | **før:** `.soegeknap { background: var(--accent) }` app/globals.css:1259 · `--accent: #0f4d43` app/globals.css:20<br>**runde 2:** `.soegeknap, .hero .soegeknap { background: var(--flade-groen) }` runde2-lag/greb.css:101 · `--flade-groen: #083a34` runde2-lag/greb.css:16 |
| «Søg»-knappen | tekst | #ffffff | #ffffff | #fff → #fff | **før:** `.soegeknap { color: #fff }` app/globals.css:1259<br>**runde 2:** `.soegeknap, .hero .soegeknap { color: #fff }` runde2-lag/greb.css:101 |
| «Søg»-knappen | kant | #ffffff (kantbredde 0px) | #083a34 (kantbredde 0px) | 0 → --flade-groen: #083a34 | **før:** `.soegeknap { border: 0 }` app/globals.css:1259<br>**runde 2:** `.soegeknap, .hero .soegeknap { border-color: var(--flade-groen) }` runde2-lag/greb.css:101 · `--flade-groen: #083a34` runde2-lag/greb.css:16 |
| Ordmærket BOFINDA | tekst | #0f4d43 | #0f4d43 | --accent: #0f4d43 → --kendt: #0f4d43 | **før:** `.maerke { color: var(--accent) }` app/globals.css:140 · `--accent: #0f4d43` app/globals.css:20<br>**runde 2:** `.maerke, .maerke:hover { color: var(--kendt) }` runde2-lag/forslag.css:82 · `--kendt: #0f4d43` runde2-lag/forslag.css:33 |
| Nål a: «By eller område» | fyld (maske på ::before) | #0f4d43 × 0.72 → tegnet **#527f78** (på #ffffff) | #14161a × 0.72 → tegnet **#56575a** (på #ffffff) | --accent: #0f4d43 → --accent: var(--blaek) → --blaek: #14161a | **før:** `.soegefelt::before { background: var(--accent) }` app/globals.css:1197 · `--accent: #0f4d43` app/globals.css:20<br>**runde 2:** `.soegefelt::before { background: var(--accent) }` app/globals.css:1197 · `--accent: var(--blaek)` runde2-lag/forslag.css:41 · `--blaek: #14161a` runde2-lag/forslag.css:34 |
| Nål b: postnr/by på boligsiden | fyld (maske på ::before) | #5f6672 × 0.6 → tegnet **#9c9fa5** (på #f7f5f1) | #4d5452 × 0.6 → tegnet **#919492** (på #f7f5f1) | currentColor = color fra «.detalje-hoved .sted» (var(--daempet) → #5f6672) → currentColor = color fra «.detalje-hoved .sted» (var(--daempet) → #4d5452) | **før:** `.detalje-hoved .sted::before { background: currentColor }` app/globals.css:773 · `.detalje-hoved .sted { color: var(--daempet) }` app/globals.css:769 · `--daempet: #5f6672` app/globals.css:15<br>**runde 2:** `.detalje-hoved .sted::before { background: currentColor }` app/globals.css:773 · `.detalje-hoved .sted { color: var(--daempet) }` app/globals.css:769 · `--daempet: #4d5452` runde2-lag/forslag.css:48 |
| Nål c: kortmarkør | fyld | #0f4d43 | #14161a | --accent: #0f4d43 → --accent: var(--blaek) → --blaek: #14161a | **før:** `.maerke-boble { background: var(--accent) }` app/globals.css:2130 · `--accent: #0f4d43` app/globals.css:20<br>**runde 2:** `.maerke-boble { background: var(--accent) }` app/globals.css:2130 · `--accent: var(--blaek)` runde2-lag/forslag.css:41 · `--blaek: #14161a` runde2-lag/forslag.css:34 |
| Nål c: kortmarkør | kant | #ffffff (kantbredde 2px) | #ffffff (kantbredde 2px) | 2px solid #fff → 2px solid #fff | **før:** `.maerke-boble { border: 2px solid #fff }` app/globals.css:2130<br>**runde 2:** `.maerke-boble { border: 2px solid #fff }` app/globals.css:2130 |
| Nål c: kortmarkør | tal | #ffffff | #ffffff | #fff → #fff | **før:** `.maerke-boble { color: #fff }` app/globals.css:2130<br>**runde 2:** `.maerke-boble { color: #fff }` app/globals.css:2130 |
| Nål c: kortmarkør, valgt (efter klik) | fyld | #8a5300 | #ffffff | --advarsel: #8a5300 → --kort: #ffffff | **før:** `.maerke-boble.valgt { background: var(--advarsel) }` app/globals.css:2134 · `--advarsel: #8a5300` app/globals.css:25<br>**runde 2:** `.maerke-boble.valgt { background: var(--kort) }` runde2-lag/forslag.css:222 · `--kort: #ffffff` app/globals.css:13 |
| Nål c: kortmarkør, valgt (efter klik) | kant | #ffffff (kantbredde 2px) | #14161a (kantbredde 2px) | 2px solid #fff → --blaek: #14161a | **før:** `.maerke-boble { border: 2px solid #fff }` app/globals.css:2130<br>**runde 2:** `.maerke-boble.valgt { border-color: var(--blaek) }` runde2-lag/forslag.css:222 · `--blaek: #14161a` runde2-lag/forslag.css:34 |
| Nål c: kortmarkør, valgt (efter klik) | tal | #ffffff | #14161a | #fff → --blaek: #14161a | **før:** `.maerke-boble { color: #fff }` app/globals.css:2130<br>**runde 2:** `.maerke-boble.valgt { color: var(--blaek) }` runde2-lag/forslag.css:222 · `--blaek: #14161a` runde2-lag/forslag.css:34 |
| Nål d: ikon i «Vis kort/liste» (ekstra) | fyld (maske) | #14161a × 0.75 → tegnet **#4f5053** (på #ffffff) | #14161a × 0.75 → tegnet **#4f5053** (på #ffffff) | currentColor = color fra «.filterknap, .kortvalg» (var(--tekst) → #14161a) → currentColor = color fra «.filterknap, .kortvalg» (var(--tekst) → #14161a) | **før:** `.fk-ikon, .kv-ikon { background: currentColor }` app/globals.css:1240 · `.filterknap, .kortvalg { color: var(--tekst) }` app/globals.css:1232 · `--tekst: #14161a` app/globals.css:14<br>**runde 2:** `.fk-ikon, .kv-ikon { background: currentColor }` app/globals.css:1240 · `.filterknap, .kortvalg { color: var(--tekst) }` app/globals.css:1232 · `--tekst: #14161a` app/globals.css:14 |

Hvor elementerne findes:

- «Opret annonce» (header): før forside@1440, soeg@1440, bolig-med-billeder@1440, bolig-uden-billeder@1440, forside@390, soeg@390, bolig-med-billeder@390, bolig-uden-billeder@390, soeg-kort-valgt@390; runde 2 forside@1440, soeg@1440, bolig-med-billeder@1440, bolig-uden-billeder@1440, forside@390, soeg@390, bolig-med-billeder@390, bolig-uden-billeder@390, soeg-kort-valgt@390
- «Søg»-knappen: før forside@1440, soeg@1440, forside@390, soeg@390, soeg-kort-valgt@390; runde 2 forside@1440, soeg@1440, forside@390, soeg@390, soeg-kort-valgt@390
- Ordmærket BOFINDA: før forside@1440, soeg@1440, bolig-med-billeder@1440, bolig-uden-billeder@1440, forside@390, soeg@390, bolig-med-billeder@390, bolig-uden-billeder@390, soeg-kort-valgt@390; runde 2 forside@1440, soeg@1440, bolig-med-billeder@1440, bolig-uden-billeder@1440, forside@390, soeg@390, bolig-med-billeder@390, bolig-uden-billeder@390, soeg-kort-valgt@390
- Nål a: «By eller område»: før forside@1440, soeg@1440, forside@390, soeg@390, soeg-kort-valgt@390; runde 2 forside@1440, soeg@1440, forside@390, soeg@390, soeg-kort-valgt@390
- Nål b: postnr/by på boligsiden: før bolig-med-billeder@1440, bolig-uden-billeder@1440, bolig-med-billeder@390, bolig-uden-billeder@390; runde 2 bolig-med-billeder@1440, bolig-uden-billeder@1440, bolig-med-billeder@390, bolig-uden-billeder@390
- Nål c: kortmarkør: før soeg@1440, bolig-med-billeder@1440, bolig-uden-billeder@1440, bolig-med-billeder@390, bolig-uden-billeder@390, soeg-kort-valgt@390; runde 2 soeg@1440, bolig-med-billeder@1440, bolig-uden-billeder@1440, bolig-med-billeder@390, bolig-uden-billeder@390, soeg-kort-valgt@390; i DOM'en men ikke synlig: soeg@390
- Nål c: kortmarkør, valgt (efter klik): før soeg@1440, soeg-kort-valgt@390; runde 2 soeg@1440, soeg-kort-valgt@390; i DOM'en men ikke synlig: soeg@390
- Nål d: ikon i «Vis kort/liste» (ekstra): før soeg@1440, soeg@390, soeg-kort-valgt@390; runde 2 soeg@1440, soeg@390, soeg-kort-valgt@390

Hover (forsiden, 1440, musen over knappen, 600 ms):

| Element | Før baggrund | Runde 2 baggrund |
|---|---|---|
| «Opret annonce» (header) | #083a34 | #2d3138 |
| «Søg»-knappen | #083a34 | #0b4a42 |

Nålene i runde 2: ingen af de målte nåle er grønne. Markørerne på kortet går fra --accent (#0f4d43) til --accent → --blaek (#14161a), fordi forslag.css:41 peger --accent på blæk; globals.css:2130 (`.maerke-boble { background: var(--accent) }`) er uændret. Den valgte markør er hvid med blæk-kant (forslag.css:222). Fejningen nedenfor bekræfter det: der står ingen grøn nål eller markør i runde 2. Iagttagelsen «kortnålen er teal» passer altså på før-tilstanden, ikke på runde 2 — heller ikke på de indcheckede runde 2-skud (docs/designforslag/greb/efter/soegning-1440.png og forside-1440.png viser sorte markører og en grå nål, set efter).

## 3 · Tokens (målt på :root i browseren)

| Token | Før | Runde 2 | Defineret |
|---|---|---|---|
| `--kendt` | (findes ikke) | #0f4d43 | runde2-lag/forslag.css:33 = #0f4d43 |
| `--accent` | #0f4d43 | #14161a | app/globals.css:20 = #0f4d43; runde2-lag/forslag.css:41 = var(--blaek) |
| `--accent-mrk` | #083a34 | #2d3138 | app/globals.css:22 = #083a34; runde2-lag/forslag.css:42 = var(--blaek-hover) |
| `--flade-groen` | (findes ikke) | #083a34 | runde2-lag/greb.css:16 = #083a34 |
| `--flade-groen-hover` | (findes ikke) | #0b4a42 | runde2-lag/greb.css:17 = #0b4a42 |
| `--blaek` | (findes ikke) | #14161a | runde2-lag/forslag.css:34 = #14161a |
| `--blaek-hover` | (findes ikke) | #2d3138 | runde2-lag/forslag.css:35 = #2d3138 |
| `--tekst` | #14161a | #14161a | app/globals.css:14 = #14161a |
| `--daempet` | (findes ikke) | (findes ikke) | app/globals.css:15 = #5f6672; runde2-lag/forslag.css:48 = #4d5452 |

`--daempet` i runde 2 er ikke læst af token-funktionen; den står i nål b's kæde ovenfor (#4d5452).

## 4 · Fejningen — alt grønt på siderne

Grøn familie: HSL-farvetone 130–200°, mætning ≥ 0,12, lyshed 0,05–0,90, alfa > 0,1. Egenskaber: color (kun med egne tekstnoder, en pseudo med tekstindhold eller en svg-form der bruger farven), background-color, border-*-color (kun sider med bredde > 0 og stil ≠ none), fill, stroke, outline-color, text-decoration-color (kun når de tegnes). Alle synlige elementer inkl. svg-børn og ::before/::after. Fire sider × to bredder pr. tilstand. «Antal» er antal forekomster summeret over sider og bredder (en kant tæller én gang pr. side af boksen).

«Kendt beløb» = elementet ligger i `.kort-pris:not(.kun-leje)`, `.oek-tal:not(.ukendt-tal)` eller `.gemt-pris:not(.kun-leje)` — de tre steder, forslag.css:37-40 selv kalder «kendt». `.ub-kort dt.kendt` (runde 2, greb.js) er holdt for sig: den viser et **antal boliger**, ikke et beløb.

### Før: 476 forekomster i 136 grupper (egenskab, hex, selektor, tekst)

**Kendt beløb:** `div.kort-pris` color #0f4d43 × 160 (69 forskellige tekster); `div.oek-tal` color #0f4d43 × 4 (2 forskellige tekster).

**Grønt, der IKKE er et kendt beløb** — 312 forekomster:

| Selektor | Egenskab | Hex | Tegnet | Antal | Hvor | Tekst (uddrag) | Hvad |
|---|---|---|---|---|---|---|---|
| `span.maerkat.m-ny` | color | #0f4d43 | = | 74 | forside@1440, soeg@1440, forside@390, soeg@390 | ny for 1 dag siden ‖ ny bolig for 1 dag siden ‖ ny bolig for 2 dage siden … (4) | IKKE et kendt beløb |
| `div.gruppe-flere` | color | #0f4d43 | = | 60 | forside@1440, soeg@1440, forside@390, soeg@390 | Se de 3 adresser → ‖ Se de 5 adresser → ‖ Se de 4 adresser → … (5) | IKKE et kendt beløb |
| `span.maerke-boble` | background-color | #0f4d43 | = | 46 | soeg@1440, bolig-med-billeder@1440, bolig-uden-billeder@1440, bolig-med-billeder@390, bolig-uden-billeder@390 | 3 ‖ 5 ‖  … (6) | IKKE et kendt beløb |
| `a.knap` | border-*-color | #0f4d43 | = | 16 | bolig-med-billeder@1440, bolig-uden-billeder@1440, bolig-med-billeder@390, bolig-uden-billeder@390 | Se annoncen hos Prøvekilde Gamma | IKKE et kendt beløb |
| `a.maerke` | color | #0f4d43 | = | 8 | forside@1440, soeg@1440, bolig-med-billeder@1440, bolig-uden-billeder@1440, forside@390, soeg@390, bolig-med-billeder@390, bolig-uden-billeder@390 | BOFINDA | IKKE et kendt beløb |
| `a.nav-primaer` | background-color | #0f4d43 | = | 8 | forside@1440, soeg@1440, bolig-med-billeder@1440, bolig-uden-billeder@1440, forside@390, soeg@390, bolig-med-billeder@390, bolig-uden-billeder@390 | Opret annonce | IKKE et kendt beløb |
| `div.gem-raek > button` | border-*-color | #0f4d43 | = | 8 | soeg@1440, soeg@390 | Send mig besked | IKKE et kendt beløb |
| `p.populaere > a` | color | #0f4d43 | = | 8 | forside@1440, forside@390 | Prøveby N ‖ Attrapby ‖ Prøveby S … (4) | IKKE et kendt beløb |
| `span.side-nu` | border-*-color | #0f4d43 | = | 8 | forside@1440, forside@390 | 1 | IKKE et kendt beløb |
| `div.leaflet-control-attribution.leaflet-control > a` | color | #0078a8 | = | 5 | soeg@1440, bolig-med-billeder@1440, bolig-uden-billeder@1440, bolig-med-billeder@390, bolig-uden-billeder@390 | Leaflet | IKKE et kendt beløb |
| `a.knap` | background-color | #0f4d43 | = | 4 | bolig-med-billeder@1440, bolig-uden-billeder@1440, bolig-med-billeder@390, bolig-uden-billeder@390 | Se annoncen hos Prøvekilde Gamma | IKKE et kendt beløb |
| `a.sti-tilbage` | color | #0f4d43 | = | 4 | bolig-med-billeder@1440, bolig-uden-billeder@1440, bolig-med-billeder@390, bolig-uden-billeder@390 | Forside | IKKE et kendt beløb |
| `a.sti-tilbage > span` | color | #0f4d43 | = | 4 | bolig-med-billeder@1440, bolig-uden-billeder@1440, bolig-med-billeder@390, bolig-uden-billeder@390 | ← | IKKE et kendt beløb |
| `button.soegeknap` | background-color | #0f4d43 | = | 4 | forside@1440, soeg@1440, forside@390, soeg@390 | Søg | IKKE et kendt beløb |
| `details.metode > summary` | color | #0f4d43 | = | 4 | bolig-med-billeder@1440, bolig-uden-billeder@1440, bolig-med-billeder@390, bolig-uden-billeder@390 | Sådan beregner vi | IKKE et kendt beløb |
| `div.soegefelt.sf-sted::before` | background-color (maske-ikon) | #0f4d43 | #527f78 | 4 | forside@1440, soeg@1440, forside@390, soeg@390 | By eller område | IKKE et kendt beløb |
| `li.nt-doer::before` | background-color (maske-ikon) | #0f4d43 | #3d6f66 | 4 | bolig-med-billeder@1440, bolig-uden-billeder@1440, bolig-med-billeder@390, bolig-uden-billeder@390 | 2værelser ‖ 5værelser | IKKE et kendt beløb |
| `li.nt-hus::before` | background-color (maske-ikon) | #0f4d43 | #3d6f66 | 4 | bolig-med-billeder@1440, bolig-uden-billeder@1440, bolig-med-billeder@390, bolig-uden-billeder@390 | Studieboligboligtype | IKKE et kendt beløb |
| `li.nt-maal::before` | background-color (maske-ikon) | #0f4d43 | #3d6f66 | 4 | bolig-med-billeder@1440, bolig-uden-billeder@1440, bolig-med-billeder@390, bolig-uden-billeder@390 | 51 m²boligareal ‖ 45 m²boligareal | IKKE et kendt beløb |
| `li.nt-moent::before` | background-color (maske-ikon) | #0f4d43 | #3d6f66 | 4 | bolig-med-billeder@1440, bolig-uden-billeder@1440, bolig-med-billeder@390, bolig-uden-billeder@390 | 22.320 kr.pr. md. til udlejer ‖ 23.580 kr.pr. md. til udlejer | IKKE et kendt beløb |
| `a.ub-knap` | color | #083a34 | = | 2 | forside@1440, forside@390 | Opret annonce → | IKKE et kendt beløb |
| `div.gem-raek > button` | background-color | #0f4d43 | = | 2 | soeg@1440, soeg@390 | Send mig besked | IKKE et kendt beløb |
| `li > strong` | color | #0f4d43 | = | 2 | forside@1440, forside@390 | 264 | IKKE et kendt beløb |
| `li.ts-hus > strong` | color | #0f4d43 | = | 2 | forside@1440, forside@390 | 279 | IKKE et kendt beløb |
| `li.ts-kalender > strong` | color | #0f4d43 | = | 2 | forside@1440, forside@390 | 12 | IKKE et kendt beløb |
| `li.ts-moent > strong` | color | #0f4d43 | = | 2 | forside@1440, forside@390 | 252 | IKKE et kendt beløb |
| `p.gem-vilkaar > a` | color | #0f4d43 | = | 2 | soeg@1440, soeg@390 | Sådan behandler vi dine oplysninger | IKKE et kendt beløb |
| `p.gem-vilkaar > a` | text-decoration-color | #0f4d43 | = | 2 | soeg@1440, soeg@390 | Sådan behandler vi dine oplysninger | IKKE et kendt beløb |
| `p.hero-oejenbryn` | color | #0f4d43 | = | 2 | forside@1440, forside@390 | Lejeboliger med overblik | IKKE et kendt beløb |
| `span.ik-flise.ik-filter::before` | background-color (maske-ikon) | #0f4d43 | = | 2 | forside@1440, forside@390 |  | IKKE et kendt beløb |
| `span.ik-flise.ik-klokke::before` | background-color (maske-ikon) | #0f4d43 | = | 2 | forside@1440, forside@390 |  | IKKE et kendt beløb |
| `span.ik-flise.ik-moent::before` | background-color (maske-ikon) | #0f4d43 | = | 2 | forside@1440, forside@390 |  | IKKE et kendt beløb |
| `span.side-nu` | background-color | #0f4d43 | = | 2 | forside@1440, forside@390 | 1 | IKKE et kendt beløb |
| `div.gruppe-flere` | text-decoration-color | #0f4d43 | = | 1 | soeg@390 | Se de 5 adresser → | IKKE et kendt beløb |
| `li.ts-hus::before` | background-color (maske-ikon) | #0f4d43 | #33685f | 1 | forside@1440 | 279lejeboliger fra 4 kilder | IKKE et kendt beløb |
| `li.ts-kalender::before` | background-color (maske-ikon) | #0f4d43 | #33685f | 1 | forside@1440 | 12kan overtages nu | IKKE et kendt beløb |
| `li.ts-moent::before` | background-color (maske-ikon) | #0f4d43 | #33685f | 1 | forside@1440 | 252med hele udgiften til udlejer oplyst  | IKKE et kendt beløb |
| `ul.talstribe.punkter > li::before` | background-color (maske-ikon) | #0f4d43 | #33685f | 1 | forside@1440 | 264 timerfra en bolig annonceres, til de | IKKE et kendt beløb |

### Runde 2: 210 forekomster i 82 grupper (egenskab, hex, selektor, tekst)

**Kendt beløb:** `div.kort-pris` color #0f4d43 × 160 (69 forskellige tekster); `div.oek-tal` color #0f4d43 × 4 (2 forskellige tekster).

**Grønt, der IKKE er et kendt beløb** — 46 forekomster:

| Selektor | Egenskab | Hex | Tegnet | Antal | Hvor | Tekst (uddrag) | Hvad |
|---|---|---|---|---|---|---|---|
| `a.knap` | border-*-color | #083a34 | = | 16 | bolig-med-billeder@1440, bolig-uden-billeder@1440, bolig-med-billeder@390, bolig-uden-billeder@390 | Se annoncen hos Prøvekilde Gamma | IKKE et kendt beløb |
| `a.maerke` | color | #0f4d43 | = | 8 | forside@1440, soeg@1440, bolig-med-billeder@1440, bolig-uden-billeder@1440, forside@390, soeg@390, bolig-med-billeder@390, bolig-uden-billeder@390 | BOFINDA | IKKE et kendt beløb |
| `div.leaflet-control-attribution.leaflet-control > a` | color | #0078a8 | = | 5 | soeg@1440, bolig-med-billeder@1440, bolig-uden-billeder@1440, bolig-med-billeder@390, bolig-uden-billeder@390 | Leaflet | IKKE et kendt beløb |
| `div.leaflet-control-attribution.leaflet-control > a` | text-decoration-color | #0078a8 | = | 5 | soeg@1440, bolig-med-billeder@1440, bolig-uden-billeder@1440, bolig-med-billeder@390, bolig-uden-billeder@390 | Leaflet | IKKE et kendt beløb |
| `a.knap` | background-color | #083a34 | = | 4 | bolig-med-billeder@1440, bolig-uden-billeder@1440, bolig-med-billeder@390, bolig-uden-billeder@390 | Se annoncen hos Prøvekilde Gamma | IKKE et kendt beløb |
| `button.soegeknap` | background-color | #083a34 | = | 4 | forside@1440, soeg@1440, forside@390, soeg@390 | Søg | IKKE et kendt beløb |
| `dt.kendt` | color | #0f4d43 | = | 2 | forside@1440, forside@390 | 252 | antal boliger med kendt beløb (ikke et beløb) |
| `section.udlejerbaand` | background-color | #083a34 | = | 2 | forside@1440, forside@390 | For udlejereUdlej din bolig på BofindaVi | IKKE et kendt beløb |

Den fulde gruppering pr. (egenskab, hex, selektor, tekstuddrag) med antal står i `maaling.json` under `fejning.<tilstand>.grupper`.

Leaflet-linket (#0078a8) kommer fra node_modules/leaflet/dist/leaflet.css:265 (`.leaflet-container a { color: #0078A8 }`). Farvetonen er 197°, så det falder inden for filterets 130–200°; det er Leaflets standardlinkfarve, ikke et af projektets tokens. I runde 2 får det også understregning (forslag.css:231), derfor den ekstra text-decoration-color-række.

## 5 · ΔE00 mod --kendt

Reference: `--kendt` = #0f4d43 (runde 2; i før hedder samme værdi `--accent`). Formlen er skrevet i `de00.mjs` (sRGB → lineær → XYZ D65 → CIELAB → CIEDE2000, Sharma/Wu/Dalal 2005) og prøvet mod facit før brug: ΔE00: 34/34 Sharma-par rammer facit til 4 decimaler; største afvigelse 4.95e-5; par 1: 2.0425 (facit 2.0425).

| Hex | L* | C* | h° (Lab) | HSL | ΔE00 mod --kendt | Slags | Hvor |
|---|---|---|---|---|---|---|---|
| #0f4d43 | 28.94 | 21.79 | 178.9 | 170°/0.674/0.18 | **0.00** | computed (fejningen) | før: div.kort-pris (color); før: span.maerkat.m-ny (color); før: div.gruppe-flere (color); før: span.maerke-boble (background-color); før: a.knap (border-*-color); før: a.maerke (color) … (+36) |
| #0b4a42 | 27.74 | 21.11 | 181.9 | 172°/0.741/0.167 | **1.27** | computed (hover, uden for fejningen) | runde 2: «Søg»-knappen ved hover (baggrund) |
| #083a34 | 21.3 | 17.61 | 182.9 | 173°/0.758/0.129 | **6.21** | computed (fejningen) | før: a.ub-knap (color); runde 2: a.knap (border-*-color); runde 2: a.knap (background-color); runde 2: button.soegeknap (background-color); runde 2: section.udlejerbaand (background-color) |
| #33685f | 40.3 | 20.12 | 181.1 | 170°/0.342/0.304 | **9.36** | tegnet: sammensat med opacitet over baggrunden | før: li.ts-hus::before (#0f4d43 × opacitet); før: li.ts-kalender::before (#0f4d43 × opacitet); før: li.ts-moent::before (#0f4d43 × opacitet); før: ul.talstribe.punkter > li::before (#0f4d43 × opacitet) |
| #3d6f66 | 43.24 | 19.26 | 180.8 | 169°/0.291/0.337 | **12.03** | tegnet: sammensat med opacitet over baggrunden | før: li.nt-doer::before (#0f4d43 × opacitet); før: li.nt-hus::before (#0f4d43 × opacitet); før: li.nt-maal::before (#0f4d43 × opacitet); før: li.nt-moent::before (#0f4d43 × opacitet) |
| #527f78 | 49.89 | 17.14 | 183.7 | 171°/0.215/0.41 | **18.54** | tegnet: sammensat med opacitet over baggrunden | før: div.soegefelt.sf-sted::before (#0f4d43 × opacitet) |
| #0078a8 | 47.31 | 34.95 | 253 | 197°/1/0.329 | **27.14** | computed (fejningen) | før: div.leaflet-control-attribution.leaflet-control > a (color); runde 2: div.leaflet-control-attribution.leaflet-control > a (color); runde 2: div.leaflet-control-attribution.leaflet-control > a (text-decoration-color) |

Tokens mod hinanden (ΔE00, runde 2):

| | `--kendt` #0f4d43 | `--flade-groen` #083a34 | `--flade-groen-hover` #0b4a42 | `--blaek` #14161a |
|---|---|---|---|---|
| `--kendt` #0f4d43 | 0.00 | 6.21 | 1.27 | 24.24 |
| `--flade-groen` #083a34 | 6.21 | 0.00 | 5.15 | 19.29 |
| `--flade-groen-hover` #0b4a42 | 1.27 | 5.15 | 0.00 | 23.36 |
| `--blaek` #14161a | 24.24 | 19.29 | 23.36 | 0.00 |

## 6 · Hvad der ikke er målt

- Fokus-tilstande (`:focus-visible`-outline), hover på andet end de to knapper, og filtervinduet (lukket; dets valgte tilstande er ikke i fejningen). Den valgte kortmarkør er målt ved at klikke den første markør.
- `background-image` (gradienter, fotoet) og `box-shadow` er ikke i fejningen; det er kun de nævnte farveegenskaber.
- «Tegnet» regner med den første uigennemsigtige baggrundsfarve bag elementet, ikke med fotoet eller kortfliserne. Kortet i dette miljø viser lokalt genererede testfliser (krediteringen siger «Testfliser — lokalt genereret, ikke OpenStreetMap»), så markørernes «bagved» er Leaflet-containerens #dddddd, ikke en rigtig flise. Markørernes egne farver (fyld, kant, tal) er uigennemsigtige og afhænger ikke af det.
- Ingen produktionsdata: tallene i «Antal» afhænger af de syntetiske boliger (fx hvor mange kort der har kendt total).
