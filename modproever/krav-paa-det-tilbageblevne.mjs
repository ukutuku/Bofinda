// Kravet prøves på det, der står tilbage i `ud`, i stedet for på det, der
// blev sendt. Så er 'uden-for-listen' virkningsløs for de påkrævede felter.
export const forventning = {
  fil: "lib/maaling.ts",
  moenster: "    if (s.kraevet && raa[noegle] == null) {",
  traeffere: 1,
  erstat: "    if (s.kraevet && ud[noegle] === undefined) {",
}
