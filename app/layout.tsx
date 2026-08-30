import './globals.css'
import type { ReactNode } from 'react'

export const metadata = {
  title: 'Bofinda — ledige lejeboliger',
  description: 'Ledige lejeboliger samlet ét sted.',
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="da">
      <body>
        <header className="top">
          <div className="ramme">
            <div className="maerke">bo<span>finda</span></div>
            <div className="undertitel">ledige lejeboliger, samlet ét sted</div>
          </div>
        </header>
        <div className="ramme">{children}</div>
      </body>
    </html>
  )
}
