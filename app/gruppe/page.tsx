import { Kort, kr } from '../Boligkort'
import { favoritIder, statusFor } from '../../lib/favoritter'
import {
  filtreFraParametre, gruppenoegleFra, gruppenoegleFraBolig, hentGruppe, type Soegeparametre,
} from '../../lib/soeg'
import { erEgenAnnonce } from '../../lib/kilde'
import { RETUR_PARAM, returUrl } from '../../lib/retur'
import { spor } from '../../lib/maaling-server'

export const dynamic = 'force-dynamic'

// ═══════════════════════════════════════════════════════════════
//  De enkelte boliger bag ét gruppekort.
//
//  Adressen bærer `?b=<repræsentantens bolig-id>` og listens søgefiltre. Nøglen udledes
//  af den bolig — kilde, postnummer, vej, værelser, om totalen er kendt, og
//  for udlejerannoncer ejeren. Filtrene bevarer kortets udsnit efter klik,
//  så «Se de 2 adresser» ikke åbner fire boliger over brugerens makspris.
//
//  Hvorfor ikke nøglen i adressen, som før: da ejeren kom med i nøglen,
//  ville det have lagt en udlejers konto-id i en delbar URL. Bolig-id'et er
//  allerede offentligt — det står i /bolig/{id} på hvert eneste kort.
//
//  De gamle parameter-links virker uændret. De kunne kun være dannet af
//  scrapede boliger, hvis `landlord_id` er null, og `gruppenoegleFra`
//  sætter derfor ejeren til null.
//
//  Ikke i sitemap og ikke indekseret: det er en udfoldning af listen, ikke
//  en side i sig selv. Boligerne står hver for sig på /bolig/[id], og
//  områdesiderne er dem, der skal findes i en søgemaskine.
// ═══════════════════════════════════════════════════════════════

export const metadata = { robots: { index: false } }

const TYPEORD: Record<string, string> = {
  lejlighed: 'lejligheder', raekkehus: 'rækkehuse', hus: 'huse',
  villa: 'villaer', vaerelse: 'værelser',
}

export default async function Side(
  { searchParams }: { searchParams: Promise<Soegeparametre> },
) {
  const sp = await searchParams
  const b = Array.isArray(sp.b) ? sp.b[0] : sp.b
  const n = b ? await gruppenoegleFraBolig(b.trim()) : gruppenoegleFra(sp)
  const nu = new Date()
  // Vejen tilbage til den søgning, hun kom fra. Den GENOPBYGGES af
  // `returUrl` — adressen i `?fra=` ekkoes aldrig, og er den ikke til at
  // genkende, er der ingen returvej, og siden står som før. Se
  // lib/retur.ts.
  //
  // Den gives UÆNDRET videre til kortene herunder. Pakkede gruppesiden
  // sin egen adresse ind i sig selv, ville strengen vokse for hvert hop,
  // og boligsidens returvej ville føre hertil i stedet for til listen.
  const tilbage = returUrl(sp[RETUR_PARAM])
  // Gamle nøglelinks bruger også postnr/værelser, men til selve nøglen.
  // Kun id-linkene læser derfor parametrene som søgefiltre.
  const boliger = n ? await hentGruppe(n, b ? filtreFraParametre(sp) : undefined) : []
  // Efter hinanden, ikke i Promise.all: samtidige kæder pipelines gennem
  // Supavisor i transaction mode. Opslaget er cachet pr. request og
  // spørger slet ikke, når ingen er logget ind.
  const favkontekst = await favoritIder()

  if (!n || boliger.length === 0) {
    return (
      <div className="afmeld">
        <h1>Boligerne findes ikke længere</h1>
        <p>
          {n
            ? 'De boliger, linket peger på, er ikke længere til leje hos kilden.'
            : 'Linket er ufuldstændigt.'}
        </p>
        <p className="note">
          <a href={tilbage ?? '/'}>
            {tilbage ? '← Tilbage til søgeresultaterne' : '← Til boligsøgningen'}
          </a>
        </p>
      </div>
    )
  }

  // Ét event pr. udfoldning. Repraesentantens id, ikke gruppens noegle:
  // noeglen baerer udlejerens konto-id for native annoncer.
  await spor({
    navn: 'group_opened',
    listingId: boliger[0]!.id,
    sourceSlug: n.kilde,
    props: { gruppe_antal: boliger.length, ...(n.postnr ? { postnr: n.postnr } : {}) },
  }, '/gruppe')

  const typer = new Set(boliger.map((b) => b.type))
  const ord = typer.size === 1 ? (TYPEORD[[...typer][0] ?? ''] ?? 'boliger') : 'boliger'

  // Prisen er ikke en nøgledel, så gruppen har et spænd. Det regnes af
  // de boliger, der faktisk står på siden — ikke af nøglen.
  const priser = boliger.map((b) => b.total ?? b.leje).filter((p): p is number => p != null)
  const prisMin = Math.min(...priser)
  const prisMax = Math.max(...priser)

  return (
    <div className="omraade">
      {/* Samme sti og samme sidetitel som resultatsiden. Gruppesiden
          er en udfoldning af ét kort derfra, og den skal se ud som det
          sted, man kom fra — ikke som en tredje slags side. Adresserne
          og teksten er uaendrede. */}
      <nav className="broedkrumme" aria-label="Sti">
        {/* Det første led er HENDES søgning, når vi har den — med
            filtre, sortering og liste-/kortvalg. Har vi den ikke (et
            delt link, et bogmærke), står der «Forside» og fører til
            forsiden, præcis som før. Et link, der lover at føre tilbage
            og i stedet nulstiller søgningen, ville være den samme slags
            usandhed som en total, der lader som om aconto er kendt. */}
        <a href={tilbage ?? '/'}>{tilbage ? '← Tilbage til søgeresultaterne' : 'Forside'}</a>
        <span aria-hidden="true">›</span>
        <a href={`/?sted=${encodeURIComponent(n.postnr)}`}>{n.postnr} {boliger[0]!.by}</a>
        <span aria-hidden="true">›</span>
        <span aria-current="page">{n.vej}</span>
      </nav>

      {/* ── Titel, antal og ÉN forklaring ──────────────────────
          Her stod to blokke, og den anden gentog den første. Striben
          havde tre felter: værelsestallet, som sætningen ovenfor
          allerede sagde; postnummer og by, som brødkrummen allerede
          sagde; og prisspændet, som var det eneste nye. To af tre
          oplysninger stod altså to gange, og de skubbede tilsammen
          boligkortene 48 px ned på en telefon.

          Prisspændet er flyttet ind i sætningen, hvor det hører til —
          det er en oplysning om gruppen, ikke en fjerde overskrift — og
          striben er væk. Ingenting er tabt: værelser, by og postnummer
          står stadig på siden, bare ét sted hver.

          Forbeholdet bliver. Et gruppekort må kun påstå det, der gælder
          for HELE gruppen, og at boligerne kan være forskellige er
          netop det, læseren skal vide, før hun læser ét tal som alles. */}
      <div className="sidetitel">
        <h1>{n.vej}</h1>
        <p>
          <strong>{boliger.length} {ord}</strong> med {n.vaerelser}{' '}
          {n.vaerelser === 1 ? 'værelse' : 'værelser'}{' '}
          {/* Samme spørgsmål som kortets mærkat, samme svar — men med
              plads til en sætning. Se `kildeetiket` i lib/kilde.ts. */}
          {erEgenAnnonce(boliger[0]!) ? 'fra udlejeren selv' : `fra ${boliger[0]!.kildeNavn}`},{' '}
          {prisMin === prisMax ? kr(prisMin) : `${kr(prisMin)}–${kr(prisMax)}`} kr/md{' '}
          {n.total ? 'til udlejer' : 'i husleje'}. Pris, areal og indflytningsdato
          kan variere — se hver enkelt nedenfor.
        </p>
      </div>

      <div className="listeomraade">
        <div className="liste">
          {/* Den GENOPBYGGEDE adresse gives videre, ikke den rå fra
              URL'en. Så er der ingen streng i sidens markup, som en
              fremmed har skrevet — kun den, vi selv har bygget af en
              literal sti og de nøgler, hvidlisten navngiver. */}
          {boliger.map((b) => (
            <Kort key={b.id} b={b} nu={nu} favorit={statusFor(favkontekst, b.id)}
              retur={tilbage} />
          ))}
        </div>
      </div>
    </div>
  )
}
