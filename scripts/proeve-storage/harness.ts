// ═══════════════════════════════════════════════════════════════
//  Proeve-harnessen: udfald, mutationsbevis og rapport.
//
//  Tre slags udfald, jf. aftalen med ejeren:
//   · GRAENSE — en graense, der SKAL haandhaeves. Beviset for, at proeven
//     kan fejle, er en midlertidig svaekkelse: aabnes graensen, SKAL
//     proeven skifte fra "blokeret" til "aaben". Goer den ikke det, har den
//     ikke maalt noget (exit 2). Nogle graenser er statisk krypto (fx en
//     signaturs bindning til stien); de bevises af en indbygget positiv
//     kontrol i selve proeven i stedet for en svaekkelse.
//   · HUL — en kendt, bevidst usikker adfaerd i dag. Proeven BEKRAEFTER, at
//     hullet stadig er der, og rapporterer det. Den fejler ikke koerslen —
//     men aendrer adfaerden sig (hullet lukket), skifter proeven til roed og
//     TVINGER nogen til at opdatere den. Saa kan et hul hverken lukkes i
//     stilhed eller staa groent.
//
//  Alt maales paa body og paa sandheden i basen, aldrig paa HTTP-status
//  alene (Storage svarer 400 paa naesten alt).
// ═══════════════════════════════════════════════════════════════

export interface Udfald {
  /** Matcher den observerede adfaerd forventningen? For GRAENSE: er
   *  angrebet blokeret? For HUL: er den kendte usikre adfaerd til stede? */
  somVentet: boolean
  note: string
}

export interface Proeve<Ctx> {
  id: string
  gruppe: string
  beskriv: string
  slags: 'graense' | 'hul'
  /** Kun GRAENSE: hvordan proeven bevises at kunne fejle. */
  bevis?: { via: 'mutation'; kommando: import('./privilegeret').Kommando } | { via: 'positiv-kontrol' }
  koer: (ctx: Ctx) => Promise<Udfald>
}

export type Status = 'BESTAAET' | 'FEJL' | 'UBEVIST' | 'HUL' | 'HUL_LUKKET' | 'SPRUNGET'

export interface Resultat {
  id: string
  gruppe: string
  beskriv: string
  status: Status
  note: string
}

const skriv = (s: string) => process.stdout.write(s)

const TEGN: Record<Status, string> = {
  BESTAAET: '✓', FEJL: '✗', UBEVIST: '⚠', HUL: '◆', HUL_LUKKET: '✗', SPRUNGET: '·',
}

export interface Priv {
  svaekk(kommando: import('./privilegeret').Kommando, minutter?: number): Promise<string[]>
  fjern(): Promise<string[]>
}

/**
 * Koerer én proeve og afgoer dens status. `priv` bruges kun til
 * mutationsbeviset; svaekkelsen fjernes altid i finally.
 */
export async function koerProeve<Ctx>(p: Proeve<Ctx>, ctx: Ctx, priv: Priv): Promise<Resultat> {
  const r = (status: Status, note: string): Resultat =>
    ({ id: p.id, gruppe: p.gruppe, beskriv: p.beskriv, status, note })

  let normal: Udfald
  try {
    normal = await p.koer(ctx)
  } catch (e) {
    return r('FEJL', `kastede: ${(e as Error).message}`)
  }

  if (p.slags === 'hul') {
    return normal.somVentet
      ? r('HUL', normal.note)
      : r('HUL_LUKKET', `adfaerden har aendret sig — hullet er maaske lukket. Opdater proeven. (${normal.note})`)
  }

  // GRAENSE
  if (!normal.somVentet) {
    return r('FEJL', `graensen holdt IKKE: ${normal.note}`)
  }

  if (!p.bevis) return r('UBEVIST', `${normal.note} — men proeven har intet bevis for at kunne fejle`)

  if (p.bevis.via === 'positiv-kontrol') {
    // koer har selv baade den tilladte og den naegtede vej; somVentet=true
    // kraevede at begge var rigtige. Kan altsaa fejle begge veje.
    return r('BESTAAET', `${normal.note} (bevist ved indbygget positiv kontrol)`)
  }

  // via mutation: aabn graensen midlertidigt og kraev, at proeven nu er AABEN.
  await priv.svaekk(p.bevis.kommando)
  let underSvaekkelse: Udfald
  try {
    underSvaekkelse = await p.koer(ctx)
  } catch (e) {
    return r('UBEVIST', `mutationskoerslen kastede: ${(e as Error).message}`)
  } finally {
    await priv.fjern()
  }

  if (underSvaekkelse.somVentet) {
    return r('UBEVIST',
      `${normal.note} — MEN svaekkelsen (${p.bevis.kommando}) aendrede intet, `
      + `saa proeven maalte ikke graensen (${underSvaekkelse.note})`)
  }
  return r('BESTAAET', `${normal.note} — bevist: svaekket → aaben (${underSvaekkelse.note})`)
}

export function rapport(resultater: Resultat[]): number {
  const grupper = [...new Set(resultater.map((r) => r.gruppe))]
  skriv('\n')
  for (const g of grupper) {
    skriv(`\n  ${g}\n`)
    for (const r of resultater.filter((x) => x.gruppe === g)) {
      skriv(`    ${TEGN[r.status]} ${r.id}  ${r.beskriv}\n`)
      skriv(`        ${r.note}\n`)
    }
  }

  const tael = (s: Status) => resultater.filter((r) => r.status === s).length
  const bestaaet = tael('BESTAAET')
  const fejl = tael('FEJL')
  const ubevist = tael('UBEVIST')
  const huller = tael('HUL')
  const hulLukket = tael('HUL_LUKKET')
  const sprunget = tael('SPRUNGET')

  skriv('\n  ─────────────────────────────────────────────\n')
  skriv(`  ✓ bestaaet: ${bestaaet}   ✗ fejl: ${fejl}   ⚠ ubevist: ${ubevist}\n`)
  skriv(`  ◆ kendte huller bekraeftet: ${huller}`)
  if (hulLukket) skriv(`   ✗ huller der har aendret sig: ${hulLukket}`)
  if (sprunget) skriv(`   · sprunget over: ${sprunget}`)
  skriv('\n')

  if (huller) {
    skriv('\n  ◆ KENDTE HULLER — bekraeftet til stede (fund, ikke sikkerhed):\n')
    for (const r of resultater.filter((x) => x.status === 'HUL')) {
      skriv(`      ${r.id}  ${r.beskriv}\n`)
    }
  }

  // Exit-koder: 1 = en graense holdt ikke, eller et hul har aendret sig
  //             (skal undersoeges/opdateres); 2 = groent, men ubevist;
  //             0 = alt bestaaet og bevist.
  if (fejl || hulLukket) return 1
  if (ubevist) return 2
  return 0
}
