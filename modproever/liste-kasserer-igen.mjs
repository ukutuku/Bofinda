// En værdi uden for listen kasserer igen hele eventet, som før.
export const forventning = {
  fil: "lib/maaling.ts",
  moenster: "    if (t === 'liste') { afviste.push(noegle); continue }",
  traeffere: 1,
  erstat: "    if (t === 'liste') return { ok: false, fejl: { grund: 'forkert-type', detalje: noegle } }",
}
