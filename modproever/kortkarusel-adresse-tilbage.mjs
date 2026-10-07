// Lægger ADRESSELINJEN tilbage på den kompakte front — den første af de
// metadatarækker, kortstramningen fjernede. `kortkarusel.mjs` skal være
// rød på [K1]. Klassen er det fulde korts egen (`adresse`), så det er
// netop den række, der kommer tilbage, ikke en opdigtet.
//
//   node scripts/modproeve.mjs modproever/kortkarusel-adresse-tilbage.mjs -- <trin> K1
export const forventning = {
  fil: 'app/Boligkort.tsx',
  moenster: '{kortTitel(b.type, b.vaerelser, b.areal != null ? String(b.areal) : null)}',
  traeffere: 1,
  naer: "className=\"kort-overskrift\"",
  naerVindue: 3,
}
export default function muter(indhold, fund, vaelg) {
  const slut = indhold.indexOf('</h3>', fund[vaelg].index) + '</h3>'.length
  return indhold.slice(0, slut) + '\n            <p className="adresse">{b.adresse}</p>' + indhold.slice(slut)
}
