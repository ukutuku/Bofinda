// Koerer importen én gang.
//   npm run import            alle RIGTIGE kilder
//   npm run import -- dummy   én kilde; testkilder kun her
//
//  KOERSELSGRAENSERNE staar i lib/koersel.ts — baade mekanikken og
//  TABELLERNE `GRAENSER` og `AFHAENGIGHEDER`. Flagene staar med vilje IKKE
//  her: laa de i trinlisten nedenfor, kunne ingen proeve se dem, og hele
//  proevesaettet blev groent, selv naar hvert eneste flag var vendt om.
//  Begrundelsen for hvert flag staar ved tabellen; her staar kun, hvad
//  trinet GOER.
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
  // Kilderegistret og startlinjen.
  //
  // GRAENSEN FOR DENNE GRAENSE: et kast i modul-importerne ovenfor sker,
  // foer denne fil koerer, og kan ikke fanges herfra. Da er der stadig
  // ingen output — det er ikke daekket, og det skal ikke se daekket ud.
  {
    navn: 'opstart',
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

  // Kilderne. `koerAlle` isolerer i forvejen hver kilde for sig
  // (lib/scheduler.ts). Denne graense daekker resten: enkeltkilde-vejen
  // nedenfor, som FOER stod helt ubeskyttet, saa `npm run import -- dummy`
  // kunne vaelte hele koerslen paa et kast, `koerAlle` ville have fanget.
  {
    navn: 'kilder',
    koer: async () => {
      // Resultatet skrives, saa snart hver kilde er faerdig — ikke til sidst.
      if (slug) {
        const k = valgte[0]!
        const r = await koerKilde(k.adapter, k.navn, { baseUrl: k.baseUrl })
        ud(formatResultat(r))
        if (r.status === 'failed') throw new Error(`kilden ${r.kilde} fejlede`)
        return
      }
      const r = await koerAlle(valgte, (x) => ud(formatResultat(x)))
      // RAPPORTÉR, naar intet lykkedes. `koerAlle` fanger pr. kilde, saa
      // trinet kaster ellers ikke — og en koersel, hvor ingen kilde kom
      // igennem, ville afslutte med «import afsluttet» og exitkode 0.
      // `exitkode` kan kun se, om et trin kastede; derfor kaster vi.
      if (r.length && r.every((x) => x.status === 'failed')) {
        throw new Error(`alle ${r.length} kilder fejlede`)
      }
    },
  },

  // Oprydning af brugerdata. Ryd FOER matchning: en soegning, der skal
  // slettes, skal ikke foerst samle traef op.
  //
  // UISOLERET — se begrundelsen ved `GRAENSER` i lib/koersel.ts. Kort: kun
  // to af `ryd()`s tre sletninger er daekket af vaern i sendevejen; den
  // tredje, 24-maaneders-loeftet, har intet andet vaern end `ryd()` selv.
  {
    navn: 'oprydning',
    koer: async () => {
      const r = await ryd()
      if (r.ubekraeftede || r.afmeldte || r.forgamle || r.foraeldreloese) {
        ud(`[oprydning] ${r.ubekraeftede} ubekræftede · ${r.afmeldte} afmeldte `
          + `· ${r.forgamle} for gamle · ${r.foraeldreloese} brugere uden søgning`)
      }
    },
  },

  // Analytics-retention koerer med her, ikke i sin egen cron: timekoerslen
  // findes allerede, og et expires_at-felt uden en faktisk sletteproces er
  // ikke retention.
  //
  // Dagsaggregatet skrives FOERST — ellers ville de raekker, oprydningen
  // lige har slettet, mangle i trenden for altid. Den indre raekkefoelge er
  // altsaa HAARD, og de to hoerer inden for samme graense.
  {
    navn: 'maaling',
    koer: async () => {
      const opdateret = await opdaterDagsaggregat()
      const slettet = await ryddHaendelser()
      if (opdateret || slettet) {
        ud(`[maaling] ${opdateret} dagstal opdateret · ${slettet} udløbne hændelser slettet`)
      }
    },
  },

  // Matchningen fylder koeen. Der SENDES ikke her.
  {
    navn: 'match',
    koer: async () => {
      for (const a of await matchAlarmer()) {
        ud(`[alarm] ${a.soegning}: ${a.nyeTraef} nye træf`)
      }
    },
  },

  // Udsendelsen. Springes over, hvis `match` fejlede — se
  // `AFHAENGIGHEDER` i lib/koersel.ts: en halvt fyldt koe ville blive sendt
  // som om den var fuldstaendig.
  //
  // `sendAlarmer` isolerer desuden PR. MODTAGER indeni, saa ét glip ikke
  // koster resten af koeen — afsendelsen OG bogfoeringen.
  {
    navn: 'mail',
    koer: async () => {
      const r = await sendAlarmer()
      for (const x of r) {
        ud(`[mail] ${x.soegning} → ${x.modtager}: ${x.antal} boliger — `
          + (x.sendt ? 'SENDT' : `ikke sendt (${x.grund})`))
      }
      // RAPPORTÉR, naar en afsendelse gik galt. Graensen pr. modtager
      // oversaetter et kast til et resultat, saa trinet kaster ellers ikke,
      // og en koersel hvor INGEN fik mail ville give exitkode 0. `fejl` er
      // sat af lib/mail.ts og kun ved fejl — en afvist modtager, en
      // manglende noegle og 60-minutters-uret er politik, ikke fejl.
      const daarlige = r.filter((x) => x.fejl)
      if (daarlige.length) {
        throw new Error(`${daarlige.length} af ${r.length} mails gik galt: `
          + daarlige.map((x) => `${x.modtager} (${x.grund})`).join(' · '))
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
// det. `sql` er en lazy getter (db/client.ts), der bygger klienten ved
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
