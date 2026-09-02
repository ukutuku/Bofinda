import {
  facetter, filtreFraParametre, forsidetal, harFiltre, opsummering, soeg,
  type Soegeparametre,
} from '../lib/soeg'
import { GemSoegning } from './GemSoegning'
import { Kort, kr } from './Boligkort'

export const dynamic = 'force-dynamic'

// ─── Siden ─────────────────────────────────────────────────────

/** Første værdi af en URL-parameter — til formularens defaultValue. */
const en = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : v

export default async function Side({ searchParams }: { searchParams: Promise<Soegeparametre> }) {
  const sp = await searchParams
  // Samme parsing som gem-formularen bruger. Se noten i lib/soeg.ts.
  const f = filtreFraParametre(sp)
  const kilderValgt = f.kilder

  // Har hun soegt? Uden filtre er det forsiden, med filtre er det
  // resultatsiden. Samme rute, to tilstande.
  const soegt = harFiltre(f)
  const [boliger, sum, fac, tal] = await Promise.all([
    soeg(f), opsummering(f), facetter(), forsidetal(),
  ])
  const sted = en(sp.sted) ?? f.postnr ?? f.by ?? ''
  // Over en time skifter vi ENHED, ikke paastand. Der maa aldrig staa
  // noget kortere, end vi har maalt.
  const timer = tal.minutterP90 == null ? null
    : (tal.minutterP90 / 60).toLocaleString('da-DK', { maximumFractionDigits: 1 })

  // Samme formular i begge tilstande — kun pladsen skifter. Paa forsiden
  // ligger den inde i hero-baandet, paa resultatsiden staar den alene
  // over listen.
  const formular = (
      <form className={soegt ? 'filtre soegt' : 'filtre'} method="get">
        <div className="storsoeg">
          <input
            type="text" name="sted" defaultValue={sted}
            placeholder="By eller postnummer"
            aria-label="By eller postnummer" list="byer"
          />
          <button type="submit">Find bolig</button>
        </div>

        {!soegt && (
          <p className="soegehint">Fx København S, Aarhus C eller 2300.</p>
        )}

        <details className="flere" open={soegt}>
        <summary>Flere filtre</summary>
        <div className="filtergitter">
        <div className="felt">
          <label htmlFor="by">By</label>
          <input id="by" name="by" defaultValue={f.by ?? ''} placeholder="fx København" list="byer" />
          <datalist id="byer">
            {fac.byer.map((b) => <option key={`${b.by}-${b.postnr}`} value={b.by ?? ''} />)}
          </datalist>
        </div>
        <div className="felt">
          <label htmlFor="postnr">Postnummer</label>
          <input id="postnr" name="postnr" defaultValue={f.postnr ?? ''} placeholder="fx 2300" inputMode="numeric" />
        </div>
        <div className="felt">
          <label htmlFor="prisMin">Md. udgift fra</label>
          <input id="prisMin" name="prisMin" defaultValue={en(sp.prisMin) ?? ''} inputMode="numeric" />
        </div>
        <div className="felt">
          <label htmlFor="prisMax">Md. udgift til</label>
          <input id="prisMax" name="prisMax" defaultValue={en(sp.prisMax) ?? ''} inputMode="numeric" />
        </div>
        <div className="felt">
          <label htmlFor="vaerelser">Værelser mindst</label>
          <input id="vaerelser" name="vaerelser" defaultValue={en(sp.vaerelser) ?? ''} inputMode="numeric" />
        </div>
        <div className="felt">
          <label htmlFor="areal">m² mindst</label>
          <input id="areal" name="areal" defaultValue={en(sp.areal) ?? ''} inputMode="numeric" />
        </div>
        <div className="felt">
          <label htmlFor="kilde">Kilde</label>
          <select id="kilde" name="kilde" defaultValue={kilderValgt?.[0] ?? ''}>
            <option value="">alle</option>
            {fac.kilder.map((k) => (
              <option key={k.slug} value={k.slug}>{k.navn} ({k.antal})</option>
            ))}
          </select>
        </div>
        <div className="felt">
          <label htmlFor="sorter">Sortér</label>
          <select id="sorter" name="sorter" defaultValue={f.sorter}>
            <option value="nyeste">nyeste først</option>
            <option value="pris_op">pris, lav til høj</option>
            <option value="pris_ned">pris, høj til lav</option>
            <option value="areal_ned">størst først</option>
          </select>
        </div>
        <div className="felt afkryds">
          <input type="checkbox" id="fuld" name="fuld" value="1" defaultChecked={f.fuldOekonomi} />
          <label htmlFor="fuld">Fuld økonomi kendt</label>
        </div>
        <div className="knapper">
          <button type="submit">Søg</button>
          <a className="nulstil" href="/">Nulstil</a>
        </div>
        </div>
        </details>
      </form>
  )

  return (
    <>
      {soegt ? formular : (
        <section className="forside-baand">
          <div className="hero">
            <h1>Se hvad boligen faktisk koster</h1>
            <p className="manchet">
              Vi samler ledige lejeboliger ét sted og viser den samlede månedlige
              udgift og prisen ved indflytning — ikke bare huslejen.
            </p>

            {/* Paastand, bevis, handling — i den raekkefoelge. Beviset stod
                foer under soegefeltet, hvor laeseren allerede var videre. */}
            <ul className="punkter">
              <li>
                <strong>{tal.boliger.toLocaleString('da-DK')}</strong>
                <span>ledige boliger fra {tal.kilder} kilder</span>
              </li>
              <li>
                <strong>{tal.fuldOekonomi.toLocaleString('da-DK')}</strong>
                <span>med hele økonomien oplyst</span>
              </li>
              {/* Det maalte tal, ikke en afrunding af det. "57 min." er saa
                  praecist, at ingen ville opdigte det — "under en time" er et
                  loefte. Stiger p90 over en time, skifter vi enhed, ikke
                  paastand: der maa ikke staa noget kortere, end vi har maalt. */}
              <li>
                {tal.minutterP90 == null ? (
                  <>
                    <strong className="ord">Hver time</strong>
                    <span>henter vi nye boliger fra kilderne</span>
                  </>
                ) : (
                  <>
                    <strong>
                      {tal.minutterP90 <= 60
                        ? <>{tal.minutterP90} <span className="enhed">min.</span></>
                        : <>{timer} <span className="enhed">{timer === '1' ? 'time' : 'timer'}</span></>}
                    </strong>
                    <span>fra en bolig annonceres, til den står her (9 ud af 10)</span>
                  </>
                )}
              </li>
            </ul>

            {formular}
          </div>
        </section>
      )}


      {/* Begge hoerer til paa resultatsiden. Paa forsiden er de stoej,
          foer brugeren har spurgt om noget. */}
      {soegt && <GemSoegning sp={sp} />}

      {soegt && (
        <p className="prisnote">
          Prisfilteret gælder den <strong>samlede månedlige udgift</strong> — husleje
          plus aconto. Kender vi ikke totalen, filtreres der på huslejen alene, og
          boligen kan være dyrere end grænsen.
        </p>
      )}

      {/* Uden filtre staar de samme tal allerede i hero'en ovenfor.
          Linjen hoerer til, hvor den siger noget nyt: om et udsnit. */}
      {soegt && (
        <div className="optaelling">
          <span><strong>{sum.antal}</strong> {sum.antal === 1 ? 'bolig' : 'boliger'}</span>
          <span>{sum.fuld} med fuld økonomi</span>
          <span>{sum.medIndflytning} med indflytningspris</span>
          {sum.billigst != null && sum.dyrest != null && (
            <span>{kr(sum.billigst)}–{kr(sum.dyrest)} kr/md</span>
          )}
        </div>
      )}

      {!soegt && boliger.length > 0 && (
        <h2 className="listetitel">Nyeste boliger</h2>
      )}

      {sum.antal > boliger.length && (
        <p className="begraensning">
          Viser de {boliger.length} nyeste af {sum.antal}. Brug filtrene for at indsnævre.
        </p>
      )}

      {boliger.length === 0 ? (
        <div className="tom">
          <p>Ingen boliger matcher.</p>
          <p>Prøv at fjerne et filter.</p>
        </div>
      ) : (
        <div className="liste">
          {boliger.map((b) => <Kort key={b.id} b={b} />)}
        </div>
      )}

      <footer className="bund">
        Boliger hentet fra {fac.kilder.map((k) => k.navn).join(' og ')}.
        Klik på en bolig for at åbne den hos kilden.
        Tal vises som kilden oplyser dem; mangler en oplysning, står den tom.
      </footer>
    </>
  )
}
