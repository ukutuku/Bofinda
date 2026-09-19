// ═══════════════════════════════════════════════════════════════
//  RIGTIGT touchinput — gennem browserens egen inputkø.
//
//  ═══ HVORFOR DETTE OG IKKE dispatchEvent(new TouchEvent(…)) ═══
//
//  Et `TouchEvent`, JavaScript selv laver og sender, er en DOM-hændelse
//  og intet andet. Den springer hele browserens inputvej over:
//  træfprøven, `touch-action`, gestus-genkendelsen, rulningen, det
//  syntetiske klik efter et tryk, og knib-zoom. Den kan altså vise, at
//  VORES lyttere er koblet rigtigt på — og den kan ikke vise, om en
//  finger på en telefon ville gøre det samme.
//
//  Det her går gennem CDP'ens `Input.dispatchTouchEvent`, som er den
//  samme vej, en rigtig finger tager: renderer-processens inputkø.
//  Derfor kan de her hjælpere måle det, den syntetiske hændelse ikke
//  kan — at siden faktisk RULLER af en lodret bevægelse, at et tryk
//  faktisk NAVIGERER, og at to fingre faktisk ZOOMER.
//
//  Efterprøvet i dette miljø: lodret pan ruller (scrollY 0 → 153),
//  to-finger-knib giver `visualViewport.scale` 1 → 4,37.
//  `Input.synthesizePinchGesture` svarer «Position out of bounds» og
//  bruges derfor ikke; de rå touchpunkter kan det samme.
// ═══════════════════════════════════════════════════════════════

/** En CDP-session til siden. Én pr. side; genbrug den. */
export const touchsession = (side) => side.context().newCDPSession(side)

const send = (s, type, touchPoints) =>
  s.send('Input.dispatchTouchEvent', { type, touchPoints })

/**
 * Et tryk. `touchStart` + `touchEnd` på samme punkt, som en finger, der
 * sættes og løftes — browseren laver selv det syntetiske klik bagefter.
 */
export async function tryk(s, x, y) {
  await send(s, 'touchStart', [{ x, y }])
  await send(s, 'touchEnd', [])
}

/**
 * Et svirp med én finger, i `trin` mellemstop.
 *
 * Mellemstoppene er ikke pynt: gestus-genkendelsen har brug for en
 * bevægelse for at kunne skelne et svirp fra et tryk, og vores egen
 * retningslås i `useBladring` har brug for mindst ét `touchmove`, før
 * den kan afgøre, om bevægelsen er vandret eller lodret.
 */
export async function svirp(s, fra, til, { trin = 14, pause = 8 } = {}) {
  await send(s, 'touchStart', [{ x: fra.x, y: fra.y }])
  for (let i = 1; i <= trin; i++) {
    const t = i / trin
    await send(s, 'touchMove', [{
      x: fra.x + (til.x - fra.x) * t,
      y: fra.y + (til.y - fra.y) * t,
    }])
    if (pause) await new Promise((r) => setTimeout(r, pause))
  }
  await send(s, 'touchEnd', [])
}

/**
 * Knib med to fingre om et midtpunkt. `fra`/`til` er halvdelen af
 * afstanden mellem fingrene i px.
 *
 * `Input.synthesizePinchGesture` ville være kortere, men den svarer
 * «Position out of bounds» i dette miljø. To rå punkter gør det samme
 * og er tættere på, hvad en hånd gør.
 */
export async function knib(s, midt, { fra = 20, til = 120, trin = 10, pause = 16 } = {}) {
  const punkter = (d) => [
    { id: 1, x: midt.x - d, y: midt.y },
    { id: 2, x: midt.x + d, y: midt.y },
  ]
  await send(s, 'touchStart', punkter(fra))
  for (let i = 1; i <= trin; i++) {
    await send(s, 'touchMove', punkter(fra + ((til - fra) * i) / trin))
    await new Promise((r) => setTimeout(r, pause))
  }
  await send(s, 'touchEnd', [])
}

/** Zoomniveauet, som browseren selv opgiver det. */
export const zoom = (side) => side.evaluate(() => window.visualViewport.scale)

/** Sæt zoom tilbage til 1, så næste måling starter et kendt sted. */
export const nulstilZoom = async (s, midt) => {
  await knib(s, midt, { fra: 120, til: 20, trin: 10 })
  await new Promise((r) => setTimeout(r, 400))
}
