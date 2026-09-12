// ═══════════════════════════════════════════════════════════════
//  Min side — den boligsøgendes eget område.
//
//  To ting: gemte boliger og gemte søgninger. Begge findes i forvejen i
//  basen; siden her er den foerste, der viser dem for den, de tilhoerer.
//
//  Gemte soegninger genbruges UROERT fra alarmen. `saved_searches` har
//  allerede `user_id NOT NULL` med fremmednoegle til `users`.
//
//  KOBLINGEN ER IKKE «SIKKER I FORVEJEN». Den oprindelige binding matchede
//  paa mailadressen alene og kunne overtage en fremmed raekke. Den er nu
//  laast til `auth_user_id` og kraever en bekraeftet mail — se
//  `bindKonto` i lib/auth.ts og docs/auth-binding.md. Siden her viser
//  udtrykkeligt en afvist binding i stedet for at lade som ingenting.
// ═══════════════════════════════════════════════════════════════

import type { Metadata } from 'next'
import { desc, eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { savedSearches } from '../../db/schema'
import { hentBrugerStatus } from '../../lib/auth'
import { cookies } from 'next/headers'
import { KVITTERINGSCOOKIE, LINKFEJL, kvitteringFra } from '../../lib/kontovej'
import { hentFavoritter, type GemtBolig } from '../../lib/favoritter'
import { beskrivFiltre } from '../../lib/alarm'
import { kr } from '../Boligkort'
import { Konto } from '../udlejer/Konto'
import { Kvitteringsblok } from '../udlejer/Kvitteringsblok'
import { fjernFraMinSide } from './handlinger'
import { logUd } from '../udlejer/handlinger'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Min side — Bofinda',
  description: 'Dine gemte boliger og gemte søgninger.',
  // Et personligt område hører ikke til i et søgeresultat.
  robots: { index: false, follow: false },
}

const dato = (d: Date) =>
  d.toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' })

// ─── Gemt bolig ────────────────────────────────────────────────

function Boligrække({ b }: { b: GemtBolig }) {
  const utilgaengelig = b.status !== 'aktiv'
  return (
    <li className={`gemt-bolig${utilgaengelig ? ' utilgaengelig' : ''}`}>
      <div className="gemt-krop">
        {b.status === 'forsvundet' ? (
          <div className="adresse">Boligen findes ikke længere</div>
        ) : (
          <a className="adresse" href={`/bolig/${b.listingId}`}>{b.adresse}</a>
        )}
        <div className="sted">
          {b.postnr} {b.by}
          {b.kilde && <> · {b.kilde}</>}
          <> · gemt {dato(b.gemtDen)}</>
        </div>

        {/* En bolig, der er taget ned, forsvinder ikke fra listen. Hun har
            selv lagt den der; forsvandt den af sig selv, kunne hun ikke
            vide, om hun kom til at fjerne den. Der staar hvad der skete,
            og hun kan stadig fjerne den selv. */}
        {b.status === 'afmeldt' && (
          <p className="gemt-status">
            <strong>Ikke længere tilgængelig.</strong> Kilden har taget annoncen
            ned, siden du gemte den. Boligsiden kan stadig åbnes.
          </p>
        )}
        {b.status === 'forsvundet' && (
          <p className="gemt-status">
            <strong>Annoncen er væk.</strong> Vi har ikke længere oplysninger om
            den. Du kan fjerne den fra listen.
          </p>
        )}
      </div>

      <div className="gemt-hoejre">
        {b.pris != null && !utilgaengelig && (
          <div className="gemt-pris">{kr(b.pris)} <small>kr/md</small></div>
        )}
        <form action={fjernFraMinSide}>
          <input type="hidden" name="bolig" value={b.listingId} />
          <button className="nulstil" type="submit"
            aria-label={b.adresse ? `Fjern ${b.adresse} fra gemte` : 'Fjern fra gemte'}>
            Fjern
          </button>
        </form>
      </div>
    </li>
  )
}

// ─── Siden ─────────────────────────────────────────────────────

export default async function Side(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  const svar = await hentBrugerStatus()
  const sp = await searchParams
  const linkfejl = Boolean(sp[LINKFEJL])
  // Kvitteringen efter en gennemfoert gendannelse. Den kommer fra en
  // cookie, SERVEREN satte i gemNyKode() — ikke fra adressen. Et
  // haandskrevet «?nulstillet=1» skal ikke kunne faa siden til at
  // paastaa, at en adgangskode lige er skiftet.
  //
  // Den laeses ÉT sted og bruges paa ALLE sidens udgange — logget ind,
  // logget ud og afvist binding. Hentede vi den kun paa den ene vej,
  // ville beskeden afhaenge af, hvilken gren hun faldt i, og netop det
  // var fejlen: den forsvandt for den indloggede.
  const kvittering = kvitteringFra((await cookies()).get(KVITTERINGSCOOKIE)?.value)

  // ── Kontoen kunne ikke bindes ────────────────────────────────
  // Hun ER logget ind. At vise login-formularen ville se ud som en fejl
  // paa siden, og hun ville proeve igen i stedet for at soege hjaelp.
  // Der staar hvad der skete, og hvad hun kan goere.
  if (svar.slags === 'konflikt' || svar.slags === 'ubekraeftet-mail') {
    const ubekraeftet = svar.slags === 'ubekraeftet-mail'
    return (
      <div className="minside">
        <h1>Min side</h1>
        {/* Ogsaa her: hun er logget ind, siden vender om lidt, og et
            kodeskift eller en bekraeftelse lige foer maa ikke forsvinde,
            fordi bindingen faldt. Blokken oplyser — den aabner ingenting.
            Visningen er «begraenset» og ikke «indlogget»: hun ER logget
            ind, men Min side kunne netop ikke aabnes, og en kvittering,
            der lover det modsatte af beskeden lige nedenunder, er den
            samme fejl som en total, der lader som om aconto er kendt. */}
        <Kvitteringsblok kvittering={kvittering} visning="begraenset" kontekst="bolig" />
        <div className="tom-boks">
          {ubekraeftet ? (
            <>
              <p><strong>Din mailadresse er ikke bekræftet endnu.</strong></p>
              <p>
                Vi har sendt en mail til {svar.email}. Tryk på linket i den, og
                genindlæs så denne side. Indtil da kan vi ikke knytte dine gemte
                boliger og søgninger til kontoen.
              </p>
            </>
          ) : (
            <>
              <p><strong>Vi kan ikke åbne Min side for denne konto.</strong></p>
              <p>
                Mailadressen {svar.email} hører allerede til en anden konto hos
                os. Vi flytter ikke gemte boliger eller søgninger mellem konti —
                det ville give én persons oplysninger til en anden.
              </p>
              <p>
                Skriv til <a href="mailto:info@bofinda.dk">info@bofinda.dk</a>,
                så retter vi det manuelt.
              </p>
            </>
          )}
        </div>
      </div>
    )
  }

  const bruger = svar.slags === 'ok' ? svar.bruger : null

  // ── Ikke logget ind ──────────────────────────────────────────
  if (!bruger) {
    return (
      <div className="minside">
        <h1>Min side</h1>
        <p className="manchet">
          Log ind for at se dine gemte boliger og dine gemte søgninger.
          Gemte boliger følger din konto, så de er der også på telefonen.
        </p>
        <Konto kontekst="bolig" linkfejl={linkfejl} kvittering={kvittering} />
        <p className="note">
          Har du allerede en boligbesked, men ingen konto? Opret kontoen med
          den samme mailadresse — så samles dine gemte søgninger her.
        </p>
      </div>
    )
  }

  // Efter hinanden, ikke i Promise.all — se noten i app/page.tsx om
  // pipelinede saetninger gennem transaction-pooleren.
  const boliger = await hentFavoritter(bruger.id)
  const soegninger = await db.select().from(savedSearches)
    .where(eq(savedSearches.userId, bruger.id))
    .orderBy(desc(savedSearches.createdAt))

  const aktive = boliger.filter((b) => b.status === 'aktiv').length

  return (
    <div className="minside">
      <div className="minside-top">
        <div>
          <h1>Min side</h1>
          <p className="minside-hvem">
            Logget ind som <strong>{bruger.email}</strong>
          </p>
        </div>
        <form action={logUd.bind(null, 'bolig')}>
          <button className="nulstil" type="submit">Log ud</button>
        </form>
      </div>

      {/* ── Kvitteringen efter en gendannelse ──────────────────
          Den stod FOER kun i kontoformularen nedenfor, og den vises kun,
          naar hun IKKE er logget ind. Men fejler udlogningen i
          `gemNyKode`, er hun netop stadig logget ind — saa landede hun
          her uden et ord om, at koden lige var skiftet. Visningen er
          derfor «indlogget»: «log ind herunder» ville pege paa en
          formular, der ikke staar paa denne side. */}
      <Kvitteringsblok kvittering={kvittering} visning="indlogget" kontekst="bolig" />

      {/* ── Gemte boliger ────────────────────────────────────── */}
      <section className="blok">
        <h2>Gemte boliger</h2>
        {boliger.length === 0 ? (
          <div className="tom-boks">
            <p><strong>Du har ikke gemt nogen boliger endnu.</strong></p>
            <p>
              Tryk på hjertet på et boligkort, så lægger den sig her. Listen
              følger din konto, ikke den browser du sidder ved.
            </p>
            <p><a href="/">Find boliger</a></p>
          </div>
        ) : (
          <>
            <p className="grundlag">
              {boliger.length} {boliger.length === 1 ? 'bolig' : 'boliger'} gemt
              {aktive !== boliger.length && <> · {aktive} kan stadig lejes</>}
            </p>
            <ul className="gemte-liste">
              {boliger.map((b) => <Boligrække key={b.listingId} b={b} />)}
            </ul>
          </>
        )}
      </section>

      {/* ── Gemte søgninger ──────────────────────────────────── */}
      <section className="blok">
        <h2>Gemte søgninger</h2>
        {soegninger.length === 0 ? (
          <div className="tom-boks">
            <p><strong>Du har ingen gemte søgninger.</strong></p>
            <p>
              Sæt filtrene på forsiden, som du vil have dem, og gem søgningen.
              Så får du besked, når der kommer en bolig, der passer.
            </p>
            <p><a href="/">Søg efter boliger</a></p>
          </div>
        ) : (
          <ul className="gemte-liste">
            {soegninger.map((s) => {
              // Tre tilstande, og de betyder ikke det samme. En ubekræftet
              // søgning varsler INTET — det er den dobbelte tilmelding, og
              // hun skal kunne se, at posten venter på hende.
              const afmeldt = s.unsubscribedAt != null
              const ubekraeftet = s.confirmedAt == null
              return (
                <li key={s.id} className={`gemt-soegning${afmeldt ? ' utilgaengelig' : ''}`}>
                  <div className="gemt-krop">
                    <div className="adresse">{s.name ?? 'Gemt søgning'}</div>
                    <div className="sted">
                      {beskrivFiltre(s.criteria as never)} · oprettet {dato(s.createdAt)}
                    </div>
                    {afmeldt && (
                      <p className="gemt-status">
                        <strong>Afmeldt.</strong> Du får ikke længere besked fra
                        denne søgning.
                      </p>
                    )}
                    {!afmeldt && ubekraeftet && (
                      <p className="gemt-status">
                        <strong>Mangler bekræftelse.</strong> Vi har sendt dig en
                        mail. Der sendes ingen boligbeskeder, før du har trykket
                        på linket i den.
                      </p>
                    )}
                  </div>
                  <div className="gemt-hoejre">
                    {!afmeldt && (
                      <a className="nulstil knaplink" href={`/afmeld/${s.unsubscribeToken}`}>
                        Afmeld
                      </a>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
