# Sprint 1 — Fondasi dan aturan pengolahan data

Status: **selesai**, 20 Oktober 2026. Cakupan penyerahan adalah S1-01–S1-08 pada rencana sprint.

| Backlog | Hasil implementasi |
| --- | --- |
| S1-01 | React/Vite/TypeScript, Express, konfigurasi environment, SQLite persisten, migrasi, repository Git |
| S1-02 | Kontrak `TransactionDraft`; raw evidence, nominal asli/IDR, waktu, vendor/proyek, referensi refund, import status, dan review |
| S1-03 | Enam master proyek asli dan kurs `160` IDR/credit serta `16250` IDR/USD dimuat dari file |
| S1-04 | Parser sumber terpisah dan konversi desimal presisi, termasuk refund dan nominal manual campuran |
| S1-05 | UTC Vendor A/B/C ke WIB; Excel dan tanggal teks Indonesia; tanggal/minggu menggunakan WIB |
| S1-06 | Kode/nama/14 alias eksplisit, status unknown/missing/ambiguous, CLI review dan retry |
| S1-07 | Keputusan deduplikasi/refund/minggu/alert dan batasan tercatat di README |
| S1-08 | Tes normalisasi, pemetaan, persistensi, rollback, dan siklus review tersedia |

## Bukti yang diperiksa

- `npm run check`: **184 tes lulus** pada lima file tes, TypeScript strict, build Vite, dan kompilasi backend berhasil.
- `TZ=America/Los_Angeles npm test -- src/domain/time.test.ts`: hasil waktu tidak bergantung zona host.
- `npm run db:init` lalu `npm run db:status` pada proses berbeda: enam master dan kurs tetap tersedia di disk.
- `npm run review:list` dan `npm run review:retry`: berjalan dengan sukses pada database awal kosong.
- `GET /api/health`: HTTP 200, status `ok`.
- `GET /api/status` melalui proxy Vite: HTTP 200, 6 proyek, 0 transaksi, 0 review, import biaya belum diaktifkan.
- `GET /api/projects` melalui proxy Vite: HTTP 200, enam proyek.
- Chrome: halaman menampilkan enam nama/kode proyek dengan budget sesuai master dan keterangan bahwa pengeluaran belum tersedia.
- Konfigurasi secrets kosong; file input mentah, runtime database, dependency, dan build tidak masuk Git.

Unit/integration test menggunakan database sementara dan membersihkannya setelah selesai. Database kerja tidak diisi transaksi buatan untuk membuat tampilan terlihat lengkap.

## Temuan dari data asli

- Header `timestamp_utc` Vendor A dan `time_utc` Vendor B mengonfirmasi zona sumber UTC. Ini menggantikan asumsi yang belum jelas dalam requirement ringkas.
- Spreadsheet memakai tanggal Excel serta format teks seperti `1/9/2026`, `14 Sep 2026`, dan `Okt`, dengan nominal teks/numerik campuran.
- Inspeksi pemetaan CSV menemukan 158 baris Vendor A: 153 cocok dan 5 perlu tinjauan; 86 baris Vendor B: 83 cocok dan 3 perlu tinjauan. Ini hitungan inspeksi sebelum deduplikasi, **bukan hasil importer lengkap**.
- Label kosong, `misc`, `test`, `new client pitch`, dan `sandbox` tidak dipetakan secara spekulatif. Jumlah tersebut belum mencakup peninjauan XLSX/API lengkap.

## Batas pekerjaan dan penerusan

Sprint 2 masih perlu membangun adapter empat sumber, mengabaikan baris nontransaksi XLSX, memanggil API Vendor C dengan pagination/retry, mengatur status import, dan menangani deduplikasi invoice/ref lintas sumber. Primitive replay ID sumber pada Sprint 1 belum membuktikan semua kriteria deduplikasi dataset penuh.

Sprint 3 membangun pengeluaran/budget, rincian vendor, dan tren mingguan. Sprint 4 mengirim webhook. Tidak ada request webhook yang dikirim pada Sprint 1.

Record belum terpetakan tetap merupakan kekurangan terhadap target FR-04 sampai benar-benar diselesaikan. Pemetaan akan diproses melalui mekanisme review yang sudah tersedia, dengan koreksi label kosong atau konflik isi sumber memerlukan alur koreksi eksplisit pada sprint berikutnya.
