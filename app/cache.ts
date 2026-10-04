// ═══════════════════════════════════════════════════════════════
//  Tal der ikke ændrer sig fra minut til minut.
//
//  `facetter()` og `forsidetal()` regnes på hele bestanden — byer, kilder,
//  boligtyper, faciliteter, p90. Importen kører én gang i timen, så de
//  svarer det samme hele vejen igennem. At regne dem ved hvert besøg er
//  fem forespørgsler pr. sidevisning (`facetter` 3, `forsidetal` 2 — målt
//  30. september 2026, se CLAUDE.md) uden nogen ny oplysning til gengæld.
//
//  Ligger her og ikke i lib/soeg.ts med vilje: `next/cache` hører til
//  webappen. Workeren og alarmen kører i tsx uden Next omkring sig, og de
//  importerer fra lib/ — de skal ikke slæbe en Next-afhængighed med.
//
//  Fem minutter, ikke en time: tallene må gerne halte lidt efter, men
//  "1.137 ledige boliger" skal ikke stå i en time efter en kørsel, der
//  fandt hundrede flere. Efter en import er forsiden højst fem minutter
//  bagud.
// ═══════════════════════════════════════════════════════════════

import { unstable_cache } from 'next/cache'
import { facetter, forsidetal, kvadratmeterpris } from '../lib/soeg'

const MINUTTER = 5

export const facetterCached = unstable_cache(facetter, ['facetter'], {
  revalidate: MINUTTER * 60,
  tags: ['bestand'],
})

export const forsidetalCached = unstable_cache(forsidetal, ['forsidetal'], {
  revalidate: MINUTTER * 60,
  tags: ['bestand'],
})

// ── Boligsidens prissammenligning ────────────────────────────────
// Medianen for et postnummer er den samme for hver bolig i det, og den
// ændrer sig kun, når importen kører. Den var den tungeste af boligsidens
// tre forespørgsler (dedup-rangering over postnummeret), og den kørte
// ved hver eneste visning. Hver forespørgsel koster to rundture til
// basen (postgres.js beskriver først, når `prepare` er slået fra —
// se docs/hastighed-2026-10.md), så den var en tredjedel af sidens
// ventetid på serveren.
//
// Nøglen er postnummeret (unstable_cache tager argumentet med). Svaret
// er offentligt — en median og et antal, intet om nogen bruger — og det
// er de samme fem minutter som forsidens tal. «Baseret på N boliger»
// kan altså halte op til fem minutter efter en import, ligesom
// facetterne. Boligen selv (pris, status, forbehold) caches IKKE:
// `hentBolig` kører ved hver visning, og siden er stadig force-dynamic.
export const kvadratmeterprisCached = unstable_cache(kvadratmeterpris, ['kvadratmeterpris'], {
  revalidate: MINUTTER * 60,
  tags: ['bestand'],
})
