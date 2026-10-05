/**
 * Keadaan global Ngobrol: sesi pengguna, daftar ruang, dan pengiriman real-time.
 *
 * DUA MODE, dipilih otomatis saat masuk:
 *   - "ws"   → WebSocket (sungguhan). Dipakai bila host mendukung (mis. Render).
 *   - "poll" → cadangan: meminta pesan baru tiap ~1,5 detik. Dipakai bila
 *              WebSocket tidak tersedia (mis. Vercel, yang serverless).
 *
 * Keduanya memberi hasil yang sama bagi pengguna: pesan muncul tanpa refresh,
 * ada daftar online, dan indikator "sedang menulis". Bedanya hanya kecepatan
 * dan cara kerjanya di balik layar.
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

/** Keadaan koneksi. */
export type StatusKoneksi = 'menyambung' | 'hidup' | 'mati'
/** Cara real-time yang sedang dipakai. */
export type ModeKoneksi = 'ws' | 'poll' | null

/** Kunci localStorage untuk mengingat ruang terakhir yang dibuka. */
const KUNCI_RUANG = 'ngobrol_ruang'
/** Jeda antar-permintaan pada mode cadangan (ms). */
const JEDA_POLL = 1500

interface Keadaan {
  user: User | null
  siap: boolean
  rooms: Room[]
  ruangAktif: string | null
  pesan: ChatMessage[]
  online: string[]
  menulis: string[]
  status: StatusKoneksi
  mode: ModeKoneksi
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
  const [mode, setMode] = useState<ModeKoneksi>(null)
  const [galat, setGalat] = useState<string | null>(null)

  // Semua yang berubah tanpa memicu render ulang disimpan di ref.
  const soketRef = useRef<WebSocket | null>(null)
  const ruangRef = useRef<string | null>(null)
  const modeRef = useRef<ModeKoneksi>(null)
  const sambungUlangRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sengajaTutupRef = useRef(false)
  const sejakRef = useRef(0)          // id pesan terakhir (mode cadangan)
  const hidupRef = useRef(true)       // penanda komponen masih terpasang

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

  // ── Mode WebSocket ────────────────────────────────────────────────────────

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
      setMode('ws')
      modeRef.current = 'ws'
      // Bila sudah ada ruang terpilih, langsung gabung (mis. setelah putus).
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
      if (!sengajaTutupRef.current && hidupRef.current) {
        sambungUlangRef.current = setTimeout(() => sambung(), 1500)
      }
    }

    ws.onerror = () => { /* onclose akan menangani */ }
  }, [])

  // ── Mode cadangan (polling) ───────────────────────────────────────────────

  /** Satu putaran polling: ambil pesan baru + daftar online & menulis. */
  const satuPutaranPoll = useCallback(async () => {
    const slug = ruangRef.current
    if (!slug) return
    try {
      const { messages, online: on, typing } = await api.poll(slug, sejakRef.current)
      if (messages.length) {
        sejakRef.current = Math.max(sejakRef.current, ...messages.map(m => m.id))
        setPesan(lama => gabungPesan(lama, messages))
      }
      setOnline(on)
      setMenulis(typing)
      setStatus('hidup')
    } catch (e) {
      setStatus('mati')
      // Galat 401 = sesi habis; jangan berputar terus.
      if (e instanceof GalatApi && e.status === 401) return
    }
  }, [])

  /** Menjalankan polling berulang selama komponen masih hidup. */
  const mulaiPolling = useCallback(() => {
    const putar = async () => {
      if (!hidupRef.current || modeRef.current !== 'poll') return
      await satuPutaranPoll()
      if (!hidupRef.current || modeRef.current !== 'poll') return
      pollTimerRef.current = setTimeout(putar, JEDA_POLL)
    }
    void putar()
  }, [satuPutaranPoll])

  // Saat pengguna masuk: coba WebSocket dulu; bila gagal, pakai polling.
  useEffect(() => {
    if (!user) return
    hidupRef.current = true
    const token = ambilToken()
    if (!token) return

    let batal = false
    ;(async () => {
      // Tanyakan dulu apakah host mendukung WebSocket. Bila ya, pakai WebSocket;
      // bila tidak, langsung mode cadangan — tanpa mencoba menyambung lebih dulu
      // (agar tidak muncul error di konsol browser).
      let wsBisa = false
      try {
        const info = await api.info()
        wsBisa = info.ws === true
      } catch {
        wsBisa = false
      }
      if (batal) return
      if (wsBisa) {
        modeRef.current = 'ws'
        sambung()
      } else {
        // WebSocket tidak tersedia → mode cadangan.
        modeRef.current = 'poll'
        setMode('poll')
        setStatus('menyambung')
        mulaiPolling()
      }
    })()

    return () => {
      batal = true
      hidupRef.current = false
      sengajaTutupRef.current = true
      if (sambungUlangRef.current) clearTimeout(sambungUlangRef.current)
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
      soketRef.current?.close()
      soketRef.current = null
      modeRef.current = null
    }
  }, [user?.id, sambung, mulaiPolling])

  // ── Aksi ──────────────────────────────────────────────────────────────────

  /** Berpindah ruang: bersihkan tampilan, lalu bergabung dengan cara sesuai mode. */
  const pilihRuang = useCallback((slug: string) => {
    ruangRef.current = slug
    setRuangAktif(slug)
    setPesan([])
    setMenulis([])
    setOnline([])
    sejakRef.current = 0
    try { localStorage.setItem(KUNCI_RUANG, slug) } catch { /* mode privat */ }

    if (modeRef.current === 'ws') {
      const ws = soketRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ tipe: 'gabung', room: slug }))
      }
    } else if (modeRef.current === 'poll') {
      // Muat riwayat lebih dulu, lalu lanjutkan polling dari pesan terakhir.
      void (async () => {
        try {
          const { messages } = await api.riwayat(slug, 50)
          if (ruangRef.current !== slug) return
          setPesan(messages)
          sejakRef.current = messages.length ? Math.max(...messages.map(m => m.id)) : 0
          void satuPutaranPoll()
        } catch (e) {
          setGalat(pesanGalat(e))
        }
      })()
    }
  }, [satuPutaranPoll])

  /** Mengirim pesan (lewat soket atau REST, sesuai mode). */
  const kirimPesan = useCallback((body: string) => {
    const slug = ruangRef.current
    if (!slug) return

    if (modeRef.current === 'ws') {
      const ws = soketRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setGalat('Belum tersambung ke server. Coba sebentar lagi.')
        return
      }
      ws.send(JSON.stringify({ tipe: 'pesan', body }))
      return
    }

    // Mode cadangan: kirim lewat REST, lalu langsung ambil pembaruan.
    void (async () => {
      try {
        await api.kirimLewatRest(slug, body)
        await satuPutaranPoll()
      } catch (e) {
        setGalat(pesanGalat(e))
      }
    })()
  }, [satuPutaranPoll])

  /** Memberi tahu server bahwa pengguna sedang menulis. */
  const kabariMenulis = useCallback(() => {
    const slug = ruangRef.current
    if (!slug) return
    if (modeRef.current === 'ws') {
      const ws = soketRef.current
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ tipe: 'menulis' }))
    } else if (modeRef.current === 'poll') {
      void api.kabariMenulisRest(slug).catch(() => { /* abaikan */ })
    }
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
    hidupRef.current = false
    sengajaTutupRef.current = true
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    soketRef.current?.close()
    soketRef.current = null
    modeRef.current = null
    ruangRef.current = null
    simpanToken(null)
    setUser(null)
    setRuangAktif(null)
    setPesan([])
    setOnline([])
    setMenulis([])
    setMode(null)
  }, [])

  const nilai = useMemo<Keadaan>(() => ({
    user, siap, rooms, ruangAktif, pesan, online, menulis, status, mode, galat,
    masuk, daftar, keluar, pilihRuang, kirimPesan, kabariMenulis,
    bersihkanGalat: () => setGalat(null),
  }), [
    user, siap, rooms, ruangAktif, pesan, online, menulis, status, mode, galat,
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
