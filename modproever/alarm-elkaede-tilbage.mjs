// Saetter el-oversaettelsen tilbage til ternaerkaeden med fald-igennem.
// Den er GROEN i dag for alle fire tilstande — fejlen er, at en femte
// vaerdi tavst faar «el indgaar ikke». Modproeven maa derfor ikke bare
// gendanne kaeden; den skal gendanne den med den FORKERTE
// fald-igennem, saa en af de nuvaerende fire rammer den.
//
// Det er en bevidst skaerpelse: en modproeve, der kun gendannede den
// gamle form, ville blive GROEN — og dermed sige, at proeven ikke maaler
// noget. Den maaler bindingen; den her maaler, at teksten FOELGER
// tilstanden.
export const forventning = {
  fil: 'lib/alarm.ts',
  moenster: 'const elnote = t == null ? null : ELTEKST[t]',
  traeffere: 1,
  naer: 'eltilstand(b)',
  erstat: `const elnote = t == null || t === 'med' ? null
        : t === 'egen-maaler' ? 'el afregnes direkte med elselskabet'
          : 'el indgår ikke — udlejer oplyser ikke hvordan'`,
}
