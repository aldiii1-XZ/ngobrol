/**
 * Menghapus basis data di penyimpanan bersama Vercel Blob.
 * Dipakai setelah pengujian agar aplikasi mulai dengan data bersih.
 *
 * Jalankan: node --env-file=.env.local scripts/reset-blob-db.mjs
 */
import { del } from '@vercel/blob'

try {
  await del('db/ngobrol.db')
  console.log('Basis data di penyimpanan bersama dihapus — akan dibuat ulang bersih.')
} catch (err) {
  console.log('Tidak ada yang dihapus:', err?.message)
}
