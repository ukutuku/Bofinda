// ═══════════════════════════════════════════════════════════════
//  SERVERSIDE-MUREN foran kontaktoplysninger.
//
//  ── HVORFOR FILEN FINDES ──────────────────────────────────────
//  Hele kontaktrejsen har indtil nu været målt mod en attrap.
//  `kontaktkontrol.mjs` beviser, at brugerfladen ikke VISER låst
//  indhold. Den beviser ikke, at serveren nægter at UDLEVERE det — og
//  det er to forskellige påstande. En server action er et OFFENTLIGT
//  endepunkt: den kan kaldes direkte, uden at panelet nogensinde er
//  gengivet. Adgangskontrol i frontenden er en konvention, ikke en mur.
//
//  ── DEN VIGTIGSTE PRØVE MÅLER ET FRAVÆR ───────────────────────
//  Ikke «svaret var tomt» — et tomt svar kan opstå på to måder, og kun
//  den ene er en mur. Den måler, at opslaget ALDRIG BLEV KALDT. Derfor
//  er `laes` en parameter i `udleverKontakt`: en tæller kan se
//  forskel på «vi spurgte og kasserede svaret» og «vi spurgte aldrig».
//  Det første efterlader mailen i en variabel i processen; det andet
//  lader den blive i databasen.
//
//  ── OG ÉN PRØVE VOGTER PÅ FREMTIDEN ───────────────────────────
//  Beslutningen ejes af betalingsserien (`lib/adgang.ts`), som ikke er
//  på denne gren. Prøven fejler, hvis den fil dukker op UDEN at
//  bindingspunktet bruger den — altså i samme sekund, grenene mødes
//  uden at nogen har koblet muren til den rigtige beslutning.
//
//  Køres gennem scripts/testbase.ts: PGlite i processen, intet
//  netværk, ingen produktion. Alle data er syntetiske.
// ═══════════════════════════════════════════════════════════════

import { existsSync, readFileSync } from 'node:fs'
import { db } from '../db/client'
import { listings, sources, users } from '../db/schema'
import {
  udleverKontakt, type Beslutning, type Kontaktraekke, type Muregrund,
} from '../lib/kontaktmur'
import { hentKontaktServerside, tilLaasegrund } from '../app/kontakt-ui/server/handlinger'

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}

const SLUG = `proeve-kontaktmur-${process.pid}`
const MAIL = 'mette@attrapudlejer.invalid'
const TLF = '+45 20 00 00 00'

/** Et opslag, der TÆLLER sine kald. Hele pointen i prøve 1. */
function taellende(svar: Kontaktraekke | null) {
  let kald = 0
  return {
    kald: () => kald,
    laes: async (_id: string) => { kald++; return svar },
  }
}

const ja = async (): Promise<Beslutning> => ({ ok: true })
const nej = (grund: Muregrund) => async (): Promise<Beslutning> => ({ ok: false, grund })

async function koer() {
  // ═══ 1 · Ved nej røres databasen ALDRIG ══════════════════════
  console.log('\n══ 1 · et nej stopper FØR opslaget ══')
  for (const grund of ['abonnement_kraeves', 'login_kraeves', 'ukendt_tilstand'] as Muregrund[]) {
    const t = taellende({ mail: MAIL, telefon: TLF })
    const ud = await udleverKontakt('en-bolig', nej(grund), t.laes)
    tjek(`${grund}: opslaget blev ALDRIG kaldt`, t.kald() === 0, `${t.kald()} kald`)
    tjek(`${grund}: svaret er «naegtet»`, ud.slags === 'naegtet',
      `slags=${ud.slags}`)
    const serialiseret = JSON.stringify(ud)
    tjek(`${grund}: hverken mail eller telefon i svaret`,
      !serialiseret.includes(MAIL) && !serialiseret.includes('20 00 00 00'),
      serialiseret)
  }

  // ═══ 2 · Ved ja læses der — og først da ══════════════════════
  console.log('\n══ 2 · et ja læser, og rækkefølgen er rigtig ══')
  {
    const raekkefoelge: string[] = []
    const beslut = async (): Promise<Beslutning> => { raekkefoelge.push('beslut'); return { ok: true } }
    const laes = async (_id: string) => { raekkefoelge.push('laes'); return { mail: MAIL, telefon: TLF } }
    const ud = await udleverKontakt('en-bolig', beslut, laes)
    tjek('beslutningen kommer FØR opslaget',
      raekkefoelge.join('→') === 'beslut→laes', raekkefoelge.join('→'))
    tjek('værdierne kommer igennem',
      ud.slags === 'udleveret' && ud.mail === MAIL && ud.telefon === TLF)
  }

  // ═══ 3 · «intet oplyst» er ikke «du må ikke se det» ══════════
  console.log('\n══ 3 · tomme felter er ikke en lås ══')
  {
    const t = taellende({ mail: null, telefon: null })
    const ud = await udleverKontakt('en-bolig', ja, t.laes)
    tjek('udlejeren har ryddet felterne → stadig «udleveret»',
      ud.slags === 'udleveret', `slags=${ud.slags}`)
    tjek('og opslaget BLEV kaldt', t.kald() === 1, `${t.kald()} kald`)
  }
  {
    const t = taellende(null)
    const ud = await udleverKontakt('findes-ikke', ja, t.laes)
    tjek('ukendt bolig → «ukendt-bolig», ikke «naegtet»',
      ud.slags === 'ukendt-bolig', `slags=${ud.slags}`)
  }

  // ═══ 4 · En teknisk fejl bliver ALDRIG en betalingsopfordring ═
  console.log('\n══ 4 · ukendt tilstand er vores fejl, ikke hendes ══')
  {
    tjek('ukendt_tilstand → INGEN låsegrund (neutral fejl)',
      (await tilLaasegrund('ukendt_tilstand')) === null)
    tjek('login_kraeves → login-kraevet',
      (await tilLaasegrund('login_kraeves')) === 'login-kraevet')
    tjek('abonnement_kraeves → abonnement-kraevet',
      (await tilLaasegrund('abonnement_kraeves')) === 'abonnement-kraevet')
  }

  // ═══ 5 · Den rigtige forespørgsel: kun native, kun aktiv ═════
  console.log('\n══ 5 · SQL-muren mod PGlite ══')
  const [kilde] = await db.insert(sources)
    .values({ slug: SLUG, name: 'Prøvekilde kontaktmur', sourceType: 'spider' }).returning()
  const [u] = await db.insert(users)
    .values({ email: `udlejer-${SLUG}@example.invalid`, role: 'landlord' }).returning()

  const lav = async (n: string, sourceType: 'native' | 'spider', status: 'active' | 'delisted') => {
    const [r] = await db.insert(listings).values({
      sourceId: kilde!.id, sourceType, externalKey: `${SLUG}-${n}`,
      sourceUrl: `https://eksempel.invalid/${n}`,
      addressRaw: `Prøvegade ${n}, 9001 Prøveby N`,
      street: `Prøvegade ${n}`, houseNumber: '1', postalCode: '9001', city: 'Prøveby N',
      unitAddressUuid: `intern:v3:kontaktmur:${SLUG}-${n}`, addressMatchLevel: 'unit',
      propertyType: 'lejlighed', sizeM2: 70, rooms: 3, rentMonthly: 900000, status,
      landlordId: sourceType === 'native' ? u!.id : null,
      contactEmail: MAIL, contactPhone: TLF,
    }).returning()
    return r!.id
  }
  const nativAktiv = await lav('1', 'native', 'active')
  const nativAfmeldt = await lav('2', 'native', 'delisted')
  const scrapet = await lav('3', 'spider', 'active')

  {
    const ud = await hentKontaktServerside(nativAktiv)
    tjek('native + aktiv → udleveret', ud.slags === 'udleveret' && ud.mail === MAIL,
      `slags=${ud.slags}`)
  }
  {
    const ud = await hentKontaktServerside(nativAfmeldt)
    tjek('native + afmeldt → ukendt-bolig', ud.slags === 'ukendt-bolig', `slags=${ud.slags}`)
  }
  {
    const ud = await hentKontaktServerside(scrapet)
    tjek('scrapet bolig → ukendt-bolig (muren står i SQL’en)',
      ud.slags === 'ukendt-bolig', `slags=${ud.slags}`)
    tjek('og kildens kontaktfelter kom ikke med',
      !JSON.stringify(ud).includes(MAIL))
  }

  // ═══ 6 · Vagten mod TO steder ════════════════════════════════
  console.log('\n══ 6 · bindingspunktet, når betalingsserien lander ══')
  {
    // ⚠ KOMMENTARER SKAL VÆK FØRST. Første udgave af den her prøve var
    // grøn ved en fejl: `beslutning.ts` har den fremtidige import
    // skrevet som EKSEMPEL i sit hoved, og et regex over den rå fil
    // ramte eksemplet i stedet for koden. Altså nøjagtig den fælde,
    // prøven selv er sat til at fange — en tekstsøgning, der rammer sin
    // egen dokumentation. Strimlet kilde, ikke rå.
    const udenKommentarer = (t: string) =>
      t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

    const binding = udenKommentarer(readFileSync('app/kontakt-ui/server/beslutning.ts', 'utf8'))
    const adgangFindes = existsSync('lib/adgang.ts')
    const kobletTil = /import\s*\{[^}]*\bmaaBruge\b[^}]*\}\s*from\s*['"][^'"]*lib\/adgang['"]/.test(binding)

    if (adgangFindes) {
      tjek('lib/adgang.ts findes → bindingen SKAL bruge maaBruge', kobletTil,
        kobletTil ? '' : 'ADVARSEL: muren afgør nu noget, adgang.ts allerede afgør — to steder')
    } else {
      tjek('lib/adgang.ts findes ikke endnu → bindingen står klar', !kobletTil,
        'vagten bliver rød, hvis filen dukker op ukoblet')
    }

    // Uanset hvad: muren selv må aldrig få sin egen regel.
    const mur = udenKommentarer(readFileSync('lib/kontaktmur.ts', 'utf8'))
    const egenRegel = /\bsubscriptions\b|\bdrift\b|\badgangTil\b|hentBrugerId/.test(mur)
    tjek('lib/kontaktmur.ts har INGEN egen adgangsregel', !egenRegel,
      egenRegel ? 'muren er begyndt at afgøre selv' : 'den spørger og adlyder')
  }
}

koer()
  .then(() => {
    console.log(fejl === 0 ? '\n  ALT GRØNT\n' : `\n  ${fejl} FEJLEDE\n`)
    process.exit(fejl ? 1 : 0)
  })
  .catch((e) => { console.error('\n  AFBRUDT:', e); process.exit(1) })
