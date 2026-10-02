// rens() uden try. Kaster den, sluger spor()'s egen catch fejlen, og
// tælleren står på nul, mens rens() er i stykker.
export const forventning = {
  fil: "lib/maaling-server.ts",
  moenster: "    let r: ReturnType<typeof rens>\n    try {\n      r = rens(ev, k, nu)\n    } catch (e) {",
  traeffere: 1,
  erstat: "    let r: ReturnType<typeof rens>\n    try {\n      r = rens(ev, k, nu)\n    } finally { /* intet */ }\n    if (false as boolean) {\n      const e = new Error()",
}
