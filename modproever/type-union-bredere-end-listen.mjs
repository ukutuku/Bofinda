// Typen får en værdi, listen ikke har — den oprindelige fejl. Afsenderen
// må nu sende 'sms', og rens() ville kassere hele eventet.
export const forventning = {
  fil: "lib/maaling.ts",
  moenster: "export interface KontaktklikProps { maal: Kontaktmaal }",
  traeffere: 1,
  erstat: "export interface KontaktklikProps { maal: Kontaktmaal | 'sms' }",
}
