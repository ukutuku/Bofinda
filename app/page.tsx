import {
  antalBoliger, filtreFraParametre, harFiltre,
  opsummering, soegGrupperet, type Soegeparametre,
} from '../lib/soeg'
import { facetterCached, forsidetalCached } from './cache'
import { GemSoegning } from './GemSoegning'
import { Visningskort, kr } from './Boligkort'
import { Landkort, type Maerke } from './Landkort'

export const dynamic = 'force-dynamic'

// ─── Siden ─────────────────────────────────────────────────────

/** Kilderne gemmer typen uden danske bogstaver. */
const TYPENAVN: Record<string, string> = {
  lejlighed: 'Lejlighed', hus: 'Hus', raekkehus: 'Rækkehus',
  vaerelse: 'Værelse', studiebolig: 'Studiebolig', andet: 'Anden bolig',
}

/**
 * Til- og fravalg af kortet, som et almindeligt link.
 *
 * Tilstanden ligger i URL'en ligesom alt andet: den kan deles, den
 * overlever et genindlæs, og listen er allerede bred på serveren — så den
 * hopper ikke i bredden, når siden er færdig.
 */
function kortLink(sp: Soegeparametre, visesNu: boolean): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (v == null || k === 'kort') continue
    for (const x of Array.isArray(v) ? v : [v]) q.append(k, x)
  }
  if (visesNu) q.set('kort', '0')
  const s = q.toString()
  return s ? `/?${s}` : '/'
}

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
  // Listen viser KORT, ikke boliger: ens boliger paa samme vej til samme
  // pris staar som ét. Grupperingen er kun en visning — alarmen matcher
  // stadig paa de enkelte boliger gennem hvor().
  //
  // Efter hinanden, ikke i Promise.all. Webappen har ÉN forbindelse i
  // puljen (transaction-pooleren, se db/client.ts), og fire samtidige
  // kæder bliver til pipelinede sætninger paa den ene forbindelse. Det
  // holdt lige akkurat, indtil facetter fik en forespørgsel mere — saa
  // hang hver eneste listeside i minutter. Samlet tager de otte
  // forespørgsler under et sekund i raekke.
  //
  // De to sidste er cachede (se app/cache.ts) og rammer sjældent basen.
  // Tilbage er to forespørgsler pr. sidevisning mod otte før.
  const visninger = await soegGrupperet(f)
  const sum = await opsummering(f)
  const fac = await facetterCached()
  const tal = await forsidetalCached()
  const vist = antalBoliger(visninger)
  const sted = en(sp.sted) ?? f.postnr ?? f.by ?? ''

  // ── Kortet ───────────────────────────────────────────────────
  // Slaas fra med ?kort=0. Tilstanden ligger i URL'en som alt andet paa
  // siden: saa kan den deles, den overlever et genindlaes, og listen er
  // allerede bred paa serveren — den hopper ikke, naar siden er klar.
  // Kun naar der er filtreret. Uden en soegning spaender maerkerne over
  // hele landet, og udsnittet siger ingenting. Samme regel som gem-boksen
  // og prisnoten: paa forsiden er det svar paa et spoergsmaal, brugeren
  // ikke har stillet.
  const kortVises = soegt && en(sp.kort) !== '0'
  // Ét maerke pr. KORT, ikke pr. bolig: en gruppe er ét maerke med sit
  // antal. Hoejst 48, fordi listen hoejst viser 48.
  const maerker: Maerke[] = []
  const udenPlacering: { navn: string; antal: number }[] = []
  for (const v of visninger) {
    const b = v.slags === 'gruppe' ? v.gruppe.repraesentant : v.bolig
    const antal = v.slags === 'gruppe' ? v.gruppe.antal : 1
    if (b.lat && b.lng) {
      maerker.push({
        id: b.id, lat: Number(b.lat), lng: Number(b.lng), antal,
        etiket: v.slags === 'gruppe' ? `${b.vej ?? b.adresse} — ${antal} boliger` : b.adresse,
      })
    } else {
      const k = udenPlacering.find((x) => x.navn === b.kildeNavn)
      if (k) k.antal += antal
      else udenPlacering.push({ navn: b.kildeNavn, antal })
    }
  }
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
            <option value="pris_op">md. udgift, lav til høj</option>
            <option value="pris_ned">md. udgift, høj til lav</option>
            <option value="indflytning_op">indflytningspris, laveste først</option>
            <option value="indflytning_ned">indflytningspris, højeste først</option>
            <option value="areal_ned">størst først</option>
          </select>
        </div>

        {/* Kun typer kilderne faktisk leverer. Skemaets enum har seks
            værdier; tre af dem findes i data. */}
        {fac.typer.length > 1 && (
          <div className="felt bred">
            <label>Boligtype</label>
            <div className="valgraekke">
              {fac.typer.map((t) => (
                <label key={t.type} className="valg">
                  <input
                    type="checkbox" name="type" value={t.type!}
                    defaultChecked={f.boligtyper?.includes(t.type!) ?? false}
                  />
                  {TYPENAVN[t.type!] ?? t.type} <span>{t.antal}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="felt afkryds">
          <input type="checkbox" id="fuld" name="fuld" value="1" defaultChecked={f.fuldOekonomi} />
          <label htmlFor="fuld">Fuld økonomi kendt</label>
        </div>

        {/* Vises kun, hvis nogen faktisk oplyser feltet. Et filter, der
            aldrig giver træf, er værre end intet filter. */}
        {fac.faciliteter.kaeledyr > 0 && (
          <div className="felt afkryds">
            <input type="checkbox" id="kaeledyr" name="kaeledyr" value="1" defaultChecked={f.kaeledyr} />
            <label htmlFor="kaeledyr">Kæledyr tilladt</label>
          </div>
        )}
        {fac.faciliteter.elevator > 0 && (
          <div className="felt afkryds">
            <input type="checkbox" id="elevator" name="elevator" value="1" defaultChecked={f.elevator} />
            <label htmlFor="elevator">Elevator</label>
          </div>
        )}
        {fac.faciliteter.udeplads > 0 && (
          <div className="felt afkryds">
            <input type="checkbox" id="udeplads" name="udeplads" value="1" defaultChecked={f.udeplads} />
            <label htmlFor="udeplads">Altan eller terrasse</label>
          </div>
        )}
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

      {/* Faciliteter er en POSITIV liste. Filtrerer hun på elevator, ryger
          alle boliger fra kilder, der bare ikke skriver det — og det ligner
          "der er ingen". Det skal stå på skærmen, ikke kun i koden. */}
      {soegt && (f.kaeledyr || f.elevator || f.udeplads)
        && fac.udenFacilitetsoplysning > 0 && (
        <p className="prisnote advarsel">
          Kun <strong>{fac.facilitetskilder.join(' og ')}</strong> oplyser faciliteter.
          {' '}De {fac.udenFacilitetsoplysning.toLocaleString('da-DK')} boliger fra de øvrige
          kilder er ikke med her — fordi kilden tier om det, ikke fordi boligen mangler det.
        </p>
      )}

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

      <div className="listehoved">
        {!soegt && visninger.length > 0 && (
          <h2 className="listetitel">Nyeste boliger</h2>
        )}
        {soegt && visninger.length > 0 && (
          <a className="kortknap" href={kortLink(sp, kortVises)}>
            {kortVises ? 'Skjul kort' : 'Vis kort'}
          </a>
        )}
      </div>

      {/* Tallet er BOLIGER, ikke kort. Et gruppekort daekker flere, og
          "viser 48 af 904" ville vaere forkert paa begge maader. */}
      {sum.antal > vist && (
        <p className="begraensning">
          Viser de {vist} nyeste af {sum.antal}. Brug filtrene for at indsnævre.
        </p>
      )}

      {visninger.length === 0 ? (
        <div className="tom">
          <p>Ingen boliger matcher.</p>
          <p>Prøv at fjerne et filter.</p>
        </div>
      ) : (
        <div className={kortVises ? 'medkort' : 'udenkort'}>
          <div className="liste">
            {visninger.map((v) => (
              <Visningskort
                key={v.slags === 'gruppe' ? `g:${v.gruppe.repraesentant.id}` : v.bolig.id}
                v={v}
              />
            ))}
          </div>

          {kortVises && (
            <aside className="kortspalte">
              <div className="kortboks">
                <Landkort maerker={maerker} />
              </div>
              {/* Kilde-oplysning, ikke en fejlmelding: det er kilden der
                  ikke oplyser placeringen, ikke boligen der mangler noget.
                  Boligerne staar stadig i listen. */}
              {udenPlacering.length > 0 && (
                <p className="kortnote">
                  {udenPlacering.map((k) => `${k.navn} oplyser ikke placering`).join(' · ')}
                  {' — '}
                  {udenPlacering.reduce((a, k) => a + k.antal, 0) === 1
                    ? 'boligen står i listen uden mærke på kortet.'
                    : 'boligerne står i listen uden mærke på kortet.'}
                </p>
              )}
            </aside>
          )}
        </div>
      )}

      {/* Kilderne uden den native: "hentet fra ... og Bofinda" er ikke
          rigtigt — de annoncer er ikke hentet nogen steder, de er
          oprettet her. Og de aabner ikke hos en kilde. */}
      <footer className="bund">
        {`Boliger hentet fra ${fac.kilder
          .filter((k) => k.slug !== 'native')
          .map((k) => k.navn).join(' og ')}${
          fac.kilder.some((k) => k.slug === 'native')
            ? ', samt annoncer oprettet af udlejere selv.'
            : '.'}`}
        {' '}Klik på en bolig for at åbne den hos kilden eller for at se
        udlejerens kontaktoplysninger.
        Tal vises som kilden oplyser dem; mangler en oplysning, står den tom.
      </footer>
    </>
  )
}
