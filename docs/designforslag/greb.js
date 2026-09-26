// ═══════════════════════════════════════════════════════════════
//  MOCKUP af den markup, greb.css forudsætter. Køres i browseren oven på
//  den rigtige side, kun til skærmbillederne. Det er IKKE en løsning:
//  i appen hører det hjemme i app/page.tsx, renderet på serveren.
//
//  Intet her opfinder et tal. Fanernes antal læses af filtervinduets
//  egne tællere (facetter()), og kortet på båndet læser talstriben
//  (forsidetal()). Findes et tal ikke på siden, vises feltet ikke.
// ═══════════════════════════════════════════════════════════════
window.__bofindaForslag = (variant = {}) => {
  const $ = (s, r = document) => r.querySelector(s)
  const tal = (el) => (el ? el.textContent.replace(/\D/g, '') : '')

  // ── Faner hæftet ovenpå søgekortet: boligtyper med boliger ──────
  const form = $('.hero-soeg form.filtre')
  if (form && !$('.soeg-faner')) {
    const antal = (v) => tal($(`.valgknap input[name="type"][value="${v}"] + span b`))
    const faner = [['Alle lejeboliger', '/', ''], ['Lejligheder', '/?type=lejlighed', antal('lejlighed')],
      ['Huse', '/?type=hus', antal('hus')], ['Værelser', '/?type=vaerelse', antal('vaerelse')]]
      .filter(([, , n], i) => i === 0 || Number(n) > 0)
    const nav = document.createElement('nav')
    nav.className = 'soeg-faner'; nav.setAttribute('aria-label', 'Boligtype')
    nav.innerHTML = faner.map(([navn, href, n], i) =>
      `<a href="${href}"${i === 0 ? ' aria-current="page"' : ''}>${navn}${n ? ` <b>${n}</b>` : ''}</a>`).join('')
    form.before(nav)
  }

  // ── Felterne i søgekortet (kun bred skærm, se greb.css) ─────────
  // Flyttes fra filtervinduet, ikke kopieres: to prisMax i samme formular
  // er den tavse fejl, stedet() blev rettet for. Her er de uden name.
  const sted = $('.hero .sf-sted')
  if (sted && !$('.soegefelt-ekstra')) {
    const felter = [['Pris pr. måned', 'Op til … kr.'], ['Størrelse', 'Mindst … m²'], ['Værelser', 'Alle']]
    sted.insertAdjacentHTML('afterend', felter.map(([l, v]) =>
      `<div class="soegefelt-ekstra"><label>${l}</label><span>${v}</span></div>`).join(''))
  }

  // ── Håndskriften, kun i varianten ───────────────────────────────
  const manchet = $('.hero-manchet')
  if (variant.haand && manchet && !$('.hero-haand')) {
    manchet.insertAdjacentHTML('afterend', '<p class="hero-haand" aria-hidden="true">Hjem starter her</p>')
  }

  // ── Mærkaten: «Ny i dag» / «Ny i går» / «Ny · N dage» ──────────
  // Samme kilde som i dag: source_created_at, ellers first_seen_at.
  for (const m of document.querySelectorAll('.maerkat.m-ny')) {
    const t = m.textContent
    const d = /(\d+) dag/.exec(t)
    m.textContent = /min\.|time|lige nu/.test(t) ? 'Ny i dag' : d ? (d[1] === '1' ? 'Ny i går' : `Ny · ${d[1]} dage`) : m.textContent
  }

  // ── Båndet: ét svævende kort med dokumenterbare tal ─────────────
  const baand = $('.udlejerbaand')
  const hus = $('.talstribe .ts-hus'), moent = $('.talstribe .ts-moent')
  if (baand && hus && moent && !$('.ub-kort')) {
    const boliger = tal(hus.querySelector('strong'))
    const kilder = (/fra (\d+)/.exec(hus.textContent) || [])[1]
    const kendt = tal(moent.querySelector('strong'))
    const pct = boliger ? Math.round((100 * Number(kendt)) / Number(boliger)) : null
    const knap = $('.ub-knap', baand); if (knap) $('.ub-tekst', baand).append(knap)
    baand.insertAdjacentHTML('beforeend', `<aside class="ub-kort" aria-label="Talt i dag">
      <p class="uk-etiket">Talt i dag</p>
      <dl>
        <div><dt>${Number(boliger).toLocaleString('da-DK')}</dt><dd>ledige lejeboliger${kilder ? ` fra ${kilder} kilder` : ''}</dd></div>
        <div><dt class="kendt">${Number(kendt).toLocaleString('da-DK')}</dt><dd>med hele den månedlige betaling til udlejer${pct != null ? ` (${pct} %)` : ''}</dd></div>
      </dl>
      <p class="uk-note">Talt af alle synlige boliger, dubletter fjernet. Samme tal som søgningen.</p>
    </aside>`)
    // Tallene står nu ét sted. Talstriben beholder resten.
    hus.remove(); moent.remove()
  }
}
