// Registret. En ny kilde tilfoejes her og ingen andre steder.
import type { SourceAdapter } from '../lib/adapter'
import { dummyAdapter } from './dummy'
import { dummy2Adapter } from './dummy2'

export interface Registreret {
  adapter: SourceAdapter
  navn: string
  baseUrl?: string
  /** Sat paa kilder der kun findes til udvikling. */
  kunUdvikling?: boolean
}

export const KILDER: Registreret[] = [
  { adapter: dummyAdapter, navn: 'Dummy (testdata)', baseUrl: 'https://dummy.invalid', kunUdvikling: true },
  { adapter: dummy2Adapter, navn: 'Dummy 2 (testdata)', baseUrl: 'https://dummy2.invalid', kunUdvikling: true },
]

export const findKilde = (slug: string) => KILDER.find((k) => k.adapter.id === slug)
