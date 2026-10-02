// Fjerner GRUPPEKORTETS el-linje. Samme fejl som enkeltkortets, men den
// anden korttype — og den, hvor fejlen stod paa 47 kort.
//
// Holdepunktet `Gruppenoegle.total` staar i kommentaren lige over vagten
// og findes kun dér. Det er det, der pinner hvilken af de to traeffere der
// muteres; uden det kunne `vaelg: 1` tavst skifte mening, naar filen
// aendrer sig.
export const forventning = {
  fil: 'app/Boligkort.tsx',
  moenster: /<Ellinje tilstand=\{[\s\S]*?\} \/>/,
  traeffere: 2,
  vaelg: 1,
  naer: 'Gruppenoegle.total',
  erstat: '',
}
