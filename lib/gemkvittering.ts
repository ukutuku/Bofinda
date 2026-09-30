// ═══════════════════════════════════════════════════════════════
//  Kvitteringen for et gennemført gemmeønske — cookielaget.
//
//  Ligger her og ikke i `lib/gemoenske.ts`, fordi den fil importeres af
//  `Konto`, som er en KLIENTKOMPONENT. `next/headers` og `node:crypto`
//  hoerer ikke til i et browserbundt; det er den samme graense som for
//  `lib/faciliteter.ts`, og den blev trukket, da et vaerdi-import
//  vaeltede appen paa `Can't resolve 'net'`.
//
//  ═══ HVAD FILEN SIKRER ═══
//
//  En kvittering svarer paa ét spoergsmaal: «hvad skete der med DET klik,
//  DU lige lavede?» En kvittering, der overlever den, der lavede klikket,
//  svarer paa et andet spoergsmaal — og et svar paa et andet spoergsmaal
//  er en forkert oplysning, ikke bare et gammelt svar.
//
//  Det blev maalt. Kvitteringen levede 30 sekunder og blev aldrig
//  ryddet. Inden for det vindue kunne
//
//    · den samme bruger logge ud og ind igen UDEN et hjerteklik og faa
//      «Boligen er gemt.» om det forrige forloeb, og
//    · en ANDEN konto logge ind paa den samme maskine og faa den samme
//      besked om en bolig, hun aldrig havde set.
//
//  Der er derfor to spaerringer, og de er uafhaengige:
//
//    1. Kvitteringen RYDDES, naar den bliver forkert — ved udlogning, ved
//       et login uden oenske, og ved enhver nyere favorithandling.
//    2. Kvitteringen BAERER, hvem den blev sat til, og vises kun for
//       hende.
//
//  Den foerste alene ville hvile paa, at vi har fundet alle veje. Den
//  anden alene ville lade en gammel kvittering staa for den samme bruger.
//  Sammen holder de ogsaa, hvis én af dem overses.
// ═══════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto'
import { cookies } from 'next/headers'
import { BASISCOOKIE } from './samtykke'
import {
  GEMCOOKIE, GEMUDFALDSSEK, type Gemudfald, gemudfaldFor, kvitteringsvaerdi,
} from './gemoenske'

/**
 * Kontoens maerke i kvitteringen — en envejsafledning, ikke id'et.
 *
 * Cookien skal kunne afgoere, om kvitteringen er HENDES, uden at
 * navngive hende. En hash gemmer ikke noget hemmeligt — id'et er ikke en
 * adgangsnoegle — men den holder cookien fri for oplysninger om, hvem der
 * sad ved maskinen, og det er billigere at goere end at forklare.
 *
 * Praefikset binder den til netop dette formaal, saa den samme vaerdi
 * ikke kan genbruges som maerke et andet sted.
 */
export function maerkeFor(brugerId: string): string {
  if (!brugerId) return ''
  return createHash('sha256').update(`bofinda:gemkvittering:${brugerId}`).digest('hex').slice(0, 16)
}

/**
 * Skriv kvitteringen. Kun fra en server action.
 *
 * Kan den ikke skrives, er det stadig bedre at lande paa Min side uden
 * besked end at se en fejlside efter et login, der lykkedes. Derfor
 * fanges alt: kvitteringen er en oplysning, ikke en del af forloebet.
 */
export async function saetGemkvittering(udfald: Gemudfald, brugerId: string): Promise<void> {
  const maerke = maerkeFor(brugerId)
  if (!maerke) return
  try {
    const jar = await cookies()
    jar.set(GEMCOOKIE, kvitteringsvaerdi(udfald, maerke), {
      ...BASISCOOKIE, maxAge: GEMUDFALDSSEK,
    })
  } catch { /* uden kvittering, men inde */ }
}

/**
 * Ryd kvitteringen. Kun fra en server action.
 *
 * Kaldes fra hver vej, der goer den forkert: `logUd`, `gemNyKode` (som
 * ogsaa lukker sessionen), `login` uden et oenske, og de to
 * favorithandlinger — for en nyere handling goer den gamle besked til et
 * svar paa noget, hun ikke laengere spoerger om.
 *
 * Der saettes ingen tom cookie, naar der ikke er nogen: et `Set-Cookie`
 * paa hvert hjerteklik er stoej i hvert eneste svar.
 */
export async function ryddGemkvittering(): Promise<void> {
  try {
    const jar = await cookies()
    if (!jar.get(GEMCOOKIE)) return
    jar.set(GEMCOOKIE, '', { ...BASISCOOKIE, maxAge: 0 })
  } catch { /* kunne ikke ryddes; maerket spaerrer stadig */ }
}

/**
 * Laes kvitteringen for den, der kigger — aldrig for nogen anden.
 *
 * Maerket sammenlignes i `gemudfaldFor`, som er ren og derfor kan
 * proeves uden en request. Her ligger kun cookienavnet og afledningen.
 */
export async function laesGemkvittering(brugerId: string): Promise<Gemudfald | null> {
  try {
    const jar = await cookies()
    return gemudfaldFor(jar.get(GEMCOOKIE)?.value, maerkeFor(brugerId))
  } catch { return null }
}
