'use client'
// ═══════════════════════════════════════════════════════════════
//  Prøvevisningens betjeningspanel.
//
//  ═══ PRØVEVISNINGEN KØRER I STRICTMODE ═══
//
//  I den afprøvede opsætning måltes én effektkørsel ved første
//  indlæsning og to efter scenarieskift. Kontrollen kræver derfor to
//  efter genmontering. Begge tal står i strictmodekontrollens log.
//
//  Prøven formoder ingenting om opsætningen: StrictMode slås til HER, i
//  måleudstyret, og `next.config.ts` røres ikke; den hører til
//  opsætningen og ikke til denne opgave.
//
//  StrictMode kalder setup → cleanup → setup på samme instans, og det er
//  dét, der afslører en livscyklus, der kun rydder op og aldrig sætter
//  op igen. `scripts/cloud/strictmodekontrol.mjs` måler først, at den
//  FAKTISK er aktiv, og afviser ellers.
//
//  Den stiller modulets tilstande frem ved siden af hinanden, så de kan
//  ses, tabuleres igennem og fotograferes — uden en database, uden en
//  konto og uden at sende noget.
//
//  Scenarievalget er en RADIOGRUPPE og ikke en stribe knapper: der kan
//  kun være ét ad gangen, og piletasterne skal virke. Det er samme
//  grund, som gør `aria-current` rigtig i samtalelisten.
// ═══════════════════════════════════════════════════════════════

import { StrictMode, useEffect, useMemo, useRef, useState } from 'react'
import { Beskedmodul } from '../Beskedmodul'
import { lavAttrapport, type Scenarie } from './attrapport'

const VALG: { v: Scenarie; navn: string; hvad: string }[] = [
  { v: 'normal', navn: 'Adgang', hvad: 'Tre samtaler, to ulæste i den øverste.' },
  { v: 'tom', navn: 'Tom indbakke', hvad: 'Ingen samtaler endnu.' },
  { v: 'langsom', navn: 'Indlæsning', hvad: '1,4 sek. på alt — skelet, «Henter …» og vejen tilbage undervejs.' },
  { v: 'hentefejl', navn: 'Hentefejl', hvad: 'Listen kan ikke hentes. Prøv igen-knap.' },
  { v: 'traadfejl', navn: 'Trådfejl', hvad: 'Samtalen kan ikke hentes. Vejen tilbage skal stadig findes.' },
  { v: 'findes-ikke', navn: 'Findes ikke', hvad: 'Samtalen findes ikke. Vejen tilbage skal stadig findes.' },
  { v: 'omvendt', navn: 'Omvendt rækkefølge', hvad: 'Første samtale svarer 1,5 sek. senere end de andre. A → B må ikke blive til A.' },
  { v: 'sendefejl', navn: 'Afsendelsesfejl', hvad: 'Send svarer nej. Kladden bliver stående.' },
  { v: 'sende-exception', navn: 'Afsendelse kaster', hvad: 'Porten AFVISER sit løfte. Travlheden skal slutte alligevel.' },
  { v: 'langsom-afsendelse', navn: 'Langsom afsendelse', hvad: '1,5 sek. på Send — tid til at skrive videre eller skifte samtale.' },
  { v: 'laas-ved-afsendelse', navn: 'Lås ved afsendelse', hvad: 'Send svarer «låst». Hele modulet skal lukke, også med en samtale åben.' },
  { v: 'laas-under-skift', navn: 'Lås under skift', hvad: 'Første samtale svarer «låst» straks, anden svarer «adgang» 1,5 sek. senere. Det sene svar må ikke låse op.' },
  { v: 'kvittering-efter-genlaesning', navn: 'Kvittering efter genlæsning', hvad: 'Serveren gemmer straks, kvitterer 2,2 sek. senere. En genlæsning imellem har beskeden med — den må kun stå én gang.' },
  { v: 'gammelt-snapshot', navn: 'Gammelt snapshot', hvad: 'Læsningen tager sit billede før skrivningen og svarer 1,8 sek. senere. Den bekræftede besked må ikke forsvinde.' },
  { v: 'login-kraevet', navn: 'Login påkrævet', hvad: 'Låst. Én knap: Log ind.' },
  { v: 'abonnement-kraevet', navn: 'Abonnement påkrævet', hvad: 'Låst. Én knap: Se abonnement.' },
  { v: 'abonnement-udloebet', navn: 'Abonnement udløbet', hvad: 'Låst. Én knap: Genaktivér.' },
]

/**
 * Måler, om React FAKTISK dobbeltkalder effekter.
 *
 * ═══ DEN MÅLES EFTER EN GENMONTERING ═══
 *
 * I den afprøvede opsætning måltes én effektkørsel ved første
 * indlæsning og to efter scenarieskift. Kontrollen kræver derfor to
 * efter genmontering.
 *
 * Mærket bærer derfor `key={scenarie}`: et scenarieskift monterer det
 * på ny, og DER skal tælleren stå på 2. `Beskedmodul` har den samme
 * nøgle, så modulets egne komponenter — herunder `Samtalevisning` —
 * monteres på nøjagtig samme måde, og det er dem, prøven handler om.
 *
 * Usynlig, og den rører ikke modulet. Den ligger her og ikke i
 * `app/beskeder/`, fordi den er måleudstyr og ikke produkt.
 */
function Strictmaerke() {
  const koersler = useRef(0)
  const [vist, setVist] = useState(0)
  useEffect(() => {
    koersler.current += 1
    setVist(koersler.current)
  }, [])
  return <span className="skjult-for-oejet" data-effektkoersler={vist} />
}

export function Proeve() {
  // Kun prøvevisningens eget træ. Produktet er urørt.
  return <StrictMode><Betjening /></StrictMode>
}

function Betjening() {
  const [scenarie, setScenarie] = useState<Scenarie>('normal')
  // Ny port ved hvert scenarie. `key` nedenfor nulstiller samtidig
  // modulets egen tilstand, saa et valg ikke arver det forriges.
  const port = useMemo(() => lavAttrapport(scenarie), [scenarie])
  const valgt = VALG.find((x) => x.v === scenarie)

  return (
    <>
      {/* Egen noeglesti. `Beskedmodul` er soeskende og har ogsaa
          `key={scenarie}` — to soeskende med SAMME noegle faar React til
          at duplikere dem («Encountered two children with the same key»),
          og saa stod der to maerker med hvert sit tal i DOM'en. */}
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

      <Beskedmodul
        key={scenarie}
        port={port}
        loginHref="/min-side"
        /* Findes ikke endnu. Adressen ejes af Supply — se DATAKONTRAKT.md.
           Her står en synlig attrap, så det ikke kan forveksles med en rute. */
        abonnementHref="#abonnementsruten-leveres-af-supply"
      />
    </>
  )
}
