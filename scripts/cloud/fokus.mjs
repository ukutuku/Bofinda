// ═══════════════════════════════════════════════════════════════
//  Fælles værktøj til at måle FORLØB frem for resultater.
//
//  Delt af scripts/cloud/bladrekontrol.mjs (søgeresultater) og
//  scripts/cloud/minsidekontrol.mjs (Gemte boliger). De to flader
//  stiller det samme spørgsmål — «hvor står fokus, og hvad har ruten
//  svaret indtil nu?» — og to afskrifter af svaret ville drive fra
//  hinanden, præcis som projektets egen regel siger.
// ═══════════════════════════════════════════════════════════════

const vent = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Så længe holdes hvert svar efter det første tilbage.
 *
 * Forsinkelsen er ikke pynt. Uden den er hentningen forbi, før prøven
 * kan nå at se på noget, og så kan den kun måle et RESULTAT. Kravene
 * her handler om forløbet: at «Prøv igen» bliver stående og beholder
 * fokus, MENS der hentes. Det findes kun i ventetiden.
 */
export const FORSINKELSE = 1500

/**
 * Så længe er et «langsom»-svar undervejs.
 *
 * Godt over den almindelige forsinkelse og langt under `HENTEFRIST`
 * (20 s) i app/Billedbladring.tsx. Tallet skal blive ved med at ligge
 * imellem de to: rykker grænsen, skal det her følge med, ellers måler
 * prøven ikke længere det, den siger.
 */
export const LANGSOMT = 6000

/**
 * En rute med et SCRIPTET og FORSINKET svar på /api/boligbilleder.
 *
 * `svar` er ét ord pr. kald, og det sidste ord gælder alle senere kald:
 *
 *   'fejl'  503 — ruten svarede ikke. Fejltilstand.
 *   'ok'    rutens rigtige svar slipper igennem.
 *   'tom'   200 med ÉT billede: ruten svarede, og der er ikke mere at
 *           bladre i. Ikke en fejl — men hele feltet forsvinder, og det
 *           er dét tilfælde, fokus ellers ville falde til <body> i.
 *   'langsom' svaret kommer, men er længe undervejs. Grænsen skelner
 *           ikke af sig selv mellem «svarer aldrig» og «er langsom», og
 *           det er dét skel, en prøve skal kunne se.
 *   'haeng' forbindelsen tages imod, og der kommer aldrig et svar.
 *           Hverken en succes eller en fejl — det udfald, `HENTEFRIST`
 *           i app/Billedbladring.tsx findes for at gøre til en fejl,
 *           brugeren selv kan svare på.
 *
 * Det FØRSTE kald svarer straks, så fejltilstanden er hurtigt på plads;
 * hvert senere kald holdes tilbage.
 *
 * Alt sker i browseren. Hverken appen eller basen røres.
 */
export async function scriptetRute(side, svar) {
  const t = { kald: 0 }
  await side.route('**/api/boligbilleder*', async (rute) => {
    const i = t.kald++
    if (i > 0) await vent(FORSINKELSE)
    const hvad = svar[Math.min(i, svar.length - 1)]
    try {
      // Der svares ALDRIG. Ruten holdes bare åben.
      if (hvad === 'haeng') return
      // Længe undervejs, men inden for HENTEFRIST i app/Billedbladring.tsx.
      if (hvad === 'langsom') await vent(LANGSOMT)
      if (hvad === 'fejl') return await rute.fulfill({ status: 503, body: 'nej' })
      if (hvad === 'tom') {
        return await rute.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ billeder: [{ lille: '/api/billede?x', stor: null }] }),
        })
      }
      return await rute.continue()
    } catch { /* siden er lukket eller navigeret — svaret er ligegyldigt nu */ }
  })
  return t
}

/**
 * Hvor står fokus, og på hvilket kort?
 *
 * Kortet aflæses af rodens egen indgang — `a.kort` på søgesiden,
 * `a.adresse` på Gemte boliger — så en prøve ikke kan nøjes med at se,
 * at fokus ligger på «en» pil: den skal ligge på det RIGTIGE korts.
 * `(body)` er det svar, hele forløbet findes for at udelukke.
 */
export const fokusinfo = (side) => side.evaluate(() => {
  const a = document.activeElement
  if (!a || a === document.body) return { klasse: '(body)', kort: null, busy: null }
  const rod = a.closest('.kort-hylster, .gemt-kort')
  const indgang = rod ? rod.querySelector('a.kort, a.adresse') : null
  return {
    klasse: String(a.className || a.tagName.toLowerCase()),
    kort: indgang ? (indgang.id || indgang.getAttribute('href')) : null,
    busy: a.getAttribute('aria-busy'),
  }
})
