// ═══════════════════════════════════════════════════════════════
//  GoTrue-attrap med styrbar tilstand, til de udførte action-prøver.
//
//  Lytter kun på 127.0.0.1. Intet forlader maskinen, og der sendes
//  aldrig en rigtig mail. Scenariet sættes med POST /__tilstand, så
//  én kørende app kan prøves mod alle udfaldene.
// ═══════════════════════════════════════════════════════════════
import http from 'node:http'

const tilstand = {
  ingenBruger: false,      // getUser afviser  → «linket er ikke gyldigt»
  updateFejler: false,     // updateUser afviser → ingen succes
  signOutFejler: false,    // logud fejler     → delvis succes
  mailFejler: false,       // SMTP svigter     → ingen falsk afsendelsespåstand
}
export const kald = []

const server = http.createServer((req, res) => {
  let krop = ''
  req.on('data', (c) => { krop += c })
  req.on('end', () => {
    const sti = (req.url ?? '').split('?')[0]
    const svar = (kode, o) => { res.statusCode = kode; res.setHeader('content-type','application/json'); res.end(JSON.stringify(o)) }

    if (sti === '/__tilstand') {
      Object.assign(tilstand, JSON.parse(krop || '{}')); kald.length = 0
      return svar(200, { ok: true, tilstand })
    }
    if (sti === '/__kald') return svar(200, { kald })

    kald.push(`${req.method} ${sti}`)

    if (sti.endsWith('/recover')) {
      return tilstand.mailFejler
        ? svar(500, { error: 'unexpected_failure', message: 'Error sending recovery email' })
        : svar(200, {})
    }
    if (sti.endsWith('/logout')) {
      if (tilstand.signOutFejler) return svar(500, { error: 'unexpected_failure', message: 'logout failed' })
      res.statusCode = 204; return res.end()
    }
    if (sti.endsWith('/user')) {
      if (req.method === 'PUT') {
        return tilstand.updateFejler
          ? svar(422, { error: 'weak_password', message: 'Password should be at least 12 characters' })
          : svar(200, { id: 'u1', email: 'proeve@invalid.test', aud: 'authenticated' })
      }
      if (tilstand.ingenBruger) return svar(401, { message: 'invalid claim: missing sub claim' })
      return svar(200, { id: 'u1', email: 'proeve@invalid.test', aud: 'authenticated',
                         email_confirmed_at: '2026-01-01T00:00:00Z' })
    }
    svar(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, token_type: 'bearer',
                user: { id: 'u1', email: 'proeve@invalid.test', aud: 'authenticated' } })
  })
})
const PORT = Number(process.env.ATTRAP_PORT ?? 54321)
server.listen(PORT, '127.0.0.1', () => console.log(`attrap lytter paa ${PORT}`))
