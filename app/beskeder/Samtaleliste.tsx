'use client'
// ═══════════════════════════════════════════════════════════════
//  Samtaleoversigten.
//
//  ═══ HVAD RÆKKEN SIGER, OG I HVILKEN RÆKKEFØLGE ═══
//
//  Boligen står øverst og stærkest. Man husker samtaler på «lejligheden
//  på Udlejergaarden», ikke på «Anne». Modparten står under, sammen med
//  hvornår der sidst skete noget, og uddraget nederst.
//
//  ═══ ULÆST MÅ IKKE VÆRE EN FARVE ALENE ═══
//
//  Markeringen er TRE ting på én gang: en prik, et tal, og fed skrift i
//  rækken. En blå prik alene er usynlig i gråtoner og for en stor del af
//  dem, der har svært ved farver. Tallet er desuden mere værd end
//  prikken — «3 ulæste» er en anden besked end «1 ulæst».
//
//  ═══ UDDRAGET ER FORKORTET AF SERVEREN ═══
//
//  Ikke af CSS. Klippede vi en lang besked med `text-overflow`, ville
//  hele teksten stå i markuppen — samme fejl som at skjule et låst
//  indhold med `display: none`. Se kontrakt.ts.
//
//  ═══ KNAP, IKKE LINK ═══
//
//  Rækken skifter panel; den navigerer ikke. En `<button>` er dét, og
//  den får `aria-current`, så den valgte kan høres og ikke kun ses. Den
//  dag modulet får rigtige adresser (`/beskeder/<id>`), er det her, det
//  skal laves om — og det er derfor `vaelg` er en prop og ikke en
//  `router.push` inde i komponenten.
// ═══════════════════════════════════════════════════════════════

import type { Samtalehoved } from './kontrakt'
import { modpartsnavn } from './kontrakt'
import { noejagtig, siden } from './tid'

/** Rækkens tekster, bygget ÉT sted og brugt både til øjet og til navnet. */
function raekketekst(s: Samtalehoved) {
  const navn = modpartsnavn(s.modpart)
  // Er navnet ikke oplyst, ER navnet rollen («Udlejeren»). At skrive
  // «Udlejeren · udlejer» ville sige det samme to gange.
  const rolle = s.modpart.navn === null ? null
    : s.modpart.rolle === 'udlejer' ? 'udlejer' : 'boligsøgende'
  const tid = siden(new Date(s.sidsteAktivitet))
  const ulaest = s.ulaeste === 0 ? null
    : `${s.ulaeste} ${s.ulaeste === 1 ? 'ulæst besked' : 'ulæste beskeder'}`
  return { navn, rolle, tid, ulaest }
}

function Raekke({ s, valgt, vaelg }: {
  s: Samtalehoved; valgt: boolean; vaelg: (id: string) => void
}) {
  const { navn, rolle, tid, ulaest } = raekketekst(s)
  // Navnet samles af de SAMME stykker, øjet ser. Skrev vi en selvstændig
  // sætning her, ville de to drive fra hinanden ved næste rettelse.
  const navnPaaKnappen = [
    s.bolig.adresse,
    `samtale med ${navn}${rolle ? ` (${rolle})` : ''}`,
    ulaest,
    `sidst ${tid}`,
  ].filter(Boolean).join(', ')

  return (
    <li className="bsk-raekke-baerer">
      <button
        type="button"
        className={`bsk-raekke${valgt ? ' er-valgt' : ''}${s.ulaeste > 0 ? ' har-ulaest' : ''}`}
        aria-current={valgt || undefined}
        aria-label={navnPaaKnappen}
        onClick={() => vaelg(s.id)}
      >
        <span className="bsk-raekke-top">
          <span className="bsk-raekke-bolig">{s.bolig.adresse}</span>
          {s.ulaeste > 0 && (
            <span className="bsk-ulaest" aria-hidden="true">{s.ulaeste}</span>
          )}
        </span>
        <span className="bsk-raekke-modpart">
          {navn}{rolle && <span className="bsk-rolle"> · {rolle}</span>}
        </span>
        {s.uddrag && <span className="bsk-raekke-uddrag">{s.uddrag}</span>}
        <span className="bsk-raekke-tid">
          <time dateTime={s.sidsteAktivitet} title={noejagtig(s.sidsteAktivitet)}>{tid}</time>
          {s.bolig.sted && <span className="bsk-raekke-sted">{s.bolig.sted}</span>}
        </span>
      </button>
    </li>
  )
}

/** Skelettet. `aria-hidden`, fordi det ikke er indhold — beskeden om at
 *  der hentes, står i modulets live-område og siges ÉN gang.
 *
 *  ⚠ Pladsholderne bærer IKKE klassen `bsk-raekke`. Det gjorde de, og så
 *  svarede to forskellige ting på spørgsmålet «er det her en samtale?»:
 *  en `<button>` med en samtale bag, og en `<div>` med ingenting. En
 *  måling, der talte `.bsk-raekke`, ramte skelettet og klikkede på et
 *  `<div>`, hvor der ikke skete noget — og fejlen så ud som om
 *  tilbageknappen manglede. Se CLAUDE.md om to udtryk for ét spørgsmål. */
function Skelet() {
  return (
    <ul className="bsk-liste bsk-skelet" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li key={i} className="bsk-raekke-baerer">
          <div className="bsk-skeletraekke">
            <span className="bsk-skeletlinje bred" />
            <span className="bsk-skeletlinje mellem" />
            <span className="bsk-skeletlinje smal" />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function Samtaleliste({ tilstand, samtaler, valgt, vaelg }: {
  tilstand: 'henter' | 'klar'
  samtaler: Samtalehoved[]
  valgt: string | null
  vaelg: (id: string) => void
}) {
  if (tilstand === 'henter') return <Skelet />

  if (samtaler.length === 0) {
    return (
      // Tom indbakke er ikke en fejl, og den får ingen illustration og
      // ingen opfordring til at købe noget. Én sætning om hvad der sker,
      // og én vej videre.
      <div className="bsk-tom">
        <p className="bsk-tom-titel">Du har ingen beskeder endnu.</p>
        <p className="bsk-tom-tekst">
          Skriver du til en udlejer om en bolig, står samtalen her.
        </p>
        <a className="bsk-tom-link" href="/">Find boliger</a>
      </div>
    )
  }

  return (
    <ul className="bsk-liste">
      {samtaler.map((s) => (
        <Raekke key={s.id} s={s} valgt={s.id === valgt} vaelg={vaelg} />
      ))}
    </ul>
  )
}
