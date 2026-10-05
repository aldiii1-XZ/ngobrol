/**
 * Hub obrolan real-time.
 *
 * Semua logika "siapa sedang online", pengiriman pesan, dan indikator "sedang
 * menulis" ada di sini — TERPISAH dari soket sungguhan. Tiap peserta diwakili
 * objek `koneksi` sederhana yang punya metode `kirim(objek)`, sehingga seluruh
 * perilaku bisa diuji tanpa membuka jaringan sama sekali.
 *
 * Kehadiran & "sedang menulis" hanya hidup di memori (keadaan sesaat). Pesan
 * disimpan ke basis data agar riwayat tetap ada.
 */

/** Batas panjang pesan. */
const MAKS_PESAN = 1000
/** Jeda sebelum indikator "sedang menulis" otomatis hilang (ms). */
const TYPING_KEDALUWARSA = 4000

export function buatHub(db, opsi = {}) {
  /** roomSlug -> Set<koneksi> */
  const ruangan = new Map()
  /** koneksi -> { slug, timer } untuk pelacakan "sedang menulis" */
  const menulis = new Map()

  const sekarangIso = () => new Date().toISOString()

  function ambilRuangan(slug) {
    if (!ruangan.has(slug)) ruangan.set(slug, new Set())
    return ruangan.get(slug)
  }

  /** Daftar nama unik yang sedang online di sebuah ruang. */
  function daftarOnline(slug) {
    const isi = ruangan.get(slug)
    if (!isi) return []
    return [...new Set([...isi].map(k => k.username))].sort()
  }

  /** Mengirim ke semua peserta di ruang (boleh kecuali satu koneksi). */
  function sebarkan(slug, pesan, kecuali = null) {
    const isi = ruangan.get(slug)
    if (!isi) return
    for (const k of isi) {
      if (k === kecuali) continue
      k.kirim(pesan)
    }
  }

  /** Memancarkan daftar online terbaru ke seluruh ruang. */
  function pancarkanOnline(slug) {
    sebarkan(slug, { tipe: 'online', room: slug, users: daftarOnline(slug) })
  }

  return {
    /** Peserta masuk ke sebuah ruang. */
    gabung(koneksi, slug) {
      // Bila sudah ada di ruang lain, keluar dulu.
      if (koneksi.roomSlug && koneksi.roomSlug !== slug) this.keluarRuangan(koneksi)

      koneksi.roomSlug = slug
      ambilRuangan(slug).add(koneksi)

      // Kirim riwayat terbaru + daftar online ke peserta yang baru masuk.
      koneksi.kirim({ tipe: 'riwayat', room: slug, pesan: this.riwayat(slug) })
      koneksi.kirim({ tipe: 'online', room: slug, users: daftarOnline(slug) })
      // Beri tahu yang lain bahwa ada yang bergabung.
      sebarkan(slug, { tipe: 'bergabung', room: slug, username: koneksi.username }, koneksi)
      pancarkanOnline(slug)
    },

    /** Peserta keluar dari ruangnya saat ini. */
    keluarRuangan(koneksi) {
      const slug = koneksi.roomSlug
      if (!slug) return
      const isi = ruangan.get(slug)
      if (isi) isi.delete(koneksi)
      this.berhentiMenulis(koneksi)
      koneksi.roomSlug = null
      sebarkan(slug, { tipe: 'keluar', room: slug, username: koneksi.username })
      pancarkanOnline(slug)
    },

    /** Menyimpan & menyiarkan sebuah pesan. Mengembalikan pesan atau galat. */
    kirimPesan(koneksi, body) {
      const slug = koneksi.roomSlug
      if (!slug) return { galat: 'Kamu belum masuk ke ruang mana pun.' }

      const teks = String(body ?? '').trim()
      if (!teks) return { galat: 'Pesan tidak boleh kosong.' }
      if (teks.length > MAKS_PESAN) return { galat: `Pesan terlalu panjang (maks ${MAKS_PESAN} karakter).` }

      const room = db.prepare('SELECT id FROM rooms WHERE slug = ?').get(slug)
      if (!room) return { galat: 'Ruang tidak ditemukan.' }

      const info = db.prepare(
        'INSERT INTO messages (room_id, user_id, username, body) VALUES (?, ?, ?, ?)',
      ).run(room.id, koneksi.userId, koneksi.username, teks)

      const pesan = {
        id: Number(info.lastInsertRowid),
        username: koneksi.username,
        body: teks,
        createdAt: sekarangIso(),
      }

      // Pesan yang dikirim menandakan penulis berhenti menulis.
      this.berhentiMenulis(koneksi)

      // Siarkan ke semua peserta ruang — TERMASUK pengirim — supaya klien
      // punya satu sumber kebenaran (tidak menambah pesan sendiri → tak ada
      // duplikat, dan id dari server dipakai konsisten).
      sebarkan(slug, { tipe: 'pesan', room: slug, pesan })
      return { pesan }
    },

    /** Menandai peserta sedang/berhenti menulis. */
    sedangMenulis(koneksi, aktif = true) {
      const slug = koneksi.roomSlug
      if (!slug) return

      const lama = menulis.get(koneksi)
      if (lama) clearTimeout(lama.timer)

      if (aktif) {
        // Beri tahu peserta LAIN (bukan pengirimnya sendiri).
        sebarkan(slug, { tipe: 'menulis', room: slug, username: koneksi.username }, koneksi)
        // Otomatis berhenti bila tak ada kabar lanjutan.
        const timer = setTimeout(() => this.berhentiMenulis(koneksi), TYPING_KEDALUWARSA)
        if (typeof timer.unref === 'function') timer.unref()
        menulis.set(koneksi, { slug, timer })
      } else {
        menulis.delete(koneksi)
        sebarkan(slug, { tipe: 'berhenti_menulis', room: slug, username: koneksi.username }, koneksi)
      }
    },

    /** Menghapus status "sedang menulis" tanpa menyiarkan (dipakai internal). */
    berhentiMenulis(koneksi) {
      const lama = menulis.get(koneksi)
      if (lama) {
        clearTimeout(lama.timer)
        menulis.delete(koneksi)
      }
    },

    /** Riwayat pesan terbaru sebuah ruang (urut lama → baru). */
    riwayat(slug, batas = 50) {
      const room = db.prepare('SELECT id FROM rooms WHERE slug = ?').get(slug)
      if (!room) return []
      const baris = db.prepare(
        'SELECT id, username, body, created_at FROM messages WHERE room_id = ? ORDER BY id DESC LIMIT ?',
      ).all(room.id, batas)
      return baris.reverse().map(m => ({
        id: m.id, username: m.username, body: m.body, createdAt: m.created_at,
      }))
    },

    /** Jumlah peserta di semua ruang (untuk pemeriksaan/tes). */
    jumlahPeserta(slug) {
      return ruangan.get(slug)?.size ?? 0
    },
  }
}
