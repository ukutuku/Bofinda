// ═══════════════════════════════════════════════════════════════
//  Min side — den boligsøgendes eget område.
//
//  To ting: gemte boliger og gemte søgninger. Begge findes i forvejen i
//  basen; siden her er den foerste, der viser dem for den, de tilhoerer.
//
//  Gemte soegninger genbruges UROERT fra alarmen. `saved_searches` har
//  allerede `user_id NOT NULL` med fremmednoegle til `users`, og
//  lib/auth.ts binder en alarm-brugerraekke til kontoen paa mailadressen,
//  naar hun opretter én. Koblingen er altsaa sikker i forvejen — den
//  hviler paa, at Supabase Auth kraever en bekraeftet mailadresse, ikke
//  paa at vi gaetter. Der skrives intet nyt alarmsystem, og der aendres
//  intet i det gamle.
// ═══════════════════════════════════════════════════════════════

import type { Metadata } from 'next'
import { desc, eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { savedSearches } from '../../db/schema'
import { hentBruger } from '../../lib/auth'
import { hentFavoritter, type GemtBolig } from '../../lib/favoritter'
import { beskrivFiltre } from '../../lib/alarm'
import { kr } from '../Boligkort'
import { Konto } from '../udlejer/Konto'
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

export default async function Side() {
  const bruger = await hentBruger()

  // ── Ikke logget ind ──────────────────────────────────────────
  if (!bruger) {
    return (
      <div className="minside">
        <h1>Min side</h1>
        <p className="manchet">
          Log ind for at se dine gemte boliger og dine gemte søgninger.
          Gemte boliger følger din konto, så de er der også på telefonen.
        </p>
        <Konto />
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
        <form action={logUd}>
          <button className="nulstil" type="submit">Log ud</button>
        </form>
      </div>

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
