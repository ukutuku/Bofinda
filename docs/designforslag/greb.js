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

  // ── Fotoet: ét objekt (i appen HERO_STANDARD, her heltefoto.json) ─
  // url, kredit, fokus og slør følges ad. greb.css læser variablerne;
  // intet andet sted i laget kender motivet.
  const hero = $('.hero.har-foto')
  const foto = variant.foto
  const sidensUrl = hero && $('.hero-billede img', hero) ? $('.hero-billede img', hero).getAttribute('src') : null
  if (hero && foto) {
    const img = $('.hero-billede img', hero)
    if (img && foto.url && img.getAttribute('src') !== foto.url) img.src = foto.url
    const s = hero.style
    if (foto.fokus) s.setProperty('--hero-fokus', foto.fokus)
    if (foto.fokusSmal) s.setProperty('--hero-fokus-smal', foto.fokusSmal)
    if (foto.sloer != null) s.setProperty('--hero-sloer', String(foto.sloer))
    if (foto.sloerSmal != null) s.setProperty('--hero-sloer-smal', String(foto.sloerSmal))
  }
  // Telefonens hero er B og kræver ingen klasse (greb.css § 6).

  // ── Krediteringen: INGEN markupændring (greb.css § 7) ─────────────
  // CSS'en flytter det element, page.tsx allerede tegner. Mockuppen gør
  // kun det, page.tsx gør, når fotoet skiftes: teksten følger fotoobjektet.
  // Et NYT motiv uden kreditering får intet navn — aldrig den forrige
  // fotografs (page.tsx: «ellers tilskriver siden en fotograf et billede,
  // hun ikke har taget») — og page.tsx tegner da intet element.
  // maal-foto.mjs afviser et foto uden kreditering.
  const kr = $('.hero-kredit')
  if (hero && foto && foto.url && foto.url !== sidensUrl) {
    if (foto.kredit) {
      const p = kr || Object.assign(document.createElement('p'), { className: 'hero-kredit' })
      p.textContent = foto.kredit
      if (!kr) hero.append(p)
    } else if (kr) kr.remove()
  }

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
    // «Antal værelser», ikke «Værelser»: fanen «Værelser» ovenover er
    // boligtypen. Samme ord 70 px fra hinanden med to betydninger.
    const felter = [['Pris pr. måned', 'Op til … kr.'], ['Størrelse', 'Mindst … m²'], ['Antal værelser', 'Alle']]
    sted.insertAdjacentHTML('afterend', felter.map(([l, v]) =>
      `<div class="soegefelt-ekstra"><label>${l}</label><span>${v}</span></div>`).join(''))
  }

  // ── Håndskriften, kun i varianten ───────────────────────────────
  const manchet = $('.hero-manchet')
  if (variant.haand && manchet && !$('.hero-haand')) {
    manchet.insertAdjacentHTML('afterend', '<p class="hero-haand" aria-hidden="true">Hjem starter her</p>')
  }

  // ── Nul-chippen: «0 med indflytningspris» tegnes ikke ───────────
  // Tærsklen er N = 0 og ingen andel. Fraværet forsvinder ikke: det står
  // som én sætning under rækken, for chippen er i dag det ENESTE sted,
  // det står (kortet og boligsiden tier, når prisen mangler). «N med
  // samlet pris til udlejer» får ingen tærskel — ved 0 er den rækkens
  // vigtigste oplysning. Antallet er titlens «(N)», ikke kortenes.
  const optael = $('.optaelling')
  if (optael && !optael.dataset.nul) {
    const nul = [...optael.children].find((c) => /^0 med indflytningspris$/.test(c.textContent.trim()))
    const antal = tal($('.titeltal'))
    if (nul) {
      nul.remove(); optael.dataset.nul = '1'
      const p = document.createElement('p')
      p.className = 'prisnote'
      const hvem = !antal ? 'boligerne' : antal === '1' ? 'boligen' : `de ${Number(antal).toLocaleString('da-DK')}`
      p.textContent = `Ingen indflytningspris for ${hvem} — spørg udlejeren.`
      optael.after(p)
    }
  }

  // ── Mærkaten: «Ny i dag» / «Ny i går» / «Ny · N dage» ──────────
  // KUN ORDLYDEN er forslaget. Mockuppen gætter dagen ud fra siden()'s
  // afrundede tekst, fordi markuppen ikke bærer datoen — og det er
  // forkert: «for 20 timer siden» er i går, hvis klokken er 08. I appen
  // skal ordet regnes af NYHEDSDATO (så indkøringsvagten følger med) og
  // kalenderdagen i København (kalenderdag() i lib/dato.ts), ét sted
  // for begge korttyper. Se GREB-3.md, «Observationen».
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
        <div><dt>${Number(kendt).toLocaleString('da-DK')}</dt><dd>med hele den månedlige betaling til udlejer${pct != null ? ` (${pct} %)` : ''}</dd></div>
      </dl>
      <p class="uk-note">Talt af alle synlige boliger, dubletter fjernet. Samme tal som søgningen.</p>
    </aside>`)
    // Tallene står nu ét sted. Talstriben beholder resten.
    hus.remove(); moent.remove()
  }
}
