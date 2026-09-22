// ═══════════════════════════════════════════════════════════════
//  OPSIGELSEN — genoptagelig, og planafstemningen autoritativ.
//
//  ── HVORFOR FILEN FINDES ────────────────────────────────────
//  Tre steder svarer paa det samme spoergsmaal: «styrer den her plan
//  stadig abonnementet, og maa vi slippe den?» Kundens egen opsigelse
//  (`sigOpFor` i lib/abonnement.ts), tilsynets sikkerhedsstop
//  (`stopForkertFornyelse` i lib/webhook.ts) og genoptagelsen af en
//  halvt gennemfoert opsigelse. De to foerste svarede hver for sig, og
//  begge svarede forkert paa hver sin maade.
//
//  Filen ligger for sig, fordi baade `lib/abonnement.ts` og
//  `lib/webhook.ts` skal bruge den. Den maa derfor ikke importere
//  nogen af dem — og den maa ikke traekke `./auth` med, som haenger
//  `next/headers` paa workeren.
//
//  ── HVAD STRIPE FAKTISK SIGER ───────────────────────────────
//  Alt herunder staar i den installerede SDK's egne typer, ikke i en
//  formodning:
//
//   · `release` virker KUN paa en plan i `not_started` eller `active`
//     (SubscriptionSchedules.d.ts:39). Et genforsoeg paa en allerede
//     frigivet plan fejler — og det var netop dét, der laaste
//     opsigelsen fast: hvert genforsoeg doede paa `release`, FOER det
//     naaede `subscriptions.update`.
//   · En frigivet plan faar sin `subscription` FJERNET; id'et flyttes
//     til `released_subscription` (samme linje, og :104-116). En plan
//     med de rigtige faser er derfor ikke bevis for, at den stadig
//     styrer noget.
//   · `status` er `active | canceled | completed | not_started |
//     released` (:267).
// ═══════════════════════════════════════════════════════════════

import { and, asc, count, eq, inArray, isNotNull, isNull, lte, notInArray, or, sql, type SQL } from 'drizzle-orm'
import { db } from '../db/client'
import { subscriptions } from '../db/schema'
import { stripe, type Stripeopsaetning } from './stripe'

/** Statusser, hvor en plan stadig kan styre et abonnement. */
export const PLAN_LEVENDE = ['active', 'not_started'] as const

/** Id'et, uanset om Stripe gav en streng eller et objekt. */
const idAf = (v: unknown): string | null =>
  typeof v === 'string' ? v
  : typeof (v as { id?: unknown } | null)?.id === 'string' ? (v as { id: string }).id
  : null

/**
 * GAELDER planen stadig for DET HER abonnement?
 *
 * To led, og begge er noedvendige:
 *  · status er `active` eller `not_started` — alt andet kan ikke
 *    slippes og styrer ingenting
 *  · `subscription` peger paa netop det abonnement, vi spoerger om
 *
 * Det andet led er det, en faseligning ikke kan svare paa. En frigivet
 * plan beholder sine faser; den styrer bare ikke laengere noget. Uden
 * leddet svarede sikkerhedskontrollen «planen er rigtig» om en plan,
 * Stripe havde sluppet — og skrev `konfigureret` paa den.
 */
export function planGaelder(plan: unknown, subId: string): boolean {
  const p = plan as { status?: unknown; subscription?: unknown } | null
  if (!p) return false
  const status = typeof p.status === 'string' ? p.status : ''
  if (!(PLAN_LEVENDE as readonly string[]).includes(status)) return false
  return idAf(p.subscription) === subId
}

/**
 * HVILKEN plan styrer abonnementet — og hvad siger den selv?
 *
 * ── HVORFOR DEN LIGGER ÉT STED ──────────────────────────────
 * Tre kodeveje traf tidligere hver sin afgoerelse om det samme:
 * `afstemAbonnement` spurgte kilden foerst og faldt tilbage paa vores
 * binding; `stopForkertFornyelse` og `laegPlan` brugte vores binding
 * og spurgte KUN kilden, naar bindingen var tom. De to sidste var
 * forkerte, og det kostede en kunde hendes fornyelse: plan A var
 * frigivet, Stripe styrede med en korrekt plan B — og vi undersoegte
 * A, traf stopbeslutningen paa den og sendte et opsigelseskald.
 *
 * CLAUDE.md's regel gaelder ordret her: svarer to udtryk paa det samme
 * spoergsmaal, skal de beregnes ét sted. Det her er stedet.
 *
 * ── REGLEN ──────────────────────────────────────────────────
 * `planGaelder` er doemmeren hele vejen: en plan taeller kun, hvis den
 * er levende OG selv siger, at den styrer netop dette abonnement. En
 * frigivet plan beholder sine faser; den styrer bare ikke noget.
 *
 * 1 · Har kalderen allerede kildens svar, ER det svaret.
 * 2 · Ellers proeves VORES binding. Kommer den igennem `planGaelder`,
 *     er den rigtig — og saa er der ikke noget at spoerge om.
 * 3 * Foerst naar bindingen ikke duer, spoerges kilden.
 *
 * ── HVORFOR KILDEN IKKE SPOERGES FOERST ─────────────────────
 * Det proevede jeg, og det er en ny fejl. Et ubetinget
 * `subscriptions.retrieve` gjorde kildens svar noedvendigt for at
 * STAA NED — ikke kun for at gribe ind. Maalt: er netop det kald nede,
 * mens planerne svarer fint, faldt hele sikkerhedsstoppet i sin catch
 * og skrev ⚠⚠ «der er IKKE grebet ind» hver time om et abonnement,
 * hvis plan var helt korrekt. To falske alarmer i timen, i det
 * uendelige.
 *
 * Kilden er noedvendig for at gribe ind, og kun dér. Kommer vores egen
 * binding igennem `planGaelder`, siger PLANEN selv, at den styrer
 * abonnementet — og saa kan Stripes `subscription.schedule` ikke pege
 * et andet sted.
 *
 * Svaret er `null`, naar ingen plan styrer abonnementet. Saa er der
 * intet at slippe — og for `laegPlan` betyder det, at der skal
 * oprettes en, paa et afstemt grundlag og ikke paa et gaet.
 */
export async function planDerStyrer(
  s: ReturnType<typeof stripe>, subId: string, vores: string | null,
  /**
   * Kildens svar, hvis kalderen ALLEREDE har det (`afstemAbonnement`
   * henter abonnementet i forvejen). `undefined` betyder «ikke
   * spurgt» — og saa spoerges der kun, hvis der bliver brug for det.
   */
  hosStripe?: string | null,
): Promise<{ id: string; plan: unknown } | null> {
  const doem = async (id: string) => {
    const plan = await s.subscriptionSchedules.retrieve(id)
    return planGaelder(plan, subId) ? { id, plan } : null
  }
  // 1 · Har kalderen allerede kildens svar, ER det svaret.
  if (hosStripe) return doem(hosStripe)
  // 2 · Vores binding — men kun hvis planen SELV siger, at den styrer.
  //     Det er dét, der goer, at vi kan staa ned uden at spoerge
  //     abonnementet: en plan, der hverken er levende eller bundet til
  //     netop dette abonnement, kommer ikke igennem `planGaelder`.
  if (vores) {
    const r = await doem(vores)
    if (r) return r
  }
  // 3 · Vores binding duede ikke. FOERST nu er kilden noedvendig —
  //     og det er ogsaa foerst nu, vi er paa vej til at gribe ind.
  if (hosStripe === undefined) {
    const abo = await s.subscriptions.retrieve(subId) as { schedule?: unknown } | null
    const fra = idAf(abo?.schedule)
    if (fra && fra !== vores) return doem(fra)
  }
  return null
}

/**
 * Tilbagetraekning for en afstemning, der ikke kunne goeres faerdig.
 *
 * ── HVORFOR DEN IKKE ER `naesteForsoeg()` FRA WEBHOOKEN ─────
 * Kurven ligner, og forbilledet ER haendelseskoeen. Men de to svarer
 * paa hvert sit spoergsmaal — «hvornaar proever vi den HAENDELSE igen»
 * og «hvornaar afstemmer vi det ABONNEMENT igen» — og repoet har
 * allerede en tredje kurve i `lib/ingest.ts` for et tredje spoergsmaal,
 * med en anden regel (den giver op efter fem; det goer ingen af de to
 * andre). Ét fælles udtryk ville binde tre forskellige beslutninger
 * sammen, saa den ene ikke kan aendres uden de andre.
 *
 * Forskellen paa denne og haendelseskoeens er loftet: SEKS TIMER er for
 * laenge her. En afstemning handler om penge, der forlader en kundes
 * konto, og tilsynet koerer hver time — saa en time er baade det
 * hyppigste, der er synligt i drift, og det sjaeldneste, der er
 * forsvarligt. Den giver aldrig op.
 *
 * ── OG FRISTEN SLAAR TRINNET ────────────────────────────────
 * Et trin er et skoen; fornyelsen er en kendsgerning. Ligger den om
 * halvfems minutter, og trinnet siger en time, er en time fint — men
 * ligger den om tyve, skal vi proeve igen FOER den, ikke bagefter.
 * Repoet har i forvejen en graense for «fornyelsen er naer»
 * (`STOP_FOER_FORNYELSE_MIN`), og det her er den samme tanke: det
 * naermeste af de to vinder. Margenen er ti minutter, saa der er tid
 * til én koersel mere.
 */
const MARGEN_MS = 10 * 60_000

/**
 * Hvor mange portioner én afstemningskoersel hoejst maa hente.
 *
 * Koerslen henter en ny portion, naar den forrige indeholdt raekker,
 * den ikke fik FLYTTET — se `afstemSkyldige`. Uden et loft kunne en
 * base, hvor hver eneste raekkes bogfoering fejler, holde koerslen
 * inde for evigt.
 *
 * Fire er valgt, fordi det er stort nok til, at et sammenhaengende
 * felt af forgiftede raekker paa `maks`' stoerrelse ikke spaerrer for
 * dem bagved, og lille nok til, at en syg base ikke bliver til
 * hundredvis af kald i én koersel. Rammes loftet, staar det i
 * koerselsrapporten — det er ikke tavst.
 */
const PORTIONER_PR_KOERSEL = 4

export function naesteAfstemning(forsoeg: number, frist: Date | null = null): Date {
  const nu = Date.now()
  const trin =
    forsoeg >= 6 ? nu + 3600_000        // en time — loftet
    : forsoeg >= 3 ? nu + 10 * 60_000   // ti minutter
    // De foerste to venter ikke: en tabt skrivning eller et blink hos
    // Stripe er som oftest vaek igen med det samme, og tilsynet skal
    // kunne goere det faerdigt i den SAMME koersel.
    : nu
  if (!frist) return new Date(trin)
  // Aldrig senere end fristen minus margenen — og aldrig i fortiden.
  return new Date(Math.max(nu, Math.min(trin, frist.getTime() - MARGEN_MS)))
}

/**
 * Noter, at der er udestaaende arbejde paa abonnementet.
 *
 * Idempotent paa selve skylden: staar den, bliver dens tidspunkt.
 * Det FOERSTE tidspunkt er det rigtige — det siger, hvor laenge
 * raekken har vaeret uafklaret, og det er dét, et menneske skal se.
 *
 * Naeste forsoegstid nulstilles derimod, saa en ny grund til skyld
 * ikke arver en gammel tilbagetraekning. En kunde, der lige har
 * trykket op, skal ikke vente en time, fordi en anden skyld fejlede
 * seks gange i gaar.
 */
export async function skyldAfstemning(subId: string, grund: string): Promise<void> {
  await db.update(subscriptions)
    .set({
      afstemningSkyldigAt: sql`coalesce(${subscriptions.afstemningSkyldigAt}, now())`,
      afstemningNaesteAt: null,
      afstemningFejl: grund.slice(0, 300),
      // ── HVER REGISTRERING ER EN NY GENERATION ───────────
      // Tidsstemplet kan IKKE bruges til det: det er `coalesce`'et
      // med vilje, saa en ny skyld oven i en gammel bevarer det
      // gamle tidspunkt. To generationer faar samme vaerdi.
      // Taelleren stiger derimod hver gang, og afstemningen kan
      // dermed se, om der er kommet arbejde, den ikke har udfoert.
      afstemningGen: sql`${subscriptions.afstemningGen} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.stripeSubscriptionId, subId))
}

export type Opsigelsesudfald =
  /** Den oenskede sluttilstand er BEKRAEFTET hos Stripe og bogfoert. */
  | 'afstemt'
  /**
   * Stripe har bekraeftet, at der ikke kommer en opkraevning — men
   * vores egen oprydning naaede ikke igennem. Det er IKKE det samme som
   * «vi ved ikke, om Stripe fik den»: pengene er i sikkerhed, og
   * kunden maa faa det at vide. Skylden staar, saa tilsynet gør resten.
   */
  | 'bekraeftet_ikke_bogfoert'
  /** Der var intet at goere paa raekken. */
  | 'ikke_noedvendig'
  /**
   * Vi kunne ikke bekraefte sluttilstanden. Skylden staar, og
   * tilbagetraekningen er sat. Det siger INTET om, hvorvidt Stripe naaede
   * at udfoere noget — derfor laeser naeste afstemning kilden igen.
   */
  | 'ikke_bekraeftet'
  /**
   * Vores eget arbejde ER gjort og bekraeftet — men der er registreret
   * NYT arbejde, mens vi var i luften, og det har vi ikke set.
   *
   * Det er ikke en fejl, og kunden faar sit ja. Men raekken bliver i
   * koeen, og det skal kunne SES: uden udfaldet meldte tilsynet
   * «afstemt» om en raekke, der stadig var skyldig.
   */
  | 'nyt_arbejde'

/**
 * Statusser, et abonnement ikke kommer tilbage fra.
 *
 * ÉN LISTE, ÉT STED. Den stod her under ét navn og i webhooken under
 * et andet — to identiske lister, der svarede paa noejagtig samme
 * spoergsmaal i hver sin fil. Kommentaren her sagde «delt med
 * webhooken»; det var den ikke, den var kopieret. To udtryk, der ikke
 * kan afledes af hinanden, er et spoergsmaal om tid — og doedsvagten
 * i `afstemAbonnement` gjorde netop den her liste baerende et nyt sted.
 *
 * Den bor i `lib/opsigelse.ts`, fordi webhooken i forvejen importerer
 * herfra og ikke omvendt. Navnet er webhookens, saa dens kaldesteder
 * er uaendrede.
 */
export const TERMINALE = ['canceled', 'incomplete_expired', 'expired'] as const

/**
 * ÉT SPOERGSMAAL, ÉT STED: skal fornyelsen stoppes for den her raekke?
 *
 * Tre felter svarer paa det, og de er ikke det samme spoergsmaal hver
 * for sig:
 *   · `opsagtAf`  kunden har bedt om det
 *   · `stoppet`   VI har besluttet det (sikkerhedsstoppet)
 *   · `opsagt`    Stripe siger selv, at den ikke fornyes
 *
 * Foer stod udtrykket TRE steder med tre forskellige maengder:
 * `laegPlan`s vagt spurgte `opsagtAf || opsagt`, dens betingede
 * skrivning spurgte alle tre, og afstemningen — den, der skal GOERE
 * arbejdet — spurgte kun `opsagtAf || stoppet`. Saetterens maengde var
 * altsaa en aegte OVERMAENGDE af betalerens, og en skyld sat paa
 * `opsagt` alene blev ryddet uden ét eneste Stripe-kald, mens planen
 * stod aktiv og bundet. Maalt: `release`-kald 0, skyld ryddet,
 * `subscription` stadig sat. Det er N2's sluttilstand, naaet gennem
 * den koe, der skulle fjerne den.
 *
 * Alle tre udtryk kommer nu herfra. SQL-siden staar lige nedenfor, og
 * `npm test` proever de otte kombinationer mod BEGGE.
 */
export type Beslutning = {
  opsagtAf: Date | null
  stoppet: Date | null
  opsagt: boolean
}
export function skalFornyelsenStoppes(r: Beslutning): boolean {
  // `!= null`, ikke `!== null`: et felt, en kalder har glemt at hente,
  // kommer som `undefined`, og `undefined !== null` er sandt. Det ville
  // laese «nogen har besluttet at stoppe fornyelsen» ud af en
  // manglende kolonne — og saa opsiger en oprydning et abonnement,
  // ingen har bedt om at faa opsagt. Den manglende oplysning skal
  // trille til den SIKRE side, og den sikre side er «ingen beslutning».
  return r.opsagtAf != null || r.stoppet != null || r.opsagt === true
}

/**
 * Samme spoergsmaal, udtrykt i basen: INGEN har besluttet noget.
 *
 * Et praedikat, der findes baade i JS og i SQL, er CLAUDE.md's eget
 * tegn paa, at to udtryk vil drive fra hinanden. De to KAN ikke vaere
 * ét udtryk — men de kan staa side om side og proeves mod hinanden,
 * og det goer `npm test` paa alle otte kombinationer.
 */
export const INGEN_BESLUTNING = [
  isNull(subscriptions.opsagtAfKundeAt),
  isNull(subscriptions.fornyelseStoppetAt),
  eq(subscriptions.cancelAtPeriodEnd, false),
]

/**
 * AFSTEM ET ABONNEMENT MOD STRIPE. Én implementering, genoptagelig.
 *
 * ── DEN HENTER SIN HENSIGT FRA RAEKKEN ──────────────────────
 * Det er hele forskellen paa den her og den `fuldfoerOpsigelse`, den
 * afloeser. Den gamle SATTE ubetinget `cancel_at_period_end`. Det var
 * i orden, saa laenge den kun blev kaldt fra opsigelsen — men i det
 * oejeblik en koe kalder den, ville enhver raekke, der kom til at baere
 * en skyld, blive opsagt. Et abonnement, ingen har sagt op, maa ikke
 * kunne stoppes af en oprydning.
 *
 * Derfor: `skalStoppes` udledes af de to BESLUTNINGER — kundens
 * (`opsagt_af_kunde_at`) og vores egen (`fornyelse_stoppet_at`). Er
 * ingen af dem taget, roerer afstemningen intet hos Stripe ud over ét
 * opslag.
 *
 * ── OG DEN TROR IKKE PAA SIG SELV ───────────────────────────
 * Den skriver foerst hjem, naar den har LAEST sluttilstanden tilbage
 * fra Stripe. Foer blev bindingen ryddet, som om et release var
 * bekraeftet — ogsaa naar kaldet var fejlet, og ogsaa naar det slet
 * ikke var forsoegt. Den aktive plan stod saa tilbage hos Stripe uden
 * at vaere synlig for nogen koe.
 */
export async function afstemAbonnement(
  ops: Stripeopsaetning, subId: string,
  /**
   * Skal et fejlet forsoeg taelle og skubbe raekken bagud?
   *
   * JA fra koeen: det er dét, der giver fremdrift, og som holder en
   * raekke, der bliver ved at fejle, ude af vejen for dem, der kan.
   *
   * NEJ fra kundens eget tryk. Hendes klik er ikke et koeforsoeg, og
   * det maa ikke straffe hende: tre mislykkede tryk ville ellers
   * skubbe hendes egen opsigelse ti minutter bagud, hver gang hun
   * proevede at faa den igennem.
   */
  taelForsoeget = true,
): Promise<Opsigelsesudfald> {
  const [a] = await db.select({
    plan: subscriptions.stripeScheduleId,
    opsagtAf: subscriptions.opsagtAfKundeAt,
    stoppet: subscriptions.fornyelseStoppetAt,
    opsagt: subscriptions.cancelAtPeriodEnd,
    status: subscriptions.status,
    forsoeg: subscriptions.afstemningForsoeg,
    frist: subscriptions.currentPeriodEnd,
    // Generationen, som den stod DA VI BEGYNDTE. Alt hvad vi kvitterer
    // til sidst, maales mod den her.
    gen: subscriptions.afstemningGen,
  }).from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subId)).limit(1)
  if (!a) return 'ikke_noedvendig'

  // Et doedt abonnement fornyes ikke og kan ikke opsiges. Skylden
  // ryddes; der er ikke noget at afstemme.
  if ((TERMINALE as readonly string[]).includes(a.status)) {
    if (!await ryd(subId, [eq(subscriptions.afstemningGen, a.gen ?? 0)])) {
      return 'nyt_arbejde'
    }
    return 'ikke_noedvendig'
  }

  const skalStoppes = skalFornyelsenStoppes(a)
  let slugtVedRelease: string | null = null
  // Den plan, VI faktisk undersoegte og slap. Oprydningen nedenfor
  // rydder kun bindingen, hvis raekken stadig peger paa netop den.
  let planId: string | null = null
  // Stripes eget svar paa «hvilken plan styrer abonnementet», som vi
  // LAESTE det. Bindingsvagten nedenfor bruger begge observerede id'er.
  let planHosStripeSet: string | null = null

  try {
    const s = stripe(ops)

    // ── KILDEN, IKKE VORES BOGFOERING ─────────────────────
    const abo = await s.subscriptions.retrieve(subId) as
      { schedule?: unknown; cancel_at_period_end?: unknown; status?: unknown } | null
    const planHosStripe = idAf(abo?.schedule)
    planHosStripeSet = planHosStripe

    // ── DOEDSVAGTEN LAESER STRIPE, IKKE OS ──────────────────
    // Vagten oeverst i funktionen spurgte VORES spejl (`a.status`).
    // Det spejl er kun saa godt som den sidste haendelse, vi fik. Gik
    // `customer.subscription.deleted` tabt — og hele modulet findes,
    // fordi haendelser gaar tabt — staar raekken `active` hos os,
    // mens Stripe for laengst har lukket abonnementet. Stripe afviser
    // saa enhver opdatering af det, og skylden bliver forsoegt igen.
    // `naesteAfstemning` giver ALDRIG op; loftet er en time. Maalt:
    // tre koersler, tre fejl, `afstemning_forsoeg` 1-2-3 og ingen ende
    // paa det — et evigt timekald mod Stripe om et abonnement, der
    // ikke findes.
    //
    // Svaret laa i det kald, vi lige har lavet. Siger Stripe selv, at
    // det er doedt, saa ER sluttilstanden naaet: et doedt abonnement
    // fornyes ikke. Vi spejler status og rydder skylden.
    const statusHosStripe = typeof abo?.status === 'string' ? abo.status : null
    if (statusHosStripe && (TERMINALE as readonly string[]).includes(statusHosStripe)) {
      await db.update(subscriptions)
        .set({ status: statusHosStripe as never, updatedAt: new Date() })
        .where(eq(subscriptions.stripeSubscriptionId, subId))
      if (!await ryd(subId, [eq(subscriptions.afstemningGen, a.gen ?? 0)])) {
        return 'nyt_arbejde'
      }
      return 'ikke_noedvendig'
    }

    if (!skalStoppes) {
      // ── INGEN HAR BEDT OM NOGET ─────────────────────────
      // Saa slipper vi ingen plan. Det eneste, der kan vaere skyldigt
      // her, er en plan, Stripe kender og vi ikke gjorde — fx fordi
      // koerslen doede mellem `create` og bogfoeringen. Den ADOPTERES,
      // saa `laegManglendePlaner` kan goere den faerdig. Vi slipper den
      // ikke: den er kundens overgang til normalprisen.
      if (planHosStripe && planHosStripe !== a.plan) {
        await db.update(subscriptions)
          .set({ stripeScheduleId: planHosStripe, planStatus: 'oprettet',
                 planForsoegtAt: new Date(), updatedAt: new Date() })
          .where(eq(subscriptions.stripeSubscriptionId, subId))
      }
      // ── BETINGET, SAA HENDES TRYK IKKE TABES I VINDUET ──
      // Raekken blev laest ÉN gang, oeverst. Trykker hun op imellem
      // den laesning og den her rydning — og opslaget hos Stripe er
      // netop en netvaerkstur at goere det i — saa rydder vi en skyld,
      // der aldrig blev indfriet: `opsagt_af_kunde_at` sat,
      // `cancel_at_period_end` false, og ingen koe, der ser raekken.
      // Det er vores eget loefte brudt af automatikken selv.
      //
      // Betingelsen er det samme praedikat som `skalFornyelsenStoppes`,
      // udtrykt i basen. Rammer den nul raekker, har nogen besluttet
      // noget i mellemtiden, skylden bliver staaende, og naeste
      // afstemning tager den op med den nye viden.
      if (!await ryd(subId, [...INGEN_BESLUTNING,
        eq(subscriptions.afstemningGen, a.gen ?? 0)])) {
        return 'nyt_arbejde'
      }
      return 'afstemt'
    }

    // ── DEN OENSKEDE SLUTTILSTAND ─────────────────────────
    // 1 · ingen plan maa styre abonnementet, og 2 · det maa ikke forny.
    // Raekkefoelgen er ikke til forhandling: slippes planen efter
    // opsigelsen, kan den skrive `cancel_at_period_end` om ved naeste
    // faseskift.
    // STRIPES EGET SVAR FOERST. Vores `stripe_schedule_id` kan pege paa
    // en plan, der for laengst er sluppet, mens en ANDEN er bundet til
    // abonnementet nu. Laeste vi vores eget id foerst, ville vi
    // undersoege den forkerte plan og aldrig slippe den rigtige.
    // Reglen — kilden foerst, vores binding kun som ledetraad, og
    // `planGaelder` som doemmer — er ÉT sted: `planDerStyrer`.
    // `planId` er derfor den plan, vi FAKTISK slap, og null naar der
    // ikke var nogen. Det er praecis det, rydningen nedenfor antager.
    const styrer = await planDerStyrer(s, subId, a.plan, planHosStripe)
    planId = styrer?.id ?? null
    if (styrer) {
      try {
        await s.subscriptionSchedules.release(styrer.id)
      } catch (e) {
          // ── ET TABT KAPLOEB ER IKKE EN FEJL ─────────────
          // To samtidige opsigelser kan begge have laest `active`,
          // foer den foerste slap planen. Den anden faar saa et nej
          // fra Stripe — men det, den bad om, ER sket. Vi LAESER
          // derfor efter, i stedet for at kalde det en fejl.
          //
          // Og vi sluger den ikke: gaelder planen STADIG, var nejet
          // aegte, og saa skal det videre.
        const igen = await s.subscriptionSchedules.retrieve(styrer.id)
        if (planGaelder(igen, subId)) throw e
        // Den blev ikke slugt sporloest. Gaar noget galt LAENGERE
        // NEDE, staar den her i fejlteksten — ellers ville
        // aarsagen forsvinde ud af enhver senere fejlsoegning.
        slugtVedRelease = (e as Error).message.slice(0, 120)
      }
    }
    if (abo?.cancel_at_period_end !== true) {
      await s.subscriptions.update(subId, { cancel_at_period_end: true })
    }

    // ── LAES SLUTTILSTANDEN TILBAGE ───────────────────────
    // Foerst her ved vi noget. Alt ovenfor er kald, der KAN vaere
    // lykkedes; det her er Stripes eget svar paa, om de blev det.
    const efter = await s.subscriptions.retrieve(subId) as
      { schedule?: unknown; cancel_at_period_end?: unknown } | null
    const restPlan = idAf(efter?.schedule)
    if (efter?.cancel_at_period_end !== true) {
      throw new Error('Stripe bekræfter ikke cancel_at_period_end')
    }
    if (restPlan) {
      const rest = await s.subscriptionSchedules.retrieve(restPlan)
      if (planGaelder(rest, subId)) {
        throw new Error(`en plan styrer stadig abonnementet: ${restPlan}`)
      }
    }

    // ── OG SAA FOERST BOGFOERER VI — I TO SKRIDT ──────────
    // Kendsgerningen om PENGENE foerst, oprydningen bagefter. De to
    // svarer paa hvert sit spoergsmaal, og det foerste er det, kunden
    // skal kunne se: «der kommer ingen opkraevning». Lykkes det, og
    // fejler oprydningen, staar skylden — men siden siger allerede det
    // rigtige. Var de ét skrid, ville en tabt skrivning ogsaa skjule
    // en kendsgerning, vi HAVDE faaet bekraeftet.
    await db.update(subscriptions)
      .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
      .where(eq(subscriptions.stripeSubscriptionId, subId))
  } catch (e) {
    // `?? 0`: kolonnen er NOT NULL DEFAULT 0 i basen, men en raekke,
    // der kommer fra et sted uden skemaets standard, maa ikke give NaN
    // og dermed en tilbagetraekning, der aldrig forfalder.
    const forsoeg = (a.forsoeg ?? 0) + 1
    await db.update(subscriptions)
      .set({
        afstemningSkyldigAt: sql`coalesce(${subscriptions.afstemningSkyldigAt}, now())`,
        afstemningFejl: ((e as Error).message
          + (slugtVedRelease ? ` · tidligere release-fejl: ${slugtVedRelease}` : ''))
          .slice(0, 300),
        updatedAt: new Date(),
        ...(taelForsoeget
          ? { afstemningForsoeg: forsoeg,
              afstemningNaesteAt: naesteAfstemning(forsoeg, a.frist) }
          : {}),
      })
      .where(eq(subscriptions.stripeSubscriptionId, subId))
    return 'ikke_bekraeftet'
  }

  // ── OPRYDNINGEN, UDEN FOR VAGTEN ────────────────────────
  // Naar vi er her, HAR Stripe bekraeftet. En fejl herfra og ned
  // aendrer ikke det; den betyder bare, at der er lidt tilbage at
  // rydde op i — og skylden staar, saa tilsynet goer det.
  //
  // ── MEN KUN DET, VI HAR SET ───────────────────────────
  // Bindingen ryddes kun, hvis den stadig peger paa den plan, VI
  // undersoegte. Mellem den afsluttende Stripe-laesning og den her
  // skrivning ligger en netvaerkstur, og i det vindue kan `laegPlan`
  // vende tilbage fra et forsinket `create` og binde en NY plan.
  // Ryddede vi ubetinget, slettede vi bindingen til en plan, vi
  // aldrig har sluppet — og den ville staa aktiv hos Stripe uden at
  // vaere synlig for nogen.
  //
  // `planId` er null, naar der slet ikke var en plan at slippe. Saa er
  // der heller ikke en binding at rydde, og betingelsen bliver
  // `is null` — den rammer kun en raekke, der stadig er tom.
  // ── KVITTÉR KUN DEN GENERATION, VI HAR UDFOERT ────────
  // Er der registreret nyt arbejde, mens vi var i luften, staar det
  // tilbage. Det er ikke en fejl: VORES arbejde ER gjort, og kunden
  // faar sit ja. Men vi har ikke set det nye, og saa kan vi ikke
  // sige, det er gjort. Raekken bliver i koeen, og naeste afstemning
  // tager den med den nye viden.
  //
  // Foer stod her `await ryd(subId)` ubetinget. Maalt: et forsinket
  // `create` vendte tilbage og registrerede korrekt ny skyld, den
  // gamle kvittering slettede den, planen stod `active` hos Stripe, og
  // tre tilsynskoersler foretog nul kald. Tavs og blivende.
  //
  // ── BINDING OG SKYLD I ÉN SKRIVNING ───────────────────
  // De var to, hver med sin vagt, og de kunne komme i UTAKT: med en
  // foraeldet lokal binding missede bindingsvagten, mens
  // generationsvagten ramte — saa blev skylden ryddet, mens bindingen
  // stod. Raekken paastod «plan konfigureret» uden koearbejde, og
  // ingen koe saa den igen. Maalt.
  //
  // Ét statement er atomisk, saa de to felter kan ikke skilles ad —
  // samme svar som M1, ét lag laengere inde.
  const uroert = [
    eq(subscriptions.afstemningGen, a.gen ?? 0),
    bindingUroert(a.plan, planHosStripeSet),
  ]
  try {
    const ryddet = await db.update(subscriptions)
      .set({ stripeScheduleId: null, planStatus: null,
             ...RYD_SAET, updatedAt: new Date() })
      .where(and(eq(subscriptions.stripeSubscriptionId, subId), ...uroert))
      .returning({ id: subscriptions.id })
    // ── ET MISS ER ET UDFALD, IKKE EN TAVSHED ───────────
    if (!ryddet.length) return 'nyt_arbejde'
  } catch (e) {
    await db.update(subscriptions)
      .set({
        afstemningSkyldigAt: sql`coalesce(${subscriptions.afstemningSkyldigAt}, now())`,
        afstemningFejl: `opsigelsen er bekræftet hos Stripe; oprydningen mangler: `
          + (e as Error).message.slice(0, 200),
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.stripeSubscriptionId, subId))
    return 'bekraeftet_ikke_bogfoert'
  }
  // Naaede vi hertil, ramte kvitteringen ovenfor, og der var intet
  // nyt at tage hensyn til.
  return 'afstemt'
}

/** Det, der skal staa i basen, naar skylden er indfriet. ÉT sted. */
export const RYD_SAET = {
  afstemningSkyldigAt: null, afstemningNaesteAt: null,
  afstemningForsoeg: 0, afstemningFejl: null,
} as const

/**
 * Skylden er indfriet. ÉT sted, og kun efter en laest sluttilstand.
 *
 * SVARER, OM DEN RAMTE. Den returnerede `void`, og et miss var derfor
 * usynligt: udfaldet blev `afstemt`, og tilsynet skrev
 * «1 skyldige · 1 taget · 1 afstemt · 0 kunne ikke endnu» om en raekke,
 * der stadig var skyldig. Det er CLAUDE.md's egen regel — en manglende
 * oplysning skal vaere SYNLIG, ikke fravaerende — vendt indad mod
 * vores eget tilsyn. Maalt, foer den svarede.
 */
async function ryd(subId: string, kun: SQL[] = []): Promise<boolean> {
  const r = await db.update(subscriptions)
    .set({ ...RYD_SAET, updatedAt: new Date() })
    .where(and(eq(subscriptions.stripeSubscriptionId, subId), ...kun))
    .returning({ id: subscriptions.id })
  return r.length > 0
}

/**
 * Peger bindingen stadig paa en plan, VI har observeret?
 *
 * Generationen kan ikke baere det her alene, og det er maalt:
 * `laegPlan` skriver `stripe_schedule_id` STRAKS efter sit `create` og
 * FOER den noterer nogen skyld. I det vindue er generationen uroert,
 * mens bindingen er ny — og en ubetinget rydning sletter en binding
 * til en plan, vi aldrig har sluppet.
 *
 * BEGGE observerede id'er taeller: vores eget fra raekken OG Stripes
 * eget. Er vores lokale binding foraeldet, mens Stripe siger noget
 * andet, er det stadig en binding, vi HAR set, og den maa ryddes.
 * Tog vagten kun den ene, kom de to skrivninger i utakt — maalt:
 * bindingen blev staaende, mens skylden blev ryddet, og raekken
 * paastod «plan konfigureret» uden koearbejde.
 */
export function bindingUroert(vores: string | null, hosStripe: string | null): SQL {
  const set = [...new Set([vores, hosStripe].filter((x): x is string => x !== null))]
  if (!set.length) return isNull(subscriptions.stripeScheduleId)
  return or(isNull(subscriptions.stripeScheduleId),
            inArray(subscriptions.stripeScheduleId, set))!
}

/**
 * Noter kundens beslutning. Skrives FOER de eksterne kald.
 *
 * Idempotent: staar tidspunktet i forvejen, bliver det staaende. Det
 * foerste tidspunkt er det rigtige — det er dér, kunden traf valget,
 * og det er dét, spejlingen sammenligner en forsinket haendelse med.
 */
export async function noterOpsigelse(subId: string): Promise<void> {
  // ── ÉN SKRIVNING, IKKE TO ─────────────────────────────────
  // Her stod to selvstaendige `update`s: foerst beslutningen, saa
  // skylden. Fejlede den anden — og en enkelt databasefejl er nok —
  // stod beslutningen tilbage UDEN en vej til udfoerelse. Maalt: tre
  // tilsynskoersler, nul Stripe-kald, ingen logline, `cancel_at_period_end`
  // aldrig sat hos Stripe. Og siden sagde imens «Opsigelse undervejs …
  // Vi proever automatisk igen» om en koe, der var tom. Hun kunne kun
  // komme videre ved selv at trykke igen.
  //
  // En vedvarende beslutning skal have en vedvarende vej til
  // udfoerelse, og de to maa derfor ikke kunne skilles ad. Ét
  // `update` er atomisk i PostgreSQL — ingen transaktion noedvendig,
  // og dermed heller ingen transaktion, der holdes aaben over et
  // netvaerkskald.
  //
  // `coalesce` paa beslutningen goer noejagtig det, `isNull`-vagten
  // gjorde: det FOERSTE tidspunkt vinder. Det er dér, kunden traf
  // valget, og det er dét, spejlingen sammenligner en forsinket
  // haendelse med. Skylden saettes derimod hver gang — trykker hun
  // igen, er det en ny registrering, og generationen stiger.
  await db.update(subscriptions)
    .set({
      opsagtAfKundeAt: sql`coalesce(${subscriptions.opsagtAfKundeAt}, now())`,
      afstemningSkyldigAt: sql`coalesce(${subscriptions.afstemningSkyldigAt}, now())`,
      afstemningNaesteAt: null,
      afstemningFejl: 'kunden har sagt op — afventer bekræftelse hos Stripe',
      afstemningGen: sql`${subscriptions.afstemningGen} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.stripeSubscriptionId, subId))
}

/**
 * Koeen: de abonnementer, der har udestaaende arbejde og er klar NU.
 *
 * ── HVORFOR SORTERINGEN OG TIDEN ER SELVE RETTELSEN ─────────
 * Foer tog den `limit(25)` paa et praedikat, et fejlet forsoeg ikke
 * aendrede. De samme 25 kunne derfor vaelges hver eneste gang, og
 * kunde nummer 26 kom aldrig til — uanset at hendes opsigelse var
 * gennemfoerlig. En stoerre graense flytter kun taellet.
 *
 * Nu flytter hvert fejlet forsoeg raekken FREM I TIDEN, og
 * udvaelgelsen tager de tidligst forfaldne. En raekke, der bliver ved
 * at fejle, glider ud i ti minutter og saa en time — og en ny skyld
 * med `naeste = null` er altid forrest. Det er samme svar som
 * `stripe_events.naeste_forsoeg_at`, og af samme grund.
 */
export async function afstemSkyldige(
  ops: Stripeopsaetning, maks = 25,
): Promise<{
  skyldige: number; taget: number; afstemte: number; fejlede: number
  /** Vores arbejde lykkedes, men der stod nyt tilbage, vi ikke har set. */
  nytArbejde: number
  venter: number; detaljer: string[]
}> {
  const nu = new Date()
  const klar = or(
    // NULL betyder «aldrig forsoegt» og er altsaa klar NU. Skrives
    // praedikatet som bare `<= now()`, rammer det nul af dem — maalt.
    isNull(subscriptions.afstemningNaesteAt),
    lte(subscriptions.afstemningNaesteAt, nu),
  )

  // ── TALLENE MAALES, DE UDLEDES IKKE AF EN AFKORTET LISTE ──
  // `skyldige` var foer `raekker.length`, altsaa hoejst `maks`. Med 26
  // skyldige og en graense paa 25 stod der 25, og «0 taget» saa ud som
  // «ingenting at lave». Samme greb som `behandlUbehandlede`: et
  // rigtigt totaltal og et tal for dem, der venter i tilbagetraekning.
  const [i_alt] = await db.select({ n: count() }).from(subscriptions)
    .where(isNotNull(subscriptions.afstemningSkyldigAt))
  // `venter` udledes af de to: skyldige minus forfaldne. Begge er
  // maalt HER, foer runden koerer — saa tallet svarer paa «hvor mange
  // var i tilbagetraekning, da vi begyndte», ikke «hvor mange er det
  // nu». De raekker, runden selv skubber bagud, er ikke med.
  //
  // Det er med vilje, og det er derfor tilsynslinjen siger «ved
  // koerslens start»: maalte vi bagefter, ville tallet altid vaere
  // mindst saa stort som `fejlede`, og de to ville sige det samme.
  const [nuKlar] = await db.select({ n: count() }).from(subscriptions)
    .where(and(isNotNull(subscriptions.afstemningSkyldigAt), klar))

  // Grundvilkaaret og raekkefoelgen staar ÉT sted, fordi udvaelgelsen
  // koeres mere end én gang pr. koersel — se `vaelg` nedenfor. To
  // udgaver af den her sortering ville vaere to svar paa «hvem er mest
  // presserende», og det er praecis den fejlform, CLAUDE.md advarer imod.
  const grundvilkaar = and(isNotNull(subscriptions.afstemningSkyldigAt), klar)

  /** Naeste portion, uden de raekker denne koersel allerede har forsoegt. */
  const vaelg = (antal: number, undtagen: string[]) => db
    .select({ sub: subscriptions.stripeSubscriptionId })
    .from(subscriptions)
    .where(undtagen.length
      ? and(grundvilkaar, notInArray(subscriptions.stripeSubscriptionId, undtagen))
      : grundvilkaar)
    // ── FAERREST FORSOEG FOERST, DEREFTER MEST PRESSERENDE ──
    // To led, og det foerste er selve fremdriften.
    //
    // `afstemning_forsoeg` stigende: en raekke, der aldrig er proevet,
    // kommer FOER en, der lige har fejlet. Det er dét, der gør
    // udsultning umulig, ogsaa naar tilbagetraekningen er nul — og de
    // to foerste forsoeg venter med vilje ikke. Uden leddet blokerede
    // femogtyve vedvarende fejl den seksogtyvende i runde efter runde,
    // fordi de alle var lige forfaldne.
    //
    // `current_period_end` stigende: blandt de lige saa lidt proevede
    // gaar den, hvis fornyelse er naermest, foerst. Sorteredes der paa
    // tid siden beslutningen, ville den kunde, der siger op kort FOER
    // sin fornyelse, per definition vaere den nyeste — og dermed den
    // sidste, graensen skaerer fra. Det er praecis hende, koeen findes
    // for. En ukendt frist er mindre presserende og sorterer bagest
    // (PostgreSQL's NULLS LAST for ASC).
    //
    // ── MEN HASTEVAERKET SKAL STAA FOERST, ELLERS VENDER DET ──
    // Med `afstemning_forsoeg` som foerste led STRAFFEDE koeen den
    // raekke, den lige havde prioriteret rigtigt. Maalt: hundrede
    // kunder siger op under en Stripe-nedetid, én med fornyelse om
    // fyrre minutter. Koersel 1 tager de femogtyve mest presserende —
    // hende iblandt — og alle fejler. Stripe kommer op igen, og i
    // koersel 2 staar de femoghalvfjerds UPROEVEDE (`forsoeg = 0`)
    // foran hende (`forsoeg = 1`). Hun fik NUL kald i den koersel, der
    // virkede, og naas foerst fire timer senere. Fristen laa fyrre
    // minutter ude.
    //
    // Fristloftet i `naesteAfstemning` redder hende ikke, og det er
    // vaerd at forstaa hvorfor: loftet bestemmer HVORNAAR en raekke
    // bliver klar, aldrig hvilken RANG den faar. Hun var klar; det var
    // udelukkende sorteringen, der skar hende fra.
    //
    // Derfor en HASTEKLASSE foerst. Den er bevidst smal i BEGGE ender:
    //  · fremad to timer, saa der er tid til flere forsoeg;
    //  · og kun én time bagud, for en fornyelse, der allerede er sket,
    //    kan ikke forhindres — og en evigt forfalden raekke ville
    //    ellers ligge i hasteklassen for altid og udsulte resten.
    // Inden for hver klasse gaelder faerrest forsoeg foerst uaendret,
    // saa ingen af de to egenskaber koeber den anden.
    .orderBy(
      sql`case when ${subscriptions.currentPeriodEnd} is not null
                 and ${subscriptions.currentPeriodEnd} < now() + interval '2 hours'
                 and ${subscriptions.currentPeriodEnd} > now() - interval '1 hour'
            then 0 else 1 end`,
      asc(subscriptions.afstemningForsoeg),
      asc(subscriptions.currentPeriodEnd),
      asc(subscriptions.afstemningSkyldigAt),
    )
    .limit(antal)

  let afstemte = 0, fejlede = 0, nytArbejde = 0
  const detaljer: string[] = []

  // ── EN RAEKKE, DER IKKE FLYTTEDE SIG, MAA IKKE BRUGE EN PLADS ──
  // Catch'en pr. raekke (runde 7) reddede de oevrige raekker, der
  // allerede var VALGT. Den skaffede ikke plads til dem uden for
  // portionen — og det var hullet.
  //
  // Bogfoeringen af et fejlet forsoeg skriver `afstemning_forsoeg` og
  // `afstemning_naeste_at`. Fejler DEN skrivning, staar forsoegstallet
  // paa 0 og naeste forsoeg er stadig klar. Raekken har altsaa
  // noejagtig de samme sorteringsnoegler som foer — og vinder
  // udvaelgelsen igen, og igen. Med femogtyve saadanne raekker naaede
  // den seksogtyvende kunde aldrig et forsoeg. Maalt: nul kald til
  // hende i foerste koersel, og foerst et forsoeg fem timekoersler
  // senere, efter hendes frist, fordi nogle af de femogtyve da faldt
  // ud af hasteklassen.
  //
  // Derfor: raekker, koerslen ikke fik flyttet, bruger ikke koerslens
  // kapacitet. Vi henter lige saa mange nye — uden dem, vi allerede
  // har forsoegt — og fortsaetter. Skylden staar, fristprioriteten er
  // den samme forespoergsel, og fejlen logges stadig pr. raekke.
  //
  // ── HVORFOR IKKE BARE ENDNU EN SKRIVNING ─────────────────
  // Man kunne notere forsoeget i en anden, mindre skrivning i
  // catch'en. Den ville virke mod netop DEN injicerede fejl, hvor det
  // er fejlTEKSTEN, der ikke kan skrives — og svigte i det generelle
  // tilfaelde, hvor enhver skrivning til raekken fejler. Udelukkelsen
  // her holder uanset hvorfor bogfoeringen ikke lykkedes, fordi den
  // ikke skal skrive noget for at virke.
  //
  // ── OG HVORFOR IKKE BARE EN STOERRE GRAENSE ──────────────
  // `maks` er uaendret for de raekker, koerslen FAKTISK flytter. En
  // stoerre fast graense ville flytte taellet og lade fejlen staa: er
  // der `maks` forgiftede raekker, er de stadig foerst.
  const proevede: string[] = []
  const LOFT = maks * PORTIONER_PR_KOERSEL
  let plads = maks
  let loftRamt = false

  while (plads > 0) {
    if (proevede.length >= LOFT) { loftRamt = true; break }
    // ── EN EKSTRA UDVAELGELSE MAA IKKE KOSTE RUNDENS REGNSKAB ──
    // Den FOERSTE udvaelgelse ligger foer alt arbejde: kaster den, er
    // der intet at miste, og `betalingstilsyn` skriver «afstemningen
    // fejlede». De efterfoelgende ligger MIDT i runden. Kastede en af
    // dem videre, ville hele rapporten for de raekker, vi ALLEREDE har
    // afstemt, forsvinde — sammen med hver fejltekst i `detaljer`.
    // Det er samme regel som Q1, ét niveau hoejere: et kast maa koste
    // det, det er, og ikke mere.
    let raekker: { sub: string }[]
    try {
      raekker = await vaelg(Math.min(plads, LOFT - proevede.length), proevede)
    } catch (e) {
      if (!proevede.length) throw e
      detaljer.push('kunne ikke hente flere rækker: '
        + `${(e as Error).message.slice(0, 120)} — resten tages næste kørsel`)
      break
    }
    if (!raekker.length) break
    // Raekker, koerslen ikke flyttede. De giver plads til lige saa
    // mange nye — og kun de flyttede bruger af `maks`.
    let ubevaegede = 0
    for (const r of raekker) {
      proevede.push(r.sub)
      // ── ÉN RAEKKE MAA IKKE TAGE DE OEVRIGE MED SIG ────────
      // `afstemAbonnement` bogfoerer selv en Stripe-fejl. Fejler DEN
      // skrivning ogsaa, kaster den — og uden den her vagt stoppede
      // loekken, saa resten af koeen fik intet forsoeg. Maalt: tre
      // kunder, den foerste med naermest frist; A's opslag fejler og
      // bogfoeringen af fejlen fejler med, og B og C fik NUL kald i tre
      // koersler. Deres skyld stod urørt, men ingen rørte den.
      //
      // Det er noejagtig samme fejl som S5 i fornyelsesvagten, i
      // soesterkoeen. Den blev rettet ét sted og ikke det andet.
      //
      // Og et kast flytter ikke raekken: `ubevaegede` taeller den, saa
      // den ikke bruger koerslens kapacitet.
      //
      // Et kast BEVISER ikke, at bogfoeringen udeblev — runde 7 maalte
      // selv, at en skrivning kan committe, mens svaret gaar tabt. Saa
      // giver vi en plads, der ikke var noedvendig. Det koster ét
      // ekstra forsoeg paa en anden raekke og kan ikke koste andet:
      // den ekstra portion udelader alt, vi allerede har roert. Den
      // modsatte fejl — at tro en raekke flyttede sig, naar den ikke
      // gjorde — er dén, der udsulter, og den tager vi ikke.
      let u: Opsigelsesudfald
      try {
        u = await afstemAbonnement(ops, r.sub)
      } catch (e) {
        fejlede++
        ubevaegede++
        detaljer.push(`${r.sub}: afstemningen kastede — ${(e as Error).message.slice(0, 160)}`)
        continue
      }
      if (u === 'nyt_arbejde') {
        // Vores arbejde lykkedes; der kom bare mere. Det er hverken
        // «afstemt» eller «kunne ikke» — og at kalde det det ene ville
        // skjule en skyld, der staar.
        //
        // Raekken flyttede sig ikke: `skyldAfstemning` saetter
        // `afstemning_naeste_at` til null og roerer ikke forsoegstallet.
        // Den staar altsaa forrest igen, og den bruger ikke en plads.
        nytArbejde++
        ubevaegede++
      } else if (u === 'ikke_bekraeftet' || u === 'bekraeftet_ikke_bogfoert') {
        fejlede++
        // ── «BEKRAEFTET, IKKE BOGFOERT» FLYTTER HELLER IKKE ──
        // Den gren skriver skylden og fejlteksten, men hverken
        // forsoegstallet eller tilbagetraekningen — se
        // `afstemAbonnement`s oprydningsfangst. Raekken beholder altsaa
        // sine sorteringsnoegler og vinder udvaelgelsen igen. Det er
        // samme udsultning som kastet, ad en gren der IKKE kaster, og
        // den skal taelles med samme sted.
        if (u === 'bekraeftet_ikke_bogfoert') ubevaegede++
        // ── OGSAA DIAGNOSTIKKEN SKAL KUNNE FEJLE ──────────
        // Det her opslag findes kun for at kunne SIGE hvad der gik galt.
        // Kaster det, maa det ikke tage de oevrige raekker med sig —
        // saa mister vi en fejltekst, ikke en koe.
        try {
          const [n] = await db.select({ f: subscriptions.afstemningFejl,
            forsoeg: subscriptions.afstemningForsoeg })
            .from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, r.sub)).limit(1)
          detaljer.push(`${r.sub}: ${n?.f ?? 'ukendt'} (forsøg ${n?.forsoeg ?? '?'})`)
        } catch {
          detaljer.push(`${r.sub}: kunne ikke afstemmes, og fejlteksten kunne ikke læses`)
        }
      } else {
        afstemte++
      }
    }
    plads = ubevaegede
  }

  // ── LOFTET SKAL KUNNE SES ───────────────────────────────
  // Stopper koerslen paa loftet, er der stadig klare raekker, den ikke
  // naaede. Det maa ikke vaere tavst: uden linjen ville en base med
  // hundrede forgiftede raekker se ud som en helt almindelig kørsel.
  if (loftRamt) {
    // Hvor mange klare raekker koerslen IKKE naaede. Tallet maales, saa
    // linjen siger noget, man kan handle paa — «loftet er naaet» alene
    // ville ikke fortaelle, om det var én raekke eller tusind.
    let uberoerte: number | null = null
    try {
      const [n] = await db.select({ n: count() }).from(subscriptions)
        .where(and(grundvilkaar,
          notInArray(subscriptions.stripeSubscriptionId, proevede)))
      uberoerte = n?.n ?? null
    } catch { /* tallet er en oplysning, ikke en betingelse */ }
    detaljer.push(`loftet på ${LOFT} forsøgte rækker er nået`
      + (uberoerte === null ? '' : ` — ${uberoerte} klare rækker blev ikke forsøgt`)
      + '. Står linjen kørsel efter kørsel, kan skrivningerne til de'
      + ' forreste rækker ikke gennemføres; se docs/betaling/betjening.md.')
  }

  return {
    skyldige: i_alt?.n ?? 0,
    taget: proevede.length,
    afstemte, fejlede, nytArbejde,
    venter: (i_alt?.n ?? 0) - (nuKlar?.n ?? 0),
    detaljer,
  }
}
