// ═══════════════════════════════════════════════════════════════
//  Siden findes ikke (404).
//
//  Uden denne fil viste Next sin egen engelske standardside — «This
//  page could not be found.» — på hvid bund (set med curl på
//  bofinda.dk 4. oktober 2026). Siden skal tale samme sprog og have
//  samme ramme som resten.
//
//  Teksten påstår ikke, HVORFOR siden mangler. En ukendt adresse
//  dokumenterer ikke selv sin årsag — en nedtaget bolig, en tastefejl
//  og et afklippet link ser ens ud herfra — så brødteksten nævner kun
//  muligheder og siger «kan».
//
//  Ingen egen `robots` her: Next sætter selv `noindex` på et
//  ikke-fundet-svar, og en egen regel gav to ens tags.
// ═══════════════════════════════════════════════════════════════
export const metadata = { title: 'Siden findes ikke — Bofinda' }

export default function IkkeFundet() {
  return (
    <div className="afmeld">
      <h1>Siden findes ikke</h1>
      <p>
        Vi kan ikke finde siden på denne adresse. Linket kan være forældet,
        eller adressen kan være skrevet forkert.
      </p>
      <p className="note"><a href="/">← Til boligsøgningen</a></p>
    </div>
  )
}
