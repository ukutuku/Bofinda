// ═══════════════════════════════════════════════════════════════
//  Depositum og forudbetalt leje — hver for sig, hele vejen ud.
//
//  Kører mod PGlite gennem scripts/testbase.ts. Ingen produktion,
//  intet netværk. Rækkerne sås her i filen, så hvert tilfælde kan
//  læses som det, det er.
//
//  ── HVORFOR FILEN FINDES ──────────────────────────────────────
//  Boligsiden viste «Depositum og forudbetalt leje» som ÉT tal,
//  regnet baglæns: `move_in_cost − husleje − aconto`. Og under det
//  stod der «Kilden oplyser summen, ikke fordelingen».
//
//  Begge dele var forkerte. Kolonnerne `deposit` og `prepaid_rent`
//  har været der siden migration 0015. Fem adaptere gemmer dem
//  (alabu og birch: kun depositum · cej, heimstaden, laros: begge),
//  og det gør hver eneste udlejerannonce også. For Propstep og
//  LokalBolig læser adapteren endda kildens egne beløb og bruger dem
//  til at lægge summen sammen — den gemmer dem bare ikke.
//
//  Årsagen til, at siden ikke kunne vise dem, var ét sted:
//  `hentBolig` havde dem ikke i sin select-liste. Den her fil måler
//  netop det led. Den RENDEREDE visning måles i
//  scripts/cloud/indflytningkontrol.mjs, som kan indlæse
//  boligsidens komponenttræ (den importerer Leaflets CSS og kan
//  derfor ikke køre under tsx).
//
//  ── DE FEM TILFÆLDE ───────────────────────────────────────────
//    1. begge kendt
//    2. kun depositum        (laros mellem liste og detaljeside)
//    3. kun forudbetalt
//    4. ingen af dem         (findbolig, propstep, lokalbolig)
//    5. begge kendt som 0    (0 er OPLYST, ikke fraværende)
//    6. dele uden samlet indflytningspris (cej)
// ═══════════════════════════════════════════════════════════════

import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { listings, sources } from '../db/schema'
import { hentBolig } from '../lib/soeg'

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  if (!ok) fejl++
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
}

// Egen kilde pr. kørsel. Prøven låner aldrig en rigtig kildes identitet
// — se reglen i CLAUDE.md om `test-redigering.ts`, der gjorde det og
// dermed arvede kildens historik i `crawl_runs`.
const SLUG = `proeve-indflytning-${Date.now()}`

interface Froe {
  navn: string
  /** øre, eller null for «ikke oplyst». */
  depositum: number | null
  forudbetalt: number | null
  indflytning: number | null
}

const FROE: Froe[] = [
  { navn: 'begge', depositum: 2_500_000, forudbetalt: 2_000_000, indflytning: 5_500_000 },
  { navn: 'kun-depositum', depositum: 2_500_000, forudbetalt: null, indflytning: 5_500_000 },
  { navn: 'kun-forudbetalt', depositum: null, forudbetalt: 2_000_000, indflytning: 5_500_000 },
  { navn: 'ingen', depositum: null, forudbetalt: null, indflytning: 5_500_000 },
  { navn: 'nul', depositum: 0, forudbetalt: 0, indflytning: 1_000_000 },
  { navn: 'uden-total', depositum: 2_500_000, forudbetalt: 2_000_000, indflytning: null },
]

async function koer() {
  const [kilde] = await db.insert(sources).values({
    slug: SLUG, name: 'Prøvekilde indflytning', sourceType: 'feed',
    baseUrl: 'https://proeve.invalid',
    // `enabled` sættes IKKE. Ingen runtime-kode læser feltet — det er
    // CLAUDE.mds første regel — så en værdi her ville være en påstand om
    // en knap, der ikke gør noget. De øvrige prøvefiler skriver `false`,
    // hvilket er lige så vilkårligt; skemaets default er sandheden.
  }).returning({ id: sources.id })
  const kildeId = kilde!.id

  const saaede: (Froe & { id: string })[] = []
  for (const f of FROE) {
    const [r] = await db.insert(listings).values({
      sourceId: kildeId,
      sourceType: 'feed',
      externalKey: `${SLUG}-${f.navn}`,
      sourceUrl: `https://proeve.invalid/${f.navn}`,
      addressRaw: `Depositumvej 1, 9001 Prøveby`,
      street: 'Depositumvej',
      houseNumber: '1',
      postalCode: '9001',
      city: 'Prøveby',
      rooms: 3,
      sizeM2: 70,
      rentMonthly: 1_000_000,
      // Totalen kræver mindst én navngiven post — se check-constraint
      // `listing_total_monthly_honest`.
      totalMonthly: 1_200_000,
      totalMonthlyComponents: ['rent', 'heat'],
      utilitiesHeat: 200_000,
      moveInCost: f.indflytning,
      deposit: f.depositum,
      prepaidRent: f.forudbetalt,
      addressMatchLevel: 'unit',
      unitAddressUuid: `intern:proeve:${SLUG}:${f.navn}`,
      status: 'active',
    }).returning({ id: listings.id })
    saaede.push({ ...f, id: r!.id })
  }

  console.log(`\n── hentBolig bærer begge felter ud af basen ──`)

  for (const s of saaede) {
    const b = await hentBolig(s.id)
    if (!b) { tjek(`${s.navn}: boligen kunne hentes`, false, 'hentBolig gav null'); continue }

    // `in`-prøven er med vilje: FØR rettelsen stod felterne slet ikke i
    // select-listen, og `b.depositum` var da `undefined` — ikke null.
    // Forskellen er hele fejlen: «findes ikke i svaret» mod «oplyst som
    // ingenting». En prøve på `== null` ville bestå begge steder, fordi
    // `undefined == null` er sandt i JS.
    tjek(`${s.navn}: svaret HAR feltet depositum`, 'depositum' in b,
      'depositum' in b ? '' : 'feltet mangler helt i hentBoligs select')
    tjek(`${s.navn}: svaret HAR feltet forudbetalt`, 'forudbetalt' in b,
      'forudbetalt' in b ? '' : 'feltet mangler helt i hentBoligs select')

    tjek(`${s.navn}: depositum er uændret`, b.depositum === s.depositum,
      `${b.depositum} — ventet ${s.depositum}`)
    tjek(`${s.navn}: forudbetalt er uændret`, b.forudbetalt === s.forudbetalt,
      `${b.forudbetalt} — ventet ${s.forudbetalt}`)
    tjek(`${s.navn}: indflytningsprisen er uændret`, b.indflytning === s.indflytning,
      `${b.indflytning} — ventet ${s.indflytning}`)
  }

  // ── 0 er et OPLYST beløb ─────────────────────────────────────
  //  Den vigtigste enkeltlinje i filen. Går et felt gennem en
  //  falsy-prøve et sted på vejen, bliver 0 til «ikke oplyst», og en
  //  bolig UDEN depositum ser ud som en, vi ikke ved noget om.
  {
    const b = await hentBolig(saaede.find((s) => s.navn === 'nul')!.id)!
    tjek('nul: 0 kr. er et tal, ikke et fravær',
      b?.depositum === 0 && b?.forudbetalt === 0,
      `depositum=${b?.depositum} (${typeof b?.depositum}),`
      + ` forudbetalt=${b?.forudbetalt} (${typeof b?.forudbetalt})`)
    tjek('nul: 0 er IKKE det samme som null',
      b?.depositum !== null && b?.forudbetalt !== null,
      'null ville betyde «ikke oplyst»')
  }

  // ── Delene overlever, når totalen mangler ────────────────────
  //  CEJ gemmer begge dele og udelader summen med vilje. En visning,
  //  der kun tør vise delene NÅR totalen er kendt, ville tie om hele
  //  den kilde.
  {
    const b = await hentBolig(saaede.find((s) => s.navn === 'uden-total')!.id)!
    tjek('uden-total: delene står, selv om indflytningsprisen mangler',
      b?.indflytning === null && b?.depositum === 2_500_000 && b?.forudbetalt === 2_000_000,
      `indflytning=${b?.indflytning}, depositum=${b?.depositum}, forudbetalt=${b?.forudbetalt}`)
  }

  // ── Det ene må ikke trække det andet med sig ─────────────────
  {
    const kunD = await hentBolig(saaede.find((s) => s.navn === 'kun-depositum')!.id)!
    const kunF = await hentBolig(saaede.find((s) => s.navn === 'kun-forudbetalt')!.id)!
    tjek('kun-depositum: depositum står, forudbetalt er null',
      kunD?.depositum === 2_500_000 && kunD?.forudbetalt === null,
      `${kunD?.depositum} / ${kunD?.forudbetalt}`)
    tjek('kun-forudbetalt: forudbetalt står, depositum er null',
      kunF?.depositum === null && kunF?.forudbetalt === 2_000_000,
      `${kunF?.depositum} / ${kunF?.forudbetalt}`)
  }

  // ── Intet er udledt af totalen ───────────────────────────────
  //  «ingen» har en indflytningspris på 55.000 og en husleje på
  //  10.000. Den gamle kode ville have vist 43.000 som «Depositum og
  //  forudbetalt leje». Efter rettelsen står der to gange null, og
  //  visningen siger, at vi ikke har tallene.
  {
    const b = await hentBolig(saaede.find((s) => s.navn === 'ingen')!.id)!
    tjek('ingen: der udledes ikke et beløb af totalen',
      b?.depositum === null && b?.forudbetalt === null && b?.indflytning === 5_500_000,
      `depositum=${b?.depositum}, forudbetalt=${b?.forudbetalt},`
      + ` indflytning=${b?.indflytning} — et restbeløb ville have været`
      + ` ${(5_500_000 - 1_000_000 - 200_000) / 100} kr.`)
  }

  // ─── Oprydning ───────────────────────────────────────────────
  await db.delete(listings).where(inArray(listings.id, saaede.map((s) => s.id)))
  await db.delete(sources).where(eq(sources.id, kildeId))

  console.log(fejl === 0 ? '\n  ALT GRØNT\n' : `\n  ${fejl} FEJLEDE\n`)
  if (fejl) process.exit(1)
}

await koer()
