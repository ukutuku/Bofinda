import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { findOmraade, naboer, statistik, type Omraade } from '../../../lib/omraade'
import { antalBoliger, soegGrupperet, type Soegeparametre } from '../../../lib/soeg'
import { Visningskort, kr } from '../../Boligkort'
import { favoritIder, statusFor } from '../../../lib/favoritter'
import { Sider, sideUrl } from '../../Sider'

/** Kort pr. side — samme tal som søgesiden. */
const PR_SIDE = 48

/** `?side=N`, samme strenge regel som på søgesiden. Se noten dér. */
function sidetal(v: string | string[] | undefined): number {
  const s = Array.isArray(v) ? v[0] : v
  return s != null && /^[1-9][0-9]{0,3}$/.test(s) ? Number(s) : 1
}

export const dynamic = 'force-dynamic'

// ─── Tekst ─────────────────────────────────────────────────────

/** "København S" -> "i København S". Postnumre laeses "i 2300 København S". */
const iOmraadet = (o: Omraade) => `i ${o.navn}`

const TYPENAVN: Record<string, string> = {
  lejlighed: 'lejligheder', raekkehus: 'rækkehuse', hus: 'huse',
  vaerelse: 'værelser', studiebolig: 'studieboliger', andet: 'boliger',
  ukendt: 'boliger uden oplyst type',
}

const filterFor = (slags: string, vaerdi: string) =>
  slags === 'by' ? { by: vaerdi } : { postnr: vaerdi }

/**
 * Request-stabilt «nu». To kald i samme sidevisning må ikke fortolke
 * overtagelse mod hvert sit tidspunkt.
 */
const nuFor = cache(() => new Date())

/**
 * ÉT søgekald pr. request, delt af `generateMetadata` og siden.
 *
 * React's `cache()` deduplikerer på argumenterne, så metadata kan læse
 * `kortIAlt` — og dermed vide, om sidetallet er uden for rækkevidde —
 * UDEN en ekstra forespørgsel. Argumenterne er primitive med vilje:
 * `cache()` sammenligner referencer, og et `Omraade`-objekt ville give
 * to kald i stedet for ét.
 */
const sideudsnit = cache(async (slags: string, vaerdi: string, side: number) =>
  soegGrupperet(filterFor(slags, vaerdi), PR_SIDE, nuFor(), side))

/** Er sidetallet efter sidste gyldige side? Ét udtryk, brugt begge steder. */
function udenForRaekkevidde(kortIAlt: number, side: number) {
  const sider = Math.max(1, Math.ceil(kortIAlt / PR_SIDE))
  return { sider, forHoej: side > sider && kortIAlt > 0 }
}

// ─── Metadata ──────────────────────────────────────────────────

export async function generateMetadata(
  { params, searchParams }: {
    params: Promise<{ slug: string }>
    searchParams: Promise<Soegeparametre>
  },
): Promise<Metadata> {
  const { slug } = await params
  const side = sidetal((await searchParams).side)
  const o = await findOmraade(slug)
  if (!o) return { title: 'Området findes ikke — Bofinda' }

  const s = await statistik(o)
  // Genbruger sidens egen tælling gennem cache() — ingen ekstra query.
  const { kortIAlt } = await sideudsnit(o.slags, o.vaerdi, side)
  const { forHoej } = udenForRaekkevidde(kortIAlt, side)
  const spaend = s.billigst != null && s.dyrest != null
    ? `${kr(s.billigst)}–${kr(s.dyrest)} kr.`
    : null

  // Beskrivelsen bygges af tal vi har. Er de der ikke, udelades saetningen
  // frem for at blive fyldt med noget, der lyder rigtigt.
  const dele = [
    `${s.antal} lejeboliger ${iOmraadet(o)}.`,
    spaend ? `Husleje ${spaend} om måneden.` : null,
    s.medianIndflytning != null
      ? `Typisk indflytningspris ${kr(s.medianIndflytning)} kr.`
      : null,
    'Se den reelle månedlige udgift, ikke bare huslejen.',
  ].filter(Boolean)

  // ── En side EFTER sidste gyldige side ───────────────────────────
  // Den svarer 200 og beholder sin forklaring, fordi et menneske, der
  // lander her, skal kunne se hvad der skete og komme videre. Men den er
  // ikke en resultatside, og den må ikke optræde som en.
  //
  // `noindex, follow`: links følges, siden indekseres ikke. Og INGEN
  // canonical — hverken sig selv eller side 1. En self-canonical ville
  // erklære en tom side kanonisk; en canonical til side 1 SAMMEN med
  // noindex sender to modstridende signaler, og risikoen er, at
  // noindex'et smitter af på den side, der peges på. Det utvetydige er
  // at sige én ting: indeksér mig ikke.
  if (forHoej) {
    return {
      title: `Side ${side} findes ikke — lejeboliger ${iOmraadet(o)} | Bofinda`,
      description: `Området har færre sider. Se alle ${s.antal} lejeboliger ${iOmraadet(o)}.`,
      robots: { index: false, follow: true },
    }
  }

  return {
    // Titlen siger hvilken side, saa to sider ikke staar med samme titel
    // i et resultat.
    title: `Lejeboliger ${iOmraadet(o)}${side > 1 ? ` — side ${side}` : ''} — ${s.antal} til leje | Bofinda`,
    description: dele.join(' ').slice(0, 300),
    // SELF-CANONICAL paa side 2 og frem. Pegede de alle paa side 1, ville
    // hver side erklaere sig selv en dublet af den foerste, og boligerne
    // laengere inde kunne falde ud af indekset — netop de boliger,
    // pagineringen findes for at goere naabare.
    alternates: {
      canonical: side > 1 ? `/lejeboliger/${o.slug}?side=${side}` : `/lejeboliger/${o.slug}`,
    },
  }
}

// ─── Siden ─────────────────────────────────────────────────────

export default async function Side({ params, searchParams }: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Soegeparametre>
}) {
  const { slug } = await params
  const sp = await searchParams
  const side = sidetal(sp.side)
  const o = await findOmraade(slug)
  // findOmraade returnerer kun omraader over graensen, saa en for tynd side
  // giver 404 og kommer heller ikke i sitemap'et.
  if (!o) notFound()

  // Efter hinanden, ikke i Promise.all — se noten i app/page.tsx.
  const s = await statistik(o)
  const nu = nuFor()
  // Samme kald som generateMetadata allerede lavede — cache() gør de to
  // til én forespørgsel.
  const { visninger, kortIAlt, komplet } = await sideudsnit(o.slags, o.vaerdi, side)
  const nabo = await naboer(o)
  const favkontekst = await favoritIder()
  // Kort er ikke boliger: ens boliger paa samme vej staar som ét kort.
  const vist = antalBoliger(visninger)
  const { sider, forHoej } = udenForRaekkevidde(kortIAlt, side)

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
          Vi har <strong>{s.antal} lejeboliger</strong> {iOmraadet(o)} lige nu
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

      {forHoej ? (
        <div className="side-findes-ikke">
          <p>
            <strong>Side {side} findes ikke.</strong> Området har{' '}
            {sider} {sider === 1 ? 'side' : 'sider'}.
          </p>
          <p>
            <a href={sideUrl(`/lejeboliger/${o.slug}`, sp, sider)}>Gå til side {sider}</a>
            {side !== 1 && <> · <a href={sideUrl(`/lejeboliger/${o.slug}`, sp, 1)}>tilbage til side 1</a></>}
          </p>
        </div>
      ) : visninger.length === 0 ? (
        <div className="tom"><p>Ingen boliger lige nu.</p></div>
      ) : (
        <div className="liste">
          {visninger.map((v) => (
            <Visningskort
              nu={nu}
              key={v.slags === 'gruppe' ? `g:${v.gruppe.repraesentant.id}` : v.bolig.id}
              v={v}
              favorit={statusFor(favkontekst,
                v.slags === 'gruppe' ? v.gruppe.repraesentant.id : v.bolig.id)}
            />
          ))}
        </div>
      )}

      {/* Kort af kort, og boliger for sig — samme skel som paa soegesiden. */}
      {kortIAlt > visninger.length && (
        <p className="begraensning">
          Viser {vist} af {s.antal} boliger på side {side} af {sider}.{' '}
          <a href={o.slags === 'by'
            ? `/?by=${encodeURIComponent(o.vaerdi)}`
            : `/?postnr=${o.vaerdi}`}>Søg med filtre for at indsnævre →</a>
        </p>
      )}

      <Sider basis={`/lejeboliger/${o.slug}`} sp={sp} side={side} sider={sider} komplet={komplet} />

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
