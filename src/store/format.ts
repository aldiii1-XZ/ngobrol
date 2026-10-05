/** Pemformat waktu & teks (fungsi murni, mudah diuji). */

/** Jam:menit dari ISO, mis. "14:05". */
export function jam(iso: string): string {
  if (!iso) return ''
  const teks = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z'
  const d = new Date(teks)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })
}

/** Tanggal lengkap Indonesia, mis. "15 Sep 2025". */
export function tanggal(iso: string): string {
  if (!iso) return ''
  const teks = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z'
  const d = new Date(teks)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' })
}

/** Apakah dua waktu berada di hari yang berbeda (untuk pemisah tanggal). */
export function bedaHari(a: string, b: string): boolean {
  return tanggal(a) !== tanggal(b)
}

/** Mengambil inisial nama (maks 2 huruf). */
export function inisial(nama: string): string {
  const bersih = String(nama ?? '').trim()
  if (!bersih) return '?'
  const bagian = bersih.split(/[\s_]+/).filter(Boolean)
  if (bagian.length >= 2) return (bagian[0][0] + bagian[1][0]).toUpperCase()
  return bersih.slice(0, 2).toUpperCase()
}

/** Warna avatar tetap berdasarkan nama (agar tiap orang konsisten). */
export function warnaAvatar(nama: string): string {
  const palet = ['#6d8bff', '#34d399', '#fbbf24', '#f472b6', '#22d3ee', '#a78bfa', '#fb923c']
  let jumlah = 0
  for (const huruf of String(nama ?? '')) jumlah = (jumlah + huruf.charCodeAt(0)) % palet.length
  return palet[jumlah]
}

/** Menyingkat teks panjang untuk pratinjau. */
export function singkat(teks: string, maks = 60): string {
  const t = String(teks ?? '').replace(/\s+/g, ' ').trim()
  return t.length > maks ? t.slice(0, maks - 1) + '…' : t
}

/**
 * Menggabungkan pesan baru ke daftar lama tanpa duplikat.
 * Berguna karena pengirim juga menerima gemanya sendiri dari server.
 */
export function gabungPesan<T extends { id: number }>(lama: T[], baru: T[]): T[] {
  const ada = new Set(lama.map(m => m.id))
  const tambahan = baru.filter(m => !ada.has(m.id))
  if (tambahan.length === 0) return lama
  return [...lama, ...tambahan].sort((a, b) => a.id - b.id)
}
