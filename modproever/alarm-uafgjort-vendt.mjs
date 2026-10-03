// To lige gamle afgøres omvendt. Ordenen er stadig deterministisk, men ikke
// den, koden lover — og prøven skal se forskellen, ikke bare stabiliteten.
export const forventning = {
  fil: 'lib/alarm.ts',
  moenster: 'return ia < ib ? -1 : ia > ib ? 1 : 0',
  traeffere: 1,
  erstat: 'return ia < ib ? 1 : ia > ib ? -1 : 0',
}
