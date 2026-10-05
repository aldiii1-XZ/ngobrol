/** Kolom obrolan: daftar pesan, daftar online, indikator menulis, kotak kirim. */
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/store'
import { jam, bedaHari, singkat } from '../store/format'
import { Avatar, StatusTitik, TitikMenulis } from '../components/ui'
import type { ChatMessage } from '../store/api'

export function RuangObrolan({ bukaSidebar }: { bukaSidebar: () => void }) {
  const { rooms, ruangAktif, pesan, online, menulis, status, user, kirimPesan, kabariMenulis } = useStore()
  const [teks, setTeks] = useState('')
  const [nempelBawah, setNempelBawah] = useState(true)
  const isiRef = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const jamMenulisRef = useRef<number>(0)

  const ruang = rooms.find(r => r.slug === ruangAktif)

  // Gulir ke bawah saat ada pesan baru, bila pengguna sedang di bawah.
  useEffect(() => {
    if (nempelBawah && isiRef.current) {
      isiRef.current.scrollTop = isiRef.current.scrollHeight
    }
  }, [pesan.length, menulis.length, nempelBawah])

  // Deteksi apakah pengguna sedang melihat bagian bawah.
  function cekGulir() {
    const el = isiRef.current
    if (!el) return
    const sisa = el.scrollHeight - el.scrollTop - el.clientHeight
    setNempelBawah(sisa < 80)
  }

  /** Menyesuaikan tinggi kotak teks dengan isinya. */
  function sesuaikanTinggi() {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }

  function kirim() {
    const isi = teks.trim()
    if (!isi) return
    kirimPesan(isi)
    setTeks('')
    setNempelBawah(true)
    // Reset pembatas "sedang menulis" agar bila pengguna langsung mengetik
    // lagi, indikatornya segera muncul (tidak tertahan ~2 detik).
    jamMenulisRef.current = 0
    requestAnimationFrame(sesuaikanTinggi)
  }

  function padaTombol(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter mengirim; Shift+Enter membuat baris baru.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      kirim()
    }
  }

  /** Memberi tahu "sedang menulis", dibatasi tiap 2 detik. */
  function padaKetik(nilai: string) {
    setTeks(nilai)
    sesuaikanTinggi()
    const kini = Date.now()
    if (nilai.trim() && kini - jamMenulisRef.current > 2000) {
      jamMenulisRef.current = kini
      kabariMenulis()
    }
  }

  const menulisLain = menulis.filter(n => n !== user?.username)

  return (
    <section className="obrolan">
      <header className="obrolan-kepala">
        <button className="buka-sidebar" onClick={bukaSidebar} aria-label="Buka daftar ruang">☰</button>
        <div style={{ flex: 1 }}>
          <h2># {ruang?.name ?? '—'}</h2>
          <div className="ket">{ruang?.description ?? ''}</div>
        </div>
        <StatusTitik status={status} />
      </header>

      <div className="daftar-online">
        <span className="pil-online"><span className="titik hidup" />{online.length} online</span>
        {online.map(n => (
          <span className="pil-online" key={n}>
            <Avatar nama={n} ukuran={16} />
            {n}{n === user?.username ? ' (kamu)' : ''}
          </span>
        ))}
      </div>

      <div className="obrolan-isi" ref={isiRef} onScroll={cekGulir}>
        {pesan.length === 0 ? (
          <div className="kosong">
            Belum ada pesan di #{ruang?.name ?? ''}.<br />Jadilah yang pertama menyapa! 👋
          </div>
        ) : (
          pesan.map((m, i) => (
            <BarisPesan key={m.id} pesan={m} sendiri={m.username === user?.username} sebelum={pesan[i - 1]} />
          ))
        )}
      </div>

      <div className="menulis-baris">
        {menulisLain.length > 0 && (
          <>
            <TitikMenulis />
            <span>
              {menulisLain.length === 1
                ? `${menulisLain[0]} sedang menulis…`
                : `${menulisLain.length} orang sedang menulis…`}
            </span>
          </>
        )}
      </div>

      <div className="kotak-kirim">
        <textarea
          ref={areaRef}
          rows={1}
          value={teks}
          placeholder={`Tulis pesan ke #${ruang?.name ?? ''}…  (Enter untuk kirim)`}
          onChange={e => padaKetik(e.target.value)}
          onKeyDown={padaTombol}
          disabled={status !== 'hidup'}
          aria-label="Tulis pesan"
        />
        <button className="tombol" onClick={kirim} disabled={!teks.trim() || status !== 'hidup'}>
          Kirim
        </button>
      </div>
    </section>
  )
}

/** Satu baris pesan, dengan pemisah tanggal bila hari berganti. */
function BarisPesan({ pesan, sendiri, sebelum }: {
  pesan: ChatMessage
  sendiri: boolean
  sebelum?: ChatMessage
}) {
  const gantiHari = !sebelum || bedaHari(sebelum.createdAt, pesan.createdAt)

  return (
    <>
      {gantiHari && <div className="sistem">— {jam(pesan.createdAt)} · {pesan.createdAt.slice(0, 10)} —</div>}
      <div className={`pesan ${sendiri ? 'sendiri' : ''}`}>
        {!sendiri && <Avatar nama={pesan.username} ukuran={30} />}
        <div>
          {!sendiri && <div className="pesan-nama">{pesan.username}</div>}
          <div className="pesan-isi">
            <div className="pesan-teks">{pesan.body}</div>
            <div className="pesan-jam">{jam(pesan.createdAt)}</div>
          </div>
        </div>
      </div>
    </>
  )
}

/** Pratinjau singkat untuk judul halaman (dipakai App). */
export function judulRuang(nama: string | undefined, terakhir: string | undefined): string {
  if (!nama) return 'Ngobrol'
  if (!terakhir) return `#${nama} · Ngobrol`
  return `#${nama} — ${singkat(terakhir, 30)}`
}
