'use client'

// ═══════════════════════════════════════════════════════════════
//  Kontrollerne, privatlivsteksten henviser til.
//
//  Sidefoden linker til /privatliv#statistik, og teksten lover, at
//  samtykket kan trækkes tilbage «her». Så skal knappen findes her —
//  ellers lover politikken noget, koden ikke gør.
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState, useTransition } from 'react'
import { C_SAMTYKKE } from '../../lib/samtykke'
import { saetSamtykke, sletMineHaendelser } from '../samtykkehandling'

export function Valg() {
  const [valg, setValg] = useState<'ja' | 'nej' | 'uvalgt'>('uvalgt')
  const [besked, setBesked] = useState<string | null>(null)
  const [venter, start] = useTransition()

  useEffect(() => {
    const c = document.cookie.split('; ').find((x) => x.startsWith(`${C_SAMTYKKE}=`))
    const v = c?.split('=')[1]
    setValg(v === 'ja' ? 'ja' : v === 'nej' ? 'nej' : 'uvalgt')
  }, [])

  const skift = (v: 'ja' | 'nej') => start(async () => {
    await saetSamtykke(v)
    setValg(v)
    setBesked(v === 'ja'
      ? 'Tak. Vi tæller nu søgninger og klik.'
      : 'Slået fra. Numrene i din browser er slettet, og vi registrerer ikke mere.')
  })

  const slet = () => start(async () => {
    const r = await sletMineHaendelser()
    setValg('nej')
    setBesked(r.slettet > 0
      ? `${r.slettet} hændelser slettet. Statistik er samtidig slået fra.`
      : 'Der var ikke noget at slette — vi har ingen hændelser med dit browsernummer.')
  })

  return (
    <div className="valgboks">
      <p>
        <strong>Dit valg lige nu:</strong>{' '}
        {valg === 'ja' ? 'statistik er slået til'
          : valg === 'nej' ? 'statistik er slået fra'
            : 'du har ikke valgt endnu — vi måler ikke, før du siger ja'}
      </p>
      <div className="valgknapper">
        <button type="button" onClick={() => skift('nej')} disabled={venter || valg === 'nej'}>
          Slå statistik fra
        </button>
        <button type="button" onClick={() => skift('ja')} disabled={venter || valg === 'ja'}>
          Slå statistik til
        </button>
        <button type="button" onClick={slet} disabled={venter}>
          Slet det, I har målt om mig
        </button>
      </div>
      {besked && <p className="valgsvar">{besked}</p>}
    </div>
  )
}
