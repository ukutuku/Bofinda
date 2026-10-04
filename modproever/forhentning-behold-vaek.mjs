// Modproeve: skiftet afbryder ogsaa det billede, der NU vises. Saa
// afbrydes den hentning, browserens <img> deler, og det nye hovedbillede
// hentes forfra. scripts/test-galleri-forhentning.ts skal blive roed.
export const forventning = {
  fil: 'app/bolig/[id]/forhentning.ts',
  moenster: '      if (h.url === behold) { tilbage.push(h); continue }\n',
  traeffere: 1,
  naer: 'const afbryd = (behold?: string) => {',
  erstat: '',
}
