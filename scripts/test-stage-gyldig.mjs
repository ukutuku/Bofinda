// Resolutionens validering skal styre staging.
// gruppe: kerne
// Den rigtige shell-port proeves i sit eget midlertidige git-repo.
import { spawnSync } from 'node:child_process'
const r = spawnSync('bash', ['scripts/stage-gyldig.sh', '--modproev'], { stdio: 'inherit' })
if (r.error) throw r.error
if (r.signal) throw new Error(`Portproeven blev afbrudt: ${r.signal}`)
process.exit(r.status ?? 1)
