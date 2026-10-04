'use client'

// ═══════════════════════════════════════════════════════════════
//  Søgeformularen sender kun det, der betyder noget.
//
//  Uden den sendte formularen alle sine tomme felter, og siden svarede
//  307 til den rene adresse — en ekstra fuld rundtur ved hver søgning.
//  Her renses formularens data i `formdata`-hændelsen, som også fyrer
//  ved GET, så browseren går direkte til den rene adresse. Reglen er
//  den samme funktion, serverens redirect bruger (lib/soegeadresse.ts).
//
//  Progressiv forbedring og intet andet:
//    · Uden JavaScript sker der ingenting her, og redirectet gør det,
//      det altid har gjort.
//    · Ville rensningen fjerne ALT, gøres ingenting: en GET uden felter
//      lander på `/?`, mens serveren sender til `/`. Så får serveren lov
//      at svare, som den altid har gjort.
//    · Komponenten tegner intet og lægger intet i DOM'en. Formularen
//      findes gennem søgefeltets `form`-egenskab.
// ═══════════════════════════════════════════════════════════════

import { useEffect } from 'react'
import { renSoegning } from '../lib/soegeadresse'

export function RenSoegeformular({ feltId }: { feltId: string }) {
  useEffect(() => {
    const felt = document.getElementById(feltId)
    const form = felt instanceof HTMLInputElement ? felt.form : null
    if (!form) return
    const rens = (e: FormDataEvent) => {
      const par = [...e.formData.entries()]
        .filter((p): p is [string, string] => typeof p[1] === 'string')
      const { rent, snavs } = renSoegning(par)
      if (!snavs || rent.length === 0) return
      for (const navn of new Set(par.map(([n]) => n))) e.formData.delete(navn)
      for (const [navn, vaerdi] of rent) e.formData.append(navn, vaerdi)
    }
    form.addEventListener('formdata', rens)
    return () => form.removeEventListener('formdata', rens)
  }, [feltId])
  return null
}
