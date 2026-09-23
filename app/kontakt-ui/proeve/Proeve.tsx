'use client'
// ═══════════════════════════════════════════════════════════════
//  Prøvevisningens betjeningspanel for kontaktrejsen.
//
//  ═══ DEN KØRER I STRICTMODE ═══
//
//  Samme valg som beskedmodulets prøvevisning, og af samme målte grund:
//  projektet har ikke `reactStrictMode` i next.config.ts, og Next 15
//  slår den ikke til af sig selv. Den slås derfor til HER, i
//  måleudstyret — ikke i opsætningen. StrictMode kalder setup →
//  cleanup → setup på samme instans og afslører en livscyklus, der kun
//  rydder op.
//
//  ═══ BETJENINGEN GENBRUGES ═══
//
//  Pillerne, banneret og rammen er beskedmodulets prøvevisnings CSS,
//  importeret som den er. To sæt næsten ens knapper ville drive fra
//  hinanden — og det er en prøvevisning, ikke et produkt.
// ═══════════════════════════════════════════════════════════════

import { StrictMode, useEffect, useMemo, useRef, useState } from 'react'
import { lavAttrapport } from '../../beskeder/proeve/attrapport'
import { Rejse } from '../Rejse'
import { annoncenFor, lavKontaktattrap, type Scenarie } from './attrap'

const VALG: { v: Scenarie; navn: string; hvad: string }[] = [
  { v: 'native-adgang', navn: '1 · Udlejerens egen annonce', hvad: 'Kontakt hos os. Primær handling: skriv til udlejeren. Kontaktoplysninger hentes først ved et tryk.' },
  { v: 'ekstern-home', navn: '2 · Ekstern (home.dk)', hvad: 'Kontakten sker hos kilden. Én handling: se annoncen. Ingen login, ingen betaling, ingen beskeder.' },
  { v: 'ekstern-cej', navn: '2b · Ekstern (CEJ)', hvad: 'Samme vej, anden kilde. Annonceringstidspunktet er ukendt og skrives ikke.' },
  { v: 'ekstern-propstep', navn: '2c · Ekstern (Propstep)', hvad: 'Samme vej, tredje kilde.' },
  { v: 'gratis', navn: '3 · Gratis tilstand', hvad: 'Ingen betalingsopfordring. Kontaktoplysningerne er åbne; login står kun ved samtalen, som kræver en konto.' },
  { v: 'betaling-uden-adgang', navn: '4 · Betaling uden adgang', hvad: 'Én forklaring, ÉN knap, og hele prisforløbet i én sætning.' },
  { v: 'aktivt-abonnement', navn: '5 · Aktivt abonnement', hvad: 'Samtalen er allerede i gang. «Åbn samtalen» viser beskedmodulet.' },
  { v: 'opsagt-med-adgang', navn: '6 · Opsagt, adgang tilbage', hvad: 'Adgangen fortsætter til datoen. En oplysning — ikke et salg.' },
  { v: 'udloebet', navn: '7 · Udløbet adgang', hvad: 'Hverken kontaktoplysninger eller beskeder. Intet privat indhold i markuppen.' },
  { v: 'teknisk-fejl', navn: '8 · Teknisk fejl', hvad: 'Neutral besked og genforsøg. Ingen pris, ingen abonnementsknap.' },
  { v: 'porten-kaster', navn: '8b · Porten kaster', hvad: 'En AFVIST Promise. Samme neutrale visning som 8 — og heller ikke her en vej til betaling.' },
  { v: 'login-kraevet', navn: 'Login påkrævet', hvad: 'Hele panelet kræver en konto. Ingen pris.' },
  { v: 'langsom', navn: 'Indlæsning', hvad: '1,5 sek. på alt — skelet og «Henter …».' },
  { v: 'ingen-kontaktoplysninger', navn: 'Ingen kontaktoplysninger', hvad: 'Udlejeren har ryddet begge felter. Så siger vi det i stedet for at vise en tom knap.' },
  { v: 'lange-tekster', navn: 'Lange tekster', hvad: 'Lang adresse, langt sted, lang overskrift. Må ikke bryde layoutet ved 390 px.' },
  { v: 'start-fejler', navn: 'Start fejler', hvad: 'Samtalen kan ikke startes. Neutral fejl — ikke en betalingsmur.' },
  { v: 'start-laaser', navn: 'Adgang ændret under start', hvad: 'Serveren svarer «udløbet», mens hun trykker. Hele panelet låses.' },
]

function Strictmaerke() {
  const koersler = useRef(0)
  const [vist, setVist] = useState(0)
  useEffect(() => { koersler.current += 1; setVist(koersler.current) }, [])
  return <span className="skjult-for-oejet" data-effektkoersler={vist} />
}

export function Proeve() {
  return <StrictMode><Betjening /></StrictMode>
}

function Betjening() {
  const [scenarie, setScenarie] = useState<Scenarie>('native-adgang')
  const port = useMemo(() => lavKontaktattrap(scenarie), [scenarie])
  // Beskedmodulets EGEN attrap. Rejsen bygger ingen ny indbakke og
  // ingen ny beskedattrap — den bruger modulets.
  const beskedport = useMemo(() => lavAttrapport('normal'), [scenarie])
  const annonce = useMemo(() => annoncenFor(scenarie), [scenarie])
  const valgt = VALG.find((x) => x.v === scenarie)

  return (
    <>
      {/* Egen nøglesti: `Rejse` er søskende og har også `key={scenarie}`.
          To søskende med samme nøgle får React til at duplikere dem. */}
      <Strictmaerke key={`maerke-${scenarie}`} />
      <fieldset className="proeve-valg">
        <legend>Tilstand</legend>
        <div className="proeve-knapper">
          {VALG.map((x) => (
            <label key={x.v} className={`proeve-valgknap${scenarie === x.v ? ' er-valgt' : ''}`}>
              <input
                type="radio" name="scenarie" value={x.v}
                checked={scenarie === x.v}
                onChange={() => setScenarie(x.v)}
              />
              {x.navn}
            </label>
          ))}
        </div>
        <p className="proeve-hvad" role="status">{valgt?.hvad}</p>
      </fieldset>

      <Rejse
        key={scenarie}
        annonce={annonce}
        port={port}
        beskedport={beskedport}
        loginHref="/min-side"
        /* Findes ikke endnu. Ruten ejes af Supply — se
           SERVERINTEGRATION.md. Her står en synlig attrap, så den ikke
           kan forveksles med en rute. */
        abonnementHref="#abonnementsruten-leveres-af-supply"
      />
    </>
  )
}
