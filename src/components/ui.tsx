/** Komponen tampilan kecil untuk Ngobrol. */
import { inisial, warnaAvatar } from '../store/format'

/** Avatar bulat dengan inisial berwarna. */
export function Avatar({ nama, ukuran = 30 }: { nama: string; ukuran?: number }) {
  return (
    <span
      className="avatar"
      style={{ width: ukuran, height: ukuran, background: warnaAvatar(nama), fontSize: ukuran * 0.42 }}
      title={nama}
    >
      {inisial(nama)}
    </span>
  )
}

/** Titik status koneksi + keterangan. */
export function StatusTitik({ status }: { status: 'menyambung' | 'hidup' | 'mati' }) {
  const teks = status === 'hidup' ? 'Tersambung' : status === 'menyambung' ? 'Menyambung…' : 'Terputus'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span className={`titik ${status}`} />
      <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{teks}</span>
    </span>
  )
}

/** Indikator tiga titik "sedang menulis". */
export function TitikMenulis() {
  return <span className="menulis-titik"><i /><i /><i /></span>
}
