// Hukommelsen sættes, før skrivningen er lykkedes. Fejler den, står dagen
// tavst som ikke talt resten af instansens levetid.
export const forventning = {
  fil: "lib/maaling-server.ts",
  moenster: "  if (await taelOp(m, '', '', 'talt', nu, 0)) _taltDag = noegle\n",
  traeffere: 1,
  erstat: "  _taltDag = noegle\n  await taelOp(m, '', '', 'talt', nu, 0)\n",
}
