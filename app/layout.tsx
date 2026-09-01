import './globals.css'
import type { ReactNode } from 'react'
import { Inter } from 'next/font/google'

// Hentes ved byg og selvhostes — ingen kald til Google fra brugerens browser.
const sans = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
})

export const metadata = {
  title: 'Bofinda — ledige lejeboliger',
  description:
    'Ledige lejeboliger samlet ét sted, med den reelle månedlige udgift og '
    + 'indflytningsprisen — ikke bare huslejen.',
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="da" className={sans.variable}>
      <body>
        <header className="top">
          <div className="ramme">
            <a className="maerke" href="/">bo<span>finda</span></a>
            <div className="undertitel">ledige lejeboliger, samlet ét sted</div>
          </div>
        </header>
        <div className="ramme">{children}</div>
      </body>
    </html>
  )
}
