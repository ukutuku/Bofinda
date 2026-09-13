// ═══════════════════════════════════════════════════════════════
//  Lokale testaktiver: boligbilleder og kortfliser.
//
//  HVORFOR DEN FINDES: browserkontrollen må ikke afhænge af hverken
//  udlejernes billedservere eller OpenStreetMaps flisetjeneste. Kalder
//  prøven ud af maskinen, måler den også nogen andens oppetid — og
//  vores brug af OSM's donationsdrevne fliser hører til mennesker, der
//  ser et kort, ikke til en automatiseret kørsel.
//
//  Billederne GENERERES i hukommelsen. Ingen binære filer i repoet, og
//  ingen aktiver der kan drive fra den kode, der laver dem.
//
//  Appen kender værten som EGEN_LAGERVAERT, fordi
//  NEXT_PUBLIC_SUPABASE_URL peger herpå — se lib/billede.ts. Det kræver
//  ingen ændring i allowlisten.
// ═══════════════════════════════════════════════════════════════
import { createServer } from 'node:http'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { deflateSync } from 'node:zlib'

const PORT = Number(process.env.BOFINDA_AKTIVPORT ?? 55433)

// ─── Rigtige fotografier, naar de er lagt frem ─────────────────
//
//  Fotokontrollen skal se layoutet med et RIGTIGT motiv: beskaering,
//  kontrast, lysstyrke og hoejde er ting, et genereret baand ikke kan
//  svare paa. Filerne laegges i den her mappe og serveres som de er.
//
//  MAPPEN LIGGER UDEN FOR REPOET, som alt andet i testmiljoeet. Reglen
//  oeverst i filen staar ved magt: der kommer ingen binaere filer i
//  git. Fotografier har desuden en licens og en fotograf, og et
//  kodelager er et daarligt sted at opbevare begge dele.
//
//  Findes mappen ikke, eller er den tom, svarer ruten 404. Det er med
//  vilje: saa kan browserkontrollen SE, at der ikke var fotografier, og
//  sige det — i stedet for at vise et baand og lade som om.
const FOTOMAPPE = process.env.BOFINDA_FOTOMAPPE ?? '/var/lib/bofinda-test/fotos'
const TYPER = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

function fotoliste() {
  try {
    return readdirSync(FOTOMAPPE)
      .filter((f) => TYPER[extname(f).toLowerCase()])
      .filter((f) => { try { return statSync(join(FOTOMAPPE, f)).size > 1024 } catch { return false } })
      .sort()
  } catch { return [] }
}

// ─── Minimal PNG-koder ─────────────────────────────────────────
const tabel = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = tabel[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const krop = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(krop))
  return Buffer.concat([len, krop, crc])
}
function png(bredde, hoejde, maal) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(bredde, 0); ihdr.writeUInt32BE(hoejde, 4)
  ihdr[8] = 8; ihdr[9] = 2   // 8 bit, truecolor RGB
  const raa = Buffer.alloc(hoejde * (1 + bredde * 3))
  let i = 0
  for (let y = 0; y < hoejde; y++) {
    raa[i++] = 0                       // filtertype: none
    for (let x = 0; x < bredde; x++) {
      const [r, g, b] = maal(x, y)
      raa[i++] = r; raa[i++] = g; raa[i++] = b
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raa)), chunk('IEND', Buffer.alloc(0)),
  ])
}

// Fire genkendelige boligbilleder. Diagonale bånd, så det er tydeligt i
// et skærmbillede, at billedet er hentet og skaleret — og tydeligt at
// det er en attrap.
const TONER = [[92, 124, 160], [140, 116, 96], [104, 140, 112], [148, 112, 132]]
const cache = new Map()
function bolig(n) {
  const noegle = `bolig-${n}`
  if (!cache.has(noegle)) {
    const [r, g, b] = TONER[(n - 1) % TONER.length]
    cache.set(noegle, png(800, 600, (x, y) => {
      const baand = ((x + y) % 160) < 80 ? 1 : 0.82
      const bund = y > 470 ? 0.6 : 1        // en "horisont", så op/ned kan ses
      return [r * baand * bund, g * baand * bund, b * baand * bund].map((v) => Math.round(v))
    }))
  }
  return cache.get(noegle)
}
// Fire former med hver sit formaal. Ruderne goer beskaeringen synlig:
// er billedet straakt, bliver de rektangler.
const FORMER = {
  staaende:  { b: 600,  h: 900, tone: [96, 118, 146], lys: 1 },
  liggende:  { b: 1800, h: 600, tone: [120, 130, 108], lys: 1 },
  lys:       { b: 1200, h: 900, tone: [236, 232, 224], lys: 1 },
  moerk:     { b: 1200, h: 900, tone: [26, 28, 34],    lys: 1 },
}
function form(navn) {
  const noegle = `form-${navn}`
  if (!cache.has(noegle)) {
    const { b, h, tone } = FORMER[navn]
    const [r, g, bl] = tone
    cache.set(noegle, png(b, h, (x, y) => {
      // Kvadratiske ruder: de er kun kvadratiske, hvis intet er straakt.
      const rude = (Math.floor(x / 100) + Math.floor(y / 100)) % 2 ? 1 : 0.88
      return [r * rude, g * rude, bl * rude].map((v) => Math.round(Math.min(255, v)))
    }))
  }
  return cache.get(noegle)
}
const flise = (() => {
  let f = null
  return () => f ??= png(256, 256, (x, y) =>
    (x % 64 === 0 || y % 64 === 0) ? [206, 206, 200] : [232, 232, 226])
})()

createServer((req, res) => {
  const sti = new URL(req.url, 'http://x').pathname
  const send = (buf) => res.writeHead(200, {
    'content-type': 'image/png', 'content-length': buf.length,
    'cache-control': 'public, max-age=3600',
  }).end(buf)

  let m
  // ── Rigtige fotografier ──────────────────────────────────────
  //  `/foto` lister hvad der ligger; `/foto/<navn>` serverer én fil.
  //  Listen er det, browserkontrollen spoerger om for at afgoere, om
  //  fotokontrollen overhovedet kan koeres.
  if (sti === '/foto') {
    const liste = fotoliste()
    const krop = Buffer.from(JSON.stringify({ mappe: FOTOMAPPE, filer: liste }))
    return res.writeHead(200, { 'content-type': 'application/json', 'content-length': krop.length })
      .end(krop)
  }
  if ((m = sti.match(/^\/foto\/([\w.-]+)$/))) {
    const navn = m[1]
    // Ingen stier ud af mappen: kun et filnavn, og kun ét der faktisk
    // staar paa listen. `..` og skraastreger kan ikke naa hertil.
    if (!fotoliste().includes(navn)) return res.writeHead(404).end('intet foto')
    const buf = readFileSync(join(FOTOMAPPE, navn))
    return res.writeHead(200, {
      'content-type': TYPER[extname(navn).toLowerCase()] ?? 'application/octet-stream',
      'content-length': buf.length, 'cache-control': 'public, max-age=3600',
    }).end(buf)
  }
  // ── Genererede former til GEOMETRIEN ─────────────────────────
  //  Ikke fotografier og ikke et forsoeg paa at ligne det. De findes,
  //  fordi beskaering, straek og overloeb kan maales med ethvert motiv,
  //  og de eksisterende attrapper er alle 800x600 — altsaa kan de ikke
  //  vise, hvad der sker med et STAAENDE billede i en liggende ramme.
  //  Lys og moerk er der, fordi knappens laesbarhed skal kunne maales
  //  mod begge yderpunkter.
  if ((m = sti.match(/^\/form-(staaende|liggende|lys|moerk)\.png$/))) return send(form(m[1]))
  if ((m = sti.match(/^\/bolig-(\d+)\.png$/))) return send(bolig(Number(m[1])))
  if (/^\/flise\/\d+\/\d+\/\d+\.png$/.test(sti)) return send(flise())
  if (sti === '/sund') return res.writeHead(200).end('ok')
  res.writeHead(404).end('ikke fundet')
}).listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`✓ testaktiver på http://127.0.0.1:${PORT} (kun loopback)\n`)
})
