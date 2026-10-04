// ═══════════════════════════════════════════════════════════════
//  Siden findes ikke (404).
//
//  Uden denne fil viste Next sin egen engelske standardside — «This
//  page could not be found.» — på hvid bund, også på bofinda.dk. Den
//  rammes oftest af et gammelt link til en bolig, kilden har taget ned,
//  og den skal tale samme sprog og have samme ramme som resten.
//
//  Teksten påstår ikke, HVORFOR siden mangler: en 404 kan være en
//  nedtaget bolig, en tastefejl eller et afklippet link, og vi ved ikke
//  hvilken. Samme form som «Linket virker ikke» på afmeldingen.
// ═══════════════════════════════════════════════════════════════
export const metadata = { title: 'Siden findes ikke — Bofinda', robots: { index: false } }

export default function IkkeFundet() {
  return (
    <div className="afmeld">
      <h1>Siden findes ikke</h1>
      <p>
        Var det en bolig, kan den være taget ned, siden linket blev delt.
        Ellers er adressen ufuldstændig eller skrevet forkert.
      </p>
      <p className="note"><a href="/">← Til boligsøgningen</a></p>
    </div>
  )
}
