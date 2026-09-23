// ═══════════════════════════════════════════════════════════════
//  Brugerområdet: favoritter og gemte søgninger.
//
//  Køres af scripts/testbase.ts mod PGlite — rigtig Postgres i processen,
//  med de rigtige migrationer. Ingen produktionsdatabase.
//
//  ═══ HVAD DER PROEVES, OG HVOR ═══
//
//  Ejerskabet haandhaeves i FORESPOERGSLEN, ikke i en RLS-politik.
//  Migration 0002 goer `revoke all ... from anon, authenticated` og
//  opretter med vilje ingen politikker: browseren naar aldrig tabellen,
//  og serveren taler som ejer-rollen. En RLS-proeve mod PGlite ville
//  maale, at politikken FINDES, ikke at den virker — `auth.uid()` er en
//  stub, der giver null. Se CLAUDE.md under «RLS er ikke daekket».
//
//  Derfor proeves ejerskabet dér, hvor det bor: at `user_id` staar i hver
//  eneste WHERE. Fjernes det fra `fjernFavorit`, bliver 2C roed.
// ═══════════════════════════════════════════════════════════════

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { favorites, listingImages, listings, savedSearches, sources, users } from '../db/schema'
import {
  aktiveBlandt, erFavorit, favoritIder, fjernFavorit, gemFavorit,
  hentFavoritter, statusFor, type GemtBolig,
} from '../lib/favoritter'
import { Favoritknap } from '../app/Favoritknap'
import { Gemtkort } from '../app/min-side/Gemtkort'

let fejl = 0
function tjek(navn: string, ok: boolean, note = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? `  — ${note}` : ''}`)
  if (!ok) fejl++
}

const SLUG = `test-brugeromraade-${Date.now()}`

async function koer() {
  // ─── Grundlag ────────────────────────────────────────────────
  // Egen kilde pr. koersel, som proeverne i test-soegning.ts: en proeve
  // maa aldrig laane en rigtig kildes historik.
  const [kilde] = await db.insert(sources)
    .values({ slug: SLUG, name: 'Prøvekilde brugerområde', sourceType: 'spider' })
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
      addressRaw: `Prøvevej ${noegle}, 9001 Prøveby N`,
      street: `Prøvevej ${noegle}`, houseNumber: '1', postalCode: '9001', city: 'Prøveby N',
      unitAddressUuid: `intern:v3:brugeromraade:${SLUG}-${noegle}`, addressMatchLevel: 'unit',
      propertyType: 'lejlighed', sizeM2: 70, rooms: 3, rentMonthly: 900000, status,
    }).returning()
    return r!.id
  }
  const bolig1 = await lav('1', 'active')
  const bolig2 = await lav('2', 'active')
  const afmeldt = await lav('3', 'delisted')

  // ═══ 1 · Gem og fjern ══════════════════════════════════════════
  console.log('\n══ 1 · gem og fjern ══')
  {
    tjek('1 · udgangspunkt: ingen favoritter', !(await erFavorit(brugerA, bolig1)))

    await gemFavorit(brugerA, bolig1)
    tjek('1 · gemt', await erFavorit(brugerA, bolig1))

    await fjernFavorit(brugerA, bolig1)
    tjek('1 · fjernet igen', !(await erFavorit(brugerA, bolig1)))

    // Idempotent: at fjerne noget, der ikke er der, maa ikke kaste.
    await fjernFavorit(brugerA, bolig1)
    tjek('1 · at fjerne to gange er ikke en fejl', true)
  }

  // ═══ 2 · Ejerskab ══════════════════════════════════════════════
  console.log('\n══ 2 · ejerskab ══')
  {
    await gemFavorit(brugerA, bolig1)
    await gemFavorit(brugerB, bolig2)

    // 2A · A ser kun sine egne.
    const listeA = await hentFavoritter(brugerA)
    tjek('2A · A ser kun sin egen favorit',
      listeA.length === 1 && listeA[0]!.listingId === bolig1,
      `${listeA.length} raekke(r)`)

    const listeB = await hentFavoritter(brugerB)
    tjek('2B · B ser kun sin egen favorit',
      listeB.length === 1 && listeB[0]!.listingId === bolig2)

    // 2C · A kan ikke slette B's raekke.
    // Fjernes `user_id` fra WHERE i fjernFavorit, bliver den her roed.
    await fjernFavorit(brugerA, bolig2)
    tjek('2C · A kan ikke slette B\'s favorit', await erFavorit(brugerB, bolig2))

    // 2D · Og A fik ikke selv en raekke af forsoeget.
    tjek('2D · forsoeget gav ikke A en raekke', !(await erFavorit(brugerA, bolig2)))

    // 2E · A kan ikke LAESE B's, heller ikke gennem erFavorit.
    tjek('2E · A kan ikke se B\'s favorit som sin egen',
      !(await erFavorit(brugerA, bolig2)) && (await erFavorit(brugerB, bolig2)))
  }

  // ═══ 3 · Den samme bolig kan ikke gemmes to gange ══════════════
  console.log('\n══ 3 · unique(user_id, listing_id) ══')
  {
    await gemFavorit(brugerA, bolig1)
    await gemFavorit(brugerA, bolig1)
    await gemFavorit(brugerA, bolig1)
    const raekker = await db.select().from(favorites)
      .where(eq(favorites.userId, brugerA))
    const paaBolig1 = raekker.filter((r) => r.listingId === bolig1)
    tjek('3 · tre gem giver ÉN raekke', paaBolig1.length === 1, `${paaBolig1.length}`)

    // Og spaerringen er databasens, ikke vores: en raa insert skal fejle.
    let kastede = false
    try {
      await db.insert(favorites).values({ userId: brugerA, listingId: bolig1 })
    } catch { kastede = true }
    tjek('3 · en raa dublet afvises af databasen selv', kastede)
  }

  // ═══ 4 · Afmeldt bolig skjules ikke ════════════════════════════
  console.log('\n══ 4 · en afmeldt bolig forsvinder ikke fra listen ══')
  {
    await gemFavorit(brugerA, afmeldt)
    const liste = await hentFavoritter(brugerA)
    const raekke = liste.find((x) => x.listingId === afmeldt)

    tjek('4 · den afmeldte bolig staar stadig paa listen', raekke != null)
    tjek('4 · og den er maerket som afmeldt', raekke?.status === 'afmeldt',
      raekke?.status ?? '(ingen)')
    tjek('4 · adressen er der stadig, saa hun kan se HVAD det var',
      Boolean(raekke?.adresse))

    // Den aktive er stadig aktiv — maerkningen er ikke smurt ud paa alt.
    const aktivRaekke = liste.find((x) => x.listingId === bolig1)
    tjek('4 · en aktiv bolig er ikke maerket afmeldt', aktivRaekke?.status === 'aktiv')

    const aktive = await aktiveBlandt(liste.map((x) => x.listingId))
    tjek('4 · optaellingen af aktive springer den afmeldte over',
      aktive.has(bolig1) && !aktive.has(afmeldt))

    // Og den kan stadig fjernes — ingen blindgyde.
    await fjernFavorit(brugerA, afmeldt)
    tjek('4 · en afmeldt favorit kan stadig fjernes',
      !(await erFavorit(brugerA, afmeldt)))
  }

  // ═══ 5 · Ikke logget ind ═══════════════════════════════════════
  console.log('\n══ 5 · uden login ══')
  {
    // `favoritIder` laeser sessionen. Uden Supabase-konfiguration og uden
    // cookies er der ingen bruger — og saa maa der hverken spoerges eller
    // svares med nogens favoritter.
    const k = await favoritIder()
    tjek('5 · ingen session giver ingen bruger', k.logget === false)
    tjek('5 · og et tomt saet — aldrig en fremmeds', k.ider.size === 0)

    const st = statusFor(k, bolig1)
    tjek('5 · kortet faar status «ikke logget ind»', st.logget === false)
  }

  // ═══ 6 · Knappens markup ═══════════════════════════════════════
  console.log('\n══ 6 · knappen ══')
  {
    const markup = (s: Parameters<typeof statusFor>[0] extends never ? never : {
      logget: boolean; gemt?: boolean
    }) => renderToStaticMarkup(createElement(Favoritknap, {
      listingId: bolig1,
      status: (s.logget ? { logget: true, gemt: s.gemt! } : { logget: false }) as never,
      adresse: 'Prøvevej 1',
    }))

    const ude = markup({ logget: false })
    tjek('6 · uden login er det et LINK til Min side, ikke en knap',
      ude.includes('<a') && ude.includes('/min-side') && !ude.includes('<button'))
    tjek('6 · og den siger hvorfor', /aria-label="[^"]*Log ind[^"]*"/.test(ude))

    const gemt = markup({ logget: true, gemt: true })
    const ikke = markup({ logget: true, gemt: false })

    tjek('6 · logget ind er det en knap', gemt.includes('<button'))
    tjek('6 · gemt tilstand staar i aria-pressed', gemt.includes('aria-pressed="true"'))
    tjek('6 · ikke-gemt ogsaa', ikke.includes('aria-pressed="false"'))

    // IKKE FARVE ALENE. Tilstanden skal kunne aflaeses uden at se farver:
    // hjertet er fyldt (form), og etiketten siger det med ord.
    tjek('6 · gemt: hjertet er FYLDT, ikke bare farvet',
      gemt.includes('fill="currentColor"') && ikke.includes('fill="none"'))
    tjek('6 · gemt: etiketten siger «Fjern», ikke «Gem»',
      /aria-label="Fjern [^"]*"/.test(gemt) && /aria-label="Gem [^"]*"/.test(ikke))
    tjek('6 · etiketten navngiver boligen, saa ni knapper ikke lyder ens',
      gemt.includes('Prøvevej 1'))

    // Knappen maa ikke kunne indsende en formular ved et uheld.
    tjek('6 · knappen er type=button, saa den ikke indsender noget',
      gemt.includes('type="button"'))
  }

  // ═══ 7 · Kortet beholder sit link ══════════════════════════════
  console.log('\n══ 7 · kortet er stadig et link ══')
  {
    // Selve kortet renderes af scripts/test-soegning.ts. Her proeves kun
    // det, brugeromraadet tilfoejede: at knappen ikke ligger INDE i <a>.
    // En <button> i et <a> er ugyldig HTML, og saa kan et klik paa
    // knappen aktivere linket alligevel.
    const { Kort } = await import('../app/Boligkort')
    const [raa] = await db.select().from(listings).where(eq(listings.id, bolig1))
    const bolig = {
      id: raa!.id, adresse: raa!.addressRaw, vej: raa!.street, husnr: raa!.houseNumber,
      etage: null, doer: null, postnr: raa!.postalCode, by: raa!.city,
      kilde: SLUG, kildeNavn: 'Prøvekilde brugerområde', kildetype: 'spider',
      match: 'unit', areal: raa!.sizeM2, vaerelser: raa!.rooms, type: raa!.propertyType,
      leje: raa!.rentMonthly, total: null, poster: [], egenMaaler: null,
      billeder: 0, forside: null, billedforbehold: false,
      foerstSet: new Date(), hosKilden: null, ledig: null, ogsaaHos: [],
      availabilityFacts: null,
    }
    let markup = ''
    try {
      markup = renderToStaticMarkup(createElement(Kort as never, {
        b: bolig, nu: new Date(), favorit: { logget: true, gemt: false },
      }))
    } catch (e) {
      tjek('7 · kortet kunne gengives', false, (e as Error).message.slice(0, 70))
    }
    if (markup) {
      const iHylster = markup.indexOf('kort-hylster')
      const linkStart = markup.indexOf('<a', iHylster)
      const linkSlut = markup.indexOf('</a>', linkStart)
      const knapPos = markup.indexOf('<button')
      tjek('7 · kortet er stadig et <a class="kort"> med data-bolig',
        markup.includes('data-bolig=') && markup.includes('class="kort'))
      tjek('7 · knappen ligger UDEN FOR linket',
        knapPos > 0 && knapPos > linkSlut, `knap@${knapPos} link slutter@${linkSlut}`)
      tjek('7 · uden favorit-prop er kortet praecis som foer (ingen knap)',
        !renderToStaticMarkup(createElement(Kort as never, { b: bolig, nu: new Date() }))
          .includes('<button'))
    }
  }

  // ═══ 8 · Gemte søgninger hører til brugeren ════════════════════
  console.log('\n══ 8 · gemte søgninger ══')
  {
    // Alarmen er UROERT. Her proeves kun koblingen: at Min side kan vise
    // netop den indloggedes soegninger, fordi `saved_searches.user_id`
    // allerede er NOT NULL med fremmednoegle til `users`.
    const [sA] = await db.insert(savedSearches).values({
      userId: brugerA, name: 'A: 3 vær. i Prøveby',
      criteria: { by: 'Prøveby N', vaerelserMin: 3 },
      confirmedAt: new Date(),
    }).returning()
    await db.insert(savedSearches).values({
      userId: brugerB, name: 'B: noget andet', criteria: { by: 'Attrapby' },
    })

    const mineA = await db.select().from(savedSearches)
      .where(eq(savedSearches.userId, brugerA))
    tjek('8 · A ser kun sin egen soegning',
      mineA.length === 1 && mineA[0]!.id === sA!.id, `${mineA.length}`)

    const mineB = await db.select().from(savedSearches)
      .where(eq(savedSearches.userId, brugerB))
    tjek('8 · B ser kun sin egen', mineB.length === 1 && mineB[0]!.userId === brugerB)

    // De tre tilstande betyder ikke det samme, og Min side skal kunne
    // skelne dem. En UBEKRAEFTET soegning varsler intet — det er den
    // dobbelte tilmelding, og den maa ikke se ud som en aktiv alarm.
    tjek('8 · en bekraeftet soegning har confirmed_at', mineA[0]!.confirmedAt != null)
    tjek('8 · en ubekraeftet har det ikke', mineB[0]!.confirmedAt == null)
    tjek('8 · ingen af dem er afmeldt endnu',
      mineA[0]!.unsubscribedAt == null && mineB[0]!.unsubscribedAt == null)
    tjek('8 · og begge har et afmeldingstoken, saa Min side kan linke til det',
      Boolean(mineA[0]!.unsubscribeToken) && Boolean(mineB[0]!.unsubscribeToken))
  }

  // ═══ 9 · Cascade ═══════════════════════════════════════════════
  console.log('\n══ 9 · en slettet bolig efterlader ikke en foraeldreloes favorit ══')
  {
    const forsvinder = await lav('4', 'active')
    await gemFavorit(brugerA, forsvinder)
    tjek('9 · gemt', await erFavorit(brugerA, forsvinder))
    await db.delete(listings).where(eq(listings.id, forsvinder))
    tjek('9 · favoritten fulgte med boligen ned (on delete cascade)',
      !(await erFavorit(brugerA, forsvinder)))
  }

  // ═══ 10 · Min sides gemte-kort ═════════════════════════════════
  // Kortet gengives med RIGTIGE raekker fra `hentFavoritter`, ikke med
  // et haandskrevet objekt: saa proever de her linjer ogsaa, at
  // forespoergslen faktisk leverer de felter, kortet tegner. Et
  // konstrueret objekt ville bestaa, selv om SQL'en holdt op med at
  // hente billedet.
  console.log('\n══ 10 · gemte-kortet paa Min side ══')
  {
    const kort = (b: GemtBolig) => renderToStaticMarkup(createElement(Gemtkort, { b }))
    const raekkeFor = async (id: string) => {
      const l = await hentFavoritter(brugerA)
      return l.find((x) => x.listingId === id)!
    }

    // ── 10A · Billedet kommer fra basen, og kun fra tilladte vaerter ──
    // To billeder, hvor det FOERSTE ligger uden for allowlisten. Vaelger
    // forespoergslen bare `position 0`, faar kortet en URL, `billedUrl`
    // afviser — og saa staar der et tomt 16:9-felt paa et kort, der
    // ogsaa paastaar «2 billeder». Taellingen og billedet skal svare paa
    // det samme spoergsmaal.
    await db.insert(listingImages).values([
      { listingId: bolig1, externalUrl: 'https://ikke-tilladt.invalid/a.jpg', position: 0 },
      { listingId: bolig1, externalUrl: 'https://app.propstep.com/b.jpg', position: 1 },
      { listingId: bolig1, externalUrl: 'https://app.propstep.com/c.jpg', position: 2 },
    ])
    await gemFavorit(brugerA, bolig1)
    const medFoto = await raekkeFor(bolig1)
    tjek('10A · forsidebilledet springer den utilladte vaert over',
      medFoto.forside === 'https://app.propstep.com/b.jpg', String(medFoto.forside))
    tjek('10A · og taellingen taeller kun de visbare',
      medFoto.billeder === 2, String(medFoto.billeder))

    const mF = kort(medFoto)
    tjek('10A · kortet tegner billedet', mF.includes('<img') && mF.includes('/api/billede'))
    // Tælleren siger nu HVOR I RÆKKEN vi er, ikke bare hvor mange der er:
    // «1/2». Påstanden er lige så eksakt som før — det er stadig en
    // tekstknude, der skal stå ordret — men den måler nu også, at
    // udgangspunktet er billede ét.
    tjek('10A · og tælleren siger 1 af 2', mF.includes('>1/2<'), mF.match(/gemt-antal">([^<]*)/)?.[1])
    tjek('10A · uden «uden-foto», for der ER et foto', !mF.includes('uden-foto'))

    // ── 10B · Klassen og billedet er ÉN beregning ─────────────────
    // Ligger vaerten uden for allowlisten, giver `billedUrl()` null.
    // Afgjorde den raa URL klassen og `billedUrl()` billedet, ville
    // feltet staa tomt i stedet for at falde tilbage — det er
    // Dacas-fejlen i visuel form, og den fejler ingen steder.
    const kunUtilladt: GemtBolig = { ...medFoto,
      forside: 'https://ikke-tilladt.invalid/a.jpg', billeder: 1 }
    const kU = kort(kunUtilladt)
    tjek('10B · utilladt vaert: feltet falder tilbage',
      kU.includes('uden-foto') && !kU.includes('<img'),
      kU.includes('<img') ? 'BILLEDE UDEN TILLADT VAERT' : '')
    tjek('10B · og fallback\'et siger hvad det er', kU.includes('Intet billede'))
    // Modstykket: proeven maa ikke kunne bestaas ved at saette
    // «uden-foto» paa alting.
    tjek('10B · praemis: med en tilladt vaert er klassen der IKKE',
      !mF.includes('uden-foto'))

    // ── 10C · Husleje og total kan ikke forveksles ────────────────
    // `hentFavoritter` bar foer ét sammenfaldet `pris`-felt, og kortet
    // skrev «kr/md» uden at sige hvad tallet var. De to udsagn er ikke
    // det samme, og forskellen er hele projektets loefte.
    const kunLeje = kort({ ...medFoto, total: null, leje: 900000 })
    tjek('10C · uden total staar huslejen som HUSLEJE',
      kunLeje.includes('kr/md i husleje') && !kunLeje.includes('til udlejer'))
    tjek('10C · og den er ikke groen', kunLeje.includes('gemt-pris kun-leje'))
    tjek('10C · manglen siges hoejt',
      kunLeje.includes('Spørg udlejeren om varme og vand'))

    const medTotal = kort({ ...medFoto, total: 1000000, leje: 900000,
      poster: ['rent', 'heat', 'water'] })
    tjek('10C · med total staar «til udlejer»',
      medTotal.includes('kr/md til udlejer') && !medTotal.includes('i husleje'))
    tjek('10C · og prisen er groen', /class="gemt-pris"/.test(medTotal))
    tjek('10C · og saa staar forbeholdet om aconto IKKE',
      !medTotal.includes('Spørg udlejeren om varme og vand'))

    // ── 10D · En groen total uden el-rede er forbudt ──────────────
    // Samme regel som paa de to soegekort, og nu med en tredje kaldere
    // af `Ellinje`. Den fejl stod paa 171 gruppekort, foer nogen saa den.
    const ELTEKST = /el kommer oveni|el betaler du selv til elselskabet|ét samlet acontobeløb/
    for (const [navn, html] of [
      ['udspecificeret uden el', medTotal],
      ['samlet klump', kort({ ...medFoto, total: 1000000, poster: ['rent', 'other'] })],
      ['egen maaler', kort({ ...medFoto, total: 1000000, elEgenMaaler: true,
        poster: ['rent', 'other'] })],
    ] as const) {
      const groen = /class="gemt-pris"/.test(html)
      tjek(`10D · ${navn}: prisen er groen`, groen)
      tjek(`10D · ${navn}: og el er gjort rede for`, !groen || ELTEKST.test(html),
        groen && !ELTEKST.test(html) ? 'GRØN UDEN EL-LINJE' : '')
    }
    // Og den maa ikke skrives paa alting: er el en navngiven post,
    // skal linjen VAERE der ikke.
    tjek('10D · el oplyst → ingen el-linje',
      !ELTEKST.test(kort({ ...medFoto, total: 1030000, el: 30000,
        poster: ['rent', 'heat', 'water', 'electricity'] })))
    // Uden total er der intet tal at tage forbehold for, og to forbehold
    // oven i hinanden hjaelper ingen.
    tjek('10D · ukendt total → slet ingen el-linje', !ELTEKST.test(kunLeje))

    // ── 10E · Ukendt maa ikke se kendt ud ─────────────────────────
    const uoplyst = kort({ ...medFoto, type: null, vaerelser: null, areal: null,
      leje: null, total: null })
    tjek('10E · ingen pladsholder for vaerelser',
      !uoplyst.includes('vær.') && !uoplyst.includes('—'))
    tjek('10E · ingen pladsholder for areal', !uoplyst.includes('m²'))
    tjek('10E · og prisen staar som ord, ikke som tom etiket',
      uoplyst.includes('Prisen er ikke oplyst') && !uoplyst.includes('kr/md'))
    // Modstykket: er de oplyst, SKAL de staa — ellers kunne 10E bestaas
    // ved at udelade dem altid.
    tjek('10E · praemis: oplyste tal staar i overskriften',
      mF.includes('3 vær.') && mF.includes('70 m²') && mF.includes('Lejlighed'))

    // ── 10F · Billedet og adressen aabner den gemte bolig ─────────
    const href = `href="/bolig/${bolig1}"`
    tjek('10F · adressen er et link til netop den bolig',
      new RegExp(`<a class="adresse" ${href}`).test(mF))
    tjek('10F · billedet peger samme sted',
      new RegExp(`${href}[^>]*class="gemt-fotolink"`).test(mF))
    // Billedlinket er en genvej for musen. Det maa ikke blive et ekstra
    // tabstop eller en anden stemme for skaermlaeseren.
    tjek('10F · billedlinket er hverken tabstop eller dublet for oplaesning',
      /aria-hidden="true"[^>]*tabindex="-1"|tabindex="-1"[^>]*aria-hidden="true"/.test(mF))

    // ── 10G · Fjern ──────────────────────────────────────────────
    // En rigtig knap i en rigtig formular: tastatur virker af sig selv,
    // og der er ingen JavaScript at fejle.
    tjek('10G · Fjern er en submit-knap', /<button[^>]*type="submit"/.test(mF))
    const navn = /aria-label="([^"]*)"/.exec(mF.slice(mF.indexOf('gemt-fjern')))?.[1] ?? ''
    tjek('10G · navnet siger HVILKEN bolig', navn.includes('Prøvevej 1'), navn)
    tjek('10G · og den synlige tekst staar foerst i navnet',
      navn.startsWith('Fjern'), navn)
    tjek('10G · bolig-id\'et foelger med i formularen',
      mF.includes(`name="bolig" value="${bolig1}"`))

    // ── 10H · Afmeldt og forsvundet ──────────────────────────────
    const afm = kort({ ...medFoto, status: 'afmeldt' })
    tjek('10H · afmeldt: kortet er daempet', afm.includes('gemt-kort utilgaengelig'))
    tjek('10H · afmeldt: der staar hvad der skete',
      afm.includes('Ikke længere tilgængelig'))
    tjek('10H · afmeldt: boligsiden kan stadig aabnes', afm.includes(href))

    const vaek = kort({ ...medFoto, status: 'forsvundet', adresse: null, postnr: null,
      by: null, type: null, vaerelser: null, areal: null, leje: null, total: null,
      forside: null, billeder: 0 })
    tjek('10H · forsvundet: der staar at boligen er vaek',
      vaek.includes('Boligen findes ikke længere') && vaek.includes('Annoncen er væk'))
    tjek('10H · forsvundet: intet link til en side, der ikke findes',
      !vaek.includes('/bolig/'))
    tjek('10H · forsvundet: ingen oekonomi at paastaa noget om',
      !vaek.includes('kr/md') && !vaek.includes('Prisen er ikke oplyst'))
    tjek('10H · forsvundet: men den kan stadig fjernes',
      vaek.includes('gemt-fjern'))

    // ── 10I · Billedforbeholdet ──────────────────────────────────
    // Det handler om det, man kigger paa. Uden et billede er der intet
    // at tage forbehold for.
    tjek('10I · forbeholdet staar ved billedet',
      kort({ ...medFoto, billedforbehold: true }).includes('kan være fra en anden bolig'))
    tjek('10I · men ikke naar der ikke er et billede',
      !kort({ ...medFoto, billedforbehold: true, forside: null, billeder: 0 })
        .includes('kan være fra en anden bolig'))

    await db.delete(listingImages).where(eq(listingImages.listingId, bolig1))
  }

  // ─── Oprydning ───────────────────────────────────────────────
  await db.delete(savedSearches).where(inArray(savedSearches.userId, [brugerA, brugerB]))
  await db.delete(listings).where(eq(listings.sourceId, kildeId))
  await db.delete(users).where(inArray(users.id, [brugerA, brugerB]))
  await db.delete(sources).where(eq(sources.id, kildeId))

  console.log(fejl === 0 ? '\n  ALT GRØNT\n' : `\n  ${fejl} FEJLEDE\n`)
  if (fejl) process.exit(1)
}

await koer()
