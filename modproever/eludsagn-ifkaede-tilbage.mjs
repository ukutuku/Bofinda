// Saetter `elUdsagn` tilbage til if-kaeden med `return null` som
// fald-igennem. Som med el-kaeden i alarmmailen er den GAMLE form
// korrekt for alle fire tilstande i dag — saa modproeven gendanner den
// med en MANGLENDE gren, saa en af de nuvaerende fire rammer `null`.
//
// Det er netop den udgang, der er usynlig: `null` bliver en tom streng i
// den genererede beskrivelse, saa forbeholdet forsvinder uden spor.
export const forventning = {
  fil: 'lib/grundlag.ts',
  moenster: "  return el == null ? null : ELUDSAGN[el]",
  traeffere: 1,
  naer: 'export function elUdsagn',
  erstat: `  if (el === 'egen-maaler') return 'el betaler du selv til elselskabet'
  if (el === 'ikke-med') return 'el kommer oveni'
  return null`,
}
