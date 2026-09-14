import {
  facilitetsgrundlag, filtreFraParametre, harFiltre, oekonomigrundlag,
  tavseKilder,
  availabilityGrundlag, opsummering, soegGrupperet,
  type Soegeparametre,
} from '../lib/soeg'
import { headers } from 'next/headers'
import { facetterCached, forsidetalCached } from './cache'
import { GemSoegning } from './GemSoegning'
import { Visningskort, kr } from './Boligkort'
import { Landkort, type Maerke } from './Landkort'
import { Hastighedspunkt } from './Hastighed'
import { Maaling } from './Maaling'
import { maalingstilstand, spor } from '../lib/maaling-server'
import { antalFiltre, filterDiff, forrigeFiltre, uddrag } from '../lib/maalingsoeg'
import {
  SORTERINGSNAVN, SORTERINGSVALG, aktiveFiltre, sammenfatFlere,
  soegeUrlSorteret, soegeUrlUden,
} from '../lib/filterpanel'
import { Sider, sideUrl } from './Sider'

export const dynamic = 'force-dynamic'

/**
 * Forsidens standardfoto.
 *
 * FILEN LIGGER I REPOET — `public/hero-stue.jpg` — og foelger dermed
 * koden. Det er en bevidst aendring fra foer, hvor fotoet kun kunne
 * saettes med `NEXT_PUBLIC_HERO_FOTO`: en miljoevariabel, der SKAL
 * saettes, er en variabel, nogen glemmer, og saa staar forsiden med en
 * gradient i produktionen, uden at nogen kan se hvorfor. Nu virker den
 * uden ny opsaetning nogen steder.
 *
 * Krediteringen staar HER, sammen med stien, af samme grund som
 * `eltilstand` ligger ét sted: billedet og navnet paa den, der har taget
 * det, er ét spoergsmaal. Skifter stien, skal navnet med i samme
 * aendring — ellers tilskriver siden en fotograf et billede, hun ikke
 * har taget.
 *
 *   Foto:    Taryn Elliott / Pexels
 *   Kilde:   https://www.pexels.com/photo/scandinavian-interior-of-a-living-room-9565782/
 *   Licens:  https://www.pexels.com/license/ — fri til kommerciel brug,
 *            kreditering ikke paakraevet, men vi giver den alligevel.
 *   Fil:     2048x1365, 636.485 bytes, uaendrede bytes fra kilden.
 *            sha256 a2b2795193c96f2508593dc1dca77f62ea986a10dd2600cef331e64e245d5b5f
 *
 * Se ogsaa `docs/kildetilladelser.md`, hvor rettighederne pr. kilde
 * staar samlet.
 */
const HERO_STANDARD = {
  url: '/hero-stue.jpg',
  kredit: 'Stemningsfoto: Taryn Elliott / Pexels',
} as const

/** "A", "A og B", "A, B og C" — dansk opremsning, ikke join(', '). */
const sammenskriv = (n: string[]): string =>
  n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} og ${n[n.length - 1]}`

// ─── Siden ─────────────────────────────────────────────────────

/** Kilderne gemmer typen uden danske bogstaver. */
const TYPENAVN: Record<string, string> = {
  lejlighed: 'Lejlighed', hus: 'Hus', raekkehus: 'Rækkehus',
  vaerelse: 'Værelse', studiebolig: 'Studiebolig', andet: 'Anden bolig',
}

/**
 * Til- og fravalg af kortet, som et almindeligt link.
 *
 * Tilstanden ligger i URL'en ligesom alt andet: den kan deles, den
 * overlever et genindlæs, og listen er allerede bred på serveren — så den
 * hopper ikke i bredden, når siden er færdig.
 */
function kortLink(sp: Soegeparametre, visesNu: boolean): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (v == null || k === 'kort') continue
    for (const x of Array.isArray(v) ? v : [v]) q.append(k, x)
  }
  if (visesNu) q.set('kort', '0')
  const s = q.toString()
  return s ? `/?${s}` : '/'
}

/** Første værdi af en URL-parameter — til formularens defaultValue. */
const en = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : v

/** Kort pr. side. Ét sted, saa udsnittet, sideantallet og analytics'
 *  `position` ikke kan regne med hver sit tal. */
const PR_SIDE = 48

/**
 * `?side=N` — navigation, ikke et filter.
 *
 * STRENG. Kun et positivt heltal uden foranstillet nul, hoejst fire
 * cifre; alt andet er side 1. `heltal()` i lib/soeg.ts ville acceptere
 * «2,5» som 2 og «-3» som -3, og en navigationsparameter skal afvises
 * rent, ikke fortolkes velvilligt. Loftet paa 9999 er der, saa
 * `?side=1e9` hverken kan bede basen om et absurd offset eller faa
 * pageren til at regne paa Infinity.
 *
 * Parameteren naar ALDRIG `filtreFraParametre`, og dermed hverken
 * `Filtre`, `harFiltre`, `filterDiff`, `hvor()` eller en gemt
 * boligalarms kriterier. `/?side=2` alene er stadig forsiden.
 */
function sidetal(v: string | string[] | undefined): number {
  const s = Array.isArray(v) ? v[0] : v
  return s != null && /^[1-9][0-9]{0,3}$/.test(s) ? Number(s) : 1
}

/**
 * Kampagneparametre til målingen.
 *
 * KANONISERES, ikke bare afkortes. utm-felter er fri tekst i URL'en, og
 * en kampagne med et navn i kunne ellers sende en mailadresse ind i et
 * event. Kun små bogstaver, tal, bindestreg og underscore slipper
 * igennem; alt andet droppes helt. Værnet i lib/maaling.ts ville afvise
 * resten, men koden skal ikke læne sig på det.
 */
function kampagne(sp: Soegeparametre): Record<string, string> {
  const ud: Record<string, string> = {}
  for (const n of ['utm_source', 'utm_medium', 'utm_campaign'] as const) {
    const v = en(sp[n])?.toLowerCase().slice(0, 40)
    if (v && /^[a-z0-9][a-z0-9_-]*$/.test(v)) ud[n] = v
  }
  return ud
}

/** Kun VÆRTEN fra en referrer. Hele URL'en kan bære en søgestreng. */
function referrerVaert(referer: string | null, egen: string | undefined): string | undefined {
  if (!referer) return undefined
  try {
    const h = new URL(referer).hostname.toLowerCase()
    if (egen && new URL(egen).hostname.toLowerCase() === h) return undefined
    return /^[a-z0-9.-]{1,60}$/.test(h) ? h : undefined
  } catch { return undefined }
}

export default async function Side({ searchParams }: { searchParams: Promise<Soegeparametre> }) {
  const sp = await searchParams
  // Samme parsing som gem-formularen bruger. Se noten i lib/soeg.ts.
  const f = filtreFraParametre(sp)
  const kilderValgt = f.kilder

  // Har hun soegt? Uden filtre er det forsiden, med filtre er det
  // resultatsiden. Samme rute, to tilstande.
  const soegt = harFiltre(f)
  // Listen viser KORT, ikke boliger: ens boliger paa samme vej til samme
  // pris staar som ét. Grupperingen er kun en visning — alarmen matcher
  // stadig paa de enkelte boliger gennem hvor().
  //
  // Efter hinanden, ikke i Promise.all. Webappen har ÉN forbindelse i
  // puljen (transaction-pooleren, se db/client.ts), og fire samtidige
  // kæder bliver til pipelinede sætninger paa den ene forbindelse. Det
  // holdt lige akkurat, indtil facetter fik en forespørgsel mere — saa
  // hang hver eneste listeside i minutter. Samlet tager de otte
  // forespørgsler under et sekund i raekke.
  //
  // De to sidste er cachede (se app/cache.ts) og rammer sjældent basen.
  // Tilbage er to forespørgsler pr. sidevisning mod otte før.
  // ReferenceNow: ét eksplicit nu pr. request, brugt af BAADE soegning,
  // kort og grundlag — saa alle laeser samme klokke.
  const nu = new Date()
  // Tre forskellige tal, og de maa ikke bruges som ét:
  //  · `sum.antal`            matchende BOLIGER
  //  · `kortIAlt`             matchende KORT efter gruppering
  //  · `visninger.length`     kort i det viste udsnit
  //  · `antalBoliger(...)`    boliger daekket af det viste udsnit
  // `nu` gives til dem alle, saa domaenefiltrene laeser samme klokke.
  const side = sidetal(sp.side)
  const { visninger, kortIAlt, komplet } = await soegGrupperet(f, PR_SIDE, nu, side)
  // Sideantallet er udledt af KORT, ikke af boliger. Er gennemgangen
  // afbrudt, er det et mindstetal — pageren skriver det, og analytics
  // faar slet ikke tallet.
  const sider = Math.max(1, Math.ceil(kortIAlt / PR_SIDE))
  // Et gyldigt, men for hoejt sidetal. Ikke «ingen boliger matcher» —
  // det er en paastand om soegningen, og den er falsk her. Og ingen tavs
  // clamping: adressen skal betyde det, den siger.
  const forHoej = side > sider && kortIAlt > 0
  const avGrundlag = await availabilityGrundlag(f, nu)
  const sum = await opsummering(f, nu)
  // Grundlaget under afkrydsningerne skal beskrive søgningen UDEN de tre
  // facilitetsfiltre. Er ingen af dem sat, er det ordret samme forespørgsel
  // som `sum` — og så koster tallene ingenting. Er en sat, er det én
  // forespørgsel mere (~75 ms), og det er netop dér, hun har brug for at se,
  // hvad filteret skjuler.
  const facFiltre = f.kaeledyr || f.elevator || f.udeplads
  const grundlag = facFiltre ? await facilitetsgrundlag(f, nu) : sum
  // Kun naar hun faktisk har krydset af. Uden et filter er linjen en
  // advarsel mod noget, hun ikke har gjort.
  const tavse = facFiltre ? await tavseKilder(f) : { navne: [], antal: 0 }
  // Samme kneb: er filteret ikke sat, er det ordret samme forespørgsel som
  // `sum`, og så koster grundlagslinjen ingenting.
  const oek = f.fuldOekonomi ? await oekonomigrundlag(f, nu) : sum
  const fac = await facetterCached()
  const tal = await forsidetalCached()
  // To variabler, to spoergsmaal. `sted` er hvad der skal staa i feltet,
  // saa en NY indsendelse betyder det samme som nu; `stedNavn` er hvor hun
  // soeger. De falder fra hinanden i én sti, og det er en rigtig sti:
  // feltet `sted` ligger uden for panelet og indsendes ALTID, ogsaa tomt,
  // saa efter en soegning fra panelets egne By-/Postnummer-felter er
  // `sp.sted` den tomme streng. `??` falder ikke igennem paa '', og det er
  // rigtigt for FELTET — stod byen der, ville naeste indsendelse sende
  // baade `sted` og `by`, og `stedet()` ville kassere den ene.
  // Men overskriften skal stadig kunne sige hvor. Foer stod der bare
  // «304 boliger», mens 1.226 var filtreret ned til 304 af en by, der kun
  // kunne ses inde i panelet. Med panelet lukket som udgangspunkt ville
  // filteret vaere helt usynligt.
  const sted = en(sp.sted) ?? f.postnr ?? f.by ?? ''
  const stedNavn = en(sp.sted)?.trim() || f.postnr || f.by || ''
  // Panelets tilstand ligger i URL'en som kortets. Se noten ved <details>.
  const panelAabent = en(sp.flere) === '1'

  // Hero-fotoet OG dets kreditering, beregnet ét sted.
  //
  // De to er ét spoergsmaal — «hvilket billede staar der, og hvem har
  // taget det» — og maa derfor ikke kunne svares forskelligt. Var de to
  // selvstaendige udtryk, kunne en miljoevariabel skifte MOTIVET, mens
  // krediteringen blev staaende paa det gamle; saa ville siden tilskrive
  // en fotograf et billede, hun ikke har taget. Derfor ét objekt.
  //
  // Standarden er `public/hero-stue.jpg`, som ligger i repoet og foelger
  // koden. Ingen miljoevariabel kraeves — hverken lokalt eller paa
  // Vercel. `NEXT_PUBLIC_HERO_FOTO` kan stadig overstyre den, og saa
  // foelger `NEXT_PUBLIC_HERO_FOTO_KREDIT` med som DEN fladeS kreditering.
  const hero = process.env.NEXT_PUBLIC_HERO_FOTO
    ? {
      url: process.env.NEXT_PUBLIC_HERO_FOTO,
      kredit: process.env.NEXT_PUBLIC_HERO_FOTO_KREDIT || null,
    }
    : { url: HERO_STANDARD.url, kredit: HERO_STANDARD.kredit }
  const heroFoto = hero.url
  const heroKredit = hero.kredit

  // De aktive filtre som noget, der kan ses OG fjernes. Navnene paa
  // typer og kilder kommer fra de samme kilder som feltet i panelet —
  // ikke fra en anden liste. Stedet er ikke med: det staar i feltet og i
  // overskriften over listen, jf. noten i lib/filterpanel.ts.
  const chips = aktiveFiltre(f, {
    type: (t) => TYPENAVN[t] ?? t,
    kilde: (k) => fac.kilder.find((x) => x.slug === k)?.navn ?? k,
  })
  // Slaas fra med ?kort=0. Tilstanden ligger i URL'en som alt andet paa
  // siden. Kun naar der er filtreret: uden en soegning spaender maerkerne
  // over hele landet, og udsnittet siger ingenting.
  const kortVises = soegt && en(sp.kort) !== '0'

  // ── Måling ───────────────────────────────────────────────────
  // Skellet mellem forside og søgning er `harFiltre()`, ikke pathname:
  // det er den SAMME rute. Og `search` deles i to gensidigt udelukkende
  // udfald, saa count(search) = count(search_results_view) +
  // count(empty_results) altid gaar op. Goer den ikke det, er
  // instrumenteringen i stykker — ikke markedet.
  //
  // `spor()` kaster ikke og skriver i after(), altsaa efter svaret. Uden
  // samtykke sker der ingenting overhovedet.
  const mt = await maalingstilstand()
  const visningId = crypto.randomUUID()
  // Byen gemmes KUN, hvis vi selv kender den. `fac` er hentet i forvejen,
  // saa opslaget koster ingen ekstra foresproergsel.
  const kenderBy = (by: string) => fac.byer.some((x) => x.by === by)
  const uddragKategorisk = uddrag(f, kenderBy)
  const filtreSat = antalFiltre(f)
  const hoveder = await headers()
  // Filterdiffen mod den forrige URL. Se noten om referer-faelden i
  // lib/maalingsoeg.ts: strengen forlader aldrig den funktion.
  const forrige = forrigeFiltre(
    hoveder.get('referer'), process.env.NEXT_PUBLIC_BASE_URL, filtreFraParametre,
  )

  if (soegt) {
    const vistePrKilde: Record<string, number> = {}
    for (const v of visninger) {
      const b = v.slags === 'gruppe' ? v.gruppe.repraesentant : v.bolig
      vistePrKilde[b.kilde] = (vistePrKilde[b.kilde] ?? 0) + 1
    }
    // Pagineringens tre valgfri felter, jf. docs/analytics-v1.md §7b.
    // `sider_i_alt` sendes KUN sammen med `komplet: true` — er
    // gennemgangen afbrudt, er «3 sider» ikke tre sider, det er «mindst
    // tre», og krydsfeltsreglen i rens() ville droppe feltet alligevel.
    // Vi sender det ikke og lader den regel vaere det andet vaern, ikke
    // det foerste.
    const sidemeta = {
      side,
      komplet,
      ...(komplet ? { sider_i_alt: sider } : {}),
    }
    await spor({
      navn: 'search',
      props: {
        ...uddragKategorisk,
        result_count: sum.antal,
        antal_filtre: filtreSat,
        sorter: f.sorter ?? 'nyeste',
        result_view_id: visningId,
        kort_vist: kortVises,
        ...sidemeta,
        ...kampagne(sp),
      },
    }, '/')
    if (sum.antal === 0) {
      // `sum.antal` er den EKSAKTE optaelling fra `opsummering()`, uden
      // loft og uafhaengig af hvilken side der bedes om. Et sidetal uden
      // for raekkevidde giver derfor ikke et `empty_results` — se
      // docs/analytics-v1.md.
      await spor({
        navn: 'empty_results',
        props: { ...uddragKategorisk, antal_filtre: filtreSat, ...sidemeta },
      }, '/')
    } else {
      await spor({
        navn: 'search_results_view',
        props: {
          ...uddragKategorisk,
          result_count: sum.antal,
          // Udsnittet, ikke bestanden: begge beskriver DENNE side.
          viste_antal: visninger.length,
          viste_pr_kilde: vistePrKilde,
          result_view_id: visningId,
          ...sidemeta,
        },
      }, '/')
    }
  } else {
    await spor({
      navn: 'homepage_view',
      props: {
        boliger_i_alt: tal.boliger,
        kilder_i_alt: tal.kilder,
        ...kampagne(sp),
        ...(() => {
          const v = referrerVaert(hoveder.get('referer'), process.env.NEXT_PUBLIC_BASE_URL)
          return v ? { referrer_vaert: v } : {}
        })(),
      },
    }, '/')
  }
  // Ogsaa paa forsiden: «Nulstil» gaar til `/` fra en filtreret URL, og
  // det ER en rydning. Uden linjen her ville nulstil-knappen aldrig kunne
  // maales.
  for (const e of filterDiff(forrige, f, kenderBy)) await spor(e, '/')

  // ── Kortet ───────────────────────────────────────────────────
  // Slaas fra med ?kort=0. Tilstanden ligger i URL'en som alt andet paa
  // siden: saa kan den deles, den overlever et genindlaes, og listen er
  // allerede bred paa serveren — den hopper ikke, naar siden er klar.
  // Kun naar der er filtreret. Uden en soegning spaender maerkerne over
  // hele landet, og udsnittet siger ingenting. Samme regel som gem-boksen
  // og prisnoten: paa forsiden er det svar paa et spoergsmaal, brugeren
  // ikke har stillet.
  // Ét maerke pr. KORT, ikke pr. bolig: en gruppe er ét maerke med sit
  // antal. Hoejst 48, fordi listen hoejst viser 48.
  const maerker: Maerke[] = []
  const udenPlacering: { navn: string; antal: number }[] = []
  for (const v of visninger) {
    const b = v.slags === 'gruppe' ? v.gruppe.repraesentant : v.bolig
    const antal = v.slags === 'gruppe' ? v.gruppe.antal : 1
    if (b.lat && b.lng) {
      maerker.push({
        id: b.id, lat: Number(b.lat), lng: Number(b.lng), antal,
        etiket: v.slags === 'gruppe' ? `${b.vej ?? b.adresse} — ${antal} boliger` : b.adresse,
      })
    } else {
      const k = udenPlacering.find((x) => x.navn === b.kildeNavn)
      if (k) k.antal += antal
      else udenPlacering.push({ navn: b.kildeNavn, antal })
    }
  }
  // Samme formular i begge tilstande — kun pladsen skifter. Paa forsiden
  // ligger den inde i hero-baandet, paa resultatsiden staar den alene
  // over listen.
  const formular = (
      <form className={soegt ? 'filtre soegt' : 'filtre'} method="get">
        {/* ── Den brede soegebjaelke ────────────────────────────
            Referencens hvide kort: fire felter med etiket over vaerdien,
            adskilt af lodrette streger, og en stor groen knap yderst.

            FELTERNE ER FLYTTET, IKKE DUPLIKERET. Pris, stoerrelse og
            vaerelser laa i <details>-panelet; de staar nu her og er
            fjernet derinde. To felter med samme `name` i samme formular
            ville sende vaerdien to gange, og `filtreFraParametre` laeser
            den foerste — altsaa ville panelets tomme felt slette det, man
            lige havde skrevet i bjaelken.

            Referencen viser ogsaa «Husdyr tilladt» og «Indflytning» her.
            De to bliver i panelet med vilje: begge baerer en
            grundlagslinje («N oplyser det · M oplyser ikke · K vises
            ikke»), og den linje er et krav, ikke pynt. Et felt uden sin
            linje ville se ud som et almindeligt filter og i stedet
            skjule hele kilder uden at sige det. */}
        <div className="soegebar">
          <div className="soegefelt sf-sted">
            <label htmlFor="sted">By eller område</label>
            <input
              id="sted" type="text" name="sted" defaultValue={sted}
              placeholder="F.eks. København" list="byer"
            />
          </div>
          <div className="soegefelt sf-pris">
            <label htmlFor="prisMin">Pris pr. måned</label>
            <div className="sf-par">
              <input
                id="prisMin" name="prisMin" defaultValue={en(sp.prisMin) ?? ''}
                inputMode="numeric" placeholder="Min" aria-label="Mindstepris pr. måned"
              />
              <span className="sf-til" aria-hidden="true">–</span>
              <input
                id="prisMax" name="prisMax" defaultValue={en(sp.prisMax) ?? ''}
                inputMode="numeric" placeholder="Max" aria-label="Højeste pris pr. måned"
              />
            </div>
          </div>
          <div className="soegefelt sf-areal">
            <label htmlFor="areal">Størrelse</label>
            <input
              id="areal" name="areal" defaultValue={en(sp.areal) ?? ''}
              inputMode="numeric" placeholder="m² mindst"
            />
          </div>
          <div className="soegefelt sf-vaer">
            <label htmlFor="vaerelser">Værelser</label>
            <input
              id="vaerelser" name="vaerelser" defaultValue={en(sp.vaerelser) ?? ''}
              inputMode="numeric" placeholder="mindst"
            />
          </div>
          <button className="soegeknap" type="submit">
            Søg boliger<span className="sk-pil" aria-hidden="true">→</span>
          </button>
        </div>

        {/* Referencens «Populaere soegninger». Byerne er IKKE skrevet
            ind: de er de mest udbredte i bestanden, som `facetter()`
            allerede har talt dem. Skifter udbuddet, skifter linjen. */}
        {!soegt && fac.byer.length > 0 && (
          <p className="populaere">
            <span className="pop-navn">Populære søgninger:</span>
            {fac.byer.filter((b) => b.by).slice(0, 6).map((b) => (
              <a key={`${b.by}-${b.postnr}`} href={`/?sted=${encodeURIComponent(b.by!)}`}>
                {b.by}
              </a>
            ))}
          </p>
        )}

        {/* ── Panelet aabner ALDRIG af sig selv ────────────────────
            Det stod foer `open={soegt}`, altsaa aabent paa hver eneste
            resultatside. Maalt: filterblokken 515 px paa 1120, 1.078 px
            paa 390 — og foerste boligkort 854 px henholdsvis 1.668 px
            nede. Paa en telefon var det to skaermfulde formular foer det
            foerste hjem. Resultaterne er produktet.

            Tilstanden ligger i URL'en som kortets, ikke i klient-state:
            saa kan den deles, den overlever et genindlaes, og back og
            frem goer det, man forventer. `flere` er et NYT navn; ingen
            eksisterende parameter roeres, og `filtreFraParametre` laeser
            kun navngivne felter, saa den kasseres ulaest af baade
            soegningen, `harFiltre` og `forrigeFiltre`.
            IKKE `filtre`: det navn er optaget af gem-formularens skjulte
            felt, som baerer hele filtersaettet som JSON.

            «Søg» nedenfor baerer `name="flere" value="1"`. En submit-knaps
            name/value sendes kun, naar netop den knap indsender — saa at
            soege fra det aabne panel holder det aabent, mens «Find bolig»
            oeverst lukker det ned paa resultaterne. Enter i et felt bruger
            formularens FOERSTE submit-knap, altsaa «Find bolig», og lukker
            derfor ogsaa panelet. Det er med vilje: Enter betyder «vis mig
            resultaterne».

            Et LUKKET <details> indsender stadig sine felter — det er ikke
            `disabled`, kun skjult — saa filtrene overlever, at panelet er
            foldet sammen. Efterproevet. */}
        <details className="flere" open={panelAabent}>
        {/* Det eneste synlige af panelet, naar det er lukket. Derfor skal
            det sige, hvad der er sat. Delene kommer fra lib/filterpanel.ts,
            saa tallet ikke kan drive fra analytics' `antal_filtre`. */}
        <summary>
          {sammenfatFlere(f)[0]}
          {sammenfatFlere(f).slice(1).map((d) => (
            /* Skilletegnet staar som RIGTIG tekst, ikke som ::before. En
               skaermlaeser laeser indholdet, og «Flere filtre3 aktive» er
               ikke en saetning. */
            <span key={d} className="flere-maerkat">
              <span className="flere-prik">{' · '}</span>{d}
            </span>
          ))}
        </summary>
        <div className="filtergitter">
        <div className="felt">
          <label htmlFor="by">By</label>
          <input id="by" name="by" defaultValue={f.by ?? ''} placeholder="fx København" list="byer" />
          <datalist id="byer">
            {fac.byer.map((b) => <option key={`${b.by}-${b.postnr}`} value={b.by ?? ''} />)}
          </datalist>
        </div>
        <div className="felt">
          <label htmlFor="postnr">Postnummer</label>
          <input id="postnr" name="postnr" defaultValue={f.postnr ?? ''} placeholder="fx 2300" inputMode="numeric" />
        </div>
        {/* Pris, stoerrelse og vaerelser staar i soegebjaelken ovenfor.
            De maa IKKE ogsaa staa her: samme `name` to gange i én
            formular sender vaerdien to gange. */}
        <div className="felt">
          <label htmlFor="kilde">Kilde</label>
          <select id="kilde" name="kilde" defaultValue={kilderValgt?.[0] ?? ''}>
            <option value="">alle</option>
            {fac.kilder.map((k) => (
              <option key={k.slug} value={k.slug}>{k.navn} ({k.antal})</option>
            ))}
          </select>
        </div>
        <div className="felt">
          <label htmlFor="sorter">Sortér</label>
          {/* Navnene kommer fra `SORTERINGSNAVN`, ikke fra denne fil.
              Sorteringen kan nu ogsaa skiftes i resultathovedet, og to
              haandskrevne lister ville foer eller siden sige hver sit om
              det samme valg. */}
          <select id="sorter" name="sorter" defaultValue={f.sorter}>
            {SORTERINGSVALG.map((v) => (
              <option key={v} value={v}>{SORTERINGSNAVN[v].lang}</option>
            ))}
          </select>
        </div>

        {/* Kun typer kilderne faktisk leverer. Skemaets enum har seks
            værdier; tre af dem findes i data. */}
        {fac.typer.length > 1 && (
          <div className="felt bred">
            <label>Boligtype</label>
            <div className="valgraekke">
              {fac.typer.map((t) => (
                <label key={t.type} className="valg">
                  <input
                    type="checkbox" name="type" value={t.type!}
                    defaultChecked={f.boligtyper?.includes(t.type!) ?? false}
                  />
                  {TYPENAVN[t.type!] ?? t.type} <span>{t.antal}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* ── Ét filtersystem ───────────────────────────────────
            Økonomi, availability og faciliteter stiller den samme slags
            spørgsmål — «vis kun dem, hvor vi VED det» — og gjorde det i
            tre forskellige former: fuldbredde-rækker, en række i en
            række, og almindelige felter. Fem fulde rækker til syv
            kontroller.

            Nu ét gitter med samme grammatik i hver celle: kontrollen
            øverst, grundlaget under. Grundlagsteksterne er UÆNDREDE —
            de er sat ned i vægt, ikke skåret ned. Se `.filtersystem`
            i globals.css. */}
        <div className="filtersystem">
        <h3 className="filtergruppe-titel">Økonomi</h3>
        <div className="filterpost">
          <span className="afkryds-linje">
            <input type="checkbox" id="fuld" name="fuld" value="1" defaultChecked={f.fuldOekonomi} />
            <label htmlFor="fuld">Fuld økonomi kendt</label>
          </span>
          {/* Tre grupper, og de går op med antallet. Filteret udelukker de
              to sidste, og så skal det stå, hvor mange det er. */}
          <span className="filtergrundlag">
            {oek.fuld.toLocaleString('da-DK')} oplyser varme, vand eller el hver for sig ·{' '}
            {(oek.medTotal - oek.fuld).toLocaleString('da-DK')} oplyser kun én samlet aconto ·{' '}
            {(oek.antal - oek.medTotal).toLocaleString('da-DK')} oplyser ingen total
          </span>
        </div>

        <h3 className="filtergruppe-titel">Overtagelse og tilgængelighed</h3>
        {/* ── Availability-filtrene ─────────────────────────────
            Drives af fortolkAvailability — aldrig af rå jsonb, legacy
            available_from eller application_type. Grundlaget gælder DEN
            AKTUELLE søgning, og de ukendte har ord: et filter viser kun
            dokumenterede træf, og så skal det stå, hvor mange der ikke
            kunne vurderes. */}
        <div className="filterpost">
          <span className="afkryds-linje">
            <label htmlFor="overtagelse">Overtagelse</label>
            <select id="overtagelse" name="overtagelse" defaultValue={f.overtagelse ?? ''}>
              <option value="">Alle</option>
              <option value="nu">Kan overtages nu</option>
              <option value="senere">Kan overtages senere</option>
            </select>
          </span>
          <span className="filtergrundlag">
            {avGrundlag.timing.nu.toLocaleString('da-DK')} har oplyst overtagelse nu ·{' '}
            {avGrundlag.timing.senere.toLocaleString('da-DK')} senere ·{' '}
            {(avGrundlag.timing.unknown + avGrundlag.timing.conflict).toLocaleString('da-DK')} uden
            afklaret tidspunkt — de vises ikke med filteret slået til
          </span>
        </div>
        <div className="filterpost">
          <span className="afkryds-linje">
            <input type="checkbox" id="venteliste" name="venteliste" value="1"
              defaultChecked={f.ansoegningsform === 'venteliste'} />
            <label htmlFor="venteliste">Venteliste</label>
          </span>
          <span className="filtergrundlag">
            {avGrundlag.ansoegning.venteliste.toLocaleString('da-DK')} venteliste ·{' '}
            {avGrundlag.ansoegning.normal.toLocaleString('da-DK')} almindelig ansøgning ·{' '}
            {avGrundlag.ansoegning.unknown.toLocaleString('da-DK')} uoplyst ansøgningsform
          </span>
        </div>
        <div className="filterpost">
          <span className="afkryds-linje">
            <input type="checkbox" id="reserveret" name="reserveret" value="1"
              defaultChecked={f.markedsstatus === 'reserveret'} />
            <label htmlFor="reserveret">Reserveret</label>
          </span>
          {/* Reserveret-grundlaget viser alle TRE grupper, så «vis
              reserverede» ikke læses som «resten er dokumenteret ledige»:
              de fleste har slet ingen markedsstatus fra kilden. */}
          <span className="filtergrundlag">
            {avGrundlag.marked.reserveret.toLocaleString('da-DK')} reserveret ·{' '}
            {avGrundlag.marked.paa_markedet.toLocaleString('da-DK')} på markedet ·{' '}
            {(avGrundlag.marked.unknown + avGrundlag.marked.udlejet + avGrundlag.marked.conflict).toLocaleString('da-DK')} uden
            oplyst markedsstatus
          </span>
        </div>

        {/* Vises kun, hvis nogen faktisk oplyser feltet. Et filter, der
            aldrig giver træf, er værre end intet filter. */}
        {(fac.faciliteter.kaeledyr > 0 || fac.faciliteter.elevator > 0
          || fac.faciliteter.udeplads > 0) && (
          <>
            <h3 className="filtergruppe-titel">Faciliteter</h3>
            {fac.faciliteter.kaeledyr > 0 && (
              <div className="filterpost">
                <span className="afkryds-linje">
                  <input type="checkbox" id="kaeledyr" name="kaeledyr" value="1" defaultChecked={f.kaeledyr} />
                  <label htmlFor="kaeledyr">Kæledyr tilladt</label>
                </span>
                {/* Filteret udelukker de ukendte — det er det eneste ærlige,
                    for vi ved ikke om de har det. Men så skal hun kunne se,
                    hvad hun ikke får. Tallene følger den aktuelle søgning. */}
                {/* Tre grupper, ikke to. Linjen sagde før kun "N oplyser det"
                    og "M oplyser ingen faciliteter" — og så manglede der en
                    tredjedel af boligerne uden forklaring: dem der oplyser
                    faciliteter, bare ikke DENNE. Tallene går op med antallet. */}
                <span className="filtergrundlag">
                  {grundlag.kaeledyr.toLocaleString('da-DK')} oplyser det ·{' '}
                  {(grundlag.antal - grundlag.tier - grundlag.kaeledyr).toLocaleString('da-DK')}
                  {' '}oplyser faciliteter uden det ·{' '}
                  {grundlag.tier.toLocaleString('da-DK')} oplyser ingen og vises ikke
                </span>
              </div>
            )}
            {fac.faciliteter.elevator > 0 && (
              <div className="filterpost">
                <span className="afkryds-linje">
                  <input type="checkbox" id="elevator" name="elevator" value="1" defaultChecked={f.elevator} />
                  <label htmlFor="elevator">Elevator</label>
                </span>
                {/* Filteret udelukker de ukendte — det er det eneste ærlige,
                    for vi ved ikke om de har det. Men så skal hun kunne se,
                    hvad hun ikke får. Tallene følger den aktuelle søgning. */}
                {/* Tre grupper, ikke to. Linjen sagde før kun "N oplyser det"
                    og "M oplyser ingen faciliteter" — og så manglede der en
                    tredjedel af boligerne uden forklaring: dem der oplyser
                    faciliteter, bare ikke DENNE. Tallene går op med antallet. */}
                <span className="filtergrundlag">
                  {grundlag.elevator.toLocaleString('da-DK')} oplyser det ·{' '}
                  {(grundlag.antal - grundlag.tier - grundlag.elevator).toLocaleString('da-DK')}
                  {' '}oplyser faciliteter uden det ·{' '}
                  {grundlag.tier.toLocaleString('da-DK')} oplyser ingen og vises ikke
                </span>
              </div>
            )}
            {fac.faciliteter.udeplads > 0 && (
              <div className="filterpost">
                <span className="afkryds-linje">
                  <input type="checkbox" id="udeplads" name="udeplads" value="1" defaultChecked={f.udeplads} />
                  <label htmlFor="udeplads">Altan eller terrasse</label>
                </span>
                {/* Filteret udelukker de ukendte — det er det eneste ærlige,
                    for vi ved ikke om de har det. Men så skal hun kunne se,
                    hvad hun ikke får. Tallene følger den aktuelle søgning. */}
                {/* Tre grupper, ikke to. Linjen sagde før kun "N oplyser det"
                    og "M oplyser ingen faciliteter" — og så manglede der en
                    tredjedel af boligerne uden forklaring: dem der oplyser
                    faciliteter, bare ikke DENNE. Tallene går op med antallet. */}
                <span className="filtergrundlag">
                  {grundlag.udeplads.toLocaleString('da-DK')} oplyser det ·{' '}
                  {(grundlag.antal - grundlag.tier - grundlag.udeplads).toLocaleString('da-DK')}
                  {' '}oplyser faciliteter uden det ·{' '}
                  {grundlag.tier.toLocaleString('da-DK')} oplyser ingen og vises ikke
                </span>
              </div>
            )}
          </>
        )}
        </div>
        <div className="knapper">
          {/* `name`/`value` sendes KUN, naar netop denne knap indsender.
              At soege fra det aabne panel holder det derfor aabent, mens
              «Find bolig» oeverst lukker det. Se noten ved <details>. */}
          <button type="submit" name="flere" value="1">Søg</button>
          <a className="nulstil" href="/">Nulstil</a>
        </div>
        </div>
        </details>
      </form>
  )

  return (
    <>
      <Maaling aktiv={mt.aktiv} impressions={mt.impressions} visning={visningId} rute="/" />
      {soegt ? (
        <>
          {/* Referencens broedkrumme og store sidetitel over
              filterbjaelken. Stedet kommer fra `stedNavn`, som
              resultathovedet ogsaa bruger — ét udtryk, to steder. */}
          <nav className="broedkrumme" aria-label="Sti">
            <a href="/">Forside</a>
            <span aria-hidden="true">›</span>
            <span aria-current="page">Lejeboliger</span>
          </nav>
          <div className="sidetitel">
            <h1>Lejeboliger{stedNavn ? ` i ${stedNavn}` : ' i hele Danmark'}</h1>
            <p>
              {sum.antal.toLocaleString('da-DK')}{' '}
              {sum.antal === 1 ? 'bolig matcher' : 'boliger matcher'} din søgning
            </p>
          </div>
          <div className="soegepanel">
            {formular}
            {/* ── Det, soegningen faktisk er sat til ───────────────────
                Filtrene bor i et <details>, der er LUKKET som udgangspunkt,
                og saa var «3 aktive» i <summary> det eneste, der stod om dem.
                Et tal er ikke et svar paa «hvad har jeg sat»: hun skulle
                aabne panelet og lede for at finde ud af, hvad det tredje var.

                Chipperne siger det, og hvert klik fjerner netop det ene
                filter. Almindelige links — samme adresser, samme parametre,
                ingen JS. Navnene og parameternavnene kommer fra
                `aktiveFiltre`, saa chippen og feltet i panelet ikke kan
                komme til at beskrive det samme filter forskelligt. */}
            {chips.length > 0 && (
              <div className="filterchips">
                {chips.map((c) => (
                  <a
                    key={c.navn} className="chip" href={soegeUrlUden('/', sp, c.fjern)}
                    aria-label={`Fjern filter: ${c.navn}`}
                  >
                    {c.navn}<span className="chip-x" aria-hidden="true">×</span>
                  </a>
                ))}
                <a className="chip chip-ryd" href="/">Ryd alle</a>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
        {/* Lokalt stemningsfoto; kilde og kreditering vælges samlet ovenfor. */}
        <section className={heroFoto ? 'hero fuldbredde har-foto' : 'hero fuldbredde'}>
          {heroFoto && (
            <div className="hero-billede" aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={heroFoto} alt="" />
            </div>
          )}
          <div className="hero-indhold">
            <p className="hero-oejenbryn">Lejeboliger med overblik</p>
            <h1>Find dit næste hjem</h1>
            <p className="hero-manchet">
              Se husleje, oplyst aconto og indflytningspris samlet.
              Vi viser tydeligt, når oplysninger mangler.
            </p>
          </div>
          <div className="hero-soeg">{formular}</div>
          {heroFoto && heroKredit && (
            <p className="hero-kredit">{heroKredit}</p>
          )}
        </section>

        {/* ── Talstriben ────────────────────────────────────────
            Referencens fire tal med ikon. Vores er REGNET, ikke skrevet
            ind: referencens «12.500+», «98 byer», «94 % faar svar inden
            for 24 timer» og «Tusindvis har fundet hjem» er alle
            opdigtede, og de tre sidste er desuden paastande, produktet
            ikke kan maale. Markuppen er den samme <ul>/<li>, saa
            `Hastighedspunkt` og proeven i test-soegning rammer det samme. */}
        <ul className="talstribe punkter">
          <li className="ts-hus">
            <strong>{tal.boliger.toLocaleString('da-DK')}</strong>
            <span>lejeboliger fra {tal.kilder} {tal.kilder === 1 ? 'kilde' : 'kilder'}</span>
          </li>
          <li className="ts-moent">
            {/* To grupper, ikke én. Stod der kun det oplyste tal, kunne
                laeseren ikke se, hvor stor resten var. Begge tal kommer
                fra den SAMME foresporgsel og gaar op i hovedtallet. */}
            <strong>{tal.kendtTotal.toLocaleString('da-DK')}</strong>
            <span>
              med hele udgiften til udlejer oplyst ·{' '}
              {(tal.boliger - tal.kendtTotal).toLocaleString('da-DK')} uden
            </span>
          </li>
          <li className="ts-kalender">
            <strong>{avGrundlag.timing.nu.toLocaleString('da-DK')}</strong>
            <span>kan overtages nu</span>
          </li>
          {/* Uden en maaling staar der hverken en kadence eller et tal —
              se `Hastighed.tsx`. Maalingen selv er uroert. */}
          <Hastighedspunkt minutterP90={tal.minutterP90} />
        </ul>

        <p className="note grundlagsnote">
          {avGrundlag.timing.nu.toLocaleString('da-DK')} kan overtages nu ·{' '}
          {avGrundlag.timing.senere.toLocaleString('da-DK')} kan overtages senere ·{' '}
          {(avGrundlag.timing.unknown + avGrundlag.timing.conflict).toLocaleString('da-DK')} uden afklaret overtagelsestidspunkt
        </p>

        </>
      )}


      {/* ── Resultatheaderen ──────────────────────────────────────
          De samme fem oplysninger som før, i ét hoved i stedet for fem
          løsrevne striber. Rækkefølgen ER hierarkiet: antallet og stedet
          er sidens svar og står øverst; grundlaget, udsnittet og de to
          forbehold står under som baggrund.

          Antallet er flyttet fra `.optaelling` op i overskriften — samme
          tal, samme kilde, ny rang. Klasserne bliver på elementerne:
          `.optaelling` og `.begraensning` bruges også af gruppe- og
          områdesiderne, og de er urørte. */}
      <div className="resultathoved">
        <div className="listehoved">
          {soegt && (
            /* «N boliger fundet» som i referencen. Stedet staar i
               sidetitlen ovenfor og gentages ikke her. */
            <h2 className="listetitel resultat-tal">
              <strong>{sum.antal.toLocaleString('da-DK')}</strong>{' '}
              {sum.antal === 1 ? 'bolig fundet' : 'boliger fundet'}
            </h2>
          )}
          {!soegt && visninger.length > 0 && (
            <h2 className="listetitel">Nyeste boliger</h2>
          )}

          {/* Referencen saetter sortering og kortknap paa SAMME linje som
              «N boliger fundet», i hoejre side. De to er valg om
              visningen; antallet er svaret. Raekken bryder af sig selv,
              naar der ikke er plads. */}
          {soegt && visninger.length > 0 && (
            <div className="listehoved-hoejre">
              {/* Sorteringen bor i panelet og var dermed ogsaa skjult. Her
                  er den seks links — ét pr. orden, med den aktive markeret.
                  Ingen <select> uden for formularen: en select uden JS
                  skifter ingenting, og en submit-knap mere ville vaere en
                  kontrol, der ligner filtrene uden at vaere dem.
                  `aria-current` fortaeller skaermlaeseren, hvad der gaelder. */}
              <div className="sortering">
                <span className="sortering-navn">Sortér</span>
                {SORTERINGSVALG.map((v) => {
                  const valgt = (f.sorter ?? 'nyeste') === v
                  return (
                    <a
                      key={v} href={soegeUrlSorteret('/', sp, v)}
                      className={valgt ? 'sort-pille valgt' : 'sort-pille'}
                      aria-current={valgt ? 'true' : undefined}
                      title={SORTERINGSNAVN[v].lang}
                    >
                      {SORTERINGSNAVN[v].kort}
                    </a>
                  )
                })}
              </div>
              <a className="kortknap" href={kortLink(sp, kortVises)}>
                {kortVises ? 'Skjul kort' : 'Vis kort'}
              </a>
            </div>
          )}
        </div>

        {/* Uden filtre staar de samme tal allerede i hero'en ovenfor.
            Linjen hoerer til, hvor den siger noget nyt: om et udsnit. */}
        {soegt && (
          <div className="optaelling">
            <span>{sum.medTotal} med kendt total</span>
            <span>{sum.medIndflytning} med indflytningspris</span>
            {sum.billigst != null && sum.dyrest != null && (
              <span>{kr(sum.billigst)}–{kr(sum.dyrest)} kr/md</span>
            )}
          </div>
        )}

        {/* Tallet er BOLIGER, ikke kort. Et gruppekort daekker flere, og
            "viser 48 af 904" ville vaere forkert paa begge maader. */}
        {/* TO uafhaengige udsagn, ikke én broek. Kort af kort er en aegte
            del/helhed; boliger staar for sig.

            Foer parrede linjen `antalBoliger(visninger)` med `sum.antal`,
            som om det foerste var en delmaengde af det andet. Uden
            domaenefilter er det ogsaa — men MED et er det ikke: et
            gruppekort vises, naar bare ét medlem matcher, saa de viste
            kort daekker ogsaa boliger, der ikke goer. Paa `?reserveret=1`
            stod der «194 af 151 boliger».

            `komplet` er falsk, hvis kandidatloftet blev ramt. Saa maa der
            ikke staa et tal, der lader som om det er alt. */}
        {kortIAlt > visninger.length && (
          <p className="begraensning">
            Viser de {visninger.length} nyeste af{' '}
            {komplet ? kortIAlt.toLocaleString('da-DK') : `mindst ${kortIAlt.toLocaleString('da-DK')}`}
            {' '}kort — {sum.antal.toLocaleString('da-DK')}{' '}
            {sum.antal === 1 ? 'bolig matcher' : 'boliger matcher'} søgningen.
            {' '}Brug filtrene for at indsnævre.
          </p>
        )}

        {/* Forbeholdet staar, hvor det gaelder: KUN naar der faktisk er
            sat en prisgraense. Foer stod det paa hver eneste resultatside
            — ogsaa en soegning paa «2300» uden et eneste tal i pris —
            og en forklaring paa et filter, brugeren ikke har brugt, er
            stoej i toppen af siden, ikke aabenhed. Teksten er uaendret.
            Det er den samme regel som kortet og gem-boksen foelger. */}
        {soegt && (f.prisMin != null || f.prisMax != null) && (
          <p className="prisnote">
            Prisfilteret gælder den <strong>samlede månedlige udgift</strong> — husleje
            plus aconto. Kender vi ikke totalen, filtreres der på huslejen alene, og
            boligen kan være dyrere end grænsen.
          </p>
        )}

        {/* Faciliteter er en POSITIV liste. Filtrerer hun på elevator, ryger
            alle boliger fra kilder, der bare ikke skriver det — og det ligner
            "der er ingen". Det skal stå på skærmen, ikke kun i koden. */}
        {soegt && (f.kaeledyr || f.elevator || f.udeplads)
          && tavse.navne.length > 0 && (
          /* Frafaldet er ikke jævnt fordelt. Tre kilder oplyser aldrig
             faciliteter, så et kryds fjerner dem HELT — filteret er også et
             kildefilter. Navnene beregnes, så linjen retter sig selv, hvis en
             kilde skifter praksis. */
          <p className="prisnote advarsel">
            <strong>{sammenskriv(tavse.navne)}</strong> oplyser aldrig faciliteter.
            {' '}Med et facilitetsfilter er alle {tavse.antal.toLocaleString('da-DK')}
            {' '}boliger derfra ude — også dem der har det, du søger.
          </p>
        )}
      </div>

      {forHoej ? (
        <div className="side-findes-ikke">
          <p>
            <strong>Side {side} findes ikke.</strong> Søgningen har{' '}
            {komplet ? '' : 'mindst '}{sider} {sider === 1 ? 'side' : 'sider'}.
          </p>
          <p>
            <a href={sideUrl('/', sp, sider)}>Gå til side {sider}</a>
            {side !== 1 && <> · <a href={sideUrl('/', sp, 1)}>tilbage til side 1</a></>}
          </p>
        </div>
      ) : visninger.length === 0 ? (
        <div className="tom">
          {/* «Ingen boliger matcher» er en PAASTAND om hele saettet. Den maa
              kun staa, naar vi har set hele saettet. Rammer kandidatloftet,
              har vi holdt op med at lede — og saa er nul ikke et svar, det
              er et sted vi stoppede. */}
          <p>{komplet ? 'Ingen boliger matcher.' : 'Vi fandt ingen match i den del af udbuddet, vi nåede at gennemgå.'}</p>
          {/* «Nulstil» bor inde i panelet, og panelet er lukket. Uden det
              her peger vejledningen paa en knap, der ikke er paa skaermen. */}
          <p>
            {komplet ? 'Prøv at fjerne et filter' : 'Indsnævr søgningen, så vi kan nå hele vejen igennem'}
            {soegt && <> — eller <a href="/">nulstil søgningen</a></>}.
          </p>
        </div>
      ) : (
        <div className={kortVises ? 'medkort' : 'udenkort'}>
          {/* `.listeomraade` er det lag, kolonnetallet maales paa. En
              container kan ikke forespoerge sin egen bredde, saa gitteret
              selv kan ikke vaere den: med landkortet ved siden af er
              listen smal paa en bred skaerm, og en medieforespoergsel
              ville ikke opdage det. */}
          <div className="listeomraade">
            <div className="liste">
              {visninger.map((v, i) => (
                <Visningskort
                  nu={nu}
                  filtre={f}
                  key={v.slags === 'gruppe' ? `g:${v.gruppe.repraesentant.id}` : v.bolig.id}
                  v={v}
                  // Global plads i HELE resultatsaettet, ikke paa siden.
                  // Side 2 begynder derfor paa 49. Sidelokal position kan
                  // altid genskabes som `position - (side-1)*48`.
                  position={(side - 1) * PR_SIDE + i + 1}
                />
              ))}
            </div>
          </div>

          {kortVises && (
            <aside className="kortspalte">
              <div className="kortboks">
                <Landkort maerker={maerker} />
              </div>
              {/* Kilde-oplysning, ikke en fejlmelding: det er kilden der
                  ikke oplyser placeringen, ikke boligen der mangler noget.
                  Boligerne staar stadig i listen. */}
              {udenPlacering.length > 0 && (
                <p className="kortnote">
                  {udenPlacering.map((k) => `${k.navn} oplyser ikke placering`).join(' · ')}
                  {' — '}
                  {udenPlacering.reduce((a, k) => a + k.antal, 0) === 1
                    ? 'boligen står i listen uden mærke på kortet.'
                    : 'boligerne står i listen uden mærke på kortet.'}
                </p>
              )}
            </aside>
          )}
        </div>
      )}

      {/* Forrige · sidetal · Naeste. Almindelige links; se app/Sider.tsx. */}
      <Sider basis="/" sp={sp} side={side} sider={sider} komplet={komplet} />

      {/* ── Gem soegningen ────────────────────────────────────
          Stod FOER resultathovedet og skubbede baade antallet og det
          foerste boligkort ned. Boksen svarer paa et spoergsmaal, man
          foerst stiller, naar man har SET resultatet — «det her vil jeg
          have besked om» — saa den hoerer til efter listen. Formularen,
          dens server action og dens skjulte felter er uroerte; kun
          pladsen paa siden er en anden.
          Paa forsiden er den stadig stoej: uden filtre gemmes en
          soegning ikke, jf. `harFiltre`. */}
      {soegt && <GemSoegning sp={sp} />}

      {!soegt && (<>
        <section className="sektion">
          <h2 className="sektion-titel">Sådan bruger du Bofinda</h2>
          <div className="kortgitter">
            <article className="infokort">
              <span className="ik-flise ik-moent" aria-hidden="true" />
              <h3>Overblik over prisen</h3>
              <p>
                Se husleje, oplyst aconto og indflytningspris.
                Mangler en oplysning, gør vi dig opmærksom på det.
              </p>
            </article>
            <article className="infokort">
              <span className="ik-flise ik-filter" aria-hidden="true" />
              <h3>Søg efter dine ønsker</h3>
              <p>
                Find boliger efter område, pris og størrelse. Ved filtre
                for faciliteter kan du se, når oplysninger mangler.
              </p>
            </article>
            <article className="infokort">
              <span className="ik-flise ik-klokke" aria-hidden="true" />
              <h3>Besked om nye boliger</h3>
              <p>
                Gem din søgning, og få en mail, når nye boliger
                matcher dine ønsker.
              </p>
            </article>
          </div>
        </section>

        <section className="udlejerbaand">
          <div className="ub-tekst">
            <p className="ub-oejenbryn">For udlejere</p>
            <h2>Udlej din bolig på Bofinda</h2>
            <p>
              Vis din bolig frem med billeder og pris, og bliv fundet
              af boligsøgende.
            </p>
          </div>
          <a className="ub-knap" href="/udlejer/opret">Opret annonce →</a>
        </section>
      </>)}

      {/* Kilderne uden den native: "hentet fra ... og Bofinda" er ikke
          rigtigt — de annoncer er ikke hentet nogen steder, de er
          oprettet her. Og de aabner ikke hos en kilde. */}
      <footer className="bund">
        {fac.kilder.some((k) => k.slug !== 'native')
          ? `Boliger fra ${fac.kilder.map((k) => k.navn).join(' og ')}.`
          : 'Annoncer oprettet af udlejere på Bofinda.'}
        {' '}Klik på en bolig for at åbne den hos kilden eller for at se
        udlejerens kontaktoplysninger.
        Tal vises som kilden oplyser dem; mangler en oplysning, står den tom.
      </footer>
    </>
  )
}
