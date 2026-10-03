// Loeger om, hvor mange der blev udeladt. Grenen «alle er taget ned»
// skriver `udeladt: 0` i stedet for antallet, saa kommandofladen og
// importoerens [mail]-linje tier om de boliger, der faldt ud.
//
// Fejlen er stille: `grund` siger stadig «alle N boliger er taget ned»,
// saa en laeser af loggen ser et tal — bare ikke det, der kan taelles.
// Praecis derfor er `udeladt` et FELT og ikke en saetning.
export const forventning = {
  fil: 'lib/alarm.ts',
  moenster: 'antal: 0, udeladt: nedtaget',
  traeffere: 1,
  naer: 'alle ${nedtaget} boliger er taget ned',
  erstat: 'antal: 0, udeladt: 0',
}
