/**
 * API Ngobrol (Express 5) — bagian REST.
 *
 * Pengiriman pesan real-time TIDAK lewat sini, melainkan lewat WebSocket
 * (lihat ws.js). Di sini hanya: kesehatan, akun, daftar ruang, dan riwayat.
 */
import express from 'express'
import cors from 'cors'
import { z } from 'zod'

import { buatToken, bacaToken, hashPassword, verifyPassword, bersihkanNama } from './auth.js'

export function createApp(db, opsi = {}) {
  const { ws = true } = opsi
  const app = express()
  app.use(cors())
  app.use(express.json())

  /** Mengambil pengguna dari header Authorization. */
  function penggunaDari(req) {
    const h = req.headers.authorization || ''
    const token = h.startsWith('Bearer ') ? h.slice(7) : ''
    const id = bacaToken(token)
    if (!id) return null
    return db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(id) ?? null
  }

  function wajibMasuk(req, res, next) {
    const u = penggunaDari(req)
    if (!u) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' })
    req.user = u
    next()
  }

  // "ws" memberi tahu klien apakah host ini mendukung WebSocket. Klien memilih
  // mode real-time berdasarkan ini — tanpa perlu mencoba menyambung lebih dulu
  // (menghindari error konsol saat WebSocket memang tidak tersedia).
  app.get('/api/health', (_req, res) => res.json({ ok: true, ws }))

  // ── Akun ──────────────────────────────────────────────────────────────────

  app.post('/api/auth/register', (req, res) => {
    const skema = z.object({ username: z.string(), password: z.string().min(6) })
    const p = skema.safeParse(req.body)
    if (!p.success) return res.status(400).json({ error: 'Nama pengguna & sandi (min. 6) wajib diisi.' })

    const nama = bersihkanNama(p.data.username)
    if (!nama) {
      return res.status(400).json({ error: 'Nama pengguna harus 3–20 karakter (huruf, angka, garis bawah).' })
    }
    const ada = db.prepare('SELECT id FROM users WHERE lower(username) = lower(?)').get(nama)
    if (ada) return res.status(409).json({ error: 'Nama pengguna sudah dipakai.' })

    const info = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run(nama, hashPassword(p.data.password))
    const user = { id: Number(info.lastInsertRowid), username: nama }
    res.status(201).json({ token: buatToken(user.id), user })
  })

  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body ?? {}
    if (!username || !password) return res.status(400).json({ error: 'Nama pengguna dan sandi wajib diisi.' })
    const u = db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)').get(String(username))
    if (!u || !verifyPassword(password, u.password_hash)) {
      return res.status(401).json({ error: 'Nama pengguna atau sandi salah.' })
    }
    res.json({ token: buatToken(u.id), user: { id: u.id, username: u.username } })
  })

  app.get('/api/auth/me', wajibMasuk, (req, res) => res.json({ user: req.user }))

  // ── Ruang ─────────────────────────────────────────────────────────────────

  app.get('/api/rooms', (_req, res) => {
    const rooms = db.prepare('SELECT id, slug, name, description FROM rooms ORDER BY id').all()
    const hitung = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE room_id = ?')
    res.json({
      rooms: rooms.map(r => ({
        id: r.id, slug: r.slug, name: r.name, description: r.description,
        messageCount: hitung.get(r.id).n,
      })),
    })
  })

  app.get('/api/rooms/:slug/messages', (req, res) => {
    const room = db.prepare('SELECT id, slug, name FROM rooms WHERE slug = ?').get(req.params.slug)
    if (!room) return res.status(404).json({ error: 'Ruang tidak ditemukan.' })
    const batas = Math.min(Number(req.query.limit ?? 50) || 50, 200)
    const baris = db.prepare(
      'SELECT id, username, body, created_at FROM messages WHERE room_id = ? ORDER BY id DESC LIMIT ?',
    ).all(room.id, batas)
    res.json({
      room: { id: room.id, slug: room.slug, name: room.name },
      messages: baris.reverse().map(m => ({ id: m.id, username: m.username, body: m.body, createdAt: m.created_at })),
    })
  })

  // ── Mode cadangan (polling) ───────────────────────────────────────────────
  // Dipakai bila host tidak mendukung WebSocket (mis. Vercel). Klien memanggil
  // ini berulang (~1,5 detik) untuk mengambil pesan baru + siapa yang online.
  // Bersamaan dengan itu, kehadiran pengguna diperbarui.

  /** Menandai pengguna hadir di ruang (dan kapan terakhir terlihat). */
  function catatHadir(userId, username, slug) {
    // Pengguna dianggap online HANYA di ruang yang sedang dibukanya — hapus
    // kehadiran di ruang lain agar tidak tampil online di dua ruang sekaligus.
    db.prepare('DELETE FROM presence WHERE user_id = ? AND room_slug <> ?').run(userId, slug)
    db.prepare(`
      INSERT INTO presence (user_id, room_slug, username, last_seen, typing_until)
      VALUES (?, ?, ?, ?, 0)
      ON CONFLICT (user_id, room_slug)
      DO UPDATE SET last_seen = excluded.last_seen, username = excluded.username
    `).run(userId, slug, username, Date.now())
  }

  /** Membersihkan kehadiran yang sudah kedaluwarsa (> 6 detik tidak terlihat). */
  function bersihkanHadir() {
    db.prepare('DELETE FROM presence WHERE last_seen < ?').run(Date.now() - 6000)
  }

  /** Nama-nama yang sedang online di sebuah ruang. */
  function daftarOnline(slug) {
    const baris = db.prepare('SELECT username FROM presence WHERE room_slug = ? AND last_seen >= ?')
      .all(slug, Date.now() - 6000)
    return [...new Set(baris.map(b => b.username))].sort()
  }

  /** Nama-nama yang sedang menulis di sebuah ruang. */
  function daftarMenulis(slug, kecuali) {
    const baris = db.prepare(
      'SELECT username FROM presence WHERE room_slug = ? AND typing_until >= ? AND username <> ?',
    ).all(slug, Date.now(), kecuali ?? '')
    return [...new Set(baris.map(b => b.username))].sort()
  }

  /** Mengambil pesan baru sejak id tertentu (untuk polling). */
  app.get('/api/rooms/:slug/poll', wajibMasuk, (req, res) => {
    const room = db.prepare('SELECT id, slug FROM rooms WHERE slug = ?').get(req.params.slug)
    if (!room) return res.status(404).json({ error: 'Ruang tidak ditemukan.' })

    const sejak = Number(req.query.since ?? 0) || 0
    catatHadir(req.user.id, req.user.username, room.slug)
    bersihkanHadir()

    const baris = db.prepare(
      'SELECT id, username, body, created_at FROM messages WHERE room_id = ? AND id > ? ORDER BY id LIMIT 100',
    ).all(room.id, sejak)

    res.json({
      messages: baris.map(m => ({ id: m.id, username: m.username, body: m.body, createdAt: m.created_at })),
      online: daftarOnline(room.slug),
      typing: daftarMenulis(room.slug, req.user.username),
    })
  })

  /** Menandai pengguna sedang menulis (mode cadangan). */
  app.post('/api/rooms/:slug/typing', wajibMasuk, (req, res) => {
    const room = db.prepare('SELECT slug FROM rooms WHERE slug = ?').get(req.params.slug)
    if (!room) return res.status(404).json({ error: 'Ruang tidak ditemukan.' })
    catatHadir(req.user.id, req.user.username, room.slug)
    // Menulis dianggap aktif selama 4 detik ke depan.
    db.prepare('UPDATE presence SET typing_until = ? WHERE user_id = ? AND room_slug = ?')
      .run(Date.now() + 4000, req.user.id, room.slug)
    res.json({ ok: true })
  })

  /** Mengirim pesan lewat REST (mode cadangan, tanpa WebSocket). */
  app.post('/api/rooms/:slug/messages', wajibMasuk, (req, res) => {
    const room = db.prepare('SELECT id, slug FROM rooms WHERE slug = ?').get(req.params.slug)
    if (!room) return res.status(404).json({ error: 'Ruang tidak ditemukan.' })

    const teks = String(req.body?.body ?? '').trim()
    if (!teks) return res.status(400).json({ error: 'Pesan tidak boleh kosong.' })
    if (teks.length > 1000) return res.status(400).json({ error: 'Pesan terlalu panjang (maks 1000 karakter).' })

    const info = db.prepare(
      'INSERT INTO messages (room_id, user_id, username, body) VALUES (?, ?, ?, ?)',
    ).run(room.id, req.user.id, req.user.username, teks)

    // Kirim pesan berarti berhenti menulis.
    db.prepare('UPDATE presence SET typing_until = 0 WHERE user_id = ? AND room_slug = ?')
      .run(req.user.id, room.slug)

    res.status(201).json({
      message: {
        id: Number(info.lastInsertRowid),
        username: req.user.username,
        body: teks,
        createdAt: new Date().toISOString(),
      },
    })
  })

  // Penangan "alamat tidak dikenal" untuk rute API. Sengaja TIDAK memakai
  // app.use(...) tanpa awalan, karena itu akan menangkap permintaan halaman
  // tampilan (mis. "/") sebelum penyaji berkas statis dipasang di index.js.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Alamat tidak dikenal.' }))

  return app
}
