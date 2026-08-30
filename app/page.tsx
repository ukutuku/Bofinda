import { facetter, opsummering, soeg, type Bolig, type Filtre } from '../lib/soeg'

export const dynamic = 'force-dynamic'

// ─── Formatering ───────────────────────────────────────────────

const kr = (oere: number | null) =>
  oere == null ? null : (oere / 100).toLocaleString('da-DK', { maximumFractionDigits: 0 })

const MDR = ['januar','februar','marts','april','maj','juni',
             'juli','august','september','oktober','november','december']

const dato = (d: Date | null) => d ? `${d.getDate()}. ${MDR[d.getMonth()]} ${d.getFullYear()}` : null

/** "for 3 timer siden". Bygget paa first_seen_at — hvornaar VI saa den. */
function siden(d: Date): string {
  const min = Math.round((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'lige nu'
  if (min < 60) return `for ${min} min. siden`
  const t = Math.round(min / 60)
  if (t < 24) return `for ${t} ${t === 1 ? 'time' : 'timer'} siden`
  const dg = Math.round(t / 24)
  if (dg < 31) return `for ${dg} ${dg === 1 ? 'dag' : 'dage'} siden`
  const m = Math.round(dg / 30)
  return `for ${m} ${m === 1 ? 'måned' : 'måneder'} siden`
}

/** Adressen som VI har forstaaet den — af de parsede felter, ikke af
 *  kildens streng. Er parsningen gaaet galt, kan man se det her. */
function parsetAdresse(b: Bolig): string {
  const vej = [b.vej, b.husnr].filter(Boolean).join(' ')
  let etage: string | null = null
  if (b.etage === 'st') etage = 'st.'
  else if (b.etage === 'kl') etage = 'kælder'
  else if (b.etage) etage = b.doer ? `${b.etage}.` : `${b.etage}. sal`
  const etageDoer = [etage, b.doer].filter(Boolean).join(' ')
  return [vej, etageDoer].filter(Boolean).join(', ') || b.adresse
}

/** Sammenlign paa bogstaver og tal alene. Er der forskel, har parsningen
 *  tabt noget, og saa vises kildens egen streng ved siden af. */
const nogenlunde = (a: string, b: string) => {
  // "sal" og "lejl" er ord, vores normalisering med rette taber. De taeller
  // ikke som forskel — ellers advarer vi om hver eneste bolig, og saa holder
  // ingen op med at se advarslen.
  const skrael = (s: string) => s.toLowerCase()
    .replace(/\b(sal|lejl|lejlighed|vaer|vær)\b/g, '')
    // Kilder skriver stueetagen som baade "0" og "st". Det er samme etage.
    .replace(/\b0\b/g, 'st')
    .replace(/[^a-z0-9æøå]/g, '')
  return skrael(a) === skrael(b)
}

const POSTNAVN: Record<string, string> = {
  rent: 'husleje', heat: 'varme', water: 'vand',
  electricity: 'el', other: 'øvrig aconto',
}

// ─── Kortet ────────────────────────────────────────────────────

function Kort({ b }: { b: Bolig }) {
  // Hvor laenge boligen har vaeret til leje, ikke hvor laenge den har ligget
  // i vores base. Ved foerste import er alt "set for 9 min. siden", og et
  // maerkat der siger "ny" om en annonce fra juli er en loegn.
  const paaMarkedet = b.hosKilden ?? b.foerstSet
  const nyligt = Date.now() - paaMarkedet.getTime() < 1000 * 60 * 60 * 24 * 3
  const fakta = [
    b.areal != null ? <><b>{b.areal}</b> m²</> : null,
    b.vaerelser != null ? <><b>{b.vaerelser}</b> {b.vaerelser === 1 ? 'værelse' : 'værelser'}</> : null,
    b.type,
    // En dato i fortiden betyder ikke "ledig 15. juni" — den betyder ledig nu.
    b.ledigFra ? (b.ledigFra.getTime() <= Date.now() ? 'ledig nu' : `ledig fra ${dato(b.ledigFra)}`) : null,
  ].filter(Boolean)

  const aconto = (b.poster ?? []).filter((p) => p !== 'rent').map((p) => POSTNAVN[p] ?? p)
  const vist = parsetAdresse(b)
  // Kildens streng baerer ofte postnr og by med. Vi viser dem én gang.
  const raaUdenSted = b.adresse
    .replace(new RegExp(`,?\\s*${b.postnr ?? ''}\\s*${b.by ?? ''}\\s*$`, 'i'), '')
    .replace(/,\s*$/, '').trim()
  const parsningTabteNoget = !nogenlunde(vist, raaUdenSted)

  return (
    <a className="kort" href={b.url} target="_blank" rel="noopener noreferrer">
      <div className="raek1">
        <div>
          <div className="adresse">{vist}</div>
          <div className="sted">
            {b.postnr} {b.by}
            {b.match === 'access' && ' · uden etage/dør'}
            {b.billeder === 0 && ' · ingen billeder'}
          </div>
          {parsningTabteNoget && (
            <div className="afvig">kilden skriver: {raaUdenSted}</div>
          )}
        </div>
        <div className="hoejre">
          {b.ansoegning === 'waiting_list' && <span className="maerkat m-vent">venteliste</span>}
          {nyligt && <span className="maerkat m-ny">ny {siden(paaMarkedet)}</span>}
          <span className="maerkat m-kilde">{b.kildeNavn}</span>
        </div>
      </div>

      <div className="fakta">
        {fakta.map((f, i) => <span key={i}>{i > 0 && ' · '}{f}</span>)}
      </div>

      <div className="oekonomi">
        <div className="leje">
          {kr(b.leje) ?? '—'} <small>kr/md</small>
        </div>
        {b.total != null ? (
          <div className="total">
            <b>{kr(b.total)} kr/md</b> i alt — {['husleje', ...aconto].join(' + ')}
          </div>
        ) : (
          <span className="ukendt">aconto ikke oplyst — samlet udgift ukendt</span>
        )}
        {/* Kun naar vi har gjort rede for hele udlejerens aconto. Ellers ved
            vi ikke, om el mangler i opgoerelsen eller ikke opkraeves. */}
        {b.total != null && b.el == null && (
          <div className="el">El afregnes direkte med elselskabet</div>
        )}
        {b.indflytning != null && (
          <div className="total">indflytning <b>{kr(b.indflytning)} kr</b></div>
        )}
        {!nyligt && (
          <div className="total">
            {b.hosKilden ? `annonceret ${siden(b.hosKilden)}` : `set ${siden(b.foerstSet)}`}
          </div>
        )}
      </div>
    </a>
  )
}

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
