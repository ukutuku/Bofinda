// K14 tilbage i sin anden skikkelse: et HTTP-fejlsvar læses som en
// GYLDIG tom liste. Så forsvinder pilene, intet forsøges igen, og der
// står ingen besked — en fejl forklædt som «ingen billeder».
// `kortkarusel.mjs` skal være rød på [K14] (HTTP 500-scenariet).
export const forventning = {
  fil: 'app/KortBilleder.tsx',
  moenster: 'if (!r.ok) return FEJL',
  traeffere: 1,
  naer: 'fetch(`/api/kortbilleder/${id}`)',
  naerVindue: 3,
  erstat: 'if (!r.ok) return { ok: true, billeder: [] }',
}
