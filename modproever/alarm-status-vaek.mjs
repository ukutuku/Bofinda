// Fjerner status-filteret i afsendelsesvejen. Mailen varsler saa igen
// en bolig, vi selv har bogfoert som taget ned — det usande udsagn, der
// lander uopfordret i en indbakke.
//
// Praedikatet er `maaMailes` og ikke laengere `kunAktive`: mutationen
// er flyttet med, for en modproeve, der peger paa en linje, der ikke
// findes, er ikke en groen modproeve — den er ingen modproeve.
export const forventning = {
  fil: 'lib/alarm.ts',
  moenster: "(b: { status: string }): boolean => b.status === 'active'",
  traeffere: 1,
  naer: 'export const maaMailes',
  erstat: '(b: { status: string }): boolean => Boolean(b.status)',
}
