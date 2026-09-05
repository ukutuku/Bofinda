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
import { hvor, type Filtre } from './soeg'

/** Kriterierne gemmes som `Filtre`. Læses tilbage med samme form. */
const somFiltre = (c: Record<string, unknown>): Filtre => c as Filtre

export interface MatchResultat {
  soegning: string
  nyeTraef: number
}

/** Hvor længe en kilde skal have været overvåget, før en bolig uden
 *  dato fra kilden kan regnes som ny. */
const INDKOERING_TIMER = 24

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
    const gyldige = traef.filter((t) => {
      if (t.hosKilden) return true
      const foerst = foersteKoersel.get(t.kilde)
      if (!foerst) return false
      return +t.foerstSet > +new Date(foerst) + INDKOERING_TIMER * 3600_000
    })

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
export async function ventende() {
  const raekker = await db
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

  const grupper = new Map<string, typeof raekker>()
  for (const r of raekker) {
    const n = grupper.get(r.soegningId) ?? []
    n.push(r)
    grupper.set(r.soegningId, n)
  }
  return [...grupper.values()]
}

/** Kriterierne som en linje, så det kan ses hvad søgningen faktisk beder om. */
const TYPENAVN: Record<string, string> = {
  lejlighed: 'lejlighed', hus: 'hus', raekkehus: 'rækkehus',
  vaerelse: 'værelse', studiebolig: 'studiebolig', andet: 'anden bolig',
}

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
  if (f.boligtyper?.length) d.push(f.boligtyper.map((t) => TYPENAVN[t] ?? t).join(' el. '))
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
import { eltilstand } from './eloplysning'

/** Højst én mail i timen per søgning, uanset hvor tit importen kører. */
const MINDST_MELLEM_MAILS_MIN = 60

const BASE = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
const kr = (o: number | null) => o == null ? '—' : (o / 100).toLocaleString('da-DK')
const und = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export interface SendResultat {
  soegning: string
  modtager: string
  antal: number
  sendt: boolean
  grund?: string
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

  for (const g of grupper) {
    const f = g[0]!
    const navn = f.soegning ?? 'din søgning'

    if (!f.paaMail || f.afmeldt) {
      ud.push({ soegning: navn, modtager: f.modtager, antal: g.length,
        sendt: false, grund: 'afmeldt — mail slået fra' })
      continue
    }
    if (f.sidstSendt && Date.now() - +f.sidstSendt < MINDST_MELLEM_MAILS_MIN * 60_000) {
      const min = Math.round((MINDST_MELLEM_MAILS_MIN * 60_000 - (Date.now() - +f.sidstSendt)) / 60_000)
      ud.push({ soegning: navn, modtager: f.modtager, antal: g.length,
        sendt: false, grund: `sendt for nylig — venter ${min} min.` })
      continue
    }

    // Siden til mennesker; POST-ruten til mailklientens ét-klik.
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
      const elnote = t == null || t === 'med' ? null
        : t === 'egen-maaler' ? 'el afregnes direkte med elselskabet'
          : t === 'ukendt-daekning' ? 'aconto er ét samlet beløb — det fremgår ikke om el er med'
            : 'el indgår ikke — udlejer oplyser ikke hvordan'
      const maal = [b.areal && `${b.areal} m²`, b.vaerelser && `${b.vaerelser} vær.`]
        .filter(Boolean).join(' · ')
      return { adresse: b.adresse, maal, pris, indf, elnote,
        url: `${BASE}/bolig/${b.boligId}`, kilde: b.kilde, uvis: b.total == null }
    })

    const tekst = [
      `${g.length} ${g.length === 1 ? 'ny bolig matcher' : 'nye boliger matcher'} "${navn}"`,
      beskrivFiltre(f.kriterier),
      '',
      ...linjer.flatMap((l) => [
        l.adresse, `  ${l.maal}`, `  ${l.pris}${l.indf}`,
        ...(l.elnote ? [`  ${l.elnote}`] : []),
        ...(l.uvis ? ['  OBS: kan være dyrere end din grænse — den er sat på huslejen alene.'] : []),
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
<div style="margin-top:7px;font-weight:600;color:${l.uvis ? '#14161a' : '#14624f'}">${und(l.pris)}</div>
${l.indf ? `<div style="color:#5f6672;font-size:13px">${und(l.indf.replace(' · ', ''))}</div>` : ''}
${l.elnote ? `<div style="color:#9aa1ac;font-size:12px;margin-top:4px">${und(l.elnote.charAt(0).toUpperCase() + l.elnote.slice(1))}</div>` : ''}
${l.uvis ? '<div style="color:#8a5300;font-size:12.5px;margin-top:5px">Kan være dyrere end din grænse — den er sat på huslejen alene.</div>' : ''}
<div style="color:#9aa1ac;font-size:12px;margin-top:6px">${und(l.kilde)}</div>
</div>`).join('')}
<p style="margin:22px 0 0;color:#9aa1ac;font-size:12px">
Du får denne mail, fordi du har gemt en søgning på Bofinda.
<a href="${afmeldUrl}" style="color:#9aa1ac">Afmeld</a>.</p></div>`

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
      sendt: r.sendt, grund: r.grund })
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
    .returning({ navn: savedSearches.name })
  if (s) return s
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

  // 4. Brugere uden nogen søgning. En mailadresse uden en søgning bag er
  //    en oplysning uden formål.
  const d = await db.delete(users)
    .where(sql`not exists (select 1 from saved_searches ss where ss.user_id = ${users.id})`)
    .returning({ id: users.id })

  return {
    ubekraeftede: a.length, afmeldte: b.length,
    forgamle: c.length, foraeldreloese: d.length,
  }
}
