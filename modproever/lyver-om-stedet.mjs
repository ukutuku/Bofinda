// Med vilje en mutation, der RAMMER noget, men paastaar et holdepunkt, der
// ikke staar i naerheden — altsaa praecis det uheld, der skete i S4. Vagt 4
// skal afvise den, og vagt 2 ville ikke have gjort det.
export const forventning = {
  fil: 'app/Boligkort.tsx',
  moenster: /<Ellinje tilstand=\{[\s\S]*?\} \/>/,
  traeffere: 2,
  vaelg: 0,                      // enkeltkortets
  naer: 'Gruppenoegle.total',    // … men paastaar gruppekortets holdepunkt
  erstat: '',
}
