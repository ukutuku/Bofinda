// ═══════════════════════════════════════════════════════════════
//  Hvem har oprettet boligen — kilden eller udlejeren selv?
//
//  Spørgsmålet blev stillet to steder og kun besvaret ét.
//
//  · Detaljesiden SPURGTE: `{egenAnnonce ? 'Udlejeren selv' : kildeNavn}`.
//  · Kortet SPURGTE IKKE: det sendte `sources.name` videre ubetinget —
//    og det samme gjorde gruppesiden og Min side.
//
//  På produktionens egne data stod der derfor «Bofinda» på kortet og
//  «Udlejeren selv» på boligsiden om nøjagtig den samme annonce. Og
//  forsidens bundlinje havde allerede afgjort, hvad der er rigtigt:
//  «"hentet fra ... og Bofinda" er ikke rigtigt — de annoncer er ikke
//  hentet nogen steder, de er oprettet her.»
//
//  I designprevieet blev det synligt i en skarpere form, fordi
//  demodataene ligger under deres EGEN kilderække med typen `native`
//  (docs/frontend-lancering-v2/demo/staging-demo.sql). Der stod
//  «DEMO · fiktive boliger» på kortet og «Udlejeren selv» på boligsiden.
//  Det er to udgaver af det samme fund, ikke to fund.
//
//  ═══ HVORFOR TYPEN OG IKKE SLUG'EN ═══
//
//  `sources.slug` er 'native' for alle udlejerannoncer i dag, men det er
//  et NAVN. `source_type` er egenskaben, og den sættes sammen med
//  `source_id` i `opretBolig` (lib/udlejer.ts), så de to ikke kan drive
//  fra hinanden. Det er den samme afvejning, `kildetype` i lib/soeg.ts
//  allerede traf for kortet.
//
//  ═══ HVAD DEN IKKE ER ═══
//
//  Den er IKKE muren. Kontaktfelterne udleveres stadig af en betingelse
//  i SQL'en — `hentBolig` og `hentKontakt` — og et felt, der aldrig
//  forlader databasen, kan ikke lække ved en uopmærksom UI-ændring.
//  Denne fil er visning og intet andet, og den importerer derfor ikke
//  databasen: `Boligkort` deles med klientkomponenter, og et
//  værdi-import af `db` trak engang `postgres` med ind i browserbundtet.
//
//  Teksterne er forskellige de steder, der bruger den — et mærkat på
//  kortet, en sætning på gruppesiden — fordi der er forskellig plads.
//  Spørgsmålet besvares kun ét sted. Samme greb som `eltilstand` i
//  lib/eloplysning.ts.
// ═══════════════════════════════════════════════════════════════

/** Boligen er oprettet af en udlejer her, ikke hentet hos en kilde. */
export function erEgenAnnonce(b: { kildetype: string | null }): boolean {
  return b.kildetype === 'native'
}

/**
 * Navnet på den, boligen kommer fra — til et mærkat eller en linje, hvor
 * der kun er plads til ét ord.
 *
 * For en udlejerannonce er svaret ikke kildens navn: der ER ingen kilde.
 */
export function kildeetiket(
  b: { kildetype: string | null; kildeNavn: string },
): string {
  return erEgenAnnonce(b) ? 'Udlejeren selv' : b.kildeNavn
}
