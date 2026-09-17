'use client'

// ═══════════════════════════════════════════════════════════════
//  Kortet ved siden af listen.
//
//  Fliserne kommer fra OpenStreetMaps egen tjeneste. Den er
//  donationsdrevet, og deres Tile Usage Policy stiller krav, som er
//  bygget ind her:
//
//    · Præcis URL'en https://tile.openstreetmap.org/{z}/{x}/{y}.png
//    · Synlig kreditering, aldrig skjult bag en knap
//    · Kun fliserne til det, brugeren ser nu — ingen forhentning,
//      ingen offline, ingen scanning af områder
//    · Ingen restriktiv Referrer-Policy (vi sætter ingen)
//    · "Report a map issue"-link, som de anbefaler
//
//  URL'en er IKKE hardkodet. Politikkens afsnit 7 siger, at adgang kan
//  trækkes uden varsel, og at kommercielle tjenester særligt skal regne
//  med det. Bofinda er en kommerciel tjeneste. Derfor kan flisekilden
//  skiftes med en miljøvariabel i stedet for en kodeændring.
//
//  Kortet indlæses først, når det er synligt: Leaflet hentes i en
//  dynamisk import fra en IntersectionObserver. Rammer man aldrig
//  kortet, betaler man ikke for det.
//
//  ═══ TASTATURET ═══════════════════════════════════════════════
//
//  Leaflet gør hvert mærke fokuserbart — `keyboard: true` sætter
//  `tabIndex = 0` og `role="button"` — men binder KUN Enter gennem en
//  popup (`Layer.Popup` lytter på `keypress`). Vi binder ingen popup, og
//  derfor skete der ingenting på Enter. Målt på 44 mærker: et museklik
//  fremhævede boligen i listen og rullede den frem; Enter gjorde intet,
//  og Mellemrum rullede bare siden. 44 stop i tabulatorrækkefølgen, som
//  ikke kunne aktiveres, er værre end ingen stop: de koster tid og giver
//  ingenting.
//
//  Tre ting er derfor lavet om, og de hænger sammen:
//
//  1. `keyboard: false` på mærket. Leaflet holder fingrene fra tabIndex
//     og role, og vi sætter dem selv. Ét sted bestemmer, ikke to.
//
//  2. ÉN indgang i tabulatorrækkefølgen for hele gruppen (roving
//     tabindex): ét mærke har `tabIndex = 0`, resten −1, og piletasterne
//     flytter mellem dem. Det er ARIA-mønstret for en samling ens ting,
//     og det er dét, der gør, at kortet kan forlades uden at gennemløbe
//     hvert eneste mærke. Springlinket ovenover er den anden vej ud —
//     to veje, fordi piletast-navigation er noget, man skal vide.
//
//  3. Navnet er `aria-label`, og tallet i boblen er `aria-hidden`.
//     Ellers vinder indholdet over `title`, og gruppemærkets navn bliver
//     «3». Nu hedder det «Udlejergaarden 3 — 3 boliger. Vis dem i
//     listen.»
//
//  ═══ HVORFOR MÆRKERNE IKKE TEGNES OM VED ET VALG ══════════════
//
//  `tegn()` kørte før på hver ændring af `valgt`, altså ved hvert klik.
//  Den rydder laget og bygger hvert mærke forfra — så det element, der
//  netop var fokuseret, blev revet ud af dokumentet, og fokus faldt til
//  <body>. Valget er nu en KLASSE, der slås til og fra på de mærker, der
//  allerede står der, og `tegn()` afhænger kun af `maerker`. Skifter
//  listen alligevel, huskes det fokuserede mærkes id og gives fokus
//  igen bagefter.
// ═══════════════════════════════════════════════════════════════

import 'leaflet/dist/leaflet.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { meld } from './Maaling'
import type { Map as LeafletMap, LayerGroup } from 'leaflet'

export interface Maerke {
  id: string
  lat: number
  lng: number
  /** Antal boliger bag mærket. 1 for et enkeltkort. */
  antal: number
  etiket: string
}

const FLISER = process.env.NEXT_PUBLIC_FLISE_URL
  ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const KREDIT = process.env.NEXT_PUBLIC_FLISE_KREDIT
  ?? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bidragydere'
  + ' &middot; <a href="https://www.openstreetmap.org/fixthemap">Meld en fejl i kortet</a>'

/** Id paa den skjulte linje, der siger, hvad maerkerne kan. */
const HJAELP_ID = 'kort-tastaturhjaelp'

/**
 * Mærkets tilgængelige navn: adressen, eller vejen og antallet for en
 * gruppe. Ikke andet.
 *
 * Foerste udgave skrev «… Vis boligen i listen.» med i navnet, og det
 * var et loefte, der ikke holdt to steder: paa boligsiden er der ingen
 * liste at vise noget i, og paa resultatsiden under 900 px er listen
 * `display: none`, naar kortet er fremme. Et navn maa ikke love noget,
 * layoutet kan tage tilbage.
 *
 * Hvad et tryk GOER, staar ét sted i stedet for 44: i hjaelpelinjen,
 * som maerkerne peger paa med `aria-describedby`, og som kun er der,
 * naar der er en liste at pege paa.
 */
function navnFor(mk: Maerke): string {
  return mk.etiket
}

/**
 * `etiket` er kortets tilgaengelige navn. Den er en prop og ikke en fast
 * streng, fordi komponenten bruges to steder: ved siden af resultatlisten,
 * hvor den viser mange boliger, og paa boligdetaljen, hvor den viser én.
 * «Kort over boligerne» ville vaere forkert det ene af stederne.
 *
 * `springTil` er id'et paa det, der kommer EFTER kortet. Er den sat,
 * staar der et springlink foer kortet. Paa boligsiden er der ét maerke,
 * og saa er linket stoej — derfor en prop og ikke en fast del.
 */
export function Landkort({
  maerker, etiket = 'Kort over boligerne', springTil, pegerTilListe = false,
}: {
  maerker: Maerke[]
  etiket?: string
  springTil?: string
  /**
   * Staar der en liste ved siden af, som et maerke kan pege paa?
   *
   * Paa resultatsiden: ja. Paa boligsiden: nej — dér er kortet en
   * visning af ÉN adresse, og der er intet at rulle hen til. Var
   * maerket en knap ogsaa dér, ville det vaere praecis den fejl, hele
   * denne aendring handler om: et tabulatorstop med `role="button"`,
   * hvor Enter ikke goer noget. Uden listen er maerket derfor ikke
   * interaktivt — det staar paa kortet og siger, hvor boligen er.
   */
  pegerTilListe?: boolean
}) {
  const boks = useRef<HTMLDivElement>(null)
  const kort = useRef<LeafletMap | null>(null)
  const lag = useRef<LayerGroup | null>(null)
  const [synlig, setSynlig] = useState(false)
  /** Kortet er bygget og laget er der. Se noten ved tegne-effekten. */
  const [klar, setKlar] = useState(false)
  /**
   * Er der en liste at pege paa LIGE NU?
   *
   * `pegerTilListe` siger, om SIDEN har en liste. Det er ikke det samme
   * som, om den er fremme: under 900 px er listen og kortet hinandens
   * alternativer, og med kortet valgt er `.listeomraade` `display: none`.
   * Boligkortene staar i markuppen, men de tegnes ikke — og et element,
   * der ikke tegnes, kan hverken faa fokus eller rulles hen til.
   *
   * Maalt paa den rigtige ting, ikke paa en bredde: `checkVisibility()`
   * paa et boligkort. En medieforespoergsel skrevet af i JavaScript ville
   * vaere det samme svar to steder, og de to ville drive fra hinanden
   * foerste gang nogen rettede i CSS'en.
   */
  const [listeFremme, setListeFremme] = useState(false)
  /** `tegn()` og lytterne kaldes uden for renderen og ser ikke `useState`. */
  const listeRef = useRef(false)
  listeRef.current = listeFremme
  const [valgt, setValgt] = useState<string | null>(null)
  /** id → mærkets DOM-element. Bruges til klasse, tabIndex og fokus. */
  const elementer = useRef(new Map<string, HTMLElement>())
  /** `tegn()` kaldes fra en effekt og ser derfor ikke den seneste render. */
  const valgtRef = useRef<string | null>(null)
  valgtRef.current = valgt

  // ── Indlæs først når kortet er i syne ────────────────────────
  //
  // To målinger, ikke én. IntersectionObserver er den rigtige og fanger
  // ogsaa de tilfaelde, hvor kortet bliver synligt UDEN at nogen ruller —
  // en blok ovenfor der klapper sammen, en resize, en indlejret visning.
  // Men en indlaesning, der stille lader vaere med at ske, er den vaerste
  // slags fejl, saa maalingen paa afstand ligger ved siden af som net.
  useEffect(() => {
    if (synlig) return
    const naer = () => {
      const el = boks.current
      if (!el) return false
      const r = el.getBoundingClientRect()
      // 200 px foer kanten, saa kortet naar at staa klar.
      return r.top < window.innerHeight + 200 && r.bottom > -200
    }
    if (naer()) { setSynlig(true); return }

    const se = () => { if (naer()) setSynlig(true) }
    window.addEventListener('scroll', se, { passive: true })
    window.addEventListener('resize', se, { passive: true })

    let obs: IntersectionObserver | undefined
    if (typeof IntersectionObserver === 'function' && boks.current) {
      obs = new IntersectionObserver((e) => {
        if (e.some((x) => x.isIntersecting)) setSynlig(true)
      }, { rootMargin: '200px' })
      obs.observe(boks.current)
    }
    return () => {
      window.removeEventListener('scroll', se)
      window.removeEventListener('resize', se)
      obs?.disconnect()
    }
  }, [synlig])

  /** Klik paa et maerke fremhaever kortet i listen og ruller det frem. */
  const vaelg = useCallback((id: string) => {
    setValgt(id)
    const el = document.getElementById(`kort-${id}`)
    if (!el) return null
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('fremhaevet')
    window.setTimeout(() => el.classList.remove('fremhaevet'), 2200)
    return el
  }, [])

  /**
   * Samme handling som et museklik. `flytFokus` er forskellen mellem de
   * to veje ind, og den er med vilje: en musebruger PEGER allerede paa
   * boligen, hun har fremhaevet. Gav vi hende ikke fokus, ville hun
   * skulle tabulere gennem hele listen for at naa det kort, kortet lige
   * rullede frem — handlingen ville vaere synlig og alligevel uden for
   * raekkevidde. Fokus flyttes uden at rulle (`preventScroll`), saa den
   * bloede rulning fra `vaelg` ikke bliver afbrudt af et spring.
   */
  const aktiver = useCallback((id: string, flytFokus: boolean) => {
    meld('map_interaction', { slags: 'maerke_klik' })
    const kortet = vaelg(id)
    if (flytFokus) kortet?.focus({ preventScroll: true })
  }, [vaelg])

  // ── Byg kortet ───────────────────────────────────────────────
  useEffect(() => {
    if (!synlig || !boks.current || kort.current) return
    let doed = false
    ;(async () => {
      const L = (await import('leaflet')).default
      if (doed || !boks.current) return
      // Zoomknapperne bygges selv, fordi Leaflets standardtitler er
      // engelske — og titlen ER knappens navn: `_createButton` saetter
      // baade `title` og `aria-label` af den. «Zoom in» paa en ellers
      // dansk flade er ikke en oversaettelse, der mangler; det er et
      // navn, der er paa et andet sprog end resten.
      const m = L.map(boks.current, {
        scrollWheelZoom: false, attributionControl: true, zoomControl: false,
      })
      L.control.zoom({ zoomInTitle: 'Zoom ind', zoomOutTitle: 'Zoom ud' }).addTo(m)
      L.tileLayer(FLISER, { attribution: KREDIT, maxZoom: 18 }).addTo(m)
      kort.current = m
      // Kortinteraktion kan serveren ikke se. Strubet til ét event pr.
      // slags pr. sidevisning: et pan er mange hændelser i traek, og et
      // event pr. musebevaegelse ville drukne alt andet i tabellen.
      m.on('zoomend', () => meld('map_interaction', { slags: 'zoom' }))
      m.on('moveend', () => meld('map_interaction', { slags: 'pan' }))
      lag.current = L.layerGroup().addTo(m)
      // IKKE `tegn()` her.
      //
      // Bygge-effekten fanger den `tegn`, der fandtes, da `synlig` blev
      // sand, og den lukker om `maerker` fra netop den render. Mellem da
      // og nu er der et `await import('leaflet')` — en chunk paa ~40 kB.
      // Skifter listen i det vindue, koerer tegne-effekten nedenfor, men
      // falder ud paa `!kort.current`, fordi kortet ikke er bygget endnu
      // — og bagefter ville vi tegne det GAMLE saet uden nogen senere
      // udloeser. `klar` er den udloeser: tegne-effekten koerer, naar
      // kortet er der, med det saet, der gaelder DA.
      setKlar(true)
    })()
    return () => { doed = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [synlig])

  // ── Tegn mærkerne, og igen når LISTEN skifter ────────────────
  //
  // `valgt` staar bevidst IKKE her: et valg maa ikke rive mærkerne ned
  // og bygge dem op igen under fingrene paa den, der lige har fokuseret
  // et af dem.
  useEffect(() => {
    if (!klar || !kort.current || !lag.current) return
    ;(async () => {
      const L = (await import('leaflet')).default
      tegn(L, kort.current!, lag.current!)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maerker, klar])

  // ── Er listen fremme? Maalt nu, og igen naar bredden skifter ──
  //
  //  Skiftet mellem mobil- og desktopbredde er en rigtig vej: man
  //  drejer telefonen, aabner en delt skaerm, eller zoomer. Maerkerne
  //  skal skifte med — fra knapper til noget, man kan laese, og tilbage
  //  igen. Uden lytteren ville en bruger, der drejede telefonen, sidde
  //  med 44 knapper, der ikke kunne goere noget.
  useEffect(() => {
    if (!pegerTilListe) { setListeFremme(false); return }
    const maal = () => setListeFremme(
      [...document.querySelectorAll('a.kort[data-bolig]')].some((e) => e.checkVisibility()),
    )
    maal()
    window.addEventListener('resize', maal, { passive: true })
    return () => window.removeEventListener('resize', maal)
  }, [pegerTilListe, maerker, klar])

  // ── Knap eller oplysning — sat paa de maerker, der allerede staar ──
  //
  //  Attributterne skiftes paa de elementer, der er der; der tegnes
  //  ingenting om. Ellers ville en resize rive det fokuserede maerke ud
  //  af dokumentet.
  useEffect(() => {
    const liste = [...elementer.current.values()]
    if (!liste.length) return
    for (const el of liste) saetRolle(el, listeFremme)
    if (listeFremme && !liste.some((el) => el.tabIndex === 0)) {
      // Ét sted ind i gruppen. Uden den her ville hele kortet vaere ude
      // af tabulatorraekkefoelgen efter et skift tilbage til desktop.
      liste[0]!.tabIndex = 0
    }
  }, [listeFremme, maerker, klar])

  // ── Valget er en klasse, ikke en gentegning ──────────────────
  useEffect(() => {
    for (const [id, el] of elementer.current) {
      el.querySelector('.maerke-boble')?.classList.toggle('valgt', id === valgt)
    }
  }, [valgt])

  /**
   * Knap eller oplysning.
   *
   * MED en liste er maerket en knap: `role="button"`, ét stop i
   * tabulatorraekkefoelgen for hele gruppen, og en beskrivelse af
   * piletasterne.
   *
   * UDEN en liste kan et tryk ikke goere noget — og saa maa det hverken
   * fremstaa som en knap eller ligge i tabulatorraekkefoelgen. Men
   * oplysningen skal blive: `role="img"` med det samme `aria-label`
   * goer maerket til noget, der kan LAESES — «Prøvevej 1 — 5 boliger» —
   * i stedet for noget, der lover en handling, der ikke findes.
   * `title` staar uroert, saa musen ogsaa faar den.
   */
  function saetRolle(el: HTMLElement, interaktiv: boolean) {
    if (interaktiv) {
      el.setAttribute('role', 'button')
      el.setAttribute('aria-describedby', HJAELP_ID)
      if (el.tabIndex !== 0) el.tabIndex = -1
    } else {
      el.setAttribute('role', 'img')
      el.removeAttribute('aria-describedby')
      el.removeAttribute('tabindex')
    }
  }

  /** Flytter roving-tabindex og fokus til mærke nr. `j` (med ombrydning). */
  function flytTil(j: number) {
    const liste = [...elementer.current.values()]
    if (!liste.length) return
    const n = ((j % liste.length) + liste.length) % liste.length
    for (const el of liste) el.tabIndex = -1
    const maal = liste[n]!
    maal.tabIndex = 0
    maal.focus({ preventScroll: true })
  }

  function tegn(
    L: typeof import('leaflet'),
    m: LeafletMap,
    g: LayerGroup,
  ) {
    // Hvilket mærke havde fokus? Efter en gentegning findes elementet
    // ikke mere, og uden det her falder fokus til <body>.
    const havdeFokus = (document.activeElement as HTMLElement | null)?.dataset?.maerke ?? null
    g.clearLayers()
    elementer.current.clear()
    if (!maerker.length) { m.setView([56.0, 10.5], 6); return }
    maerker.forEach((mk, i) => {
      const eralgt = valgtRef.current === mk.id
      const ikon = L.divIcon({
        className: 'maerke-ikon',
        // `aria-hidden` paa tallet: uden den bliver indholdet elementets
        // navn, og saa hedder gruppemaerket «3» i stedet for adressen.
        html: `<span class="maerke-boble${eralgt ? ' valgt' : ''}" aria-hidden="true">`
          + `${mk.antal > 1 ? mk.antal : ''}</span>`,
        iconSize: [mk.antal > 1 ? 30 : 18, mk.antal > 1 ? 30 : 18],
      })
      L.marker([mk.lat, mk.lng], {
        // `title` er den samme streng som `aria-label`, og den KOMMER fra
        // samme funktion. Foer stod der `mk.etiket` her og `navnFor(mk)`
        // nedenfor: to udtryk for ét spoergsmaal — «hvad hedder det her
        // maerke» — og en rettelse i det ene ville ikke folge med i det
        // andet. At musens tooltip ogsaa siger, hvad et tryk goer, er
        // ingen ulempe.
        icon: ikon, title: navnFor(mk), keyboard: false,
      })
        // Museklikket er UAENDRET, ogsaa uden en synlig liste. `vaelg`
        // finder saa ingen synlig raekke at rulle hen til, praecis som
        // foer — men markeringen paa kortet og maalingen af klikket er
        // den samme. Det er tastaturet og rollen, der skulle rettes,
        // ikke hvad musen goer.
        .on('click', () => aktiver(mk.id, false))
        // `add` og ikke `getElement()` lige efter `addTo`.
        //
        // `Map.addLayer` venter paa `whenReady`, og kortet er IKKE klart,
        // foer det har faaet et udsnit — og udsnittet saettes af
        // `fitBounds` NEDENFOR, altsaa efter loekken. Indtil da findes
        // `_icon` ikke, og `getElement()` svarer null. Foerste udgave
        // kaldte den her og faldt igennem paa hvert eneste maerke: intet
        // `aria-label`, intet `data-maerke`, ingen tastaturlytter. Alt
        // saa rigtigt ud i koden og gjorde ingenting i browseren.
        //
        // `add` fyrer, naar elementet FAKTISK er der — ved `fitBounds`
        // foerste gang, med det samme hver gang derefter.
        .on('add', (e) => {
          const el = (e.target as import('leaflet').Marker).getElement()
          if (!el) return
          el.setAttribute('aria-label', navnFor(mk))
          el.dataset.maerke = mk.id
          saetRolle(el, listeRef.current)
          elementer.current.set(mk.id, el)
          // Uden en liste er maerket ikke en knap — men lytteren bliver
          // siddende. Bredden kan skifte, mens maerket staar der, og en
          // lytter, der skulle saettes paa igen ved hver resize, ville
          // vaere en vej til at glemme den. Den spoerger i stedet paa
          // tilstanden, hver gang der trykkes.
          el.addEventListener('keydown', (t: KeyboardEvent) => {
            if (!listeRef.current) return
            if (t.key === 'Enter' || t.key === ' ' || t.key === 'Spacebar') {
              // Mellemrum ruller siden, hvis vi ikke stopper den. En knap,
              // der ruller i stedet for at virke, er ikke en knap.
              t.preventDefault()
              aktiver(mk.id, true)
            } else if (t.key === 'ArrowRight' || t.key === 'ArrowDown') {
              t.preventDefault(); flytTil(i + 1)
            } else if (t.key === 'ArrowLeft' || t.key === 'ArrowUp') {
              t.preventDefault(); flytTil(i - 1)
            } else if (t.key === 'Home') {
              t.preventDefault(); flytTil(0)
            } else if (t.key === 'End') {
              t.preventDefault(); flytTil(maerker.length - 1)
            }
          })
        })
        .addTo(g)
    })
    const b = L.latLngBounds(maerker.map((x) => [x.lat, x.lng] as [number, number]))
    m.fitBounds(b, { padding: [28, 28], maxZoom: 15 })

    // EFTER `fitBounds`: foerst dér er elementerne bygget (se noten om
    // `add` ovenfor). Én indgang i tabulatorraekkefoelgen — det maerke,
    // der havde fokus, ellers det foerste.
    //
    // `havdeFokus` er kun sat, hvis fokus FAKTISK stod paa et maerke. Er
    // den boligs maerke ikke med i det nye saet — hun bladrede til naeste
    // side, mens hun stod i kortet — faar det foerste maerke fokus i
    // stedet. Ellers ville fokus falde til <body>, altsaa til toppen af
    // dokumentet, og hun skulle tabulere hele siden igennem igen. Er
    // fokus ikke i kortet, roeres det ikke.
    // Kun naar maerkerne ER knapper. Uden en liste ligger de ikke i
    // tabulatorraekkefoelgen, og en indgang til en gruppe, der ikke kan
    // aktiveres, er praecis det stop, hele aendringen fjerner.
    if (listeRef.current) {
      const tilbage = havdeFokus ? elementer.current.get(havdeFokus) : undefined
      const indgang = tilbage ?? elementer.current.values().next().value
      if (indgang) {
        indgang.tabIndex = 0
        if (havdeFokus) indgang.focus({ preventScroll: true })
      }
    }
  }

  // ── Den anden vej: listen fremhaever maerket ─────────────────
  useEffect(() => {
    const paa = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-bolig]')
      if (el) setValgt(el.getAttribute('data-bolig'))
    }
    const liste = document.querySelector('.liste')
    liste?.addEventListener('mouseover', paa)
    liste?.addEventListener('focusin', paa)
    return () => {
      liste?.removeEventListener('mouseover', paa)
      liste?.removeEventListener('focusin', paa)
    }
  }, [])

  return (
    <>
      {/* Springlinket staar FOER kortet og er synligt, naar det har
          fokus. Roving-tabindex goer allerede mærkerne til ét stop, men
          piletast-navigation er noget, man skal vide — linket er den vej
          ud, der ikke kraever, at man ved noget. */}
      {springTil && (
        <a className="springkort" href={`#${springTil}`}>Spring kortet over</a>
      )}
      <div ref={boks} className="landkort-flade" aria-label={etiket} />
      {/* ── Hvad maerkerne kan, og hvordan man naar dem ──────────
          Roving-tabindex goer hele gruppen til ÉT tabulatorstop. Det er
          maalet — 44 stop, der ikke kunne aktiveres, var vaerre end
          ingen — men det flytter ogsaa et problem: de 43 andre maerker
          kan kun naas med piletasterne, og det er ikke noget, man
          gaetter. Linjen staar derfor to steder paa én gang: den er
          maerkernes `aria-describedby`, saa en skaermlaeser faar den med
          maerket, og den bliver SYNLIG, saa snart fokus er i kortet, saa
          en seende tastaturbruger uden skaermlaeser ogsaa faar den.
          Ét sted, to veje ud — ikke to tekster. */}
      {listeFremme && (
        <p className="korthjaelp" id={HJAELP_ID}>
          Brug piletasterne til at skifte mellem mærkerne.
          Tryk for at fremhæve boligen i listen.
        </p>
      )}
    </>
  )
}
