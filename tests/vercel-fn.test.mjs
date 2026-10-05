/**
 * Uji fungsi serverless Vercel secara lokal (tanpa Blob).
 *
 * Handler dipanggil lewat server HTTP sungguhan. Yang diuji: penyesuaian
 * alamat (rewrite), mode cadangan (ws:false), dan alur kirim/poll pesan.
 */
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let lulus = 0
let gagal = 0
function cek(nama, ok, detail = '') {
  if (ok) { lulus++; console.log(`✔ ${nama}`) }
  else { gagal++; console.log(`✖ ${nama} ${detail}`) }
}

const dir = mkdtempSync(join(tmpdir(), 'ngobrol-fn-'))
process.env.DB_PATH = join(dir, 'fn.db')
delete process.env.BLOB_STORE_ID
delete process.env.VERCEL

const { default: handler } = await import('../api/index.js')

const server = createServer((req, res) => handler(req, res))
await new Promise(r => server.listen(0, r))
const base = `http://127.0.0.1:${server.address().port}`

async function panggil(method, jalur, { body, token } = {}) {
  const res = await fetch(base + jalur, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const teks = await res.text()
  let data = null
  try { data = teks ? JSON.parse(teks) : null } catch { data = teks }
  return { status: res.status, data }
}

// ── Pemeriksaan ────────────────────────────────────────────────────────────

const h = await panggil('GET', '/api/health')
cek('health melaporkan WebSocket TIDAK tersedia (mode cadangan)', h.status === 200 && h.data?.ws === false, JSON.stringify(h.data))

const ruang = await panggil('GET', '/api/rooms')
cek('daftar ruang terisi', ruang.status === 200 && ruang.data?.rooms?.length === 4)

const masukA = await panggil('POST', '/api/auth/login', { body: { username: 'aldi', password: 'aldi12345' } })
cek('masuk berhasil', masukA.status === 200 && Boolean(masukA.data?.token))

const tanpaToken = await panggil('GET', '/api/rooms/umum/poll?since=0')
cek('poll butuh login (401)', tanpaToken.status === 401)

// Kirim pesan lewat REST, lalu baca lewat poll (inti mode cadangan).
const kirim = await panggil('POST', '/api/rooms/umum/messages', {
  token: masukA.data.token, body: { body: 'Halo dari fungsi serverless!' },
})
cek('kirim pesan lewat REST berhasil', kirim.status === 201 && kirim.data?.message?.body === 'Halo dari fungsi serverless!')

const masukB = await panggil('POST', '/api/auth/login', { body: { username: 'rina', password: 'rina12345' } })
const pollB = await panggil('GET', '/api/rooms/umum/poll?since=0', { token: masukB.data.token })
cek('pengguna lain membaca pesan lewat poll', pollB.status === 200 && pollB.data?.messages?.length === 1)
// Catatan: daftar online TIDAK diuji di sini. Pada fungsi serverless lokal
// (tanpa Blob) tiap permintaan memakai basis data berbeda, jadi kehadiran
// tidak bertahan antar-permintaan. Di Vercel sungguhan, kehadiran bertahan
// karena basis data disimpan di penyimpanan bersama (Blob).
cek('bentuk respons poll lengkap', Array.isArray(pollB.data?.online) && Array.isArray(pollB.data?.typing))

const typing = await panggil('POST', '/api/rooms/umum/typing', { token: masukA.data.token })
cek('tanda "sedang menulis" diterima', typing.status === 200)
const pollMenulis = await panggil('GET', '/api/rooms/umum/poll?since=0', { token: masukB.data.token })
cek('indikator menulis terbaca pengguna lain', pollMenulis.data?.typing?.includes('aldi'))

const takDikenal = await panggil('GET', '/api/tidak-ada')
cek('alamat API tak dikenal -> JSON error', takDikenal.status === 404)

await new Promise(r => server.close(r))
try { rmSync(dir, { recursive: true, force: true }) } catch { /* terkunci */ }

console.log(`\nHASIL: ${lulus} lulus, ${gagal} gagal`)
process.exit(gagal === 0 ? 0 : 1)
