// Allowlisten annoteres i stedet for `satisfies`. Literaltyperne går tabt,
// hver liste bliver `string` for typesystemet, og en vagt uden den anden
// gren ville melde «ingen huller» — grøn ved blindhed.
export const forventning = {
  fil: "lib/maaling.ts",
  moenster: "export const ALLOWLIST = {",
  traeffere: 1,
  erstat: "export const ALLOWLIST: Record<Eventnavn, Record<string, Spec>> = {",
}
