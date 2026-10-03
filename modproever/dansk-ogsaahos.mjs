// Kildenavnene på kortet uden dansk collation. Basens en_US sætter Aalborg
// først. Rød mod en base med rigtige ICU-data (npm run test:prod) — i
// npm test er linjen sprunget over, for testbasen kan ikke sortere dansk.
export const forventning = {
  fil: 'lib/soeg.ts',
  moenster: 'array_agg(distinct ${dansk(sql`s2.name`)} order by ${dansk(sql`s2.name`)})',
  traeffere: 1,
  erstat: 'array_agg(distinct s2.name order by s2.name)',
}
