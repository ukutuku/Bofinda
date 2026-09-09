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
          <div className="ramme">
            <a className="maerke" href="/">bo<span>finda</span></a>
            <div className="undertitel">lejeboliger, samlet ét sted</div>
            {/* Linket er STATISK tekst med vilje. Skulle toppen vise, om
                man er logget ind, skulle layoutet laese cookies — og saa
                blev hver eneste side dynamisk, ogsaa /privatliv, som i dag
                praerenderes. Login-status staar paa Min side, hvor den
                betyder noget. */}
            <a className="topmin" href="/min-side">Min side</a>
          </div>
        </header>
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
        <Samtykke />
      </body>
    </html>
  )
}
