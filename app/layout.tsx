import './globals.css'
import type { ReactNode } from 'react'
import { Inter } from 'next/font/google'
import { Samtykke } from './Samtykke'
import { erDesignpreview } from '../lib/designpreview'

// Hentes ved byg og selvhostes — ingen kald til Google fra brugerens browser.
const sans = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
})

export const metadata = {
  title: 'Bofinda — lejeboliger, samlet ét sted',
  description:
    'Lejeboliger samlet ét sted, med den månedlige betaling til udlejer og '
    + 'indflytningsprisen — ikke bare huslejen.',
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="da" className={sans.variable}>
      <body>
        {/* ── Samtykkebanneret staar FOERST i markuppen ─────────
            Det ligger visuelt fast i bunden, men det hoerer foerst i
            tabulatorraekkefoelgen. Laa det sidst — som det gjorde —
            skulle man 106 tryk gennem hele resultatsiden for at naa
            «Kun det noedvendige»; kortets maerker alene var 46 af dem.
            Et banner, der beder om et svar, maa ikke vaere det svaereste
            paa siden at naa.

            Bagud var det altid ét Shift+Tab vaek. Det er ikke godt nok:
            forlaens er den retning, man tabulerer i. */}
        <Samtykke />
        {/* ── Brandbjælken ──────────────────────────────────────
            Mockuppens bjælke: wordmark til venstre, menuen ved siden af,
            handlingerne yderst til højre. Undertitlen er væk — den stod som
            en 11,5 px linje under mærket og gjorde wordmarket til en
            billedtekst i stedet for et logo.

            KUN DESTINATIONER, DER FINDES. Referencen viser «Priser»,
            «Inbox», «Log ind» og «Kom i gang». Priser og Inbox har
            produktet ikke, og de står derfor ikke her. «Min side» gør:
            brugerområdet kom med PR #3, og er det eneste sted, man kan
            nå sine favoritter og gemte søgninger. Havde bjælken kun
            handlingen, ville adgangen til det kun findes i sidefoden —
            og så ville den i praksis ikke findes.

            «Min side» ligger i `.tophandlinger` og IKKE i `.topnav`,
            fordi menuen skjules under 720 px til fordel for handlingen.
            Lå linket i menuen, forsvandt brugerområdet fra toppen på en
            telefon, uden at noget så forkert ud. */}
        <header className="top">
          <div className="ramme toplinje">
            <a className="maerke" href="/">BOFINDA</a>
            <nav className="topnav" aria-label="Hovedmenu">
              <a href="/">Lejeboliger</a>
              <a href="/udlejer">For udlejere</a>
            </nav>
            <div className="tophandlinger">
              {/* Linket er STATISK tekst med vilje. Skulle toppen vise, om
                  man er logget ind, skulle layoutet laese cookies — og saa
                  blev hver eneste side dynamisk, ogsaa /privatliv, som i dag
                  praerenderes. Login-status staar paa Min side, hvor den
                  betyder noget. */}
              <a className="topmin" href="/min-side">Min side</a>
              <a className="nav-primaer" href="/udlejer/opret">Opret annonce</a>
            </div>
          </div>
        </header>
        {erDesignpreview() && (
          <p className="designpreview-note">
            Designpreview · Fiktive demoboliger og stemningsfotos. Boligerne kan ikke lejes.
          </p>
        )}
        <div className="ramme">{children}</div>
        <footer className="sidefod">
          <div className="ramme">
            <a href="/min-side">Min side</a>
            <a href="/udlejer">Udlej din bolig</a>
            <a href="/privatliv">Privatlivspolitik</a>
            {/* Tilbagetrækning skal være lige så let som at sige ja. */}
            <a href="/privatliv#statistik">Skift dit valg om statistik</a>
            <span>Boliger hentet fra offentligt tilgængelige udlejningsportaler
              samt annoncer oprettet af udlejere selv. Henvendelse sker hos
              kilden eller direkte hos udlejeren.</span>
          </div>
        </footer>
      </body>
    </html>
  )
}
