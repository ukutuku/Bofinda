import { Kort, kr } from '../Boligkort'
import {
  gruppenoegleFra, hentGruppe, type Soegeparametre,
} from '../../lib/soeg'

export const dynamic = 'force-dynamic'

// ═══════════════════════════════════════════════════════════════
//  De enkelte boliger bag ét gruppekort.
//
//  Siden slås op på nøglen alene — kilde, postnummer, vej, værelser,
//  pris — ikke på brugerens øvrige filtre. Så peger linket på det samme,
//  uanset hvem der åbner det.
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
  const n = gruppenoegleFra(sp)
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

  return (
    <div className="omraade">
      <div className="krumme">
        <a href="/">Alle boliger</a> <span>·</span>{' '}
        <a href={`/?sted=${encodeURIComponent(n.postnr)}`}>{n.postnr} {boliger[0]!.by}</a>
      </div>

      <h1>{n.vej}</h1>
      <p className="gruppe-manchet">
        <strong>{boliger.length} ledige {ord}</strong> med samme antal værelser og
        samme pris, fra {boliger[0]!.kildeNavn}. Boligerne kan være forskellige i
        areal og indflytningsdato — det står på hver enkelt nedenfor.
      </p>

      <div className="optaelling">
        <span><strong>{n.vaerelser}</strong> {n.vaerelser === 1 ? 'værelse' : 'værelser'}</span>
        <span>{kr(n.pris)} kr/md {n.total ? 'i alt' : 'i husleje'}</span>
        <span>{n.postnr} {boliger[0]!.by}</span>
      </div>

      <div className="liste">
        {boliger.map((b) => <Kort key={b.id} b={b} />)}
      </div>
    </div>
  )
}
