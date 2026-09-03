// ═══════════════════════════════════════════════════════════════
//  npm run tjek:noegler — virker legitimationen efter en rotation?
//
//  Scriptet printer ALDRIG en vaerdi. Kun om den blev accepteret, og hvor
//  mange tegn den er — nok til at se, at man har indsat den forkerte
//  streng, uden at nogen kan laese den over skulderen eller finde den i
//  en terminal-historik bagefter.
//
//  Koer den efter hver rotation af databasekodeordet eller RESEND_API_KEY.
//  Husk at det kun tjekker DEN HER maskines .env — Railway og Vercel har
//  deres egne, og de skal opdateres i panelerne.
// ═══════════════════════════════════════════════════════════════
import postgres from 'postgres'

let fejl = 0
const sig = (navn, ok, note) => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn.padEnd(20)} ${note}`)
  if (!ok) fejl++
}
/** Længden alene. Nok til at se en afkortet indsætning, ikke nok til at læse. */
const laengde = (v) => (v ? `${v.length} tegn` : 'ikke sat')

// ── Databasen. Kodeordet ligger inde i begge forbindelsesstrenge. ──
for (const [navn, port] of [['DATABASE_URL_DIRECT', 5432], ['DATABASE_URL', 6543]]) {
  const url = process.env[navn]
  if (!url) { sig(navn, false, 'ikke sat'); continue }
  // Transaction-pooleren kan ikke prepared statements. Se db/client.ts.
  const sql = postgres(url, {
    max: 1, ssl: 'require', onnotice() {},
    prepare: port === 5432,
    connect_timeout: 15,
  })
  try {
    const [r] = await sql`select current_user u`
    // Porten laeses af STRENGEN, ikke af serveren: gennem Supavisor svarer
    // inet_server_port() med backend-porten, og saa ville 6543 se ud som
    // 5432 og ligne en fejlkonfiguration, den ikke er.
    const iStreng = url.match(/:(\d{4,5})\//)?.[1] ?? '?'
    sig(navn, iStreng === String(port),
      `forbundet som ${r.u} · strengen peger paa ${iStreng}`
      + (iStreng === String(port) ? '' : ` — forventet ${port}`)
      + ` · ${laengde(url)}`)
  } catch (e) {
    sig(navn, false, `${e.code ?? ''} ${String(e.message).slice(0, 60)} · ${laengde(url)}`)
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {})
  }
}

// ── Resend. En ren laesning, saa kontrollen ikke kan sende noget. ──
const noegle = process.env.RESEND_API_KEY
if (!noegle) {
  sig('RESEND_API_KEY', false, 'ikke sat (mails sendes af importøren på Railway)')
} else {
  // Auth-proeven er et POST til /emails med TOM krop. Der sendes ingen
  // mail: Resend validerer noeglen foerst og svarer derefter 422 "Missing
  // `to` field". En doed noegle svarer 401.
  //
  // Ikke GET /domains, som ellers ville vaere det oplagte: en noegle med
  // kun sende-rettighed faar 401 DER, selv om den fungerer perfekt til at
  // sende. Den proeve ville have raabt "tilbagekaldt" om en gyldig noegle.
  try {
    const svar = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${noegle}`, 'content-type': 'application/json' },
      body: '{}',
    })
    const krop = await svar.json().catch(() => ({}))
    sig('RESEND_API_KEY', svar.status === 422,
      svar.status === 422 ? `accepteret — kan sende · ${laengde(noegle)}`
      : svar.status === 401 ? `AFVIST — ${krop.message ?? 'ugyldig'} · ${laengde(noegle)}`
      : `uventet svar ${svar.status}: ${krop.message ?? ''} · ${laengde(noegle)}`)
  } catch (e) {
    sig('RESEND_API_KEY', false, `kunne ikke nå Resend: ${String(e.message).slice(0, 50)}`)
  }
}

console.log(fejl
  ? `\n  ${fejl} fejl. Ret .env og kør igen.`
  : '\n  Alt accepteret — på DENNE maskine. Railway og Vercel har deres egne.')
process.exit(fejl ? 1 : 0)
