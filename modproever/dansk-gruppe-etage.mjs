// Gruppesidens adresser uden dansk collation på `floor`. Rød mod en base med
// rigtige ICU-data (npm run test:prod); sprunget over i npm test.
export const forventning = {
  fil: 'lib/soeg.ts',
  moenster: 'asc(dansk(listings.floor)),',
  traeffere: 1,
  naer: 'regexp_replace(coalesce(${listings.houseNumber}',
  erstat: 'asc(listings.floor),',
}
