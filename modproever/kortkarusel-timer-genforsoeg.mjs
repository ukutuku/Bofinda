// K14 i en tredje skikkelse: efter en fejl prøver kortet SELV igen 5 s
// senere. Det er det «automatiske retry», bestillingen forbyder — og det
// ses ikke i et vindue på nogle sekunders rigtig tid, for når timeren
// fyrer, har det næste eksplicitte tryk ofte gemt en vellykket liste.
// `kortkarusel.mjs` skal være rød på [K14] i scenariet «falsk ur», der
// spoler 10 minutter frem.
export const forventning = {
  fil: 'app/KortBilleder.tsx',
  moenster: 'setFejl(true)',
  traeffere: 1,
  naer: 'setBesked(FEJLTEKST)',
  naerVindue: 2,
  erstat: 'setFejl(true); window.setTimeout(() => { void hent() }, 5000)',
}
