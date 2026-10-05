/**
 * Tes hub obrolan (logika murni, tanpa jaringan).
 *
 * Memakai "koneksi palsu" yang hanya mencatat pesan yang diterimanya, sehingga
 * kehadiran, penyiaran pesan, dan indikator "sedang menulis" bisa diuji cepat
 * dan deterministik.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { openDatabase, migrate } from '../src/db.js'
import { seedDatabase } from '../src/seed.js'
import { buatHub } from '../src/hub.js'

/** Membuat koneksi palsu yang mencatat semua pesan yang diterima. */
function koneksiPalsu(userId, username) {
  return {
    userId,
    username,
    roomSlug: null,
    diterima: [],
    kirim(objek) { this.diterima.push(objek) },
    /** Pesan terakhir bertipe tertentu. */
    terakhir(tipe) { return [...this.diterima].reverse().find(p => p.tipe === tipe) },
    semua(tipe) { return this.diterima.filter(p => p.tipe === tipe) },
    bersihkan() { this.diterima = [] },
  }
}

function siapkan() {
  const db = openDatabase(':memory:')
  migrate(db)
  seedDatabase(db)
  const hub = buatHub(db)
  return { db, hub }
}

test('peserta yang bergabung menerima riwayat & daftar online', () => {
  const { hub } = siapkan()
  const a = koneksiPalsu(1, 'aldi')
  hub.gabung(a, 'umum')

  assert.equal(a.terakhir('riwayat')?.room, 'umum')
  assert.deepEqual(a.terakhir('riwayat')?.pesan, [])
  assert.deepEqual(a.terakhir('online')?.users, ['aldi'])
  assert.equal(a.roomSlug, 'umum')
  assert.equal(hub.jumlahPeserta('umum'), 1)
})

test('pesan tersiarkan ke SEMUA peserta ruang, termasuk pengirim', () => {
  const { hub } = siapkan()
  const a = koneksiPalsu(1, 'aldi')
  const b = koneksiPalsu(2, 'rina')
  hub.gabung(a, 'umum')
  hub.gabung(b, 'umum')
  a.bersihkan()
  b.bersihkan()

  const hasil = hub.kirimPesan(a, 'Halo semua!')
  assert.ok(hasil.pesan)
  assert.equal(hasil.pesan.username, 'aldi')
  assert.equal(hasil.pesan.body, 'Halo semua!')

  // Pesan disiarkan ke semua — termasuk pengirim — agar klien punya satu
  // sumber kebenaran (tidak perlu menambah pesan sendiri & menghindari duplikat).
  assert.equal(a.semua('pesan').length, 1)
  assert.equal(b.semua('pesan').length, 1)
  assert.equal(a.semua('pesan')[0].pesan.id, b.semua('pesan')[0].pesan.id)
  assert.equal(b.semua('pesan')[0].pesan.body, 'Halo semua!')
})

test('pesan kosong atau terlalu panjang ditolak', () => {
  const { hub } = siapkan()
  const a = koneksiPalsu(1, 'aldi')
  hub.gabung(a, 'umum')

  assert.ok(hub.kirimPesan(a, '   ').galat)
  assert.ok(hub.kirimPesan(a, 'x'.repeat(1001)).galat)
  assert.equal(hub.kirimPesan(a, 'x'.repeat(1000)).pesan.body.length, 1000)
})

test('pesan sebelum masuk ruang ditolak', () => {
  const { hub } = siapkan()
  const a = koneksiPalsu(1, 'aldi')
  assert.ok(hub.kirimPesan(a, 'halo').galat)
})

test('riwayat bertahan & urut lama ke baru', () => {
  const { hub } = siapkan()
  const a = koneksiPalsu(1, 'aldi')
  hub.gabung(a, 'umum')
  hub.kirimPesan(a, 'pertama')
  hub.kirimPesan(a, 'kedua')
  hub.kirimPesan(a, 'ketiga')

  const riwayat = hub.riwayat('umum')
  assert.deepEqual(riwayat.map(m => m.body), ['pertama', 'kedua', 'ketiga'])

  // Peserta baru tetap melihat riwayatnya.
  const b = koneksiPalsu(2, 'rina')
  hub.gabung(b, 'umum')
  assert.equal(b.terakhir('riwayat').pesan.length, 3)
})

test('daftar online menampilkan nama unik yang terurut', () => {
  const { hub } = siapkan()
  const a = koneksiPalsu(1, 'aldi')
  const b = koneksiPalsu(2, 'rina')
  const c = koneksiPalsu(3, 'budi')
  hub.gabung(a, 'umum')
  hub.gabung(b, 'umum')
  hub.gabung(c, 'umum')

  assert.deepEqual(a.terakhir('online').users, ['aldi', 'budi', 'rina'])
})

test('peserta keluar: daftar online & pemberitahuan diperbarui', () => {
  const { hub } = siapkan()
  const a = koneksiPalsu(1, 'aldi')
  const b = koneksiPalsu(2, 'rina')
  hub.gabung(a, 'umum')
  hub.gabung(b, 'umum')
  b.bersihkan()

  hub.keluarRuangan(a)
  assert.equal(hub.jumlahPeserta('umum'), 1)
  assert.equal(b.terakhir('keluar')?.username, 'aldi')
  assert.deepEqual(b.terakhir('online')?.users, ['rina'])
})

test('indikator "sedang menulis" hanya ke peserta lain', () => {
  const { hub } = siapkan()
  const a = koneksiPalsu(1, 'aldi')
  const b = koneksiPalsu(2, 'rina')
  hub.gabung(a, 'umum')
  hub.gabung(b, 'umum')
  a.bersihkan(); b.bersihkan()

  hub.sedangMenulis(a, true)
  assert.equal(a.semua('menulis').length, 0)   // pengirim tidak melihat indikatornya sendiri
  assert.equal(b.semua('menulis').length, 1)
  assert.equal(b.semua('menulis')[0].username, 'aldi')

  hub.sedangMenulis(a, false)
  assert.equal(b.semua('berhenti_menulis').length, 1)
})

test('mengirim pesan otomatis menghentikan indikator menulis', () => {
  const { hub } = siapkan()
  const a = koneksiPalsu(1, 'aldi')
  const b = koneksiPalsu(2, 'rina')
  hub.gabung(a, 'umum')
  hub.gabung(b, 'umum')
  b.bersihkan()

  hub.sedangMenulis(a, true)
  hub.kirimPesan(a, 'sudah selesai menulis')
  // Pesan diterima, dan status menulis berakhir (tanpa siaran berhenti_menulis ganda).
  assert.equal(b.semua('pesan').length, 1)
})

test('berpindah ruang: keluar dari ruang lama, masuk ruang baru', () => {
  const { hub } = siapkan()
  const a = koneksiPalsu(1, 'aldi')
  hub.gabung(a, 'umum')
  hub.gabung(a, 'teknologi')

  assert.equal(hub.jumlahPeserta('umum'), 0)
  assert.equal(hub.jumlahPeserta('teknologi'), 1)
  assert.equal(a.roomSlug, 'teknologi')
})

test('pesan di ruang terpisah tidak saling bocor', () => {
  const { hub } = siapkan()
  const a = koneksiPalsu(1, 'aldi')
  const b = koneksiPalsu(2, 'rina')
  hub.gabung(a, 'umum')
  hub.gabung(b, 'teknologi')
  b.bersihkan()

  hub.kirimPesan(a, 'hanya untuk umum')
  assert.equal(b.semua('pesan').length, 0)
  assert.equal(hub.riwayat('umum').length, 1)
  assert.equal(hub.riwayat('teknologi').length, 0)
})

test('riwayat dibatasi jumlahnya & mengambil yang terbaru', () => {
  const { hub } = siapkan()
  const a = koneksiPalsu(1, 'aldi')
  hub.gabung(a, 'umum')
  for (let i = 1; i <= 60; i++) hub.kirimPesan(a, `pesan-${i}`)

  const riwayat = hub.riwayat('umum', 10)
  assert.equal(riwayat.length, 10)
  assert.equal(riwayat[0].body, 'pesan-51')
  assert.equal(riwayat[9].body, 'pesan-60')
})
