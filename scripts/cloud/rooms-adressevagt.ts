// ═══════════════════════════════════════════════════════════════
//  Adressevagten i `rooms-repraesentant.ts`, proevet med SIMULEREDE
//  forbindelsesoplysninger. Ingen database, ingen socket.
//
//  Hvorfor den findes: `rooms-repraesentant.ts` SKRIVER. Vagten var
//  foer kun et navn og en port — den faktiske serveradresse blev
//  udskrevet og ikke efterproevet. En base med det rigtige navn paa
//  den rigtige port, men paa en FREMMED vaert, slap dermed igennem.
//  Den linje kan ikke proeves med en rigtig forbindelse her, for der
//  ER ingen fremmed base at forbinde til. Derfor simulerede vaerdier
//  mod praedikatet, og en rigtig koersel mod en forkert base for at
//  vise, at vagten fyrer FOER den foerste indsaettelse.
// ═══════════════════════════════════════════════════════════════
import { erIsoleret, udenPraefiks } from './rooms-repraesentant'
let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`); if (!ok) fejl++
}
console.log('\n══ Adressevagten mod simulerede forbindelsesoplysninger ══')
// Det faktiske format fra inet_server_addr()::text baerer praefikslaengde.
tjek('127.0.0.1/32 godkendes (det FAKTISKE format)', erIsoleret('bofinda_test', '127.0.0.1/32', 55432))
tjek('127.0.0.1 uden maske godkendes', erIsoleret('bofinda_test', '127.0.0.1', 55432))
tjek('::1/128 godkendes', erIsoleret('bofinda_test', '::1/128', 55432))
tjek('unix-socket (NULL → loopback) godkendes', erIsoleret('bofinda_test', 'loopback', 55432))
// KERNEN: rigtigt navn OG rigtig port, men FREMMED adresse.
tjek('FREMMED adresse afvises trods korrekt navn og port',
  !erIsoleret('bofinda_test', '10.0.0.5/32', 55432), '10.0.0.5/32')
tjek('offentlig adresse afvises', !erIsoleret('bofinda_test', '203.0.113.9/32', 55432))
tjek('IPv6 uden for loopback afvises', !erIsoleret('bofinda_test', '2001:db8::1/128', 55432))
// De to oevrige led skal stadig virke hver for sig.
tjek('forkert databasenavn afvises', !erIsoleret('postgres', '127.0.0.1/32', 55432))
tjek('forkert port afvises', !erIsoleret('bofinda_test', '127.0.0.1/32', 5432))
// En naesten-traeffer maa ikke slippe igennem paa praefiksstripning.
tjek('127.0.0.10 afvises (ikke loopback)', !erIsoleret('bofinda_test', '127.0.0.10/32', 55432))
tjek('udenPraefiks strippper masken', udenPraefiks('127.0.0.1/32') === '127.0.0.1')
console.log(fejl === 0 ? '\n  ALT GRØNT\n' : `\n  ${fejl} FEJLEDE\n`)
if (fejl) process.exit(1)
