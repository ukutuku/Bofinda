// Inde i mailen: ældste træf øverst i stedet for nyeste.
export const forventning = {
  fil: 'lib/alarm.ts',
  moenster: '.orderBy(desc(alertMatches.matchedAt), alertMatches.id)',
  traeffere: 1,
  erstat: '.orderBy(alertMatches.matchedAt, alertMatches.id)',
}
