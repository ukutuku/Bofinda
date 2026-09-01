// ═══════════════════════════════════════════════════════════════
//  Boligkortet og formateringen omkring det.
//  Deles af søgesiden og områdesiderne, så en rettelse ét sted slår
//  igennem begge steder.
// ═══════════════════════════════════════════════════════════════

import type { Bolig } from '../lib/soeg'
import { billedUrl } from '../lib/billede'

// ─── Formatering ───────────────────────────────────────────────

export const kr = (oere: number | null) =>
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

/**
 * Er der forskel ud over det, vi normaliserer med vilje, vises kildens egen
 * streng ved siden af. Linjen er oplysende, ikke en fejlmelding: kilder
 * skriver stednavne ("Fjerbregnevej 2, Trøstrup") og lejlighedsnumre
 * ("4. tv 35"), som vi ikke har felter til. Den fangede til gengaeld to
 * rigtige parsningsfejl under indkoeringen, saa den bliver staaende.
 */
const nogenlunde = (a: string, b: string) => {
  // "sal" og "lejl" er ord, vores normalisering med rette taber. De taeller
  // ikke som forskel — ellers advarer vi om hver eneste bolig, og saa holder
  // ingen op med at se advarslen.
  const skrael = (s: string) => s.toLowerCase()
    .replace(/\b(sal|lejl|lejlighed|dør|doer|vaer|vær)\b/g, '')
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

export function Kort({ b }: { b: Bolig }) {
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
    <a className={`kort${b.forside ? '' : ' uden-billede'}`} href={`/bolig/${b.id}`}>
      {b.forside && billedUrl(b.forside, 400) && (
        <div className="kort-billede">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={billedUrl(b.forside, 400)!} alt="" loading="lazy" />
          {b.billeder > 1 && <span className="kort-antal">{b.billeder} billeder</span>}
        </div>
      )}

      <div className="kort-krop">
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

        {/* Det store tal er den REELLE maanedlige udgift, ikke huslejen.
            Kender vi den ikke, staar huslejen der i stedet — men uden
            accentfarven, saa de to aldrig kan forveksles paa afstand. */}
        <div className="oekonomi-linje">
          {b.total != null ? (
            <div className="kort-pris">
              {kr(b.total)} <small>kr/md i alt</small>
            </div>
          ) : (
            <div className="kort-pris kun-leje">
              {kr(b.leje) ?? '—'} <small>kr/md i husleje</small>
            </div>
          )}

          {b.indflytning != null && (
            <div className="total">indflytning <b>{kr(b.indflytning)} kr.</b></div>
          )}

          {b.total == null && (
            /* Manglen skal vaere synlig for brugeren, ikke bare fravaerende.
               Vi kan ikke skelne "udlejer opkraever intet" fra "udlejer
               oplyser intet", saa vi paastaar ingen af delene — vi siger,
               hvad hun skal spoerge om. */
            <span className="ukendt">
              Udlejer oplyser ikke aconto — spørg om varme og vand.
            </span>
          )}
          {b.total != null && b.el == null && (
            <div className="el">El afregnes direkte med elselskabet</div>
          )}
          {!nyligt && (
            <div className="total">
              {b.hosKilden ? `annonceret ${siden(b.hosKilden)}` : `set ${siden(b.foerstSet)}`}
            </div>
          )}
          {/* Egen linje nederst: den forklarer det store tal og skal staa
              under det, ikke klemmes ind mellem de andre oplysninger. */}
          {b.total != null && (
            <div className="poster">{['husleje', ...aconto].join(' + ')}</div>
          )}
        </div>
      </div>
    </a>
  )
}
