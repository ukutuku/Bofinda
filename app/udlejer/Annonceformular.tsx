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

import { useActionState, useEffect, useRef, useState } from 'react'
import { gemBolig, registrerBillede, signerUpload, type Svar } from './handlinger'
import { klargoer, MAKS_BILLEDER, MAKS_FIL } from './billedklient'
import { FACILITETER } from '../../lib/faciliteter'
import type { Boliginput } from '../../lib/udlejer'

interface Billede { url: string; vis: string; navn: string }
interface Igang { navn: string; vis: string }

/**
 * Formularens udgangspunkt. Bygges af `somFormular` i lib/udlejer.ts, saa
 * testen af rundturen bruger praecis den samme afbildning som siden.
 */
export type Udgangspunkt = Partial<Omit<Boliginput, 'billeder'>> & {
  id?: string
  billeder?: { url: string; vis: string }[]
}

const kr = (o: number | null | undefined) => (o == null ? '' : String(o / 100))

const TRIN = ['Boligen', 'Kontakt', 'Udgiv'] as const

export function Annonceformular({ start = {} }: { start?: Udgangspunkt }) {
  const [svar, action, venter] = useActionState<Svar, FormData>(gemBolig, {})
  const [trin, setTrin] = useState(0)
  const [billeder, setBilleder] = useState<Billede[]>(
    (start.billeder ?? []).map((b, i) => ({ ...b, navn: `Billede ${i + 1}` })),
  )
  /** Hvad der uploades LIGE NU. Tom liste = ingen upload i gang. */
  const [igang, setIgang] = useState<Igang[]>([])
  const [billedfejl, setBilledfejl] = useState<string | null>(null)
  const uploader = igang.length > 0

  /** Traekker nogen filer hen over slipfeltet lige nu? */
  const [overSlipfelt, setOverSlipfelt] = useState(false)
  /** dragenter/dragleave fyrer ogsaa for BOERN. Uden en taeller blinker
   *  rammen, hver gang markoeren passerer et element inde i feltet. */
  const dybde = useRef(0)
  /** Hvilken miniature traekkes, og hvor er den henne? */
  const [traekker, setTraekker] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  /** Sagt hoejt til skaermlaesere efter et tastaturtryk. */
  const [melding, setMelding] = useState('')
  /** Knappen der skal have fokus, naar omrokeringen er tegnet. */
  const [fokus, setFokus] = useState<string | null>(null)
  const flytknapper = useRef(new Map<string, HTMLButtonElement>())

  useEffect(() => {
    if (!fokus) return
    flytknapper.current.get(fokus)?.focus()
    setFokus(null)
  }, [fokus])

  /**
   * Rammer man ved siden af slipfeltet, AABNER browseren billedet i stedet
   * — og saa er hele den halvt udfyldte formular vaek, uden varsel og uden
   * vej tilbage. Vi tager imod overalt paa siden og goer ingenting.
   */
  useEffect(() => {
    const stop = (e: DragEvent) => {
      if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault()
    }
    window.addEventListener('dragover', stop)
    window.addEventListener('drop', stop)
    return () => {
      window.removeEventListener('dragover', stop)
      window.removeEventListener('drop', stop)
    }
  }, [])

  /**
   * Traekker musen FILER — eller en miniature?
   *
   * Slipfeltet og miniaturerne ligger i det samme omraade. Uden det her
   * ville et forsoeg paa at omarrangere billeder blive laest som en upload.
   */
  const erFiler = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types).includes('Files')

  /**
   * Flytter ét billede. Rækkefoelgen i listen ER rækkefoelgen i basen:
   * de skjulte felter sendes i DOM-orden, og `opretBolig` skriver
   * `position` ud fra array-indekset.
   */
  function flyt(fra: number, til: number) {
    if (fra === til || til < 0 || til >= billeder.length) return
    const flyttet = billeder[fra]!
    setBilleder((b) => {
      const n = [...b]
      const [x] = n.splice(fra, 1)
      n.splice(til, 0, x!)
      return n
    })
    setMelding(
      `${flyttet.navn} er nu nummer ${til + 1} af ${billeder.length}.`
      + (til === 0 ? ' Det er forsidebilledet.' : ''),
    )
    // Efter omrokeringen kan den knap, der lige blev trykket paa, vaere
    // blevet deaktiveret — foerste plads har ingen "frem". Saa skal fokus
    // til den anden vej, ellers falder det til <body>, og tastaturbrugeren
    // mister sin plads i listen.
    const retning = til < fra ? 'frem' : 'tilbage'
    const kanFortsaette = retning === 'frem' ? til > 0 : til < billeder.length - 1
    setFokus(`${flyttet.url}:${kanFortsaette ? retning : (retning === 'frem' ? 'tilbage' : 'frem')}`)
  }

  /**
   * Filen gaar direkte til bucket'en, ikke gennem os. Serveren udsteder
   * kun en signeret URL.
   *
   * Hele forloebet ligger i try/finally: fejler noget som helst — netvaerk,
   * lager, signatur — skal tilstanden nulstilles og fejlen vises. En
   * formular der fryser uden at sige hvorfor, er vaerre end en der fejler.
   */
  async function tilfoej(filer: FileList | null) {
    if (!filer?.length) return
    setBilledfejl(null)

    // Loft. Listen foejede foer bare til, uden at vise hvor mange der laa —
    // en annonce endte med 31 billeder, hvor udlejeren troede der var fire.
    const plads = MAKS_BILLEDER - billeder.length
    if (plads <= 0) {
      setBilledfejl(`Du kan have højst ${MAKS_BILLEDER} billeder. Fjern et først.`)
      return
    }
    let valgte = Array.from(filer)
    // Samme fil to gange er nesten altid en fortrydelse, ikke et oenske.
    valgte = valgte.filter((f) => !billeder.some((b) => b.navn === f.name))
    if (!valgte.length) {
      setBilledfejl('De billeder er allerede tilføjet.')
      return
    }
    if (valgte.length > plads) {
      setBilledfejl(`Der er plads til ${plads} mere. De første ${plads} tilføjes.`)
      valgte = valgte.slice(0, plads)
    }
    setIgang(valgte.map((f) => ({ navn: f.name, vis: '' })))

    try {
      for (const fil of valgte) {
        let k: Awaited<ReturnType<typeof klargoer>> | null = null
        try {
          k = await klargoer(fil)
          setIgang((x) => x.map((y) => (y.navn === fil.name ? { ...y, vis: k!.visning } : y)))

          const sig = await signerUpload(k.navn)
          if (sig.fejl || !sig.url || !sig.sti) throw new Error(sig.fejl ?? 'Ingen upload-adresse.')

          const svar = await fetch(sig.url, {
            method: 'PUT',
            headers: { 'content-type': k.type },
            body: k.blob,
          })
          if (!svar.ok) throw new Error(`Lageret afviste billedet (${svar.status}).`)

          const reg = await registrerBillede(sig.sti)
          if (reg.fejl || !reg.url) throw new Error(reg.fejl ?? 'Billedet kunne ikke gøres synligt.')
          setBilleder((b) => [...b, {
            url: reg.url!, vis: reg.forhaandsvisning ?? '', navn: fil.name,
          }])
        } finally {
          if (k) URL.revokeObjectURL(k.visning)
        }
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Uploaden gik galt.'
      setBilledfejl(m)
      console.error('[udlejer] upload:', e)
    } finally {
      // Uanset hvad. Det var her formularen froes.
      setIgang([])
    }
  }

  /** Hvilket trin står feltet i? Bruges til at springe hen til en fejl. */
  function trinFor(el: Element): number {
    const sek = el.closest('section[data-trin]')
    return Number(sek?.getAttribute('data-trin') ?? 0)
  }

  /**
   * Videre tjekker det trin, man staar paa. En knap der flytter én videre
   * fra et halvt udfyldt trin, er en knap der udskyder fejlen — og saa
   * dukker den op paa trin tre, langt fra feltet den handler om.
   */
  function videre(e: React.MouseEvent<HTMLButtonElement>) {
    const form = e.currentTarget.form
    const sek = form?.querySelector(`section[data-trin="${trin}"]`)
    const felter = sek
      ? [...sek.querySelectorAll<HTMLInputElement>('input, select, textarea')]
      : []
    const daarlig = felter.find((f) => !f.checkValidity())
    if (daarlig) { daarlig.reportValidity(); daarlig.focus(); return }
    setTrin(trin + 1)
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
          {/* Adskilte felter. Samlet til én streng og parset igen blev
              "Nørrebrogade 30, 2200" til etage 22, dør 00. */}
          <div className="felt bred">
            <label htmlFor="vej">Vejnavn</label>
            <input id="vej" name="vej" defaultValue={start.vej ?? ''}
              placeholder="Nørrebrogade" required />
          </div>
          <div className="felt">
            <label htmlFor="husnr">Husnummer</label>
            <input id="husnr" name="husnr" defaultValue={start.husnr ?? ''}
              placeholder="56 B" required />
          </div>
          <div className="felt">
            <label htmlFor="etage">Etage</label>
            <input id="etage" name="etage" defaultValue={start.etage ?? ''} placeholder="3 eller st" />
          </div>
          <div className="felt">
            <label htmlFor="doer">Dør</label>
            <input id="doer" name="doer" defaultValue={start.doer ?? ''} placeholder="tv, th, 4" />
          </div>
          <div className="felt">
            <label htmlFor="postnr">Postnummer</label>
            <input id="postnr" name="postnr" defaultValue={start.postnr ?? ''}
              inputMode="numeric" pattern="\d{4}" required />
          </div>
          <div className="felt">
            <label htmlFor="by">By</label>
            <input id="by" name="by" defaultValue={start.by ?? ''} placeholder="København N" />
            <span className="felthjaelp">
              Udfyldes ud fra postnummeret. Kender vi det ikke, bruger vi det, du skriver.
            </span>
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

        <h3 className="underoverskrift">Faciliteter</h3>
        {/* Der bliver spurgt, fordi soegesiden filtrerer paa netop de her tre.
            Foer blev der ikke spurgt, og saa var feltet tomt — og et tomt felt
            gjorde annoncen usynlig for hvert af filtrene, for altid. */}
        <p className="note">
          Sæt kryds ved det, boligen har. Folk filtrerer på dem, og et felt du
          ikke sætter kryds i, betyder at boligen ikke har det.
        </p>
        <div className="felter">
          {FACILITETER.map((fac) => {
            const felt = `fac-${fac.vaerdi.replace(/\s+/g, '-')}`
            return (
              <div key={fac.vaerdi} className="felt afkryds">
                <input type="checkbox" id={felt} name="faciliteter" value={fac.vaerdi}
                  defaultChecked={start.faciliteter?.includes(fac.vaerdi) ?? false} />
                <label htmlFor={felt}>{fac.navn}</label>
              </div>
            )
          })}
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
        <p className="note">
          Billederne skaleres ned i din browser, før de sendes. Placeringsdata
          fra kameraet fjernes undervejs — et telefonbillede bærer ofte GPS for,
          hvor det er taget. Filer over {MAKS_FIL / 1024 / 1024} MB afvises.
        </p>
        {/* Slipfelt. Filvaelgeren staar inde i det og er stadig en
            almindelig <input type="file"> — traek-og-slip er en genvej,
            ikke den eneste vej ind. */}
        <div
          className={`slipfelt${overSlipfelt ? ' over' : ''}${uploader ? ' travl' : ''}`}
          onDragEnter={(e) => {
            if (!erFiler(e)) return
            e.preventDefault(); dybde.current++; setOverSlipfelt(true)
          }}
          onDragOver={(e) => {
            if (!erFiler(e)) return
            e.preventDefault(); e.dataTransfer.dropEffect = 'copy'
          }}
          onDragLeave={(e) => {
            if (!erFiler(e)) return
            dybde.current--
            if (dybde.current <= 0) { dybde.current = 0; setOverSlipfelt(false) }
          }}
          onDrop={(e) => {
            if (!erFiler(e)) return
            e.preventDefault(); dybde.current = 0; setOverSlipfelt(false)
            // Filvaelgeren er deaktiveret under en upload; slipfeltet skal
            // vaere det samme. To forloeb i gang paa én gang ville dele
            // `igang`-listen mellem sig.
            if (uploader) {
              setBilledfejl('Vent til den igangværende upload er færdig.')
              return
            }
            void tilfoej(e.dataTransfer.files)
          }}
        >
          <p className="sliptekst">
            {uploader ? 'Uploader … vent med at tilføje flere.'
              : 'Træk billeder herind — eller vælg dem:'}
          </p>
          <input type="file" accept="image/*" multiple
            disabled={uploader || billeder.length >= MAKS_BILLEDER}
            onChange={(e) => { void tilfoej(e.target.files); e.target.value = '' }} />
        </div>
        <p className="billedtaeller">
          <strong>{billeder.length}</strong> af højst {MAKS_BILLEDER} billeder
          {billeder.length >= MAKS_BILLEDER && ' — fjern et for at tilføje flere'}
        </p>
        {billedfejl && <p className="formfejl">{billedfejl}</p>}

        {billeder.length > 1 && (
          <p className="note">
            Det første billede er <strong>forsidebilledet</strong> — det er
            det, folk ser i søgeresultatet. Træk miniaturerne for at bytte om,
            eller brug pilene under hvert billede.
          </p>
        )}

        {/* Skaermlaeseren faar besked, naar noget flytter sig. Uden den er
            piletasterne en handling uden svar. */}
        <p className="skjult-for-oejet" role="status" aria-live="polite">{melding}</p>

        <ul className="billedliste">
          {billeder.map((b, i) => (
            <li
              key={b.url}
              className={`billedfelt${traekker === i ? ' traekkes' : ''}`
                + `${over === i && traekker !== i ? ' slipher' : ''}`}
              draggable
              onDragStart={(e) => {
                setTraekker(i)
                e.dataTransfer.effectAllowed = 'move'
                // Egen type, ikke "Files" — saa ved slipfeltet, at det her
                // er en omrokering og ikke en upload.
                e.dataTransfer.setData('application/x-bofinda-billede', String(i))
              }}
              onDragEnd={() => { setTraekker(null); setOver(null) }}
              onDragOver={(e) => {
                if (traekker == null) return
                e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(i)
              }}
              onDrop={(e) => {
                if (traekker == null) return
                e.preventDefault(); flyt(traekker, i); setTraekker(null); setOver(null)
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {b.vis ? <img src={b.vis} alt="" /> : <span className="billedtom">Gemt</span>}
              <input type="hidden" name="billeder" value={b.url} />
              {i === 0 && <span className="forsidemaerke">Forside</span>}
              <button type="button" className="fjernbillede"
                aria-label={`Fjern ${b.navn}`}
                onClick={() => setBilleder((x) => x.filter((_, j) => j !== i))}>
                Fjern
              </button>
              <span className="billednavn" title={b.navn}>{b.navn}</span>
              <div className="billedknapper">
                <button
                  type="button" className="flytknap" disabled={i === 0}
                  ref={(el) => {
                    if (el) flytknapper.current.set(`${b.url}:frem`, el)
                    else flytknapper.current.delete(`${b.url}:frem`)
                  }}
                  aria-label={`Flyt ${b.navn} én plads frem`}
                  onClick={() => flyt(i, i - 1)}
                >←</button>
                <span className="billednummer">{i + 1}</span>
                <button
                  type="button" className="flytknap" disabled={i === billeder.length - 1}
                  ref={(el) => {
                    if (el) flytknapper.current.set(`${b.url}:tilbage`, el)
                    else flytknapper.current.delete(`${b.url}:tilbage`)
                  }}
                  aria-label={`Flyt ${b.navn} én plads tilbage`}
                  onClick={() => flyt(i, i + 1)}
                >→</button>
              </div>
            </li>
          ))}
          {/* Kun mens en upload faktisk koerer. */}
          {igang.map((g) => (
            <li key={`igang-${g.navn}`} className="billedfelt venter">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {g.vis ? <img src={g.vis} alt="" /> : <span className="billedtom">…</span>}
              <span className="billednavn" title={g.navn}>{g.navn}</span>
              <span className="billedstatus">Uploader …</span>
            </li>
          ))}
        </ul>
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
        {/* Deaktiveret uden begrundelse er en knap, der ikke virker. */}
        {uploader && <p className="note">Vent til billederne er uploadet.</p>}
        <button type="submit" disabled={venter || uploader}>
          {venter ? 'Gemmer …' : start.id ? 'Gem ændringer' : 'Udgiv annoncen'}
        </button>
      </section>

      <div className="trinknapper">
        {trin > 0 && (
          <button type="button" className="nulstil" onClick={() => setTrin(trin - 1)}>Tilbage</button>
        )}
        {trin < 2 && <button type="button" onClick={videre}>Videre</button>}
      </div>
    </form>
  )
}
