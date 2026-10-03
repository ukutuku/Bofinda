// ═══════════════════════════════════════════════════════════════
//  GoTrue-attrap til favoritforløbet — med en RIGTIG adgangskodedør
//  og TO konti.
//
//  ═══ HVORFOR DEN IKKE ER gendannelse-attrap.mjs ═══
//
//  Den attrap svarer 200 med et token på ALT, den ikke genkender. Det er
//  rigtigt for gendannelsesforløbet, hvor adgangen kommer fra et link —
//  men her er hele pointen, at et FORKERT kodeord skal afvises, så
//  `login()` tager sin fejlgren og ønsket overlever. En attrap, der
//  altid siger ja, kunne ikke prøve det.
//
//  ═══ HVORFOR TO KONTI ═══
//
//  Gemmekvitteringen skal ikke kunne tale til en fremmed konto. Det kan
//  kun prøves, hvis der ER en fremmed konto — og hvis attrappen kan
//  skelne dem. Derfor har hver konto sit eget adgangstoken, og `/user`
//  slår OP i tokenet i stedet for at svare det samme til alle. En attrap,
//  der udleverer den samme bruger til begge sessioner, ville gøre
//  kontoskiftet til et selvbedrag.
//
//  Lytter kun på 127.0.0.1. Intet forlader maskinen, og der sendes
//  aldrig en mail.
//
//  ═══ HVAD DEN IKKE ER ═══
//
//  ⚠ Den efterligner GoTrue, som VI TROR GoTrue svarer. At det rigtige
//  Supabase Auth opfører sig sådan, kan kun afgøres i et rigtigt
//  Auth-miljø — samme forbehold som test-kontovej.ts.
//
//  Alt fra @supabase/ssr og ind er derimod den ægte kode: sessionens
//  cookies deles i bidder og skrives af biblioteket selv, `getUser()`
//  verificerer mod serveren her, og `login()`, `bindKonto()` og
//  `gemFavorit()` er dem, der kører.
// ═══════════════════════════════════════════════════════════════
import http from 'node:http'

const KONTI = [
  {
    id: process.env.ATTRAP_BRUGER_ID ?? '11111111-2222-4333-8444-666666666666',
    mail: process.env.ATTRAP_MAIL ?? 'favorit-proeve@invalid.test',
    kode: process.env.ATTRAP_KODE ?? 'den-rigtige-kode-42',
    adgang: 'attrap-adgangstoken-1',
    forny: 'attrap-fornytoken-1',
  },
  {
    id: process.env.ATTRAP_BRUGER_ID2 ?? '',
    mail: process.env.ATTRAP_MAIL2 ?? '',
    kode: process.env.ATTRAP_KODE2 ?? '',
    adgang: 'attrap-adgangstoken-2',
    forny: 'attrap-fornytoken-2',
  },
].filter((k) => k.id && k.mail && k.kode)

/** Kald, prøven kan læse bagefter. Uden dem kan «kom den forbi?» kun gættes. */
const kald = []

const bruger = (k) => ({
  id: k.id,
  email: k.mail,
  aud: 'authenticated',
  role: 'authenticated',
  // UDEN denne svarer `bindKonto` «ubekraeftet-mail», og Min side viser
  // sin forklaringsside i stedet for listen. Det ville se ud som om
  // gemningen fejlede, mens den aldrig blev forsøgt.
  email_confirmed_at: '2026-01-01T00:00:00Z',
  confirmed_at: '2026-01-01T00:00:00Z',
})

const session = (k) => ({
  access_token: k.adgang,
  refresh_token: k.forny,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: bruger(k),
})

const server = http.createServer((req, res) => {
  let krop = ''
  req.on('data', (c) => { krop += c })
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const sti = url.pathname
    const svar = (kode, o) => {
      res.statusCode = kode
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(o))
    }

    if (sti === '/__kald') return svar(200, { kald })

    kald.push(`${req.method} ${sti}${url.search}`)

    // GoTrues egen form for et forkert kodeord. `oversaet()` i
    // handlinger.ts kender netop den tekst.
    const afvist = () => svar(400, {
      error: 'invalid_grant',
      error_description: 'Invalid login credentials',
      message: 'Invalid login credentials',
    })

    // ─── Login med adgangskode ───────────────────────────────
    if (sti.endsWith('/token')) {
      let ind = {}
      try { ind = JSON.parse(krop || '{}') } catch { /* tom krop */ }
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        // Ogsaa fornyelsen slaar op. Svarede den det samme til alle,
        // kunne den ene kontos browser faa den andens session.
        const k = KONTI.find((x) => x.forny === ind.refresh_token)
        return k ? svar(200, session(k)) : afvist()
      }
      const k = KONTI.find((x) => x.mail === ind.email && x.kode === ind.password)
      return k ? svar(200, session(k)) : afvist()
    }

    if (sti.endsWith('/logout')) { res.statusCode = 204; return res.end() }

    // ─── Hvem er den her session? ────────────────────────────
    //
    // `getUser()` verificerer MOD SERVEREN — den afkoder ikke bare
    // tokenet. Uden en ægte authorization-header er der ingen bruger,
    // og det er dét, der gør, at en udlogget browser faktisk ser den
    // udloggede side.
    if (sti.endsWith('/user')) {
      const h = req.headers.authorization ?? ''
      const k = KONTI.find((x) => h.includes(x.adgang))
      if (!k) {
        return svar(401, { error: 'invalid_token', message: 'invalid claim: missing sub claim' })
      }
      return svar(200, bruger(k))
    }

    svar(404, { message: `attrap kender ikke ${sti}` })
  })
})

const PORT = Number(process.env.ATTRAP_PORT ?? 54399)
server.listen(PORT, '127.0.0.1', () =>
  console.log(`favorit-attrap lytter paa ${PORT} med ${KONTI.length} konti`))
