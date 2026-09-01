// ═══════════════════════════════════════════════════════════════
//  Mail gennem Resend.
//
//  Afsendelse er den eneste handling i systemet, der ikke kan gøres om.
//  Derfor tre spærringer, som alle skal være åbne:
//
//    1. RESEND_API_KEY skal være sat.
//    2. ALARM_AFSENDER skal være sat.
//    3. Modtageren skal stå i ALARM_TILLADTE_MODTAGERE, hvis den er sat.
//
//  Den tredje er indkøringsventilen: mens vi ser efter, hvad der faktisk
//  lander i indbakken, må kun ejerens egen adresse få mail. Alle andre
//  bliver sprunget over og logget — ikke sendt "bare denne ene gang".
// ═══════════════════════════════════════════════════════════════

const API = 'https://api.resend.com/emails'

export interface MailResultat {
  sendt: boolean
  grund?: string
  id?: string
}

const liste = (v: string | undefined) =>
  v?.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) ?? []

/** Må vi sende til denne adresse? Svarer også hvorfor ikke. */
export function maaSendeTil(modtager: string): { ok: boolean; grund?: string } {
  if (!process.env.RESEND_API_KEY) return { ok: false, grund: 'RESEND_API_KEY mangler' }
  if (!process.env.ALARM_AFSENDER) return { ok: false, grund: 'ALARM_AFSENDER mangler' }
  const tilladte = liste(process.env.ALARM_TILLADTE_MODTAGERE)
  if (tilladte.length && !tilladte.includes(modtager.toLowerCase())) {
    return { ok: false, grund: `${modtager} står ikke i ALARM_TILLADTE_MODTAGERE` }
  }
  return { ok: true }
}

export async function sendMail(opts: {
  til: string
  emne: string
  tekst: string
  html: string
  /** POST-ruten. Saettes som List-Unsubscribe, saa mailklienten selv kan
   *  tilbyde ét-klik-afmelding uden at aabne mailen. */
  afmeldUrl: string
  /** Siden til mennesker — den der staar som link i selve mailen. */
  afmeldSideUrl?: string
}): Promise<MailResultat> {
  const lov = maaSendeTil(opts.til)
  if (!lov.ok) return { sendt: false, grund: lov.grund }

  const res = await fetch(API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.ALARM_AFSENDER,
      to: [opts.til],
      subject: opts.emne,
      text: opts.tekst,
      html: opts.html,
      headers: {
        // Ét klik i mailklienten, uden at aabne mailen. POST og ikke GET —
        // se noten i app/afmeld.
        'List-Unsubscribe': `<${opts.afmeldUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }),
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    return { sendt: false, grund: `Resend svarede ${res.status}: ${(await res.text()).slice(0, 200)}` }
  }
  const j = await res.json() as { id?: string }
  return { sendt: true, id: j.id }
}
