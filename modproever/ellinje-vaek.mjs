// Fjerner den FOERSTE el-linje i Boligkort.tsx — altsaa enkeltkortets.
// En GROEN total kan saa staa uden at el er gjort rede for, praecis det
// CLAUDE.md forbyder.
//
// Moenstret er med vilje ikke-grebigt og rammer derfor det foerste af de
// to korttyper. Det er nok til at vise, at vagten fyrer; skal GRUPPEkortet
// muteres, hoerer det i sin egen fil, saa hver modproeve siger praecis,
// hvad den bryder.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const rod = process.argv[2]
const p = join(rod, 'app/Boligkort.tsx')
const s = readFileSync(p, 'utf8')
const gl = /\n\s*<Ellinje tilstand=\{[\s\S]*?\} \/>/
if (!gl.test(s)) { console.error('mutation: el-linjen i Gruppekort blev ikke fundet'); process.exit(1) }
writeFileSync(p, s.replace(gl, ''))
console.log('mutation: enkeltkortets el-linje fjernet')
