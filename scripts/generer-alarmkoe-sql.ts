// ═══════════════════════════════════════════════════════════════
//  GENERATOR · scripts/maal-alarmkoe.sql
//
//  Målingen af alarmkøen skal spørge om PRÆCIS den kø, `ventende()` i
//  lib/alarm.ts henter. Skrives where-klausulen af i hånden, måler
//  filen afskriften — og de to driver fra hinanden uden at nogen får
//  besked. Det er netop det mønster, CLAUDE.md kalder «svarer to
//  udtryk på det samme spørgsmål, skal de beregnes ét sted».
//
//  Derfor: halen — `from … where` — klippes ud af
//  `ventendeForespoergsel().toSQL()` og sættes ind i målingens egne
//  aggregater. Ændres betingelsen i lib/alarm.ts, ændres filen med.
//
//  Grebet er Analytics' (d59c613, maalinger/traef-paa-nedtagne.ts).
//  Det afløser et forbehold, jeg selv havde skrevet i den håndskrevne
//  fil: at den kunne drive fra koden.
//
//  ── HVORFOR EN FIL OG IKKE BARE ET SCRIPT ───────────────────
//  SELECT'en skal kunne pastes i Supabases editor af et menneske, der
//  ikke har en checkout. Derfor er outputtet committet, og
//  scripts/test-alarmkoe-sql.ts fejler, hvis det committede ikke
//  længere er det, generatoren laver.
//
//      npm run maal:alarmkoe              vis
//      npm run maal:alarmkoe -- --skriv   skriv filen
//
//  `toSQL()` renderer kun og åbner ingen forbindelse — men `db` i
//  db/client.ts er en stedfortræder, der bygger klienten ved første
//  opslag og kræver DATABASE_URL_DIRECT. Derfor køres generatoren
//  under testbasen, som sætter en base ind i forvejen.
// ═══════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync } from 'node:fs'
import { ventendeForespoergsel } from '../lib/alarm'

export const UDFIL = 'scripts/maal-alarmkoe.sql'

const DELEPUNKT = ' from "alert_matches"'
const ORDER = ' order by '

/**
 * Appens egen `from … where`, klippet ud og brudt op i linjer.
 *
 * Klippet er bevogtet i fire led. Et klip, der rammer et andet sted
 * end det tilsigtede, ville give en SELECT, der stadig KØRER og svarer
 * på noget andet — og det er værre end en fejl, for den ville blive
 * læst som et tal.
 */
export function haleFraAppen(): string {
  const q = ventendeForespoergsel().toSQL()

  // 1 · Ingen bind-parametre. Med dem kunne SELECT'en ikke pastes ren
  //     i editoren — `$1` ville stå der uden en værdi.
  if (q.params.length !== 0) {
    throw new Error(`appens forespoergsel har ${q.params.length} bind-parametre — `
      + "SELECT'en kan da ikke pastes ren i editoren")
  }

  // 2 · Delepunktet præcis én gang.
  const dele = q.sql.split(DELEPUNKT)
  if (dele.length !== 2) {
    throw new Error(`delepunktet «${DELEPUNKT}» findes ${dele.length - 1} gange, ikke 1`)
  }

  // 3 · `order by` præcis én gang — halen stopper før den, for
  //     målingen sorterer selv.
  const ob = (DELEPUNKT + dele[1]!).split(ORDER)
  if (ob.length !== 2) throw new Error(`«${ORDER}» findes ${ob.length - 1} gange, ikke 1`)
  const hale = ob[0]!

  // 4 · Halen bærer stadig appens sent_at-led. Uden det måler filen en
  //     anden kø end den, alarmen sender fra.
  if (!hale.includes('"alert_matches"."sent_at" is null')) {
    throw new Error('halen baerer ikke appens sent_at-led — har ventende() aendret form?')
  }

  // 5 · Ingen strengliteraler. Ombrydningen nedenfor er en
  //     tekstudskiftning, og en ' i halen ville betyde, at den kunne
  //     ramme inde i en streng i stedet for mellem to klausuler.
  if (hale.includes("'")) {
    throw new Error('halen indeholder en strengliteral — ombrydningen er da ikke sikker')
  }

  return hale
    .trimStart()
    .replaceAll(' inner join ', '\n  inner join ')
    .replaceAll(' where ', '\n  where ')
}

const ALDER = 'extract(epoch from (now() - "alert_matches"."matched_at")) / 3600'

export interface Spoergsmaal {
  /** Kommentarblokken over select'en — hele linjer, hver med `--`. */
  kommentar: string
  /** Selve select'en, UDEN afsluttende semikolon. `byg()` saetter det paa. */
  sql: string
}

/**
 * De tre spoergsmaal hver for sig.
 *
 * Eksporteret, saa proeven kan KOERE dem mod en saaet base i stedet for
 * at skulle dele filen op igen paa semikolon — og filen har semikolon i
 * sine kommentarer. En drift-proeve alene ville desuden vaere tom: den
 * sammenligner generatoren med dens eget output og kan ikke se, om
 * select'en overhovedet svarer paa det, overskriften siger.
 */
export function spoergsmaal(): Spoergsmaal[] {
  const hale = haleFraAppen()
  return [
    {
      kommentar: `-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
-- 1 \u00b7 HELE KOEEN, DELT PAA STATUS.            [halen: GENERERET]
--
--     Raekkerne er dem, \`ventende()\` ville hente lige nu. \`delisted\`
--     er dem, der ville gaa ud i naeste koersel, hvis filteret i
--     \`sendAlarmer\` ikke fandtes. \`active\` staar ved siden af, saa
--     andelen kan ses i stedet for at skulle gaettes.
--
--     \`kan_mailes\` er sendAlarmers to JS-betingelser som en KOLONNE og
--     ikke som et where-led. De staar ikke i appens forespoergsel, og
--     at skrive dem ind i halen ville vaere at haandskrive koden igen
--     \u2014 praecis det, generatoren findes for at undgaa.
-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`,
      sql: `select "listings"."status",
       count(*)::int                              as traef,
       count(distinct "saved_searches"."id")::int as soegninger,
       count(distinct "users"."id")::int          as brugere,
       count(*) filter (where "saved_searches"."notify_email"
                          and "saved_searches"."unsubscribed_at" is null)::int
                                                  as kan_mailes,
       min("alert_matches"."matched_at")          as aeldste_match,
       max("alert_matches"."matched_at")          as nyeste_match
${hale}
group by "listings"."status"
order by traef desc`,
    },
    {
      kommentar: `-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
-- 2 \u00b7 ER DET SKET?                        [HAANDSKREVET \u2014 og det
--                                          KAN ikke genereres]
--
--     Appens hale baerer \`sent_at is null\`. Dette spoergsmaal handler
--     om det modsatte: de traef, der ER sendt. Halen ville udelukke
--     hver eneste raekke, saa her staar en haandskrevet select, og det
--     er et valg og ikke en forglemmelse.
--
--     \`delisted_at\` saettes af lib/ingest.ts, naar afmeldingen tager
--     boligen ned. Sammenligningen er derfor praecis: boligen var
--     nede, FOER mailen gik ud. Den gamle udgave af filen paastod, at
--     kolonnen ikke fandtes, og brugte \`last_seen_at\` som stedfortraeder
--     \u2014 det var forkert, kolonnen har vaeret der siden migration 0002.
--
--     Det er stadig en NEDRE graense. Kommer boligen tilbage, nulstiller
--     ingest \`delisted_at\`, og saa forsvinder den historiske fejl
--     herfra. Tallet kan vaere for lavt; det kan ikke vaere for hoejt.
-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`,
      sql: `select count(*)::int   as sendte_traef_til_nedtagne,
       min(am.sent_at) as tidligste_mail,
       max(am.sent_at) as seneste_mail
from alert_matches am
join listings l on l.id = am.listing_id
where am.sent_at is not null
  and l.delisted_at is not null
  and l.delisted_at < am.sent_at`,
    },
    {
      kommentar: `-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
-- 3 \u00b7 HVOR LAENGE KAN ET TRAEF LIGGE?          [halen: GENERERET]
--
--     Spaerretiden er 60 min., men en fejlet afsendelse og
--     ALARM_TILLADTE_MODTAGERE lader raekken staa. Samme hale som 1,
--     saa de to taeller det samme grundlag.
-- \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`,
      sql: `select date_trunc('day', "alert_matches"."matched_at") as dag,
       count(*)::int                                          as usendte,
       round(avg(${ALDER})::numeric, 1)
         as snit_timer
${hale}
group by 1
order by 1 desc
limit 14`,
    },
  ]
}

/** Hele filens indhold \u2014 det, der staar i UDFIL. */
export function byg(): string {
  const hoved = `-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
--  Vinduet bag lib/alarm.ts' status-filter: hvor mange traef staar i
--  koeen til en bolig, der ikke laengere er aktiv?
--
--  Det tal afgoer, om fejlen er SKET \u2014 ikke om den kan ske. Den kan
--  ske; det er laest i koden og nu daekket af en proeve. Om nogen har
--  faaet en mail om en nedtaget bolig, kan kun basen svare paa.
--
--      psql "$DATABASE_URL_DIRECT" -f ${UDFIL}
--
--  SKRIVEBESKYTTET. Kun \`select\`. Koer den fra en checkout af main med
--  .env, eller fra ejerens maskine; sessionen, der skrev filen, har
--  ingen databaseadgang.
--
--  \u2500\u2500 GENERERET. RET IKKE I HAANDEN \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
--  scripts/generer-alarmkoe-sql.ts skriver filen, og
--  scripts/test-alarmkoe-sql.ts fejler, hvis det committede ikke
--  laengere er det, generatoren laver \u2014 og koerer desuden de tre
--  select'er mod en saaet base, saa en gyldig, men forkert select
--  ikke kan staa groen.
--
--  Spoergsmaal 1 og 3 baerer appens EGEN \`from \u2026 where\`, klippet ud af
--  \`ventendeForespoergsel().toSQL()\`. De maaler derfor praecis den koe,
--  \`ventende()\` henter \u2014 ikke en afskrift, der kan drive fra den.
--  Spoergsmaal 2 er haandskrevet, og det kan ikke vaere andet; se der.
-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
`
  return hoved + spoergsmaal().map((s) => `\n${s.kommentar}\n${s.sql};\n`).join('')
}

// ── Koert direkte. Under testbasen staar filnavnet i argv[2], ikke i
//    argv[1] — scripts/testbase.ts importerer maalet. Begge veje
//    proeves, saa generatoren kan koeres baade med og uden harnesket,
//    og saa IMPORTEN fra proeven ikke udloeser noget.
const MIT = 'generer-alarmkoe-sql.ts'
if ([process.argv[1], process.argv[2]].some((a) => a?.endsWith(MIT))) {
  const ny = byg()
  if (process.argv.includes('--skriv')) {
    const foer = (() => { try { return readFileSync(UDFIL, 'utf8') } catch { return null } })()
    writeFileSync(UDFIL, ny)
    process.stdout.write(foer === ny
      ? `  ${UDFIL} er uaendret\n`
      : `  ${UDFIL} skrevet (${ny.length} tegn)\n`)
  } else {
    process.stdout.write(ny)
  }
}
