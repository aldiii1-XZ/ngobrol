/**
 * Keadaan global Ngobrol: sesi pengguna, daftar ruang, dan koneksi real-time.
 *
 * Koneksi WebSocket dikelola di satu tempat. Saat ruang berganti, klien
 * mengirim {"tipe":"gabung"} dan server mengirim riwayat + daftar online.
 * Pesan yang masuk lewat soket langsung ditambahkan ke daftar (tanpa duplikat,
 * karena pengirim juga menerima gemanya sendiri dari server).
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import {
  api, alamatWs, ambilToken, simpanToken, GalatApi,
  type ChatMessage, type Room, type User,
} from './api'
import { gabungPesan } from './format'

/** Keadaan koneksi soket. */
export type StatusKoneksi = 'menyambung' | 'hidup' | 'mati'

/** Kunci localStorage untuk mengingat ruang terakhir yang dibuka. */
const KUNCI_RUANG = 'ngobrol_ruang'

interface Keadaan {
  user: User | null
  siap: boolean
  rooms: Room[]
  ruangAktif: string | null
  pesan: ChatMessage[]
  online: string[]
  menulis: string[]
  status: StatusKoneksi
  galat: string | null

  masuk: (username: string, password: string) => Promise<void>
  daftar: (username: string, password: string) => Promise<void>
  keluar: () => void
  pilihRuang: (slug: string) => void
  kirimPesan: (body: string) => void
  kabariMenulis: () => void
  bersihkanGalat: () => void
}

const Konteks = createContext<Keadaan | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [siap, setSiap] = useState(false)
  const [rooms, setRooms] = useState<Room[]>([])
  const [ruangAktif, setRuangAktif] = useState<string | null>(null)
  const [pesan, setPesan] = useState<ChatMessage[]>([])
  const [online, setOnline] = useState<string[]>([])
  const [menulis, setMenulis] = useState<string[]>([])
  const [status, setStatus] = useState<StatusKoneksi>('menyambung')
  const [galat, setGalat] = useState<string | null>(null)

  // Soket disimpan di ref agar tidak memicu render ulang.
  const soketRef = useRef<WebSocket | null>(null)
  const ruangRef = useRef<string | null>(null)
  const sambungUlangRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sengajaTutupRef = useRef(false)

  // Pulihkan sesi saat aplikasi dimuat.
  useEffect(() => {
    let batal = false
    ;(async () => {
      if (ambilToken()) {
        try {
          const { user: u } = await api.saya()
          if (!batal) setUser(u)
        } catch {
          simpanToken(null)
        }
      }
      if (!batal) setSiap(true)
    })()
    return () => { batal = true }
  }, [])

  // Muat daftar ruang saat pengguna masuk.
  useEffect(() => {
    if (!user) { setRooms([]); return }
    void (async () => {
      try {
        const { rooms: r } = await api.ruang()
        setRooms(r)
        // Pilih ruang terakhir yang dibuka (tersimpan di localStorage), atau
        // ruang pertama bila belum pernah memilih.
        if (r.length && !ruangRef.current) {
          const tersimpan = localStorage.getItem(KUNCI_RUANG)
          const pilih = tersimpan && r.some(x => x.slug === tersimpan) ? tersimpan : r[0].slug
          pilihRuang(pilih)
        }
      } catch (e) {
        setGalat(pesanGalat(e))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  /** Membuka koneksi WebSocket dan memasang penangan pesan. */
  const sambung = useCallback(() => {
    const token = ambilToken()
    if (!token) return

    if (sambungUlangRef.current) { clearTimeout(sambungUlangRef.current); sambungUlangRef.current = null }
    sengajaTutupRef.current = false
    setStatus('menyambung')

    const ws = new WebSocket(alamatWs(token))
    soketRef.current = ws

    ws.onopen = () => {
      setStatus('hidup')
      // Bila sudah ada ruang terpilih, langsung gabung lagi (mis. setelah putus).
      if (ruangRef.current) ws.send(JSON.stringify({ tipe: 'gabung', room: ruangRef.current }))
    }

    ws.onmessage = (ev) => {
      let m: any
      try { m = JSON.parse(ev.data) } catch { return }

      switch (m.tipe) {
        case 'riwayat':
          setPesan(m.pesan ?? [])
          break
        case 'pesan':
          setPesan(lama => gabungPesan(lama, [m.pesan]))
          // Pesan masuk dari orang lain berarti ia berhenti menulis.
          setMenulis(lama => lama.filter(n => n !== m.pesan.username))
          break
        case 'online':
          setOnline(m.users ?? [])
          break
        case 'menulis':
          setMenulis(lama => (lama.includes(m.username) ? lama : [...lama, m.username]))
          break
        case 'berhenti_menulis':
          setMenulis(lama => lama.filter(n => n !== m.username))
          break
        case 'galat':
          setGalat(m.pesan ?? 'Terjadi kesalahan.')
          break
      }
    }

    ws.onclose = () => {
      setStatus('mati')
      // Sambung ulang otomatis kecuali memang sengaja ditutup.
      if (!sengajaTutupRef.current) {
        sambungUlangRef.current = setTimeout(() => sambung(), 1500)
      }
    }

    ws.onerror = () => { /* onclose akan menangani */ }
  }, [])

  // Buka soket saat pengguna masuk; tutup saat keluar.
  useEffect(() => {
    if (!user) return
    sambung()
    return () => {
      sengajaTutupRef.current = true
      if (sambungUlangRef.current) clearTimeout(sambungUlangRef.current)
      soketRef.current?.close()
      soketRef.current = null
    }
  }, [user?.id, sambung])

  /** Berpindah ruang: beri tahu server, lalu bersihkan tampilan. */
  const pilihRuang = useCallback((slug: string) => {
    ruangRef.current = slug
    setRuangAktif(slug)
    setPesan([])
    setMenulis([])
    // Ingat pilihan agar setelah muat ulang tetap di ruang yang sama.
    try { localStorage.setItem(KUNCI_RUANG, slug) } catch { /* mode privat */ }
    const ws = soketRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ tipe: 'gabung', room: slug }))
    }
  }, [])

  /** Mengirim pesan lewat soket. */
  const kirimPesan = useCallback((body: string) => {
    const ws = soketRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setGalat('Belum tersambung ke server. Coba sebentar lagi.')
      return
    }
    ws.send(JSON.stringify({ tipe: 'pesan', body }))
  }, [])

  /** Memberi tahu server bahwa pengguna sedang menulis. */
  const kabariMenulis = useCallback(() => {
    const ws = soketRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ tipe: 'menulis' }))
  }, [])

  const masuk = useCallback(async (username: string, password: string) => {
    const { token, user: u } = await api.masuk({ username, password })
    simpanToken(token)
    setUser(u)
  }, [])

  const daftar = useCallback(async (username: string, password: string) => {
    const { token, user: u } = await api.daftar({ username, password })
    simpanToken(token)
    setUser(u)
  }, [])

  const keluar = useCallback(() => {
    sengajaTutupRef.current = true
    soketRef.current?.close()
    soketRef.current = null
    ruangRef.current = null
    simpanToken(null)
    setUser(null)
    setRuangAktif(null)
    setPesan([])
    setOnline([])
    setMenulis([])
  }, [])

  const nilai = useMemo<Keadaan>(() => ({
    user, siap, rooms, ruangAktif, pesan, online, menulis, status, galat,
    masuk, daftar, keluar, pilihRuang, kirimPesan, kabariMenulis,
    bersihkanGalat: () => setGalat(null),
  }), [
    user, siap, rooms, ruangAktif, pesan, online, menulis, status, galat,
    masuk, daftar, keluar, pilihRuang, kirimPesan, kabariMenulis,
  ])

  return <Konteks.Provider value={nilai}>{children}</Konteks.Provider>
}

export function useStore(): Keadaan {
  const k = useContext(Konteks)
  if (!k) throw new Error('useStore harus dipakai di dalam StoreProvider')
  return k
}

export function pesanGalat(err: unknown): string {
  if (err instanceof GalatApi) return err.message
  if (err instanceof Error) return err.message
  return 'Terjadi kesalahan. Coba lagi.'
}
