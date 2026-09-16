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
import { GEMUDFALD, GEM_PARAM, erBoligId, gemOenskeFra, gemudfaldFra } from '../lib/gemoenske'
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
    tjek('2H · gemudfaldFra kender kun de tre ord',
      GEMUDFALD.every((u) => gemudfaldFra(u) === u) && gemudfaldFra('gemt!') === null)
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
  }

  // ═══ 4 · Gemningen mod basen ═══
  console.log('\n══ 4 · gemOenske: idempotent, ejerskabet i behold ══')
  {
    const u1 = await gemOenske(brugerA, boligId)
    tjek('4A · et gyldigt oenske gemmes', u1 === 'gemt', u1)
    tjek('4B · og boligen staar paa hendes liste', await erFavorit(brugerA, boligId))

    // Kernen i «brug ikke skiftFavorit»: en allerede gemt bolig skal
    // BLIVE gemt. Et skift ville fjerne den, og hun trykkede paa et tomt
    // hjerte for at gemme.
    const u2 = await gemOenske(brugerA, boligId)
    tjek('4C · det samme oenske igen fjerner den IKKE', u2 === 'gemt', u2)
    tjek('4D · boligen er der stadig', await erFavorit(brugerA, boligId))
    const raekker = await db.select().from(favorites)
      .where(and(eq(favorites.userId, brugerA), eq(favorites.listingId, boligId)))
    tjek('4E · og der er praecis én raekke', raekker.length === 1, `${raekker.length} raekker`)

    // En afmeldt bolig skal stadig kunne gemmes. Min side viser den med
    // «Ikke laengere tilgaengelig» — at afvise den ville skjule, at
    // kilden tog den ned.
    const u3 = await gemOenske(brugerA, afmeldtId)
    tjek('4F · en afmeldt bolig kan stadig gemmes', u3 === 'gemt', u3)

    // De to fejludfald er adskilte, fordi de siger noget forskelligt.
    const u4 = await gemOenske(brugerA, FALSK_ID)
    tjek('4G · en bolig, der ikke findes, siges hoejt', u4 === 'ukendt-bolig', u4)
    const u5 = await gemOenske(brugerA, 'ikke-et-id')
    tjek('4H · et knaekket link siges hoejt', u5 === 'ugyldigt-link', u5)
    const u6 = await gemOenske(brugerA, null)
    tjek('4I · og et tomt oenske ogsaa', u6 === 'ugyldigt-link', u6)

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

    const login = (() => {
      const i = h.indexOf('export async function login(')
      const j = h.indexOf('\nexport ', i + 1)
      return i < 0 ? '' : h.slice(i, j < 0 ? undefined : j)
    })()

    tjek('5A · login() laeser gemmefeltet', login.includes('GEM_PARAM'), login ? '' : 'LOGIN BLEV IKKE FUNDET')
    tjek('5B · login() gennemfoerer oensket FOER omdirigeringen',
      login.indexOf('fuldfoerGemOenske') > -1
      && login.indexOf('fuldfoerGemOenske') < login.indexOf('redirect('))
    tjek('5C · gemningen bruger gemOenske, ikke skiftFavorit',
      h.includes('gemOenske(') && !h.includes('skiftFavorit'))
    tjek('5D · identiteten kommer fra sessionen, ikke fra formularen',
      h.includes('hentBrugerStatus()') && !/gemOenske\([^)]*f\.get/.test(h))

    tjek('5E · Min side laeser oensket og sender det videre',
      side.includes('gemOenskeFra(sp[GEM_PARAM])') && /<Konto[^>]*gem=\{oenske\}/s.test(side))
    // Siden er en GET. Den maa laese oensket, aldrig gemme det.
    tjek('5F · Min side gemmer ikke selv',
      !side.includes('gemFavorit(') && !side.includes('gemOenske('))
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
