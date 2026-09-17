'use client'

// ═══════════════════════════════════════════════════════════════
//  Billedbladring på et boligkort.
//
//  ÉT sted svarer på: hvilket billede står vi på, hvor kommer de
//  øvrige fra, hvad betyder en swipe, og hvornår må et klik åbne
//  annoncen. De tre flader — forsiden/søgeresultatet, gruppekortet og
//  Gemte boliger — tegner hver sit felt, men de spørger her.
//
//  ═══ HVORFOR IKKE ÉN KOMPONENT, DER TEGNER HELE FELTET ═══
//
//  Fordi felterne ikke er ens, og forskellene er reelle. Søgekortet har
//  intet billedfelt overhovedet, når der ikke er en forside — klassen
//  `uden-billede` fjerner gitterets billedkolonne. Gemte boliger har
//  ALTID feltet og skriver «Intet billede» i det. En komponent, der
//  skulle kunne begge dele, ville bære en betingelse for hver flade og
//  være svær at læse for begge. Delt er det, der ER det samme:
//  tilstanden, hentningen, svirpet og pilene.
//
//  ═══ ADRESSERNE KOMMER FRA SERVEREN ═══
//
//  `billedUrl()` signerer med en hemmelighed, browseren ikke har. Kortet
//  får forsiden med i HTML'en som før; resten hentes fra
//  /api/boligbilleder, FØRSTE gang nogen viser, at hun vil bladre.
//  Derfor downloades der ikke ét billede mere ved sideindlæsning, end
//  der gjorde før — og det er dét, kravet handler om.
// ═══════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * De to tekster, en tom billedflade kan bære — og de siger ikke det
 * samme. Kilden har ingen billeder, vi kan vise, ELLER den har, og vi
 * nåede dem ikke lige nu. Samme skel som el-forbeholdets «indgår ikke»
 * og «vi ved ikke hvad der er i tallet». Ét sted, fordi begge flader
 * skriver dem, og to afskrifter ville drive fra hinanden.
 */
export const INTET_BILLEDE = 'Intet billede'
export const BILLEDE_FEJLEDE = 'Billedet kunne ikke hentes'

export interface Bladrebillede {
  /** 400 px — den, kortet viser. */
  lille: string
  /** 800 px, eller null når værten har bedt om mindre. Se BREDDER_PR_VAERT. */
  stor: string | null
}

/** Så lang en vandret bevægelse skal der til, før det er et svirp. */
const SVIRP = 40
/** Under så mange px er retningen ikke afgjort endnu. */
const RETNING = 8
/** Hvor længe efter et svirp et klik stadig regnes som en del af det. */
const EFTERSVIRP = 500

export interface Bladring {
  /** 0-baseret indeks på det viste billede. */
  nr: number
  /** Hvor mange der kan bladres til. Før hentningen: kortets eget tal. */
  antal: number
  /** «2/8». Tom streng når der kun er ét billede. */
  taeller: string
  src: string
  srcSet: string | undefined
  /** Kunne det viste billede ikke hentes? Så skal fladen vise sin reserve. */
  fejlet: boolean
  henter: boolean
  gaa: (retning: number) => void
  /** Sættes på billedfladen: forhåndshentning og swipe. */
  flade: {
    onFocus: () => void
    onTouchStart: (e: React.TouchEvent) => void
    onTouchMove: (e: React.TouchEvent) => void
    onTouchEnd: (e: React.TouchEvent) => void
  }
  /** Sættes på LINKET om billedet, så et svirp ikke åbner annoncen. */
  linkvagt: { onClickCapture: (e: React.MouseEvent) => void }
  /** Sættes på billedet — ref'en hører med, se noten ved eftersynet. */
  billedvagt: {
    ref: React.RefObject<HTMLImageElement | null>
    onError: () => void
    onLoad: () => void
  }
}

export function useBladring({ boligId, forside, forsideSrcSet, sizes, antal }: {
  boligId: string
  /** Forsidens signerede adresse. null = der er intet at vise. */
  forside: string | null
  forsideSrcSet?: string
  /** Kortets `sizes`. Bruges til at forhåndshente DEN SAMME variant,
   *  browseren selv ville vælge — se noten ved forhåndshentningen. */
  sizes?: string
  /** Antal VISBARE billeder, talt i SQL med samme filter som forsiden. */
  antal: number
}): Bladring {
  const [nr, setNr] = useState(0)
  const [liste, setListe] = useState<Bladrebillede[] | null>(null)
  const [henter, setHenter] = useState(false)
  const [fejlede, setFejlede] = useState<ReadonlySet<number>>(() => new Set())
  // Hentningen må kun ske én gang pr. kort. `useRef` og ikke `useState`:
  // to hurtige svirp skal ikke kunne udløse to kald, og en tilstand, der
  // først er sat efter næste tegning, er for langsom til det.
  const igang = useRef<Promise<Bladrebillede[] | null> | null>(null)
  // Slog hentningen fejl, prøves den ikke igen. Uden det fyrede hvert
  // eneste hover, hvert svirp og hvert pileklik et nyt kald mod en rute,
  // der lige har sagt nej — og tælleren blev ved med at love billeder,
  // der ikke kunne nås.
  const opgivet = useRef(false)
  // Har hun FAKTISK bladret? Naboerne hentes først da. Hover er en
  // hensigt om at kunne bladre, ikke en bladring — og to fulde billeder
  // pr. kort, man stryger musen hen over, er præcis det, kravet om
  // «efter behov» handler om.
  const [harBladret, setHarBladret] = useState(false)
  const svirpet = useRef(0)
  const roer = useRef<{ x: number; y: number; laast: null | 'x' | 'y' } | null>(null)
  const billedref = useRef<HTMLImageElement | null>(null)

  const kanBladre = Boolean(forside) && antal > 1

  const hent = useCallback((): Promise<Bladrebillede[] | null> => {
    if (liste) return Promise.resolve(liste)
    if (!kanBladre || opgivet.current) return Promise.resolve(null)
    if (igang.current) return igang.current
    setHenter(true)
    igang.current = fetch(`/api/boligbilleder?b=${encodeURIComponent(boligId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { billeder?: Bladrebillede[] } | null) => {
        const b = d?.billeder
        if (!Array.isArray(b) || b.length < 2) { opgivet.current = true; return null }
        setListe(b)
        return b
      })
      // Netværket kan fejle. Forsiden står der stadig, og kortet er
      // stadig et link til boligen — vi siger det ikke højt, fordi det
      // ikke er en oplysning om boligen.
      .catch(() => { opgivet.current = true; return null })
      .finally(() => { setHenter(false); igang.current = null })
    return igang.current
  }, [boligId, kanBladre, liste])

  const gaa = useCallback((retning: number) => {
    if (!kanBladre) return
    void hent().then((b) => {
      const i = b?.length ?? 0
      if (i < 2) return
      setHarBladret(true)
      setNr((n) => (((n + retning) % i) + i) % i)
    })
  }, [hent, kanBladre])

  // Naboerne hentes på forhånd, så bladring ikke blinker. FØRST når der
  // er bladret — det er hele forskellen på «efter behov» og «ved
  // indlæsning».
  useEffect(() => {
    if (!harBladret || !liste || liste.length < 2) return
    for (const n of [nr + 1, nr - 1]) {
      const b = liste[((n % liste.length) + liste.length) % liste.length]
      if (!b) continue
      const i = new Image()
      // SAMME VARIANT SOM DEN, DER SKAL VISES.
      // Hentede vi bare `lille`, ville browseren alligevel bede om 800
      // ved visningen på en bred skærm — og så var forhentningen et
      // ekstra kald, der ikke sparede noget. Målt: fire hentninger for
      // en bolig med tre billeder, hvoraf den ene var forsiden igen i
      // en anden bredde. `srcset` og `sizes` SKAL sættes før `src`,
      // ellers er kandidaterne ikke valgt endnu.
      if (b.stor && sizes) {
        i.sizes = sizes
        i.srcset = `${b.lille} 400w, ${b.stor} 800w`
      }
      i.src = b.lille
    }
  }, [nr, liste, harBladret, sizes])

  // ── EFTERSYN VED MONTERING OG VED HVERT SKIFT ────────────────
  //
  // `onError` alene er ikke nok. Siden gengives på serveren, browseren
  // henter billedet med det samme, og hentningen kan være fejlet, FØR
  // React har hydreret og sat sin lytter på — så fyrer `onError` aldrig,
  // og feltet står tilbage med Chromes eget brudt-billede-ikon. Det blev
  // målt på Gemte boliger og rettet der; her bor svaret ét sted for
  // begge flader.
  //
  // `complete` er true også for en FEJLET hentning; det er
  // `naturalWidth === 0`, der skiller de to.
  useEffect(() => {
    const i = billedref.current
    if (!i || !i.complete || i.naturalWidth !== 0) return
    setFejlede((s) => (s.has(nr) ? s : new Set(s).add(nr)))
  }, [nr])

  const vist = liste?.[nr]
  // Forsiden er altid billede 0 og står i HTML'en. Er listen hentet,
  // bruges dens adresse for at undgå to udtryk for det samme billede.
  const src = vist?.lille ?? forside ?? ''
  const srcSet = vist
    ? (vist.stor ? `${vist.lille} 400w, ${vist.stor} 800w` : undefined)
    : forsideSrcSet

  const stop = useCallback((e: React.TouchEvent) => {
    const r = roer.current
    roer.current = null
    if (!r || r.laast !== 'x') return
    const t = e.changedTouches[0]
    if (!t) return
    const dx = t.clientX - r.x
    if (Math.abs(dx) < SVIRP) return
    // Tidsstemplet er det, `linkvagt` læser. Uden det ville svirpet både
    // skifte billede OG åbne annoncen på de browsere, der stadig sender
    // et klik efter en vandret bevægelse.
    svirpet.current = Date.now()
    gaa(dx < 0 ? 1 : -1)
  }, [gaa])

  return {
    nr,
    antal: liste?.length ?? antal,
    taeller: kanBladre ? `${nr + 1}/${liste?.length ?? antal}` : '',
    src,
    srcSet,
    fejlet: fejlede.has(nr),
    henter,
    gaa,
    flade: {
      // INGEN FORHENTNING PÅ HOVER.
      // Den var der, og den kostede mere, end den gav: at stryge musen
      // hen over en søgeside med 48 kort ville udløse 48 kald, og selv
      // et enkelt klik på samtykkebanneret efterlod markøren over et
      // kort og hentede en liste, ingen havde bedt om — målt i
      // `bladrekontrol.mjs`, hvor 2A blev rød af netop dét. Fokus og
      // berøring er derimod en hensigt, en bruger har udtrykt, og de
      // gælder ét kort ad gangen. Prisen er, at det FØRSTE pileklik på
      // et kort venter på ét kald; `gaa()` venter på det, og på
      // loopback er det ikke til at måle.
      onFocus: () => { void hent() },
      onTouchStart: (e) => {
        const t = e.touches[0]
        if (!t) return
        roer.current = { x: t.clientX, y: t.clientY, laast: null }
        void hent()
      },
      onTouchMove: (e) => {
        const r = roer.current
        const t = e.touches[0]
        if (!r || !t) return
        const dx = t.clientX - r.x
        const dy = t.clientY - r.y
        // RETNINGEN LÅSES ÉN GANG, og lodret vinder ved uafgjort.
        // `touch-action: pan-y` på fladen gør, at browseren beholder den
        // lodrette rulning uanset hvad vi gør her — der kaldes ALDRIG
        // preventDefault, for så ville en skrå bevægelse kunne låse
        // siden fast. Rulningen er brugerens, bladringen er vores.
        if (r.laast == null && (Math.abs(dx) > RETNING || Math.abs(dy) > RETNING)) {
          r.laast = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
        }
      },
      onTouchEnd: stop,
    },
    linkvagt: {
      onClickCapture: (e) => {
        if (Date.now() - svirpet.current < EFTERSVIRP) {
          e.preventDefault()
          e.stopPropagation()
        }
      },
    },
    billedvagt: {
      ref: billedref,
      onError: () => setFejlede((s) => (s.has(nr) ? s : new Set(s).add(nr))),
      // Et billede, der kom igennem efter et genforsøg, skal ikke blive
      // ved med at være «fejlet».
      onLoad: () => setFejlede((s) => {
        if (!s.has(nr)) return s
        const n = new Set(s); n.delete(nr); return n
      }),
    },
  }
}

/**
 * De to pile.
 *
 * ═══ DE LIGGER ALDRIG INDE I KORTETS LINK ═══
 *
 * En `<button>` i et `<a>` er ugyldig HTML, og browserne håndterer det
 * forskelligt — nogle aktiverer linket alligevel. Det er den samme grund,
 * favoritknappen ligger som søskende til linket, og
 * `scripts/cloud/kortkontrol.mjs` afviser hvert eneste fokuserbart
 * element inde i `a.kort`. Kalderen SKAL placere dem uden for linket;
 * komponenten her kan ikke håndhæve det, så prøven gør det.
 *
 * Etiketten navngiver boligen. Fireoghalvtreds pile på en søgeside, der
 * alle hedder «Næste billede», er lige så ubrugelige for en skærmlæser
 * som ingen etiket.
 */
export function Bladrepile({ b, etiket }: { b: Bladring; etiket: string }) {
  if (!b.taeller) return null
  return (
    <div className="bladrepile" aria-hidden={false}>
      {/* IKKE `disabled` MENS DER HENTES.
          En knap, der slår sig selv fra midt i et tastetryk, mister
          fokus til <body> — og så er tastaturbrugeren smidt ud af
          kortet, netop fordi hun brugte knappen. `aria-busy` siger det
          samme uden at flytte nogen. Klikket er i forvejen harmløst:
          `gaa()` venter på den samme ene hentning. */}
      <button type="button" className="bladrepil bladrepil-foer"
        onClick={() => b.gaa(-1)} aria-busy={b.henter || undefined}
        aria-label={`Forrige billede af ${etiket}`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 5 8 12l7 7" />
        </svg>
      </button>
      <button type="button" className="bladrepil bladrepil-naeste"
        onClick={() => b.gaa(1)} aria-busy={b.henter || undefined}
        aria-label={`Næste billede af ${etiket}`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m9 5 7 7-7 7" />
        </svg>
      </button>
    </div>
  )
}
