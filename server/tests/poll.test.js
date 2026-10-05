/**
 * Tes mode cadangan (polling) lewat REST.
 *
 * Membuktikan bahwa tanpa WebSocket pun, pesan tetap sampai ke pengguna lain,
 * daftar online terisi, dan indikator "sedang menulis" bekerja — inilah yang
 * dipakai saat aplikasi berjalan di host serverless (mis. Vercel).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openDatabase, migrate } from '../src/db.js'
import { seedDatabase } from '../src/seed.js'
import { createApp } from '../src/app.js'

async function siapkan() {
  const dir = mkdtempSync(join(tmpdir(), 'ngobrol-poll-'))
  const db = openDatabase(join(dir, 'uji.db'))
  migrate(db)
  seedDatabase(db)
  const app = createApp(db)
  const server = createServer(app)
  await new Promise(r => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}`

  /** Masuk dan kembalikan token. */
  async function masuk(username, password) {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    return (await res.json()).token
  }

  async function req(method, jalur, { body, token } = {}) {
    const res = await fetch(base + jalur, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: res.status, data: await res.json().catch(() => null) }
  }

  /**
   * Melakukan polling. Memakai POST (bukan GET) karena polling juga menulis
   * kehadiran pengguna — lihat catatan di server/src/app.js.
   */
  function poll(slug, since, token) {
    return req('POST', `/api/rooms/${slug}/poll`, { token, body: { since } })
  }

  return {
    db, base, masuk, req, poll,
    async tutup() {
      await new Promise(r => server.close(r))
      db.close()
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* terkunci */ }
    },
  }
}

test('poll: pesan dari satu pengguna terbaca pengguna lain', async (t) => {
  const s = await siapkan()
  t.after(() => s.tutup())

  const tokenA = await s.masuk('aldi', 'aldi12345')
  const tokenB = await s.masuk('irene', 'irene12345')

  // A kirim pesan lewat REST.
  const kirim = await s.req('POST', '/api/rooms/umum/messages', { token: tokenA, body: { body: 'Halo lewat REST!' } })
  assert.equal(kirim.status, 201)
  assert.equal(kirim.data.message.username, 'aldi')

  // B melakukan polling; harus melihat pesan itu.
  const p = await s.poll('umum', 0, tokenB)
  assert.equal(p.status, 200)
  assert.equal(p.data.messages.length, 1)
  assert.equal(p.data.messages[0].body, 'Halo lewat REST!')
})

test('poll: hanya pesan BARU yang diambil (sejak id tertentu)', async (t) => {
  const s = await siapkan()
  t.after(() => s.tutup())

  const tokenA = await s.masuk('aldi', 'aldi12345')
  await s.req('POST', '/api/rooms/umum/messages', { token: tokenA, body: { body: 'pertama' } })
  await s.req('POST', '/api/rooms/umum/messages', { token: tokenA, body: { body: 'kedua' } })

  const semua = await s.poll('umum', 0, tokenA)
  assert.equal(semua.data.messages.length, 2)
  const idTerakhir = semua.data.messages[1].id

  // Polling dari id terakhir → tidak ada pesan baru.
  const kosong = await s.poll('umum', idTerakhir, tokenA)
  assert.equal(kosong.data.messages.length, 0)

  // Pesan baru muncul setelah dikirim.
  await s.req('POST', '/api/rooms/umum/messages', { token: tokenA, body: { body: 'ketiga' } })
  const lagi = await s.poll('umum', idTerakhir, tokenA)
  assert.equal(lagi.data.messages.length, 1)
  assert.equal(lagi.data.messages[0].body, 'ketiga')
})

test('poll: daftar online terisi & tidak mencampur ruang', async (t) => {
  const s = await siapkan()
  t.after(() => s.tutup())

  const tokenA = await s.masuk('aldi', 'aldi12345')
  const tokenB = await s.masuk('irene', 'irene12345')

  await s.poll('umum', 0, tokenA)
  const pollB = await s.poll('umum', 0, tokenB)
  assert.deepEqual(pollB.data.online, ['aldi', 'irene'])

  // Irene pindah ke ruang Teknologi → di Umum tinggal aldi.
  await s.poll('teknologi', 0, tokenB)
  const pollLagi = await s.poll('umum', 0, tokenA)
  assert.deepEqual(pollLagi.data.online, ['aldi'])
})

test('poll: indikator "sedang menulis" hanya terlihat oleh orang lain', async (t) => {
  const s = await siapkan()
  t.after(() => s.tutup())

  const tokenA = await s.masuk('aldi', 'aldi12345')
  const tokenB = await s.masuk('irene', 'irene12345')

  await s.req('POST', '/api/rooms/umum/typing', { token: tokenA })

  const pollB = await s.poll('umum', 0, tokenB)
  assert.deepEqual(pollB.data.typing, ['aldi'])

  // Pengirim tidak melihat indikatornya sendiri.
  const pollA = await s.poll('umum', 0, tokenA)
  assert.deepEqual(pollA.data.typing, [])

  // Setelah mengirim pesan, indikator hilang.
  await s.req('POST', '/api/rooms/umum/messages', { token: tokenA, body: { body: 'sudah kirim' } })
  const pollB2 = await s.poll('umum', 0, tokenB)
  assert.deepEqual(pollB2.data.typing, [])
})

test('poll & kirim butuh masuk', async (t) => {
  const s = await siapkan()
  t.after(() => s.tutup())

  const poll = await s.poll('umum', 0, null)
  assert.equal(poll.status, 401)

  const kirim = await s.req('POST', '/api/rooms/umum/messages', { body: { body: 'tanpa token' } })
  assert.equal(kirim.status, 401)
})

test('kirim lewat REST: pesan kosong & terlalu panjang ditolak', async (t) => {
  const s = await siapkan()
  t.after(() => s.tutup())

  const token = await s.masuk('aldi', 'aldi12345')
  const kosong = await s.req('POST', '/api/rooms/umum/messages', { token, body: { body: '   ' } })
  assert.equal(kosong.status, 400)

  const panjang = await s.req('POST', '/api/rooms/umum/messages', { token, body: { body: 'x'.repeat(1001) } })
  assert.equal(panjang.status, 400)
})

test('kirim ke ruang tak dikenal ditolak', async (t) => {
  const s = await siapkan()
  t.after(() => s.tutup())
  const token = await s.masuk('aldi', 'aldi12345')
  const r = await s.req('POST', '/api/rooms/tidak-ada/messages', { token, body: { body: 'halo' } })
  assert.equal(r.status, 404)
})
