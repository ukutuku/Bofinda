import { redirect } from 'next/navigation'
import { hentUdlejer } from '../../../lib/auth'
import { Annonceformular } from '../Annonceformular'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Opret annonce — Bofinda', robots: { index: false } }

export default async function Side() {
  if (!await hentUdlejer()) redirect('/udlejer')
  return (
    <div className="udlejer">
      <a className="tilbage" href="/udlejer/boliger">← Mine annoncer</a>
      <h1>Opret annonce</h1>
      <Annonceformular />
    </div>
  )
}
