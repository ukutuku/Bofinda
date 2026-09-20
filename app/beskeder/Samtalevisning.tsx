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
//  ═══ KLADDEN RYDDES FØRST, NÅR DEN ER SENDT — OG KUN DEN ═══
//
//  Ingen optimistisk boble. Feltet beholder teksten, indtil serveren har
//  sagt ja, og en fejl efterlader derfor præcis det, brugeren skrev.
//  Samme princip som lib/gemudkast.ts, og af samme grund: WCAG 2.2
//  3.3.7 Redundant Entry er niveau A, og den rammer hårdest dér, hvor
//  indtastning koster mest — skærmtastatur, kontaktbetjening, tale.
//
//  Og kun DEN tekst, der blev sendt. Skriver hun videre, mens
//  afsendelsen er undervejs, ryddede en tidligere udgave hele feltet —
//  også det, kvitteringen ikke handlede om. Nu fjernes præcis den
//  sendte tekst, og resten bliver stående.
//
//  ═══ ALLE TRE UDFALD, IKKE TO ═══
//
//  Porten kan svare ja, svare nej — og AFVISE sit løfte. Det sidste er
//  ikke et hjørnetilfælde: en afbrudt forbindelse, en 500'er uden krop
//  og en server action, der kaster, ser alle sådan ud. Uden `catch`
//  blev `sender` hængende sand, knappen sad fast i travl, og der var
//  ingen vej videre. Travlheden afsluttes derfor i `finally`.
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
import type { Besked, Samtalehoved, Sendefejl } from './kontrakt'
import { MAKS_TEGN, TAELLER_FRA, modpartsnavn } from './kontrakt'
import { dagsskel, klokken, noejagtig, sammeDag } from './tid'

/** Kan fejlen overhovedet løses ved at trykke igen? Afgøres ÉT sted. */
const kanProeveIgen = (f: Sendefejl): boolean => f === 'netvaerk' || f === 'ukendt'

const FEJLTEKST: Record<Sendefejl, string> = {
  netvaerk: 'Beskeden blev ikke sendt. Din tekst står der stadig.',
  'for-lang': `Beskeden er for lang. Den må højst fylde ${MAKS_TEGN} tegn.`,
  laast: 'Din adgang er ændret, mens du skrev.',
  ukendt: 'Beskeden blev ikke sendt. Din tekst står der stadig.',
}

export type Sendeudfald = { ok: true } | { ok: false; fejl: Sendefejl }

function Boble({ b, modpart, visDag }: { b: Besked; modpart: string; visDag: string | null }) {
  const mig = b.fra === 'mig'
  return (
    <>
      {visDag && (
        // Skillelinjen er `aria-hidden`: dagen står i forvejen i hver
        // bobles `title` og i dens `<time>`, og et skærmlæser-stop midt
        // i en samtale er støj, ikke oplysning.
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

export function Samtalevisning({ hoved, beskeder, send, fokuserVedAabning }: {
  hoved: Samtalehoved
  beskeder: Besked[]
  /**
   * Afsendelsen. Må både svare nej OG afvise sit løfte — begge dele
   * håndteres her. Modulet ovenover binder den til DENNE samtale.
   */
  send: (tekst: string) => Promise<Sendeudfald>
  /** På en telefon erstatter tråden listen, og fokus skal følge med. */
  fokuserVedAabning: boolean
}) {
  const [kladde, setKladde] = useState('')
  const [sender, setSender] = useState(false)
  const [fejl, setFejl] = useState<Sendefejl | null>(null)
  const [melding, setMelding] = useState('')
  const felt = useRef<HTMLTextAreaElement>(null)
  const bund = useRef<HTMLDivElement>(null)
  const titel = useRef<HTMLHeadingElement>(null)
  // Låsen mod dobbeltafsendelse. `sender` er TILSTAND og er først sand
  // efter en gengivelse; to klik i samme tik ville begge se den falsk
  // og sende to gange. En ref skifter med det samme.
  const iGang = useRef(false)
  const levende = useRef(true)
  // ═══ SYMMETRISK: SETUP SAETTER TIL, CLEANUP SAETTER FRA ═══
  //
  // Effekten havde kun en oprydning — `() => () => { … = false }`. Det
  // ser rigtigt ud og er det ikke: React kalder i StrictMode setup,
  // cleanup og setup igen paa SAMME instans. Uden et `true` i setup stod
  // ref'en tilbage paa `false` efter den runde, og saa ignorerede
  // `afsend()` baade sit ja og sit nej — `setSender(false)` blev sprunget
  // over, og knappen sad fast i travl, uden at noget var galt.
  //
  // Maalt: projektet har IKKE `reactStrictMode` slaaet til i dag, saa
  // fejlen bider hverken i produktionsbygget eller i `npm run dev` som
  // det staar nu. Den ville bide den dag, nogen slaar den til — hvilket
  // Next selv anbefaler — og en livscyklus, der kun rydder op og aldrig
  // saetter op igen, er forkert uanset hvad der faenger den.
  // Proevevisningen slaar derfor StrictMode til i SIT eget trae, og
  // scripts/cloud/strictmodekontrol.mjs maaler det under den.
  useEffect(() => {
    levende.current = true
    return () => { levende.current = false }
  }, [])

  const modpart = modpartsnavn(hoved.modpart)

  // Nyeste besked i syne, når tråden åbnes og efter hver afsendelse.
  // `useLayoutEffect` og ikke `useEffect`: sker springet efter maling,
  // ser man tråden hoppe.
  useLayoutEffect(() => {
    bund.current?.scrollIntoView({ block: 'end' })
  }, [hoved.id, beskeder.length])

  useEffect(() => {
    if (fokuserVedAabning) titel.current?.focus()
  }, [hoved.id, fokuserVedAabning])

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
    if (iGang.current || tom || forLang) return
    iGang.current = true
    // Teksten LÅSES fast her. Alt nedenfor handler om præcis den —
    // ikke om det, der måtte stå i feltet, når svaret kommer tilbage.
    const sendt = kladde
    setSender(true)
    setFejl(null)
    setMelding('Sender…')
    try {
      const svar = await send(sendt)
      if (!levende.current) return
      if (svar.ok) {
        // Kun den sendte tekst fjernes. Er der skrevet videre imens,
        // bliver resten stående — ellers ville kvitteringen for den
        // gamle tekst slette den nye.
        setKladde((k) => (k === sendt ? ''
          : k.startsWith(sendt) ? k.slice(sendt.length)
            : k))
        setMelding('Beskeden er sendt.')
        felt.current?.focus()
      } else {
        setFejl(svar.fejl)
        setMelding(FEJLTEKST[svar.fejl])
      }
    } catch {
      // Porten afviste sit løfte. Brugeren skal kunne komme videre, og
      // kladden skal stå der endnu — præcis som ved et nej.
      if (!levende.current) return
      setFejl('ukendt')
      setMelding(FEJLTEKST.ukendt)
    } finally {
      iGang.current = false
      if (levende.current) setSender(false)
    }
  }

  return (
    <section className="bsk-samtale" aria-label={`Samtale om ${hoved.bolig.adresse}`}>
      <header className="bsk-samtale-hoved">
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
          står nedenfor — to synlige kopier af samme besked er støj.
          Samme opdeling som app/Billedbladring.tsx. */}
      <span className="skjult-for-oejet" role="status">{melding}</span>

      <form className="bsk-skriv" onSubmit={(e) => { e.preventDefault(); void afsend() }}>
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
              En `disabled`-knap er ikke i tabulatorrækkefølgen. Den, der
              betjener med tastatur eller skærmlæser, tabulerede derfor
              fra skrivefeltet FORBI «Send» og videre ned i sidefoden —
              knappen fandtes ikke for hende, før hun havde skrevet
              noget, og der var intet, der sagde det. Målt af
              scripts/cloud/beskedkontrol.mjs, som ramte «Min side» dér,
              hvor «Send» skulle stå.
              Et tryk, mens den er slukket, sender ikke — det sætter
              fokus i feltet, så svaret er til at se. */}
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
    </section>
  )
}
