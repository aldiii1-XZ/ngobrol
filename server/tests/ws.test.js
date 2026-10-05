/**
 * Tes WebSocket sungguhan: menyambung dua klien nyata ke server, lalu
 * memastikan pesan sampai seketika dan indikator "menulis" bekerja.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

import { openDatabase, migrate } from '../src/db.js'
import { seedDatabase } from '../src/seed.js'
import { createApp } from '../src/app.js'
import { pasangWebSocket } from '../src/ws.js'
import { buatToken } from '../src/auth.js'

/** Menyalakan server lengkap (REST + WS) di port acak. */
async function siapkan() {
  const dir = mkdtempSync(join(tmpdir(), 'ngobrol-'))
  const db = openDatabase(join(dir, 'uji.db'))
  migrate(db)
  seedDatabase(db)

  const app = createApp(db)
  const server = createServer(app)
  pasangWebSocket(server, db)
  await new Promise(r => server.listen(0, r))
  const port = server.address().port
  const base = `http://127.0.0.1:${port}`
  const wsBase = `ws://127.0.0.1:${port}`

  const aldiId = db.prepare('SELECT id FROM users WHERE username = ?').get('aldi').id
  const ireneId = db.prepare('SELECT id FROM users WHERE username = ?').get('irene').id

  return {
    db, base, wsBase, aldiId, ireneId,
    async tutup() {
      await new Promise(r => server.close(r))
      db.close()
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* terkunci */ }
    },
  }
}

/** Membungkus WebSocket menjadi pembantu yang mudah dipakai di tes. */
function klien(wsUrl, token) {
  const ws = new WebSocket(`${wsUrl}/ws?token=${token}`)
  const masuk = []
  const tunggu = []

  ws.on('message', (data) => {
    const pesan = JSON.parse(data.toString())
    masuk.push(pesan)
    // Bangunkan penunggu yang cocok.
    for (let i = tunggu.length - 1; i >= 0; i--) {
      if (tunggu[i].predikat(pesan)) {
        tunggu[i].selesaikan(pesan)
        tunggu.splice(i, 1)
      }
    }
  })

  return {
    ws,
    masuk,
    /** Menunggu pesan yang cocok dengan predikat (atau yang sudah ada). */
    tungguPesan(predikat, batasMs = 4000) {
      const ada = masuk.find(predikat)
      if (ada) return Promise.resolve(ada)
      return new Promise((selesaikan, tolak) => {
        const timer = setTimeout(() => tolak(new Error('timeout menunggu pesan')), batasMs)
        tunggu.push({ predikat, selesaikan: (p) => { clearTimeout(timer); selesaikan(p) } })
      })
    },
    siap: () => new Promise((r, j) => { ws.on('open', r); ws.on('error', j) }),
    kirim: (objek) => ws.send(JSON.stringify(objek)),
    tutup: () => ws.close(),
  }
}

test('WebSocket: pesan sampai seketika ke klien lain', async (t) => {
  const s = await siapkan()
  t.after(() => s.tutup())

  const tokenA = buatToken(s.aldiId)
  const tokenB = buatToken(s.ireneId)
  const a = klien(s.wsBase, tokenA)
  const b = klien(s.wsBase, tokenB)
  await Promise.all([a.siap(), b.siap()])

  // Keduanya menerima identitas saat tersambung.
  assert.equal((await a.tungguPesan(p => p.tipe === 'siap')).username, 'aldi')
  assert.equal((await b.tungguPesan(p => p.tipe === 'siap')).username, 'irene')

  a.kirim({ tipe: 'gabung', room: 'umum' })
  b.kirim({ tipe: 'gabung', room: 'umum' })
  await a.tungguPesan(p => p.tipe === 'online' && p.users.includes('aldi'))
  await b.tungguPesan(p => p.tipe === 'online' && p.users.includes('irene'))

  // A mengirim pesan; B harus menerimanya tanpa diminta.
  a.kirim({ tipe: 'pesan', body: 'Halo dari tes!' })
  const diterima = await b.tungguPesan(p => p.tipe === 'pesan')
  assert.equal(diterima.pesan.body, 'Halo dari tes!')
  assert.equal(diterima.pesan.username, 'aldi')

  a.tutup(); b.tutup()
})

test('WebSocket: indikator menulis sampai ke peserta lain saja', async (t) => {
  const s = await siapkan()
  t.after(() => s.tutup())

  const a = klien(s.wsBase, buatToken(s.aldiId))
  const b = klien(s.wsBase, buatToken(s.ireneId))
  await Promise.all([a.siap(), b.siap()])
  a.kirim({ tipe: 'gabung', room: 'umum' })
  b.kirim({ tipe: 'gabung', room: 'umum' })
  await a.tungguPesan(p => p.tipe === 'online' && p.users.length === 2)

  a.kirim({ tipe: 'menulis' })
  const indikator = await b.tungguPesan(p => p.tipe === 'menulis')
  assert.equal(indikator.username, 'aldi')

  // Pengirim tidak menerima indikatornya sendiri.
  assert.equal(a.masuk.filter(p => p.tipe === 'menulis').length, 0)

  a.kirim({ tipe: 'berhenti_menulis' })
  assert.ok(await b.tungguPesan(p => p.tipe === 'berhenti_menulis'))

  a.tutup(); b.tutup()
})

test('WebSocket: tanpa token ditolak', async (t) => {
  const s = await siapkan()
  t.after(() => s.tutup())

  const ws = new WebSocket(`${s.wsBase}/ws`)
  const hasil = await new Promise(r => {
    ws.on('open', () => r('terbuka'))
    ws.on('error', () => r('ditolak'))
    ws.on('close', () => r('ditolak'))
  })
  assert.equal(hasil, 'ditolak')
})

test('WebSocket: token palsu ditolak', async (t) => {
  const s = await siapkan()
  t.after(() => s.tutup())

  const ws = new WebSocket(`${s.wsBase}/ws?token=palsu.palsu`)
  const hasil = await new Promise(r => {
    ws.on('open', () => r('terbuka'))
    ws.on('error', () => r('ditolak'))
    ws.on('close', () => r('ditolak'))
  })
  assert.equal(hasil, 'ditolak')
})

test('REST: ruang & riwayat bisa dibaca', async (t) => {
  const s = await siapkan()
  t.after(() => s.tutup())

  const rooms = await (await fetch(`${s.base}/api/rooms`)).json()
  assert.equal(rooms.rooms.length, 4)
  assert.ok(rooms.rooms.some(r => r.slug === 'umum'))

  const kosong = await (await fetch(`${s.base}/api/rooms/umum/messages`)).json()
  assert.deepEqual(kosong.messages, [])

  const takAda = await fetch(`${s.base}/api/rooms/tidak-ada/messages`)
  assert.equal(takAda.status, 404)
})

test('REST: daftar & masuk akun', async (t) => {
  const s = await siapkan()
  t.after(() => s.tutup())

  const masuk = await fetch(`${s.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'aldi', password: 'aldi12345' }),
  })
  assert.equal(masuk.status, 200)
  const data = await masuk.json()
  assert.ok(data.token)
  assert.equal(data.user.username, 'aldi')

  const salah = await fetch(`${s.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'aldi', password: 'salah' }),
  })
  assert.equal(salah.status, 401)

  const daftar = await fetch(`${s.base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'budi_baru', password: 'rahasia123' }),
  })
  assert.equal(daftar.status, 201)

  // Nama yang sudah dipakai ditolak.
  const ulang = await fetch(`${s.base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'aldi', password: 'rahasia123' }),
  })
  assert.equal(ulang.status, 409)

  // Nama dengan karakter aneh ditolak.
  const aneh = await fetch(`${s.base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'ab', password: 'rahasia123' }),
  })
  assert.equal(aneh.status, 400)
})
