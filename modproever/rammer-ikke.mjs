// Med vilje en mutation, der IKKE rammer noget — til at proeve vagt 2.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const p = join(process.argv[2], 'app/Boligkort.tsx')
const s = readFileSync(p, 'utf8')
writeFileSync(p, s.replace('DETTE_MOENSTER_FINDES_IKKE_NOGET_STED', 'xx'))
console.log('mutation: moenstret ramte ikke (med vilje)')
