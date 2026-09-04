import { Kort, kr } from '../Boligkort'
import {
  gruppenoegleFra, gruppenoegleFraBolig, hentGruppe, type Soegeparametre,
} from '../../lib/soeg'

export const dynamic = 'force-dynamic'

// ═══════════════════════════════════════════════════════════════
//  De enkelte boliger bag ét gruppekort.
//
//  Adressen bærer ét felt: `?b=<repræsentantens bolig-id>`. Nøglen udledes
//  af den bolig — kilde, postnummer, vej, værelser, om totalen er kendt, og
//  for udlejerannoncer ejeren. Ikke brugerens øvrige filtre, så linket peger
//  på det samme, uanset hvem der åbner det.
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
  const boliger = n ? await hentGruppe(n) : []

  if (!n || boliger.length === 0) {
    return (
      <div className="afmeld">
        <h1>Boligerne findes ikke længere</h1>
        <p>
          {n
            ? 'De boliger, linket peger på, er ikke længere til leje hos kilden.'
            : 'Linket er ufuldstændigt.'}
        </p>
        <p className="note"><a href="/">← Til boligsøgningen</a></p>
      </div>
    )
  }

  const typer = new Set(boliger.map((b) => b.type))
  const ord = typer.size === 1 ? (TYPEORD[[...typer][0] ?? ''] ?? 'boliger') : 'boliger'

  // Prisen er ikke en nøgledel, så gruppen har et spænd. Det regnes af
  // de boliger, der faktisk står på siden — ikke af nøglen.
  const priser = boliger.map((b) => b.total ?? b.leje).filter((p): p is number => p != null)
  const prisMin = Math.min(...priser)
  const prisMax = Math.max(...priser)

  return (
    <div className="omraade">
      <div className="krumme">
        <a href="/">Alle boliger</a> <span>·</span>{' '}
        <a href={`/?sted=${encodeURIComponent(n.postnr)}`}>{n.postnr} {boliger[0]!.by}</a>
      </div>

      <h1>{n.vej}</h1>
      <p className="gruppe-manchet">
        <strong>{boliger.length} ledige {ord}</strong> med {n.vaerelser}{' '}
        {n.vaerelser === 1 ? 'værelse' : 'værelser'}, fra {boliger[0]!.kildeNavn}.
        Boligerne kan være forskellige i pris, areal og indflytningsdato — det
        står på hver enkelt nedenfor.
      </p>

      <div className="optaelling">
        <span><strong>{n.vaerelser}</strong> {n.vaerelser === 1 ? 'værelse' : 'værelser'}</span>
        <span>
          {prisMin === prisMax ? kr(prisMin) : `${kr(prisMin)}–${kr(prisMax)}`} kr/md{' '}
          {n.total ? 'til udlejer' : 'i husleje'}
        </span>
        <span>{n.postnr} {boliger[0]!.by}</span>
      </div>

      <div className="liste">
        {boliger.map((b) => <Kort key={b.id} b={b} />)}
      </div>
    </div>
  )
}
