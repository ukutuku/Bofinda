// Ruller kommandofladen tilbage til ordlyden fra FOER filtret.
// Boligen staar som «ikke laengere ledig», og det er sandt — men den
// siger ikke, at den dermed heller ikke mailes. Det er den samme
// halvdel, der manglede, da dataene aendrede sig uden teksten:
// CLAUDE.md's regel om, at de to hoerer til samme commit.
export const forventning = {
  fil: 'scripts/alarm.ts',
  moenster: "(maaMailes(b) ? '' : '  ⚠ IKKE LÆNGERE LEDIG — mailes ikke')",
  traeffere: 1,
  naer: 'min. efter kilden oprettede den',
  erstat: "(b.status === 'delisted' ? '  ⚠ IKKE LÆNGERE LEDIG' : '')",
}
