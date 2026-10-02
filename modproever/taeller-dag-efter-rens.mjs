// Dagens talt-række flyttes til efter rens(). En dag, hvor alt blev
// kasseret, ser så ud, som om der ikke blev talt.
export const forventning = {
  fil: "lib/maaling-server.ts",
  moenster: "    const nu = o.nu ?? new Date()\n    await efter(() => taelDag(k.miljoe, nu))\n",
  traeffere: 1,
  erstat: "    const nu = o.nu ?? new Date()\n",
}
