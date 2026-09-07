// Registret. En ny kilde tilfoejes her og ingen andre steder.
import type { SourceAdapter } from '../lib/adapter'
import { dummyAdapter } from './dummy'
import { dummy2Adapter } from './dummy2'
import { findboligAdapter } from './findbolig'
import { propstepAdapter } from './propstep'
import { dacasAdapter } from './dacas'
import { lokalboligAdapter } from './lokalbolig'
import { balderAdapter } from './balder'
import { cejAdapter } from './cej'
import { birchAdapter } from './birch'
import { heimstadenAdapter } from './heimstaden'
import { homeAdapter } from './home'

export interface Registreret {
  adapter: SourceAdapter
  navn: string
  baseUrl?: string
  /**
   * Holdes UDE af automatiske koersler. Kilden koerer kun, naar nogen
   * navngiver den udtrykkeligt: `npm run import -- <slug>`.
   *
   * Bruges til to ting:
   *   - testkilder, der aldrig maa blande sig med rigtige boliger
   *   - rigtige kilder, der endnu ikke er sluppet loes paa cron'en
   *
   * Det sidste er ikke teoretisk: Railway koerer `npm run import` uden
   * argumenter hver time, saa en nyregistreret kilde begynder at kalde ud
   * i samme oejeblik, den er pushet. Flaget er den eksisterende — og
   * eneste virksomme — maade at holde den tilbage paa.
   */
  kunUdvikling?: boolean
}

// Postnummer-begraensning under indkoering. Tom = fuld daekning.
//   PROPSTEP_POSTNR=2300           kun ét postnummer
//   FINDBOLIG_OMRAADE='2300 København S'
// Vaerdierne til findbolig skal matche GET /api/search/suggestions/{tekst}.
const liste = (v: string | undefined) =>
  v?.split(',').map((x) => x.trim()).filter(Boolean)

const FINDBOLIG_OMRAADE = liste(process.env.FINDBOLIG_OMRAADE)
const FINDBOLIG_FILTER: Record<string, string[]> = FINDBOLIG_OMRAADE
  ? { PostalCodeAndPostalCodeName: FINDBOLIG_OMRAADE }
  : {}

export const KILDER: Registreret[] = [
  {
    adapter: findboligAdapter(FINDBOLIG_FILTER),
    navn: 'findbolig.nu',
    baseUrl: 'https://findbolig.nu',
  },
  {
    adapter: propstepAdapter({ postalCodes: liste(process.env.PROPSTEP_POSTNR) }),
    navn: 'Propstep',
    baseUrl: 'https://propstep.com',
  },
  {
    adapter: dacasAdapter(),
    navn: 'Dacas',
    baseUrl: 'https://dacas.dk',
  },
  {
    adapter: lokalboligAdapter(),
    navn: 'LokalBolig',
    baseUrl: 'https://www.lokalbolig.dk',
  },
  {
    adapter: balderAdapter(),
    navn: 'Balder',
    baseUrl: 'https://www.balder.dk',
  },
  {
    adapter: homeAdapter(),
    navn: 'home.dk',
    baseUrl: 'https://home.dk',
  },
  {
    adapter: cejAdapter(),
    navn: 'CEJ',
    baseUrl: 'https://udlejning.cej.dk',
  },
  {
    adapter: heimstadenAdapter(),
    navn: 'Heimstaden',
    baseUrl: 'https://www.heimstaden.dk',
    // Med i cron'en fra 7. sep. 2026, men STADIG med skruet ned for
    // detaljerne: `HEIMSTADEN_DETALJEBUDGET=3` staar paa Railway, saa en
    // runde henter hoejst tre detaljesider. Fuld hoest er ikke godkendt.
    //
    // Baggrunden: kildens CDN droevlede os 6. sep. — 503 paa alt fra
    // Mac'ens IP efter ~17 min ved ét kald i sekundet. To kontrollerede
    // proever siden da (Mac og Railway, 1 discovery + 3 detaljer hver)
    // gav 0 fejl, 0 spaerrer og ingen 429/503, ogsaa fra Railways egress.
    // Takten er 5 sekunder, se VAERTSTAKT i lib/fetch.ts.
    //
    // Skrues budgettet op, saa goer det i smaa skridt og se paa
    // host_blocks bagefter. Vaertsspaerren stopper os efter et 429/503,
    // men den er ingen undskyldning for at gaa haardt til den.
  },
  {
    adapter: birchAdapter(),
    navn: 'Birch Ejendomme',
    baseUrl: 'https://birchejendomme.dk',
  },
  { adapter: dummyAdapter, navn: 'Dummy (testdata)', baseUrl: 'https://dummy.invalid', kunUdvikling: true },
  { adapter: dummy2Adapter, navn: 'Dummy 2 (testdata)', baseUrl: 'https://dummy2.invalid', kunUdvikling: true },
]

export const findKilde = (slug: string) => KILDER.find((k) => k.adapter.id === slug)

/** Kilderne der maa koere uden at nogen navngiver dem. */
export const rigtigeKilder = () => KILDER.filter((k) => !k.kunUdvikling)

// ── Spaerring af testkilder ───────────────────────────────────────────────
// Bevidst UDEN NODE_ENV. Den er ikke sat lokalt, den var ikke sat paa
// Railway, og en spaerring der hviler paa en variabel, ingen husker at
// saette, er ingen spaerring. Flaget kan kun taendes af den kodevej, der
// navngiver en kilde udtrykkeligt.
let testkilderTilladt = false
export const tilladTestkilder = () => { testkilderTilladt = true }
export const maaTestkilderKoere = () => testkilderTilladt
