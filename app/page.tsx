import { facetter, opsummering, soeg, type Filtre } from '../lib/soeg'
import { Kort, kr } from './Boligkort'

export const dynamic = 'force-dynamic'

// ─── Siden ─────────────────────────────────────────────────────

const heltal = (v: string | undefined) => {
  const n = Number(v)
  return v && Number.isFinite(n) ? Math.trunc(n) : undefined
}
const kroner = (v: string | undefined) => {
  const n = heltal(v)
  return n == null ? undefined : n * 100
}

type Sp = Record<string, string | string[] | undefined>
const en = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : v

export default async function Side({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams
  const kilderValgt = sp.kilde
    ? (Array.isArray(sp.kilde) ? sp.kilde : [sp.kilde])
    : undefined

  const f: Filtre = {
    by: en(sp.by) || undefined,
    postnr: en(sp.postnr) || undefined,
    prisMin: kroner(en(sp.prisMin)),
    prisMax: kroner(en(sp.prisMax)),
    vaerelserMin: heltal(en(sp.vaerelser)),
    arealMin: heltal(en(sp.areal)),
    kilder: kilderValgt,
    fuldOekonomi: en(sp.fuld) === '1',
    sorter: (en(sp.sorter) as Filtre['sorter']) || 'nyeste',
  }

  const [boliger, sum, fac] = await Promise.all([soeg(f), opsummering(f), facetter()])

  return (
    <>
      <form className="filtre" method="get">
        <div className="felt">
          <label htmlFor="by">By</label>
          <input id="by" name="by" defaultValue={f.by ?? ''} placeholder="fx København" list="byer" />
          <datalist id="byer">
            {fac.byer.map((b) => <option key={`${b.by}-${b.postnr}`} value={b.by ?? ''} />)}
          </datalist>
        </div>
        <div className="felt">
          <label htmlFor="postnr">Postnummer</label>
          <input id="postnr" name="postnr" defaultValue={f.postnr ?? ''} placeholder="fx 2300" inputMode="numeric" />
        </div>
        <div className="felt">
          <label htmlFor="prisMin">Pris fra (kr)</label>
          <input id="prisMin" name="prisMin" defaultValue={en(sp.prisMin) ?? ''} inputMode="numeric" />
        </div>
        <div className="felt">
          <label htmlFor="prisMax">Pris til (kr)</label>
          <input id="prisMax" name="prisMax" defaultValue={en(sp.prisMax) ?? ''} inputMode="numeric" />
        </div>
        <div className="felt">
          <label htmlFor="vaerelser">Værelser mindst</label>
          <input id="vaerelser" name="vaerelser" defaultValue={en(sp.vaerelser) ?? ''} inputMode="numeric" />
        </div>
        <div className="felt">
          <label htmlFor="areal">m² mindst</label>
          <input id="areal" name="areal" defaultValue={en(sp.areal) ?? ''} inputMode="numeric" />
        </div>
        <div className="felt">
          <label htmlFor="kilde">Kilde</label>
          <select id="kilde" name="kilde" defaultValue={kilderValgt?.[0] ?? ''}>
            <option value="">alle</option>
            {fac.kilder.map((k) => (
              <option key={k.slug} value={k.slug}>{k.navn} ({k.antal})</option>
            ))}
          </select>
        </div>
        <div className="felt">
          <label htmlFor="sorter">Sortér</label>
          <select id="sorter" name="sorter" defaultValue={f.sorter}>
            <option value="nyeste">nyeste først</option>
            <option value="pris_op">pris, lav til høj</option>
            <option value="pris_ned">pris, høj til lav</option>
            <option value="areal_ned">størst først</option>
          </select>
        </div>
        <div className="felt afkryds">
          <input type="checkbox" id="fuld" name="fuld" value="1" defaultChecked={f.fuldOekonomi} />
          <label htmlFor="fuld">Fuld økonomi kendt</label>
        </div>
        <div className="knapper">
          <button type="submit">Søg</button>
          <a className="nulstil" href="/">Nulstil</a>
        </div>
      </form>

      <div className="optaelling">
        <span><strong>{sum.antal}</strong> {sum.antal === 1 ? 'bolig' : 'boliger'}</span>
        <span>{sum.fuld} med fuld økonomi</span>
        <span>{sum.medIndflytning} med indflytningspris</span>
        {sum.billigst != null && sum.dyrest != null && (
          <span>{kr(sum.billigst)}–{kr(sum.dyrest)} kr/md</span>
        )}
      </div>

      {sum.antal > boliger.length && (
        <p className="begraensning">
          Viser de {boliger.length} nyeste af {sum.antal}. Brug filtrene for at indsnævre.
        </p>
      )}

      {boliger.length === 0 ? (
        <div className="tom">
          <p>Ingen boliger matcher.</p>
          <p>Prøv at fjerne et filter.</p>
        </div>
      ) : (
        <div className="liste">
          {boliger.map((b) => <Kort key={b.id} b={b} />)}
        </div>
      )}

      <footer className="bund">
        Boliger hentet fra {fac.kilder.map((k) => k.navn).join(' og ')}.
        Klik på en bolig for at åbne den hos kilden.
        Tal vises som kilden oplyser dem; mangler en oplysning, står den tom.
      </footer>
    </>
  )
}
