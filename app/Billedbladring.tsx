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

/**
 * De to tekster om LISTEN — ikke om det viste billede.
 *
 * `BILLEDE_FEJLEDE` ovenfor handler om ét billede, der ikke kunne
 * tegnes. De her handler om hentningen af de øvrige. Forskellen er
 * ikke ordkløveri: det ene felt viser sin reserve, det andet tilbyder
 * at prøve igen.
 *
 * `LISTEN_FEJLEDE` siges TO steder — i den synlige besked og i det,
 * hjælpemidlet får at vide — og to afskrifter ville drive fra hinanden.
 * `PROEVER_IGEN` siges kun ét sted: den synlige tekst skifter ikke
 * under et genforsøg. Den er en konstant, fordi `npm test` sammenligner
 * live-området MOD den i stedet for at skrive teksten af.
 */
export const LISTEN_FEJLEDE = 'Billederne kunne ikke hentes'
export const PROEVER_IGEN = 'Prøver igen …'

export interface Bladrebillede {
  /** 400 px — den, kortet viser. */
  lille: string
  /** 800 px, eller null når værten har bedt om mindre. Se BREDDER_PR_VAERT. */
  stor: string | null
}

/**
 * Hvem beder om listen?
 *
 *   'forhaand'  fokus eller en berøring. Det er en HENSIGT om at kunne
 *               bladre, ikke en handling — og efter en fejlet hentning
 *               gør den derfor ingenting. Ellers ville et tryk med
 *               fingeren eller et tabstop hen til «Prøv igen» starte
 *               genforsøget, før brugeren havde bedt om det, og knappen
 *               ville forsvinde under hende.
 *   'handling'  et pileklik, et svirp eller «Prøv igen». Et menneske
 *               har bedt om det, og så prøves der igen — også efter en
 *               fejl. Det er den ENESTE vej tilbage fra fejltilstanden.
 *
 * Skellet er ikke kosmetisk: det er forskellen på en gentagelse, som
 * brugeren har valgt, og en, der sker af sig selv.
 */
type Anledning = 'forhaand' | 'handling'

/** Så lang en vandret bevægelse skal der til, før det er et svirp. */
const SVIRP = 40
/** Under så mange px er retningen ikke afgjort endnu. */
const RETNING = 8
/** Hvor længe efter et svirp et klik stadig regnes som en del af det. */
const EFTERSVIRP = 500
/**
 * Hvor længe en hentning må være undervejs, før den regnes som fejlet.
 *
 * ═══ HVORFOR DER SKAL VÆRE EN GRÆNSE ═══
 *
 * Uden den er der ét udfald, der hverken bliver til et svar eller til en
 * fejl: forbindelsen tages imod, og der kommer aldrig noget. `.catch`
 * fyrer ikke, `.finally` fyrer ikke, og `igang` bliver stående — så
 * «Prøv igen» står med fokus og `aria-busy`, og hvert eneste tryk bliver
 * slugt af samtidighedsvagten. Det er nøjagtig den knap, der ikke
 * virker, som hele forløbet her findes for at fjerne; den var bare
 * usynlig før, fordi beskeden blev ryddet med det samme.
 *
 * Grænsen er ikke en gentagelse. Den gør et hængende kald til en
 * almindelig fejl, brugeren selv kan svare på.
 *
 * ═══ PRISEN, SAGT HØJT ═══
 *
 * Den rammer HVER hentning, også den første på et kort, hvor intet er
 * gået galt. Et svar, der er længere undervejs end grænsen, kasseres —
 * og så står der «Billederne kunne ikke hentes» om en hentning, der
 * ville være lykkedes et øjeblik senere.
 *
 * Tallet er et skøn, ikke en måling af produktionen. Det, der ER målt,
 * er ruten selv: 7-31 ms på loopback med den isolerede testbase. Tyve
 * sekunder er tre størrelsesordener over det, så et svar, der er
 * længere undervejs, er i praksis ikke på vej. Og byttet går den rigtige
 * vej: en for tidlig fejl er en tilstand med en synlig vej ud, mens et
 * hængende kald ikke er nogen tilstand overhovedet.
 */
const HENTEFRIST = 20_000

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
  /** Kunne LISTEN over de øvrige billeder ikke hentes? Så vises en
   *  diskret besked med en vej til at prøve igen — se `Bladrepile`. */
  hentefejl: boolean
  henter: boolean
  gaa: (retning: number) => void
  /** Kaldes KUN af et menneske. Der er ingen automatisk gentagelse. */
  proevIgen: () => void
  /**
   * De to refs, fokusoverdragelsen har brug for. De sættes af
   * `Bladrepile`, og hooken læser dem — se `foerBeskedenForsvinder`.
   * Hooken skal eje flytningen, fordi den er den eneste, der ved, om
   * hentningen lykkedes, OG hvor meget der forsvinder; komponenten ville
   * først opdage det, når knappen allerede var væk og fokus faldet til
   * <body>.
   */
  fokus: {
    /** «Prøv igen»-knappen. */
    knap: React.RefObject<HTMLButtonElement | null>
    /** Næste-pilen: dét, brugeren bad om, og dér fokus normalt føres hen. */
    naeste: React.RefObject<HTMLButtonElement | null>
  }
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

/**
 * Kortets egen indgang: det første link på kortet, som ikke er skjult
 * for skærmlæseren.
 *
 * Bruges, når fokusmålet selv er på vej ud. Svarer ruten, at der ikke er
 * mere at bladre i, forsvinder beskeden, begge pile og tælleren på én
 * gang, og næste-pilen — det normale mål — er væk sammen med resten.
 * Fokus skal et sted hen, der bliver stående. Den er også reserven, hvis
 * pile-ref'en mod forventning ikke er sat.
 *
 * Den SØGES i DOM'en frem for at være skrevet af på hver flade. Søgekortet
 * og et gemt kort har hver sin indgang (`a.kort` og `a.adresse`), og to
 * afskrifter af «hvad hedder kortets indgang her» ville drive fra hinanden
 * første gang en flade fik et led mere. To ting springes over:
 *
 *   `aria-hidden`  fotolinket på Gemte boliger er skjult for skærmlæseren
 *                  MED VILJE — adressen i kroppen er den rigtige indgang.
 *                  At føre fokus derind ville sætte oplæsningen i et
 *                  undertræ, den har fået at vide ikke findes.
 *   `tabindex<0`   samme link, set fra tastaturet.
 *
 * ═══ KUN LINKS — ALDRIG EN KNAP ═══
 *
 * Fokus flyttes midt i et forløb, hvor brugeren lige har trykket. Et
 * gentaget eller fastholdt Enter rammer så det, fokus landede på. Et
 * link fører til kortets egen bolig — det sted, kortet handler om, og
 * altid noget, hun kan gå tilbage fra. En knap på et kort er derimod
 * «Fjern» eller hjertet, og et Enter dér gør noget, hun ikke har bedt
 * om, og som ikke er til at fortryde med Tilbage. Findes der intet
 * link, flyttes der ikke: hellere lade browseren om fokus end trykke
 * på noget for hende.
 */
function kortetsEgenKontrol(fra: HTMLElement): HTMLElement | null {
  const kort = fra.closest('.kort-hylster, .gemt-kort')
  if (!kort) return null
  for (const k of kort.querySelectorAll<HTMLElement>('a[href]')) {
    if (k.tabIndex < 0) continue
    if (k.closest('[aria-hidden="true"]')) continue
    return k
  }
  return null
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
  // To samtidige kald må ikke blive til to hentninger. `useRef` og ikke
  // `useState`: to hurtige svirp skal ikke kunne udløse to kald, og en
  // tilstand, der først er sat efter næste tegning, er for langsom til
  // det. Vagten er UÆNDRET af rettelsen nedenfor.
  const igang = useRef<Promise<Bladrebillede[] | null> | null>(null)

  // ═══ TO GRUNDE TIL AT DER IKKE KOM EN LISTE ═══
  //
  // De så ens ud og blev behandlet ens — ét `opgivet`-flag, der lukkede
  // kortet for resten af dets levetid, mens pile og tæller blev stående
  // og lovede billeder, ingen kunne nå. Det er samme fejlform som en
  // knap, der ikke virker: værre end ingen knap, fordi den bruges.
  //
  // De er ikke det samme spørgsmål:
  //
  //   `hentefejl`   netværket eller ruten svarede ikke. Det kan gå væk
  //                 igen, og brugeren skal have det at vide OG en vej
  //                 til at prøve igen. Aldrig af sig selv — en
  //                 gentagelsesløkke mod en rute, der siger nej, er
  //                 præcis dét, det gamle flag var sat for at undgå.
  //
  //   `ingenFlere`  ruten SVAREDE, og der er ikke mere at bladre i.
  //                 Antallet fra SQL var forældet. Så er det rigtige
  //                 ikke en fejlbesked, men at pilene og tælleren
  //                 holder op med at love noget.
  const [hentefejl, setHentefejl] = useState(false)
  const [ingenFlere, setIngenFlere] = useState(false)
  // Har hun FAKTISK bladret? Naboerne hentes først da. Hover er en
  // hensigt om at kunne bladre, ikke en bladring — og to fulde billeder
  // pr. kort, man stryger musen hen over, er præcis det, kravet om
  // «efter behov» handler om.
  const [harBladret, setHarBladret] = useState(false)
  const svirpet = useRef(0)
  const roer = useRef<{ x: number; y: number; laast: null | 'x' | 'y' } | null>(null)
  const billedref = useRef<HTMLImageElement | null>(null)
  const fokusknap = useRef<HTMLButtonElement | null>(null)
  const fokusnaeste = useRef<HTMLButtonElement | null>(null)

  // `ingenFlere` er rutens svar og vinder over SQL-tallet: kortet må
  // ikke blive ved med at tilbyde en bladring, der ikke fører nogen
  // steder hen.
  const kanBladre = Boolean(forside) && antal > 1 && !ingenFlere

  /**
   * Fokus må ikke falde til <body>, når «Prøv igen» forsvinder.
   *
   * Kaldes SYNKRONT i det øjeblik, hentningen er lykkedes, og FØR
   * tilstanden, der fjerner knappen, sættes. Rækkefølgen er hele
   * pointen: mens knappen stadig står i DOM'en, kan vi både aflæse, om
   * den har fokus, og flytte det et sted hen. Gjorde vi det bagefter —
   * i en effekt — ville browseren allerede have flyttet fokus til
   * <body>, og «havde knappen fokus?» kunne ikke længere besvares.
   *
   * Der flyttes KUN, hvis knappen faktisk har fokus. Er brugeren gået
   * videre af sig selv, er et fokusspring et overgreb: hun ville miste
   * det sted, hun selv har valgt, fordi et svar tilfældigvis landede.
   */
  const foerBeskedenForsvinder = useCallback((altForsvinder: boolean) => {
    const anker = fokusknap.current ?? fokusnaeste.current
    const aktiv = document.activeElement
    if (!anker || !aktiv) return
    // ═══ HVAD ER DET, DER FORSVINDER? ═══
    //
    // Ved et tomt svar ryger HELE feltet: beskeden, begge pile og
    // tælleren, for `ingenFlere` slukker `kanBladre`. Ellers er det kun
    // beskeden og dens knap.
    //
    // Spørgsmålet er det samme begge gange — står fokus i noget, der om
    // et øjeblik ikke findes? — men «noget» er ikke det samme, og de to
    // svar udledes derfor af det SAMME `altForsvinder`. Spurgte vi kun
    // efter knappen, ville en bruger, der havde tabbet videre til en
    // pil, blive efterladt på <body>, når pilen forsvandt under hende.
    // Og det kan ske UDEN en fejl overhovedet: et pileklik på et kort
    // med et forældet SQL-antal er nok.
    const paaVej = altForsvinder ? anker.closest('.bladrepile') : fokusknap.current
    // Er hun gået ud af det, der forsvinder, flyttes der ikke. Det sted,
    // hun selv har valgt, er hendes.
    //
    // Der spørges IKKE om `:focus-visible`. Et museklik giver også
    // knappen fokus, og lod vi den gruppe falde igennem, ville fokus
    // ende på <body>, så det næste Tab startede forfra i dokumentet.
    // Hun har i forvejen mistet rulningen med Mellemrum i det øjeblik,
    // hun klikkede på knappen; at lade fokus blive i kortet tager intet
    // fra hende og giver tastaturet tilbage, hvis hun skifter.
    if (!paaVej || !paaVej.contains(aktiv)) return
    // Normalt bliver pilene stående, og næste-pilen fører videre i det,
    // hun var i gang med. Forsvinder feltet, må målet være noget, der
    // bliver stående — kortets egen indgang. Den er OGSÅ reserven, hvis
    // pile-ref'en mod forventning ikke er sat: en fokusflytning, der
    // stille ikke sker, er præcis den fejl, det hele handler om.
    const maal = (altForsvinder ? null : fokusnaeste.current) ?? kortetsEgenKontrol(anker)
    maal?.focus()
  }, [])

  const hent = useCallback((anledning: Anledning): Promise<Bladrebillede[] | null> => {
    if (liste) return Promise.resolve(liste)
    if (!kanBladre) return Promise.resolve(null)
    // ── EFTER EN FEJL PRØVER KUN ET MENNESKE IGEN ──────────────
    // Fokus og berøring er en hensigt, ikke en handling. Uden den her
    // linje ville et tabstop hen til «Prøv igen» — knappen ligger inde i
    // billedfladen på Gemte boliger, og `focusin` bobler — starte
    // genforsøget, FØR brugeren havde aktiveret noget. Og et fingertryk
    // på billedet ville gøre det samme. Begge dele er den automatiske
    // gentagelse, vi netop har fjernet, bare udløst af noget andet.
    if (hentefejl && anledning !== 'handling') return Promise.resolve(null)
    // Samtidighedsvagten. Den er der stadig: et svirp og et pileklik i
    // samme øjeblik deler den samme ene hentning, og to hurtige tryk på
    // «Prøv igen» bliver til ét kald.
    if (igang.current) return igang.current
    setHenter(true)
    const afbryd = new AbortController()
    const frist = setTimeout(() => afbryd.abort(), HENTEFRIST)
    igang.current = fetch(`/api/boligbilleder?b=${encodeURIComponent(boligId)}`,
      { signal: afbryd.signal })
      // Et svar, der ikke er 2xx, er en fejl — ikke et tomt resultat.
      // `null` herfra ville ikke være til at skelne fra «boligen har
      // ingen flere billeder», og de to skal ikke se ens ud.
      .then((r) => { if (!r.ok) throw new Error(`rute svarede ${r.status}`); return r.json() })
      .then((d: { billeder?: Bladrebillede[] } | null) => {
        const b = d?.billeder
        if (!Array.isArray(b)) throw new Error('uventet svar')
        const tomtSvar = b.length < 2
        // BESKEDEN RYDDES FØRST HER — ikke ved hentningens start.
        // Ryddede vi den, når kaldet gik af sted, ville «Prøv igen»
        // blive fjernet i samme øjeblik, brugeren aktiverede den, og
        // fokus faldt til <body> midt i hendes egen handling. Knappen
        // står derfor hele vejen og siger `aria-busy` imens.
        foerBeskedenForsvinder(tomtSvar)
        setHentefejl(false)
        // Ruten svarede, og der er intet eller ét billede. Ikke en fejl:
        // tælleren og pilene holder op med at love mere.
        if (tomtSvar) { setIngenFlere(true); return null }
        setListe(b)
        return b
      })
      // Endnu en fejl — også den, `HENTEFRIST` udløser: beskeden og
      // knappen bliver stående, og fokus er urørt, så et nyt tryk på
      // Enter eller Mellemrum prøver igen.
      .catch(() => { setHentefejl(true); return null })
      .finally(() => { clearTimeout(frist); setHenter(false); igang.current = null })
    return igang.current
  }, [boligId, foerBeskedenForsvinder, hentefejl, kanBladre, liste])

  /**
   * Prøv igen — KUN når et menneske beder om det.
   *
   * Der er ingen gentagelsesløkke, og ingen timer kalder hentningen.
   * Knappen i fejlbeskeden kalder den her, og et pileklik gør det
   * samme — og et svirp gennem `gaa()`: alle tre er
   * en handling, brugeren har foretaget. `igang`-vagten gør, at to
   * hurtige tryk stadig kun bliver til ét kald.
   */
  const proevIgen = useCallback(() => { void hent('handling') }, [hent])

  const gaa = useCallback((retning: number) => {
    if (!kanBladre) return
    // Et pileklik og et svirp ER en bladringshandling: de prøver igen
    // efter en fejl, præcis som «Prøv igen».
    void hent('handling').then((b) => {
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
    hentefejl,
    henter,
    gaa,
    proevIgen,
    fokus: { knap: fokusknap, naeste: fokusnaeste },
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
      onFocus: () => { void hent('forhaand') },
      onTouchStart: (e) => {
        const t = e.touches[0]
        if (!t) return
        roer.current = { x: t.clientX, y: t.clientY, laast: null }
        void hent('forhaand')
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
      {/* ── NÅR LISTEN IKKE KUNNE HENTES ──────────────────────
          Diskret, og med en vej ud. Før stod pilene og tælleren og lovede
          otte billeder, mens hvert tryk stille gjorde ingenting for
          resten af kortets levetid — en knap, der ikke virker, er værre
          end ingen knap.
          Knappen prøver igen ÉN gang pr. tryk, og intet prøver igen af
          sig selv. Filens ene timer er `HENTEFRIST`, og den henter
          ikke — den afbryder.

          ═══ KNAPPEN BLIVER STÅENDE, MENS DER HENTES ═══

          Beskeden ryddes først, når svaret er der — se `hent()`. Den
          knap, brugeren lige har trykket på, må ikke forsvinde under
          hende: det ville smide fokus til <body> midt i hendes egen
          handling, og et nyt Enter ville ramme ingenting. Står den,
          virker både Enter og Mellemrum igen, hvis forsøget fejler.

          Den SYNLIGE tekst skifter ikke, og knappens navn gør heller
          ikke: et navn, der laver sig om under fingeren på den, der
          læser med, er værre end intet. At der sker noget, siges to
          andre steder — `aria-busy` på knappen og live-området
          nedenfor. */}
      {/* ── HJÆLPEMIDLETS EGEN KANAL ──────────────────────────
          Live-området står ALTID — også når der intet er at sige.
          Grunden er, at et område, der indsættes sammen med sin tekst,
          typisk ikke bliver annonceret: det skal findes, før indholdet
          ændrer sig. Og fordi teksten skifter ved hvert skridt —
          «Prøver igen …» og tilbage til beskeden — bliver også ANDEN
          fejl annonceret. Sattes `role="status"` derimod på den synlige
          besked, ville den være uændret ved hvert nyt forsøg, og et
          uændret live-område siger ingenting.

          Det ligger heller ikke omkring knappen længere. `role="status"`
          er implicit `aria-atomic`, så et skift i knappens `aria-busy`
          fik hele beskeden OG knappens navn læst op igen — midt i den
          handling, brugeren var i gang med.

          Teksterne er de samme konstanter, som den synlige besked
          bruger. Ét udtryk, to kanaler. */}
      <span className="skjult-for-oejet" role="status">
        {b.hentefejl ? (b.henter ? PROEVER_IGEN : LISTEN_FEJLEDE) : ''}
      </span>
      {b.hentefejl && (
        <p className="bladrefejl">
          <span>{LISTEN_FEJLEDE}</span>
          <button type="button" className="bladreigen" ref={b.fokus.knap}
            onClick={b.proevIgen} aria-busy={b.henter || undefined}
            aria-label={`Prøv igen at hente billeder af ${etiket}`}>
            Prøv igen
          </button>
        </p>
      )}
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
      <button type="button" className="bladrepil bladrepil-naeste" ref={b.fokus.naeste}
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
