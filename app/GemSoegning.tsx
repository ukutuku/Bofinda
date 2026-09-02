import { tilmeld, beskrivFiltre } from '../lib/alarm'
import type { Filtre, Soegeparametre } from '../lib/soeg'
import { filtreFraParametre, harFiltre } from '../lib/soeg'

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
  if (f.vaerelserMin != null) d.push(`${f.vaerelserMin}+ vær.`)
  if (f.arealMin != null) d.push(`${f.arealMin}+ m²`)
  const sted = f.postnr ?? f.by
  if (sted) d.push(`i ${sted}`)
  if (f.prisMax != null) d.push(`under ${(f.prisMax / 100).toLocaleString('da-DK')} kr.`)
  else if (f.prisMin != null) d.push(`over ${(f.prisMin / 100).toLocaleString('da-DK')} kr.`)
  if (f.fuldOekonomi) d.push('fuld økonomi')
  return d.join(' ') || 'alle boliger'
}

export function GemSoegning({ sp }: { sp: Soegeparametre }) {
  const f = filtreFraParametre(sp)
  const svar = typeof sp.gemt === 'string' ? sp.gemt : null

  async function gem(formData: FormData) {
    'use server'
    const mail = String(formData.get('mail') ?? '')
    const filtre = JSON.parse(String(formData.get('filtre') ?? '{}')) as Filtre
    const navn = String(formData.get('navn') ?? '').slice(0, 80) || navngiv(filtre)

    const r = await tilmeld(mail, navn, filtre)
    const { redirect } = await import('next/navigation')
    const q = new URLSearchParams(
      Object.entries(sp).flatMap(([k, v]) =>
        v == null || k === 'gemt' ? [] : (Array.isArray(v) ? v.map((x) => [k, x] as [string, string]) : [[k, v] as [string, string]])),
    )
    q.set('gemt', r.slags === 'for-hurtigt' ? `for-hurtigt:${r.minutter}` : r.slags)
    redirect(`/?${q}`)
  }

  if (svar) {
    const [slags, ekstra] = svar.split(':')
    return (
      <div className={`gem-svar ${slags === 'sendt' ? 'ok' : 'advarsel'}`}>
        {slags === 'sendt' ? (
          <>
            <strong>Tjek din mail.</strong> Vi har sendt et link, du skal trykke på,
            før vi begynder at sende. Uden det sker der ingenting — sådan sikrer vi,
            at ingen kan tilmelde en anden persons adresse.
          </>
        ) : slags === 'ugyldig-mail' ? (
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
      </div>
    )
  }

  if (!harFiltre(f)) {
    return (
      <div className="gem-tom">
        Filtrér først — så kan du få besked, når der kommer nye boliger, der matcher.
      </div>
    )
  }

  return (
    <form className="gem" action={gem}>
      <input type="hidden" name="filtre" value={JSON.stringify(f)} />
      <div className="gem-hoved">
        <div>
          <strong>Få besked om nye boliger som disse</strong>
          <div className="gem-filtre">{beskrivFiltre(f as unknown as Record<string, unknown>)}</div>
        </div>
      </div>
      <div className="gem-raek">
        <input
          type="text" name="navn" maxLength={80}
          placeholder="Navn på søgningen" defaultValue={navngiv(f)}
          aria-label="Navn på søgningen"
        />
        <input
          type="email" name="mail" required maxLength={200}
          placeholder="din@mail.dk" aria-label="Din mailadresse"
        />
        <button type="submit">Send mig besked</button>
      </div>
      <p className="gem-vilkaar">
        Vi gemmer <strong>din mailadresse</strong> og <strong>de filtre, du ser
        ovenfor</strong> — intet andet. Vi bruger dem udelukkende til at sende dig
        besked, når en ny bolig matcher. Ingen konto, ingen adgangskode.
        {' '}Du får først mail, når du har trykket på linket i bekræftelsesmailen,
        og hver besked har et afmeldingslink, der virker uden login.
        {' '}<a href="/privatliv">Sådan behandler vi dine oplysninger</a>.
      </p>
    </form>
  )
}
