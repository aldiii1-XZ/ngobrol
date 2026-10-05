/**
 * Sambungan WebSocket untuk Ngobrol.
 *
 * Setiap koneksi mewakili satu peserta. Saat tersambung, peserta belum masuk
 * ruang mana pun; ia memilih ruang dengan mengirim {"tipe":"gabung","room":slug}.
 * Semua aturan obrolan ditangani oleh hub (hub.js) — berkas ini hanya
 * menerjemahkan pesan jaringan menjadi pemanggilan hub, dan sebaliknya.
 */
import { WebSocketServer } from 'ws'

import { bacaToken } from './auth.js'
import { buatHub } from './hub.js'

/**
 * Memasang WebSocket ke server HTTP.
 * @param {import('node:http').Server} server
 * @param {import('better-sqlite3').Database} db
 */
export function pasangWebSocket(server, db) {
  const wss = new WebSocketServer({ noServer: true })
  const hub = buatHub(db)

  // Hanya terima upgrade ke jalur /ws, dan hanya dengan token yang sah.
  server.on('upgrade', (req, socket, head) => {
    let url
    try {
      url = new URL(req.url, 'http://localhost')
    } catch {
      socket.destroy()
      return
    }
    if (url.pathname !== '/ws') {
      socket.destroy()
      return
    }
    const token = url.searchParams.get('token') ?? ''
    const userId = bacaToken(token)
    if (!userId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId)
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    wss.handleUpgrade(req, socket, head, ws => {
      ws.userId = user.id
      ws.username = user.username
      wss.emit('connection', ws, req)
    })
  })

  wss.on('connection', ws => {
    /** Objek peserta yang dipakai hub. */
    const koneksi = {
      userId: ws.userId,
      username: ws.username,
      roomSlug: null,
      /** Mengirim objek JSON ke peserta. */
      kirim(objek) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(objek))
      },
    }

    // Beri tahu identitas yang tersambung.
    koneksi.kirim({ tipe: 'siap', username: koneksi.username })

    ws.on('message', (data) => {
      let pesan
      try {
        pesan = JSON.parse(data.toString())
      } catch {
        return koneksi.kirim({ tipe: 'galat', pesan: 'Format pesan tidak dikenal.' })
      }

      switch (pesan?.tipe) {
        case 'gabung': {
          const slug = String(pesan.room ?? '')
          const ada = db.prepare('SELECT slug FROM rooms WHERE slug = ?').get(slug)
          if (!ada) return koneksi.kirim({ tipe: 'galat', pesan: 'Ruang tidak ditemukan.' })
          hub.gabung(koneksi, slug)
          break
        }
        case 'pesan': {
          const hasil = hub.kirimPesan(koneksi, pesan.body)
          if (hasil.galat) koneksi.kirim({ tipe: 'galat', pesan: hasil.galat })
          break
        }
        case 'menulis':
          hub.sedangMenulis(koneksi, true)
          break
        case 'berhenti_menulis':
          hub.sedangMenulis(koneksi, false)
          break
        case 'keluar':
          hub.keluarRuangan(koneksi)
          break
        default:
          koneksi.kirim({ tipe: 'galat', pesan: 'Perintah tidak dikenal.' })
      }
    })

    ws.on('close', () => hub.keluarRuangan(koneksi))
    ws.on('error', () => hub.keluarRuangan(koneksi))
  })

  return { wss, hub }
}
