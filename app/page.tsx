import {
  boligtypegrundlag,
  facilitetsgrundlag, filtreFraParametre, harFiltre, oekonomigrundlag,
  tavseKilder,
  availabilityGrundlag, opsummering, soegGrupperet,
  type Soegeparametre,
} from '../lib/soeg'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { facetterCached, forsidetalCached } from './cache'
import { GemSoegning } from './GemSoegning'
import { Visningskort, kr } from './Boligkort'
import { favoritIder, statusFor } from '../lib/favoritter'
import { Landkort, type Maerke } from './Landkort'
import { Sorteringsmenu } from './Sorteringsmenu'
import { Hastighedspunkt } from './Hastighed'
import { Maaling } from './Maaling'
import { Filterdialog, Filterknap } from './Filterdialog'
// Typenavnet kommer ÉT sted fra — se lib/boligtype.ts. Denne fil havde
// sin egen liste, og de to var uenige om `andet` og `villa`.
import { typenavn } from '../lib/boligtype'
import { maalingstilstand, spor } from '../lib/maaling-server'
import { antalFiltre, filterDiff, forrigeFiltre, uddrag } from '../lib/maalingsoeg'
import {
  SORTERINGSNAVN, SORTERINGSVALG, aktiveFiltre,
  soegeUrlSorteret, soegeUrlUden,
} from '../lib/filterpanel'
import { Sider, sideUrl } from './Sider'
import { returVaerdi } from '../lib/retur'
import { paaDansk } from '../lib/liste'

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


/**
 * Til- og fravalg af kortet, som et almindeligt link.
 *
 * Tilstanden ligger i URL'en ligesom alt andet: den kan deles, den
 * overlever et genindlæs, og listen er allerede bred på serveren — så den
 * hopper ikke i bredden, når siden er færdig.
 *
 * **Valget skrives ALTID ud, også `kort=1`.** Før udelod linket
 * parameteren, når kortet blev slået til, fordi «til» dengang var
 * standarden. Nu er der tre tilstande og ikke to — se `kortOenske`
 * nedenfor — og et fravær betyder noget andet end et ja. Uden den
 * eksplicitte `1` ville et klik på «Vis kort» på en telefon føre
 * tilbage til listen, altså til den tilstand, man lige forlod.
 */
function kortLink(sp: Soegeparametre, vaelg: 'ja' | 'nej'): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    // `flere` ryger med ud. At skifte mellem liste og kort er ikke en
    // grund til at bære filtervinduet med over — uden JavaScript ville
    // det ellers stå åbent hen over det, man lige bad om at se.
    if (v == null || k === 'kort' || k === 'flere') continue
    for (const x of Array.isArray(v) ? v : [v]) q.append(k, x)
  }
  q.set('kort', vaelg === 'ja' ? '1' : '0')
  const s = q.toString()
  return s ? `/?${s}` : '/'
}

/** Springlinkets maal. Ét sted: `href="#…"` og `id="…"` er to halvdele
 *  af den samme streng, og skrives de af i haanden, kan den ene doebes
 *  om uden en fejl nogen steder — linket flytter bare ikke fokus mere. */
const EFTER_KORTET = 'efter-kortet'

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
  const raaParametre = await searchParams

  // ── ÉN ADRESSE PR. SØGNING ───────────────────────────────────
  // En GET-formular sender ALLE sine felter, også de tomme. Med
  // filtrene samlet i ét vindue er det syv felter, så et klik på «Vis
  // resultater» gav
  //   /?sted=Aarhus&prisMin=&prisMax=&vaerelser=&areal=&overtagelse=&kilde=&sorter=nyeste
  // hvor der stod ét filter. Otte adresser for det samme indhold,
  // afhængigt af hvilke felter der tilfældigvis var rørt — og siden har
  // hverken canonical eller noindex, så de er alle indekserbare.
  //
  // Det er den samme regel, `soegeUrlSorteret` allerede følger: «nyeste»
  // udelader parameteren, fordi /?by=X og /?by=X&sorter=nyeste er den
  // samme side. Her håndhæves den for hele formularen.
  //
  // Ingen værdi går tabt: kun tomme parametre og den underforståede
  // standardsortering ryger. Omdirigeringen er idempotent — efter den er
  // der ingen tomme tilbage — så den kan ikke løkke. Den står FØR
  // målingen, så en søgning ikke tælles to gange.
  {
    const rent = new URLSearchParams()
    let snavs = false
    for (const [k, v] of Object.entries(raaParametre)) {
      for (const x of Array.isArray(v) ? v : v == null ? [] : [v]) {
        if (x === '' || (k === 'sorter' && x === 'nyeste')) { snavs = true; continue }
        rent.append(k, x)
      }
    }
    if (snavs) {
      const q = rent.toString()
      redirect(q ? `/?${q}` : '/')
    }
  }

  // ── `gemt` er et SVAR, ikke en del af søgningen ───────────────
  //
  //  Hver eneste adresse på siden bygges af `sp`: sidetal (`sideUrl`),
  //  sortering og filterchips (`udenNavne`) og kortvalget (`kortLink`).
  //  Alle tre kopierer hver parameter, de ikke udtrykkeligt smider væk —
  //  så `gemt=ugyldig-mail` hang ved i hvert klik bagefter, og beskeden
  //  om en indsendelse, der var overstået for længst, stod på side 2, 3
  //  og 4. Med fokusstyringen i GemSvar ville den oven i købet rive
  //  fokus til sig hver gang.
  //
  //  Den tages ud ÉT sted — her — og gives videre som det, den er: et
  //  svar på én indsendelse. Så kan ingen af de tre adressebyggere
  //  komme til at bære den med, og ingen af dem behøver at vide, at den
  //  findes. Normaliseringen ovenfor kører FØR, så den stadig ser hele
  //  adressen og ikke omdirigerer beskeden væk.
  //
  //  Den renset udgave hedder `sp` — altsaa dét, resten af siden ser.
  //  Det er med vilje: var den renset udgave den med det saerlige navn,
  //  skulle hver ny adressebygger HUSKE at bruge den, og den, der glemte
  //  det, ville faa noget, der virkede lige indtil nogen gemte en
  //  soegning. Den raa findes kun her.
  const svarPaaGem = typeof raaParametre.gemt === 'string' ? raaParametre.gemt : null
  const sp: Soegeparametre = { ...raaParametre, gemt: undefined }

  // Samme parsing som gem-formularen bruger. Se noten i lib/soeg.ts.
  const f = filtreFraParametre(sp)
  // Returadressen til DENNE søgning. Regnes ÉN gang for hele siden —
  // den beskriver siden, ikke det enkelte kort — og bæres med over i
  // kortenes links, så vejen tilbage findes, når hun står på en bolig
  // eller en boliggruppe. `sp` er den rensede udgave; `gemt` er allerede
  // taget ud ovenfor og må ikke bæres med. Se lib/retur.ts.
  //
  // Den skrives ALDRIG på `/` selv: hver adressebygger på siden kopierer
  // enhver parameter, den ikke udtrykkeligt smider væk, og så ville
  // `fra` hænge ved i hvert klik bagefter — præcis `gemt`-fælden.
  const retur = returVaerdi('/', sp)
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
  // Samme kneb igen for boligtyperne. Uden et typefilter er det ordret
  // `sum`; med ét er det én forespørgsel mere — og det er netop dér, hun
  // skal kunne se, hvor mange der ligger i de andre typer.
  const typeGrundlag = f.boligtyper?.length ? await boligtypegrundlag(f, nu) : sum
  // Hvilke typeknapper der vises. Reglen er den samme som før — et valg,
  // der ikke kan give træf, kommer ikke på skærmen — men den måles nu på
  // SØGNINGEN og ikke på hele bestanden.
  //
  // Undtagelsen er en type, hun allerede har valgt: den bliver stående,
  // også hvis de øvrige filtre har talt den til nul. Ellers ville
  // afkrydsningen forsvinde under fingeren på hende, og det eneste sted,
  // filteret kan fjernes fra vinduet, ville være væk. (Chippen over
  // listen kan stadig fjerne det — men vinduet må ikke lyve om, hvad der
  // er sat.)
  const typevalg = typeGrundlag.typer.filter((t) =>
    t.antal > 0 || (f.boligtyper?.includes(t.type) ?? false))
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
    type: typenavn,
    kilde: (k) => fac.kilder.find((x) => x.slug === k)?.navn ?? k,
  })
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

  // ── Kortvalget ───────────────────────────────────────────────
  // Tre led, ikke ét. `kortValgt` er det, hun har bedt om; `kortMuligt`
  // er om der overhovedet er noget at vise; `kortVises` er begge dele.
  //
  // Har ingen af resultaterne koordinater, er et tomt kort ikke et svar:
  // det ligner en fejl eller et Danmark uden boliger. Så står listen, og
  // der står HVORFOR — kilderne navngives af `udenPlacering`, så linjen
  // retter sig selv, hvis en kilde begynder at oplyse placering.
  //
  // `kort_vist` i målingen bruger `kortVises`, ikke `kortValgt`: ellers
  // ville tallet sige, at kortet blev vist, på de visninger hvor det
  // beviseligt ikke kunne.
  // ── TRE tilstande, ikke to ───────────────────────────────────
  //  `kort` kan nu være `1`, `0` eller slet ikke sat, og de tre betyder
  //  tre forskellige ting. Før var fraværet det samme som `1`, og det
  //  var derfor, en telefon mødte landkortet i stedet for boligerne: en
  //  bruger, der bare havde søgt, havde ikke valgt kortet — vi havde
  //  valgt det for hende.
  //
  //    kort=1     hun har bedt om kortet  → kort begge steder
  //    kort=0     hun har valgt det fra   → liste begge steder
  //    (intet)    hun har ikke taget stilling
  //                 · bred skærm: kort OG liste, som før
  //                 · smal skærm: LISTEN — boligerne er svaret
  //
  //  **Forskellen afgøres i CSS, ikke i JavaScript.** Serveren ved ikke,
  //  hvor bred skærmen er, så en klientside-beslutning ville betyde, at
  //  siden først viste kortet og derefter sprang til listen. Markuppen
  //  er derfor den samme, og `@media (max-width: 900px)` afgør, hvad der
  //  er synligt — ved første maling, uden et spring og uden JavaScript.
  //  Landkortet indlæses først, når det er SYNLIGT, så et skjult kort
  //  koster heller ikke en flisehentning.
  const kortOenske = en(sp.kort) === '1' ? 'ja' : en(sp.kort) === '0' ? 'nej' : 'uvalgt'
  const kortValgt = soegt && kortOenske !== 'nej'
  const kortMuligt = maerker.length > 0
  const kortVises = kortValgt && kortMuligt
  /** Kortspalten er i markuppen, men hun har ikke bedt om den. */
  const kortUvalgt = kortVises && kortOenske === 'uvalgt'

  // ── Måling ───────────────────────────────────────────────────
  // Skellet mellem forside og søgning er `harFiltre()`, ikke pathname:
  // det er den SAMME rute. Og `search` deles i to gensidigt udelukkende
  // udfald, saa count(search) = count(search_results_view) +
  // count(empty_results) altid gaar op. Goer den ikke det, er
  // instrumenteringen i stykker — ikke markedet.
  //
  // `spor()` kaster ikke og skriver i after(), altsaa efter svaret. Uden
  // samtykke sker der ingenting overhovedet.
  // Ét opslag for hele siden — `favoritIder` er cache()'et pr. request,
  // saa 48 kort koster én forespoergsel, ikke 48. Er ingen logget ind,
  // spoerges der slet ikke.
  const favkontekst = await favoritIder()
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

  // ── Området er ÉT felt ──────────────────────────────────────
  // `stedet()` i lib/soeg.ts lader `sted` vinde over `by` og `postnr`.
  // To synlige felter om det samme ville derfor betyde, at det ene taber
  // tavst: skrev hun «Aarhus» i bjælken og «2300» i panelet, blev
  // postnummeret kasseret uden et ord. Panelet har ikke længere sine
  // egne to felter; bjælkens ene bærer området.
  //
  // Gamle adresser med `by=` eller `postnr=` virker uændret — `stedet()`
  // læser dem stadig — og de foldes ind i feltets værdi, så en
  // indsendelse bærer dem videre som `sted`. Et fire-cifret `sted` bliver
  // til et postnummer igen, alt andet til en by; det er nøjagtig den
  // regel, `stedet()` selv bruger, så turen rundt er tabsfri.
  //
  // Bar en håndskrevet adresse BÅDE `by` og `postnr`, kan ét felt ikke
  // bære dem: postnummeret vises, og en indsendelse indsnævrer til det.
  // Ingen af vores egne links danner den form.
  const omraade = en(sp.sted) ?? en(sp.postnr) ?? en(sp.by) ?? ''

  // Filtervinduets to adresser. De virker uden JavaScript: den ene åbner
  // vinduet, den anden lukker det og bevarer søgningen uændret.
  const aabnFiltre = (() => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(sp)) {
      if (v == null || k === 'flere') continue
      for (const x of Array.isArray(v) ? v : [v]) q.append(k, x)
    }
    q.set('flere', '1')
    return `/?${q}`
  })()
  const lukFiltre = soegeUrlUden('/', sp, ['flere'])

  /* Sidetallene og gem-boksen. Trukket ud, fordi de er springlinkets
     maal: med et kort paa siden pakkes de i en navngivet gruppe, uden
     kort staar de, hvor de altid har staaet. ÉT sted, to indpakninger
     — ikke to kopier af det samme.

     Gem-boksen stod FOER resultathovedet og skubbede baade antallet og
     det foerste boligkort ned. Den svarer paa et spoergsmaal, man
     foerst stiller, naar man har SET resultatet — «det her vil jeg have
     besked om» — saa den hoerer til efter listen. Paa forsiden er den
     stadig stoej: uden filtre gemmes en soegning ikke, jf. `harFiltre`. */
  const efterKortet = (
    <>
      {/* Forrige · sidetal · Naeste. Almindelige links; se app/Sider.tsx. */}
      <Sider basis="/" sp={sp} side={side} sider={sider} komplet={komplet} />
      {soegt && <GemSoegning sp={sp} svar={svarPaaGem} />}
    </>
  )
  // «Ryd filtre» rydder FILTRENE og beholder området — det er det, der
  // står på knappen. Chippernes «Ryd alle» rydder også området. To
  // etiketter, to udfald, begge sande.
  const rydFiltre = omraade ? `/?sted=${encodeURIComponent(omraade)}` : '/'

  // Samme formular i begge tilstande — kun pladsen skifter. Paa forsiden
  // ligger den inde i hero-baandet, paa resultatsiden staar den alene
  // over listen.
  const formular = (
      <form className={soegt ? 'filtre soegt' : 'filtre'} method="get">
        {/* ── Den kompakte søgelinje ────────────────────────────
            Område · «Filtre» · kortvalg · søg. Ikke mere.

            Pris, størrelse og værelser stod her før og står nu i
            vinduet. De må ikke stå begge steder: to felter med samme
            `name` i én formular sender værdien to gange, og
            `filtreFraParametre` læser den første — altså ville vinduets
            tomme felt slette det, bjælken lige havde fået.

            Området er ÉT felt. Se noten ved `omraade` ovenfor. */}
        <div className="soegebar">
          <div className="soegefelt sf-sted">
            <label htmlFor="sted">By eller område</label>
            <input
              id="sted" type="text" name="sted" defaultValue={omraade}
              placeholder="F.eks. København eller 2300" list="byer"
              enterKeyHint="search"
            />
            <datalist id="byer">
              {fac.byer.map((b) => <option key={`${b.by}-${b.postnr}`} value={b.by ?? ''} />)}
            </datalist>
          </div>

          <Filterknap
            aabnHref={aabnFiltre}
            etiket="Filtre"
            antal={chips.length}
          />

          {/* Kortvalget hører til i søgelinjen, ikke i vinduet: det er en
              visning, ikke et filter, og det skal kunne skiftes uden at
              åbne noget. Et almindeligt link — tilstanden ligger i URL'en
              som alt andet på siden. */}
          {/* ── To links, når valget ikke er truffet ─────────────
              Etiketten skal sige det modsatte af det, der står på
              skærmen — og i den uvalgte tilstand er det IKKE det samme
              ved de to bredder: på en bred skærm ses kortet allerede
              («Vis liste»), på en smal ses listen («Vis kort»).

              Serveren kan ikke vide hvilken. Så renderes begge, og CSS
              viser den ene. `display: none` tager den anden ud af
              tabulatorrækkefølgen, så et tastatur møder netop ét link —
              og der er ingen JavaScript involveret, så det virker fra
              første maling. To adresser, ikke én, fordi de to knapper
              faktisk fører hver sit sted hen.

              I de to VALGTE tilstande er svaret det samme ved alle
              bredder, og så er der kun ét link. */}
          {soegt && visninger.length > 0 && kortMuligt && (
            kortUvalgt ? (
              <>
                <a className="kortvalg kv-smal" href={kortLink(sp, 'ja')}>
                  <span className="kv-ikon" aria-hidden="true" />
                  Vis kort
                </a>
                <a className="kortvalg kv-bred" href={kortLink(sp, 'nej')}>
                  <span className="kv-ikon" aria-hidden="true" />
                  Vis liste
                </a>
              </>
            ) : (
              <a className="kortvalg" href={kortLink(sp, kortVises ? 'nej' : 'ja')}>
                <span className="kv-ikon" aria-hidden="true" />
                {kortVises ? 'Vis liste' : 'Vis kort'}
              </a>
            )
          )}

          <button className="soegeknap" type="submit">
            Søg<span className="sk-pil" aria-hidden="true">→</span>
          </button>
        </div>

        {/* ── Vinduet står EFTER søgelinjen, ikke inde i den ─────
            Rækkefølgen i DOM'en er ikke et layoutvalg. Formularens
            standardknap — den, Enter i søgefeltet rammer — er den FØRSTE
            submit-knap i træet. Lå vinduet inde i bjælken, var det «Vis
            resultater» inde i et lukket vindue: usynligt, og alligevel
            det, tastaturet ramte. Nu er det «Søg», og tabulatorordenen
            følger den, øjet ser.

            Det er stadig inde i FORMULAREN. `showModal()` flytter
            vinduet til det øverste lag, men ikke i DOM'en, så felterne
            hører til den samme formular og sendes med, uanset hvilken af
            de to knapper der indsender. */}
        <Filterdialog
          aaben={panelAabent}
          lukHref={lukFiltre}
          fod={
            <>
              {/* «Ryd filtre» beholder området — det er det, der står på
                  knappen. Et almindeligt link, så det virker uden
                  JavaScript og kan åbnes i en ny fane. */}
              <a className="fd-ryd" href={rydFiltre}>Ryd filtre</a>
              {/* Ingen `name`/`value`. Formularen har intet `flere`-felt,
                  så en indsendelse dropper parameteren af sig selv og
                  lander på resultaterne med vinduet lukket. `flere=0`
                  ville være en anden adresse for det samme indhold —
                  præcis det, canonical rydder op i; vi laver dem ikke
                  selv. */}
              <button className="fd-vis" type="submit">Vis resultater</button>
            </>
          }
        >

            {/* ── Boligtype ─────────────────────────────────────
                Kun typer, der faktisk kan give træf I DENNE SØGNING.
                Et filter, der aldrig kan give træf, er værre end intet
                filter — og et TAL, der er talt på noget andet end
                søgningen, er værre end intet tal.

                Tallene kom før fra `facetter()`, som tæller hele
                bestanden: på en søgning med 76 boliger stod der
                75 · 58 · 54 · 53 · 34 · 6 = 280 ved siden af
                facilitetslinjer, der summerede til 76. Se
                `boligtypegrundlag` i lib/soeg.ts.

                En valgt type bliver stående, også hvis den er talt til
                nul af de ØVRIGE filtre — ellers ville afkrydsningen
                forsvinde under fingeren på hende, og filteret kunne ikke
                fjernes igen fra vinduet. */}
            {typevalg.length > 1 && (
              <section className="fd-afsnit">
                <h3>Boligtype</h3>
                <div className="valgknapper">
                  {typevalg.map((t) => (
                    <label key={t.type} className="valgknap">
                      <input
                        type="checkbox" name="type" value={t.type}
                        defaultChecked={f.boligtyper?.includes(t.type) ?? false}
                      />
                      <span>{typenavn(t.type)} <b>{t.antal}</b></span>
                    </label>
                  ))}
                </div>
              </section>
            )}

            {/* ── Pris ──────────────────────────────────────────
                Min og maks, fordi basen har begge. Intet prisdiagram og
                intet løbende resultattal: de skulle regnes af den samme
                søgning som listen, og det kan de ikke uden en ny
                forespørgsel pr. tastetryk. Et tal, der er regnet på noget
                andet end resultatet, er værre end intet tal. */}
            <section className="fd-afsnit">
              <h3>Pris pr. måned</h3>
              <div className="fd-par">
                <div className="fd-felt">
                  <label htmlFor="prisMin">Min.</label>
                  <div className="fd-boks">
                    <input
                      id="prisMin" name="prisMin" defaultValue={en(sp.prisMin) ?? ''}
                      inputMode="numeric" aria-label="Mindstepris pr. måned"
                    />
                    <span className="fd-enhed" aria-hidden="true">kr.</span>
                  </div>
                </div>
                <span className="fd-til" aria-hidden="true">–</span>
                <div className="fd-felt">
                  <label htmlFor="prisMax">Max.</label>
                  <div className="fd-boks">
                    <input
                      id="prisMax" name="prisMax" defaultValue={en(sp.prisMax) ?? ''}
                      inputMode="numeric" aria-label="Højeste pris pr. måned"
                    />
                    <span className="fd-enhed" aria-hidden="true">kr.</span>
                  </div>
                </div>
              </div>
              <p className="fd-note">
                Prisen er husleje plus den aconto, kilden opkræver. Boliger,
                hvor vi kun kender huslejen, måles på den.
              </p>
            </section>

            {/* ── Værelser ──────────────────────────────────────
                Knapper og ikke et felt: basen har kun en NEDRE grænse
                (`vaerelserMin`), og en række knapper siger det, mens to
                felter ville love et interval, søgningen ikke kan holde.
                «Alle» er en tom værdi — `heltal('')` giver undefined, så
                filteret forsvinder helt. */}
            <section className="fd-afsnit">
              <h3>Værelser</h3>
              <div className="valgknapper">
                {[null, 1, 2, 3, 4, 5].map((n) => (
                  <label key={n ?? 'alle'} className="valgknap">
                    <input
                      type="radio" name="vaerelser" value={n == null ? '' : String(n)}
                      defaultChecked={(f.vaerelserMin ?? null) === n}
                    />
                    <span>{n == null ? 'Alle' : `${n}+`}</span>
                  </label>
                ))}
              </div>
            </section>

            {/* ── Størrelse ─────────────────────────────────────
                Også kun en nedre grænse i basen, så feltet hedder
                «mindst» og ikke «fra … til». */}
            <section className="fd-afsnit">
              <h3>Størrelse</h3>
              {/* Kun ét felt. Referencen har Min. OG Max. for størrelse;
                  basen har kun `arealMin`. Et «Max.»-felt, der ikke
                  filtrerer, er værre end intet felt — det ville love et
                  interval, søgningen ikke kan holde. */}
              <div className="fd-felt fd-enkelt">
                <label htmlFor="areal">Min.</label>
                <div className="fd-boks">
                  <input
                    id="areal" name="areal" defaultValue={en(sp.areal) ?? ''}
                    inputMode="numeric"
                  />
                  <span className="fd-enhed" aria-hidden="true">m²</span>
                </div>
              </div>
            </section>

            <section className="fd-afsnit">
              <h3>Overtagelse</h3>
              <div className="fd-felt">
                <label htmlFor="overtagelse">Hvornår vil du flytte?</label>
                <select id="overtagelse" name="overtagelse" defaultValue={f.overtagelse ?? ''}
                  aria-describedby="overtagelse-note">
                  <option value="">Alle tidspunkter</option>
                  <option value="nu">Kan overtages nu</option>
                  <option value="senere">Kan overtages senere</option>
                </select>
              </div>
              {/* Drives af fortolkAvailability — aldrig af rå jsonb, legacy
                  available_from eller application_type. Grundlaget gælder DEN
                  AKTUELLE søgning, og de ukendte har ord: et filter viser kun
                  dokumenterede træf, og så skal det stå, hvor mange der ikke
                  kunne vurderes. */}
              <p id="overtagelse-note" className="filtergrundlag">
                {avGrundlag.timing.nu.toLocaleString('da-DK')} kan overtages nu ·{' '}
                {avGrundlag.timing.senere.toLocaleString('da-DK')} senere ·{' '}
                {(avGrundlag.timing.unknown + avGrundlag.timing.conflict).toLocaleString('da-DK')} uden
                oplyst dato — de vises ikke, hvis du vælger et tidspunkt
              </p>
            </section>

            {(fac.faciliteter.kaeledyr > 0 || fac.faciliteter.elevator > 0
              || fac.faciliteter.udeplads > 0) && (
              <section className="fd-afsnit">
                <h3>Faciliteter</h3>
                <div className="valgknapper" aria-describedby="faciliteter-note">
                  {fac.faciliteter.kaeledyr > 0 && (
                    <label className="valgknap">
                      <input type="checkbox" id="kaeledyr" name="kaeledyr" value="1" aria-describedby="faciliteter-note" defaultChecked={f.kaeledyr} />
                      <span>Kæledyr tilladt</span>
                    </label>
                  )}
                  {fac.faciliteter.elevator > 0 && (
                    <label className="valgknap">
                      <input type="checkbox" id="elevator" name="elevator" value="1" aria-describedby="faciliteter-note" defaultChecked={f.elevator} />
                      <span>Elevator</span>
                    </label>
                  )}
                  {fac.faciliteter.udeplads > 0 && (
                    <label className="valgknap">
                      <input type="checkbox" id="udeplads" name="udeplads" value="1" aria-describedby="faciliteter-note" defaultChecked={f.udeplads} />
                      <span>Altan eller terrasse</span>
                    </label>
                  )}
                </div>
                {/* ── TALLENE STÅR PÅ SKÆRMEN, IKKE BAG EN KLIK ────
                    Linjerne lå et øjeblik i en lukket «Om oplysningerne».
                    Målt: alle syv grundlagslinjer var i et `<details>`,
                    der er lukket som udgangspunkt — altså ingen af dem på
                    skærmen. Og den korte erstatning nævnte kun ÉN af de
                    tre grupper.

                    Faciliteter er en POSITIV liste: står `elevator` ikke i
                    `amenities`, betyder det «ikke oplyst», ikke «ingen
                    elevator». Filteret skjuler derfor alle, hvis kilde
                    tier — og så skal det stå, hvor mange det er. Den
                    MIDTERSTE gruppe er den, reglen blev skrevet om: uden
                    den manglede en tredjedel af boligerne uden
                    forklaring.

                    Forenklingen er bevaret dér, hvor den var rigtig:
                    linjerne står samlet UNDER pillerækken i stedet for
                    interleavet mellem tre afkrydsningsrækker. */}
                <div id="faciliteter-note" className="fd-grundlagsliste">
                  {[
                    ['Kæledyr tilladt', fac.faciliteter.kaeledyr, grundlag.kaeledyr],
                    ['Elevator', fac.faciliteter.elevator, grundlag.elevator],
                    ['Altan eller terrasse', fac.faciliteter.udeplads, grundlag.udeplads],
                  ].filter(([, vises]) => (vises as number) > 0).map(([navn, , oplyser]) => (
                    <p key={navn as string} className="filtergrundlag">
                      <b>{navn}</b>: {(oplyser as number).toLocaleString('da-DK')} nævner det ·{' '}
                      {(grundlag.antal - grundlag.tier - (oplyser as number)).toLocaleString('da-DK')}
                      {' '}nævner andre faciliteter ·{' '}
                      {grundlag.tier.toLocaleString('da-DK')} mangler oplysninger og vises ikke
                    </p>
                  ))}
                </div>
              </section>
            )}

            <section className="fd-afsnit">
              <h3>Øvrige valg</h3>
              <div className="valgknapper" aria-describedby="status-note">
                <label className="valgknap">
                  <input type="checkbox" id="venteliste" name="venteliste" value="1"
                    defaultChecked={f.ansoegningsform === 'venteliste'} />
                  <span>Kun venteliste</span>
                </label>
                <label className="valgknap">
                  <input type="checkbox" id="reserveret" name="reserveret" value="1"
                    defaultChecked={f.markedsstatus === 'reserveret'} />
                  <span>Kun reserverede</span>
                </label>
              </div>
              {/* Reserveret-grundlaget viser alle TRE grupper, så «vis
                  reserverede» ikke læses som «resten er dokumenteret
                  ledige»: de fleste har slet ingen markedsstatus fra
                  kilden. En sætning uden tal svarer ikke på det. */}
              <div id="status-note" className="fd-grundlagsliste">
                <p className="filtergrundlag">
                  <b>Venteliste</b>: {avGrundlag.ansoegning.venteliste.toLocaleString('da-DK')} har venteliste ·{' '}
                  {avGrundlag.ansoegning.normal.toLocaleString('da-DK')} søges direkte ·{' '}
                  {avGrundlag.ansoegning.unknown.toLocaleString('da-DK')} mangler oplysninger
                </p>
                <p className="filtergrundlag">
                  <b>Reserverede</b>: {avGrundlag.marked.reserveret.toLocaleString('da-DK')} er reserveret ·{' '}
                  {avGrundlag.marked.paa_markedet.toLocaleString('da-DK')} er på markedet ·{' '}
                  {(avGrundlag.marked.unknown + avGrundlag.marked.udlejet + avGrundlag.marked.conflict).toLocaleString('da-DK')}
                  {' '}mangler oplysninger
                </p>
              </div>
              <div className="filterpost">
                <label className="valgknap">
                  <input type="checkbox" id="fuld" name="fuld" value="1" defaultChecked={f.fuldOekonomi}
                    aria-describedby="oekonomi-note" />
                  <span>Aconto delt op</span>
                </label>
                {/* «Aconto delt op» er ikke det samme som «total kendt»:
                    kravet er husleje plus mindst én NAVNGIVEN aconto-post.
                    Etiketten hed «Specificeret aconto» og før det «Hele
                    økonomien oplyst» — begge var ord fra skemaet, ikke fra
                    den, der leder efter en bolig. Definitionen forklarer
                    navnet; tallene forklarer, hvad filteret udelader.
                    Begge dele skal stå. */}
                <p id="oekonomi-note" className="fd-note">
                  Kun boliger hvor udlejer skriver, hvad varmen, vandet eller
                  strømmen koster — ikke bare ét samlet beløb.
                </p>
                <p className="filtergrundlag">
                  {oek.fuld.toLocaleString('da-DK')} har delt aconto op ·{' '}
                  {(oek.medTotal - oek.fuld).toLocaleString('da-DK')} oplyser kun ét samlet beløb ·{' '}
                  {(oek.antal - oek.medTotal).toLocaleString('da-DK')} oplyser kun huslejen
                </p>
              </div>
              {/* Kilde stod i en to-spaltet raekke sammen med Sortér.
                  Da sorteringen flyttede ud, stod den tilbage i den
                  venstre halvdel med en tom spalte ved siden af. Ét felt
                  er ikke et par. */}
              <div className="fd-kildefelt">
                <div className="fd-felt">
                  <label htmlFor="kilde">Kilde</label>
                  <select id="kilde" name="kilde" defaultValue={kilderValgt?.[0] ?? ''}>
                    <option value="">Alle kilder</option>
                    {fac.kilder.map((k) => (
                      <option key={k.slug} value={k.slug}>{k.navn} ({k.antal})</option>
                    ))}
                  </select>
                </div>
                {/* Sorteringen bor i menuen over listen og INTET andet
                    sted. To menuer for den samme indstilling er to
                    steder at lede og to steder at rette.

                    Men feltet kan ikke bare slettes: vinduet er en
                    GET-formular, og en GET-formular sender kun sine egne
                    felter. Uden noget, der bærer ordenen med, ville
                    «Vis resultater» tabe den og stille søgningen tilbage
                    til «nyeste» — hver gang hun rettede et filter.
                    Derfor et skjult felt i stedet for en rullemenu.

                    Kun naar den ikke er standarden: `/?…&sorter=nyeste`
                    og `/?…` er den samme side, og omdirigeringen ovenfor
                    skaerer parameteren vaek igen. */}
                {f.sorter && f.sorter !== 'nyeste' && (
                  <input type="hidden" name="sorter" value={f.sorter} />
                )}
                {/* Samme grund, samme løsning, for kortvalget. Chipperne,
                    sorteringsmenuen og sidenavigationen kopierer alle
                    parametre og bærer det allerede videre; formularen er
                    det ene sted, der kun sender sine EGNE felter. Uden
                    det her ville «Vis resultater» stille visningen
                    tilbage til standarden, hver gang hun rettede et
                    filter — altså kaste hendes valg væk netop dér, hvor
                    hun var i gang.

                    Kun når hun HAR valgt: en tom `kort=` ville blive
                    skåret væk af omdirigeringen ovenfor alligevel, og
                    den uvalgte tilstand er fraværet af parameteren. */}
                {(en(sp.kort) === '0' || en(sp.kort) === '1') && (
                  <input type="hidden" name="kort" value={en(sp.kort)} />
                )}
              </div>
            </section>
        </Filterdialog>

        {/* Referencens «Populære søgninger». Byerne er IKKE skrevet
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
      </form>
  )

  return (
    <>
      <Maaling aktiv={mt.aktiv} impressions={mt.impressions} visning={visningId} rute="/" />
      {soegt ? (
        <>
          {/* Referencens broedkrumme og store sidetitel over
              filterbjælken. Sted og resultatantal vises samlet én gang. */}
          <nav className="broedkrumme" aria-label="Sti">
            <a href="/">Forside</a>
            <span aria-hidden="true">›</span>
            <span aria-current="page">Lejeboliger</span>
          </nav>
          {/* Tallet står i overskriften som i referencen — ét sted.
              Det stod tre: i en linje under titlen, i «N boliger fundet»
              over listen, og i tællelinjen under den. Referencen skriver
              «Lejeboliger på Østerbro (116)» og lader det være. */}
          <div className="sidetitel resultat-titel">
            <h1>
              Lejeboliger{stedNavn ? ` i ${stedNavn}` : ' i hele Danmark'}
              <span className="titeltal">({sum.antal.toLocaleString('da-DK')})</span>
            </h1>
            {visninger.length > 0 && (
              <Sorteringsmenu etiket={<>Sortér: {SORTERINGSNAVN[f.sorter ?? 'nyeste'].kort}</>}>
                <nav aria-label="Sortering" className="sortering-valg">
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
                </nav>
              </Sorteringsmenu>
            )}
          </div>
          <div className="soegepanel">
            {formular}
            {/* ── Det, soegningen faktisk er sat til ───────────────────
                Filtrene bor i et lukket vindue. Chipperne viser valgene
                uden at kræve, at vinduet åbnes.
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
        {!soegt && visninger.length > 0 && (
          <h2 className="listetitel">Nyeste boliger</h2>
        )}

        {/* ── Tre udsagn om DATAENE, ikke et resultatantal ──────
            Linjen lå et øjeblik ude sammen med det dobbelte antal. Men
            den tæller ikke resultater — den siger, hvor mange af dem vi
            kender hele udgiften til udlejeren for, hvor mange der har en
            indflytningspris, og hvad spændet er. Det er præcis den slags
            forbehold, resten af fladen er bygget om at bevare: uden den
            kan man ikke se, at 69 af 76 har en kendt total.
            Antallet står ét sted, i overskriften. */}
        {soegt && visninger.length > 0 && (
          <div className="optaelling">
            <span>{sum.medTotal} med samlet pris til udlejer</span>
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
            Viser {visninger.length} af{' '}
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
            Prisfilteret gælder <strong>husleje og oplyst aconto til udlejer</strong>.
            Kender vi ikke totalen, filtreres der på huslejen alene, og
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
        <>
        {/* ── Kortet kan ikke vises ─────────────────────────────
            Ingen af resultaterne har koordinater. Et tomt landkort ville
            ligne en fejl eller et Danmark uden boliger, så listen står,
            og der står hvorfor. Kilderne navngives af `udenPlacering` og
            skrives ikke ind: begynder en kilde at oplyse placering,
            retter linjen sig selv.

            Det er en oplysning om KILDEN, ikke en fejl ved boligen —
            boligerne står i listen, fuldt ud. */}
        {kortValgt && !kortMuligt && visninger.length > 0 && (
          <p className="kortmangler">
            Kortet kan ikke vise denne søgning:{' '}
            {udenPlacering.length > 0
              ? `${sammenskriv(udenPlacering.map((k) => k.navn))} oplyser ikke placering`
              : 'ingen af boligerne har en oplyst placering'}
            . Boligerne står i listen herunder.
          </p>
        )}
        <div className={kortVises ? (kortUvalgt ? 'medkort kort-uvalgt' : 'medkort') : 'udenkort'}>
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
                  retur={retur}
                  key={v.slags === 'gruppe' ? `g:${v.gruppe.repraesentant.id}` : v.bolig.id}
                  v={v}
                  // Global plads i HELE resultatsaettet, ikke paa siden.
                  // Side 2 begynder derfor paa 49. Sidelokal position kan
                  // altid genskabes som `position - (side-1)*48`.
                  position={(side - 1) * PR_SIDE + i + 1}
                  // Favoritstatus kommer fra ÉT opslag for hele siden
                  // (`favkontekst` ovenfor) og gives videre til begge
                  // korttyper. For en gruppe gemmes den paa
                  // repraesentantens bolig-id. Gruppekortet linker til
                  // `/gruppe?b=<id>` og ikke til boligsiden — men det er
                  // det SAMME id, gruppeadressen bygges af, og det samme,
                  // favoritlisten viser. Ét hjerte pr. kort, ét id bag.
                  favorit={statusFor(favkontekst,
                    v.slags === 'gruppe' ? v.gruppe.repraesentant.id : v.bolig.id)}
                />
              ))}
            </div>
          </div>

          {kortVises && (
            <aside className="kortspalte">
              <div className="kortboks">
                {/* `springTil` giver kortet et springlink. Uden det skal
                    den, der tabulerer, forbi kortets egne kontroller for
                    at naa videre — og foer roving-tabindex forbi hvert
                    eneste maerke. Maalt: 48 stop i kortspalten. */}
                <Landkort
                  maerker={maerker} springTil={EFTER_KORTET} pegerTilListe
                />
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
        </>
      )}

      {/* ── Springlinkets maal ────────────────────────────────
          Det var en TOM div paa nul pixel uden navn. Fokus landede et
          sted, der hverken kunne ses eller hoeres: en skaermlaeser havde
          intet at laese op, og laa maalet allerede i billedet, rullede
          siden heller ikke. Man kunne ikke afgoere, om linket gjorde
          noget.
          Nu er maalet det, der FAKTISK kommer efter kortet — sidetallene
          og gem-boksen — og gruppen har et navn, der siger det. Det er
          ogsaa aerligere: en gruppe med indhold kan hedde noget, en tom
          div kan ikke.
          Kun naar der ER et kort at springe over. Uden kort er der intet
          spring, og saa skal indholdet ikke pakkes ind i en gruppe, der
          lover et.
          `tabIndex={-1}` er det, der giver den fokus — uden den flytter
          browseren kun rullepositionen, og naeste Tab ville begynde
          forfra i toppen af siden. */}
      {kortVises ? (
        <div
          id={EFTER_KORTET} tabIndex={-1} className="efterkort"
          role="group" aria-label="Efter kortet"
        >
          {efterKortet}
        </div>
      ) : efterKortet}

      {/* ── Talstriben — EFTER boligerne ──────────────────────
          Den stod mellem søgefeltet og det første boligkort og fyldte
          164 px på en telefon. Tallene er rigtige og skal blive, men de
          er baggrund: en bruger, der lige har søgt, skal møde boliger,
          ikke en opgørelse over bestanden. Målt på 390 px lå det første
          boligkort 821 px nede — under folden på en 844 px høj skærm.

          Markuppen er ORDRET den samme <ul>/<li> som før, så
          `Hastighedspunkt` og de prøver, der læser `.punkter`, rammer
          det samme. Kun pladsen på siden er en anden — samme slags
          flytning som gem-boksen fik, og af samme grund. */}
      {!soegt && (<>
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
      </>)}

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
          ? `Boliger fra ${paaDansk(fac.kilder.map((k) => k.navn))}.`
          : 'Annoncer oprettet af udlejere på Bofinda.'}
        {' '}Klik på en bolig for at åbne den hos kilden eller for at se
        udlejerens kontaktoplysninger.
        Tal vises som kilden oplyser dem; mangler en oplysning, står den tom.
      </footer>
    </>
  )
}
