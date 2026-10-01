// ═══════════════════════════════════════════════════════════════
//  Alarmer: gemte søgninger matchet mod nye boliger.
//
//  Matchning og afsendelse er ADSKILT. Her skabes kun køen. Intet
//  sendes, før træfsikkerheden er efterset — en mail kan ikke kaldes
//  tilbage.
// ═══════════════════════════════════════════════════════════════

import { and, asc, desc, eq, gt, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { alertMatches, crawlRuns, listings, savedSearches, sources, users } from '../db/schema'
import { availabilityFor, harDomaenefilter, hvor, matcherDomaene, type Filtre } from './soeg'
import { INDKOERING_TIMER } from './indkoering'
import { typeord } from './boligtype'

/** Kriterierne gemmes som `Filtre`. Læses tilbage med samme form. */
const somFiltre = (c: Record<string, unknown>): Filtre => c as Filtre

export interface MatchResultat {
  soegning: string
  nyeTraef: number
}


/**
 * Finder nye træf for hver gemt søgning og lægger dem i køen.
 *
 * "Ny" er IKKE bare "vi så den efter søgningen blev oprettet". Ved den
 * første import af en kilde får hele dens bagkatalog `first_seen_at = nu`,
 * og så ville hver gemt søgning fyre på måneder gamle annoncer. En
 * prøvekørsel viste 68 falske varsler ud af 87, med en medianalder på 37
 * dage ved første syn.
 *
 * En bolig regnes derfor som ny, når vi så den efter søgningen blev
 * oprettet, OG
 *   · kilden siger, den er oprettet efter søgningen, ELLER
 *   · kilden oplyser ingen dato, men vi har overvåget den kilde i mindst
 *     et døgn — så er boligen dukket op MENS vi kiggede.
 *
 * Indsættelsen er `on conflict do nothing` på (søgning, bolig), så
 * matchningen kan køre igen og igen uden at varsle det samme to gange.
 */
/**
 * `kun` afgraenser matchningen til bestemte gemte soegninger. Produktionen
 * kalder uden — den skal ramme dem alle. Proeven kalder MED sin egen, og det
 * er ikke pynt: uden den skriver et proevekald alert_matches for hver eneste
 * rigtige brugers soegning, med `sent_at = null`, saa naeste import sender
 * dem. Raekkerne er i sig selv aegte — importen ville have skrevet dem en
 * time senere — men en proeve skal ikke udfoere produktionsarbejde for
 * fremmede, og slet ikke mens den proever, hvad der sker, naar en spaerring
 * fjernes.
 */
export async function matchAlarmer(kun?: string[]): Promise<MatchResultat[]> {
  const soegninger = await db
    .select({
      id: savedSearches.id,
      navn: savedSearches.name,
      kriterier: savedSearches.criteria,
      oprettet: savedSearches.createdAt,
    })
    .from(savedSearches)
    // Ubekraeftede soegninger matches ikke. En adresse, der ikke har
    // bekraeftet, har ikke bedt om noget.
    .where(kun
      ? and(isNotNull(savedSearches.confirmedAt), inArray(savedSearches.id, kun))
      : isNotNull(savedSearches.confirmedAt))

  // Hvornaar begyndte vi at kigge paa hver kilde? Bruges til kilder uden
  // egen dato: en bolig der dukker op efter indkoeringen, er ny.
  const foersteKoersel = new Map(
    (await db
      .select({ id: crawlRuns.sourceId, foerst: sql<Date>`min(${crawlRuns.startedAt})` })
      .from(crawlRuns).groupBy(crawlRuns.sourceId))
      .map((r) => [r.id, r.foerst]),
  )

  const ud: MatchResultat[] = []
  for (const s of soegninger) {
    // SQL luger det meste: set efter søgningen, og enten oprettet hos
    // kilden efter søgningen eller uden dato overhovedet.
    const traef = await db
      .select({
        id: listings.id,
        kilde: listings.sourceId,
        foerstSet: listings.firstSeenAt,
        hosKilden: listings.sourceCreatedAt,
        // Til availability-postfilteret: SQL finder den brede kandidat-
        // population; domaenet afgoer resten i JS. Ingen parallel
        // SQL-fortolkning, ingen legacy-fallback.
        kildeSlug: sources.slug,
        availabilityFacts: listings.availabilityFacts,
      })
      .from(listings)
      .innerJoin(sources, eq(sources.id, listings.sourceId))
      .where(and(
        hvor(somFiltre(s.kriterier)),
        gt(listings.firstSeenAt, s.oprettet),
        or(
          gt(listings.sourceCreatedAt, s.oprettet),
          isNull(listings.sourceCreatedAt),
        ),
        // ── Udlejerannoncer sendes IKKE ud ────────────────────────
        //
        // Umodereret brugerindhold, der lander i fremmedes indbakker, er
        // en spamvej, der er svær at lukke bagefter. Indtil der er en form
        // for moderation, bliver native boliger i soegningen — hvor
        // brugeren selv opsoeger dem — og ude af mailen.
        //
        // Det stod ikke skrevet nogen steder foer. De faldt ud ved et
        // TILFAELDE: filteret nedenfor slaar kildens foerste koersel op i
        // crawl_runs, og `native` har ingen koersler, saa opslaget gav
        // undefined. Den dag nogen saetter source_created_at paa en
        // udlejerannonce — hvad "udgivet den" naturligt ville vaere —
        // ville de begynde at gaa ud. Derfor staar det her, udtrykkeligt.
        ne(listings.sourceType, 'native'),
      ))

    // Kilder uden egen dato kan SQL ikke afgøre. Her kræves i stedet, at
    // boligen dukkede op, efter kilden havde været overvåget et døgn —
    // ellers er det bagkataloget fra første import.
    let gyldige = traef.filter((t) => {
      if (t.hosKilden) return true
      const foerst = foersteKoersel.get(t.kilde)
      if (!foerst) return false
      return +t.foerstSet > +new Date(foerst) + INDKOERING_TIMER * 3600_000
    })

    // ── Availability-filtrene ────────────────────────────────────
    // Samme domaeneregel som soegningen: hydrer facts, fortolk gennem
    // kildekontrakten, og match paa RESULTATET. En alarm gemt med «kan
    // overtages nu» maa ikke sende en bolig, domaenet kalder senere eller
    // unknown — det var praecis den skaevhed, der stod som kendt
    // afgraensning, og den er nu lukket.
    const fs = somFiltre(s.kriterier)
    if (harDomaenefilter(fs)) {
      const referenceNow = new Date()
      gyldige = gyldige.filter((t) =>
        matcherDomaene(fs, availabilityFor(
          { availabilityFacts: t.availabilityFacts, kilde: t.kildeSlug }, referenceNow)))
    }

    let nye = 0
    for (let i = 0; i < gyldige.length; i += 500) {
      const r = await db.insert(alertMatches)
        .values(gyldige.slice(i, i + 500).map((t) => ({ savedSearchId: s.id, listingId: t.id })))
        .onConflictDoNothing()
        .returning({ id: alertMatches.id })
      nye += r.length
    }
    if (nye) ud.push({ soegning: s.navn ?? s.id.slice(0, 8), nyeTraef: nye })
  }
  return ud
}

/** Alt der ligger og venter — grupperet, så det kan læses som den besked,
 *  der ville være sendt. */
/**
 * Hvad «venter» betyder, som ÉT udtryk.
 *
 * Eksporteret, fordi en MAALING skal gengive appens eget udtryk og ikke
 * skrive det af. `scripts/generer-alarmkoe-sql.ts` kalder `.toSQL()` paa
 * forespoergslen og klipper dens `from … where`-hale ud, saa den SQL,
 * der koeres i produktionen, er appens egen. Aendres betingelsen her,
 * aendres den genererede fil med — og proeven fejler, hvis den
 * committede fil ikke laengere svarer til det genererede.
 *
 * Udtraekket er Analytics' (d59c613), og det afloeser et forbehold, jeg
 * selv havde skrevet: at den haandskrevne SQL-fil kunne drive fra koden.
 *
 * `toSQL()` renderer kun og aabner ingen forbindelse — men `db` er en
 * lazy getter, der bygger klienten ved opslaget og kraever
 * `DATABASE_URL_DIRECT`. Generatoren koerer derfor under testbasen.
 */
export function ventendeForespoergsel() {
  return db
    .select({
      soegningId: savedSearches.id,
      soegning: savedSearches.name,
      kriterier: savedSearches.criteria,
      modtager: users.email,
      paaMail: savedSearches.notifyEmail,
      afmeldt: savedSearches.unsubscribedAt,
      token: savedSearches.unsubscribeToken,
      sidstSendt: savedSearches.lastNotifiedAt,
      matchId: alertMatches.id,
      matchetKl: alertMatches.matchedAt,
      adresse: listings.addressRaw,
      postnr: listings.postalCode,
      by: listings.city,
      areal: listings.sizeM2,
      vaerelser: listings.rooms,
      leje: listings.rentMonthly,
      total: listings.totalMonthly,
      indflytning: listings.moveInCost,
      // Til el-forbeholdet. Mailen skal sige det samme som kortet — samme
      // udledning, `eltilstand` i lib/eloplysning.ts.
      el: listings.utilitiesElectricity,
      elEgenMaaler: listings.electricityOwnMeter,
      poster: listings.totalMonthlyComponents,
      boligId: listings.id,
      kilde: sources.name,
      foerstSet: listings.firstSeenAt,
      hosKilden: listings.sourceCreatedAt,
      status: listings.status,
    })
    .from(alertMatches)
    .innerJoin(savedSearches, eq(savedSearches.id, alertMatches.savedSearchId))
    .innerJoin(users, eq(users.id, savedSearches.userId))
    .innerJoin(listings, eq(listings.id, alertMatches.listingId))
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    .where(and(isNull(alertMatches.sentAt), isNotNull(savedSearches.confirmedAt)))
    .orderBy(savedSearches.name, desc(alertMatches.matchedAt))
}

/** Alt der ligger og venter — grupperet pr. soegning. */
export async function ventende() {
  const raekker = await ventendeForespoergsel()

  const grupper = new Map<string, typeof raekker>()
  for (const r of raekker) {
    const n = grupper.get(r.soegningId) ?? []
    n.push(r)
    grupper.set(r.soegningId, n)
  }
  return [...grupper.values()]
}

/** Kriterierne som en linje, så det kan ses hvad søgningen faktisk beder om. */
export function beskrivFiltre(c: Record<string, unknown>): string {
  const f = somFiltre(c)
  const d: string[] = []
  if (f.by) d.push(`by ${f.by}`)
  if (f.postnr) d.push(`postnr ${f.postnr}`)
  if (f.prisMin != null) d.push(`fra ${(f.prisMin / 100).toLocaleString('da-DK')} kr.`)
  if (f.prisMax != null) d.push(`til ${(f.prisMax / 100).toLocaleString('da-DK')} kr.`)
  if (f.vaerelserMin != null) d.push(`mindst ${f.vaerelserMin} vær.`)
  if (f.arealMin != null) d.push(`mindst ${f.arealMin} m²`)
  if (f.kilder?.length) d.push(`kilder: ${f.kilder.join(', ')}`)
  if (f.fuldOekonomi) d.push('fuld økonomi kendt')
  // De nye filtre SKAL med her. Beskrivelsen står på bekræftelsessiden og i
  // gem-boksen, og en søgning, der filtrerer på mere, end den fortæller, er
  // en søgning brugeren ikke kan gennemskue.
  if (f.boligtyper?.length) d.push(f.boligtyper.map((t) => typeord(t) ?? t).join(' el. '))
  if (f.overtagelse === 'nu') d.push('kan overtages nu')
  if (f.overtagelse === 'senere') d.push('kan overtages senere')
  if (f.ansoegningsform === 'venteliste') d.push('venteliste')
  if (f.markedsstatus === 'reserveret') d.push('reserveret')
  if (f.kaeledyr) d.push('kæledyr tilladt')
  if (f.elevator) d.push('elevator')
  if (f.udeplads) d.push('altan el. terrasse')
  return d.length ? d.join(' · ') : 'ingen filtre — alle boliger'
}

/** Opret en søgning. Brugeren oprettes efter behov på mailadressen. */
export async function opretSoegning(
  mail: string, navn: string, kriterier: Filtre,
): Promise<string> {
  const [u] = await db.insert(users)
    .values({ email: mail })
    .onConflictDoUpdate({ target: users.email, set: { email: mail } })
    .returning({ id: users.id })
  const [s] = await db.insert(savedSearches)
    .values({ userId: u!.id, name: navn, criteria: kriterier as Record<string, unknown> })
    .returning({ id: savedSearches.id })
  return s!.id
}

export async function soegninger() {
  return db
    .select({
      id: savedSearches.id,
      navn: savedSearches.name,
      mail: users.email,
      kriterier: savedSearches.criteria,
      oprettet: savedSearches.createdAt,
      ventende: sql<number>`(select count(*)::int from alert_matches m
        where m.saved_search_id = ${savedSearches.id} and m.sent_at is null)`,
    })
    .from(savedSearches)
    .innerJoin(users, eq(users.id, savedSearches.userId))
    .orderBy(asc(savedSearches.createdAt))
}

// ═══════════════════════════════════════════════════════════════
//  Afsendelse.
// ═══════════════════════════════════════════════════════════════

import { inArray } from 'drizzle-orm'
import { maaSendeTil, sendMail } from './mail'
import { eltilstand, type Eltilstand } from './eloplysning'

/**
 * Mailens ord for hver el-tilstand — BUNDET til unionen.
 *
 * ── HVORFOR DET ER ET RECORD OG IKKE EN TERNAERKAEDE ──────────
 *
 * Udledningen er ét sted (`eltilstand`), og det var den aldrig i tvivl
 * om. OVERSAETTELSEN til tekst var derimod en ternaerkaede med
 * fald-igennem, og det samme er den paa de tre andre flader:
 *
 *     app/Boligkort.tsx          → 'El indgår ikke — udlejer oplyser …'
 *     app/bolig/[id]/page.tsx    → 'El indgår ikke i beløbet. …'
 *     lib/grundlag.ts elUdsagn   → null
 *     her                        → 'el indgår ikke — udlejer oplyser …'
 *
 * En FEMTE `Eltilstand` ville derfor tavst faa den paastand, de tre
 * foerste har til faelles — og det er netop den, den FJERDE tilstand
 * blev indfoert for at undgaa paa 254 boliger. `elUdsagn` er den
 * grimmeste: den ville sige INGENTING.
 *
 * CLAUDE.md siger udtrykkeligt, at teksterne ER forskellige de fire
 * steder, «fordi der er forskellig plads; spoergsmaalet besvares kun ét
 * sted». Rettelsen er derfor IKKE at dele teksten — det ville bryde den
 * regel. Den er at goere hver oversaettelse UDTOEMMENDE, saa en femte
 * vaerdi er en oversaetterfejl paa hver flade i stedet for en tavs
 * paastand. Her er den ene af de fire.
 *
 * `null` = der skal ingen linje staa.
 */
const ELTEKST = {
  med: null,
  'egen-maaler': 'el afregnes direkte med elselskabet',
  'ukendt-daekning': 'aconto er ét samlet beløb — det fremgår ikke om el er med',
  'ikke-med': 'el indgår ikke — udlejer oplyser ikke hvordan',
} as const satisfies Record<Eltilstand, string | null>

/** Højst én mail i timen per søgning, uanset hvor tit importen kører. */
const MINDST_MELLEM_MAILS_MIN = 60

const BASE = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
const kr = (o: number | null) => o == null ? '—' : (o / 100).toLocaleString('da-DK')
const und = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export interface SendResultat {
  soegning: string
  modtager: string
  /** Antal boliger i MAILEN — altsaa de sendbare, ikke hele koeen. */
  antal: number
  /**
   * Traef, der laa i koeen, men hvis bolig er taget ned. Mailes ikke.
   *
   * Et FELT og ikke en saetning i `grund`. Et tal kan maales; en streng
   * skal parses for at blive til et tal, og saa er optaellingen bundet
   * til ordlyden. Formen er Analytics' (d59c613).
   */
  udeladt: number
  sendt: boolean
  grund?: string
}


/**
 * Én raekke fra `ventende()` — UDLEDT af selecten, ikke skrevet af.
 *
 * `Awaited<ReturnType<…>>[number][number]`: fjerner nogen en kolonne
 * fra `ventende()`s select, bliver `byggAlarmmail` en oversaetterfejl i
 * stedet for at laese `undefined`. En haandskrevet shape her ville vaere
 * endnu et udtryk for det samme spoergsmaal.
 */
type Ventende = Awaited<ReturnType<typeof ventende>>[number][number]

/**
 * Maa denne bolig naevnes i en mail?
 *
 * Eksporteret, saa PROEVEN kan kalde det samme udtryk, afsendelsen
 * kalder. Foerste udgave af proeven filtrerede selv med
 * `.filter(b => b.status === 'active')` og maalte dermed sit eget
 * forlaeg: modproeven, der fjernede filteret, blev kun roed paa
 * kildetjekket — ikke paa en enkelt paastand om teksten. Det er
 * `proevens-eget-forlaeg` fra faeldetabellen, i en proeve skrevet samme
 * dag som raekken.
 *
 * Navnet er Analytics' (d59c613) og er bedre end det, der stod her
 * foer (`kunAktive`): det navngiver SPOERGSMAALET og ikke mekanismen,
 * og som praedikat pr. raekke kan `scripts/alarm.ts` bruge det til at
 * saette sin egen etiket i stedet for at gentage `=== 'delisted'`.
 */
export const maaMailes = (b: { status: string }): boolean => b.status === 'active'

/**
 * Mailens krop — UDTRUKKET, saa den kan proeves.
 *
 * Teksten blev foer bygget inde i `sendAlarmer` og fandtes kun som
 * argumenter til `sendMail`. Ingen proeve kunne derfor laese, hvad der
 * faktisk stod i en alarmmail: `npm test` kalder ikke `sendAlarmer`, og
 * selv hvis den gjorde, returnerer den kun `{ sendt, grund }`.
 *
 * Det er samme form som `Ellinje`: ét sted at stille spoergsmaalet, og
 * saa kan det proeves. `scripts/test-alarmmail.ts` gengiver begge
 * udgaver — ren tekst og HTML — og de tre rettelser i denne commit er
 * hver bundet til en modproeve, der bliver roed.
 *
 * REN: ingen database, intet netvaerk. Den faar raekkerne ind.
 */
export function byggAlarmmail(
  g: readonly Ventende[], f: Ventende, navn: string,
): { emne: string; tekst: string; html: string; afmeldUrl: string; afmeldPost: string } {
  const kriterier = somFiltre(f.kriterier)
  const harGraense = kriterier.prisMin != null || kriterier.prisMax != null
  const afmeldUrl = `${BASE}/afmeld/${f.token}`
  const afmeldPost = `${BASE}/api/afmeld?t=${f.token}`
  const emne = `${g.length} ${g.length === 1 ? 'ny bolig' : 'nye boliger'} — ${navn}`

  const linjer = g.map((b) => {
    const pris = b.total != null
      ? `${kr(b.total)} kr/md til udlejer`
      : `${kr(b.leje)} kr/md i husleje — total ukendt, aconto ikke oplyst`
    const indf = b.indflytning != null ? ` · indflytning ${kr(b.indflytning)} kr.` : ''
    // Ét sted, ligesom paa kortene. Mailen maa ikke sige "el indgaar
    // ikke" om et beloeb, vi ikke kender indholdet af.
    const t = eltilstand(b)
    const elnote = t == null ? null : ELTEKST[t]
    const maal = [b.areal && `${b.areal} m²`, b.vaerelser && `${b.vaerelser} vær.`]
      .filter(Boolean).join(' · ')
    return { adresse: b.adresse, maal, pris, indf, elnote,
      url: `${BASE}/bolig/${b.boligId}`, kilde: b.kilde,
      // TO SPOERGSMAAL, TO FELTER. `uvis` var ét felt og besvarede
      // begge: om prisblokken skal vaere groen, OG om forbeholdet om
      // «din graense» skal staa. De er ikke det samme, og en naiv
      // rettelse af det andet ville have gjort en bolig UDEN kendt
      // total GROEN — praecis den fejl, #14624f-reglen handler om.
      ukendtTotal: b.total == null,
      overGraense: b.total == null && harGraense }
  })

  const tekst = [
    `${g.length} ${g.length === 1 ? 'ny bolig matcher' : 'nye boliger matcher'} "${navn}"`,
    beskrivFiltre(f.kriterier),
    '',
    ...linjer.flatMap((l) => [
      l.adresse, `  ${l.maal}`, `  ${l.pris}${l.indf}`,
      ...(l.elnote ? [`  ${l.elnote}`] : []),
      ...(l.overGraense ? ['  OBS: kan være dyrere end din grænse — den er sat på huslejen alene.'] : []),
      `  ${l.url}`, '',
    ]),
    `Afmeld: ${afmeldUrl}`,
  ].join('\n')

  const html = `<div style="font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:#14161a;max-width:600px">
<p style="margin:0 0 4px"><strong>${g.length} ${g.length === 1 ? 'ny bolig' : 'nye boliger'}</strong> matcher «${und(navn)}»</p>
<p style="margin:0 0 20px;color:#5f6672;font-size:13px">${und(beskrivFiltre(f.kriterier))}</p>
${linjer.map((l) => `<div style="border-top:1px solid #e8e5de;padding:14px 0">
<a href="${l.url}" style="font-size:16px;font-weight:600;color:#14161a;text-decoration:none">${und(l.adresse)}</a>
<div style="color:#5f6672;font-size:13px;margin-top:3px">${und(l.maal)}</div>
<div style="margin-top:7px;font-weight:600;color:${l.ukendtTotal ? '#14161a' : '#14624f'}">${und(l.pris)}</div>
${l.indf ? `<div style="color:#5f6672;font-size:13px">${und(l.indf.replace(' · ', ''))}</div>` : ''}
${l.elnote ? `<div style="color:#9aa1ac;font-size:12px;margin-top:4px">${und(l.elnote.charAt(0).toUpperCase() + l.elnote.slice(1))}</div>` : ''}
${l.overGraense ? '<div style="color:#8a5300;font-size:12.5px;margin-top:5px">Kan være dyrere end din grænse — den er sat på huslejen alene.</div>' : ''}
<div style="color:#9aa1ac;font-size:12px;margin-top:6px">${und(l.kilde)}</div>
</div>`).join('')}
<p style="margin:22px 0 0;color:#9aa1ac;font-size:12px">
Du får denne mail, fordi du har gemt en søgning på Bofinda.
<a href="${afmeldUrl}" style="color:#9aa1ac">Afmeld</a>.</p></div>`
  return { emne, tekst, html, afmeldUrl, afmeldPost }
}

/**
 * Sender én mail per søgning med ventende træf, og sætter sent_at.
 *
 * Rækkefølgen er med vilje: mailen sendes FØRST, sent_at bagefter. Fejler
 * afsendelsen, står træffene stadig i køen og prøves igen. Modsat ville en
 * fejlet mail betyde, at boligerne var markeret sendt uden nogensinde at
 * være det — og det opdager ingen.
 */
export async function sendAlarmer(): Promise<SendResultat[]> {
  const grupper = await ventende()
  const ud: SendResultat[] = []

  for (const alle of grupper) {
    const f = alle[0]!
    const navn = f.soegning ?? 'din søgning'

    // ── BOLIGER, DER ER TAGET NED SIDEN MATCHET, UDGAAR ─────────
    //
    // `ventende()` HENTER `status` og filtrerede ikke paa den, og
    // `sendAlarmer` naevnte feltet ikke. Vinduet er ikke teoretisk, det
    // er designet: spaerretiden nedenfor udskyder op til en time, en
    // fejlet afsendelse lader traeffet staa i koeen med vilje, og
    // `ALARM_TILLADTE_MODTAGERE` springer modtagere over UDEN at saette
    // `sent_at` — saa et traef kan ligge i ugevis og derefter gaa ud.
    // Imens kan afmeldingen have taget boligen.
    //
    // De to andre flader, der viser samme raekke, siger det begge:
    // `scripts/alarm.ts` skriver «⚠ IKKE LAENGERE LEDIG», og Min side
    // skriver «Ikke laengere tilgaengelig». Mailen er den eneste, der
    // lander UOPFORDRET — og var den eneste, der ikke spurgte.
    //
    // ── HVORFOR DEN UDGAAR HELT, OG IKKE BARE MAERKES ───────────
    //
    // Emnet taeller boliger («1 ny bolig»). En uopfordret mail, hvis
    // eneste indhold er en bolig, hun ikke kan faa, er en mail, der
    // ikke skulle vaere sendt — emnet ville skulle sige 0. Er der ANDRE
    // boliger i gruppen, sendes de; da holder loftet praecis: hver
    // bolig i mailen er én, hun kan handle paa.
    //
    // Filtreringen sker HER og ikke i `ventende()`, fordi
    // forhaandsvisningen bruger samme funktion og SKAL se dem — den
    // findes for, at et menneske kan efterse koeen foer afsendelse.
    const g = alle.filter(maaMailes)
    const nedtaget = alle.length - g.length
    if (g.length === 0) {
      ud.push({ soegning: navn, modtager: f.modtager, antal: 0, udeladt: nedtaget,
        sendt: false, grund: `alle ${nedtaget} boliger er taget ned siden matchet` })
      continue
    }

    if (!f.paaMail || f.afmeldt) {
      // Hele koeen staar som `antal`: afmeldingen rammer alt, og de
      // nedtagne er ikke engang VURDERET her — `udeladt` er derfor 0 og
      // ikke udeladt. Et felt, der mangler, og et felt, der er nul, er
      // to forskellige udsagn, og her er nul det sande.
      ud.push({ soegning: navn, modtager: f.modtager, antal: alle.length, udeladt: 0,
        sendt: false, grund: 'afmeldt — mail slået fra' })
      continue
    }
    if (f.sidstSendt && Date.now() - +f.sidstSendt < MINDST_MELLEM_MAILS_MIN * 60_000) {
      const min = Math.round((MINDST_MELLEM_MAILS_MIN * 60_000 - (Date.now() - +f.sidstSendt)) / 60_000)
      ud.push({ soegning: navn, modtager: f.modtager, antal: g.length, udeladt: nedtaget,
        sendt: false, grund: `sendt for nylig — venter ${min} min.` })
      continue
    }

    // ── «DIN GRAENSE» KUN NAAR DER FINDES EN ───────────────────
    // Forbeholdet «Kan vaere dyrere end din graense — den er sat paa
    // huslejen alene» fyrede paa `total == null` alene, uanset om
    // soegningen HAVDE en prisgraense. En bekraeftet soegning paa
    // «postnr 2300 · mindst 3 vaer.» fik saetningen paa hver bolig uden
    // kendt total — om en graense, hun aldrig satte. Mailens egen
    // filterlinje naevner ingen graense, saa mailen modsagde sig selv i
    // samme vindue.
    //
    // Soegesiden har praecis denne vagt (app/page.tsx), og dens
    // kommentar siger «Det er den samme regel som kortet og gem-boksen
    // foelger» — mailen var ikke naevnt og foelger den ikke. Nu goer den.
    const { emne, tekst, html, afmeldUrl, afmeldPost } = byggAlarmmail(g, f, navn)

    const r = await sendMail({ til: f.modtager, emne, tekst, html,
      afmeldUrl: afmeldPost, afmeldSideUrl: afmeldUrl })
    if (r.sendt) {
      // Først når mailen ER afsendt.
      await db.update(alertMatches)
        .set({ sentAt: sql`now()` })
        .where(inArray(alertMatches.id, g.map((x) => x.matchId)))
      await db.update(savedSearches)
        .set({ lastNotifiedAt: sql`now()` })
        .where(eq(savedSearches.id, f.soegningId))
    }
    ud.push({ soegning: navn, modtager: f.modtager, antal: g.length,
      udeladt: nedtaget, sendt: r.sendt, grund: r.grund })
  }
  return ud
}

/** Afmelding. Slår mail fra; søgningen og køen bevares. */
export async function afmeld(token: string): Promise<{ navn: string | null } | null> {
  const [s] = await db.update(savedSearches)
    .set({ notifyEmail: false, unsubscribedAt: sql`now()` })
    .where(eq(savedSearches.unsubscribeToken, token))
    .returning({ navn: savedSearches.name })
  return s ?? null
}

export async function findPaaToken(token: string) {
  const [s] = await db
    .select({ navn: savedSearches.name, afmeldt: savedSearches.unsubscribedAt })
    .from(savedSearches)
    .where(eq(savedSearches.unsubscribeToken, token))
    .limit(1)
  return s ?? null
}

export { maaSendeTil }

// ═══════════════════════════════════════════════════════════════
//  Dobbelt tilmelding.
//
//  Uden den kunne enhver tilmelde en fremmed adresse til en strøm af
//  mail. Søgningen gemmes, men varsler intet, før adressens ejer har
//  trykket på knappen i bekræftelsesmailen.
// ═══════════════════════════════════════════════════════════════

/** Højst så mange ubekræftede søgninger per adresse. Bremser at nogen
 *  bruger formularen som mailkanon mod en fremmed. */
const MAKS_UBEKRAEFTEDE = 3
/** Og højst én bekræftelsesmail per adresse i dette interval. */
const MELLEM_BEKRAEFTELSER_MIN = 10

export type OpretSvar =
  | { slags: 'sendt'; mail: string }
  | { slags: 'spaerret'; grund: string }
  | { slags: 'for-mange' }
  | { slags: 'for-hurtigt'; minutter: number }
  | { slags: 'ugyldig-mail' }

const MAIL_MOENSTER = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i

export async function tilmeld(
  mail: string, navn: string, kriterier: Filtre,
): Promise<OpretSvar> {
  const adresse = mail.trim().toLowerCase()
  if (!MAIL_MOENSTER.test(adresse) || adresse.length > 200) return { slags: 'ugyldig-mail' }

  const [u] = await db.insert(users)
    .values({ email: adresse })
    .onConflictDoUpdate({ target: users.email, set: { email: adresse } })
    .returning({ id: users.id })

  const ubekraeftede = await db
    .select({ id: savedSearches.id, oprettet: savedSearches.createdAt })
    .from(savedSearches)
    .where(and(eq(savedSearches.userId, u!.id), isNull(savedSearches.confirmedAt)))
  if (ubekraeftede.length >= MAKS_UBEKRAEFTEDE) return { slags: 'for-mange' }

  const nyeste = ubekraeftede.map((x) => +x.oprettet).sort((a, b) => b - a)[0]
  if (nyeste) {
    const gaaet = (Date.now() - nyeste) / 60_000
    if (gaaet < MELLEM_BEKRAEFTELSER_MIN) {
      return { slags: 'for-hurtigt', minutter: Math.ceil(MELLEM_BEKRAEFTELSER_MIN - gaaet) }
    }
  }

  const [s] = await db.insert(savedSearches)
    .values({ userId: u!.id, name: navn, criteria: kriterier as Record<string, unknown> })
    .returning({ id: savedSearches.id, token: savedSearches.confirmToken })

  const url = `${BASE}/bekraeft/${s!.token}`
  const r = await sendMail({
    til: adresse,
    emne: 'Bekræft din boligbesked på Bofinda',
    afmeldUrl: url,
    tekst: [
      `Du — eller nogen — har bedt om besked, når der kommer nye boliger, der matcher:`,
      `  ${navn}`,
      `  ${beskrivFiltre(kriterier as Record<string, unknown>)}`,
      '',
      'Bekræft her, så begynder vi at sende:',
      `  ${url}`,
      '',
      'Var det ikke dig, skal du ikke gøre noget. Uden bekræftelse sender vi intet,',
      'og søgningen bliver aldrig aktiv.',
    ].join('\n'),
    html: `<div style="font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:#14161a;max-width:560px">
<p>Du — eller nogen — har bedt om besked, når der kommer nye boliger, der matcher:</p>
<p style="margin:14px 0;padding:12px 14px;background:#f4f2ec;border-radius:8px">
<strong>${navn.replace(/[<>&]/g, '')}</strong><br>
<span style="color:#5f6672;font-size:13px">${beskrivFiltre(kriterier as Record<string, unknown>).replace(/[<>&]/g, '')}</span></p>
<p><a href="${url}" style="display:inline-block;background:#14624f;color:#fff;text-decoration:none;padding:11px 20px;border-radius:7px;font-weight:600">Bekræft og få besked</a></p>
<p style="color:#9aa1ac;font-size:12.5px;margin-top:20px">
Var det ikke dig, skal du ikke gøre noget. Uden bekræftelse sender vi intet,
og søgningen bliver aldrig aktiv.</p></div>`,
  })

  if (!r.sendt) return { slags: 'spaerret', grund: r.grund ?? 'ukendt' }
  return { slags: 'sendt', mail: adresse }
}

export async function bekraeft(token: string): Promise<{ navn: string | null } | null> {
  const [s] = await db.update(savedSearches)
    .set({ confirmedAt: sql`now()` })
    .where(and(eq(savedSearches.confirmToken, token), isNull(savedSearches.confirmedAt)))
    .returning({ navn: savedSearches.name, kriterier: savedSearches.criteria })
  if (s) {
    // MAALINGEN LIGGER HER, i den gren hvor overgangen faktisk skete:
    // confirmed_at NULL -> timestamp. UPDATE'ens `isNull(confirmedAt)`
    // gør den atomisk, saa to samtidige requests ikke kan give to events.
    //
    // Fallback-grenen nedenfor — «allerede bekraeftet» — fyrer INTET.
    // Mailscannere aabner hvert link i en mail, og et event dér ville
    // taelle modtagerens egen mailserver som en bekraeftelse.
    //
    // Hverken mailadressen, navnet paa soegningen eller saved_search_id
    // maa med. Det sidste er en direkte join-noegle til en raekke med en
    // mailadresse.
    const { spor } = await import('./maaling-server')
    await spor({
      navn: 'alert_confirmed',
      props: {
        filtertyper: Object.entries((s.kriterier ?? {}) as Record<string, unknown>)
          .filter(([k, v]) => k !== 'sorter' && v != null && v !== false
            && !(Array.isArray(v) && v.length === 0))
          .map(([k]) => k).slice(0, 20),
      },
    }, '/bekraeft/[token]')
    return { navn: s.navn }
  }
  // Allerede bekraeftet? Sig det pænt i stedet for at ligne en fejl.
  const [fandtes] = await db
    .select({ navn: savedSearches.name })
    .from(savedSearches).where(eq(savedSearches.confirmToken, token)).limit(1)
  return fandtes ?? null
}

export async function findPaaBekraeftToken(token: string) {
  const [s] = await db
    .select({ navn: savedSearches.name, bekraeftet: savedSearches.confirmedAt,
      kriterier: savedSearches.criteria })
    .from(savedSearches).where(eq(savedSearches.confirmToken, token)).limit(1)
  return s ?? null
}

// ═══════════════════════════════════════════════════════════════
//  Oprydning.
//
//  Findes for at privatlivspolitikken er sand. Står der, at vi sletter
//  efter 30 dage, skal noget faktisk slette efter 30 dage — ellers er
//  teksten en påstand, ikke en beskrivelse.
//
//  Kører i den faste importkørsel. Sletninger er uigenkaldelige, så hver
//  regel er snæver og navngivet, og der logges kun når noget faktisk gik.
// ═══════════════════════════════════════════════════════════════

const UBEKRAEFTET_DAGE = 30
const AFMELDT_DAGE = 90
const ALDER_MAANEDER = 24

export interface RydResultat {
  ubekraeftede: number
  afmeldte: number
  forgamle: number
  foraeldreloese: number
}

export async function ryd(): Promise<RydResultat> {
  // 1. Aldrig bekræftet. Der er aldrig givet samtykke, så der er intet
  //    grundlag for at beholde adressen.
  const a = await db.delete(savedSearches)
    .where(and(
      isNull(savedSearches.confirmedAt),
      lt(savedSearches.createdAt, sql`now() - interval '${sql.raw(String(UBEKRAEFTET_DAGE))} days'`),
    ))
    .returning({ id: savedSearches.id })

  // 2. Afmeldt. Søgningen beholdes en periode, så den kan slås til igen,
  //    og forsvinder derefter.
  const b = await db.delete(savedSearches)
    .where(and(
      isNotNull(savedSearches.unsubscribedAt),
      lt(savedSearches.unsubscribedAt, sql`now() - interval '${sql.raw(String(AFMELDT_DAGE))} days'`),
    ))
    .returning({ id: savedSearches.id })

  // 3. For gammel. Undtagelsen er per BRUGER, ikke per søgning: har hun
  //    oprettet en nyere søgning i mellemtiden, er hun stadig aktiv, og
  //    så røres ingen af hendes søgninger.
  const c = await db.delete(savedSearches)
    .where(and(
      lt(savedSearches.createdAt, sql`now() - interval '${sql.raw(String(ALDER_MAANEDER))} months'`),
      sql`not exists (
        select 1 from saved_searches nyere
        where nyere.user_id = ${savedSearches.userId}
          and nyere.created_at >= now() - interval '${sql.raw(String(ALDER_MAANEDER))} months')`,
    ))
    .returning({ id: savedSearches.id })

  // 4. Alarmbrugerrækker, der ikke længere har noget formål.
  //
  //    Begrundelsen er uændret: en mailadresse, der kun blev oprettet
  //    for at bære en gemt søgning, har intet formål, når søgningen er
  //    væk. Men `users` bærer ikke kun alarmens adresser. `opretSoegning`
  //    genbruger rækken på mailadressen (`onConflictDoUpdate`), så den
  //    samme række kan være en KONTO med favoritter, en udlejer med
  //    annoncer eller en part i en samtale.
  //
  //    Prædikatet var derfor bredere end begrundelsen — det spurgte KUN
  //    om `saved_searches` — og det gik galt på to måder:
  //
  //    · HØJT. `listings.landlord_id`, `conversations.tenant_id`,
  //      `conversations.landlord_id` og `messages.sender_id` er
  //      ON DELETE NO ACTION. Postgres kaster, `ryd()` bobler op gennem
  //      `scripts/import.ts`, og kørslen stopper på linjen FØR
  //      betalingstilsynet, `matchAlarmer()` og `sendAlarmer()`. Det er
  //      dét, der sker i produktionen i dag: alle kilder når igennem,
  //      og så dør kørslen. Ingen får besked om nye boliger.
  //    · STILLE. `favorites` og `subscriptions` er ON DELETE CASCADE.
  //      Der er ingen spærring: rækken forsvinder, favoritterne med den,
  //      og intet kaster. Den halvdel har endnu ikke nået noget — der er
  //      i dag én kandidat, og den har kastet fra første kørsel — men
  //      den venter kun på en kandidat uden en NO ACTION-reference.
  //
  //    Rettelsen er at spørge om ALLE fremmednøgler til `users` plus de
  //    to bindinger, der ikke er fremmednøgler her: kontoen
  //    (`auth_user_id`) og Stripe-kunden. En konto uden favoritter og
  //    uden søgninger er ikke overflødig — hun har bare ikke nået noget
  //    endnu.
  //
  //    Fremmednøglerne bliver stående, og der er ingen try/catch: kaster
  //    den her sætning, er der en relation, listen ikke kender, og så
  //    SKAL kørslen stoppe, indtil et menneske har set på den. En fanget
  //    fejl ville gøre den næste manglende relation usynlig.
  //
  //    `haendelser.user_id` er med vilje IKKE på listen. Den er den
  //    eneste user-kolonne uden fremmednøgle, netop fordi den skal kunne
  //    nulstilles ved sletteret — se db/schema.ts. Den må ikke holde en
  //    tom alarmrække i live.
  //
  //    LISTEN ER TILSTRÆKKELIG HER, IKKE FULDSTÆNDIG. Betalingsgrenen
  //    tilføjer `drift.aendret_af` (0021) og `checkout_forsoeg.user_id`
  //    (0024); ingen af de to tabeller findes i denne grens migrationer,
  //    som slutter ved 0020. Begge hører til konti, så `auth_user_id is
  //    null` fanger dem allerede — men den dag de kommer med, skal de
  //    navngives, for listen skal være fuldstændig og ikke bare nok.
  const d = await db.delete(users)
    .where(and(
      isNull(users.authUserId),
      isNull(users.stripeCustomerId),
      sql`not exists (select 1 from saved_searches t where t.user_id = ${users.id})`,
      sql`not exists (select 1 from favorites     t where t.user_id = ${users.id})`,
      sql`not exists (select 1 from subscriptions t where t.user_id = ${users.id})`,
      sql`not exists (select 1 from listings      t where t.landlord_id = ${users.id})`,
      sql`not exists (select 1 from conversations t where t.tenant_id = ${users.id})`,
      sql`not exists (select 1 from conversations t where t.landlord_id = ${users.id})`,
      sql`not exists (select 1 from messages      t where t.sender_id = ${users.id})`,
    ))
    .returning({ id: users.id })

  return {
    ubekraeftede: a.length, afmeldte: b.length,
    forgamle: c.length, foraeldreloese: d.length,
  }
}
