// Typevagten slettes, fx for at få tsc grøn efter en fletning. tsc bliver
// GRØN af det — der er intet galt med typerne, bare intet, der ser efter.
// Kun prøve 32 i test-maaling.ts kan se det i npm test.
export const forventning = {
  fil: "lib/maaling.ts",
  moenster: "type _AllowlistenDaekkerTyperne = IngenHuller<Huller>\n",
  traeffere: 1,
  erstat: "",
}
