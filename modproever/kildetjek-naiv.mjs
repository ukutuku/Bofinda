// Modproeve: erstat skanneren med den NAIVE stripper — de to
// `.replace()`, der stod ni steder foer `kildelag()` fandtes.
//
// Den fejler praecis der, hvor den altid har fejlet: en `//` inde i en
// streng aabner en kommentar, og resten af linjen forsvinder. Prøven
// skal blive roed, ellers maaler den ikke det, den siger.
export const forventning = {
  fil: 'scripts/kildetjek.ts',
  moenster: '  if (kun === \'alt\') return tekst\n  const lag = lagvis(tekst)',
  traeffere: 1,
  naer: 'export function kildelag',
  erstat: `  if (kun === 'alt') return tekst
  if (kun === 'kode') {
    return tekst.replace(/\\/\\*[\\s\\S]*?\\*\\//g, '').replace(/^\\s*\\/\\/.*$/gm, '')
  }
  const lag = lagvis(tekst)`,
}
