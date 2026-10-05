/** Tes fungsi format & penggabungan pesan (murni, tanpa jaringan). */
import { describe, it, expect } from 'vitest'
import { jam, tanggal, bedaHari, inisial, warnaAvatar, singkat, gabungPesan } from '../src/store/format'

describe('inisial', () => {
  it('mengambil 2 huruf dari nama', () => {
    expect(inisial('aldi')).toBe('AL')
    expect(inisial('rina putri')).toBe('RP')
  })
  it('aman untuk nama kosong', () => {
    expect(inisial('')).toBe('?')
  })
})

describe('warnaAvatar', () => {
  it('konsisten untuk nama yang sama', () => {
    expect(warnaAvatar('aldi')).toBe(warnaAvatar('aldi'))
  })
  it('memberi warna yang berbeda untuk nama berbeda', () => {
    const warna = new Set(['aldi', 'rina', 'budi', 'citra'].map(warnaAvatar))
    expect(warna.size).toBeGreaterThan(1)
  })
})

describe('singkat', () => {
  it('memotong teks panjang dengan elipsis', () => {
    expect(singkat('a'.repeat(100), 10)).toHaveLength(10)
    expect(singkat('a'.repeat(100), 10).endsWith('…')).toBe(true)
  })
  it('membiarkan teks pendek', () => {
    expect(singkat('halo', 10)).toBe('halo')
  })
})

describe('jam & tanggal', () => {
  it('mengembalikan string kosong untuk nilai kosong', () => {
    expect(jam('')).toBe('')
    expect(tanggal('')).toBe('')
  })
  it('mengubah format SQLite', () => {
    expect(tanggal('2025-09-15 07:30:00')).toContain('2025')
    expect(jam('2025-09-15 07:30:00')).toMatch(/\d{2}[:.]\d{2}/)
  })
  it('menerima format ISO', () => {
    expect(tanggal('2025-09-15T07:30:00Z')).toContain('2025')
  })
})

describe('bedaHari', () => {
  it('mendeteksi hari berbeda', () => {
    expect(bedaHari('2025-09-15 07:00:00', '2025-09-16 07:00:00')).toBe(true)
  })
  it('hari sama mengembalikan false', () => {
    // 07:00 & 10:00 UTC = 14:00 & 17:00 Waktu Indonesia — hari yang sama.
    expect(bedaHari('2025-09-15 07:00:00', '2025-09-15 10:00:00')).toBe(false)
  })
})

describe('gabungPesan', () => {
  const a = { id: 1, body: 'a' }
  const b = { id: 2, body: 'b' }
  const c = { id: 3, body: 'c' }

  it('menambahkan pesan baru', () => {
    expect(gabungPesan([a], [b])).toEqual([a, b])
  })
  it('membuang duplikat (pesan yang sama dari gema server)', () => {
    expect(gabungPesan([a, b], [b])).toEqual([a, b])
    expect(gabungPesan([a, b], [a, b, c])).toEqual([a, b, c])
  })
  it('menjaga urutan berdasarkan id', () => {
    expect(gabungPesan([a, c], [b])).toEqual([a, b, c])
  })
  it('mengembalikan daftar lama bila tak ada tambahan', () => {
    const lama = [a, b]
    expect(gabungPesan(lama, [])).toBe(lama)
  })
})
