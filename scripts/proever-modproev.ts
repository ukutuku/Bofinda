// ═══════════════════════════════════════════════════════════════
//  MODPRØVEN FOR OPDAGEREN.
//
//  Reglen i CLAUDE.md: «Kan du ikke faa det roedt ved at indfoere
//  fejlen med vilje, maaler det ikke det, du tror.» Og: indfoer bruddet
//  dér, hvor PRODUKTIONEN laeser — ikke i prøvens eget forlæg.
//
//  Derfor kaldes `blindeImporter`, `graf`, `formFraGraf`, `laesMaerke`
//  og `laegPlan` herunder — de RIGTIGE funktioner — og de to prøver,
//  der handler om kaedens afvisning, lægger en fil i det RIGTIGE repo,
//  saa `findProever` ser den, som den ser alle andre.
//
//  De seks specifikator-former er de maalte raekker fra hovedet i
//  scripts/proever.ts. Hver af dem skal give sit maalte udfald, og de
//  to sidste skal give en AFVISNING — ikke et groent «intet andet».
// ═══════════════════════════════════════════════════════════════

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GULV, blindeImporter, findProever, formFraGraf, graf, gulvposter, laegPlan, laesMaerke } from './proever'

const ROD = fileURLToPath(new URL('..', import.meta.url))
const MAPPE = '.proever-modproev'

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${navn}${note ? `  — ${note}` : ''}\n`)
  if (!ok) fejl++
}
const afsnit = (s: string) => process.stdout.write(`\n══ ${s} ══\n`)

const SAGER = [
  { id: 'a-statisk',       kilde: "import { db } from '../db/client'\nexport const x = () => db\n",
    maa: true,  seerBasen: true,  navn: "import { db } from '../db/client'" },
  { id: 'b-dyn-literal',   kilde: "export const x = async () => (await import('../db/client')).db\n",
    maa: true,  seerBasen: true,  navn: "await import('../db/client')" },
  { id: 'c-skabelon-uden', kilde: 'export const x = async () => (await import(`../db/client`)).db\n',
    maa: true,  seerBasen: true,  navn: 'await import(`../db/client`)  (uden substitution)' },
  { id: 'd-require',       kilde: "export const x = () => require('../db/client').db\n",
    maa: true,  seerBasen: true,  navn: "require('../db/client')" },
  { id: 'e-dyn-variabel',  kilde: "const sti = '../db/client'\nexport const x = async () => (await import(sti)).db\n",
    maa: false, seerBasen: false, navn: 'await import(sti)  ← SKAL AFVISES' },
  { id: 'f-skabelon-med',  kilde: 'export const x = async (n: string) => await import(`../${n}`)\n',
    maa: false, seerBasen: null,  navn: 'await import(`../${n}`)  ← SKAL AFVISES' },
] as const

export async function modproev(): Promise<number> {
  mkdirSync(join(ROD, MAPPE), { recursive: true })
  try {
    afsnit('A · de seks specifikator-former, mod de rigtige funktioner')
    for (const s of SAGER) {
      const fil = `${MAPPE}/${s.id}.ts`
      writeFileSync(join(ROD, fil), s.kilde)
      const blind = blindeImporter(fil, s.kilde)
      tjek(s.navn, s.maa ? blind.length === 0 : blind.length === 1,
        s.maa ? `${blind.length} afvisninger` : (blind[0]?.form ?? 'INGEN afvisning'))
    }

    afsnit('B · og afvisningen er NOEDVENDIG, ikke pynt')
    {
      // Den variable form: grafen SER den ikke, saa afledningen ville
      // sige «ingen base noedvendig» om en fil, der henter databasen.
      // Det er dét, afvisningen er til for — og her er beviset.
      const fil = `${MAPPE}/e-dyn-variabel.ts`
      const f = formFraGraf(await graf(fil))
      tjek('den variable form: afledningen ville vaere USAND (testbase: false)', f.testbase === false)
      const literal = formFraGraf(await graf(`${MAPPE}/b-dyn-literal.ts`))
      tjek('den literale form: afledningen er sand (testbase: true)', literal.testbase === true)
      tjek('… altsaa samme kode, to udfald — kun formen skiller dem',
        f.testbase !== literal.testbase)
    }
    {
      // Skabelonformen: grafen kan slet ikke regnes, og beskeden skal
      // sige HVAD det er i stedet for at lade esbuilds fejl staa.
      let besked = ''
      try { await graf(`${MAPPE}/f-skabelon-med.ts`) } catch (e) { besked = (e as Error).message }
      tjek('skabelonformen: grafen kaster', besked !== '')
      tjek('… og beskeden navngiver glob-eksplosionen', /glob-eksplosionen/.test(besked))
      tjek('… og siger at det ikke er en syntaksfejl', /ikke en syntaksfejl/.test(besked))
    }

    afsnit('C · gruppemaerket')
    tjek('uden maerke → afvist', laesMaerke('// intet her\n').ok === false)
    tjek('ukendt gruppe → afvist', laesMaerke('// gruppe: findesikke\n').ok === false)
    tjek('to maerker → afvist', laesMaerke('// gruppe: kerne\n// gruppe: besked\n').ok === false)
    {
      const m = laesMaerke('// ═══\n// gruppe: kerne\n// tekst\n')
      tjek('gyldigt maerke laeses', m.ok && m.m.gruppe === 'kerne' && m.m.orden === 50)
    }
    {
      const m = laesMaerke('// gruppe: kerne/0\n')
      tjek('orden laeses', m.ok && m.m.orden === 0)
    }
    tjek('maerket under linje 60 ses IKKE',
      laesMaerke(`${'//\n'.repeat(61)}// gruppe: kerne\n`).ok === false)

    afsnit('D · kaeden afviser — maalt gennem den rigtige laegPlan()')
    {
      // Filen lægges i det RIGTIGE repo, saa findProever ser den som
      // enhver anden. Ikke i et forlaeg prøven selv har bygget.
      // En TOM fil: der er ikke engang indhold at baere et maerke i, og
      // den er derfor den skarpeste form. Dagens rebase gav den samme
      // roede paa to RIGTIGE filer — scripts/test-kildetjek.ts og
      // scripts/test-beskrivelse-ved-visning.ts landede paa main uden
      // maerker, og kaeden afviste med exit 1 og navngav dem begge.
      const uden = `${MAPPE}/test-ny.ts`
      writeFileSync(join(ROD, uden), '')
      const p1 = await laegPlan()
      tjek('en tom test-ny.ts uden maerke gør planen roed',
        p1.afvist.some((a) => a.startsWith(uden)),
        p1.afvist.find((a) => a.startsWith(uden)) ?? 'IKKE afvist')
      rmSync(join(ROD, uden))

      const blind = `${MAPPE}/test-blind.ts`
      writeFileSync(join(ROD, blind),
        '// gruppe: kerne\nconst sti = \'../db/client\'\nexport const x = async () => await import(sti)\n')
      const p2 = await laegPlan()
      tjek('en blind import gør planen roed',
        p2.afvist.some((a) => a.startsWith(blind)),
        p2.afvist.find((a) => a.startsWith(blind)) ?? 'IKKE afvist')
      rmSync(join(ROD, blind))

      const p3 = await laegPlan()
      tjek('og uden dem er planen ren', p3.afvist.length === 0,
        p3.afvist.slice(0, 2).join(' | ') || 'ingen afvisninger')
    }

    afsnit('E · gulvet — et antal, der er FALDET, kan sige det selv')
    {
      // Bruddet indfoeres dér, hvor produktionen laeser: en RIGTIG
      // proevefil flyttes ud af gulvet, og den rigtige laegPlan() kaldes.
      // Dot-praefikset gør, at findProever ikke matcher den, og filen
      // bliver liggende i scripts/ — ikke i modproevens egen mappe, som
      // ryddes i det ydre finally. Doer processen midt i, staar den som
      // scripts/.modproev-flyttet-… og kan hentes tilbage med git status.
      // `n` var FØR to spørgsmål i ét: gulvets længde OG antallet af
      // filer, opdageren finder. De er kun ens, så længe ingen har lagt
      // en prøve til siden gulvet blev målt — og gulvets egen note siger
      // udtrykkeligt, at en ny prøve er «additivt gratis». Derfor blev
      // påstanden rød på den FØRSTE PR, der tilføjede en prøvefil, med
      // en besked, der lignede et gulvbrud, mens gulvet var opfyldt.
      // Målt: én mærket attrap-fil på ren main gengav fejlen ordret.
      // De to tal læses nu hver for sig, og det fundne tælles FØR
      // flytningen, så det er det faktiske og ikke et afledt.
      const fundetFoer = findProever().length
      const maalt = gulvposter().length
      const offer = GULV.pr.kerne[0]!
      const skjult = offer.replace(/(^|\/)(test-)/, '$1.modproev-flyttet-$2')
      renameSync(join(ROD, offer), join(ROD, skjult))
      try {
        const p = await laegPlan()
        const linje = p.afvist.find((a) => a.startsWith('gulvet:'))
        tjek('en fjernet proevefil gør planen roed', linje !== undefined, linje ? '' : 'INGEN afvisning')
        tjek('… og afvisningen NAVNGIVER den, der forsvandt',
          linje?.includes(offer) === true, offer)
        tjek('… og siger baade det fundne og det maalte antal',
          new RegExp(`${fundetFoer - 1} proevefiler fundet, ${maalt} maalt`).test(linje ?? ''),
          `${fundetFoer - 1} fundet af ${maalt} maalt`)
      } finally {
        renameSync(join(ROD, skjult), join(ROD, offer))
      }
    }
    {
      // Den anden vej ud af kaeden: samme filnavn, nyt maerke. Antallet
      // staar stille, saa et gulv af TAL ville vaere groent her.
      const offer = GULV.pr.kerne[1]!
      const sti = join(ROD, offer)
      const kilde = readFileSync(sti, 'utf8')
      const flyttet = kilde.replace(/^(\s*\/\/\s*gruppe:\s*)kerne\b/m, '$1manuel')
      // Denne linje er ikke pynt. Foerste udgave af modproeven brugte
      // `^// gruppe: kerne$` og ramte ikke — filen skriver TO mellemrum
      // efter `//` — saa bruddet landede aldrig, og modproeven var groen
      // af den forkerte grund. Nu siger den det.
      tjek('modproeven kunne faktisk aendre maerket', flyttet !== kilde,
        flyttet === kilde ? `maerket i ${offer} ser ikke ud som ventet` : offer)
      writeFileSync(sti, flyttet)
      try {
        const p = await laegPlan()
        const linje = p.afvist.find((a) => a.startsWith('gulvet:') && a.includes('flyttet fra'))
        tjek('et maerke, der forlader npm test, gør planen roed', linje !== undefined,
          linje ? '' : 'INGEN afvisning')
        tjek('… og afvisningen siger hvorfra og hvortil',
          /fra «kerne» til «manuel»/.test(linje ?? ''), linje?.slice(0, 80) ?? '')
      } finally {
        writeFileSync(sti, kilde)
      }
    }
    {
      const p = await laegPlan()
      tjek('og med alt paa plads er planen ren igen', p.afvist.length === 0,
        p.afvist.slice(0, 2).join(' | ') || 'ingen afvisninger')
    }

    afsnit('F · endelsen daekker .mjs')
    {
      const mjs = `${MAPPE}/test-fra-mjs.mjs`
      writeFileSync(join(ROD, mjs), '//  gruppe: manuel\nexport const x = 1\n')
      const p = await laegPlan()
      tjek('en test-*.mjs findes af findProever', p.poster.some((q) => q.fil === mjs),
        p.poster.some((q) => q.fil === mjs) ? '' : 'IKKE fundet')
      tjek('… og uden afvisning, naar den har sit maerke', p.afvist.length === 0,
        p.afvist.slice(0, 1).join('') || 'ingen')
      const dynamisk = "const sti = '../db/client'\nexport const hent = () => import(sti)\n"
      writeFileSync(join(ROD, mjs), '// gruppe: manuel\n' + dynamisk)
      const manuel = await laegPlan()
      tjek('manuel dynamisk proeve registreres uden udledt paakaldelse',
        manuel.afvist.length === 0 && manuel.poster.some((q) => q.fil === mjs && q.maerke.gruppe === 'manuel'))
      writeFileSync(join(ROD, mjs), '// gruppe: kerne\n' + dynamisk)
      const automatisk = await laegPlan()
      tjek('samme dynamiske proeve afvises i den automatiske kaede',
        automatisk.afvist.some((a) => a.includes(mjs) && a.includes('ikke en literal')))
      writeFileSync(join(ROD, mjs), 'export const x = 1\n')
      const p2 = await laegPlan()
      tjek('… og UDEN maerke afvises den som enhver .ts',
        p2.afvist.some((a) => a.startsWith(mjs)),
        p2.afvist.find((a) => a.startsWith(mjs)) ?? 'IKKE afvist')
      rmSync(join(ROD, mjs))
    }

    process.stdout.write(fejl === 0
      ? '\n  ALT GRØNT — afvisningsreglen kan blive roed, og den er noedvendig\n'
      : `\n  ${fejl} FEJL\n`)
    return fejl === 0 ? 0 : 1
  } finally {
    // I et `finally`, og uden `process.exit` i `try`: et exit derinde
    // springer netop denne oprydning over, og saa laekker mappen og
    // gør `npm test` roed bagefter. Det er Git & Releases fejl.
    rmSync(join(ROD, MAPPE), { recursive: true, force: true })
  }
}

// Egen indgang. Den maa IKKE importeres af scripts/proever.ts: dens
// CLI-blok er et top-level await, og en cirkulaer dynamisk import
// derfra laaser (maalt: «unsettled top-level await», exit 13). Derfor
// spawner `proever.ts --modproev` denne fil som et barn i stedet.
if (process.argv[1]?.endsWith('proever-modproev.ts')) {
  process.exitCode = await modproev()
}
