// ═══════════════════════════════════════════════════════════════
//  Låst adgang: én kort forklaring og ÉN knap.
//
//  ═══ DER ER INTET INDHOLD AT SKJULE ═══
//
//  Komponenten får hverken samtaler eller beskeder ind. Den KAN ikke,
//  for de låste varianter i kontrakt.ts bærer ingen beskedfelter. Det er
//  med vilje: en låst visning, der fik indholdet med og gemte det med
//  `display: none`, ville stadig ligge i markuppen — og så er muren
//  pynt. Se noten i kontrakt.ts.
//
//  ═══ ÉN KNAP, IKKE TO ═══
//
//  Ingen «Læs mere om abonnement» ved siden af «Se abonnement», ingen
//  «Måske senere». Et valg, der reelt er ét valg, skal se ud som ét. Og
//  ingen pris her: prisen ejes af Supply og ville blive forkert den dag,
//  den ændrer sig ét sted.
//
//  ═══ ADRESSEN KOMMER UDEFRA ═══
//
//  `abonnementHref` er et krav i grænsefladen og har ingen standardværdi.
//  Brugerfladen kender ikke betalingsruten og skal ikke gætte den: en
//  knap, der peger på en rute, der ikke findes, er værre end ingen knap.
//  Den dag Supply leverer ruten, sættes den ét sted.
// ═══════════════════════════════════════════════════════════════

import type { Laasegrund } from './kontrakt'

interface Tekst {
  overskrift: string
  forklaring: string
  knap: string
}

/**
 * Teksterne bor HER og ikke i serverlaget.
 *
 * Serverlaget sender en grund — ét ord fra en union — og brugerfladen
 * skriver sætningen. Sendte serveren selve teksten, ville brugervendt
 * dansk ligge spredt over to lag, og den ene kopi ville blive rettet
 * uden den anden.
 */
const TEKST: Record<Laasegrund, Tekst> = {
  'login-kraevet': {
    overskrift: 'Log ind for at se dine beskeder',
    forklaring: 'Samtalerne følger din konto, så de er der også på telefonen.',
    knap: 'Log ind',
  },
  'abonnement-kraevet': {
    overskrift: 'Beskeder kræver abonnement',
    forklaring: 'Med abonnement kan du skrive til udlejeren og læse svaret her.',
    knap: 'Se abonnement',
  },
  'abonnement-udloebet': {
    overskrift: 'Dit abonnement er udløbet',
    forklaring: 'Dine samtaler er ikke slettet. Genaktivér for at læse og skrive igen.',
    knap: 'Genaktivér',
  },
}

export function Laast({ grund, loginHref, abonnementHref }: {
  grund: Laasegrund
  loginHref: string
  abonnementHref: string
}) {
  const t = TEKST[grund]
  const href = grund === 'login-kraevet' ? loginHref : abonnementHref

  return (
    // `role="status"` og ikke `alert`: det er en tilstand, siden står i,
    // ikke noget der lige er gaaet galt. Alert ville afbryde.
    <div className="bsk-laast" role="status">
      <h2 className="bsk-laast-titel">{t.overskrift}</h2>
      <p className="bsk-laast-tekst">{t.forklaring}</p>
      <a className="knap bsk-laast-knap" href={href}>{t.knap}</a>
    </div>
  )
}
