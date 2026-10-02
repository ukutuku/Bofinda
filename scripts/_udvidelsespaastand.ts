// Påstanden, der køres under en muteret lib/faciliteter.ts. Se
// scripts/proev-facilitetsudvidelse.mjs. Filen er bevidst lille: den
// må ikke kende det nye begrebs NAVN på andet end miljøet.
import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import { FACILITETSNAVN, FACILITETSNOEGLER } from '../lib/faciliteter'
import {
  facetter, facilitetsgrundlag, filtreFraParametre, harFiltre, hvor,
  opsummering, tavseKilder, udenFacilitetsfiltre,
} from '../lib/soeg'
import { beskrivFiltre } from '../lib/alarm'
import { aktiveFiltre } from '../lib/filterpanel'

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}
const NY = process.env.NYT_BEGREB!
const ORD = process.env.NYT_ORD!

console.log('\n══ det nye begreb er med overalt, uden at nogen rørte stederne ══')
tjek('FACILITETSNOEGLER kender det', FACILITETSNOEGLER.includes(NY as never),
  FACILITETSNOEGLER.join(', '))
tjek('… og det har et navn', FACILITETSNAVN[NY as never] === ORD)

// Én kilde, to boliger: den ene med det nye ord, den anden med intet.
//
// `address_match_level` er 'access' og ikke default 'failed': `hvor()`
// udelukker 'failed', saa rækkerne ville ellers være usynlige og hver
// påstand grøn af den forkerte grund. Og 'access' frem for 'unit', fordi
// check-constrainten `listing_address_level_honest` kræver den matchende
// uuid — basen håndhæver, at niveauet er sandt.
await db.execute(sql`insert into sources (id, slug, name, source_type) values
  ('11111111-0000-0000-0000-0000000000f1', 'udvidelse', 'Udvidelseskilde', 'spider')`)
await db.execute(sql`insert into listings
  (id, source_id, source_type, external_key, source_url, address_raw,
   postal_code, city, status, address_match_level, access_address_uuid,
   amenities) values
  ('44444444-0000-0000-0000-0000000000f1', '11111111-0000-0000-0000-0000000000f1',
   'spider', 'u1', 'https://proeve.invalid/u1', 'Nyvej 1, 2300', '2300',
   'København S', 'active', 'access', 'intern:v3:2300:nyvej:1',
   ${JSON.stringify([ORD])}::jsonb),
  ('44444444-0000-0000-0000-0000000000f2', '11111111-0000-0000-0000-0000000000f1',
   'spider', 'u2', 'https://proeve.invalid/u2', 'Nyvej 2, 2300', '2300',
   'København S', 'active', 'access', 'intern:v3:2300:nyvej:2', '[]'::jsonb)`)

const F = { postnr: '2300' }

// 1 · FILTERET. `hvor()` skal kunne udtrykke det.
const medKryds = await db.execute(sql`select count(*)::int as n from listings
  inner join sources on sources.id = listings.source_id
  where ${hvor({ ...F, [NY]: true } as never)}`)
const n = Number((Array.isArray(medKryds) ? medKryds : (medKryds as { rows: Record<string, unknown>[] }).rows)[0]!.n)
tjek('hvor() filtrerer på det nye begreb', n === 1, `${n} bolig(er)`)

// 2 · AGGREGATET i facetter — afgør om afkrydsningen overhovedet VISES.
const fa = await facetter()
tjek('facetter().faciliteter har nøglen', NY in fa.faciliteter,
  Object.keys(fa.faciliteter).join(', '))
tjek('… og tæller boligen', Number((fa.faciliteter as Record<string, number>)[NY]) === 1)

// 3 · GRUNDLAGSLINJEN. CLAUDE.md kræver tre grupper under hver afkrydsning.
const g = await facilitetsgrundlag({ ...F, [NY]: true } as never)
const oplyser = Number((g as unknown as Record<string, number>)[NY])
tjek('grundlaget har nøglen', NY in (g as object), '')
tjek('… og linjens tre grupper går op',
  oplyser === 1 && g.antal === 2 && g.tier === 1
  && g.antal - g.tier - oplyser === 0,
  `oplyser ${oplyser} · andre ${g.antal - g.tier - oplyser} · tier ${g.tier} = ${g.antal}`)

// 4 · NULSTILLINGEN. Grundlaget måles UDEN facilitetsfiltrene.
tjek('udenFacilitetsfiltre nulstiller det nye begreb',
  (udenFacilitetsfiltre({ ...F, [NY]: true } as never) as Record<string, unknown>)[NY] === false)
const sum = await opsummering({ ...F, [NY]: true } as never)
tjek('opsummering MED krydset viser 1', sum.antal === 1, `${sum.antal}`)

// 5 · tavseKilder — linjen om de kilder, der forsvinder helt.
const tk = await tavseKilder({ ...F, [NY]: true } as never)
tjek('tavseKilder svarer på en søgning med det nye kryds',
  typeof tk.antal === 'number' && Array.isArray(tk.navne),
  `${tk.antal} boliger · ${tk.navne.length} kilde(r)`)

// 6 · URL'en ind og ud, filterchippen, og alarmens filterlinje.
tjek('parameteren læses tilbage',
  (filtreFraParametre({ [NY]: '1' }) as Record<string, unknown>)[NY] === true)
tjek('harFiltre ser krydset alene som et filter',
  harFiltre({ [NY]: true } as never))
tjek('filterchippen nævner det',
  aktiveFiltre({ [NY]: true } as never).some((c) => c.navn === ORD),
  aktiveFiltre({ [NY]: true } as never).map((c) => c.navn).join(', '))
// Mailen har sit EGET, kortere ordforraad (`FILTERORD` i lib/alarm.ts),
// bundet med `satisfies`. Et nyt begreb er derfor en OVERSAETTERFEJL dér
// — og det er den ene ting, en udvidelse skal tvinge et menneske til at
// vaelge. Paastanden er altsaa ikke, at mailen gaetter et ord: den er, at
// linjen stadig NAEVNER filteret frem for at skrive «undefined» i en
// fremmeds indbakke, indtil nogen har valgt ordlyden.
{
  const linje = beskrivFiltre({ [NY]: true })
  tjek('alarmens filterlinje nævner filteret', linje.includes(ORD), linje)
  tjek('… og skriver ALDRIG «undefined»', !linje.includes('undefined'), linje)
}

console.log(fejl === 0 ? '\n  ALT GRØNT\n' : `\n  ${fejl} FEJL\n`)
process.exitCode = fejl === 0 ? 0 : 1
