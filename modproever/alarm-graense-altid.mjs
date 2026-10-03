// Lader «din graense» fyre paa total == null alene, som foer — altsaa
// paa en soegning uden prisfilter. Brugeren faar et forbehold om en
// graense, hun aldrig satte, og mailen modsiger sin egen filterlinje.
export const forventning = {
  fil: 'lib/alarm.ts',
  moenster: 'overGraense: b.total == null && harGraense }',
  traeffere: 1,
  naer: 'ukendtTotal',
  erstat: 'overGraense: b.total == null }',
}
