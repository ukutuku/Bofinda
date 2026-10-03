// Kontrakten lover «ingen React». En React-import skal være rød her —
// og kun her: app/Hastighed.tsx lover det ikke.
export const forventning = {
  fil: 'app/beskeder/kontrakt.ts',
  moenster: "export type Laasegrund = 'login-kraevet'",
  traeffere: 1,
  erstat: "import { useState } from 'react'\nexport const _brug = useState\nexport type Laasegrund = 'login-kraevet'",
}
