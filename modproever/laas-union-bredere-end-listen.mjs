// Unionen skrives bredere end listen — den eneste måde, fejlen kan
// genindføres på, når typen er udledt af LAASEGRUNDE. En fjerde låsegrund
// ville så mangle i listen, der lover «alle tilstande».
export const forventning = {
  fil: 'app/beskeder/kontrakt.ts',
  moenster: 'export type Laasegrund = (typeof LAASEGRUNDE)[number]\n',
  traeffere: 1,
  erstat: "export type Laasegrund = (typeof LAASEGRUNDE)[number] | 'ukendt-tilstand'\n",
}
