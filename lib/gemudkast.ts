// ═══════════════════════════════════════════════════════════════
//  Det indtastede, baaret over ÉN omdirigering.
//
//  ═══ HVORFOR DEN FINDES ═══
//
//  «Gem søgningen» indsendes, server action'en omdirigerer, og siden
//  kommer tilbage med en besked. Efter den omgang stod mailfeltet TOMT
//  og navnefeltet med det maskinskrevne navn — ogsaa naar beskeden bad
//  brugeren om at rette noget. Fejlen kunne altsaa ikke RETTES, kun
//  skrives forfra, og det rammer haardest dér, hvor indtastning koster
//  mest: skaermtastatur, kontaktbetjening, taleindtastning.
//  WCAG 2.2 kalder det 3.3.7 Redundant Entry, og den er niveau A.
//
//  To ting toemte felterne, og begge skulle loeses:
//
//    1. Omdirigeringen bygger sin adresse af soegeparametrene. `mail` og
//       `navn` er POST-felter og har aldrig vaeret parametre.
//    2. React nulstiller selv formularen. Er `action` en funktion,
//       pakker react-dom indsendelsen ind i et `requestFormReset`, og i
//       commit-fasen kaldes `form.reset()`. Felterne bliver altsaa
//       AKTIVT sat tilbage til deres indholdsattribut.
//
//  Nr. 2 afgoer, hvor rettelsen skal ligge: alt andet end
//  indholdsattributten bliver vasket vaek af nulstillingen. Med udkastet
//  som `defaultValue` er attributten selve udkastet, og `reset()`
//  genskaber derfor dét. Rettelsen overlever nulstillingen i stedet for
//  at kaempe mod den.
//
//  ═══ HVORFOR EN COOKIE OG IKKE URL'EN ═══
//
//  Den naerliggende rettelse — at haenge `mail` paa omdirigeringen — er
//  forkert to gange:
//
//    · `sp` er dét, HVER eneste adresse paa siden bygges af: sidetal,
//      sortering, filterchips, kortvalg. Det er praecis derfor `gemt`
//      blev loeftet ud af `sp`. Et `mail=` dér ville blive haengt paa
//      hvert eneste href paa siden.
//    · Vi saetter bevidst INGEN restriktiv Referrer-Policy — kortets
//      flisekilde identificerer os paa Referer, og det staar i CLAUDE.md.
//      En mailadresse i adressen ville derfor blive sendt med i Referer
//      ved hver eneste flisehentning. Og staa i browserhistorikken.
//
//  Cookien er `httpOnly` (browseren giver den ikke til JavaScript),
//  `sameSite: lax` og lever TO MINUTTER. Den skal overleve én
//  omdirigering, ikke et besoeg. Ved «sendt» ryddes den med det samme.
//
//  Der er ikke noget sted at rydde den efter en LAESNING: cookies kan kun
//  saettes i en server action eller en rute, ikke under en gengivelse.
//  Derfor den korte levetid — og derfor laeses den kun, naar der FAKTISK
//  staar en fejl paa skaermen.
//
//  Cookien staar i privatlivspolitikkens liste. Aendres den ene, skal
//  den anden med i samme aendring.
// ═══════════════════════════════════════════════════════════════

import { cookies } from 'next/headers'
import { BASISCOOKIE } from './samtykke'

export const UDKASTCOOKIE = 'bofinda_gemudkast'
/** To minutter: lang nok til at rette en tastefejl, kort nok til intet andet. */
export const UDKAST_SEK = 120

export interface Gemudkast {
  navn: string
  mail: string
}

const MAKS_NAVN = 80
const MAKS_MAIL = 200

/** Skriver udkastet — eller rydder det, naar der ikke er mere at rette. */
export async function saetUdkast(u: Gemudkast | null): Promise<void> {
  const jar = await cookies()
  if (!u) {
    // Kun hvis den er der. En `set` med maxAge 0 paa hver eneste
    // vellykket indsendelse ville skrive en cookie-header uden grund.
    if (jar.get(UDKASTCOOKIE)) jar.set(UDKASTCOOKIE, '', { ...BASISCOOKIE, maxAge: 0 })
    return
  }
  const vaerdi = JSON.stringify({
    navn: u.navn.slice(0, MAKS_NAVN),
    mail: u.mail.slice(0, MAKS_MAIL),
  })
  jar.set(UDKASTCOOKIE, vaerdi, { ...BASISCOOKIE, maxAge: UDKAST_SEK })
}

/**
 * Laeser udkastet. Alt andet end to strenge giver `null` — en cookie er
 * noget, der kommer udefra, ogsaa naar det er os selv, der satte den.
 */
export async function laesUdkast(): Promise<Gemudkast | null> {
  const raa = (await cookies()).get(UDKASTCOOKIE)?.value
  if (!raa) return null
  try {
    const o = JSON.parse(raa) as unknown
    if (!o || typeof o !== 'object') return null
    const { navn, mail } = o as Record<string, unknown>
    if (typeof navn !== 'string' || typeof mail !== 'string') return null
    return { navn: navn.slice(0, MAKS_NAVN), mail: mail.slice(0, MAKS_MAIL) }
  } catch {
    return null
  }
}
