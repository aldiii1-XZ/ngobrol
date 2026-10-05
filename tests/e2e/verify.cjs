/**
 * Uji real-time Ngobrol dengan DUA browser sungguhan.
 *
 * Membuktikan inti proyek: pesan yang diketik di satu browser muncul di
 * browser lain TANPA refresh, plus indikator "sedang menulis" dan daftar online.
 */
const { chromium } = require('playwright')

const URL = process.env.NGOBROL_URL || 'http://localhost:5260/'
const hasil = []
const gagal = []

function cek(nama, ok, detail = '') {
  if (ok) { hasil.push(nama); console.log(`✔ ${nama}${detail ? ' — ' + detail : ''}`) }
  else { gagal.push(nama); console.log(`✖ ${nama} ${detail}`) }
}

/** Masuk ke aplikasi dengan akun tertentu. */
async function masuk(page, nama, sandi) {
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('input[placeholder="mis. aldi"]', { timeout: 20000 })
  await page.fill('input[placeholder="mis. aldi"]', nama)
  await page.fill('input[type="password"]', sandi)
  await page.click('button[type="submit"]')
  await page.waitForSelector('textarea[aria-label="Tulis pesan"]', { timeout: 20000 })
  // Tunggu status tersambung.
  await page.waitForSelector('text=Tersambung', { timeout: 20000 })
}

;(async () => {
  const browser = await chromium.launch()
  const ctxA = await browser.newContext({ viewport: { width: 1200, height: 800 } })
  const ctxB = await browser.newContext({ viewport: { width: 1200, height: 800 } })
  const a = await ctxA.newPage()
  const b = await ctxB.newPage()
  const galatKonsol = []
  a.on('console', m => { if (m.type() === 'error') galatKonsol.push('A: ' + m.text()) })
  b.on('console', m => { if (m.type() === 'error') galatKonsol.push('B: ' + m.text()) })

  try {
    // ── 1. Dua pengguna masuk di browser terpisah ──────────────────────────
    await masuk(a, 'aldi', 'aldi12345')
    cek('Browser A masuk sebagai aldi', true)

    await masuk(b, 'rina', 'rina12345')
    cek('Browser B masuk sebagai rina', true)

    // ── 2. Daftar ruang tampil ─────────────────────────────────────────────
    const jumlahRuang = await a.locator('.ruang-tombol').count()
    cek('Daftar ruang tampil', jumlahRuang === 4, `${jumlahRuang} ruang`)

    // ── 3. Saling melihat di daftar online ─────────────────────────────────
    await a.waitForSelector('text=2 online', { timeout: 15000 }).catch(() => {})
    const onlineA = await a.textContent('body')
    cek('A melihat 2 orang online', onlineA.includes('2 online'))
    const onlineB = await b.textContent('body')
    cek('B melihat 2 orang online', onlineB.includes('2 online'))

    // ── 4. INTI: pesan dari A muncul di B tanpa refresh ────────────────────
    // Teks unik tiap run agar tidak bentrok dengan riwayat uji sebelumnya.
    const cap = Date.now()
    const teksUji = `Halo Rina, ini uji real-time ${cap}!`
    await a.fill('textarea[aria-label="Tulis pesan"]', teksUji)
    await a.click('button:has-text("Kirim")')

    await b.waitForSelector(`text=${teksUji}`, { timeout: 20000 })
    cek('Pesan dari A muncul di B TANPA refresh (real-time)', true)

    // A juga melihat pesannya sendiri (satu sumber kebenaran, tanpa duplikat).
    await a.waitForSelector(`text=${teksUji}`, { timeout: 20000 }).catch(() => {})
    await a.waitForTimeout(400)
    const pesanA = await a.locator('.pesan-teks').filter({ hasText: teksUji }).count()
    cek('Pesan tampil tepat sekali di A (tidak duplikat)', pesanA === 1, `${pesanA} kali`)

    // ── 5. Balasan dari B muncul di A ──────────────────────────────────────
    const balasan = `Halo Aldi, diterima ${cap}!`
    await b.fill('textarea[aria-label="Tulis pesan"]', balasan)
    await b.click('button:has-text("Kirim")')
    await a.waitForSelector(`text=${balasan}`, { timeout: 20000 })
    cek('Balasan dari B muncul di A (dua arah)', true)

    // ── 6. Indikator "sedang menulis" ──────────────────────────────────────
    // B mulai mengetik (tanpa mengirim).
    await b.fill('textarea[aria-label="Tulis pesan"]', 'sedang mengetik')
    await a.waitForSelector('text=sedang menulis', { timeout: 15000 })
    const teksMenulis = await a.textContent('.menulis-baris')
    cek('Indikator "rina sedang menulis" muncul di A', teksMenulis.includes('rina'))

    // Setelah B mengirim, indikator hilang (mode cadangan perlu waktu poll).
    await b.click('button:has-text("Kirim")')
    await a.waitForTimeout(3500)
    const menulisSetelah = await a.textContent('.menulis-baris')
    cek('Indikator menulis hilang setelah pesan terkirim', !menulisSetelah.includes('rina'))

    // ── 7. Berganti ruang: pesan tidak bocor antar ruang ───────────────────
    await a.click('.ruang-tombol:has-text("Teknologi")')
    await a.waitForTimeout(1500)
    const isiTeknologi = await a.textContent('.obrolan-isi')
    cek('Pesan ruang Umum tidak muncul di ruang Teknologi', !isiTeknologi.includes(teksUji))

    await a.fill('textarea[aria-label="Tulis pesan"]', 'Pesan khusus teknologi')
    await a.click('button:has-text("Kirim")')
    await a.waitForTimeout(1200)
    const isiTeknologi2 = await a.textContent('.obrolan-isi')
    cek('Pesan baru muncul di ruang Teknologi', isiTeknologi2.includes('Pesan khusus teknologi'))

    // ── 8. Riwayat bertahan setelah muat ulang ─────────────────────────────
    await a.reload({ waitUntil: 'networkidle' })
    await a.waitForSelector('textarea[aria-label="Tulis pesan"]', { timeout: 20000 })
    await a.waitForTimeout(1500)
    const setelahMuat = await a.textContent('.obrolan-isi')
    cek('Riwayat ruang tetap ada setelah muat ulang', setelahMuat.includes('Pesan khusus teknologi'))

    // ── 9. Kembali ke Umum, riwayat Umum tetap ada ─────────────────────────
    await a.click('.ruang-tombol:has-text("Umum")')
    await a.waitForTimeout(1500)
    const kembaliUmum = await a.textContent('.obrolan-isi')
    cek('Riwayat ruang Umum tetap ada', kembaliUmum.includes(teksUji))

    cek('Tidak ada error konsol', galatKonsol.length === 0, galatKonsol.slice(0, 2).join(' | '))
  } catch (err) {
    console.log('\n!! E2E berhenti karena galat:', err.message)
    gagal.push('galat: ' + err.message)
  } finally {
    await browser.close()
  }

  console.log('\n' + '='.repeat(60))
  console.log(`HASIL: ${hasil.length}/${hasil.length + gagal.length} pemeriksaan lulus`)
  console.log('Error konsol:', galatKonsol.length ? galatKonsol.slice(0, 3) : 'tidak ada')
  if (gagal.length) console.log('Gagal:', gagal)
  console.log('='.repeat(60))
  process.exit(gagal.length === 0 ? 0 : 1)
})()
