'use client'
// ═══════════════════════════════════════════════════════════════
//  Samtalen: beskederne og skrivefeltet.
//
//  ═══ AFSENDEREN SKAL KUNNE SES UDEN FARVE OG UDEN SIDE ═══
//
//  Hver boble bærer et SKREVET afsendernavn — «Dig» eller modpartens
//  navn. Placering til højre og en anden baggrund er det, øjet læser
//  først, men ingen af delene overlever gråtoner, høj kontrast eller en
//  skærmlæser. Navnet gør. Tråden er en `<ol>`, fordi rækkefølgen ER
//  betydningen.
//
//  ═══ KLADDEN RYDDES FØRST, NÅR DEN ER SENDT ═══
//
//  Ingen optimistisk boble. Feltet beholder teksten, indtil serveren har
//  sagt ja, og en fejl efterlader derfor præcis det, brugeren skrev.
//  Samme princip som lib/gemudkast.ts, og af samme grund: WCAG 2.2
//  3.3.7 Redundant Entry er niveau A, og den rammer hårdest dér, hvor
//  indtastning koster mest — skærmtastatur, kontaktbetjening, tale.
//
//  En optimistisk boble ville desuden PÅSTÅ, at beskeden var sendt, i
//  det sekund vi ikke ved det. Det er den samme slags usandhed som en
//  total, der lader som om aconto er kendt.
//
//  ═══ KNAPPENS NAVN LAVER SIG IKKE OM ═══
//
//  «Send» hedder «Send» hele vejen, også mens den sender og efter en
//  fejl. `aria-busy` siger travlheden; navnet er dét, den der læser med,
//  har lært at genkende. Genforsøget har sin egen knap NEDE VED
//  FEJLBESKEDEN, hvor forklaringen står — det er dér, øjet er.
//
//  ═══ ENTER SKRIVER EN NY LINJE ═══
//
//  Ctrl/⌘+Enter sender. Enter alene ville koste en besked hver gang
//  nogen ville lave et afsnit — og på en telefon er Enter det eneste
//  nemme sted at bryde en linje. Genvejen står skrevet ved feltet; en
//  usynlig genvej findes ikke.
// ═══════════════════════════════════════════════════════════════

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Besked, Samtalehoved, Sendefejl, Skrivetilstand } from './kontrakt'
import { MAKS_TEGN, TAELLER_FRA, modpartsnavn } from './kontrakt'
import { dagsskel, klokken, noejagtig, sammeDag } from './tid'

/** Kan fejlen overhovedet løses ved at trykke igen? Afgøres ÉT sted. */
const kanProeveIgen = (f: Sendefejl): boolean => f === 'netvaerk' || f === 'ukendt'

const FEJLTEKST: Record<Sendefejl, string> = {
  netvaerk: 'Beskeden blev ikke sendt. Din tekst står der stadig.',
  'for-lang': `Beskeden er for lang. Den må højst fylde ${MAKS_TEGN} tegn.`,
  laast: 'Din adgang er ændret, mens du skrev. Genindlæs siden.',
  ukendt: 'Beskeden blev ikke sendt. Din tekst står der stadig.',
}

function Boble({ b, modpart, visDag }: { b: Besked; modpart: string; visDag: string | null }) {
  const mig = b.fra === 'mig'
  return (
    <>
      {visDag && (
        // Skillelinjen er `aria-hidden`: dagen står i forvejen i hver
        // boples `title` og i dens `<time>`, og et skærmlæser-stop midt
        // i en samtale er stoej, ikke oplysning.
        <li className="bsk-dagskel" aria-hidden="true"><span>{visDag}</span></li>
      )}
      <li className={`bsk-boble ${mig ? 'fra-mig' : 'fra-modpart'}`}>
        <p className="bsk-boble-hoved">
          <span className="bsk-afsender">{mig ? 'Dig' : modpart}</span>
          <time className="bsk-klokken" dateTime={b.tidspunkt} title={noejagtig(b.tidspunkt)}>
            {klokken(b.tidspunkt)}
          </time>
        </p>
        <p className="bsk-boble-tekst">{b.tekst}</p>
      </li>
    </>
  )
}

export function Samtalevisning({
  hoved, beskeder, skriv, send, abonnementHref, paaTilbage, visTilbage,
}: {
  hoved: Samtalehoved
  beskeder: Besked[]
  skriv: Skrivetilstand
  send: (tekst: string) => Promise<{ ok: true } | { ok: false; fejl: Sendefejl }>
  abonnementHref: string
  paaTilbage: () => void
  visTilbage: boolean
}) {
  const [kladde, setKladde] = useState('')
  const [sender, setSender] = useState(false)
  const [fejl, setFejl] = useState<Sendefejl | null>(null)
  const [melding, setMelding] = useState('')
  const felt = useRef<HTMLTextAreaElement>(null)
  const bund = useRef<HTMLDivElement>(null)
  const titel = useRef<HTMLHeadingElement>(null)

  const modpart = modpartsnavn(hoved.modpart)

  // Nyeste besked i syne, når tråden åbnes og efter hver afsendelse.
  // `useLayoutEffect` og ikke `useEffect`: sker springet efter maling,
  // ser man traaden hoppe.
  useLayoutEffect(() => {
    bund.current?.scrollIntoView({ block: 'end' })
  }, [hoved.id, beskeder.length])

  // Paa en telefon ERSTATTER traaden listen. Fokus skal foelge med, ellers
  // staar den, der bruger tastatur eller skaermlaeser, tilbage i en liste,
  // der ikke er der laengere.
  useEffect(() => {
    if (visTilbage) titel.current?.focus()
  }, [hoved.id, visTilbage])

  // Feltet vokser med teksten, men ikke ud over sit loft (CSS: max-height).
  useLayoutEffect(() => {
    const f = felt.current
    if (!f) return
    f.style.height = 'auto'
    f.style.height = `${f.scrollHeight}px`
  }, [kladde])

  const tilbage = MAKS_TEGN - kladde.length
  const forLang = tilbage < 0
  const tom = kladde.trim().length === 0

  async function afsend() {
    if (sender || tom || forLang) return
    setSender(true)
    setFejl(null)
    setMelding('Sender…')
    const svar = await send(kladde)
    setSender(false)
    if (svar.ok) {
      setKladde('')            // ← ryddes FØRST her
      setMelding('Beskeden er sendt.')
      felt.current?.focus()
    } else {
      setFejl(svar.fejl)
      setMelding(FEJLTEKST[svar.fejl])
    }
  }

  return (
    <section className="bsk-samtale" aria-label={`Samtale om ${hoved.bolig.adresse}`}>
      <header className="bsk-samtale-hoved">
        {visTilbage && (
          <button type="button" className="nulstil bsk-tilbage" onClick={paaTilbage}>
            <span aria-hidden="true">←</span> Alle samtaler
          </button>
        )}
        {/* `tabIndex={-1}` gør overskriften fokuserbar for koden, ikke for
            tabulatoren. Det er dén, fokus flyttes til på en telefon. */}
        <h2 className="bsk-samtale-titel" ref={titel} tabIndex={-1}>{hoved.bolig.adresse}</h2>
        <p className="bsk-samtale-under">
          {hoved.bolig.sted && <span>{hoved.bolig.sted} · </span>}
          {modpart}
          {hoved.modpart.navn !== null && (
            <span className="bsk-rolle">
              {' '}({hoved.modpart.rolle === 'udlejer' ? 'udlejer' : 'boligsøgende'})
            </span>
          )}
        </p>
      </header>

      <ol className="bsk-traad">
        {beskeder.map((b, i) => {
          const forrige = i > 0 ? beskeder[i - 1] : undefined
          return (
            <Boble
              key={b.id}
              b={b}
              modpart={modpart}
              visDag={!forrige || !sammeDag(forrige.tidspunkt, b.tidspunkt)
                ? dagsskel(b.tidspunkt) : null}
            />
          )
        })}
        <li className="bsk-bund" ref={bund as never} aria-hidden="true" />
      </ol>

      {/* Hjælpemidlets egen kanal. Den er sr-only, fordi det synlige svar
          står nedenfor — to synlige kopier af samme besked er stoej.
          Samme opdeling som app/Billedbladring.tsx. */}
      <span className="skjult-for-oejet" role="status">{melding}</span>

      {skriv === 'skrivebeskyttet' ? (
        <div className="bsk-skrivespaerre">
          <p>Du kan læse samtalen, men ikke skrive. Beskederne er ikke slettet.</p>
          <a className="knap" href={abonnementHref}>Genaktivér</a>
        </div>
      ) : (
        <form
          className="bsk-skriv"
          onSubmit={(e) => { e.preventDefault(); void afsend() }}
        >
          {fejl && (
            <p className="bsk-fejl">
              {FEJLTEKST[fejl]}
              {kanProeveIgen(fejl) && (
                <button
                  type="button" className="nulstil bsk-igen"
                  onClick={() => void afsend()} aria-busy={sender || undefined}
                >
                  Prøv igen
                </button>
              )}
            </p>
          )}
          <label className="skjult-for-oejet" htmlFor="bsk-felt">
            Skriv en besked til {modpart}
          </label>
          <div className="bsk-skriv-raekke">
            <textarea
              id="bsk-felt" ref={felt} className="bsk-felt" rows={1}
              placeholder="Skriv en besked…"
              value={kladde}
              onChange={(e) => setKladde(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  void afsend()
                }
              }}
              aria-describedby="bsk-genvej"
              aria-invalid={forLang || undefined}
            />
            {/* `aria-disabled` og IKKE `disabled`.
                En `disabled`-knap er ikke i tabulatorrækkefølgen. Den,
                der betjener med tastatur eller skærmlæser, tabulerede
                derfor fra skrivefeltet FORBI «Send» og videre ned i
                sidefoden — knappen fandtes ikke for hende, før hun
                havde skrevet noget, og der var intet, der sagde det.
                Målt af scripts/cloud/beskedkontrol.mjs, som ramte
                «Min side» dér, hvor «Send» skulle stå.
                Med `aria-disabled` bliver knappen stående i
                rækkefølgen, navnet er det samme hele vejen, og
                tilstanden bliver læst op. Et tryk, mens den er slukket,
                sender ikke — det sætter fokus i feltet, så svaret er
                til at se. En død knap ville være værre end ingen. */}
            <button
              type="submit" className="bsk-send"
              aria-disabled={tom || forLang || sender || undefined}
              aria-busy={sender || undefined}
              onClick={(e) => {
                if (!(tom || forLang || sender)) return
                e.preventDefault()
                felt.current?.focus()
              }}
            >
              Send
            </button>
          </div>
          <p className="bsk-genvej" id="bsk-genvej">
            Ctrl+Enter sender. Enter laver en ny linje.
            {tilbage <= TAELLER_FRA && (
              <span className={`bsk-taeller${forLang ? ' over' : ''}`}>
                {' '}{tilbage} tegn tilbage
              </span>
            )}
          </p>
        </form>
      )}
    </section>
  )
}
