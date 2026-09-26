// Koerer importen én gang.
//   npm run import            alle RIGTIGE kilder
//   npm run import -- dummy   én kilde; testkilder kun her
//
//  KOERSELSGRAENSERNE staar i lib/koersel.ts. Hvert trin herunder er
//  markeret isoleret eller ikke, og begrundelsen staar ved trinet.
//  Filen er med vilje tynd: orkestreringen er flyttet ud, saa den kan
//  proeves — se scripts/test-koersel.ts.
import { KILDER, findKilde, rigtigeKilder, tilladTestkilder } from '../adapters'
import { koerAlle, formatResultat } from '../lib/scheduler'
import { koerKilde, RUNNER } from '../lib/ingest'
import { matchAlarmer, ryd, sendAlarmer } from '../lib/alarm'
import { opdaterDagsaggregat, ryddHaendelser } from '../lib/maaling-server'
import { besked, exitkode, koerTrin, slutlinje, type Trin } from '../lib/koersel'
import { sql } from '../db/client'

const ud = (s: string) => process.stdout.write(s + '\n')

const slug = process.argv[2]

let valgte: typeof KILDER = []

const trin: Trin[] = [
  // UISOLERET med vilje. Uden kilderegistret er der intet at arbejde paa,
  // og de foelgende trin ville arbejde paa et tomt grundlag. Men den skal
  // fejle HOERBART: slutlinjen navngiver nu trinet, hvor der foer intet
  // blev skrevet overhovedet.
  //
  // GRAENSEN FOR DENNE GRAENSE: et kast i modul-importerne ovenfor sker,
  // foer denne fil koerer, og kan ikke fanges herfra. Da er der stadig
  // ingen output — det er ikke daekket, og det skal ikke se daekket ud.
  {
    navn: 'opstart',
    isoleret: false,
    koer: async () => {
      // Navngives en kilde udtrykkeligt, maa den vaere en testkilde. Ellers ikke.
      if (slug) tilladTestkilder()
      valgte = slug
        ? [findKilde(slug)].filter(Boolean) as typeof KILDER
        : rigtigeKilder()
      if (slug && !valgte.length) {
        throw new Error(`ukendt kilde: ${slug}. `
          + `Kendte: ${KILDER.map((k) => k.adapter.id).join(', ')}`)
      }
      // Foerste linje, foer noget kan naa at gaa galt. Den viser hvad der
      // FAKTISK koeres — ikke hvad der staar i registret. Forskellen
      // kostede en fejlsoegning.
      ud(`import startet · runner=${RUNNER} · node ${process.version} · `
        + `kilder: ${valgte.map((k) => k.adapter.id).join(', ')}`
        + (slug ? '  (udtrykkeligt navngivet)' : ''))
    },
  },

  // ISOLERET. En fejlet kilde giver faerre nye boliger, ikke forkerte
  // match — trinnene efter er uafhaengige.
  //
  // `koerAlle` isolerer i forvejen hver kilde for sig (lib/scheduler.ts).
  // Denne graense daekker resten: enkeltkilde-vejen nedenfor, som FOER
  // stod helt ubeskyttet, saa `npm run import -- dummy` kunne vaelte hele
  // koerslen paa et kast, `koerAlle` ville have fanget.
  {
    navn: 'kilder',
    isoleret: true,
    koer: async () => {
      // Resultatet skrives, saa snart hver kilde er faerdig — ikke til sidst.
      if (slug) {
        const k = valgte[0]!
        ud(formatResultat(await koerKilde(k.adapter, k.navn, { baseUrl: k.baseUrl })))
      } else {
        await koerAlle(valgte, (r) => ud(formatResultat(r)))
      }
    },
  },

  // ISOLERET. Ryd FOER matchning: en soegning, der skal slettes, skal ikke
  // foerst samle traef op.
  //
  // UENIGHED, SKREVET UD. `ryd()` siger selv i lib/alarm.ts, at der med
  // vilje ikke er try/catch om dens sletninger: kaster de, er der en
  // relation, listen ikke kender, og saa «SKAL koerslen stoppe, indtil et
  // menneske har set paa den». Det argument staar — men det blev skrevet,
  // da et stop var TAVST. Det er det ikke laengere: et isoleret trins fejl
  // giver `[oprydning] FEJLEDE: …`, slutlinjen «import afsluttet · fejl i:
  // oprydning» og exitkode ≠ 0, paa hver eneste koersel. Den naeste
  // manglende relation er altsaa ikke usynlig; den er navngivet hver time.
  //
  // Og skaden, isoleringen forhindrer, er maalt: fem doegn uden matchning
  // og udsendelse. Skaden, den kunne risikere, er daekket andetsteds —
  // afsendelsen har sine EGNE vaern uafhaengigt af `ryd()`:
  // `isNotNull(confirmedAt)` i `ventende` og `matchAlarmer`, og
  // `if (!f.paaMail || f.afmeldt)` i `sendAlarmer`. En halvfaerdig `ryd()`
  // kan derfor ikke sende mail til en afmeldt eller ubekraeftet modtager.
  // Det, der bliver tilbage, er retentionsgaeld — ikke en forkert mail.
  //
  // Skal det alligevel vaere fail-stop, er det ÉT ord: `isoleret: false`.
  // Graensen inde i `ryd()` selv er uaendret; den her er paa kaldstedet.
  //
  // Afhaengigheden er BLOED, og netop derfor er trinet isoleret. Fejler
  // `ryd()`, samler en soegning, der burde vaere væk, traef i én cyklus
  // mere — og de forsvinder med soegningen ved naeste gennemfoerte `ryd()`,
  // fordi `alert_matches` cascader. Matchningen bliver altsaa let
  // OVERINKLUDERENDE i én time. Det er ulige mindre skade end fem doegn
  // uden matchning og udsendelse, som er hvad den ubeskyttede udgave
  // faktisk kostede.
  {
    navn: 'oprydning',
    isoleret: true,
    koer: async () => {
      const r = await ryd()
      if (r.ubekraeftede || r.afmeldte || r.forgamle || r.foraeldreloese) {
        ud(`[oprydning] ${r.ubekraeftede} ubekræftede · ${r.afmeldte} afmeldte `
          + `· ${r.forgamle} for gamle · ${r.foraeldreloese} brugere uden søgning`)
      }
    },
  },

  // ISOLERET. Analytics-retention koerer med her, ikke i sin egen cron:
  // timekoerslen findes allerede, og et expires_at-felt uden en faktisk
  // sletteproces er ikke retention.
  //
  // Dagsaggregatet skrives FOERST — ellers ville de raekker, oprydningen
  // lige har slettet, mangle i trenden for altid. Den indre raekkefoelge
  // er altsaa HAARD, og de to hoerer inden for samme graense. Graensen er
  // uaendret; den udtrykkes nu gennem koerTrin som de oevrige, saa der er
  // ét graenselag og ikke to.
  {
    navn: 'maaling',
    isoleret: true,
    koer: async () => {
      const opdateret = await opdaterDagsaggregat()
      const slettet = await ryddHaendelser()
      if (opdateret || slettet) {
        ud(`[maaling] ${opdateret} dagstal opdateret · ${slettet} udløbne hændelser slettet`)
      }
    },
  },

  // ISOLERET. Koeen kan holde raekker fra tidligere koersler, saa at sende
  // uden at have matchet er strengt bedre end ingen af delene.
  // Der SENDES ikke her — koeen fyldes kun.
  {
    navn: 'match',
    isoleret: true,
    koer: async () => {
      for (const a of await matchAlarmer()) {
        ud(`[alarm] ${a.soegning}: ${a.nyeTraef} nye træf`)
      }
    },
  },

  // ISOLERET. Afsendelsen spaerrer sig selv, hvis noeglerne mangler eller
  // modtageren ikke staar paa listen — se lib/mail.ts. Og `sendAlarmer`
  // isolerer desuden PR. MODTAGER indeni, saa ét transporttimeout ikke
  // koster resten af koeen.
  {
    navn: 'mail',
    isoleret: true,
    koer: async () => {
      for (const r of await sendAlarmer()) {
        ud(`[mail] ${r.soegning} → ${r.modtager}: ${r.antal} boliger — `
          + (r.sendt ? 'SENDT' : `ikke sendt (${r.grund})`))
      }
    },
  },
]

let slut: string
let kode: 0 | 1

try {
  const udfald = await koerTrin(trin, ud)
  slut = slutlinje(udfald)
  kode = exitkode(udfald)
} catch (e) {
  // Kan kun ske ved en fejl i graenselaget selv. Slutlinjen skal staa
  // alligevel — det er hele pointen med den.
  slut = `import afbrudt: graenselaget — ${besked(e)}`
  kode = 1
}

// Luk forbindelsen FOER slutlinjen skrives, og lad aldrig lukningen aendre
// udfaldet: den er oprydning, ikke arbejde. Et kast her maa hverken skrive
// et stakspor EFTER slutlinjen eller gore en gennemfoert koersel til en
// fejlet — saa var garantien om, at loggen ender paa «afsluttet» eller
// «afbrudt», ikke en garanti.
//
// MAALT: `npm run import -- <ukendt kilde>` uden DATABASE_URL gjorde netop
// det. `sql` er en lazy getter (db/client.ts:170), der bygger klienten ved
// adgang, saa `sql.end()` kastede — efter at afbrudt-linjen var skrevet.
// Foer denne omgang laa `sql.end()` i oevrigt sidst i filen og blev
// sprunget helt over, hver gang noget kastede.
try {
  await sql.end()
} catch (e) {
  ud(`[luk] forbindelsen kunne ikke lukkes: ${besked(e)}`)
}

ud(slut)
// Ikke process.exit(): intet skal kunne afkorte linjen ovenfor.
process.exitCode = kode
