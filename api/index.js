/**
 * Titik masuk serverless Vercel untuk Ngobrol (MODE CADANGAN).
 *
 * WebSocket TIDAK didukung di Vercel, jadi di sini aplikasi memakai mode
 * cadangan (polling ~1,5 detik). Handler ini melayani REST API + halaman.
 *
 * MASALAH YANG DISELESAIKAN: Vercel menjalankan beberapa instance terpisah
 * dengan /tmp masing-masing, sehingga pesan yang dikirim di satu instance tidak
 * terlihat di instance lain. Solusinya: basis data SQLite disimpan di Vercel
 * Blob (penyimpanan bersama), dan setiap permintaan yang mengubah data
 * dijalankan satu per satu memakai kunci tulis.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { del, get, put } from '@vercel/blob'

import { createApp } from '../server/src/app.js'
import { openDatabase, migrate } from '../server/src/db.js'
import { seedDatabase } from '../server/src/seed.js'

const BLOB_PATH = 'db/ngobrol.db'
const BLOB_LOCK = 'db/ngobrol-lock'
const BATAS_SIMPAN = 9000
const KUNCI_BASI = 15000

function blobAktif() {
  return Boolean(process.env.BLOB_STORE_ID) && Boolean(process.env.VERCEL)
}

const tidur = ms => new Promise(r => setTimeout(r, ms))

async function unduhSnapshot() {
  try {
    const hasil = await get(BLOB_PATH, { access: 'private', useCache: false })
    if (!hasil || hasil.statusCode !== 200 || !hasil.stream) return null
    return Buffer.from(await new Response(hasil.stream).arrayBuffer())
  } catch (err) {
    console.error('[blob] gagal mengunduh basis data:', err?.message)
    return null
  }
}

async function unggahSnapshot(berkas) {
  await put(BLOB_PATH, fs.readFileSync(berkas), {
    access: 'private',
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: 'application/octet-stream',
  })
}

/** Kunci tulis bersama: hanya satu permintaan mengubah data pada satu waktu. */
const kunci = {
  async ambil() {
    try {
      await put(BLOB_LOCK, String(Date.now()), {
        access: 'private', allowOverwrite: false, addRandomSuffix: false, contentType: 'text/plain',
      })
      return true
    } catch {
      try {
        const isi = await get(BLOB_LOCK, { access: 'private', useCache: false })
        if (isi?.statusCode === 200 && isi.stream) {
          const umur = Date.now() - Number((await new Response(isi.stream).text()) || 0)
          if (umur > KUNCI_BASI) {
            await put(BLOB_LOCK, String(Date.now()), {
              access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'text/plain',
            })
            return true
          }
        }
      } catch { /* coba lagi */ }
      return false
    }
  },
  async lepas() {
    try { await del(BLOB_LOCK) } catch { /* sudah hilang */ }
  },
}

async function ambilKunciDenganSabar(batasMs = 20000) {
  const mulai = Date.now()
  while (Date.now() - mulai < batasMs) {
    if (await kunci.ambil()) return true
    await tidur(250)
  }
  return false
}

// ── Mode lokal (tes tanpa Vercel) ───────────────────────────────────────────
let appLokal = null
function appTanpaBlob() {
  if (appLokal) return appLokal
  const db = openDatabase(process.env.DB_PATH || '/tmp/ngobrol.db')
  migrate(db)
  seedDatabase(db)
  // ws: false → klien memakai mode cadangan (Vercel tidak mendukung WebSocket).
  appLokal = createApp(db, { ws: false })
  return appLokal
}

// ── Mode penyimpanan bersama ────────────────────────────────────────────────

function bersihkan(db, berkas) {
  try { db.close() } catch { /* sudah tertutup */ }
  try { fs.unlinkSync(berkas) } catch { /* sudah terhapus */ }
}

/** Membuat aplikasi dari salinan basis data terbaru. */
function appDariSnapshot(snapshot, berkas) {
  if (snapshot) fs.writeFileSync(berkas, snapshot)
  const db = openDatabase(berkas)
  migrate(db)
  seedDatabase(db)
  return { db, app: createApp(db, { ws: false }) }
}

async function tanganiBaca(req, res) {
  const berkas = path.join(os.tmpdir(), `ngobrol-${randomUUID()}.db`)
  const { db, app } = appDariSnapshot(await unduhSnapshot(), berkas)
  res.on('finish', () => bersihkan(db, berkas))
  return app(req, res)
}

async function tanganiUbah(req, res) {
  const dapat = await ambilKunciDenganSabar()
  if (!dapat) return res.status(503).json({ error: 'Server sedang sibuk. Coba lagi sebentar.' })

  const berkas = path.join(os.tmpdir(), `ngobrol-${randomUUID()}.db`)
  const { db, app } = appDariSnapshot(await unduhSnapshot(), berkas)

  const akhirAsli = res.end.bind(res)
  let sudahDitahan = false
  res.end = (...args) => {
    if (sudahDitahan) return akhirAsli(...args)
    sudahDitahan = true
    ;(async () => {
      try {
        await Promise.race([
          unggahSnapshot(berkas),
          new Promise((_, tolak) => setTimeout(() => tolak(new Error('menyimpan kelamaan')), BATAS_SIMPAN)),
        ])
      } catch (err) {
        console.error('[blob] gagal menyimpan basis data:', err?.message)
      } finally {
        bersihkan(db, berkas)
        await kunci.lepas()
      }
      akhirAsli(...args)
    })()
    return res
  }

  return app(req, res)
}

export default function handler(req, res) {
  const asli = req.url || '/'
  if (!asli.startsWith('/api')) req.url = '/api' + (asli.startsWith('/') ? asli : '/' + asli)

  if (!blobAktif()) return appTanpaBlob()(req, res)

  const mengubah = req.method !== 'GET' && req.method !== 'HEAD'
  return mengubah ? tanganiUbah(req, res) : tanganiBaca(req, res)
}
