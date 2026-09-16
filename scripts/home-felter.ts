// ═══════════════════════════════════════════════════════════════
//  home.dk — optaelling af feltnavne i payloaden.
//
//  HVORFOR DEN BLEV SKREVET: adapteren satte hverken `deposit`,
//  `prepaidRent` eller `rooms`. Dens eget hoved havde siden rodcommitten
//  paastaaet, at «Kilden oplyser husleje, ét SAMLET aconto-beloeb,
//  depositum og forudbetalt leje», og CLAUDE.md's undersoegelse af
//  3. september skrev det samme. Men BEGGE steder talte om den
//  RENDEREDE detaljeside — «Leje pr. maaned 20.200 kr.» — og ingen af
//  dem naevnte, hvad felterne hed i `__NUXT_DATA__`.
//
//  DE TRE FELTER ER MAALT OG HENTES NU. Belaegget ligger i
//  scripts/kildeproever/home/, og adapteren laeser dem. Vaerktoejet
//  bliver staaende til naeste gang: en tredje sagstype, et nyt felt,
//  eller den dag kilden laegger payloaden om.
//
//  Et feltnavn maa ikke gaettes her, og det er ikke pedanteri. Den
//  flade Nuxt-serialisering goer en forkert noegle DOBBELT tavs:
//    · rammer man et navn, kilden ikke har, giver `los()` undefined,
//      `oere()` giver undefined, og feltet bliver bare vaek — ingen fejl,
//      ingen logline, ingen der opdager det;
//    · rammer man et navn, der findes i en NABOSAGS projektion, faar man
//      et tal, der ser fuldstaendig rigtigt ud og er en anden boligs.
//  Adapteren baerer allerede arret af begge: noten om at et areal paa
//  121 blev til `d[121]`, og id-bindingen fra 78770c5, fordi naboens
//  ledigdato kunne lande paa boligen.
//
//  Derfor TAELLER den her noeglerne i stedet for at slaa et formodet
//  navn op. Svaret paa «hvad hedder depositum hos home.dk?» er ikke et
//  gaet, der bekraeftes — det er en liste over, hvad der FAKTISK staar.
//
//  ── Hvad den udskriver, og hvad den ALDRIG udskriver ─────────
//  KUN noeglenavne og deres form (streng, tal, boolean, objekt med
//  hvilke undernoegler). ALDRIG vaerdier. Det er ikke en detalje:
//  allowlist-reglen findes, fordi kilders datamodeller baerer interne
//  sagsbehandlernoter med navne og telefonnumre paa nuvaerende lejere.
//  En optaelling af noeglenavne er praecis den form, der kan udvide en
//  allowlist uden at persondata nogensinde passerer gennem os.
//
//  ── Brug ─────────────────────────────────────────────────────
//      npx tsx --tsconfig tsconfig.scripts.json scripts/home-felter.ts <url> [<url> …]
//
//  Maal BEGGE sagstyper — de har dokumenteret forskellig dataform
//  (se «Om billederne» i adapterens hoved): projektlejemaal har
//  sagsnummer som `177P009058` og billeder paa alvis.b-cdn.net,
//  almindelige sager `1770021465` og home.mindworking.eu. Tidsdelen varierer
//  ogsaa med sagstypen.
//
//  Skriver ingenting nogen steder: ingen database, ingen filer, ingen
//  import. Ét GET pr. url gennem `politeFetch`, altsaa samme takt og
//  samme aerlige User-Agent som importen.
//
//  Naar noeglerne er talt, skrives resultatet ned i
//  scripts/kildeproever/home/ — url, tidspunkt, SHA-256 og de reducerede
//  payloads — og FOERST derefter udvides adapteren. (lib/kildekontrakt.ts
//  er noget andet: den daekker availability og status, ikke oekonomifelter.)
// ═══════════════════════════════════════════════════════════════

import { hentNuxt, los, medFelt, type Flad, type Ukendt } from '../adapters/home'

/** Sagstypen kan ses paa sagsnummeret. Se noten i adapterens hoved. */
export type Sagstype = 'projekt' | 'almindelig' | 'ukendt'

export const sagstypeFor = (id: string): Sagstype =>
  /^\d{3}P\d+$/.test(id) ? 'projekt'
    : /^\d{10,}$/.test(id) ? 'almindelig'
      : 'ukendt'

/** Formen af én vaerdi — aldrig vaerdien selv. */
function form(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return `liste[${v.length}]`
  if (typeof v === 'object') {
    const n = Object.keys(v as Ukendt)
    return `objekt{${n.slice(0, 8).join(',')}${n.length > 8 ? ',…' : ''}}`
  }
  return typeof v
}

/** Noeglerne i ét objekt, som `navn: form` — sorteret, uden vaerdier. */
const noegler = (o: unknown): string[] =>
  o && typeof o === 'object' && !Array.isArray(o)
    ? Object.entries(o as Ukendt).map(([k, v]) => `${k}: ${form(v)}`).sort()
    : []

export interface Sagsnoegler {
  id: string
  sagstype: Sagstype
  /** Noeglerne i selve sagsobjektet. */
  sag: string[]
  /** Noeglerne i `offer` — hvor husleje og aconto allerede laeses fra. */
  offer: string[]
  /** Noeglerne i `stats` — hvor arealet allerede laeses fra. */
  stats: string[]
  /**
   * Noegler hvis vaerdi har beloebsformen `{ amount: … }`. De er
   * kandidaterne til depositum og forudbetalt leje: kilden regner i
   * kroner og pakker hvert beloeb i netop den form (se `oere()` i
   * adapteren). Stien er `offer.<navn>` eller `<navn>` paa sagen.
   */
  beloebsformede: string[]
}

/**
 * Taeller noeglerne paa ÉN sag, bundet til dens id.
 *
 * Id-bindingen er ikke valgfri og er hele grunden til, at funktionen
 * tager et id og ikke bare en payload: detaljesiden baerer ogsaa de
 * beslaegtede annoncers objekter — fem paa den side, adapteren blev
 * maalt paa. Soegte vi «foerste objekt med et offer», kunne vi taelle
 * naboens felter og tro, det var boligens.
 *
 * Ren og uden netvaerk, saa den kan proeves mod en frossen payload.
 */
export function noeglerISag(d: Flad, id: string): Sagsnoegler {
  const sag = medFelt(d, 'offer')
    .map((x) => los(d, x) as Ukendt)
    .find((x) => typeof x['id'] === 'string' && x['id'] === id)
  if (!sag) throw new Error(`fandt ikke sag ${id} i payloaden`)

  const offer = (sag['offer'] ?? {}) as Ukendt
  const stats = (sag['stats'] ?? {}) as Ukendt

  // Beloebsformen `{ amount: … }` — baade paa sagen og inde i `offer`.
  const erBeloeb = (v: unknown): boolean =>
    !!v && typeof v === 'object' && !Array.isArray(v) && 'amount' in (v as Ukendt)
  const beloebsformede = [
    ...Object.entries(sag).filter(([, v]) => erBeloeb(v)).map(([k]) => k),
    ...Object.entries(offer).filter(([, v]) => erBeloeb(v)).map(([k]) => `offer.${k}`),
  ].sort()

  return {
    id,
    sagstype: sagstypeFor(id),
    sag: noegler(sag),
    offer: noegler(offer),
    stats: noegler(stats),
    beloebsformede,
  }
}

/** Sagernes id'er i en payload — dem der overhovedet kan maales. */
export function sagsIder(d: Flad): string[] {
  return [...new Set(medFelt(d, 'offer')
    .map((x) => (los(d, x) as Ukendt)['id'])
    .filter((x): x is string => typeof x === 'string'))]
}

// ── Koert direkte: hent de url'er, der staar som argumenter ──────────
if (process.argv[1]?.endsWith('home-felter.ts')) {
  const urler = process.argv.slice(2)
  if (!urler.length) {
    console.error('brug: tsx scripts/home-felter.ts <detaljeside-url> [<url> …]')
    console.error('maal BEGGE sagstyper — projektlejemaal (177P…) og almindelig (1770…)')
    process.exit(1)
  }
  for (const url of urler) {
    const d = await hentNuxt(url)
    const ider = sagsIder(d)
    console.log(`\n── ${url}`)
    console.log(`   sager i payloaden: ${ider.length} (${ider.join(', ')})`)
    // ALLE sager paa siden taelles, ikke kun den foerste: det er netop
    // forskellen mellem sagen og dens naboer, der skal kunne ses.
    for (const id of ider) {
      const n = noeglerISag(d, id)
      console.log(`\n   sag ${n.id}  [${n.sagstype}]`)
      console.log(`     sagsobjekt:  ${n.sag.join(' · ') || '(ingen)'}`)
      console.log(`     offer:       ${n.offer.join(' · ') || '(ingen)'}`)
      console.log(`     stats:       ${n.stats.join(' · ') || '(ingen)'}`)
      console.log(`     beloebsform: ${n.beloebsformede.join(' · ') || '(ingen)'}`)
    }
  }
  console.log('\nSkriv resultatet ned i scripts/kildeproever/home/ (url · tidspunkt ·')
  console.log('SHA-256 · payload), FOER adapteren udvides. Gaet aldrig et feltnavn.')
}
