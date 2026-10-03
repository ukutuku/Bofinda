// Aendrer appens egen where-klausul uden at regenerere maalingen.
//
// Det er ikke en opdigtet fejl: leddet herunder er en RIMELIG aendring
// — koeen skal vel ikke baere afmeldte soegninger. Pointen er, at
// scripts/maal-alarmkoe.sql saa maaler en anden koe end den, alarmen
// sender fra, uden at nogen har rettet i filen. Det var hele grunden
// til at generere halen i stedet for at skrive den af.
//
// Proeven skal blive roed i scripts/test-alarmkoe-sql.ts' afsnit 1
// (drift), 2 (filens udfoerbare indhold) og 3 (forlaegget) — men IKKE i
// 4 (krydstjekket). Det er rigtigt: krydstjekket maaler enighed mellem
// koden og maalingen, og mutationen flytter dem sammen.
//
// ── HOLDEPUNKTET BLEV RETTET, OG GRUNDEN HOERER HER ──────────
// Foerst stod der `export function ventendeForespoergsel`. Den staar 37
// linjer fra traefferen, og koererens vagt 4 kraever 15. Erklaeringen
// var altsaa FALSK om koden, og den blev aldrig prøvet, fordi den
// stedfortraeder jeg koerte foer #37 landede, kun spurgte om
// holdepunktet fandtes NOGET STED i filen.
//
// `.from(alertMatches)` er valgt frem for en anden naboline, fordi det
// er praecis den klausul, generatorens DELEPUNKT (` from "alert_matches"`)
// klipper paa. Holdepunktet peger dermed paa det, mutationen handler om,
// og ikke blot paa noget i naerheden.
export const forventning = {
  fil: 'lib/alarm.ts',
  moenster: '.where(and(isNull(alertMatches.sentAt), isNotNull(savedSearches.confirmedAt)))',
  traeffere: 1,
  naer: '.from(alertMatches)',
  erstat: '.where(and(isNull(alertMatches.sentAt), isNotNull(savedSearches.confirmedAt),'
    + ' isNull(savedSearches.unsubscribedAt)))',
}
