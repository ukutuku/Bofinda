'use client'
// ═══════════════════════════════════════════════════════════════
//  Prøvevisningens betjeningspanel.
//
//  Den stiller modulets tilstande frem ved siden af hinanden, så de kan
//  ses, tabuleres igennem og fotograferes — uden en database, uden en
//  konto og uden at sende noget.
//
//  Scenarievalget er en RADIOGRUPPE og ikke en stribe knapper: der kan
//  kun være ét ad gangen, og piletasterne skal virke. Det er samme
//  grund, som gør `aria-current` rigtig i samtalelisten.
// ═══════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react'
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
  { v: 'login-kraevet', navn: 'Login påkrævet', hvad: 'Låst. Én knap: Log ind.' },
  { v: 'abonnement-kraevet', navn: 'Abonnement påkrævet', hvad: 'Låst. Én knap: Se abonnement.' },
  { v: 'abonnement-udloebet', navn: 'Abonnement udløbet', hvad: 'Låst. Én knap: Genaktivér.' },
]

export function Proeve() {
  const [scenarie, setScenarie] = useState<Scenarie>('normal')
  // Ny port ved hvert scenarie. `key` nedenfor nulstiller samtidig
  // modulets egen tilstand, saa et valg ikke arver det forriges.
  const port = useMemo(() => lavAttrapport(scenarie), [scenarie])
  const valgt = VALG.find((x) => x.v === scenarie)

  return (
    <>
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
