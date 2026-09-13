// ═══════════════════════════════════════════════════════════════
//  Hvor hurtigt en ny bolig når frem — ét sted, to tilstande.
//
//  Punktet lå i `page.tsx` og sagde «Hver time henter vi nye boliger fra
//  kilderne», hver gang `minutterP90` var null. Det er et ubetinget
//  løfte, sat præcis dér, hvor vi har mindst at have det i: null betyder,
//  at INGEN bolig opfylder målingens grundlag — kilden oplyser ingen
//  oprettelsesdato, eller kilden har ikke været overvåget et døgn endnu.
//  At love en kadence i den tilstand er at sige noget, målingen ikke kan
//  bekræfte, og det er den samme fejl som en total, der lader som om
//  aconto er kendt.
//
//  Importen kan udmærket køre hver time — den gjorde det også, mens
//  linjen stod der. Men de tre punkter på forsiden er BEVIS, målt på
//  bestanden. Et fjerde, der kom fra en kalender, hører ikke hjemme
//  mellem dem, og læseren kan ikke se forskel.
//
//  Målingen selv er urørt: `forsidetal()` i `lib/soeg.ts` regner p90 på
//  det samme grundlag med den samme døgngrænse pr. kilde. Det er kun
//  visningen af et null-svar, der er lavet om.
//
//  Komponenten ligger i sin egen fil, fordi den skal kunne gengives af en
//  prøve uden at rejse hele forsiden. Den rører hverken database, cookies
//  eller `headers()`.
// ═══════════════════════════════════════════════════════════════

/**
 * Det tredje punkt i hero'ens punktliste.
 *
 * @param minutterP90 `forsidetal().minutterP90` — målt p90 i minutter,
 *   eller null, når der ikke er grundlag for at måle.
 */
export function Hastighedspunkt({ minutterP90 }: { minutterP90: number | null }) {
  // Ingen måling, ingen påstand. Feltet bliver stående og siger, hvad der
  // mangler — samme regel som prisblokkens «Udlejer oplyser ikke aconto»:
  // en manglende oplysning skal være synlig, ikke fraværende. Der står
  // hverken en kadence, et interval eller et «snart».
  if (minutterP90 == null) {
    return (
      <li>
        <strong className="ord">Ikke opgjort</strong>
        <span>hvor hurtigt nye boliger når frem</span>
      </li>
    )
  }

  // Over en time skifter vi ENHED, ikke påstand. Der må aldrig stå noget
  // kortere, end vi har målt. Ordret som før — det målte tal, ikke en
  // afrunding af det: «57 min.» er så præcist, at ingen ville opdigte
  // det, mens «under en time» er et løfte.
  const timer = (minutterP90 / 60).toLocaleString('da-DK', { maximumFractionDigits: 1 })
  return (
    <li>
      <strong>
        {minutterP90 <= 60
          ? <>{minutterP90} <span className="enhed">min.</span></>
          : <>{timer} <span className="enhed">{timer === '1' ? 'time' : 'timer'}</span></>}
      </strong>
      <span>fra en bolig annonceres, til den står her (9 ud af 10)</span>
    </li>
  )
}
