// ═══════════════════════════════════════════════════════════════
//  Loftet over en udlejerannonces billeder.
//
//  Filen maa IKKE importere databasen: formularen er en klientkomponent,
//  og den skal laese det SAMME tal som serveren. Se reglen om
//  lib/faciliteter.ts i CLAUDE.md — et vaerdi-import fra en fil med `db`
//  trak engang `postgres` ind i browserbundtet.
//
//  ═══ HVORFOR SERVEREN SKAL HAVE LOFTET OGSAA ═══
//
//  Loftet stod kun i browseren. `gemBolig` tog imod alt, hvad formularen
//  sendte, og et skjult felt mere i DevTools var nok til at komme forbi.
//  Det var ikke hygiejne: repraesentantvalget i dedup'en taeller billeder,
//  og en udlejerannonce med samme adresse som en scrapet bolig kunne
//  vinde valget med 21 kopier af én URL mod kildens 20 billeder — og
//  skjule kildens annonce i soegningen, bag en aaben kontaktmur. Det,
//  der lukker hullet, er at rangeringen taeller UNIKKE billeder (se
//  `UNIKKE_BILLEDER` i lib/soeg.ts). Loftet og dublet-afvisningen her er,
//  at vi ikke gemmer det, vi ikke vil vise.
//
//  Maalt i produktionen 26. september 2026: én aktiv annonce har 31
//  billeder. Den er fra foer loftet i browseren; udlejeren troede, der
//  var fire. Hun faar beskeden nedenfor, naeste gang hun gemmer.
// ═══════════════════════════════════════════════════════════════

/** Loft paa antal billeder pr. annonce. Browser og server laeser begge dette. */
export const MAKS_BILLEDER = 20

/**
 * Er billedlisten til at gemme? `null` betyder ja; ellers en dansk
 * forklaring, formularen kan vise.
 *
 * Kaldes af `opretBolig` og `opdaterBolig` FOER der skrives noget.
 * `opdaterBolig` sletter billedraekkerne, foer den indsaetter de nye —
 * en afvisning midt imellem ville have toemt annoncen.
 */
export function tjekBilleder(urler: readonly string[]): string | null {
  if (urler.length > MAKS_BILLEDER) {
    const for_ = urler.length - MAKS_BILLEDER
    return `Annoncen har ${urler.length} billeder, og der er plads til ${MAKS_BILLEDER}. `
      + `Fjern ${for_} ${for_ === 1 ? 'billede' : 'billeder'}, og gem igen.`
  }
  if (new Set(urler).size !== urler.length) {
    return 'Det samme billede står flere gange. Fjern dubletterne, og gem igen.'
  }
  return null
}
