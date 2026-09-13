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
        <header className="top">
          <div className="ramme toplinje">
            <a className="maerke" href="/">
              <span className="maerke-navn">Bofinda</span>
              <span className="maerke-under">lejeboliger, samlet ét sted</span>
            </a>
            {/* Kun destinationer, der FINDES. Konceptbillederne viser
                «Priser» og «Inbox»; dem har produktet ikke, og en menu,
                der lover sider, vi ikke har, er en tom knap i en
                situation, hvor nogen leder efter noget. */}
            <nav className="topnav" aria-label="Hovedmenu">
              <a href="/">Lejeboliger</a>
              <a className="nav-primaer" href="/udlejer">Udlej din bolig</a>
            </nav>
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
