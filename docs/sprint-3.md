# Sprint 3 — Agregasi dan dashboard operasional

Status: **selesai**, 20 Oktober 2026. Cakupan penyerahan adalah S3-01–S3-06 pada rencana sprint.

## Hasil implementasi

| Backlog | Hasil |
| --- | --- |
| S3-01 | Agregasi pengeluaran bersih, budget, sisa budget, dan persentase per proyek dengan aritmetika desimal |
| S3-02 | Agregasi vendor dan minggu Senin–Minggu menurut tanggal WIB, termasuk biaya manual dan refund |
| S3-03 | Enam proyek master selalu tampil; pemakaian di atas 100% dan proyek tanpa transaksi didukung |
| S3-04 | Dashboard responsif dengan ringkasan, kartu proyek, distribusi vendor, serta grafik batang mingguan |
| S3-05 | Kondisi kosong, status import terakhir, jumlah review, sisa budget, dan penanda di atas 80%/overbudget |
| S3-06 | T-11 memeriksa konsistensi tiga dimensi total, perpindahan minggu WIB, refund, data kosong, dan overbudget |

## Kontrak perhitungan

`GET /api/dashboard` membaca setiap transaksi efektif satu kali. Jumlah per proyek, vendor, minggu, dan total keseluruhan diturunkan dari kumpulan yang sama. Nominal SQLite disimpan sebagai teks desimal dan dijumlahkan menggunakan `decimal.js` dengan presisi 100 digit; konversi ke `number` hanya dipakai untuk ukuran visual batang.

Persentase proyek dihitung sebagai `pengeluaran bersih ÷ budget × 100` dan dibulatkan dua angka desimal pada kontrak API. Nilai Rupiah dibulatkan maksimal dua angka desimal hanya saat ditampilkan. Batang progres berhenti pada lebar visual 100%, tetapi label tetap menunjukkan persentase sebenarnya bila overbudget.

Minggu dimulai Senin 00.00 WIB dan berakhir sebelum Senin berikutnya. Refund masuk ke vendor, proyek, dan minggu tanggal refund sebagai nilai negatif. Biaya manual yang valid ikut dalam agregasi berdasarkan nama vendor pada spreadsheet.

Kelengkapan import ditentukan dari run terbaru untuk masing-masing sumber. Semua sumber harus berstatus `succeeded`; status `failed`, `partial`, `running`, atau belum pernah dijalankan ditampilkan sebagai belum lengkap. Record `needs_review` dilaporkan terpisah dan tidak masuk transaksi efektif.

## Rekonsiliasi fixture asli

| Bagian | Hasil |
| --- | ---: |
| Transaksi efektif | 351 |
| Total pengeluaran | Rp159.994.487,50 |
| Total budget | Rp237.750.000 |
| Pemakaian keseluruhan | 67,30% |
| Sisa budget | Rp77.755.512,50 |
| Vendor | 7 |
| Minggu WIB | 6 |
| Record perlu review | 13 |

Jumlah pengeluaran enam proyek, tujuh vendor, dan enam minggu masing-masing tepat **Rp159.994.487,50**. Rincian proyek:

| Proyek | Pengeluaran | Budget | Pemakaian |
| --- | ---: | ---: | ---: |
| BRK-05 | Rp15.125.510 | Rp48.750.000 | 31,03% |
| GBX-01 | Rp18.971.522,50 | Rp17.000.000 | 111,60% |
| GLW-03 | Rp24.928.220 | Rp32.500.000 | 76,70% |
| INT-00 | Rp17.158.777,50 | Rp18.750.000 | 91,51% |
| KMD-02 | Rp48.151.612,50 | Rp56.000.000 | 85,99% |
| SNJ-04 | Rp35.658.845 | Rp64.750.000 | 55,07% |

GBX-01 terlihat sebagai overbudget. INT-00 dan KMD-02 mendapat penanda di atas 80%; penanda tersebut masih bersifat informasi dashboard dan belum mengirim webhook sampai Sprint 4.

## Kondisi yang diverifikasi

- `npm run check`: 199 tes pada 9 file lulus; TypeScript strict dan build frontend/backend berhasil.
- Database kosong tetap menampilkan semua proyek dengan biaya dan persentase nol.
- Import yang belum pernah dijalankan menyebut keempat sumber belum lengkap.
- Run terbaru yang gagal menggantikan status sukses lama untuk indikator kelengkapan.
- Transaksi Minggu malam UTC yang berubah menjadi Senin WIB masuk minggu baru.
- Refund mengurangi proyek, vendor, minggu refund, dan total keseluruhan satu kali.
- Biaya manual tampil pada rincian vendor.
- Persentase 107,14% pada fixture tes tidak dipotong menjadi 100% dalam label/API.
- Tampilan desktop diperiksa dengan database asli; label, status review, Rupiah pecahan, enam proyek, tujuh vendor, dan enam minggu terlihat.

## Batas sprint

Dashboard tidak memiliki filter proyek/periode karena tidak diwajibkan brief. Tiga belas record asli yang belum terpetakan tetap di luar total dan dinyatakan pada banner. Sprint 4 masih perlu mengevaluasi ambang memakai agregasi yang sama serta mengirim, mencatat, dan mencoba ulang webhook.
