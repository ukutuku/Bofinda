// ═══════════════════════════════════════════════════════════════
//  Sidenavigationen. Forrige · sidetal · Næste.
//
//  Almindelige server-renderede `<a>`. Ingen klient-state, ingen JS:
//  tilstanden ligger i URL'en som kortets og filterpanelets, så den kan
//  deles, overlever et genindlæs og gør det forventede i back/frem.
//
//  Deles af søgesiden og områdesiderne, så en rettelse ét sted slår
//  igennem begge steder — samme grund som for Boligkort.
// ═══════════════════════════════════════════════════════════════

import type { Soegeparametre } from '../lib/soeg'

/**
 * Adressen til én side.
 *
 * Alle nuværende parametre kopieres — filtre, flerværdifelter, `sorter`,
 * `kort`, `flere` — så et sideskift ikke taber, hvad brugeren har valgt.
 * Kun `side` skiftes ud.
 *
 * SIDE 1 UDELADER PARAMETEREN. `/?by=X` og `/?by=X&side=1` er den samme
 * side, og to adresser for ét indhold er præcis det, canonical findes
 * for at rydde op i. Vi laver dem ikke selv.
 */
export function sideUrl(basis: string, sp: Soegeparametre, side: number): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (v == null || k === 'side') continue
    for (const x of Array.isArray(v) ? v : [v]) q.append(k, x)
  }
  if (side > 1) q.set('side', String(side))
  const s = q.toString()
  return s ? `${basis}?${s}` : basis
}

/**
 * Et kompakt vindue af sidetal.
 *
 * Den ufiltrerede liste har 21 sider; alle 21 tal ville være en mur og på
 * mobil to linjer. Første, sidste, den aktuelle og dens naboer — resten
 * bliver til et ellipse-mærke. `null` er hullet.
 *
 * Er der syv sider eller færre, vises de alle: et hul mellem 4 og 6 er
 * støj, ikke en genvej.
 */
export function sidevindue(side: number, sider: number): (number | null)[] {
  if (sider <= 7) return Array.from({ length: sider }, (_, i) => i + 1)
  const tal = new Set([1, sider, side - 1, side, side + 1])
  // Enderne får en nabo mere, så vinduet ikke skifter bredde, når man er
  // i starten eller slutningen.
  if (side <= 3) { tal.add(2); tal.add(3); tal.add(4) }
  if (side >= sider - 2) { tal.add(sider - 1); tal.add(sider - 2); tal.add(sider - 3) }
  const sorteret = [...tal].filter((n) => n >= 1 && n <= sider).sort((a, b) => a - b)
  const ud: (number | null)[] = []
  let forrige = 0
  for (const n of sorteret) {
    if (forrige && n - forrige > 1) ud.push(null)
    ud.push(n)
    forrige = n
  }
  return ud
}

export function Sider({ basis, sp, side, sider, komplet }: {
  basis: string
  sp: Soegeparametre
  side: number
  /** Antal sider. Er `komplet` falsk, er det et MINDSTETAL. */
  sider: number
  /** Nåede gennemgangen hele udbuddet igennem? */
  komplet: boolean
}) {
  if (sider <= 1) return null
  const vindue = sidevindue(side, sider)

  return (
    <nav className="sider" aria-label="Sider">
      {side > 1 && (
        <a className="side-pil" rel="prev" href={sideUrl(basis, sp, side - 1)}>← Forrige</a>
      )}

      <ol className="side-tal">
        {vindue.map((n, i) => (
          <li key={n ?? `hul-${i}`}>
            {n == null ? (
              <span className="side-hul" aria-hidden="true">…</span>
            ) : n === side ? (
              // Den aktuelle side er IKKE et link. Et link til der, hvor
              // man står, er en blindgyde for tastatur og skærmlæser.
              <span className="side-nu" aria-current="page">
                <span className="skjult-for-oejet">Side </span>{n}
              </span>
            ) : (
              <a href={sideUrl(basis, sp, n)}>
                <span className="skjult-for-oejet">Side </span>{n}
              </a>
            )}
          </li>
        ))}
      </ol>

      {side < sider && (
        <a className="side-pil" rel="next" href={sideUrl(basis, sp, side + 1)}>Næste →</a>
      )}

      {/* Er gennemgangen afbrudt, er sidetallet et mindstetal, og så må
          hverken «sidste side» eller antallet stå som en total. Samme
          regel som krydsfeltsreglen i lib/maaling.ts: et tal, der ligner
          en eksakt total og ikke er det, er den slags løgn ingen opdager. */}
      {!komplet && (
        <p className="side-note">
          Vi nåede ikke hele udbuddet igennem — der er <strong>mindst {sider} sider</strong>.
          {' '}Indsnævr søgningen for at se resten.
        </p>
      )}
    </nav>
  )
}
