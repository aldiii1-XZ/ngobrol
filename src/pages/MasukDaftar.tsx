/** Halaman masuk & daftar akun. */
import { useState } from 'react'
import { useStore, pesanGalat } from '../store/store'

export function MasukDaftar() {
  const { masuk, daftar } = useStore()
  const [mode, setMode] = useState<'masuk' | 'daftar'>('masuk')
  const [nama, setNama] = useState('')
  const [sandi, setSandi] = useState('')
  const [galat, setGalat] = useState<string | null>(null)
  const [sibuk, setSibuk] = useState(false)

  async function kirim(e: React.FormEvent) {
    e.preventDefault()
    setSibuk(true); setGalat(null)
    try {
      if (mode === 'masuk') await masuk(nama, sandi)
      else await daftar(nama, sandi)
    } catch (err) {
      setGalat(pesanGalat(err))
    } finally {
      setSibuk(false)
    }
  }

  const valid = nama.trim().length >= 3 && sandi.length >= 6

  return (
    <div className="tengah">
      <div className="kartu masuk-kartu">
        <h1>Ngobrol<span style={{ color: 'var(--brand)' }}>.</span></h1>
        <p className="sub">Ruang obrolan real-time — pesan muncul seketika.</p>

        <form onSubmit={kirim}>
          <label className="bidang">
            <span>Nama pengguna</span>
            <input
              value={nama}
              onChange={e => setNama(e.target.value)}
              placeholder="mis. aldi"
              autoComplete="username"
              autoFocus
            />
          </label>
          <label className="bidang">
            <span>Sandi</span>
            <input
              type="password"
              value={sandi}
              onChange={e => setSandi(e.target.value)}
              placeholder="Minimal 6 karakter"
              autoComplete={mode === 'masuk' ? 'current-password' : 'new-password'}
            />
          </label>

          {galat && <div className="pesan-galat">{galat}</div>}

          <button className="tombol" type="submit" disabled={!valid || sibuk} style={{ width: '100%' }}>
            {sibuk ? 'Memproses…' : mode === 'masuk' ? 'Masuk' : 'Daftar'}
          </button>
        </form>

        <p className="petunjuk" style={{ textAlign: 'center' }}>
          {mode === 'masuk' ? 'Belum punya akun? ' : 'Sudah punya akun? '}
          <button
            onClick={() => { setMode(mode === 'masuk' ? 'daftar' : 'masuk'); setGalat(null) }}
            style={{ background: 'none', border: 0, color: 'var(--brand)', fontWeight: 700, cursor: 'pointer', padding: 0 }}
          >
            {mode === 'masuk' ? 'Daftar di sini' : 'Masuk di sini'}
          </button>
        </p>

        <p className="petunjuk">
          <strong>Akun contoh:</strong><br />
          aldi / aldi12345<br />
          rina / rina12345
        </p>
      </div>
    </div>
  )
}
