'use client'

// ═══════════════════════════════════════════════════════════════
//  Billedbehandling i browseren.
//
//  Hvorfor her og ikke på serveren: en Server Action har en kropsgrænse
//  på 1 MB, og et telefonbillede er 3-8 MB. Filen skal alligevel aldrig
//  gennem os — den hører hjemme i udlejerens egen mappe i bucket'en.
//
//  Omtegningen på et canvas gør to ting på én gang: den skalerer ned, og
//  den STRIPPER EXIF. Et telefonbillede bærer GPS-koordinater for, hvor
//  det er taget — altså hvor boligen ligger, ofte på meteren. Det er ikke
//  vores at videregive, og udlejeren har ikke tænkt over det.
//
//  `imageOrientation: 'from-image'` gør, at billedet vender rigtigt EFTER
//  at EXIF er væk. Uden den ville liggende telefonbilleder blive drejet.
// ═══════════════════════════════════════════════════════════════

/** Længste kant efter nedskalering. 1600 er nok til lysbordet. */
const MAKS_KANT = 1600
/** Filer større end det er en fejltagelse, ikke et billede. */
export const MAKS_FIL = 25 * 1024 * 1024

export interface Klargjort {
  blob: Blob
  type: string
  navn: string
  /** Til forhåndsvisning, mens uploaden kører. Frigives af kalderen. */
  visning: string
}

export async function klargoer(fil: File): Promise<Klargjort> {
  if (!fil.type.startsWith('image/')) {
    throw new Error(`"${fil.name}" er ikke et billede.`)
  }
  if (fil.size > MAKS_FIL) {
    throw new Error(
      `"${fil.name}" fylder ${(fil.size / 1024 / 1024).toFixed(1)} MB. `
      + `Grænsen er ${MAKS_FIL / 1024 / 1024} MB.`,
    )
  }

  const kilde = await createImageBitmap(fil, { imageOrientation: 'from-image' })
  const skala = Math.min(1, MAKS_KANT / Math.max(kilde.width, kilde.height))
  const b = Math.max(1, Math.round(kilde.width * skala))
  const h = Math.max(1, Math.round(kilde.height * skala))

  const laerred = document.createElement('canvas')
  laerred.width = b
  laerred.height = h
  const t = laerred.getContext('2d')
  if (!t) throw new Error('Browseren kunne ikke behandle billedet.')
  t.drawImage(kilde, 0, 0, b, h)
  kilde.close()

  // WebP hvor browseren kan, ellers JPEG. Begge taber EXIF.
  const type = laerred.toDataURL('image/webp', 0.5).startsWith('data:image/webp')
    ? 'image/webp' : 'image/jpeg'
  const blob = await new Promise<Blob | null>((r) => laerred.toBlob(r, type, 0.82))
  if (!blob) throw new Error('Billedet kunne ikke komprimeres.')

  const stamme = fil.name.replace(/\.[^.]+$/, '') || 'billede'
  return {
    blob,
    type,
    navn: `${stamme}.${type === 'image/webp' ? 'webp' : 'jpg'}`,
    visning: URL.createObjectURL(blob),
  }
}
