// ═══════════════════════════════════════════════════════════════
//  Kvitteringens format og prædikatets version — ét sted, læst af både
//  vagten (hero-maal.mjs › kvitter) og kontrollen (kontroller-billeder.mjs).
//  Ingen afhængigheder: kontrollen kører i npm test uden browser og app.
// ═══════════════════════════════════════════════════════════════

export const KVITTERING = '.billedkontrol.jsonl'

/**
 * EN KVITTERING ER EN DOM, OG EN DOM GÆLDER UNDER DEN REGEL, DER FÆLDEDE
 * DEN. Filens SHA-256 siger, hvilke bytes vagten så; versionen siger, hvad
 * vagten dengang spurgte om. Uden versionen ville en kvittering fra en
 * ældre, svagere regel stadig godkende et billede, den nuværende regel
 * afviser — stiltiende fredning. Kontrollen godkender derfor KUN
 * kvitteringer udstedt under den nuværende version.
 *
 * `aftryk` er SHA-256 af fremmedeBilleder's kildetekst. Kontrollen nægter
 * at køre, hvis prædikatet er ændret, uden at versionen er hævet — så en
 * ændring kan ikke glemme at gøre gamle kvitteringer ugyldige. Også en
 * kosmetisk ændring kræver et nyt nummer; det er prisen for, at ingen skal
 * afgøre, om en ændring «tæller».
 *
 *   v1  260622d  dom på vært alene; alt uden vært slap igennem
 *   v2  996eef1  tre domme (egen · fremmed · ukendt); data:-raster, blob:,
 *                file: og SVG med raster afvises; mask-image læses
 */
export const PRAEDIKAT = {
  version: 2,
  aftryk: 'a8f6d9982970d7b7219034c35d960c416a069b3e763dc67bc0f8b5fc039929ad',
}
