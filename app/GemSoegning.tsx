import { tilmeld, beskrivFiltre } from '../lib/alarm'
import { spor } from '../lib/maaling-server'
import { antalFiltre } from '../lib/maalingsoeg'
import type { Filtre, Soegeparametre } from '../lib/soeg'
import { filtreFraParametre, harFiltre } from '../lib/soeg'
import { laesUdkast, saetUdkast } from '../lib/gemudkast'
import { GemSvar } from './GemSvar'
import { typenavn } from '../lib/boligtype'

// ═══════════════════════════════════════════════════════════════
//  «Få besked om nye boliger som disse»
//
//  Ingen konto, ingen adgangskode. Mail er nok — men søgningen er død,
//  indtil adressens ejer har trykket på knappen i bekræftelsesmailen.
//  Ellers kunne enhver tilmelde en fremmed til en strøm af post.
//
//  Filtrene kommer fra de samme URL-parametre, som listen nedenunder er
//  bygget af, gennem samme `filtreFraParametre`. Der er ingen vej til at
//  gemme noget andet, end det brugeren ser.
// ═══════════════════════════════════════════════════════════════

/** Menneskeligt navn til søgningen, af filtrene selv. */
function navngiv(f: Filtre): string {
  const d: string[] = []
  if (f.boligtyper?.length === 1) d.push(typenavn(f.boligtyper[0]!))
  if (f.vaerelserMin != null) d.push(`${f.vaerelserMin}+ vær.`)
  if (f.arealMin != null) d.push(`${f.arealMin}+ m²`)
  const sted = f.postnr ?? f.by
  if (sted) d.push(`i ${sted}`)
  if (f.prisMax != null) d.push(`under ${(f.prisMax / 100).toLocaleString('da-DK')} kr.`)
  else if (f.prisMin != null) d.push(`over ${(f.prisMin / 100).toLocaleString('da-DK')} kr.`)
  if (f.fuldOekonomi) d.push('fuld økonomi')
  return d.join(' ') || 'alle boliger'
}

/** Ledeteksternes id'er. Ét sted, saa <label for> og <input id> ikke
 *  kan drive fra hinanden — og saa fejlbeskeden kan pege paa feltet. */
const ID_NAVN = 'gem-navn'
const ID_MAIL = 'gem-mail'
const ID_SVAR = 'gem-svar'

/**
 * `svar` er en PROP og ikke `sp.gemt`.
 *
 * Det er ikke kosmetik. `gemt` er et svar paa EN indsendelse, ikke en
 * del af soegningen — og hver eneste adresse paa siden bygges af `sp`:
 * sidetal, sortering, filterchips, kortvalg. Stod den i `sp`, hang
 * beskeden ved i hvert klik bagefter, og fokus ville blive revet ned til
 * den igen og igen. Derfor tages den ud af `sp` ét sted, i app/page.tsx,
 * og gives herind som det, den er.
 */
export async function GemSoegning({ sp, svar }: { sp: Soegeparametre; svar: string | null }) {
  const f = filtreFraParametre(sp)

  async function gem(formData: FormData) {
    'use server'
    const mail = String(formData.get('mail') ?? '')
    const filtre = JSON.parse(String(formData.get('filtre') ?? '{}')) as Filtre
    const navn = String(formData.get('navn') ?? '').slice(0, 80) || navngiv(filtre)

    const r = await tilmeld(mail, navn, filtre)
    // KUN 'sendt' er en oprettet alarm. 'ugyldig-mail', 'for-mange',
    // 'for-hurtigt' og 'spaerret' er alle udfald, hvor der ikke blev
    // oprettet noget — og hvor et event ville puste tallet op.
    //
    // Hverken mailadressen eller navnet paa soegningen maa med: navnet er
    // fritekst, brugeren selv har skrevet. Kun HVILKE filtertyper der var
    // sat, aldrig deres vaerdier.
    if (r.slags === 'sendt') {
      await spor({
        navn: 'alert_created',
        props: {
          filtertyper: Object.entries(filtre)
            .filter(([k, v]) => k !== 'sorter' && v != null && v !== false
              && !(Array.isArray(v) && v.length === 0))
            .map(([k]) => k).slice(0, 20),
          antal_filtre: antalFiltre(filtre),
        },
      }, '/')
    }
    // Det indtastede baeres over omdirigeringen, saa en fejl kan RETTES
    // og ikke kun skrives forfra. `navn` tages RAAT fra formularen og
    // ikke fra variablen ovenfor: den falder tilbage til det maskinskrevne
    // navn, og saa ville et bevidst tomt felt komme tilbage udfyldt.
    await saetUdkast(r.slags === 'sendt' ? null : {
      navn: String(formData.get('navn') ?? ''),
      mail,
    })
    const { redirect } = await import('next/navigation')
    const q = new URLSearchParams(
      Object.entries(sp).flatMap(([k, v]) =>
        v == null || k === 'gemt' ? [] : (Array.isArray(v) ? v.map((x) => [k, x] as [string, string]) : [[k, v] as [string, string]])),
    )
    q.set('gemt', r.slags === 'for-hurtigt' ? `for-hurtigt:${r.minutter}` : r.slags)
    redirect(`/?${q}`)
  }

  const [slags, ekstra] = (svar ?? '').split(':')
  // KUN «sendt» er faerdigt. Alt andet er noget, brugeren kan goere om —
  // en tastefejl i mailen, en ventetid, en spaerret afsendelse — og saa
  // skal formularen blive staaende. Foer blev den erstattet af beskeden,
  // saa den eneste vej tilbage var at finde boksen igen og skrive alt
  // forfra. Filtrene foelger med i omdirigeringen og staar uroerte i
  // `sp`, saa soegningen er den samme, naar hun proever igen.
  const faerdig = slags === 'sendt'
  const fejl = svar != null && !faerdig
  // Netop denne fejl handler om FELTET og kobles til det. De andre
  // handler om kontoen eller om afsendelsen, og et `aria-invalid` paa
  // mailfeltet ville pege paa noget, der ikke er noget i vejen med.
  const mailFejl = slags === 'ugyldig-mail'

  // Kun ved en fejl. Ellers kunne et to minutter gammelt udkast dukke op
  // paa en helt almindelig visning af siden — og `cookies()` ville goere
  // gengivelsen dynamisk uden grund.
  const udkast = fejl ? await laesUdkast() : null

  const besked = svar == null ? null : (
    <GemSvar id={ID_SVAR} fejl={fejl}>
      {faerdig ? (
        <>
          <strong>Tjek din mail.</strong> Vi har sendt et link, du skal trykke på,
          før vi begynder at sende. Uden det sker der ingenting — sådan sikrer vi,
          at ingen kan tilmelde en anden persons adresse.
        </>
      ) : mailFejl ? (
        <><strong>Den mailadresse ser ikke rigtig ud.</strong> Prøv igen.</>
      ) : slags === 'for-mange' ? (
        <>
          <strong>Du har allerede ubekræftede søgninger.</strong> Find
          bekræftelsesmailen i din indbakke, eller vent til de udløber.
        </>
      ) : slags === 'for-hurtigt' ? (
        <>
          <strong>Vi har lige sendt dig en mail.</strong> Vent {ekstra} min.,
          hvis du vil have en ny.
        </>
      ) : (
        <>
          <strong>Vi kunne ikke sende bekræftelsen.</strong> Bofinda er under
          indkøring og sender kun til udvalgte adresser endnu. Prøv igen senere.
        </>
      )}
    </GemSvar>
  )

  if (faerdig) return besked

  if (!harFiltre(f)) {
    return (
      <>
        {besked}
        <div className="gem-tom">
          Filtrér først — så kan du få besked, når der kommer nye boliger, der matcher.
        </div>
      </>
    )
  }

  return (
    <>
      {besked}
      <form className="gem" action={gem}>
        <input type="hidden" name="filtre" value={JSON.stringify(f)} />
        <div className="gem-hoved">
          <div>
            <strong>Få besked om nye boliger som disse</strong>
            <div className="gem-filtre">{beskrivFiltre(f as unknown as Record<string, unknown>)}</div>
          </div>
        </div>
        {/* Ledeteksten er en <label>, der BLIVER STAAENDE. Den var en
            placeholder, og en placeholder er ikke en ledetekst: den
            forsvinder ved foerste tastetryk. Maalt efter udfyldning stod
            der to felter side om side — «2+ vær. i Attrapby» og «abc» —
            uden nogen angivelse af, hvad de var.
            `aria-label` er VAEK begge steder. To kilder til det samme
            navn er to steder at rette; nu staar navnet ét sted, og det er
            det samme, brugeren kan se. */}
        <div className="gem-raek">
          <div className="gem-felt">
            <label htmlFor={ID_NAVN}>Navn på søgningen</label>
            <input
              id={ID_NAVN} type="text" name="navn" maxLength={80}
              defaultValue={udkast?.navn ?? navngiv(f)}
            />
          </div>
          <div className="gem-felt">
            <label htmlFor={ID_MAIL}>Din mailadresse</label>
            {/* `aria-invalid` ja, `aria-describedby` nej.
                Beskeden faar fokus ved indlaesning og bliver laest op
                dér. Pegede feltet ogsaa paa den, ville praecis samme
                saetning blive laest igen, saa snart man tabulerede ind i
                feltet — og i de skaermlaesere, der alligevel annoncerer
                et `role="alert"` ved indlaesning, en tredje gang.
                Ét sted at sige det, ikke tre. */}
            <input
              id={ID_MAIL} type="email" name="mail" required maxLength={200}
              placeholder="din@mail.dk"
              defaultValue={udkast?.mail ?? ''}
              aria-invalid={mailFejl || undefined}
            />
          </div>
          <button type="submit">Send mig besked</button>
        </div>
        {/* Ingen «intet andet». Der gemmes mere end mailen og filtrene —
            navnet paa soegningen og tidsstemplerne — og et loefte, der
            udelader dem, er ikke mindre forkert af at vaere kort. Listen
            her skal kunne holdes op mod /privatliv og passe. */}
        <p className="gem-vilkaar">
          Vi gemmer <strong>din mailadresse</strong>, <strong>de filtre, du ser
          ovenfor</strong> og <strong>et navn til søgningen</strong> — det du selv
          skriver, eller et, vi laver af filtrene. Dertil tidspunktet for
          oprettelsen og for hver besked, vi sender. Vi bruger det til at sende dig
          besked, når en ny bolig matcher. Ingen konto, ingen adgangskode.
          {/* «Du faar foerst mail» modsagde sig selv: bekraeftelsesmailen
              ER en mail, og den kommer foer trykket. Det, der er sandt, er
              at BOLIGBESKEDERNE venter — `matchAlarmer` filtrerer paa
              `confirmed_at`. */}
          {' '}Vi sender først boligbeskeder, når du har trykket på linket i
          bekræftelsesmailen, og hver besked har et afmeldingslink, der virker
          uden login.
          {' '}<a href="/privatliv">Sådan behandler vi dine oplysninger</a>.
        </p>
      </form>
    </>
  )
}
