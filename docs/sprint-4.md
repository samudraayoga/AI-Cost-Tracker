# Sprint 4 — Notifikasi budget melalui webhook

Status: **selesai**, 20 Oktober 2026. Cakupan penyerahan adalah S4-01–S4-05 pada rencana sprint.

## Hasil implementasi

| Backlog | Hasil |
| --- | --- |
| S4-01 | Evaluasi menggunakan ringkasan proyek yang sama dengan dashboard dan hanya berjalan setelah empat import terbaru sukses |
| S4-02 | `POST` JSON ke `WEBHOOK_URL` dengan timeout serta payload proyek, biaya, budget, dan persentase |
| S4-03 | Tabel `budget_alert_attempts` menyimpan snapshot payload, waktu, status, HTTP status, dan error |
| S4-04 | Indeks sukses unik per proyek/kebijakan mencegah pengiriman ulang; kegagalan tetap dapat dicoba lagi |
| S4-05 | T-12–T-14, mock lokal, log NDJSON, dan validasi end-to-end terhadap database asli |

## Kebijakan alert

- Kebijakan bernama `budget-over-80-v1` dengan ambang `80`.
- Proyek memenuhi syarat hanya jika `pengeluaran × 100 > budget × 80`. Perbandingan memakai desimal presisi, bukan persentase tampilan yang sudah dibulatkan.
- Tepat 80% tidak memicu. Nilai sedikit di atas 80% tetap memicu walaupun label dua desimal dapat terlihat sebagai `80`.
- Evaluasi otomatis hanya dilakukan setelah run lengkap keempat sumber sukses. Run parsial, gagal, atau import satu sumber tidak memicu alert.
- Satu respons HTTP 2xx menutup alert proyek untuk kebijakan ini. Import atau evaluasi ulang menghasilkan `already_sent` tanpa request baru.
- HTTP non-2xx, gangguan jaringan, dan timeout dicatat sebagai gagal. Menjalankan `npm run alerts:send` kembali membuat percobaan baru.
- Refund memakai total bersih dashboard. Riwayat sukses tidak dihapus bila refund kemudian menurunkan pengeluaran.
- URL webhook hanya dibaca dari environment dan tidak disimpan dalam tabel/log aplikasi.

## Payload

```json
{
  "event": "budget.threshold_exceeded",
  "policy": "budget-over-80-v1",
  "thresholdPercent": "80",
  "project": {
    "code": "GBX-01",
    "name": "Greenbox Garden Benchmark",
    "client": "Greenbox Garden"
  },
  "spendIdr": "18971522.5",
  "budgetIdr": "17000000",
  "usagePercent": "111.6",
  "currency": "IDR",
  "pendingReviewRecords": 13,
  "evaluatedAt": "<ISO-8601>"
}
```

Nilai uang dan persentase dikirim sebagai string desimal agar konsumen tidak dipaksa memakai floating point.

## Bukti end-to-end fixture asli

Mock lokal dijalankan melalui `npm run webhook:mock`, lalu pengiriman dilakukan dengan `WEBHOOK_URL=http://127.0.0.1:4020/webhook npm run alerts:send`.

| Proyek | Pemakaian | Respons | Riwayat |
| --- | ---: | ---: | --- |
| GBX-01 | 111,60% | HTTP 204 | succeeded |
| INT-00 | 91,51% | HTTP 204 | succeeded |
| KMD-02 | 85,99% | HTTP 204 | succeeded |

Mock mencatat tepat tiga baris di `data/runtime/webhook-received.ndjson`. Pengiriman kedua menghasilkan `already_sent` untuk ketiga proyek dan tidak menambah request. `npm run alerts:status` menunjukkan tiga sukses, nol gagal, dan nol sedang dikirim. File bukti runtime sengaja diabaikan Git karena payload produksi dapat berisi data operasional.

## Bukti otomatis

- `npm run check`: 206 tes pada 10 file lulus; TypeScript strict dan build frontend/backend berhasil.
- T-12: biaya di bawah dan tepat 80% tidak memenuhi syarat; nilai presisi sedikit di atas 80% memenuhi syarat.
- T-13: pengiriman sukses pertama diterima; evaluasi kedua tidak memanggil webhook lagi.
- T-14: HTTP 503 disimpan sebagai gagal; percobaan berikutnya HTTP 202 disimpan sebagai sukses.
- Import terbaru berstatus `partial` memblokir pengiriman dan tidak membuat riwayat percobaan palsu.
- Validasi konfigurasi menolak URL selain HTTP/HTTPS, kredensial pada userinfo URL, dan timeout nonpositif.

## Batas sprint

Kebijakan versi pertama menganggap budget tetap dan menyimpan satu sukses per proyek. Jika budget dapat berubah, versi kebijakan atau identitas alert perlu menyertakan versi budget. Pengiriman diproses berurutan dan target concurrency tinggi tidak termasuk kebutuhan take-home. Tiga belas record asli yang belum terpetakan tetap di luar total; jumlahnya dikirim pada payload agar penerima memahami bahwa angka belum final.
