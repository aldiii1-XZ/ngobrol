/**
 * Titik masuk server Ngobrol.
 *
 * Menjalankan satu server HTTP yang melayani:
 *   - REST API (Express)  → /api/...
 *   - WebSocket real-time → /ws
 *
 * Port diatur lewat PORT (default 3080).
 */
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

import { openDatabase, migrate } from './db.js'
import { seedDatabase } from './seed.js'
import { createApp } from './app.js'
import { pasangWebSocket } from './ws.js'

const PORT = Number(process.env.PORT ?? 3080)
const DB_PATH = process.env.DB_PATH ?? fileURLToPath(new URL('../data/ngobrol.db', import.meta.url))

const db = openDatabase(DB_PATH)
migrate(db)
seedDatabase(db)

const app = createApp(db)
const server = createServer(app)
pasangWebSocket(server, db)

server.listen(PORT, () => {
  console.log(`Ngobrol berjalan di http://localhost:${PORT} (REST + WebSocket /ws)`)
})
