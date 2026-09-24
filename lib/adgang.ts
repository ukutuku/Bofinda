// ═══════════════════════════════════════════════════════════════
//  DEN CENTRALE ADGANGSKONTROL
//
//  Ét sted afgoer, om en bruger maa naa en betalt funktion. Alle
//  indgange spoerger den samme funktion — `maaBruge()` — og ingen af
//  dem bygger sit eget praedikat.
//
//  Hvorfor ét sted: CLAUDE.md's dyreste regel er, at to udtryk for det
//  samme spoergsmaal driver fra hinanden, og at BEGGE ser rigtige ud
//  hver for sig. En mur, der staar tre steder, er tre mure, og den ene
//  bliver glemt. Derfor er `maaBruge()` den eneste, der laeser baade
//  driftstilstanden og abonnementet.
//
//  ── Graensefladen, beskedmodulet skal bruge ──────────────────
//  Beskedmodulet bygges i en anden gren og maa IKKE lave sin egen
//  regel. Den bruger:
//
//      import { maaBruge, FUNKTION } from '../lib/adgang'
//      const svar = await maaBruge(FUNKTION.beskeder)
//      if (!svar.ok) return svar        // svar.grund siger hvorfor
//
//  Den besluttede adfaerd for beskeder er allerede indbygget i
//  `FUNKTION.beskeder`: GRATIS kraever login (egne samtaler), BETALING
//  kraever et gyldigt abonnement, og en OPSAGT men endnu ikke udloebet
//  periode giver stadig adgang. Ved udloeb laases laesning og
//  afsendelse — beskederne slettes ikke; det er visningens ansvar at
//  sige det.
//
//  ── Fejl lukker, den aabner ikke ─────────────────────────────
//  GRATIS er den AABNE tilstand. Kan tilstanden ikke laeses, ville et
//  fallback til gratis vaere at give adgangen vaek, fordi databasen
//  hikkede. Derfor falder vi tilbage til BETALING og naegter — med en
//  fejltekst, der siger at vi ikke kunne bekraefte adgangen, ikke at
//  hun skal koebe. At sende et menneske til kassen paa grund af vores
//  egen fejl ville vaere den samme loegn som et gaettet aconto-beloeb.
// ═══════════════════════════════════════════════════════════════

import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { db } from '../db/client'
import { drift, subscriptions } from '../db/schema'
import { GRUNDE, type Grund } from './adgangsgrunde'
import type { KoebsstartProps } from './maaling'
import { hentBrugerId } from './auth'
// TYPE-import, og kun type. `app/beskeder/kontrakt.ts` er en REN fil —
// ingen database, ingen React, ingen next/headers — og `import type`
// slettes ved oversættelsen, så workeren i tsx aldrig ser den. Retningen
// lib → app er ny i repoet og er et bevidst valg: kontrakten er
// brugerfladens, og det er Supply, der skal opfylde den. Bandt vi os til
// vores EGEN kopi af ordene i stedet, ville der være to lister over,
// hvad brugerfladen kan vise — og de ville drive fra hinanden.
import type { Laasegrund } from '../app/beskeder/kontrakt'

export type Tilstand = 'gratis' | 'betaling'

/**
 * De funktioner, muren kan staa foran. Et LUKKET saet: en ny indgang
 * skal navngives her, ikke opfindes paa stedet.
 */
export const FUNKTION = {
  /** Udlejerens mail og telefon paa en native annonce. */
  kontakt: 'kontakt',
  /** Videresendelse til kildens egen annonce, /go/[id]. */
  kildelink: 'kildelink',
  /** Beskedmodulet. Bygges senere; reglen staar her allerede. */
  beskeder: 'beskeder',
} as const
export type Funktion = typeof FUNKTION[keyof typeof FUNKTION]

// Grundene bor i lib/adgangsgrunde.ts, som IKKE importerer databasen —
// lib/maaling.ts skal kunne laese dem. De genudsendes her, saa
// kaldestederne kun behoever at kende ét modul.
export { GRUNDE }
export type { Grund }

export type Adgangssvar =
  | { ok: true; tilstand: Tilstand; adgangTil: Date | null }
  | { ok: false; tilstand: Tilstand; grund: Grund; adgangTil: null }

/**
 * Driftstilstanden, laest paa serveren.
 *
 * Ikke cachet. Tilstanden er en NOEDBREMSE: bliver den slaaet til,
 * skal den virke i samme sekund, og en femminutters cache ville
 * betyde, at muren stod aaben i fem minutter efter, nogen lukkede den.
 * Prisen er ét indeksopslag paa en tabel med én raekke — og den koeres
 * kun paa de faa ruter, der faktisk spoerger.
 *
 * KASTER IKKE. Kan raekken ikke laeses, returneres null, og kaldet
 * ovenfor behandler det som «betaling» (=naegt).
 */
export async function hentTilstand(): Promise<Tilstand | null> {
  try {
    const [r] = await db.select({ t: drift.tilstand }).from(drift).limit(1)
    return r?.t ?? null
  } catch {
    return null
  }
}


/**
 * Hvad basen ved om hendes betalte perioder.
 *
 * FIRE udfald, fordi «aldrig», «udloebet» og «vi kunne ikke laese det»
 * er tre forskellige sandheder. Kun den foerste maa sende nogen til
 * kassen som foerstegangskoeber; kun den sidste er vores egen fejl.
 */
export type Betaltperiode =
  | { slags: 'loeber'; til: Date }
  | { slags: 'udloebet'; sidst: Date }
  | { slags: 'aldrig' }
  | { slags: 'fejl' }

/**
 * DEN BETALTE PERIODE — en KENDSGERNING om hendes abonnement.
 *
 * ⚠ IKKE EN ADGANGSBESLUTNING. Den laeser ikke `drift` og kender ikke
 * noedbremsen. Skal nogen LUKKES IND, gaar det gennem `maaBruge()`,
 * som spoerger begge dele. Bruges den her som en mur, staar muren
 * aaben, naar tilstanden slaas om — og det er praecis den fejl, hele
 * lib/adgang.ts findes for at forhindre.
 *
 * Den er til de tre SIDER, der skal fortaelle hende, hvad der staar paa
 * hendes abonnement: koebssiden, kvitteringen og Mit abonnement. De
 * spoerger ikke om lov — de beskriver en kendsgerning — og de skal
 * beskrive den SAMME som muren, ellers siger to skaerme hver sit om de
 * samme penge.
 *
 * Raekkevalget er murens: MAX(adgang_til) over ALLE hendes raekker.
 * Panelets eget raekkevalg (levende foerst, ellers nyeste efter
 * oprettet_at) besvarer et andet spoergsmaal — hvilken KONTRAKT er
 * hendes — og det bliver liggende i `abonnementForBruger`, hvor de ti
 * kontraktfelter hoerer hjemme.
 */
export const betaltPeriode = (brugerId: string): Promise<Betaltperiode> =>
  adgangEller(brugerId)

/**
 * Som `betaltPeriode`, men skelner «ingen adgang» fra «vi kunne ikke
 * finde ud af det» — og «aldrig haft» fra «udloebet».
 *
 * Forskellen er ikke teknisk pedanteri: «ingen adgang» sender et
 * menneske til kassen, «vi kunne ikke finde ud af det» siger undskyld.
 * Blandes de to, opkraever vi nogen for vores egen databasefejl.
 */
async function adgangEller(brugerId: string): Promise<Betaltperiode> {
  try {
    return await slaaAdgangOp(brugerId, new Date())
  } catch {
    return { slags: 'fejl' }
  }
}

/**
 * ÉT opslag. ÉN sammenligning. ÉT `nu`.
 *
 * ═══ HVORFOR now() ER FLYTTET UD AF SQL'EN ═══
 *
 * Foer stod `gt(adgangTil, new Date())` i `where`, og saa faldt en
 * UDLOEBET raekke ud af svaret praecis som ingen raekke. De to er ikke
 * det samme, og brugeren skal kunne se forskellen — men forespoergslen
 * kunne ikke udtrykke den.
 *
 * Nu spoerger `where` om noget andet: «findes der en betalt periode
 * overhovedet». Raekken med MAX(adgang_til) svarer saa paa BEGGE
 * spoergsmaal paa én gang — er den i fremtiden, er der adgang, og er
 * den i fortiden, er den praecis den dato, adgangen loeb ud.
 *
 * Det er stadig ÉT udtryk for «har hun adgang»; det er bare flyttet fra
 * SQL til JS. To forespoergsler — «findes en levende?» plus «findes en
 * udloebet?» — ville vaere to `new Date()` paa hver sin klokke og
 * dermed et nyt par udtryk for det samme spoergsmaal. Klokken skifter
 * ikke: `gt()` bandt allerede JS' `Date` som parameter.
 *
 * ═══ HVORFOR isNotNull, OG IKKE «nulls last» ═══
 *
 * `order by … desc` er NULLS FIRST i Postgres. En raekke med
 * `adgang_til = null` ville derfor vinde over hver eneste udloebet
 * raekke — og svaret ville blive «har aldrig haft» om en kunde, der HAR
 * haft. Maalt i PGlite, ikke formodet.
 *
 * Og kombinationen er ikke konstrueret: `lib/webhook.ts` indsaetter
 * rutinemaessigt `status = 'incomplete'` uden `adgang_til`, og migration
 * 0023's DELVISE indeks tillader netop «én levende plus vilkaarligt
 * mange afsluttede». Det er altsaa den kunde, der lige er begyndt et
 * nyt koeb — praecis hende, der skulle se «Genaktivér».
 *
 * Filteret ligger i `where` og ikke som et sorteringstillaeg: et
 * tillaeg kan forsvinde i en oprydning, uden at forespoergslen holder
 * op med at virke, og drizzle 0.38 har ingen `nullsLast()` paa `desc()`
 * — det skulle skrives som raa `sql` og miste bindingen til kolonnen.
 *
 * `sub_adgang_idx (user_id, adgang_til)` fra 0022 passer uaendret:
 * lighed paa `user_id`, baglaens scan efter den stoerste. Ingen ny
 * migration, samme antal forespoergsler som foer — én.
 */
async function slaaAdgangOp(brugerId: string, nu: Date): Promise<Betaltperiode> {
  const [r] = await db
    .select({ til: subscriptions.adgangTil })
    .from(subscriptions)
    .where(and(
      eq(subscriptions.userId, brugerId),
      // «Har hun NOGENSINDE betalt?» — ikke «har hun adgang NU».
      // `adgang_til` skrives ét sted: den monotone skrivning i
      // `invoice.paid`. Er den sat, ER der kommet penge.
      isNotNull(subscriptions.adgangTil),
    ))
    .orderBy(desc(subscriptions.adgangTil))
    .limit(1)

  if (!r?.til) return { slags: 'aldrig' }
  // DEN ENESTE sammenligning. Stod den baade her og i `where`, var vi
  // tilbage ved to udtryk for det samme spoergsmaal.
  return r.til > nu
    ? { slags: 'loeber', til: r.til }
    : { slags: 'udloebet', sidst: r.til }
}

/**
 * DEN ENESTE adgangsbeslutning. Alle indgange gaar gennem den.
 *
 * `brugerId` kan gives med, naar kaldet allerede har slaaet den op —
 * ellers hentes den fra den VERIFICEREDE session. Den maa aldrig komme
 * fra browseren.
 */
export async function maaBruge(
  funktion: Funktion,
  brugerId?: string | null,
): Promise<Adgangssvar> {
  const tilstand = await hentTilstand()
  if (tilstand === null) {
    // Vores fejl, ikke brugerens. Naegt, men sig hvad der er galt.
    return { ok: false, tilstand: 'betaling', grund: 'ukendt_tilstand', adgangTil: null }
  }

  if (tilstand === 'gratis') {
    // Muren er fra. Beskeder kraever STADIG login — gratis tilstand
    // aendrer ikke kontoejerskab eller beskyttelsen af private data.
    if (funktion === FUNKTION.beskeder) {
      const id = brugerId ?? await hentBrugerId()
      return id
        ? { ok: true, tilstand, adgangTil: null }
        : { ok: false, tilstand, grund: 'login_kraeves', adgangTil: null }
    }
    return { ok: true, tilstand, adgangTil: null }
  }

  // BETALING. Alt herunder kraever baade en konto og en betalt periode.
  const id = brugerId ?? await hentBrugerId()
  if (!id) return { ok: false, tilstand, grund: 'login_kraeves', adgangTil: null }

  const opslag = await adgangEller(id)
  // Kunne opslaget ikke laves, er det VORES fejl — ikke en manglende
  // betaling. Fail-closed gaelder begge led: baade tilstanden og
  // abonnementet naegter ved fejl, men de siger hver sin sandhed om
  // hvorfor.
  if (opslag.slags === 'fejl') {
    return { ok: false, tilstand, grund: 'ukendt_tilstand', adgangTil: null }
  }
  if (opslag.slags === 'loeber') {
    return { ok: true, tilstand, adgangTil: opslag.til }
  }
  // DATOEN BAERES IKKE MED UD. Vi kender den (`opslag.sidst`), men intet
  // kaldested viser den endnu, og et felt, ingen runtime-kode laeser, er
  // praecis den form, CLAUDE.md's foerste «maa aldrig ske» handler om.
  // Den tilfoejes den dag, et kaldested skal vise den — og saa skal
  // formateringen afgoeres foerst: serveren koerer UTC paa Vercel, og
  // `toLocaleString('da-DK')` paa et udloeb kl. 00.30 dansk tid skriver
  // den forrige dato.
  return {
    ok: false,
    tilstand,
    adgangTil: null,
    grund: opslag.slags === 'udloebet' ? 'abonnement_udloebet' : 'abonnement_kraeves',
  }
}

/**
 * Adgangstilstanden, oversat til beskedmodulets eget ord.
 *
 * ═══ HVORFOR OVERSAETTELSEN LIGGER HER ═══
 *
 * `app/beskeder/DATAKONTRAKT.md` §5.1 beder Supply om netop den her
 * funktion — ikke om en vaerdi. Grunden staar i kontrakten selv:
 * «Ingen komponent regner en adgangsregel.» Byggede vi kun den fjerde
 * grund, ville beskedlagets serverside selv skulle skrive
 * `Grund → Laasegrund`, og saa var der to steder, der afgjorde, hvad
 * brugeren ser. Det er CLAUDE.md's dyreste regel, ét lag hoejere oppe.
 *
 * `Record<Grund, …>` og ikke en `switch`: en femte grund kan saa ikke
 * tilfoejes uden at oversaettelsen ogsaa bliver skrevet. Oversaetteren
 * fejler ved oversaettelsen, ikke i en gren, nogen maaske ikke naar.
 *
 * ═══ DEN FEMTE VAERDI, KONTRAKTEN IKKE KENDTE ═══
 *
 * Kontrakten skriver `Promise<'adgang' | Laasegrund>`. Den blev skrevet
 * uden kendskab til `ukendt_tilstand`, og de tre laasegrunde kan ikke
 * udtrykke den: «log ind» er forkert over for en, der ER logget ind, og
 * «koeb et abonnement» sender et menneske til kassen paa grund af vores
 * egen fejl — praecis det, `maaBruge` findes for at undgaa. Derfor er
 * returtypen kontraktens union PLUS ét ord.
 *
 * Brugerfladen mangler dermed én tekst i `Laast.tsx`, foer `/beskeder`
 * kan gaa i luften. Det er en aaben ende, og den staar her i stedet for
 * at blive lukket med en usandhed.
 */
export type Beskedadgang = 'adgang' | Laasegrund | 'ukendt-tilstand'

const TIL_LAASEGRUND: Record<Grund, Exclude<Beskedadgang, 'adgang'>> = {
  login_kraeves: 'login-kraevet',
  abonnement_kraeves: 'abonnement-kraevet',
  abonnement_udloebet: 'abonnement-udloebet',
  // VORES fejl. Aldrig en af de to abonnementsvaerdier: begge ville
  // stille et menneske over for en betaling, fordi vi ikke kunne laese
  // vores egen base.
  ukendt_tilstand: 'ukendt-tilstand',
}

export async function adgang(brugerId?: string | null): Promise<Beskedadgang> {
  const svar = await maaBruge(FUNKTION.beskeder, brugerId)
  return svar.ok ? 'adgang' : TIL_LAASEGRUND[svar.grund]
}

// ═══════════════════════════════════════════════════════════════
//  KOEBSSTARTEN — hvad tragten maa sige om et paabegyndt koeb.
//
//  `checkout_started` bar foer `funktion: 'kontakt'` haardkodet og
//  ingen `grund` overhovedet. Begge dele er maalefejl med hver sin
//  form: den ene er et OPDIGTET felt, den anden et MANGLENDE.
//
//  Uden `grund` kan genaktiveringstragten ikke maales — vi kan se, at
//  nogen blev stoppet af muren, og at nogen begyndte et koeb, men ikke
//  om det var den samme slags menneske.
// ═══════════════════════════════════════════════════════════════

/**
 * Er det et FOERSTE koeb eller en GENAKTIVERING?
 *
 * ⚠ Returnerer KUN grunde til et nej — aldrig et ja. Den kan derfor
 * ikke bruges som en mur: der findes ingen vaerdi, man kan lukke nogen
 * ind paa. Enhver adgangsbeslutning skal stadig gennem `maaBruge()`,
 * som ogsaa laeser `drift`.
 *
 * Kendsgerningen er den SAMME, muren brugte til at stoppe hende —
 * samme opslag, samme raekkevalg. Ville vi udlede den af noget andet,
 * var det to udtryk for ét spoergsmaal.
 *
 * `undefined` naar vi ikke ved det: et fejlet opslag, eller en bruger
 * der har adgang (kan ikke naas her — `startKoeb` har allerede afvist
 * med `har_allerede`). Feltet udelades da; et gaet i en tragt er en
 * loegn, der ser ud som et tal.
 */
export type Koebsgrund = Extract<Grund, 'abonnement_kraeves' | 'abonnement_udloebet'>

export async function koebsgrund(brugerId: string): Promise<Koebsgrund | undefined> {
  const o = await adgangEller(brugerId)
  if (o.slags === 'udloebet') return 'abonnement_udloebet'
  if (o.slags === 'aldrig') return 'abonnement_kraeves'
  return undefined
}

/**
 * Hvilken mur sendte hende til koebssiden?
 *
 * Udledt af den GENOPBYGGEDE returvej — `betalingsRetur` i lib/retur.ts
 * matcher mod et lukket saet moenstre og returnerer traefferen, ikke
 * inddata. Strengen er altsaa vores egen, og vi handler i forvejen paa
 * den: det er dér, hun sendes hen bagefter.
 *
 * ⚠ Det er IKKE det samme som at laese `?grund=` som en kendsgerning.
 * Den ville vaere en paastand om HENDES betalingshistorik, taget fra en
 * adresse, enhver kan skrive. Det her er en oplysning om, hvor
 * browseren var — en maaledimension, ikke et udsagn om et menneske —
 * og den maa aldrig bruges til andet.
 *
 * `undefined`, naar ingen mur stod i vejen: kom hun fra /min-side eller
 * forsiden, er der intet at navngive, og saa udelades feltet.
 */
export function funktionFraRetur(retur: string): Funktion | undefined {
  if (/^\/bolig\//i.test(retur)) return FUNKTION.kontakt
  if (/^\/go\//i.test(retur)) return FUNKTION.kildelink
  return undefined
}

/**
 * Properties til `checkout_started`. Bygget ÉT sted, saa kaldestedet
 * ikke kan komme til at opfinde dem igen.
 *
 * `tilstand: 'betaling'` er ikke et gaet: `startKoebFor` laeser `drift`
 * `for share` inde i sin transaktion og kaster `gratis_tilstand`, hvis
 * den ikke staar paa betaling. Eventet skrives kun, naar koebet
 * lykkedes, saa tilstanden er sand ved konstruktion.
 */
export async function koebsstart(
  brugerId: string, retur: string,
): Promise<KoebsstartProps> {
  const funktion = funktionFraRetur(retur)
  const grund = await koebsgrund(brugerId)
  return {
    tilstand: 'betaling',
    ...(funktion ? { funktion } : {}),
    ...(grund ? { grund } : {}),
  }
}

