// ═══════════════════════════════════════════════════════════════
//  Backfillen af listings.description
//
//  Prøven rejser fire slags rækker i basen og kører genskrivningens
//  udvælgelse over dem:
//
//    · vores gamle tekst, ikke-native   -> SKAL skrives om
//    · vores gamle tekst, NATIVE        -> må ALDRIG røres
//    · håndskrevet tekst                -> må ALDRIG røres
//    · allerede ny tekst                -> uændret
//
//  Den native-række er den vigtigste. Klassen er nul i produktionen i
//  dag, men `||` på lib/udlejer.ts:262 gør vores sætning til udlejerens
//  i det øjeblik hun gemmer med feltet tomt, og :84 læser den tilbage i
//  hendes formular. Værnet skal virke, før klassen findes — ikke efter.
// ═══════════════════════════════════════════════════════════════

import { and, eq, isNotNull, ne } from 'drizzle-orm'
import { db } from '../db/client'
import { listings, sources } from '../db/schema'
import { genererBeskrivelse } from '../lib/normalize'
import { oereTilKroner } from '../lib/money'

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}

// Samme frosne generator som backfillen bærer. Står her, så prøven kan
// danne «vores gamle tekst» uden at importere engangsgodset.
const kr = (o: number) => oereTilKroner(o).toLocaleString('da-DK')
const gammelOekonomi = (leje: number, total: number, poster: string[]) => {
  const navne: Record<string, string> = {
    heat: 'varme', water: 'vand', electricity: 'el', other: 'øvrig aconto',
  }
  const a = poster.filter((k) => k !== 'rent').map((k) => navne[k] ?? k)
  const liste = a.length > 1 ? `${a.slice(0, -1).join(', ')} og ${a.at(-1)}` : a[0]
  return `Husleje ${kr(leje)} kr. om måneden. Med ${liste} er den samlede månedlige udgift ${kr(total)} kr.`
}

const FELTER = {
  propertyType: 'lejlighed' as const, rooms: 2, sizeM2: 64,
  street: 'Prøvegade', houseNumber: '1', postalCode: '5000', city: 'Prøveby',
  rentMonthly: 900_000, totalMonthly: 1_050_000,
  totalMonthlyComponents: ['rent', 'heat', 'water'],
  utilitiesElectricity: null, electricityOwnMeter: null, availableFrom: null,
}
const FOERSTE = 'Lejlighed på 2 værelser og 64 m² på Prøvegade 1 i 5000 Prøveby.'
const GAMMEL = `${FOERSTE} ${gammelOekonomi(900_000, 1_050_000, FELTER.totalMonthlyComponents)}`
const NY = genererBeskrivelse(FELTER)!
const HAANDSKREVET = `${FOERSTE} Dejlig lejlighed tæt på havnen. Ring for fremvisning.`

async function main() {
  const slug = `proeve-genskriv-${Date.now()}`
  const [kilde] = await db.insert(sources)
    .values({ slug, name: 'Prøvekilde genskriv', sourceType: 'spider' })
    .returning({ id: sources.id })

  const lav = async (navn: string, sourceType: 'spider' | 'native', description: string) => {
    const [r] = await db.insert(listings).values({
      sourceId: kilde!.id, sourceType,
      externalKey: `${slug}-${navn}`, sourceUrl: `https://proeve.invalid/${navn}`,
      addressRaw: 'Prøvegade 1, 5000 Prøveby', street: 'Prøvegade', houseNumber: '1',
      postalCode: '5000', city: 'Prøveby', addressMatchLevel: 'access',
      accessAddressUuid: `U-${slug}-${navn}`,
      propertyType: 'lejlighed', sizeM2: 64, rooms: 2,
      rentMonthly: 900_000, totalMonthly: 1_050_000,
      totalMonthlyComponents: ['rent', 'heat', 'water'],
      status: 'active', description, sourceCreatedAt: null,
    }).returning({ id: listings.id })
    return r!.id
  }

  const vores = await lav('vores', 'spider', GAMMEL)
  const nativ = await lav('nativ', 'native', GAMMEL)
  const haand = await lav('haand', 'spider', HAANDSKREVET)
  const alleredeNy = await lav('ny', 'spider', NY)

  console.log('\n══ 1 · udvælgelsen ══')
  // Samme where-klausul som backfillen: native udelukkes i SQL'en.
  const valgte = await db.select({ id: listings.id, sourceType: listings.sourceType, d: listings.description })
    .from(listings)
    .where(and(eq(listings.sourceId, kilde!.id),
      ne(listings.sourceType, 'native'), isNotNull(listings.description)))

  const ider = new Set(valgte.map((v) => v.id))
  tjek('den native række er slet ikke med i udvælgelsen', !ider.has(nativ))
  tjek('de tre øvrige er med', ider.has(vores) && ider.has(haand) && ider.has(alleredeNy),
    `${valgte.length} valgt`)
  tjek('ingen række i udvælgelsen er native',
    valgte.every((v) => v.sourceType !== 'native'))

  console.log('\n══ 2 · provenienskontrollen ══')
  tjek('vores gamle tekst genkendes', valgte.find((v) => v.id === vores)!.d === GAMMEL)
  tjek('den håndskrevne stemmer IKKE med den gamle generator',
    valgte.find((v) => v.id === haand)!.d !== GAMMEL)
  tjek('den nye tekst er forskellig fra den gamle', NY !== GAMMEL)

  console.log('\n══ 3 · den nye tekst er den rigtige ══')
  tjek('den siger «til udlejeren»', /betales .* til udlejeren/.test(NY), `«${NY.split('. ').slice(1).join('. ')}»`)
  tjek('og ikke «den samlede månedlige udgift»', !/samlede månedlige udgift/.test(NY))
  tjek('den gamle sagde det modsatte', /samlede månedlige udgift/.test(GAMMEL))
  tjek('første sætning er uændret', NY.startsWith(FOERSTE) && GAMMEL.startsWith(FOERSTE))

  console.log('\n══ 4 · kildetjek: værnet står i SQL\'en, ikke i en gren ══')
  const kilde_ = (await import('node:fs')).readFileSync('scripts/genskriv-beskrivelse.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  tjek('ne(listings.sourceType, \'native\') står i forespørgslen',
    /\.where\([\s\S]*ne\(listings\.sourceType,\s*'native'\)/.test(kilde_))
  tjek('den frosne generator findes', /function gammelBeskrivelse/.test(kilde_))
  tjek('og den skriver stadig den GAMLE sætning',
    /er den samlede månedlige udgift/.test(kilde_))
  tjek('backup-spærringen sidder på --skriv',
    /if \(skriv\)[\s\S]{0,200}backupErTaget\(\)/.test(kilde_))

  await db.delete(listings).where(eq(listings.sourceId, kilde!.id))
  await db.delete(sources).where(eq(sources.id, kilde!.id))
  console.log(fejl ? `\n  ${fejl} FEJLEDE\n` : '\n  ALT GRØNT\n')
  process.exit(fejl ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
