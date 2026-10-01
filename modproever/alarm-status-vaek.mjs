// Fjerner status-filteret i afsendelsesvejen. Mailen varsler saa igen
// en bolig, vi selv har bogfoert som taget ned — det usande udsagn, der
// lander uopfordret i en indbakke.
export const forventning = {
  fil: 'lib/alarm.ts',
  moenster: "  g.filter((b) => b.status === 'active')",
  traeffere: 1,
  naer: 'export const kunAktive',
  erstat: '  g.slice()',
}
