// ═══════════════════════════════════════════════════════════════
//  Bindingen af en auth-konto til vores egen brugerrække.
//
//  Prøverne kalder `bindKonto` — den RIGTIGE produktionslogik, ikke en
//  kopi af algoritmen. Det er muligt, fordi funktionen tager kontoen ind
//  som argument i stedet for at læse den selv: der er ingen
//  injektionsluge at misbruge, og prøven rammer alligevel den kode, der
//  kører i produktionen.
//
//  ═══ HVAD DER STOD PAA SPIL ═══
//
//  Den arvede binding matchede paa mailadressen alene:
//
//      select ... where email = ?          -- laesning
//      update users set auth_user_id = ?   -- skrivning, UDEN vagt
//        where id = <den fundne>
//
//  Tre huller paa én gang. En konto kunne overtage en fremmed raekke ved
//  at faa hendes mailadresse. En samtidig request kunne overskrive en
//  binding, der lige var sat. Og der var ingen bekraeftelse paa, at
//  mailadressen overhovedet tilhoerte den, der skrev den.
// ═══════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto'
import { eq, inArray, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { favorites, listings, savedSearches, sources, users } from '../db/schema'
import { bindKonto, type AuthKonto } from '../lib/auth'
import { hentFavoritter } from '../lib/favoritter'

let fejl = 0
function tjek(navn: string, ok: boolean, note = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? `  — ${note}` : ''}`)
  if (!ok) fejl++
}

const MRK = `authbinding-${Date.now()}`
const mail = (n: string) => `${n}-${MRK}@example.invalid`

/**
 * Kontoen skal FINDES i auth.users.
 *
 * `users.auth_user_id` har en fremmednoegle dertil — et vaern, der ikke
 * stod i opgaven, men som er vaerd at kende: et opdigtet auth-id kan ikke
 * skrives, heller ikke ved en fejl i vores egen kode. Proeven opretter
 * derfor kontoen i stubben foerst, praecis som Supabase ville have gjort.
 */
async function authbruger(id: string, email: string) {
  await db.execute(sql`insert into auth.users (id, email) values (${id}, ${email})
    on conflict (id) do nothing`)
  return id
}

/** En bekræftet konto. Som Auth-serveren ville beskrive den. */
const bekraeftet = async (email: string, id = randomUUID()): Promise<AuthKonto> =>
  ({ id: await authbruger(id, email), email, mailBekraeftet: true })
/** En konto, hvis mail ikke er bekræftet. */
const ubekraeftet = async (email: string, id = randomUUID()): Promise<AuthKonto> =>
  ({ id: await authbruger(id, email), email, mailBekraeftet: false })

const bind = (k: AuthKonto) => bindKonto(k, 'tenant', '/min-side')

async function koer() {
  const oprettede: string[] = []
  const nyRaekke = async (email: string, authUserId: string | null) => {
    const [r] = await db.insert(users).values({ email, authUserId }).returning()
    oprettede.push(r!.id)
    return r!
  }

  // ═══ 1 · Allerede bundet ═══════════════════════════════════════
  console.log('\n══ 1 · en bundet konto beholder sin identitet ══')
  {
    const k = await bekraeftet(mail('a1'))
    const r = await nyRaekke(k.email, k.id)

    const en = await bind(k)
    tjek('1 · samme authUserId giver samme interne bruger',
      en.slags === 'ok' && en.bruger.id === r.id)

    // A · Mailen er skiftet hos Supabase. Ejerskabet foelger IKKE med.
    const skiftet: AuthKonto = { ...k, email: mail('a1-ny') }
    const to = await bind(skiftet)
    tjek('1 · ændret mail beholder ejerskabet',
      to.slags === 'ok' && to.bruger.id === r.id,
      to.slags === 'ok' ? 'samme raekke' : to.slags)

    // Og der blev ikke oprettet en ny raekke paa den nye adresse.
    const paaNy = await db.select().from(users).where(eq(users.email, skiftet.email))
    tjek('1 · og der opstod ingen dublet paa den nye adresse', paaNy.length === 0)
  }

  // ═══ 2 · En anden konto kan ikke overtage ══════════════════════
  console.log('\n══ 2 · en bundet række kan ikke overtages ══')
  {
    const ejer = await bekraeftet(mail('a2'))
    const r = await nyRaekke(ejer.email, ejer.id)

    // Angriberen er en HELT gyldig, bekraeftet konto — den har bare
    // faaet fat i den gamle mailadresse.
    const angriber = await bekraeftet(ejer.email)
    const svar = await bind(angriber)

    tjek('2 · en anden verificeret konto med samme mail AFVISES',
      svar.slags === 'konflikt', svar.slags)

    const [efter] = await db.select().from(users).where(eq(users.id, r.id))
    tjek('2 · bindingen er uroert', efter!.authUserId === ejer.id)
    tjek('2 · rollen er uroert', efter!.role === r.role)

    // Og angriberen fik ingen raekke overhovedet.
    const hendes = await db.select().from(users).where(eq(users.authUserId, angriber.id))
    tjek('2 · angriberen fik ingen brugerrække', hendes.length === 0)
  }

  // ═══ 3 · Ubekræftet mail ═══════════════════════════════════════
  console.log('\n══ 3 · ubekræftet mail kan ikke binde ══')
  {
    // En alarmbruger: raekke uden konto, med gemte soegninger.
    const alarmmail = mail('a3-alarm')
    const alarm = await nyRaekke(alarmmail, null)
    await db.insert(savedSearches).values({
      userId: alarm.id, name: 'Alarmbrugerens søgning',
      criteria: { by: 'Prøveby N' }, confirmedAt: new Date(),
    })

    const uden = await ubekraeftet(alarmmail)
    const svar = await bind(uden)
    tjek('3 · ubekræftet mail afvises', svar.slags === 'ubekraeftet-mail', svar.slags)

    const [efter] = await db.select().from(users).where(eq(users.id, alarm.id))
    tjek('3 · alarmbrugerens række er stadig ubundet', efter!.authUserId === null)

    // Og der er ingen vej til hendes soegninger.
    const hendes = await db.select().from(users).where(eq(users.authUserId, uden.id))
    tjek('3 · den afviste konto har ingen brugerrække', hendes.length === 0)

    // ── Den bekraeftede konto MAA binde den ──
    const med = await bekraeftet(alarmmail)
    const ok = await bind(med)
    tjek('3 · en bekræftet konto binder den ubundne række',
      ok.slags === 'ok' && ok.bruger.id === alarm.id, ok.slags)
    const [nu] = await db.select().from(users).where(eq(users.id, alarm.id))
    tjek('3 · og bindingen peger på den rigtige konto', nu!.authUserId === med.id)
  }

  // ═══ 4 · Idempotens ════════════════════════════════════════════
  console.log('\n══ 4 · gentagne requests ══')
  {
    const k = await bekraeftet(mail('a4'))
    const et = await bind(k)
    const to = await bind(k)
    const tre = await bind(k)
    const ider = new Set([et, to, tre].map((s) => s.slags === 'ok' ? s.bruger.id : 'x'))
    tjek('4 · tre requests giver den SAMME bruger', ider.size === 1, `${ider.size} forskellige`)
    if (et.slags === 'ok') oprettede.push(et.bruger.id)

    const raekker = await db.select().from(users).where(eq(users.email, k.email))
    tjek('4 · og præcis én række i basen', raekker.length === 1, `${raekker.length}`)
  }

  // ═══ 5 · Samtidighed ═══════════════════════════════════════════
  // PGlite koerer én forbindelse, saa «samtidig» her er interleaving og
  // ikke aegte parallelitet. Det raekker til at proeve KONTRAKTEN: at
  // ingen af vejene giver to raekker eller en overskrevet binding.
  // Aegte parallelitet proeves mod den lokale PostgreSQL — se
  // scripts/cloud/samtidighed.mjs.
  console.log('\n══ 5 · samtidige forsøg ══')
  {
    // 5A · To requests fra SAMME konto, foerste gang.
    const k = await bekraeftet(mail('a5'))
    const svar = await Promise.all([bind(k), bind(k), bind(k)])
    const ok = svar.filter((s) => s.slags === 'ok')
    const ider = new Set(ok.map((s) => s.slags === 'ok' ? s.bruger.id : ''))
    tjek('5A · alle tre lykkes', ok.length === 3, `${ok.length}/3`)
    tjek('5A · og peger på den samme række', ider.size === 1)
    const raekker = await db.select().from(users).where(eq(users.email, k.email))
    tjek('5A · ingen dublet blev oprettet', raekker.length === 1, `${raekker.length}`)
    for (const r of raekker) oprettede.push(r.id)

    // 5B · To FORSKELLIGE konti kapper om den samme ubundne raekke.
    const delt = mail('a5b')
    const r = await nyRaekke(delt, null)
    const en = await bekraeftet(delt)
    const anden = await bekraeftet(delt)
    const to = await Promise.all([bind(en), bind(anden)])
    const vandt = to.filter((s) => s.slags === 'ok')
    const tabte = to.filter((s) => s.slags === 'konflikt')
    tjek('5B · præcis én vinder', vandt.length === 1, `${vandt.length} ok, ${tabte.length} konflikt`)
    tjek('5B · og den anden får en konflikt, ikke en fremmed række', tabte.length === 1)

    const [efter] = await db.select().from(users).where(eq(users.id, r.id))
    const vinderId = vandt[0]?.slags === 'ok' ? vandt[0].bruger.id : null
    tjek('5B · rækken er bundet til vinderen', efter!.authUserId != null && vinderId === r.id)
    tjek('5B · og kun én af de to konti har en brugerrække',
      (await db.select().from(users)
        .where(inArray(users.authUserId, [en.id, anden.id]))).length === 1)
  }

  // ═══ 6 · En afvist binding giver ingen adgang ══════════════════
  console.log('\n══ 6 · en afvist binding giver ingen data ══')
  {
    const [kilde] = await db.insert(sources)
      .values({ slug: MRK, name: 'Prøvekilde authbinding', sourceType: 'spider' }).returning()
    const [bolig] = await db.insert(listings).values({
      sourceId: kilde!.id, sourceType: 'spider', externalKey: `${MRK}-1`,
      sourceUrl: 'https://eksempel.invalid/1', addressRaw: 'Prøvevej 1, 9001 Prøveby N',
      street: 'Prøvevej', houseNumber: '1', postalCode: '9001', city: 'Prøveby N',
      unitAddressUuid: `intern:v3:${MRK}`, addressMatchLevel: 'unit',
      propertyType: 'lejlighed', rentMonthly: 900000, status: 'active',
    }).returning()

    // Offeret: bundet konto med favorit, gemt soegning og en annonce.
    const offer = await bekraeftet(mail('a6'))
    const r = await nyRaekke(offer.email, offer.id)
    await db.insert(favorites).values({ userId: r.id, listingId: bolig!.id })
    await db.insert(savedSearches).values({
      userId: r.id, name: 'Offerets søgning', criteria: { by: 'Prøveby N' },
    })
    await db.update(listings).set({ landlordId: r.id }).where(eq(listings.id, bolig!.id))

    // Angriberen med samme mail bliver afvist ...
    const angriber = await bekraeftet(offer.email)
    const svar = await bind(angriber)
    tjek('6 · bindingen afvises', svar.slags === 'konflikt', svar.slags)

    // ... og har ingen brugerraekke, altsaa intet id at slaa noget op med.
    const hendes = await db.select().from(users).where(eq(users.authUserId, angriber.id))
    tjek('6 · ingen brugerrække, altså intet id at slå op med', hendes.length === 0)

    // Offerets data er uroert og hoerer stadig til offeret.
    tjek('6 · offerets favorit er urørt', (await hentFavoritter(r.id)).length === 1)
    tjek('6 · offerets gemte søgning er urørt',
      (await db.select().from(savedSearches).where(eq(savedSearches.userId, r.id))).length === 1)
    const [ann] = await db.select().from(listings).where(eq(listings.id, bolig!.id))
    tjek('6 · offerets annonce hører stadig til offeret', ann!.landlordId === r.id)

    await db.delete(listings).where(eq(listings.sourceId, kilde!.id))
    await db.delete(sources).where(eq(sources.id, kilde!.id))
  }

  // ═══ 7 · Ingen session ═════════════════════════════════════════
  console.log('\n══ 7 · uden konto ══')
  {
    // `bindKonto` kraever en konto. Vejen uden session gaar gennem
    // `sikreBruger`, som returnerer 'ingen-session' — proevet i
    // test-brugeromraade.ts afsnit 5 gennem `favoritIder()`.
    const k = await bekraeftet(mail('a7'))
    const svar = await bind(k)
    tjek('7 · en ny bekræftet konto får sin egen række', svar.slags === 'ok')
    if (svar.slags === 'ok') {
      oprettede.push(svar.bruger.id)
      tjek('7 · med den mail, Auth-serveren oplyste', svar.bruger.email === k.email)
    }
  }

  // ─── Oprydning ───────────────────────────────────────────────
  const alle = await db.select({ id: users.id }).from(users)
  const mine = alle.map((u) => u.id).filter((id) => oprettede.includes(id))
  await db.delete(savedSearches).where(inArray(savedSearches.userId, mine.length ? mine : ['x']))
  await db.delete(users).where(inArray(users.id, mine.length ? mine : ['x']))
  const rest = await db.select().from(users)
  for (const u of rest) if (u.email.includes(MRK)) await db.delete(users).where(eq(users.id, u.id))

  console.log(fejl === 0 ? '\n  ALT GRØNT\n' : `\n  ${fejl} FEJLEDE\n`)
  if (fejl) process.exit(1)
}

await koer()
