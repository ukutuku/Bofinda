// gruppe: kerne
// Kører kortkontrollens faktiske sidste blok mod migrationsskemaet i PGlite.
// Browseren er en fejlattrap: prøven måler SQL og oprydning, ikke layout.
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import ts from 'typescript'
import { PGlite } from '@electric-sql/pglite'
import { stubSupabase, koerMigrationer } from './pglite-skema.mjs'

const kilde = readFileSync('scripts/cloud/kortkontrol.mjs', 'utf8')
const ast = ts.createSourceFile('kortkontrol.mjs', kilde, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const blokke = ast.statements.filter((s): s is ts.IfStatement => ts.isIfStatement(s)
  && s.expression.getText(ast) === 'process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL')
if (blokke.length !== 1) throw new Error(`Forventede én såningsblok, fandt ${blokke.length}`)
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const koer = new AsyncFunction('aabnIsoleretEllerStop', 'randomUUID', 'br', 'APP', 'BREDDER',
  'blok', 'prøve', 'UD', 'process', 'console', blokke[0]!.getText(ast))

const pg = await PGlite.create()
await stubSupabase(pg)
await koerMigrationer(pg)
await pg.exec(`insert into sources (slug, name, source_type) values ('test-alfa', 'Test', 'spider')`)
let fejl = 0
function tjek(navn: string, ok: boolean) {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}`)
  if (!ok) fejl++
}

try {
  for (const scenarie of ['normal', 'andet-billede', 'browserstart', 'navigation']) {
    await pg.exec(`truncate listings cascade;
      insert into listings (source_id, source_type, external_key, source_url, address_raw)
      select id, 'spider', 'fremmed', 'https://eksempel.invalid/fremmed', 'Bevar mig'
      from sources where slug = 'test-alfa'`)
    let billeder = 0, sluttet = false, observeret = '', saetVedBrowser = 0
    const sql = Object.assign(async (strenge: TemplateStringsArray, ...vaerdier: unknown[]) => {
      const query = strenge.reduce((s, del, i) => s + (i ? `$${i}` : '') + del, '')
      if (/insert into listing_images/.test(query) && ++billeder === 2 && scenarie === 'andet-billede') {
        throw new Error(scenarie)
      }
      return (await pg.query(query, vaerdier)).rows
    }, { array: (v: unknown[]) => v, end: async () => { sluttet = true } })
    const browser = { newContext: async () => {
      const r = await pg.query<{ n: number }>("select count(*)::int as n from listings where external_key <> 'fremmed'")
      saetVedBrowser = r.rows[0]!.n
      if (scenarie === 'browserstart') throw new Error(scenarie)
      return {
        close: async () => {},
        newPage: async () => ({
          goto: async () => { if (scenarie === 'navigation') throw new Error(scenarie) },
          getByRole: () => ({ count: async () => 0 }),
        }),
      }
    } }
    try {
      await koer(async () => sql, randomUUID, browser, 'http://127.0.0.1:3100', [],
        undefined, undefined, null, { env: { DATABASE_URL_DIRECT: 'attrap' } }, { log() {}, error() {} })
    } catch (e) { observeret = (e as Error).message }
    const r = await pg.query<{ egne: number; fremmede: number; billeder: number }>(`
      select (select count(*)::int from listings where external_key <> 'fremmed') as egne,
        (select count(*)::int from listings where external_key = 'fremmed' and address_raw = 'Bevar mig') as fremmede,
        (select count(*)::int from listing_images) as billeder`)
    const n = r.rows[0]!
    tjek(`${scenarie}: det tilsigtede forløb blev nået`, scenarie === 'normal'
      ? observeret === '' && saetVedBrowser === 2 : observeret === scenarie)
    tjek(`${scenarie}: egne rækker og billeder fjernet (${n.egne}/${n.billeder})`, n.egne === 0 && n.billeder === 0)
    tjek(`${scenarie}: fremmed række bevaret`, n.fremmede === 1)
    tjek(`${scenarie}: forbindelsen afsluttet`, sluttet)
  }
} finally { await pg.close() }
console.log(fejl ? `${fejl} FEJL` : 'ALT GRØNT — SQL og oprydning, ikke browserlayout')
process.exitCode = fejl ? 1 : 0
