'use client'
// ═══════════════════════════════════════════════════════════════
//  Beskederne i rejsen — beskedmodulet, GENBRUGT.
//
//  ═══ DER BYGGES INGEN NY INDBAKKE ═══
//
//  `Beskedmodul` ER indbakken. Den har sin egen liste, sin egen tråd,
//  sit eget skrivefelt, sine egne tilstande og sine egne prøver. At
//  bygge en «lille indbakke» her ville give to steder, der svarede på
//  det samme spørgsmål — og de ville drive fra hinanden ved første
//  rettelse. Rejsen leverer en port og et sted at stå.
//
//  ═══ LÅST? SÅ FINDES AFSNITTET IKKE ═══
//
//  Afsnittet gengives KUN, når adapteren har sagt `adgang` og der er en
//  samtale. Er adgangen lukket, monteres modulet aldrig: der er ingen
//  port at kalde, intet svar at gemme og intet indhold at komme til at
//  vise. Ikke skjult — fraværende.
//
//  Og der står derfor heller ikke en låst beskedboks UNDER den låste
//  kontaktboks. Ét svar, ét sted, én knap. To bokse med samme besked er
//  den gentagne salgsopfordring, opgaven beder os lade være med.
//
//  Bliver adgangen lukket, MENS indbakken er åben, er det modulets egen
//  sag: den går selv i låst visning og kasserer sene svar. Se
//  app/beskeder/DATAKONTRAKT.md.
// ═══════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react'
import { Beskedmodul } from '../beskeder/Beskedmodul'
import type { Beskedport } from '../beskeder/kontrakt'

export function Samtaleafsnit({ aaben, port, loginHref, abonnementHref }: {
  aaben: boolean
  port: Beskedport
  loginHref: string
  abonnementHref: string
}) {
  const titel = useRef<HTMLHeadingElement>(null)
  // Afsnittet dukker op EFTER et tryk. Fokus skal følge med, ellers står
  // den, der bruger tastatur eller skærmlæser, tilbage ved knappen og
  // opdager aldrig, at der kom noget nyt længere nede.
  useEffect(() => { if (aaben) titel.current?.focus() }, [aaben])

  if (!aaben) return null

  return (
    <section className="kui-beskeder" aria-label="Beskeder">
      <h2 className="kui-afsnitstitel" ref={titel} tabIndex={-1}>Beskeder</h2>
      <Beskedmodul port={port} loginHref={loginHref} abonnementHref={abonnementHref} />
    </section>
  )
}
