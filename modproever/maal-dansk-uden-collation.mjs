// dansk() uden collation. Målingens «vinder_dansk» skal følge med — også i
// testbasen, hvor attrappen sorterer anderledes end C.
export const forventning = {
  fil: 'lib/soeg.ts',
  moenster: 'export const dansk = (udtryk: SQL | AnyColumn) => sql`${udtryk} collate "da-x-icu"`',
  traeffere: 1,
  erstat: 'export const dansk = (udtryk: SQL | AnyColumn) => sql`${udtryk}`',
}
