'use client'
// ═══════════════════════════════════════════════════════════════
//  Rejsen: annonce → kontakt → beskeder.
//
//  ═══ ÉT STED HENTER ADGANGEN ═══
//
//  Panelet og beskedafsnittet skal svare på det SAMME. Hentede de hver
//  for sig, ville de kunne stå i to forskellige tilstande på samme
//  skærm — og den ene ville være forkert. Rejsen henter én gang og
//  giver svaret videre.
//
//  ═══ EN AFVIST PROMISE ER OGSÅ «FEJL» ═══
//
//  Porten kan svare `{ tilstand: 'fejl' }` OG afvise sit løfte. De to
//  er ikke det samme, men brugeren skal se det samme: en neutral besked
//  og et genforsøg. Aldrig en vej til betaling.
//
//  ═══ REJSEN REGNER INGEN ADGANGSREGEL ═══
//
//  Den gemmer adapterens svar og giver det videre. Den lægger intet
//  sammen, sammenligner ingen datoer og udleder ingenting af, hvad den
//  fik. Se kontrakt.ts.
// ═══════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import './kontakt-ui.css'
import { Annoncekort } from './Annoncekort'
import { Kontaktpanel } from './Kontaktpanel'
import { Samtaleafsnit } from './Samtaleafsnit'
import type { Beskedport } from '../beskeder/kontrakt'
import type { Annonce, Kontaktport, Kontaktsvar } from './kontrakt'

export function Rejse({
  annonce, port, beskedport, loginHref = '/min-side', abonnementHref,
}: {
  annonce: Annonce
  port: Kontaktport
  /** Beskedmodulets egen port. Rejsen rører den ikke. */
  beskedport: Beskedport
  loginHref?: string
  /**
   * Adressen til abonnement/genaktivering. INGEN standardværdi:
   * ruten ejes af Supply og findes ikke endnu. En knap, der peger på en
   * rute, der ikke findes, er værre end ingen knap. Samme valg som i
   * beskedmodulet.
   */
  abonnementHref: string
}) {
  const [svar, setSvar] = useState<Kontaktsvar | null>(null)
  const [venter, setVenter] = useState(false)
  const [starter, setStarter] = useState(false)
  const [startfejl, setStartfejl] = useState(false)
  const [aaben, setAaben] = useState(false)
  const [melding, setMelding] = useState('')
  // Samme grund som i beskedmodulet: en ref skifter med det samme, mens
  // tilstand foerst er sand efter en gengivelse. To klik i samme tik
  // ville ellers begge slippe forbi.
  const iGang = useRef(false)
  const levende = useRef(true)
  useEffect(() => {
    levende.current = true
    return () => { levende.current = false }
  }, [])

  const hent = useCallback(() => {
    // En ekstern annonce spoerger vi slet ikke om adgang til. Der er
    // ingenting at laase op: linket til kildens egen annonce er
    // offentligt. Se noten i Kontaktpanel.tsx.
    if (annonce.slags === 'ekstern') return
    setVenter(true)
    setMelding('Henter …')
    port.hentAdgang(annonce.id)
      .then((d) => {
        if (!levende.current) return
        setSvar(d)
        setMelding(d.tilstand === 'fejl' ? 'Kunne ikke hentes.' : '')
      })
      .catch(() => {
        // En afvist Promise er ikke et svar — men den maa ikke blive til
        // «ingen adgang». Den bliver til den neutrale fejl.
        if (!levende.current) return
        setSvar({ tilstand: 'fejl' })
        setMelding('Kunne ikke hentes.')
      })
      .finally(() => { if (levende.current) setVenter(false) })
  }, [annonce, port])

  useEffect(() => { hent() }, [hent])

  const start = useCallback(() => {
    if (iGang.current) return
    iGang.current = true
    setStarter(true)
    setStartfejl(false)
    port.startSamtale(annonce.id)
      .then((r) => {
        if (!levende.current) return
        if (r.ok) {
          setSvar((s) => (s?.tilstand === 'adgang'
            ? { ...s, samtale: { slags: 'i-gang', samtaleId: r.samtaleId } }
            : s))
          setAaben(true)
          setMelding('Samtalen er åbnet.')
          return
        }
        if (r.grund === 'fejl') { setStartfejl(true); return }
        // Adgangen er aendret, siden svaret blev hentet. Hele panelet
        // laases, og beskedafsnittet lukkes — der er ingenting at vise.
        setSvar({ tilstand: r.grund })
        setAaben(false)
      })
      .catch(() => { if (levende.current) setStartfejl(true) })
      .finally(() => {
        iGang.current = false
        if (levende.current) setStarter(false)
      })
  }, [annonce.id, port])

  return (
    <div className="kui-rejse">
      <span className="skjult-for-oejet" role="status">{melding}</span>
      <Annoncekort annonce={annonce} />
      {/* `key` paa TILSTANDEN. Panelet holder de afsloerede
          kontaktoplysninger i sin egen tilstand, og uden den her ville
          de blive liggende i hukommelsen, naar adgangen laases — ude af
          markuppen, men stadig i live i en monteret komponent. Et
          skift af tilstand monterer panelet paa ny og slipper dem.
          (Det er stadig ikke et loefte om browserens hukommelse; se
          app/beskeder/DATAKONTRAKT.md.) */}
      <Kontaktpanel
        key={svar?.tilstand ?? 'henter'}
        annonce={annonce}
        svar={svar}
        loginHref={loginHref}
        abonnementHref={abonnementHref}
        proevIgen={hent}
        venter={venter}
        hentKontakt={() => port.hentKontakt(annonce.id)}
        start={start}
        starter={starter}
        startfejl={startfejl}
        paaAaben={() => setAaben(true)}
      />
      <Samtaleafsnit
        aaben={aaben && svar?.tilstand === 'adgang'}
        port={beskedport}
        loginHref={loginHref}
        abonnementHref={abonnementHref}
      />
    </div>
  )
}
