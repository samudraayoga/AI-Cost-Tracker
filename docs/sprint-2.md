# Sprint 2 — Import seluruh sumber, deduplikasi, dan refund

Status: **selesai**, 20 Oktober 2026. Cakupan penyerahan adalah S2-01–S2-08 pada rencana sprint.

## Hasil implementasi

| Backlog | Hasil |
| --- | --- |
| S2-01 | Importer CSV Vendor A/B dengan header ketat, ID stabil, normalisasi, dan empat duplikat `line_id` Vendor B |
| S2-02 | Importer XLSX yang menemukan header serta mengabaikan judul, baris kosong, dan `TOTAL` |
| S2-03 | Client HTTP Vendor C Bearer auth dan pagination 1–100 record per halaman |
| S2-04 | Timeout, `Retry-After` 429, backoff 5xx/jaringan, batas retry, pesan 400/401/final failure |
| S2-05 | Replay ID, invoice manual, `Ref` Vendor A, dan pencocokan unik proyek/tanggal WIB/nominal |
| S2-06 | Enam refund negatif tersimpan dengan referensi transaksi asal dan hanya dihitung sekali |
| S2-07 | `npm run import`, laporan per sumber, `import_runs`, `db:status`, daftar review, dan reimport per sumber |
| S2-08 | Tes T-05–T-10 dan validasi terhadap seluruh fixture asli |

## Validasi fixture asli

Import pertama melalui HTTP mock Vendor C:

| Sumber | Dibaca | Diterima | Duplikat | Perlu review |
| --- | ---: | ---: | ---: | ---: |
| Vendor A | 158 | 153 | 0 | 5 |
| Vendor B | 86 | 79 | 4 | 3 |
| Vendor C | 103 | 99 | 0 | 4 |
| Manual | 40 | 20 | 19 | 1 |
| **Total** | **387** | **351** | **23 kejadian saat import** | **13** |

Empat duplikat Vendor B memakai ID dan isi yang sama, sehingga tiap pasang berbagi satu raw record. Sembilan belas record manual disimpan terpisah dan ditautkan ke transaksi kanonis:

- 9 melalui `Ref` Vendor A;
- 8 melalui kecocokan unik proyek, tanggal WIB, dan nominal Vendor A;
- 2 melalui nomor invoice manual yang sama.

Database hasil validasi berisi 351 transaksi efektif, 383 raw record, 19 relasi deduplikasi eksplisit, dan 13 record review. Total efektif presisi adalah **Rp159.994.487,50**. Nilai setengah Rupiah dipertahankan dari perkalian USD dan baru boleh dibulatkan pada tampilan.

Import kedua menghasilkan 0 transaksi baru. Seluruh 351 transaksi efektif, total presisi, 383 raw record, 19 relasi deduplikasi, dan 13 review tetap sama.

Semua enam refund Vendor A mempunyai nominal negatif dan `refund_of_source_id` yang ditemukan pada transaksi Vendor A kanonis.

## Record yang belum terpetakan

| Sumber | Jumlah | Label |
| --- | ---: | --- |
| Vendor A | 5 | 2 kosong, `test`, `misc`, `new client pitch` |
| Vendor B | 3 | 2 `misc`, 1 `sandbox` |
| Vendor C | 4 | `sandbox` |
| Manual | 1 | proyek kosong |

Label tersebut tidak dipetakan secara spekulatif. Karena masih ada 13 record review, target FR-04 “setiap record terhubung ke proyek” belum sepenuhnya selesai walaupun mekanisme koreksi dan reimport tersedia. Dampak record ini tidak dimasukkan ke total efektif di atas.

## Bukti otomatis

- `npm run check`: 196 tes pada 8 file lulus; TypeScript strict dan build frontend/backend berhasil.
- T-05: import fixture gabungan dua kali mempertahankan jumlah dan total.
- T-06: `line_id`, invoice beda format, dan `Ref` lintas sumber dihitung sekali.
- T-07: transaksi berbeda dengan nominal sama tetap tersimpan.
- T-08: refund negatif dan reimport refund mengurangi satu kali.
- T-09: mock 103 record diambil dalam dua halaman sebelum importer menerima hasil.
- T-10: 429 menghormati `Retry-After`; 5xx memakai retry terbatas; 401 berhenti dengan pesan kredensial.
- `npm audit --omit=dev`: 0 vulnerability yang dikenal pada dependency produksi.

## Batas sprint

Sprint 2 belum menghitung agregasi proyek/vendor/minggu dan belum mengirim webhook. Halaman web hanya menampilkan master serta status jumlah transaksi/review. Angka dashboard mulai dibangun pada Sprint 3.

Mock Vendor C tetap dijalankan dari paket tugas. Importer hanya memanggil `GET /v1/usage`; kode aplikasi tidak membaca `vendor-c-mock/data.json`.
