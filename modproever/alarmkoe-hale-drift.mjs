// Aendrer appens egen where-klausul uden at regenerere maalingen.
//
// Det er ikke en opdigtet fejl: leddet herunder er en RIMELIG aendring
// — koeen skal vel ikke baere afmeldte soegninger. Pointen er, at
// scripts/maal-alarmkoe.sql saa maaler en anden koe end den, alarmen
// sender fra, uden at nogen har rettet i filen. Det var hele grunden
// til at generere halen i stedet for at skrive den af.
//
// Proeven skal blive roed i afsnit 1 (drift) og 2 (filens indhold).
export const forventning = {
  fil: 'lib/alarm.ts',
  moenster: '.where(and(isNull(alertMatches.sentAt), isNotNull(savedSearches.confirmedAt)))',
  traeffere: 1,
  naer: 'export function ventendeForespoergsel',
  erstat: '.where(and(isNull(alertMatches.sentAt), isNotNull(savedSearches.confirmedAt),'
    + ' isNull(savedSearches.unsubscribedAt)))',
}
