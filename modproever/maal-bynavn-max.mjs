// Bynavnet som max() i stedet for den hyppigste stavemåde. Målingen skal
// gengive appens udtryk — ellers måler den noget andet, end siderne viser.
export const forventning = {
  fil: 'lib/omraade.ts',
  moenster: 'sql<string | null>`mode() within group (order by ${by})`',
  traeffere: 1,
  erstat: 'sql<string | null>`max(${by})`',
}
