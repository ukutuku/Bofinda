// ═══════════════════════════════════════════════════════════════
//  Repræsentantvalget: fire trin, og ingen af dem er en lodtrækning.
//
//  ── HVORFOR FILEN FINDES ──────────────────────────────────────
//  Målt i produktionen: Tolderlundsvej 48, 1. 9 i Odense stod to gange
//  hos samme kilde, 84 sekunder fra hinanden, til 7.500 og 7.350 kr.
//  Samme adresse, etage, dør, areal og værelser — kildens egen dublet.
//  Dedup'en gjorde det rigtige og viste én af dem.
//
//  Men HVILKEN afhang af `listings.id`, og `id` er en tilfældig UUID.
//  Vi havde begge tal og viste det højeste halvdelen af gangene, uden
//  at nogen havde besluttet det. Trin 3 — laveste kendte total — er
//  det besluttede valg, der erstatter lodtrækningen.
//
//  ── DEN ANDEN PRØVE ER DEN, DER ER LET AT GLEMME ──────────────
//  Trin 4 ser overflødigt ud, når trin 3 er der. Det er det ikke: to
//  rækker med SAMME total er stadig ens på alle tre første trin, og
//  uden et sidste entydigt led kan de bytte plads mellem to
//  forespørgsler. «Stabil mellem kørsler» er ikke en pæn egenskab —
//  det er det, der gør, at den samme søgning giver det samme svar.
//
//  Køres gennem scripts/testbase.ts. Alle data er syntetiske.
// ═══════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { listings, sources } from '../db/schema'
import { hvor, udenDubletter } from '../lib/soeg'

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}

const SLUG = `proeve-repraesentant-${process.pid}`

/** Hvem overlever dedup'en blandt disse id'er? */
async function vinderen(ids: string[]): Promise<string[]> {
  const r = await db
    .select({ id: listings.id })
    .from(listings)
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    .where(and(inArray(listings.id, ids), udenDubletter(hvor({}))))
  return r.map((x) => x.id)
}

async function koer() {
  const [kilde] = await db.insert(sources)
    .values({ slug: SLUG, name: 'Prøvekilde repræsentant', sourceType: 'feed' })
    .returning()

  /** To rækker, SAMME dedup-nøgle (samme unit-uuid), forskellig pris. */
  const lav = async (
    navn: string, uuid: string, total: number | null,
    id: string, leje = 700_000,
  ) => {
    const [r] = await db.insert(listings).values({
      // ⚠ EKSPLICIT id. Se noten ved proeve 1: uden det afgoer en
      // TILFAELDIG UUID sidste trin, og proeven bestaar halvdelen af
      // gangene, ogsaa naar trin 3 er fjernet.
      id,
      sourceId: kilde!.id, sourceType: 'feed', externalKey: `${SLUG}-${navn}`,
      sourceUrl: `https://proeve.invalid/${navn}`,
      addressRaw: 'Tolderlundsvej 48, 1. 9, 5000 Prøveby',
      street: 'Tolderlundsvej', houseNumber: '48', floor: '1', door: '9',
      postalCode: '5000', city: 'Prøveby',
      addressMatchLevel: 'unit', unitAddressUuid: uuid,
      propertyType: 'lejlighed', sizeM2: 64, rooms: 2,
      rentMonthly: leje, totalMonthly: total,
      totalMonthlyComponents: total == null ? null : ['rent', 'heating'],
      status: 'active',
    }).returning({ id: listings.id })
    return r!.id
  }

  // ═══ 1 · Laveste kendte total vinder ═══════════════════════════
  console.log('\n══ 1 · to rækker, samme bolig, forskellig pris ══')
  {
    const noegle = `intern:proeve:${SLUG}:dyr-billig`
    // ═══ ID'ERNE PEGER DEN FORKERTE VEJ, OG DET ER HELE POINTEN ═══
    //
    // Første udgave af prøven lod basen tildele tilfældige UUID'er. Den
    // var GRØN med trin 3 fjernet — modprøven afslørede det. Forklaringen
    // er, at uden trin 3 afgør `id`, og med to tilfældige UUID'er vinder
    // den billige halvdelen af gangene. Prøven målte en møntkast.
    //
    // Nu får den DYRE det laveste id. Uden trin 3 vinder den dyre —
    // deterministisk. Med trin 3 vinder den billige. Prøven kan altså
    // kun bestå, hvis trin 3 faktisk er der.
    const dyr = await lav('dyr', noegle, 790_000, '00000000-0000-4000-8000-000000000001')
    const billig = await lav('billig', noegle, 775_000, '00000000-0000-4000-8000-000000000002')

    // Ingen af dem har billeder → trin 1 er uafgjort.
    // Begge har total → trin 2 er uafgjort.
    // Trin 4 ville vælge «dyr» (lavest id). Kun trin 3 kan vælge «billig».
    const overlevende = await vinderen([dyr, billig])
    tjek('præcis ÉN af de to vises', overlevende.length === 1, `${overlevende.length}`)
    tjek('og det er den BILLIGSTE (7.750 mod 7.900)',
      overlevende[0] === billig,
      overlevende[0] === dyr ? 'den dyre vandt — trin 3 virker ikke'
        : overlevende[0] === billig ? '' : 'ingen af dem')
  }

  // ═══ 2 · Rangeringen er stabil over to kald ════════════════════
  console.log('\n══ 2 · samme input, samme svar ══')
  {
    // SAMME total på begge → trin 1, 2 OG 3 er uafgjorte. Kun trin 4
    // er tilbage. Uden det kan de to bytte plads mellem kald.
    const noegle = `intern:proeve:${SLUG}:ens-pris`
    const a = await lav('ens-a', noegle, 800_000, '00000000-0000-4000-8000-00000000000a')
    const b = await lav('ens-b', noegle, 800_000, '00000000-0000-4000-8000-00000000000b')

    const svar: string[][] = []
    for (let i = 0; i < 5; i++) svar.push(await vinderen([a, b]))

    tjek('hvert kald giver præcis ét svar',
      svar.every((s) => s.length === 1), svar.map((s) => s.length).join(','))
    const foerste = svar[0]?.[0]
    tjek('og ALLE fem kald giver den SAMME',
      svar.every((s) => s[0] === foerste),
      svar.every((s) => s[0] === foerste) ? 'stabil' : 'RANGERINGEN VAKLER mellem kald')
  }

  // ═══ 3 · Trin 2 går stadig forud for trin 3 ════════════════════
  console.log('\n══ 3 · kendt total slår lav husleje ══')
  {
    // Den ene har en kendt total på 900.000; den anden har INGEN total
    // og en husleje på 500.000. Trin 2 skal vinde over trin 3 — ellers
    // ville «laveste total» kunne trække en ukendt frem.
    const noegle = `intern:proeve:${SLUG}:kendt-vs-ukendt`
    // Den UKENDTE får det laveste id, så trin 4 ville vælge den. Kun
    // trin 2 kan vælge den kendte.
    const ukendt = await lav('ukendt', noegle, null, '00000000-0000-4000-8000-000000000011', 500_000)
    const kendt = await lav('kendt', noegle, 900_000, '00000000-0000-4000-8000-000000000012')

    const overlevende = await vinderen([kendt, ukendt])
    tjek('den med KENDT total vinder, selv om den er dyrest',
      overlevende.length === 1 && overlevende[0] === kendt,
      overlevende[0] === ukendt ? 'den ukendte vandt — trin 3 har overhalet trin 2' : '')
  }

  // ═══ 4 · KILDETJEK: trin 4 kan stabilitetsprøven ikke fange ═══
  //
  // Modprøven viste det: fjerner man `listings.id` fra rangeringen,
  // bliver prøve 2 ved med at være grøn. PGlite returnerer de to
  // rækker i samme rækkefølge hver gang, selv uden et entydigt
  // sidste led — så «stabil over fem kald» beviser ikke, at leddet
  // er der. Den slags stabilitet er tilfældig, ikke garanteret:
  // Postgres lover intet om rækkefølgen, når ORDER BY er uafgjort,
  // og en anden plan (parallel scan, anden statistik) kan bytte om.
  //
  // Derfor måles trin 4 i KILDEN. Det er andet lag, som i
  // test-kortudsagn.ts — en påstand, prøvens data ikke kan nå.
  console.log('\n══ 4 · rangeringens sidste led står i kilden ══')
  {
    const kilde = readFileSync('lib/soeg.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const i = kilde.indexOf('partition by')
    const ordre = i < 0 ? '' : kilde.slice(i, kilde.indexOf(') as rn', i))
    tjek('rangeringen findes', i >= 0)
    tjek('trin 3 er der: laveste total',
      /totalMonthly\}\s*asc\s+nulls\s+last/.test(ordre),
      /totalMonthly\}\s*asc/.test(ordre) ? '' : 'trin 3 MANGLER')
    const sidste = ordre.trimEnd().split('\n').pop()?.trim() ?? ''
    tjek('og SIDSTE led er listings.id — ellers er valget ikke stabilt',
      /\$\{listings\.id\}\s*$/.test(sidste), `«${sidste}»`)
  }
}

koer()
  .then(() => {
    console.log(fejl === 0 ? '\n  ALT GRØNT\n' : `\n  ${fejl} FEJLEDE\n`)
    process.exit(fejl ? 1 : 0)
  })
  .catch((e) => { console.error('\n  AFBRUDT:', e); process.exit(1) })
