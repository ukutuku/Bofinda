// ═══════════════════════════════════════════════════════════════
//  Stripes webhook.
//
//  Ruten goer tre ting og intet andet: laeser den RAA krop,
//  efterproever signaturen, og giver haendelsen videre til
//  `behandl()` i lib/webhook.ts.
//
//  ── HVORFOR DEN RAA KROP ────────────────────────────────────
//  Signaturen er regnet over de praecise bytes, Stripe sendte.
//  `await req.json()` ville parse og genserialisere, og saa stemmer
//  hashen ikke — eller vaerre: den stemmer i dag og holder op med at
//  stemme den dag, et felt skifter plads. `await req.text()` giver
//  bytes, som de kom.
//
//  ── SVARKODERNE BETYDER NOGET FOR STRIPE ────────────────────
//  2xx = «modtaget, prøv ikke igen». 4xx/5xx = «prøv igen».
//  · Ugyldig signatur → 400. Den kommer ikke fra Stripe, og et
//    genforsoeg ville ikke hjaelpe.
//  · Behandling kastede → 500, SAA Stripe leverer igen. Haendelsen
//    staar med `behandlet_at = null` og koeres om.
//  · AFVENTER → 409. Haendelsen er gyldig, men forudsaetningen er
//    ikke kommet endnu. Her laa fund 1: ruten svarede 200, og 200
//    betyder «prøv ikke igen». Haendelsen stod ubehandlet i basen med
//    `behandlet_at = null` — og Stripe leverede den aldrig igen, saa
//    der var ingen til at tage den op. Den betalte periode var tabt.
//    409 faar Stripe til at levere igen, og nyttelasten er gemt, saa
//    `betalingstilsyn()` kan koere den om ogsaa efter at Stripe har
//    givet op. To veje, fordi den ene ikke kan staa alene.
//  · I_GANG → 409 af samme grund: en anden behandler har kravet lige
//    nu, men den kan doe midt i, og saa er der ingen til at faerdiggoere
//    den. En ny levering er billig; en tabt betaling er det ikke.
//
//  MEN RUTEN OPREGNER DEM IKKE. Her stod foer «Alt andet → 200», og
//  linjen nedenfor navngav `afventer` og `i_gang` med literaler. Det
//  var en catch-all: en syvende vaerdi i `Udfald` ville lande i
//  200-grenen og blive kvitteret som modtaget. Det er ikke en
//  hypotese — det skete, da unionen sidst voksede (7327d42 tilfoejede
//  netop `i_gang` og `afventer` uden at roere denne fil, og begge blev
//  tavst 200).
//
//  Svaret slaas derfor op i `UDFALD` i lib/webhook.ts, som PORTEN i
//  `behandl()` selv adlyder. En syvende vaerdi uden regel er en
//  oversaetterfejl dér, ikke et tavst 200 her.
//
//  Og nej: ruten maa ikke i stedet LAESE `behandlet_at` paa raekken.
//  Kolonnen er referatet af portens beslutning, skrevet af `faerdig()`
//  NEDSTROEMS for fejlen — en vaerdi, porten har misforstaaet, har
//  allerede faaet kolonnen sat, og en rute, der laeser den, ville
//  svare 200 alligevel. Plus en laesning-efter-skrivning gennem
//  pooleren paa hver eneste levering, for et svar `behandl()` havde i
//  haanden.
//
//  Ingen generel try/catch om det hele: en fanget fejl, der svarede
//  200, ville faa Stripe til at holde op med at proeve — og saa var
//  betalingen registreret hos dem og ikke hos os.
// ═══════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { behandl, UDFALD, type Haendelse } from '../../../lib/webhook'
import { opsaetning, stripe } from '../../../lib/stripe'

// Ruten maa aldrig prerendres eller caches: hver levering er ny.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const o = opsaetning()
  // Uden opsaetning kan vi ikke efterproeve signaturen. Saa svarer vi
  // 500, ikke 200: en kvittering ville faa Stripe til at kassere en
  // haendelse, vi aldrig har set paa.
  if (!o) return new NextResponse('stripe ikke konfigureret', { status: 500 })

  const signatur = req.headers.get('stripe-signature')
  if (!signatur) return new NextResponse('mangler signatur', { status: 400 })

  const raa = await req.text()

  let h: Haendelse
  try {
    // Stripes egen konstruktion. Den tjekker baade HMAC'en og
    // tidsstemplet i headeren, saa en gammel, opsnappet levering ikke
    // kan afspilles igen.
    h = stripe(o).webhooks.constructEvent(
      raa, signatur, o.webhookHemmelighed,
    ) as unknown as Haendelse
  } catch {
    return new NextResponse('ugyldig signatur', { status: 400 })
  }

  const udfald = await behandl(h, o)
  // Kun et FAERDIGT udfald kvitteres — og «faerdigt» opslaas, det
  // opregnes ikke. Se hovedet.
  return NextResponse.json({ udfald }, {
    status: UDFALD[udfald].faerdig ? 200 : 409,
    headers: { 'Cache-Control': 'no-store' },
  })
}
