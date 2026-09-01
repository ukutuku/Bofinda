// Registret. En ny kilde tilfoejes her og ingen andre steder.
import type { SourceAdapter } from '../lib/adapter'
import { dummyAdapter } from './dummy'
import { dummy2Adapter } from './dummy2'
import { findboligAdapter } from './findbolig'
import { propstepAdapter } from './propstep'
import { dacasAdapter } from './dacas'

export interface Registreret {
  adapter: SourceAdapter
  navn: string
  baseUrl?: string
  /** Sat paa kilder der kun findes til udvikling. */
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
