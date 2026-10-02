// ═══════════════════════════════════════════════════════════════
//  gruppe: kerne/2
//  Billedkontrollen og test-kæden som én prøvefil.
//
//  Den håndskrevne kæde i package.json når billedkontrollen gennem
//  "proev:billedkontrol". En kæde udledt af filerne (scripts/proever.ts,
//  #49) læser ikke package.json, men finder hver test-*.ts i repoet og
//  kører den i den gruppe, mærket ovenfor siger. Denne fil er det, der
//  bringer billedkontrollen med dertil — uden at nogen skal rette en linje,
//  der konflikterer. Den kører det samme som "proev:billedkontrol".
//  Se docs/designforslag/FLETNING.md.
// ═══════════════════════════════════════════════════════════════
import { spawnSync } from 'node:child_process'

for (const [fil, ...args] of [['proev-billedkontrol.mjs'], ['proev-testkaede.mjs', '--selvproeve']]) {
  const r = spawnSync(process.execPath, [new URL(`./${fil}`, import.meta.url).pathname, ...args], { stdio: 'inherit' })
  if (r.status !== 0) { process.exitCode = r.status ?? 1; break }
}
