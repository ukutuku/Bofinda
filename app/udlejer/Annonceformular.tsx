'use client'

// ═══════════════════════════════════════════════════════════════
//  Tre trin: boligen, kontakten, udgiv.
//
//  Alle tre trin ligger i ÉN formular. Felterne bliver stående i DOM'en,
//  når man skifter trin — ellers ville et tilbage-tryk tømme det, brugeren
//  lige skrev.
//
//  Men et `required` felt i et SKJULT trin kan browseren ikke give fokus,
//  og så fejler indsendelsen tavst: ingen fejlboble, ingen handling, intet
//  at forstå. Derfor springer `paaSubmit` selv til det trin, hvor det
//  første ugyldige felt står, og lader browseren pege på det bagefter.
// ═══════════════════════════════════════════════════════════════

import { useActionState, useState } from 'react'
import { gemBolig, uploadBillede, type Svar } from './handlinger'

export interface Udgangspunkt {
  id?: string
  adresse?: string; postnr?: string; boligtype?: string
  areal?: number | null; vaerelser?: number | null
  husleje?: number | null; varme?: number | null; vand?: number | null
  el?: number | null; oevrig?: number | null
  depositum?: number | null; forudbetalt?: number | null
  ledigFra?: string | null; beskrivelse?: string | null
  kontaktMail?: string | null; kontaktTlf?: string | null
  billeder?: string[]
}

const kr = (o: number | null | undefined) => (o == null ? '' : String(o / 100))

const TRIN = ['Boligen', 'Kontakt', 'Udgiv'] as const

export function Annonceformular({ start = {} }: { start?: Udgangspunkt }) {
  const [svar, action, venter] = useActionState<Svar, FormData>(gemBolig, {})
  const [trin, setTrin] = useState(0)
  const [billeder, setBilleder] = useState<{ url: string; vis: string }[]>(
    (start.billeder ?? []).map((url) => ({ url, vis: '' })),
  )
  const [uploader, setUploader] = useState(false)
  const [billedfejl, setBilledfejl] = useState<string | null>(null)

  async function tilfoej(filer: FileList | null) {
    if (!filer?.length) return
    setUploader(true); setBilledfejl(null)
    for (const fil of Array.from(filer)) {
      const fd = new FormData()
      fd.set('fil', fil)
      const r = await uploadBillede(fd)
      if (r.fejl) { setBilledfejl(r.fejl); break }
      if (r.url) setBilleder((b) => [...b, { url: r.url!, vis: r.forhaandsvisning ?? '' }])
    }
    setUploader(false)
  }

  /** Hvilket trin står feltet i? Bruges til at springe hen til en fejl. */
  function trinFor(el: Element): number {
    const sek = el.closest('section[data-trin]')
    return Number(sek?.getAttribute('data-trin') ?? 0)
  }

  function paaSubmit(e: React.FormEvent<HTMLFormElement>) {
    const form = e.currentTarget
    if (form.checkValidity()) return
    e.preventDefault()
    const foerste = form.querySelector(':invalid')
    if (!foerste) return
    const maal = trinFor(foerste)
    setTrin(maal)
    // Efter trinskiftet er feltet synligt, og browseren kan pege på det.
    requestAnimationFrame(() => {
      ;(foerste as HTMLInputElement).reportValidity?.()
      ;(foerste as HTMLElement).focus?.()
    })
  }

  return (
    <form className="annonce" action={action} onSubmit={paaSubmit}>
      {start.id && <input type="hidden" name="id" value={start.id} />}

      <ol className="trinbjaelke">
        {TRIN.map((t, i) => (
          <li key={t} className={i === trin ? 'nu' : i < trin ? 'gjort' : ''}>
            <button type="button" onClick={() => setTrin(i)}>
              <span>{i + 1}</span> {t}
            </button>
          </li>
        ))}
      </ol>

      {/* ── 1. Boligen ── */}
      <section className="blok" data-trin="0" hidden={trin !== 0}>
        <h2>Boligoplysninger</h2>
        <div className="felter">
          <div className="felt bred">
            <label htmlFor="adresse">Adresse</label>
            <input id="adresse" name="adresse" defaultValue={start.adresse ?? ''}
              placeholder="Nørrebrogade 56 B, 3. tv" required />
          </div>
          <div className="felt">
            <label htmlFor="postnr">Postnummer</label>
            <input id="postnr" name="postnr" defaultValue={start.postnr ?? ''}
              inputMode="numeric" pattern="\d{4}" required />
          </div>
          <div className="felt">
            <label htmlFor="boligtype">Boligtype</label>
            <select id="boligtype" name="boligtype" defaultValue={start.boligtype ?? 'lejlighed'}>
              <option value="lejlighed">Lejlighed</option>
              <option value="raekkehus">Rækkehus</option>
              <option value="hus">Hus</option>
              <option value="vaerelse">Værelse</option>
            </select>
          </div>
          <div className="felt">
            <label htmlFor="areal">Areal (m²)</label>
            <input id="areal" name="areal" defaultValue={start.areal ?? ''} inputMode="numeric" />
          </div>
          <div className="felt">
            <label htmlFor="vaerelser">Værelser</label>
            <input id="vaerelser" name="vaerelser" defaultValue={start.vaerelser ?? ''} inputMode="numeric" />
          </div>
          <div className="felt">
            <label htmlFor="ledigFra">Ledig fra</label>
            <input id="ledigFra" name="ledigFra" type="date" defaultValue={start.ledigFra ?? ''} />
          </div>
        </div>

        <h3 className="underoverskrift">Økonomi</h3>
        <p className="note">
          Skriv aconto opdelt, hvis du kan. Så kan din annonce vise den samlede
          månedlige udgift — og det er det, folk søger på hos os. Skriver du kun
          huslejen, står der ærligt, at aconto ikke er oplyst.
        </p>
        <div className="felter">
          <div className="felt"><label htmlFor="husleje">Husleje pr. md. (kr.)</label>
            <input id="husleje" name="husleje" defaultValue={kr(start.husleje)} inputMode="numeric" required /></div>
          <div className="felt"><label htmlFor="varme">Aconto varme</label>
            <input id="varme" name="varme" defaultValue={kr(start.varme)} inputMode="numeric" /></div>
          <div className="felt"><label htmlFor="vand">Aconto vand</label>
            <input id="vand" name="vand" defaultValue={kr(start.vand)} inputMode="numeric" /></div>
          <div className="felt"><label htmlFor="el">Aconto el</label>
            <input id="el" name="el" defaultValue={kr(start.el)} inputMode="numeric" /></div>
          <div className="felt"><label htmlFor="oevrig">Øvrig aconto</label>
            <input id="oevrig" name="oevrig" defaultValue={kr(start.oevrig)} inputMode="numeric" /></div>
          <div className="felt"><label htmlFor="depositum">Depositum</label>
            <input id="depositum" name="depositum" defaultValue={kr(start.depositum)} inputMode="numeric" /></div>
          <div className="felt"><label htmlFor="forudbetalt">Forudbetalt leje</label>
            <input id="forudbetalt" name="forudbetalt" defaultValue={kr(start.forudbetalt)} inputMode="numeric" /></div>
        </div>

        <h3 className="underoverskrift">Beskrivelse</h3>
        <textarea name="beskrivelse" rows={6} defaultValue={start.beskrivelse ?? ''}
          placeholder="Skriv om boligen. Din tekst står, som du skriver den." />

        <h3 className="underoverskrift">Billeder</h3>
        <input type="file" accept="image/*" multiple disabled={uploader}
          onChange={(e) => { void tilfoej(e.target.files); e.target.value = '' }} />
        {uploader && <p className="note">Uploader …</p>}
        {billedfejl && <p className="formfejl">{billedfejl}</p>}
        <div className="billedliste">
          {billeder.map((b, i) => (
            <div key={b.url} className="billedfelt">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {b.vis ? <img src={b.vis} alt="" /> : <span className="billedtom">Gemt</span>}
              <input type="hidden" name="billeder" value={b.url} />
              <button type="button" onClick={() => setBilleder((b) => b.filter((_, j) => j !== i))}>
                Fjern
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ── 2. Kontakt ── */}
      <section className="blok" data-trin="1" hidden={trin !== 1}>
        <h2>Kontaktoplysninger</h2>
        <p className="note">
          Sådan får lejeren fat i dig. Oplysningerne vises ikke frit — de er
          skjult, indtil lejeren har adgang. Udfyld mindst én af dem.
        </p>
        <div className="felter">
          <div className="felt bred">
            <label htmlFor="kontaktMail">Mailadresse</label>
            <input id="kontaktMail" name="kontaktMail" type="email" defaultValue={start.kontaktMail ?? ''} />
          </div>
          <div className="felt bred">
            <label htmlFor="kontaktTlf">Telefon</label>
            <input id="kontaktTlf" name="kontaktTlf" type="tel" defaultValue={start.kontaktTlf ?? ''} />
          </div>
        </div>
      </section>

      {/* ── 3. Udgiv ── */}
      <section className="blok" data-trin="2" hidden={trin !== 2}>
        <h2>Udgiv annoncen</h2>
        <p>Det koster ikke noget at oprette en annonce indtil videre.</p>
        <p className="note">
          Når du udgiver, står boligen på Bofinda sammen med de øvrige. Du kan
          rette og fjerne den igen, når du vil.
        </p>
        {svar?.fejl && <p className="formfejl">{svar.fejl}</p>}
        <button type="submit" disabled={venter || uploader}>
          {venter ? 'Gemmer …' : start.id ? 'Gem ændringer' : 'Udgiv annoncen'}
        </button>
      </section>

      <div className="trinknapper">
        {trin > 0 && <button type="button" className="nulstil" onClick={() => setTrin(trin - 1)}>Tilbage</button>}
        {trin < 2 && <button type="button" onClick={() => setTrin(trin + 1)}>Videre</button>}
      </div>
    </form>
  )
}
