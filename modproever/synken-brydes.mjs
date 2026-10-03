// Bryder SYNKEN mellem de to korttyper: gruppekortets vagt mister
// `!n.total ||`, saa en gruppe UDEN kendt total viser el-linjen, mens
// enkeltkortet stadig lader vaere.
//
// Det er praecis den fejl, der stod paa 47 gruppekort — og den, CLAUDE.md
// kalder den dyreste: to udtryk for ét spoergsmaal, hvor begge ser
// rigtige ud hver for sig.
export const forventning = {
  fil: 'app/Boligkort.tsx',
  moenster: '!n.total || !g.nogenUdenEl ? null',
  traeffere: 1,
  naer: 'Gruppenoegle.total',
  erstat: '!g.nogenUdenEl ? null',
}
