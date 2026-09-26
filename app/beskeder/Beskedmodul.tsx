'use client'
// ═══════════════════════════════════════════════════════════════
//  Beskedmodulet: listen, tråden og de tilstande, de kan stå i.
//
//  ═══ MODULET REGNER INGEN ADGANGSREGLER ═══
//
//  Der står ikke ét sted i denne fil, om nogen har betalt, hvornår et
//  abonnement udløber, eller hvad der er gratis. Porten svarer med en
//  tilstand, og modulet gengiver den. Supply ejer reglen; det her lag
//  ejer ordene og billedet. Se kontrakt.ts.
//
//  ═══ EN LÅSNING ER ENDELIG FOR DENNE VISNING ═══
//
//  Melder porten, at adgangen er lukket — uanset om det kommer fra
//  indbakken, fra en tråd eller fra en afsendelse — går HELE modulet i
//  låst visning. Samtalelisten, uddragene og beskederne bliver ikke
//  stående bag en besked om at genindlæse: tilstanden ERSTATTES med den
//  låste variant, og de ventende kvitteringer ryddes.
//
//  ⚠ Det rydder VISNINGEN og modulets tilstand. Det er ikke det samme
//  som, at data er væk fra browserens hukommelse: svarene har været
//  igennem netværkslaget, ligget i JS-objekter og kan stå i alt fra
//  `performance`-bufferen til en heap snapshot, og hverken vi eller
//  JavaScript kan garantere, hvornår en opsamler rydder dem. Det, koden
//  lover, er at modulet ikke VISER eller BRUGER dem igen.
//
//  Og låsningen er en LÅS: `laastRef` sættes med det samme, og hvert
//  eneste svar, der kommer bagefter, kasseres. Et forsinket «adgang»
//  fra et kald, der var undervejs, da låsen faldt, må ikke lukke
//  indholdet op igen.
//
//  ═══ HVERT SVAR HØRER TIL ÉN ANMODNING ═══
//
//  `traadToken` tælles op ved hver åbning og ved hver vej tilbage. Et
//  svar, hvis tal ikke længere er det aktuelle, hører til noget,
//  brugeren har forladt, og det kasseres. Uden det vandt det LANGSOMSTE
//  svar: A åbnes, B åbnes, A's svar kommer sidst — og B blev overskrevet
//  af A.
//
//  Af samme grund bærer afsendelsen sit samtale-id med: kvitteringen
//  lægges kun i tråden, hvis det stadig er DEN tråd, der vises.
//
//  ═══ ÉN PORT IND, INGEN FETCH HERINDE ═══
//
//  Ingen `fetch`, ingen server action, ingen adresse. Alt går gennem
//  `port`, og det er dét, der gør modulet afprøvbart med syntetiske
//  samtaler uden et midlertidigt produktions-API — og det, der gør den
//  rigtige serverintegration til ÉN fil senere.
//
//  ═══ TO PANELER PÅ EN SKÆRM, ÉT AD GANGEN PÅ EN TELEFON ═══
//
//  Layoutet ligger i CSS. Den ENESTE grund til, at JavaScript også
//  kender bredden, er tilbageknappen og fokusspringet: på en telefon
//  ERSTATTER tråden listen, og så skal der være en vej tilbage, og
//  fokus skal følge med. Det kan CSS ikke.
//
//  Tilbageknappen ligger i PANELET og ikke inde i `Samtalevisning`.
//  Lå den derinde, fandtes den kun, når tråden var hentet — og så var
//  der ingen vej tilbage under indlæsning, efter en hentefejl eller på
//  en samtale, der ikke findes. Netop de tre steder, hvor man helst vil
//  væk igen.
// ═══════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import './beskeder.css'
import { Laast } from './Laast'
import { Samtaleliste } from './Samtaleliste'
import { Samtalevisning, type Sendeudfald } from './Samtalevisning'
import type { Besked, Beskedport, Indbakke, Laasegrund, Samtaletraad } from './kontrakt'
import { erLaast, ulaesteIAlt } from './kontrakt'

/** Under denne bredde er der kun plads til ét panel ad gangen. */
const SMAL = '(max-width: 719px)'

type Hentning<T> =
  | { slags: 'henter' }
  | { slags: 'fejl' }
  | { slags: 'klar'; data: T }

function Hentefejl({ hvad, proevIgen }: { hvad: string; proevIgen: () => void }) {
  return (
    <div className="bsk-hentefejl">
      <p>{hvad}</p>
      <button type="button" className="nulstil" onClick={proevIgen}>Prøv igen</button>
    </div>
  )
}

export function Beskedmodul({ port, loginHref = '/min-side', abonnementHref }: {
  port: Beskedport
  /** Findes i produktet i dag. Derfor en standardværdi — og kun her. */
  loginHref?: string
  /**
   * Adressen til abonnement/genaktivering. INGEN standardværdi med vilje:
   * ruten ejes af Supply og findes ikke endnu. En knap, der peger på en
   * rute, der ikke findes, er værre end ingen knap.
   */
  abonnementHref: string
}) {
  const [indbakke, setIndbakke] = useState<Hentning<Indbakke>>({ slags: 'henter' })
  const [valgt, setValgt] = useState<string | null>(null)
  const [traad, setTraad] = useState<Hentning<Samtaletraad> | null>(null)
  const [laast, setLaast] = useState<Laasegrund | null>(null)
  const [smal, setSmal] = useState(false)
  const [melding, setMelding] = useState('')
  const listetitel = useRef<HTMLHeadingElement>(null)
  // Låsen og anmodningstællerne er refs og ikke tilstand: de skal gælde
  // i det øjeblik, de sættes, ikke efter næste gengivelse. Et svar, der
  // lander imellem de to, ville ellers slippe igennem.
  const laastRef = useRef<Laasegrund | null>(null)
  const traadToken = useRef(0)
  const indbakkeToken = useRef(0)
  /**
   * Beskeder, serveren har KVITTERET for, men som en læsning endnu ikke
   * har vist os.
   *
   * ═══ HVORFOR DEN FINDES ═══
   *
   * Læsning og skrivning er to kald, og de kan overhale hinanden. To
   * forløb, begge målt:
   *
   *  A · Send i A → over i B → tilbage i A. `hentTraad(A)` kommer FØR
   *      kvitteringen og har beskeden med, fordi serveren allerede har
   *      gemt den. Kvitteringen lagde den så i tråden én gang til, og
   *      den samme besked stod to steder med samme id.
   *
   *  B · Samme vej, men læsningen tog sit øjebliksbillede FØR skrivningen
   *      landede. Kvitteringen kom, mens tråden hentede — og blev smidt
   *      væk, fordi der ikke var nogen tråd at lægge den i. Bagefter
   *      erstattede det gamle øjebliksbillede visningen, og beskeden,
   *      brugeren lige havde fået kvittering for, forsvandt.
   *
   * Begge løses af ét sted: kvitteringer huskes pr. samtale og flettes
   * ind i HVER læsning, der ikke selv har dem med. Den dag et
   * øjebliksbillede indeholder beskeden, er den landet, og så bæres den
   * ikke videre. Brugeren skal ikke genindlæse for at få det rigtige at se.
   */
  const bekraeftede = useRef(new Map<string, Besked[]>())

  /** Husk en kvittering, indtil en læsning har vist os den. */
  const husk = useCallback((samtaleId: string, b: Besked) => {
    const liste = bekraeftede.current.get(samtaleId) ?? []
    if (!liste.some((x) => x.id === b.id)) bekraeftede.current.set(samtaleId, [...liste, b])
  }, [])

  /**
   * Flet ventende kvitteringer ind i et hentet øjebliksbillede.
   *
   * Sammenligningen er på ID, ikke på indhold: to beskeder med samme
   * tekst er to beskeder, og den samme besked hentet to gange er én.
   * Rækkefølgen kommer af tidspunktet; `sort` er stabil, så en besked
   * med samme tidsstempel som en hentet bliver stående efter den.
   */
  const flet = useCallback((samtaleId: string, hentede: Besked[]): Besked[] => {
    const ventende = bekraeftede.current.get(samtaleId)
    if (!ventende?.length) return hentede
    const kendte = new Set(hentede.map((b) => b.id))
    const mangler = ventende.filter((b) => !kendte.has(b.id))
    // Dem, læsningen nu selv har med, er landet. De bæres ikke videre —
    // ellers ville de blive flettet ind ved hver eneste senere læsning.
    if (mangler.length === 0) bekraeftede.current.delete(samtaleId)
    else if (mangler.length !== ventende.length) bekraeftede.current.set(samtaleId, mangler)
    if (mangler.length === 0) return hentede
    return [...hentede, ...mangler]
      .sort((a, b) => a.tidspunkt.localeCompare(b.tidspunkt))
  }, [])

  useEffect(() => {
    const m = window.matchMedia(SMAL)
    const opdater = () => setSmal(m.matches)
    opdater()
    m.addEventListener('change', opdater)
    return () => m.removeEventListener('change', opdater)
  }, [])

  /**
   * Luk hele modulet.
   *
   * Indholdet erstattes — det skjules ikke. Og tællerne tælles op, så
   * alt, der er undervejs, er forældet i samme sekund.
   */
  const laasNed = useCallback((grund: Laasegrund) => {
    laastRef.current = grund
    traadToken.current++
    indbakkeToken.current++
    // De ventende kvitteringer er beskedindhold. De skal ikke ligge og
    // vente paa at blive flettet ind i en visning, der er lukket.
    bekraeftede.current.clear()
    setLaast(grund)
    setIndbakke({ slags: 'klar', data: { tilstand: grund } })
    setTraad(null)
    setValgt(null)
    // Den låste visning siger det selv med `role="status"`. To kanaler
    // om det samme ville blive læst op to gange.
    setMelding('')
  }, [])

  const hentIndbakke = useCallback(() => {
    if (laastRef.current) return
    const min = ++indbakkeToken.current
    setIndbakke({ slags: 'henter' })
    setMelding('Henter dine samtaler…')
    port.hentIndbakke()
      .then((d) => {
        // Låsningen gælder, OGSÅ hvis svaret er forældet. En lukket
        // adgang er en oplysning om kontoen, ikke om denne ene
        // forespørgsel, og at lukke for meget er den rigtige vej at
        // fejle.
        // `!== 'adgang'` og ikke `erLaast(...)`: indbakkens union har
        // kun de to udfald, og den form narrower ogsaa `d` selv, saa
        // `d.samtaler` nedenfor er lovlig uden en cast.
        if (d.tilstand !== 'adgang') { laasNed(d.tilstand); return }
        if (laastRef.current || indbakkeToken.current !== min) return
        setIndbakke({ slags: 'klar', data: d })
        setMelding(`${d.samtaler.length} ${d.samtaler.length === 1 ? 'samtale' : 'samtaler'}.`)
      })
      .catch(() => {
        if (laastRef.current || indbakkeToken.current !== min) return
        setIndbakke({ slags: 'fejl' })
        setMelding('Samtalerne kunne ikke hentes.')
      })
  }, [port, laasNed])

  useEffect(() => { hentIndbakke() }, [hentIndbakke])

  const aabn = useCallback((id: string) => {
    if (laastRef.current) return
    const min = ++traadToken.current
    setValgt(id)
    setTraad({ slags: 'henter' })
    port.hentTraad(id)
      .then((d) => {
        if (erLaast(d.tilstand)) { laasNed(d.tilstand); return }
        if (laastRef.current || traadToken.current !== min) return
        // En læsning maa ikke kunne slette en besked, serveren har
        // kvitteret for. Er øjebliksbilledet ældre end kvitteringen,
        // flettes den ind; har læsningen den selv med, sker der intet.
        setTraad({
          slags: 'klar',
          data: d.tilstand === 'adgang' ? { ...d, beskeder: flet(id, d.beskeder) } : d,
        })
        if (d.tilstand !== 'adgang') return
        // Ulæst-markeringen fjernes lokalt med det samme. Kvitteringen til
        // serveren må gerne fejle i stilhed — en markering, der bliver
        // stående et øjeblik for længe, er ikke værd at afbryde nogen for.
        setIndbakke((i) => (i.slags === 'klar' && i.data.tilstand === 'adgang'
          ? {
            slags: 'klar',
            data: {
              tilstand: 'adgang',
              samtaler: i.data.samtaler.map((s) => (s.id === id ? { ...s, ulaeste: 0 } : s)),
            },
          }
          : i))
        void port.markerLaest(id).catch(() => {})
      })
      .catch(() => {
        if (laastRef.current || traadToken.current !== min) return
        setTraad({ slags: 'fejl' })
      })
  }, [port, laasNed, flet])

  const tilbage = useCallback(() => {
    // Tælles op FØR visningen ryddes: et svar, der er undervejs, må ikke
    // kunne overtage panelet igen, efter brugeren har forladt samtalen.
    traadToken.current++
    setValgt(null)
    setTraad(null)
    // Fokus tilbage i listen — ellers står den, der bruger tastatur,
    // i toppen af et dokument, hun ikke selv navigerede til.
    window.requestAnimationFrame(() => listetitel.current?.focus())
  }, [])

  /**
   * Afsendelsen, bundet til ÉN samtale.
   *
   * `samtaleId` bæres med hele vejen og efterprøves, før kvitteringen
   * lægges i tråden. Uden det landede en besked, der blev sendt i A, i
   * den tråd der tilfældigvis var åben, når svaret kom — B.
   *
   * Kaster porten, håndteres det i `Samtalevisning`: den ejer
   * travlheden og kladden.
   */
  const sendTil = useCallback(
    async (samtaleId: string, tekst: string): Promise<Sendeudfald> => {
      const svar = await port.send(samtaleId, tekst)
      if (!svar.ok) {
        if (svar.fejl === 'laast') { laasNed(svar.grund); return { ok: false, fejl: 'laast' } }
        return { ok: false, fejl: svar.fejl }
      }
      if (laastRef.current) return { ok: true }
      const { besked } = svar
      // Huskes FOERST. Er traaden ved at blive hentet lige nu, er der
      // ingen visning at lægge beskeden i — og uden det her ville den
      // blive tabt, naar et ældre øjebliksbillede landede bagefter.
      husk(samtaleId, besked)
      setTraad((t) => {
        if (!(t?.slags === 'klar' && t.data.tilstand === 'adgang'
          && t.data.hoved.id === samtaleId)) return t
        // Har en læsning allerede vist os beskeden, laegges den ikke i
        // igen. Samme id ER den samme besked.
        if (t.data.beskeder.some((b) => b.id === besked.id)) return t
        return { slags: 'klar', data: { ...t.data, beskeder: [...t.data.beskeder, besked] } }
      })
      setIndbakke((i) => (i.slags === 'klar' && i.data.tilstand === 'adgang'
        ? {
          slags: 'klar',
          data: {
            tilstand: 'adgang',
            samtaler: i.data.samtaler.map((s) => (s.id === samtaleId
              ? { ...s, sidsteAktivitet: besked.tidspunkt, uddrag: null }
              : s)),
          },
        }
        : i))
      return { ok: true }
    }, [port, laasNed, husk],
  )

  // ── Hele modulet låst ───────────────────────────────────────
  if (laast) {
    return <Laast grund={laast} loginHref={loginHref} abonnementHref={abonnementHref} />
  }

  const samtaler = indbakke.slags === 'klar' && indbakke.data.tilstand === 'adgang'
    ? indbakke.data.samtaler : []
  const ulaeste = ulaesteIAlt(samtaler)
  // På en telefon er der kun plads til ét panel. Er en samtale valgt,
  // ER det panelet — listen er der ikke, og derfor er tilbageknappen ikke
  // pynt, men den eneste vej.
  const visListe = !smal || valgt === null
  const visTraad = !smal || valgt !== null

  // Narrowingen sker FØR JSX'en. `traad` er en tilstandsvariabel, og
  // lukningerne nedenfor ville ellers hver for sig se den brede union
  // igen. Den låste variant har ingen `hoved`.
  const aaben = traad?.slags === 'klar' && traad.data.tilstand === 'adgang'
    ? traad.data : null

  return (
    <div className={`bsk-modul${valgt ? ' har-valgt' : ''}`}>
      <span className="skjult-for-oejet" role="status">{melding}</span>

      {visListe && (
        <section className="bsk-panel bsk-listepanel" aria-label="Samtaler">
          <div className="bsk-panelhoved">
            <h2 className="bsk-paneltitel" ref={listetitel} tabIndex={-1}>Samtaler</h2>
            {ulaeste > 0 && (
              <p className="bsk-ulaest-i-alt">{ulaeste} ulæst{ulaeste === 1 ? '' : 'e'}</p>
            )}
          </div>
          {indbakke.slags === 'fejl' ? (
            <Hentefejl hvad="Samtalerne kunne ikke hentes." proevIgen={hentIndbakke} />
          ) : (
            <Samtaleliste
              tilstand={indbakke.slags === 'henter' ? 'henter' : 'klar'}
              samtaler={samtaler}
              valgt={valgt}
              vaelg={aabn}
            />
          )}
        </section>
      )}

      {visTraad && (
        <div className="bsk-panel bsk-traadpanel">
          {/* Vejen tilbage findes i ALLE trådens tilstande, ikke kun når
              den er hentet. Se noten øverst. */}
          {smal && valgt !== null && (
            <div className="bsk-traadtop">
              <button type="button" className="nulstil bsk-tilbage" onClick={tilbage}>
                <span aria-hidden="true">←</span> Alle samtaler
              </button>
            </div>
          )}
          {traad === null ? (
            <p className="bsk-intet-valgt">Vælg en samtale i listen.</p>
          ) : traad.slags === 'henter' ? (
            <p className="bsk-intet-valgt" role="status">Henter samtalen…</p>
          ) : traad.slags === 'fejl' ? (
            <Hentefejl
              hvad="Samtalen kunne ikke hentes."
              proevIgen={() => { if (valgt) aabn(valgt) }}
            />
          ) : aaben === null ? (
            <p className="bsk-intet-valgt">Samtalen findes ikke længere.</p>
          ) : (
            // `key` er samtalens id: et skift skal NULSTILLE kladde,
            // travlhed og fejl. Uden den genbruger React den samme
            // instans, og så ville en kvittering fra den forrige samtale
            // rydde feltet og flytte fokus i den nye.
            <Samtalevisning
              key={aaben.hoved.id}
              hoved={aaben.hoved}
              beskeder={aaben.beskeder}
              fokuserVedAabning={smal}
              send={(tekst) => sendTil(aaben.hoved.id, tekst)}
            />
          )}
        </div>
      )}
    </div>
  )
}
