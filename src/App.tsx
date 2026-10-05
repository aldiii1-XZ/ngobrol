/** Kerangka aplikasi Ngobrol. */
import { useState } from 'react'
import { useStore } from './store/store'
import { MasukDaftar } from './pages/MasukDaftar'
import { RuangObrolan } from './pages/RuangObrolan'
import { Sidebar } from './components/Sidebar'

export function App() {
  const { user, siap, galat, bersihkanGalat } = useStore()
  const [sidebarTampil, setSidebarTampil] = useState(false)

  if (!siap) return <div className="muat">Menyiapkan…</div>
  if (!user) return <MasukDaftar />

  return (
    <>
      {galat && (
        <div
          className="pesan-galat"
          style={{ position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 100, margin: 0, maxWidth: 480 }}
          onClick={bersihkanGalat}
          role="alert"
        >
          {galat}
        </div>
      )}
      <div className="app-grid">
        <Sidebar tampil={sidebarTampil} tutup={() => setSidebarTampil(false)} />
        <RuangObrolan bukaSidebar={() => setSidebarTampil(true)} />
      </div>
    </>
  )
}
