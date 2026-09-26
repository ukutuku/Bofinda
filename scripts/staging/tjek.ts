// ═══════════════════════════════════════════════════════════════
//  Forkontrol før noget som helst skrives i staging.
//
//  ═══ HVORFOR DEN FINDES ═══
//
//  `maal.ts` var et værn, ingen kom forbi. drizzle-kit læser KUN
//  `DATABASE_URL_DIRECT`, så den faktiske vej til staging var en bar
//  forbindelsesstreng uden et eneste tjek — og et værn, man kan gå uden
//  om, er ikke et værn, man har.
//
//  Derfor det her: den ENESTE måde, kommandoen skal dannes på. Den
//  efterprøver målet på tre uafhængige kanaler og skriver den præcise
//  kommandolinje ud bagefter. Operatøren kopierer den ud herfra i stedet
//  for at taste en forbindelsesstreng i hånden.
//
//      npm run staging:tjek
//
//  ═══ DEN FORBINDER IKKE ═══
//
//  Med vilje. Den session, der skrev filen, havde ingen adgang til
//  prgmenbwabwkgitjclrj — egress-proxyen afviste både 443 og pooleren —
//  og en kodevej, ingen har kørt, må ikke se ud som en, der er prøvet.
//  Alt herinde er derfor rene funktioner over miljøet, og de er prøvet:
//  scripts/staging/test-maal.ts.
//
//  `kraevTom()` i maal.ts er indholdsværnet og har ingen kalder endnu.
//  Den skal kaldes af det første script, der FAKTISK forbinder — med
//  tællinger, det selv har hentet. Se noten nederst.
// ═══════════════════════════════════════════════════════════════

import { kraevStaging, Maalfejl, PRODUKTION_REF } from './maal'

try {
  const maal = kraevStaging()

  console.log('\n✓ Målet er efterprøvet på tre uafhængige kanaler.')
  console.log(`  projekt   ${maal.ref}   (staging)`)
  console.log(`  api       ${maal.apiUrl}`)
  console.log(`  database  ${maal.databaseUrl.replace(/:\/\/([^:]+):[^@]*@/, '://$1:•••@')}`)
  console.log(`\n  Produktionen (${PRODUKTION_REF}) optræder ingen steder i de tre værdier.`)

  // Kommandoen skrives UD, ikke køres. To grunde: den skal kunne læses,
  // før den kører, og migrationer mod en fremmed base er ikke noget, et
  // forkontrol-script skal kunne komme til at starte selv.
  console.log('\n─── Kør migrationerne sådan her, og kun sådan ───\n')
  // Variablen genbruges frem for at blive skrevet ud: kodeordet staar
  // allerede i skallen, og der er ingen grund til ogsaa at lade det ligge
  // i terminalens historik.
  console.log('  export DATABASE_URL_DIRECT="$STAGING_DATABASE_URL"   # den streng, der lige er efterprøvet')
  console.log('  npm run db:migrate')
  console.log('  npm run db:status        # 21 filer · 21 journalposter · 21 kørt')
  console.log('  npm run tjek:rettigheder # RLS + revoke på hver tabel')
  console.log('\n  Præfiks frem for .env: dotenv overskriver ikke en variabel, der')
  console.log('  allerede står i processen, så et bart `npm run db:migrate` senere')
  console.log('  i samme skal ikke kan arve et andet mål.')

  console.log('\n⚠ IKKE efterprøvet af dette script:')
  console.log('  · at forbindelsen kommer i stand — der forbindes ikke herfra')
  console.log('  · at basen ikke ligner produktionen — kraevTom() i maal.ts venter')
  console.log('    på en kalder, der har hentet tællingerne. Den skal kaldes FØR')
  console.log('    første skrivning, ikke efter.\n')
  process.exit(0)
} catch (e) {
  if (!(e instanceof Maalfejl)) throw e
  console.error(`\n✗ STOPPET · ${e.message}\n`)
  console.error('  Der skrives intet. Sæt de tre variabler og kør igen:')
  console.error('    STAGING_DATABASE_URL     forbindelsesstrengen (port 5432)')
  console.error('    STAGING_SUPABASE_URL     https://<ref>.supabase.co')
  console.error('    BOFINDA_STAGING_BEKRAEFT projekt-ref\'en, tastet i hånden\n')
  process.exit(1)
}
