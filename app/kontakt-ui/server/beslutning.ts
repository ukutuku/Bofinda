// ═══════════════════════════════════════════════════════════════
//  BINDINGSPUNKTET. Ét sted, én linje.
//
//  Her — og kun her — hentes adgangsbeslutningen. Filen findes, fordi
//  den skal være umulig at overse: når betalingsserien og kontakt-UI'en
//  mødes, er det denne ene funktion, der skal pege på `maaBruge`.
//
//  ═══ EFTER FLETNINGEN ═══
//
//  Erstat kroppen med præcis dette, og slet resten af kommentaren:
//
//      import { FUNKTION, maaBruge } from '../../../lib/adgang'
//      export const kontaktbeslutning = async (): Promise<Beslutning> => {
//        const svar = await maaBruge(FUNKTION.kontakt)
//        return svar.ok ? { ok: true } : { ok: false, grund: svar.grund }
//      }
//
//  `scripts/test-kontaktmur.ts` FEJLER, hvis `lib/adgang.ts` findes,
//  uden at denne fil importerer `maaBruge` fra den. Prøven er grøn i
//  dag, fordi filen ikke findes på denne gren — og den bliver rød i
//  samme sekund, grenene mødes uden at nogen har koblet den til. Det er
//  dét, der gør «ét sted» til noget, der håndhæves, og ikke noget, vi
//  håber på.
//
//  ═══ HVORFOR DEN SVARER «JA» I DAG ═══
//
//  Ikke fordi jeg har besluttet noget. Betalingsmuren er slukket, og
//  CLAUDE.md siger det samme om kontaktfelterne: *«Muren er ÅBEN for
//  native boliger indtil videre.»* Linjen nedenfor GENGIVER altså den
//  tilstand, produktet er i — den afgør den ikke.
//
//  ⚠ Og netop derfor er den farlig at glemme: den dag `lib/adgang.ts`
//  er her, vil den her linje blive ved med at sige ja, mens den rigtige
//  beslutning siger nej. Det er præcis den fejltype, CLAUDE.md kalder
//  den dyreste — to udtryk for samme spørgsmål, begge rigtige hver for
//  sig, der driver fra hinanden. Prøven er vagten.
// ═══════════════════════════════════════════════════════════════

import type { Beslutning } from '../../../lib/kontaktmur'

export const kontaktbeslutning = async (): Promise<Beslutning> => ({ ok: true })
