// ═══════════════════════════════════════════════════════════════
//  Tal der ikke ændrer sig fra minut til minut.
//
//  `facetter()` og `forsidetal()` regnes på hele bestanden — byer, kilder,
//  boligtyper, faciliteter, p90. Importen kører én gang i timen, så de
//  svarer det samme hele vejen igennem. At regne dem ved hvert besøg var
//  fire forespørgsler pr. sidevisning uden nogen ny oplysning til gengæld.
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
import { facetter, forsidetal } from '../lib/soeg'

const MINUTTER = 5

export const facetterCached = unstable_cache(facetter, ['facetter'], {
  revalidate: MINUTTER * 60,
  tags: ['bestand'],
})

export const forsidetalCached = unstable_cache(forsidetal, ['forsidetal'], {
  revalidate: MINUTTER * 60,
  tags: ['bestand'],
})
