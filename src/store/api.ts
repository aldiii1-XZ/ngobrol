/**
 * Klien REST Ngobrol (akun, ruang, riwayat). Pengiriman pesan real-time
 * ditangani lewat WebSocket (lihat store.tsx).
 */
export interface User { id: number; username: string }
export interface Room { id: number; slug: string; name: string; description: string; messageCount: number }
export interface ChatMessage { id: number; username: string; body: string; createdAt: string }

const KUNCI_TOKEN = 'ngobrol_token'

export function ambilToken(): string | null {
  return localStorage.getItem(KUNCI_TOKEN)
}
export function simpanToken(token: string | null) {
  if (token) localStorage.setItem(KUNCI_TOKEN, token)
  else localStorage.removeItem(KUNCI_TOKEN)
}

export class GalatApi extends Error {
  status: number
  constructor(pesan: string, status: number) { super(pesan); this.status = status }
}

async function panggil<T>(metode: string, jalur: string, body?: unknown): Promise<T> {
  const token = ambilToken()
  const res = await fetch(jalur, {
    method: metode,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const teks = await res.text()
  let data: unknown = null
  try { data = teks ? JSON.parse(teks) : null } catch { data = teks }
  if (!res.ok) {
    const pesan = (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
      ? (data as { error: string }).error
      : null) ?? `Permintaan gagal (${res.status})`
    throw new GalatApi(pesan, res.status)
  }
  return data as T
}

export const api = {
  masuk: (body: { username: string; password: string }) =>
    panggil<{ token: string; user: User }>('POST', '/api/auth/login', body),
  daftar: (body: { username: string; password: string }) =>
    panggil<{ token: string; user: User }>('POST', '/api/auth/register', body),
  saya: () => panggil<{ user: User }>('GET', '/api/auth/me'),
  /** Memeriksa apakah host mendukung WebSocket (dari /api/health). */
  info: () => panggil<{ ok: boolean; ws: boolean }>('GET', '/api/health'),
  ruang: () => panggil<{ rooms: Room[] }>('GET', '/api/rooms'),
  riwayat: (slug: string, limit = 50) =>
    panggil<{ room: { id: number; slug: string; name: string }; messages: ChatMessage[] }>(
      'GET', `/api/rooms/${slug}/messages?limit=${limit}`,
    ),

  // Mode cadangan (polling) — dipakai bila WebSocket tidak tersedia.
  poll: (slug: string, since: number) =>
    panggil<{ messages: ChatMessage[]; online: string[]; typing: string[] }>(
      'GET', `/api/rooms/${slug}/poll?since=${since}`,
    ),
  kirimLewatRest: (slug: string, body: string) =>
    panggil<{ message: ChatMessage }>('POST', `/api/rooms/${slug}/messages`, { body }),
  kabariMenulisRest: (slug: string) =>
    panggil<{ ok: boolean }>('POST', `/api/rooms/${slug}/typing`, {}),
}

/**
 * Alamat WebSocket, mengikuti asal halaman (ws:// atau wss://).
 * (Mode dipilih dari /api/health; WebSocket hanya dibuka bila host mendukung.)
 */
export function alamatWs(token: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/ws?token=${encodeURIComponent(token)}`
}
