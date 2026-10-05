/**
 * Titik masuk server Ngobrol.
 *
 * Menjalankan SATU server yang melayani:
 *   - REST API (Express)          → /api/...
 *   - WebSocket real-time         → /ws
 *   - Tampilan web (hasil build)  → /  (hanya bila folder dist ada)
 *
 * Karena WebSocket butuh koneksi yang terus terbuka, server ini harus
 * dijalankan di host yang mendukung proses tetap (mis. Render), bukan di
 * fungsi serverless Vercel.
 *
 * Port diatur lewat PORT (default 3080). Lokasi basis data lewat DB_PATH.
 */
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { openDatabase, migrate } from './db.js'
import { seedDatabase } from './seed.js'
import { createApp } from './app.js'
import { pasangWebSocket } from './ws.js'

const PORT = Number(process.env.PORT ?? 3080)
const DB_PATH = process.env.DB_PATH ?? fileURLToPath(new URL('../data/ngobrol.db', import.meta.url))

const db = openDatabase(DB_PATH)
migrate(db)
seedDatabase(db)

const app = createApp(db, { ws: process.env.NGOBROL_TANPA_WS !== '1' })

// Bila hasil build frontend ada (folder dist), sajikan sebagai berkas statis
// dengan fallback ke index.html agar alamat seperti "/" tetap bekerja.
const DIST = fileURLToPath(new URL('../../dist', import.meta.url))
if (existsSync(DIST)) {
  const { default: express } = await import('express')
  app.use(express.static(DIST))
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(DIST, 'index.html')))
  console.log('Tampilan web disajikan dari', DIST)
}

const server = createServer(app)
// NGOBROL_TANPA_WS=1 mematikan WebSocket — dipakai untuk MENGUJI mode cadangan
// secara lokal (meniru host serverless seperti Vercel).
if (process.env.NGOBROL_TANPA_WS === '1') {
  console.log('WebSocket DIMATIKAN (mode cadangan/polling) — untuk pengujian')
} else {
  pasangWebSocket(server, db)
}

server.listen(PORT, () => {
  console.log(`Ngobrol berjalan di http://localhost:${PORT} (REST + WebSocket /ws)`)
})
