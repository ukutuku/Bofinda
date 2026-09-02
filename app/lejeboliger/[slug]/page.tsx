import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { findOmraade, naboer, statistik, type Omraade } from '../../../lib/omraade'
import { antalBoliger, soegGrupperet } from '../../../lib/soeg'
import { Visningskort, kr } from '../../Boligkort'

export const dynamic = 'force-dynamic'

// ─── Tekst ─────────────────────────────────────────────────────

/** "København S" -> "i København S". Postnumre laeses "i 2300 København S". */
const iOmraadet = (o: Omraade) => `i ${o.navn}`

const TYPENAVN: Record<string, string> = {
  lejlighed: 'lejligheder', raekkehus: 'rækkehuse', hus: 'huse',
  vaerelse: 'værelser', studiebolig: 'studieboliger', andet: 'boliger',
  ukendt: 'boliger uden oplyst type',
}

const filterFor = (o: Omraade) =>
  o.slags === 'by' ? { by: o.vaerdi } : { postnr: o.vaerdi }

// ─── Metadata ──────────────────────────────────────────────────

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params
  const o = await findOmraade(slug)
  if (!o) return { title: 'Området findes ikke — Bofinda' }

  const s = await statistik(o)
  const spaend = s.billigst != null && s.dyrest != null
    ? `${kr(s.billigst)}–${kr(s.dyrest)} kr.`
    : null

  // Beskrivelsen bygges af tal vi har. Er de der ikke, udelades saetningen
  // frem for at blive fyldt med noget, der lyder rigtigt.
  const dele = [
    `${s.antal} ledige lejeboliger ${iOmraadet(o)}.`,
    spaend ? `Husleje ${spaend} om måneden.` : null,
    s.medianIndflytning != null
      ? `Typisk indflytningspris ${kr(s.medianIndflytning)} kr.`
      : null,
    'Se den reelle månedlige udgift, ikke bare huslejen.',
  ].filter(Boolean)

  return {
    title: `Lejeboliger ${iOmraadet(o)} — ${s.antal} ledige | Bofinda`,
    description: dele.join(' ').slice(0, 300),
    alternates: { canonical: `/lejeboliger/${o.slug}` },
  }
}

// ─── Siden ─────────────────────────────────────────────────────

export default async function Side({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const o = await findOmraade(slug)
  // findOmraade returnerer kun omraader over graensen, saa en for tynd side
  // giver 404 og kommer heller ikke i sitemap'et.
  if (!o) notFound()

  // Efter hinanden, ikke i Promise.all — se noten i app/page.tsx.
  const s = await statistik(o)
  const visninger = await soegGrupperet(filterFor(o), 48)
  const nabo = await naboer(o)
  // Kort er ikke boliger: ens boliger paa samme vej staar som ét kort.
  const vist = antalBoliger(visninger)

  const typeListe = s.typer
    .filter((t) => t.antal > 0)
    .map((t) => `${t.antal} ${TYPENAVN[t.type] ?? t.type}`)

  return (
    <div className="omraade">
      <nav className="krumme">
        <a href="/">Alle boliger</a>
        <span>›</span>
        <span>{o.navn}</span>
      </nav>

      <h1>Lejeboliger {iOmraadet(o)}</h1>

      {/* Kun tal vi kan pege paa raekkerne bag. Ingen paastande om
          markedet, ingen "populaert omraade". */}
      <div className="fakta-blok">
        <p>
          Vi har <strong>{s.antal} ledige lejeboliger</strong> {iOmraadet(o)} lige nu
          {typeListe.length > 0 && <> — {typeListe.join(', ')}</>}.
          {s.billigst != null && s.dyrest != null && (
            <> Huslejen går fra <strong>{kr(s.billigst)} kr.</strong> til{' '}
              <strong>{kr(s.dyrest)} kr.</strong> om måneden
              {s.gennemsnitLeje != null && <>, i gennemsnit {kr(s.gennemsnitLeje)} kr.</>}
            </>
          )}
          {s.medianAreal != null && <> Den typiske bolig er {s.medianAreal} m².</>}
        </p>
        <p>
          {s.medianIndflytning != null ? (
            <>Den typiske indflytningspris er <strong>{kr(s.medianIndflytning)} kr.</strong> —
              første måneds husleje, depositum og forudbetalt leje tilsammen.</>
          ) : (
            <>Ingen af boligerne oplyser en indflytningspris.</>
          )}
          {' '}
          {s.medTotal === s.antal
            ? <>Alle {s.antal} oplyser aconto, så den reelle månedlige udgift kendes.</>
            : s.medTotal === 0
              ? <>Ingen af dem oplyser aconto, så den samlede månedlige udgift kendes ikke.</>
              : <><strong>{s.medTotal} af {s.antal}</strong> oplyser aconto. På resten kender
                vi kun huslejen — spørg udlejeren om varme og vand.</>}
        </p>
        <p className="note">
          Tallene er talt af de boliger, vi har hentet, og ændrer sig, når udbuddet gør.
          De er ikke et udtryk for hele markedet {iOmraadet(o)}.
        </p>
      </div>

      {visninger.length === 0 ? (
        <div className="tom"><p>Ingen boliger lige nu.</p></div>
      ) : (
        <div className="liste">
          {visninger.map((v) => (
            <Visningskort
              key={v.slags === 'gruppe' ? `g:${v.gruppe.repraesentant.id}` : v.bolig.id}
              v={v}
            />
          ))}
        </div>
      )}

      {s.antal > vist && (
        <p className="begraensning">
          Viser de {vist} nyeste af {s.antal}.{' '}
          <a href={o.slags === 'by'
            ? `/?by=${encodeURIComponent(o.vaerdi)}`
            : `/?postnr=${o.vaerdi}`}>Søg med filtre for at indsnævre →</a>
        </p>
      )}

      {nabo.length > 0 && (
        <section className="naboer">
          <h2>Andre områder</h2>
          <ul>
            {nabo.map((n) => (
              <li key={n.slug}>
                <a href={`/lejeboliger/${n.slug}`}>
                  {n.slags === 'by' ? n.navn : n.navn}
                  <span>{n.antal}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
