// Listetjekket flyttes FØR personoplysningstjekket. Så bliver en mailadresse
// i et opregnet felt til en «ukendt værdi»: nøglen droppes, og eventet skrives.
export const forventning = {
  fil: "lib/maaling.ts",
  moenster: "      if (farligTekst(v)) return 'pii'\n      if (s.af && !s.af.includes(v)) return 'liste'\n",
  traeffere: 1,
  erstat: "      if (s.af && !s.af.includes(v)) return 'liste'\n      if (farligTekst(v)) return 'pii'\n",
}
