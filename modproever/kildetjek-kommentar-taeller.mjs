// Modproeve: lad 'kode' beholde kommentarerne. Det er fejlen fra
// `/tilbud === null/` og fra `beslutning.ts`' eksempel-import, sat ind
// med vilje: et kildetjek ville saa kunne blive groent af nogens note.
export const forventning = {
  fil: 'scripts/kildetjek.ts',
  moenster: "    : (l: Lag) => l !== 'kommentar'",
  traeffere: 1,
  naer: 'const beholdes',
  erstat: '    : (_l: Lag) => true',
}
