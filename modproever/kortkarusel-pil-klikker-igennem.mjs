// Pilene modtager ikke længere klikket: det falder igennem til kortlinket
// nedenunder og åbner annoncen. Den realistiske vej tilbage til «pilen
// navigerer» — en CSS-ændring, ikke en omstrukturering. `kortkarusel.mjs`
// skal være rød på [K6]; den klikker med musen på pilens plads, netop
// fordi `locator.click()` ville vente på knappen og skjule fejlen.
export const forventning = {
  fil: 'app/globals.css',
  moenster: 'pointer-events: auto; position: absolute; top: 50%',
  traeffere: 1,
  naer: '.kb-pil {',
  naerVindue: 2,
  erstat: 'pointer-events: none; position: absolute; top: 50%',
}
