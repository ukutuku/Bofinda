// Ingen talt-række. Så er nul rækker både «intet kasseret» og «ikke talt».
export const forventning = {
  fil: "lib/maaling-server.ts",
  moenster: "  if (await taelOp(m, '', '', 'talt', nu, 0)) _taltDag = noegle\n",
  traeffere: 1,
  erstat: "  void m; void nu; _taltDag = noegle\n",
}
