// ═══════════════════════════════════════════════════════════════
//  Mailattrappen: en indbakke på loopback.
//
//      BOFINDA_MAILPORT=55434 node scripts/cloud/mailattrap.mjs
//
//  ── HVORFOR DEN FINDES ───────────────────────────────────────
//  Formularprøven skal køre HELE forløbet gennem serverhandlingen:
//  indsend → fejl → ret → succes. Det kræver, at afsendelsen LYKKES.
//
//  Før blev afsendelsen gjort umulig i stedet — appen kørte uden
//  `RESEND_API_KEY`, så `maaSendeTil` lukkede af, og prøven målte
//  «spærret». Det er ikke en prøve af forløbet; det er en prøve af, at
//  forløbet ikke kan gennemføres. Kvitteringen, rydningen af udkastet og
//  fokus på «Tjek din mail» var aldrig målt på andet end en URL.
//
//  Attrappen svarer som Resend gør — `{ id }` og 200 — og LÆGGER
//  BESKEDEN FREM, så prøven kan efterprøve, at der blev sendt præcis én
//  mail, til præcis den adresse.
//
//  ── HVAD DEN IKKE ER ─────────────────────────────────────────
//  Den binder KUN til 127.0.0.1. Den kan ikke nås udefra, den sender
//  ingenting videre, og den gemmer intet på disken. Beskederne lever i
//  processen og forsvinder med den.
//
//      POST /emails    tag imod en mail        → { id }
//      GET  /post      alle modtagne           → [ { til, emne, tekst } ]
//      DELETE /post    ryd listen              → { ryddet: N }
//      GET  /sund      er jeg her?             → ok
// ═══════════════════════════════════════════════════════════════
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const PORT = Number(process.env.BOFINDA_MAILPORT ?? 55434)
/** Kun i hukommelsen. En mail i en fil er en mail, nogen kan finde. */
const post = []
const MAKS = 200

const svar = (res, kode, krop) => {
  const t = JSON.stringify(krop)
  res.writeHead(kode, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(t) })
  res.end(t)
}

createServer((req, res) => {
  const sti = (req.url ?? '/').split('?')[0]

  if (req.method === 'GET' && sti === '/sund') return svar(res, 200, { ok: true, antal: post.length })
  if (req.method === 'GET' && sti === '/post') return svar(res, 200, post)
  if (req.method === 'DELETE' && sti === '/post') {
    const n = post.length
    post.length = 0
    return svar(res, 200, { ryddet: n })
  }

  if (req.method === 'POST' && sti === '/emails') {
    let raa = ''
    req.on('data', (c) => {
      raa += c
      // En attrap skal ikke kunne fyldes op af et uheld.
      if (raa.length > 1_000_000) { req.destroy(); }
    })
    req.on('end', () => {
      let krop = {}
      try { krop = JSON.parse(raa) } catch { /* en ulaeselig krop er ogsaa en oplysning */ }
      const id = randomUUID()
      // Kun de felter, prøven skal kunne efterprøve. Vi gemmer ikke en
      // mail, vi ikke har brug for at kunne se.
      post.push({
        id,
        til: Array.isArray(krop.to) ? krop.to : [krop.to].filter(Boolean),
        fra: krop.from ?? null,
        emne: krop.subject ?? null,
        tekst: typeof krop.text === 'string' ? krop.text.slice(0, 4000) : null,
        tid: new Date().toISOString(),
      })
      if (post.length > MAKS) post.splice(0, post.length - MAKS)
      svar(res, 200, { id })
    })
    return
  }

  svar(res, 404, { fejl: 'ukendt sti' })
}).listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`mailattrap paa http://127.0.0.1:${PORT} — binder kun til loopback\n`)
})
