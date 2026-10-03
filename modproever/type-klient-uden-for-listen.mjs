// Browseren sender en værdi, allowlisten ikke kender. Før var `meld()`
// `Record<string, unknown>`: det oversatte, og rens() kasserede klikket.
export const forventning = {
  fil: "app/bolig/[id]/Kontakt.tsx",
  moenster: "meld('contact_click', { maal: 'telefon' }",
  traeffere: 1,
  erstat: "meld('contact_click', { maal: 'sms' }",
}
