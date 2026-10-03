// Rangeringens billedled vendt: færrest billeder vinder. D1/D2 skal bruge
// appens EGEN repræsentant, så den tabte bolig skal skifte.
export const forventning = {
  fil: 'lib/soeg.ts',
  moenster: '${UNIKKE_BILLEDER} desc,',
  traeffere: 1,
  naer: 'partition by ${DEDUPNOEGLE}',
  erstat: '${UNIKKE_BILLEDER} asc,',
}
