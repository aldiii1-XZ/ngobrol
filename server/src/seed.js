/**
 * Data awal Ngobrol: beberapa ruang obrolan + akun contoh.
 */
import { hashPassword } from './auth.js'

/** Ruang obrolan bawaan. */
export const RUANG_AWAL = [
  { slug: 'umum', name: 'Umum', description: 'Obrolan bebas untuk semua orang.' },
  { slug: 'teknologi', name: 'Teknologi', description: 'Seputar coding, gadget, dan AI.' },
  { slug: 'kampus', name: 'Kampus', description: 'Info tugas, jadwal, dan kegiatan kampus.' },
  { slug: 'ngobrol-santai', name: 'Ngobrol Santai', description: 'Cerita ringan & hiburan.' },
]

/** Mengisi ruang & akun contoh bila basis data masih kosong. */
export function seedDatabase(db) {
  const jumlahRuang = db.prepare('SELECT COUNT(*) AS n FROM rooms').get().n
  if (jumlahRuang === 0) {
    const ins = db.prepare('INSERT INTO rooms (slug, name, description) VALUES (?, ?, ?)')
    for (const r of RUANG_AWAL) ins.run(r.slug, r.name, r.description)
  }

  const jumlahUser = db.prepare('SELECT COUNT(*) AS n FROM users').get().n
  if (jumlahUser === 0) {
    const ins = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    ins.run('aldi', hashPassword('aldi12345'))
    ins.run('irene', hashPassword('irene12345'))
  }
}
