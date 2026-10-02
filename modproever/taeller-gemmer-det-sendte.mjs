// Tælleren gemmer det sendte eventnavn i stedet for (ukendt). Så kan en
// afsender skrive hvad som helst ind i en tabel uden identitet og udløb.
export const forventning = {
  fil: "lib/maaling-server.ts",
  moenster: "  return Object.hasOwn(ALLE, navn) ? navn : '(ukendt)'",
  traeffere: 1,
  erstat: "  return navn",
}
