// ═══════════════════════════════════════════════════════════════
//  Hjerteklikket, der venter paa et login.
//
//  ═══ FEJLEN, DER BLEV RETTET ═══
//
//  En udlogget bruger trykkede paa hjertet, landede paa
//  `/min-side?gem=<id>`, loggede ind — og boligen var ikke gemt.
//  Oensket doede paa gulvet mellem fire filer, der hver for sig saa
//  rigtige ud: knappen sendte `?gem=`, siden laeste den ikke, formularen
//  fik den ikke, og `login()` omdirigerede direkte.
//
//  Det er den grimme slags fejl: der er ingen forkert linje at pege paa.
//  Hvert led gjorde noget rimeligt, og kun kaeden var forkert. Proeven
//  her gaar derfor HELE vejen — fra knappens adresse til raekken i
//  `favorites` — i stedet for at maale hvert led for sig.
//
//  ═══ HVOR GRAENSEN GAAR ═══
//
//  `login()` kan ikke kaldes herfra: den gaar gennem `cookies()` fra
//  next/headers, som kun findes inde i en Next-request. Samme graense
//  som afsnit 10 i test-kontovej.ts. Proeven koerer derfor det, der KAN
//  koeres — det rene lag, databaselaget og formularens markup — og
//  laeser kilden for det ene led, der ikke kan: at `login()` overhovedet
//  kalder gemmevejen. Uden den sidste kontrol kan praecis den
//  oprindelige fejl komme tilbage, uden at et eneste af tjekkene
//  ovenfor bliver roedt.
//
//      koeres af scripts/testbase.ts mod PGlite
// ═══════════════════════════════════════════════════════════════

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { favorites, listings, sources, users } from '../db/schema'
import { erFavorit, gemOenske, hentFavoritter } from '../lib/favoritter'
import {
  GEMUDFALD, GEM_KNAEKKET, GEM_PARAM, erBoligId, feltvaerdiFor, gemOenskeFra,
  gemudfaldFor, kvitteringsvaerdi, laesGemOenske,
} from '../lib/gemoenske'
import { maerkeFor } from '../lib/gemkvittering'
import { Favoritknap } from '../app/Favoritknap'
import { Konto } from '../app/udlejer/Konto'

let fejl = 0
function tjek(navn: string, ok: boolean, note = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? `  — ${note}` : ''}`)
  if (!ok) fejl++
}

const SLUG = `test-favoritforloeb-${Date.now()}`
const FALSK_ID = '00000000-0000-4000-8000-000000000000'

async function koer() {
  // ─── Grundlag ────────────────────────────────────────────────
  // Egen kilde pr. koersel. En proeve maa aldrig laane en rigtig kildes
  // historik — se noten i CLAUDE.md om test-redigering og alarmen.
  const [kilde] = await db.insert(sources)
    .values({ slug: SLUG, name: 'Prøvekilde favoritforløb', sourceType: 'spider' })
    .returning()
  const kildeId = kilde!.id

  const [a] = await db.insert(users)
    .values({ email: `a-${SLUG}@example.invalid`, role: 'tenant' }).returning()
  const [b] = await db.insert(users)
    .values({ email: `b-${SLUG}@example.invalid`, role: 'tenant' }).returning()
  const brugerA = a!.id
  const brugerB = b!.id

  const lav = async (noegle: string, status: 'active' | 'delisted') => {
    const [r] = await db.insert(listings).values({
      sourceId: kildeId, sourceType: 'spider', externalKey: `${SLUG}-${noegle}`,
      sourceUrl: `https://eksempel.invalid/${noegle}`,
      addressRaw: `Hjertevej ${noegle}, 9002 Prøveby S`,
      street: `Hjertevej ${noegle}`, houseNumber: '1',
      postalCode: '9002', city: 'Prøveby S',
      status, rentMonthly: 900000,
    }).returning()
    return r!.id
  }
  const boligId = await lav('1', 'active')
  const afmeldtId = await lav('2', 'delisted')

  // ═══ 1 · Knappen baerer oensket — paa ALLE tre flader ═══
  //
  // Enkeltkort, gruppekort og boligside bruger den SAMME komponent, saa
  // der er kun ét sted, adressen kan blive forkert. Proeven gengiver den
  // alligevel som alle tre bruger den: falder dispatcheren fra hinanden,
  // skal det ses her og ikke af en bruger.
  console.log('\n══ 1 · det udloggede hjerte peger paa login MED boligen ══')
  {
    const markup = (id: string) => renderToStaticMarkup(createElement(Favoritknap, {
      listingId: id, status: { logget: false }, adresse: 'Hjertevej 1',
    }))
    const m = markup(boligId)
    tjek('1A · hjertet er et link til Min side', m.includes('href="/min-side'), m.slice(0, 90))
    tjek('1B · og adressen baerer bolig-id\'et',
      m.includes(`${GEM_PARAM}=${boligId}`), `${GEM_PARAM}=${boligId}`)
    // Samme komponent, tre kaldesteder: app/Boligkort.tsx (enkeltkort og
    // gruppekort) og app/bolig/[id]/page.tsx. Kilden efterses, saa et
    // kaldested ikke kan falde fra uden at nogen ser det.
    const kort = readFileSync(new URL('../app/Boligkort.tsx', import.meta.url), 'utf8')
    const side = readFileSync(new URL('../app/bolig/[id]/page.tsx', import.meta.url), 'utf8')
    tjek('1C · enkeltkort og gruppekort bruger samme knap',
      (kort.match(/<Favoritknap/g) ?? []).length === 2,
      `${(kort.match(/<Favoritknap/g) ?? []).length} forekomster i Boligkort.tsx`)
    tjek('1D · boligsiden bruger den ogsaa', side.includes('<Favoritknap'))
  }

  // ═══ 2 · Det rene lag: hvad er et gyldigt oenske? ═══
  console.log('\n══ 2 · oensket laeses ét sted, og gaetter aldrig ══')
  {
    tjek('2A · et rigtigt id genkendes', erBoligId(boligId))
    tjek('2B · «🏠» er ikke et bolig-id', !erBoligId('🏠'))
    tjek('2C · en tom streng er ikke et bolig-id', !erBoligId(''))
    tjek('2D · gemOenskeFra giver id\'et igennem', gemOenskeFra(boligId) === boligId)
    tjek('2E · og null for noget, den ikke kender', gemOenskeFra('abc') === null)
    tjek('2F · undefined giver null, ikke et kast', gemOenskeFra(undefined) === null)
    // `searchParams` giver `string | string[]`. To ens klik maa ikke
    // blive til to boliger — der tages den foerste.
    tjek('2G · flere vaerdier: den foerste vinder',
      gemOenskeFra([boligId, FALSK_ID]) === boligId)
    // «Vi kunne ikke gemme den» skal kunne siges. Uden det udfald ville en
    // knaekket skrivning enten tie eller vaelte login — se noten i
    // lib/gemoenske.ts.
    tjek('2H · der findes et udfald for en fejlet skrivning',
      GEMUDFALD.includes('ikke-gemt'))
  }

  // ═══ 2b · «Intet» og «ugyldigt» er to ting ═══
  //
  // FEJLEN, DER BLEV RETTET HER: `gemOenskeFra` gav null for begge, saa
  // siden udelod det skjulte felt, og `login()` saa et helt almindeligt
  // login. Et knaekket hjertelink forsvandt uden et ord, og udfaldet
  // `ugyldigt-link` kunne ikke naas fra forloebet overhovedet.
  console.log('\n══ 2b · et knaekket link er ikke det samme som intet link ══')
  {
    tjek('2b-A · et rigtigt id giver «id»',
      laesGemOenske(boligId).slags === 'id', laesGemOenske(boligId).slags)
    tjek('2b-B · en manglende parameter giver «intet»',
      laesGemOenske(undefined).slags === 'intet' && laesGemOenske(null).slags === 'intet')
    tjek('2b-C · noget ulaeseligt giver «ugyldigt», ikke «intet»',
      laesGemOenske('abc').slags === 'ugyldigt', laesGemOenske('abc').slags)
    // `?gem=` er en adresse, der HAR baaret et hjerteklik og tabt det.
    // Det er ikke det samme som slet ingen parameter.
    tjek('2b-D · en tom parameter er et tabt oenske, ikke intet oenske',
      laesGemOenske('').slags === 'ugyldigt', laesGemOenske('').slags)
    tjek('2b-E · en tom liste er «intet»', laesGemOenske([]).slags === 'intet')
    tjek('2b-F · et File-felt er ugyldigt, ikke et kast',
      laesGemOenske({ navn: 'fil' }).slags === 'ugyldigt')
    // Mellemrum om id'et er ikke en fejl — det trimmes ét sted, her.
    tjek('2b-G · mellemrum om id\'et aendrer ikke svaret',
      laesGemOenske(`  ${boligId}  `).slags === 'id')

    // Formularen skal baere maerket videre ved et ugyldigt oensket.
    // Udelades feltet dér, er hele forskellen tabt igen.
    tjek('2b-H · feltet baerer id\'et for et gyldigt oenske',
      feltvaerdiFor(laesGemOenske(boligId)) === boligId)
    tjek('2b-I · og MAERKET for et ugyldigt',
      feltvaerdiFor(laesGemOenske('abc')) === GEM_KNAEKKET,
      String(feltvaerdiFor(laesGemOenske('abc'))))
    tjek('2b-J · intet oenske baerer intet felt',
      feltvaerdiFor(laesGemOenske(undefined)) === null)
    // Bindingen mellem de to: maerket maa ALDRIG kunne laeses som et
    // bolig-id, ellers ville et knaekket link blive slaaet op i basen.
    tjek('2b-K · maerket laeses selv som «ugyldigt»',
      laesGemOenske(GEM_KNAEKKET).slags === 'ugyldigt' && !erBoligId(GEM_KNAEKKET))
  }

  // ═══ 3 · Formularen baerer oensket videre ═══
  //
  // DET ER HER, DEN OPRINDELIGE FEJL LAA. `Konto` fik intet at vide, saa
  // POST'en fra login-formularen indeholdt ikke et ord om boligen.
  console.log('\n══ 3 · login-formularen baerer oensket ══')
  {
    const med = renderToStaticMarkup(createElement(Konto as never, {
      kontekst: 'bolig', gem: boligId,
    }))
    const uden = renderToStaticMarkup(createElement(Konto as never, { kontekst: 'bolig' }))

    tjek('3A · uden et oenske staar der intet skjult felt',
      !uden.includes(`name="${GEM_PARAM}"`))
    tjek('3B · MED et oenske staar feltet i formularen',
      med.includes(`name="${GEM_PARAM}"`) && med.includes(`value="${boligId}"`),
      med.includes(`name="${GEM_PARAM}"`) ? 'feltet er der' : 'FELTET MANGLER')

    // Feltet skal staa i LOGIN-formularen, ikke i «Opret konto»: en ny
    // konto er ikke aktiv foer bekraeftelsesmailen, saa der er ingen
    // session at gemme paa, naar den formular sendes.
    const login = med.slice(0, med.indexOf('Opret konto'))
    tjek('3C · feltet staar i login-formularen', login.includes(`name="${GEM_PARAM}"`))
    tjek('3D · og IKKE i «Opret konto»',
      (med.match(new RegExp(`name="${GEM_PARAM}"`, 'g')) ?? []).length === 1)

    // Et mislykket loginforsoeg maa ikke koste hende hjerteklikket.
    // Vaerdien kommer fra proppen, ikke fra handlingens svar, saa den
    // gengives uaendret hver gang formularen tegnes igen.
    const igen = renderToStaticMarkup(createElement(Konto as never, {
      kontekst: 'bolig', gem: boligId,
    }))
    tjek('3E · oensket overlever en ny gengivelse af formularen',
      igen.includes(`value="${boligId}"`))

    // Og det knaekkede link: feltet SKAL staa der, ellers ser `login()`
    // et almindeligt login, og hun faar ingen forklaring.
    const knaekket = renderToStaticMarkup(createElement(Konto as never, {
      kontekst: 'bolig', gem: GEM_KNAEKKET,
    }))
    tjek('3F · et knaekket link baeres OGSAA med i formularen',
      knaekket.includes(`name="${GEM_PARAM}"`)
      && knaekket.includes(`value="${GEM_KNAEKKET}"`),
      knaekket.includes(`name="${GEM_PARAM}"`) ? 'feltet er der' : 'FELTET MANGLER')
  }

  // ═══ 4 · Gemningen mod basen ═══
  console.log('\n══ 4 · gemOenske: idempotent, ejerskabet i behold ══')
  {
    const u1 = await gemOenske(brugerA, laesGemOenske(boligId))
    tjek('4A · et gyldigt oenske gemmes', u1 === 'gemt', u1)
    tjek('4B · og boligen staar paa hendes liste', await erFavorit(brugerA, boligId))

    // Kernen i «brug ikke skiftFavorit»: en allerede gemt bolig skal
    // BLIVE gemt. Et skift ville fjerne den, og hun trykkede paa et tomt
    // hjerte for at gemme.
    const u2 = await gemOenske(brugerA, laesGemOenske(boligId))
    tjek('4C · det samme oenske igen fjerner den IKKE', u2 === 'gemt', u2)
    tjek('4D · boligen er der stadig', await erFavorit(brugerA, boligId))
    const raekker = await db.select().from(favorites)
      .where(and(eq(favorites.userId, brugerA), eq(favorites.listingId, boligId)))
    tjek('4E · og der er praecis én raekke', raekker.length === 1, `${raekker.length} raekker`)

    // En afmeldt bolig skal stadig kunne gemmes. Min side viser den med
    // «Ikke laengere tilgaengelig» — at afvise den ville skjule, at
    // kilden tog den ned.
    const u3 = await gemOenske(brugerA, laesGemOenske(afmeldtId))
    tjek('4F · en afmeldt bolig kan stadig gemmes', u3 === 'gemt', u3)

    // De to fejludfald er adskilte, fordi de siger noget forskelligt.
    const u4 = await gemOenske(brugerA, laesGemOenske(FALSK_ID))
    tjek('4G · en bolig, der ikke findes, siges hoejt', u4 === 'ukendt-bolig', u4)
    const u5 = await gemOenske(brugerA, laesGemOenske('ikke-et-id'))
    tjek('4H · et knaekket link siges hoejt', u5 === 'ugyldigt-link', u5)
    // Maerket fra formularen ender som `ugyldigt-link`, uden en eneste
    // undtagelse undervejs. Det er den regression, der holder fund 1
    // lukket: naar maerket foerst baeres med, SKAL det give en besked.
    const u6 = await gemOenske(brugerA, laesGemOenske(GEM_KNAEKKET))
    tjek('4I · og formularens maerke for et knaekket link ogsaa',
      u6 === 'ugyldigt-link', u6)

    // Intet af det maa have roert en anden brugers liste.
    tjek('4J · den anden bruger har intet faaet',
      !(await erFavorit(brugerB, boligId)) && !(await erFavorit(brugerB, afmeldtId)))

    // Og listen, Min side faktisk viser, indeholder boligen.
    const liste = await hentFavoritter(brugerA)
    tjek('4K · boligen staar under «Gemte boliger»',
      liste.some((x) => x.listingId === boligId),
      `${liste.length} paa listen`)
  }

  // ═══ 5 · Leddene, der ikke kan kaldes herfra ═══
  //
  // STRUKTUREL, ikke adfaerdsmaessig — og med vilje. `login()` og
  // `min-side/page.tsx` gaar begge gennem `cookies()`. Uden de fire tjek
  // her kan hele kaeden falde fra hinanden igen, mens alt ovenfor
  // forbliver groent.
  console.log('\n══ 5 · kaeden er koblet sammen ══')
  {
    /**
     * Kommentarerne skaeres fra FOERST.
     *
     * Ikke pynt: foerste udgave af 5B maalte ordet `redirect()` inde i en
     * kommentar og blev roed, mens koden var rigtig. En strukturel proeve,
     * der kan narres af prosa, maaler prosaen — og den ville lige saa
     * gerne kunne blive GROEN af en kommentar, mens koden var forkert.
     */
    const udenKommentarer = (t: string) => t
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    const h = udenKommentarer(
      readFileSync(new URL('../app/udlejer/handlinger.ts', import.meta.url), 'utf8'))
    const side = udenKommentarer(
      readFileSync(new URL('../app/min-side/page.tsx', import.meta.url), 'utf8'))

    /** Én funktions krop — fra dens navn til den naeste `export`. */
    const krop = (t: string, navn: string) => {
      const i = t.indexOf(navn)
      if (i < 0) return ''
      const j = t.indexOf('\nexport ', i + 1)
      return t.slice(i, j < 0 ? undefined : j)
    }
    const login = krop(h, 'export async function login(')
    const gemvej = krop(h, 'async function fuldfoerGemOenske(')
    const udlog = krop(h, 'export async function logUd(')
    const minsideH = udenKommentarer(
      readFileSync(new URL('../app/min-side/handlinger.ts', import.meta.url), 'utf8'))

    tjek('5A · login() laeser gemmefeltet', login.includes('GEM_PARAM'), login ? '' : 'LOGIN BLEV IKKE FUNDET')
    tjek('5B · login() gennemfoerer oensket FOER omdirigeringen',
      login.indexOf('fuldfoerGemOenske') > -1
      && login.indexOf('fuldfoerGemOenske') < login.indexOf('redirect('))
    tjek('5C · gemningen bruger gemOenske, ikke skiftFavorit',
      h.includes('gemOenske(') && !h.includes('skiftFavorit'))
    tjek('5D · identiteten kommer fra sessionen, ikke fra formularen',
      h.includes('hentBrugerStatus()') && !/gemOenske\([^)]*f\.get/.test(h))

    tjek('5E · Min side laeser oensket og sender det videre',
      side.includes('laesGemOenske(sp[GEM_PARAM])')
      && /<Konto[\s\S]*?gem=\{feltvaerdiFor\(oenske\)\}/.test(side),
      side.includes('laesGemOenske(sp[GEM_PARAM])') ? '' : 'SIDEN LAESER IKKE OENSKET')
    // Siden er en GET. Den maa laese oensket, aldrig gemme det.
    tjek('5F · Min side gemmer ikke selv',
      !side.includes('gemFavorit(') && !side.includes('gemOenske('))
    // Fund 1: den udloggede skal kunne SE, at linket knaekkede — foer hun
    // bruger tid paa at logge ind for en bolig, der ikke kommer.
    tjek('5G · Min side siger det med det samme ved et knaekket link',
      /oenske\.slags === 'ugyldigt'/.test(side) && side.includes('Linket virkede ikke'))

    // ── Fund 2: kvitteringen skal ryddes, ikke ventes ud ──────
    //
    // Hver af de fire veje herunder goer den gamle kvittering forkert.
    // Falder én af dem fra, kan en besked fra ét forloeb staa som svar
    // paa et andet — og det er ikke noget, en adfaerdsproeve faar oeje
    // paa, medmindre den rammer netop det vindue.
    tjek('5H · et login UDEN et oenske rydder den gamle kvittering',
      /oenske\.slags === 'intet'/.test(gemvej)
      && /'intet'[\s\S]{0,120}ryddGemkvittering\(\)/.test(gemvej),
      gemvej ? '' : 'GEMVEJEN BLEV IKKE FUNDET')
    tjek('5I · en udlogning rydder den',
      udlog.includes('ryddGemkvittering()'), udlog ? '' : 'logUd BLEV IKKE FUNDET')
    tjek('5J · en nyere favorithandling rydder den',
      (minsideH.match(/ryddGemkvittering\(\)/g) ?? []).length === 2,
      `${(minsideH.match(/ryddGemkvittering\(\)/g) ?? []).length} steder i min-side/handlinger.ts`)
    // Kvitteringen skrives ÉT sted, med en ejer. Skrev `login()` selv i
    // cookien, kunne den skrives uden — og saa er maerket ingenting vaerd.
    tjek('5K · kvitteringen skrives med en ejer, og kun ét sted',
      gemvej.includes('saetGemkvittering(udfald, ejer)')
      && !h.includes('jar.set(GEMCOOKIE'))
    tjek('5L · Min side laeser kvitteringen for DEN indloggede',
      side.includes('laesGemkvittering(bruger.id)'))
  }

  // ═══ 6 · Kvitteringen taler kun til den, der lavede klikket ═══
  //
  // FEJLEN, DER BLEV RETTET HER: kvitteringen levede 30 sekunder og blev
  // aldrig ryddet. Inden for det vindue kunne den samme bruger logge ud og
  // ind igen UDEN et hjerteklik og faa «Boligen er gemt.» — og en ANDEN
  // konto paa den samme maskine kunne faa den samme besked om en bolig,
  // hun aldrig havde set.
  //
  // Der er to uafhaengige spaerringer. Sektion 5 maaler den foerste (den
  // ryddes). Den her maaler den anden (den baerer, hvem den var til) — og
  // den kan maales UDEN at vente et sekund, netop fordi den ikke hviler
  // paa tid.
  console.log('\n══ 6 · kvitteringen kan ikke tale til en fremmed konto ══')
  {
    const mA = maerkeFor(brugerA)
    const mB = maerkeFor(brugerB)

    tjek('6A · maerket er ikke bruger-id\'et', mA !== brugerA && !mA.includes(brugerA), mA)
    tjek('6B · to konti faar hver sit maerke', mA !== mB && mB.length > 0)
    tjek('6C · og den samme konto faar det samme hver gang', maerkeFor(brugerA) === mA)

    const hendes = kvitteringsvaerdi('gemt', mA)
    tjek('6D · hendes egen kvittering laeses', gemudfaldFor(hendes, mA) === 'gemt',
      String(gemudfaldFor(hendes, mA)))
    // KONTOSKIFTET. Ingen ventetid, intet vindue — den kan simpelthen
    // ikke laeses af nogen anden.
    tjek('6E · en ANDEN kontos kvittering laeses IKKE',
      gemudfaldFor(hendes, mB) === null, String(gemudfaldFor(hendes, mB)))
    tjek('6F · alle fire udfald baeres frem og tilbage',
      GEMUDFALD.every((u) => gemudfaldFor(kvitteringsvaerdi(u, mA), mA) === u),
      GEMUDFALD.join(', '))
    tjek('6G · et ord, vi ikke kender, giver intet udfald',
      gemudfaldFor(`gemt!:${mA}`, mA) === null)
    // Den gamle form uden ejer — en cookie fra foer rettelsen, eller noget
    // haandskrevet. Den vises ikke: en kvittering, vi ikke kan tilskrive
    // nogen, er ikke et svar til nogen.
    tjek('6H · den gamle form UDEN ejer vises ikke', gemudfaldFor('gemt', mA) === null)
    tjek('6I · og en vaerdi uden udfald heller ikke', gemudfaldFor(`:${mA}`, mA) === null)
    // Uden en konto er der ingen at vise noget for.
    tjek('6J · uden et maerke laeses intet',
      maerkeFor('') === '' && gemudfaldFor(kvitteringsvaerdi('gemt', ''), '') === null)
  }

  // ─── Ryd op ──────────────────────────────────────────────────
  await db.delete(favorites).where(eq(favorites.userId, brugerA))
  await db.delete(favorites).where(eq(favorites.userId, brugerB))
  await db.delete(listings).where(eq(listings.sourceId, kildeId))
  await db.delete(users).where(eq(users.id, brugerA))
  await db.delete(users).where(eq(users.id, brugerB))
  await db.delete(sources).where(eq(sources.id, kildeId))
}

await koer()
console.log(fejl === 0 ? '\n  ALT GRØNT' : `\n  ✗ ${fejl} FEJLEDE`)
if (fejl > 0) process.exit(1)
