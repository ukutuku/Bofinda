// Registret. En ny kilde tilfoejes her og ingen andre steder.
import type { SourceAdapter } from '../lib/adapter'
import { dummyAdapter } from './dummy'
import { dummy2Adapter } from './dummy2'
import { findboligAdapter } from './findbolig'
import { propstepAdapter } from './propstep'

export interface Registreret {
  adapter: SourceAdapter
  navn: string
  baseUrl?: string
  /** Sat paa kilder der kun findes til udvikling. */
  kunUdvikling?: boolean
}

// Startfilteret. Sat til ét postnummer, mens kilden koeres ind — udvides,
// naar en fuld koersel har vaeret stabil.
const FINDBOLIG_FILTER = { PostalCodeAndPostalCodeName: ['2300 København S'] }

export const KILDER: Registreret[] = [
  {
    adapter: findboligAdapter(FINDBOLIG_FILTER),
    navn: 'findbolig.nu',
    baseUrl: 'https://findbolig.nu',
  },
  {
    adapter: propstepAdapter({ postalCodes: ['2300'] }),
    navn: 'Propstep',
    baseUrl: 'https://propstep.com',
  },
  { adapter: dummyAdapter, navn: 'Dummy (testdata)', baseUrl: 'https://dummy.invalid', kunUdvikling: true },
  { adapter: dummy2Adapter, navn: 'Dummy 2 (testdata)', baseUrl: 'https://dummy2.invalid', kunUdvikling: true },
]

export const findKilde = (slug: string) => KILDER.find((k) => k.adapter.id === slug)
