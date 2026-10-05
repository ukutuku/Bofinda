// Modproeve: skiftet afbryder ogsaa det billede, der NU vises (og det
// forladte). Saa afbrydes den hentning, browserens <img> deler, og det nye
// hovedbillede hentes forfra. scripts/test-galleri-forhentning.ts skal blive roed.
export const forventning = {
  fil: 'app/bolig/[id]/forhentning.ts',
  moenster: '      if (behold.includes(h.url)) { tilbage.push(h); continue }\n',
  traeffere: 1,
  naer: 'const afbryd = (...behold: (string | undefined)[]) => {',
  erstat: '',
}
