import './globals.css'
import type { ReactNode } from 'react'
import { Inter } from 'next/font/google'
import { Samtykke } from './Samtykke'

// Hentes ved byg og selvhostes — ingen kald til Google fra brugerens browser.
const sans = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
})

export const metadata = {
  title: 'Bofinda — lejeboliger, samlet ét sted',
  description:
    'Lejeboliger samlet ét sted, med den reelle månedlige udgift og '
    + 'indflytningsprisen — ikke bare huslejen.',
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="da" className={sans.variable}>
      <body>
        {/* ── Brandbjælken ──────────────────────────────────────
            Mockuppens bjælke: wordmark til venstre, menuen ved siden af,
            handlingen yderst til højre. Undertitlen er væk — den stod som
            en 11,5 px linje under mærket og gjorde wordmarket til en
            billedtekst i stedet for et logo.

            KUN DESTINATIONER, DER FINDES. Referencen viser «Priser»,
            «Inbox», «Log ind» og «Kom i gang». Priser og Inbox har
            produktet ikke; login hører til PR #3 og er ikke på denne
            gren. En menu, der lover sider, vi ikke har, er en tom knap i
            en situation, hvor nogen leder efter noget. */}
        <header className="top">
          <div className="ramme toplinje">
            <a className="maerke" href="/">BOFINDA</a>
            <nav className="topnav" aria-label="Hovedmenu">
              <a href="/">Lejeboliger</a>
              <a href="/udlejer">For udlejere</a>
            </nav>
            <div className="tophandlinger">
              <a className="nav-primaer" href="/udlejer/opret">Opret annonce</a>
            </div>
          </div>
        </header>
        <div className="ramme">{children}</div>
        <footer className="sidefod">
          <div className="ramme">
            <a href="/udlejer">Udlej din bolig</a>
            <a href="/privatliv">Privatlivspolitik</a>
            {/* Tilbagetrækning skal være lige så let som at sige ja. */}
            <a href="/privatliv#statistik">Skift dit valg om statistik</a>
            <span>Boliger hentet fra offentligt tilgængelige udlejningsportaler
              samt annoncer oprettet af udlejere selv. Henvendelse sker hos
              kilden eller direkte hos udlejeren.</span>
          </div>
        </footer>
        <Samtykke />
      </body>
    </html>
  )
}
