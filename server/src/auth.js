/**
 * Autentikasi Ngobrol: hash sandi scrypt+salt, token sesi HMAC sederhana.
 * Nama pengguna dipakai sebagai identitas tampilan (unik, tanpa spasi).
 */
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto'

/** Membuat hash sandi: "salt:hash" (hex). */
export function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

/** Memeriksa sandi terhadap hash tersimpan. */
export function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false
  const [saltHex, hashHex] = stored.split(':')
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(password, salt, expected.length)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

const SECRET = process.env.AUTH_SECRET || 'ngobrol-dev-secret'

/** Membuat token sesi berisi id pengguna & waktu kedaluwarsa. */
export function buatToken(userId, ttlMs = 1000 * 60 * 60 * 24 * 7) {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Date.now() + ttlMs })).toString('base64url')
  const sig = createHmac('sha256', SECRET).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

/** Memeriksa token; mengembalikan id pengguna atau null. */
export function bacaToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null
  const [payload, sig] = token.split('.')
  const harap = createHmac('sha256', SECRET).update(payload).digest('base64url')
  if (harap.length !== sig.length) return null
  if (!timingSafeEqual(Buffer.from(harap), Buffer.from(sig))) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null
    return data.sub
  } catch {
    return null
  }
}

/** Membersihkan nama pengguna: huruf, angka, garis bawah; 3–20 karakter. */
export function bersihkanNama(nama) {
  const bersih = String(nama ?? '').trim().replace(/[^A-Za-z0-9_]/g, '')
  if (bersih.length < 3 || bersih.length > 20) return null
  return bersih
}
