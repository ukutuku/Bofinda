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
//  fik. BEGGE annoncetyper spørger — også de eksterne. Se kontrakt.ts.
//
//  ═══ DET NYESTE SVAR VINDER, IKKE DET SIDST ANKOMNE ═══
//
//  Hvert kald, der kan ændre tilstanden, trækker et nummer. Når svaret
//  kommer, tæller det KUN, hvis nummeret stadig er det højeste. Uden
//  den regel afgjorde nettets luner udfaldet: to tryk på «Prøv igen»,
//  hvor det ældste svar kom sidst, kunne lade et «adgang» overskrive
//  en nyere lås — og panelet stod åbent, fordi et forældet svar kom
//  for sent. Det samme gjaldt en lås fra `startSamtale`.
//
//  `levende` svarer på et ANDET spørgsmål (er komponenten monteret) og
//  er derfor stadig sin egen ref. Og `venter` svarer på et TREDJE (er
//  der noget undervejs overhovedet) og tælles derfor for sig — ellers
//  ville en overhalet anmodning efterlade skeletttet stående for evigt.
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

  // ── Koesystemet: hvis svar taeller? ────────────────────────
  // ÉT nummer for baade hent og start, saa de kan sammenlignes. En
  // laasning fra start skal kunne overhale et adgangsopslag, og et
  // NYERE adgangsopslag skal kunne overhale laasningen igen — ellers
  // ville en genvunden adgang aldrig kunne aabne panelet.
  const anmodning = useRef(0)
  const nytNummer = () => ++anmodning.current
  const gaelder = (nr: number) => anmodning.current === nr

  // Et SELVSTAENDIGT taelleri. «Er der noget undervejs» er ikke det
  // samme spoergsmaal som «hvis svar taeller», og de maa ikke afledes
  // af hinanden: en overhalet anmodning skal stadig kunne rydde op
  // efter sig selv, ellers hang skeletttet.
  const undervejs = useRef(0)

  const hent = useCallback(() => {
    // BEGGE annoncetyper spoerger. Den eksterne sprang foer over med
    // den begrundelse, at kildens link er offentligt — men om kunden
    // maa bruge det, er adapterens beslutning og ikke vores.
    //
    // «Proev igen» latches MED VILJE ikke. Et laas paa knappen ville
    // skjule kaploebet i stedet for at loese det, og saa kunne
    // kontrollen ikke fremprovokere det gennem brugerfladen. Nummeret
    // nedenfor er rettelsen; knappen er ikke.
    const nr = nytNummer()
    undervejs.current += 1
    setVenter(true)
    setMelding('Henter …')
    port.hentAdgang(annonce.id)
      .then((d) => {
        if (!levende.current || !gaelder(nr)) return
        setSvar(d)
        setMelding(d.tilstand === 'fejl' ? 'Kunne ikke hentes.' : '')
        // Et nyt svar goer det forrige FORSOEG foraeldet, ikke kun det
        // forrige svar: en startfejl fra dengang hoerer ikke til her
        // mere. Og lukkes adgangen, maa beskedafsnittet ikke staa
        // aabent og vente paa at blive lukket op igen af sig selv,
        // naeste gang adgangen bliver god.
        setStartfejl(false)
        if (d.tilstand !== 'adgang') setAaben(false)
      })
      .catch(() => {
        // En afvist Promise er ikke et svar — men den maa ikke blive til
        // «ingen adgang». Den bliver til den neutrale fejl.
        if (!levende.current || !gaelder(nr)) return
        setSvar({ tilstand: 'fejl' })
        setMelding('Kunne ikke hentes.')
      })
      .finally(() => {
        // Taelles ALTID ned, ogsaa for et overhalet svar. Ellers stod
        // «Henter …» tilbage efter en anmodning, ingen ventede paa.
        undervejs.current = Math.max(0, undervejs.current - 1)
        if (levende.current && undervejs.current === 0) setVenter(false)
      })
    // `annonce.id` og ikke `annonce`: kroppen bruger kun id'et, og en
    // kalder, der laver objektet i sin egen gengivelse — hvad en
    // boligside naturligt goer — ville ellers give en ny reference hver
    // gang og dermed et nyt opslag ved HVER gengivelse. `start()` har
    // hele tiden afhaengt af id'et; nu svarer de to ens.
  }, [annonce.id, port])

  useEffect(() => { hent() }, [hent])

  const start = useCallback(() => {
    // `iGang` og nummeret svarer paa hver sit: iGang forhindrer to
    // samtaler i at blive oprettet af to klik i samme tik; nummeret
    // afgoer, hvis svar der taeller, naar flere kald er undervejs.
    if (iGang.current) return
    iGang.current = true
    const nr = nytNummer()
    setStarter(true)
    setStartfejl(false)
    port.startSamtale(annonce.id)
      .then((r) => {
        if (!levende.current || !gaelder(nr)) return
        if (r.ok) {
          setSvar((s) => (s?.tilstand === 'adgang' && s.indhold.slags === 'native'
            ? { ...s, indhold: { ...s.indhold, samtale: { slags: 'i-gang', samtaleId: r.samtaleId } } }
            : s))
          setAaben(true)
          setMelding('Samtalen er åbnet.')
          return
        }
        if (r.grund === 'fejl') { setStartfejl(true); return }
        // Adgangen er aendret, siden svaret blev hentet. Hele panelet
        // laases, og beskedafsnittet lukkes — der er ingenting at vise.
        // Nummeret ovenfor er dét, der holder laasen: et adgangsopslag,
        // der var undervejs, da hun trykkede, maa ikke aabne den igen.
        setSvar({ tilstand: r.grund })
        setAaben(false)
      })
      .catch(() => { if (levende.current && gaelder(nr)) setStartfejl(true) })
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
      {/* `annonce.slags` staar her, fordi «ingen Bofinda-beskeder paa en
          ekstern annonce» er et PRODUKTKRAV fra opgaven — ikke en
          adgangsregel. Adgangen afgoeres stadig kun af `svar`. */}
      <Samtaleafsnit
        aaben={aaben && svar?.tilstand === 'adgang' && annonce.slags === 'native'}
        port={beskedport}
        loginHref={loginHref}
        abonnementHref={abonnementHref}
      />
    </div>
  )
}
