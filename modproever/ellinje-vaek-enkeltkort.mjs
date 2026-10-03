// Fjerner ENKELTKORTETS el-linje. En groen total kan saa staa uden at el
// er gjort rede for — det, CLAUDE.md forbyder.
//
// `traeffere: 2` er ikke pynt: der ER to el-linjer i filen, én pr.
// korttype. Erklaeringen er dét, der gjorde den foerste udgave af denne
// fil forkert: den paastod gruppekortet, moenstret var ikke-grebigt, og
// den ramte enkeltkortet. Vagt 2 saa det ikke — mutationen gjorde noget,
// bare ikke det, den sagde.
export const forventning = {
  fil: 'app/Boligkort.tsx',
  moenster: /<Ellinje tilstand=\{[\s\S]*?\} \/>/,
  traeffere: 2,
  vaelg: 0,
  naer: 'eltilstand(',
  erstat: '',
}
