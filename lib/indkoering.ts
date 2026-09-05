// ═══════════════════════════════════════════════════════════════
//  Indkøring — hvornår en kilde er «i gang», og hvad der er bagkatalog.
//
//  Ved den FØRSTE import af en kilde får hele dens bestand
//  `first_seen_at = nu`. De boliger er ikke nye; de er bagkataloget, vi
//  netop har opdaget. To steder skal vide det, og de skal vide det samme:
//
//    lib/alarm.ts   en bolig fra bagkataloget må ikke udløse en mail.
//                   Ellers ville hver ny kilde sende hundredvis af
//                   «nye boliger», der har stået ledige i månedsvis.
//    lib/soeg.ts    en bolig fra bagkataloget må ikke stå øverst under
//                   «nyeste». Ellers tager hver ny kilde hele forsiden
//                   den dag, den kobles på — home.dk tog 48 af 48.
//
//  Konstanten står HER og ikke to steder. To tal om det samme begreb
//  driver fra hinanden, og så ville alarmen og forsiden være uenige om,
//  hvad «ny» betyder.
//
//  ── Én forskel, med vilje ────────────────────────────────────
//  Kilder UDEN kørsler i crawl_runs behandles modsat de to steder:
//
//    i alarmen   «send ikke». Udlejerannoncer har ingen importør og
//                dermed ingen kørsler, og umodereret brugerindhold skal
//                ikke i fremmedes indbakker.
//    i søgningen «det her ER publiceringstidspunktet». For en
//                udlejerannonce er «senest set af os» det samme som
//                «nyest» — hun trykkede udgiv. Blev den samme regel
//                brugt råt, ville hver eneste udlejerannonce ligge
//                permanent begravet under en importkørsel.
//
//  Derfor undtager søgningen `native` udtrykkeligt. Det er ikke en
//  omgåelse af reglen; det er den samme regel anvendt på en kilde, hvor
//  der ikke er nogen indkøring at vente på.
// ═══════════════════════════════════════════════════════════════

/** Timer en kilde skal have været overvåget, før dens boliger er nye. */
export const INDKOERING_TIMER = 24
