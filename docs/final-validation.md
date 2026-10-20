# Validasi akhir dan audit requirement

Validasi dilakukan pada 20 Oktober 2026 setelah Sprint 1–5. Semua proses validasi memakai kode repository saat ini dan fixture asli. Database end-to-end dibuat baru di direktori sementara sehingga hasil tidak bergantung pada database kerja sebelumnya.

## Lingkungan dan setup bersih

| Item | Hasil |
| --- | --- |
| Node.js | v26.7.0; target proyek Node.js 24 LTS |
| npm | 11.19.0 |
| Instalasi | `npm ci` berhasil dari `package-lock.json` |
| Dependency audit | 0 vulnerability |
| Migrasi | Versi 1–3 diterapkan pada database kosong |
| Master | 6 proyek; kurs 160 IDR/credit dan 16.250 IDR/USD |
| Build | React/Vite dan TypeScript backend berhasil |

Urutan yang divalidasi:

1. Buat database sementara kosong dan jalankan `npm run db:init` terhadap `data/input`.
2. Jalankan mock Vendor C dengan kegagalan acak dimatikan agar hasil rekonsiliasi deterministik.
3. Jalankan mock webhook dengan log NDJSON sementara.
4. Import Vendor A, Vendor B, Vendor C melalui HTTP, dan spreadsheet manual.
5. Baca status dari proses baru, buka build produksi, dan periksa `GET /api/dashboard`.
6. Jalankan import yang sama untuk kedua kalinya.
7. Periksa kembali transaksi, total, relasi deduplikasi, review, riwayat alert, dan jumlah request webhook.
8. Jalankan seluruh tes, build, audit dependency, scan secret, serta pemeriksaan repository.

## Hasil import dan reimport

Import pertama:

| Sumber | Dibaca | Diterima | Duplikat | Review |
| --- | ---: | ---: | ---: | ---: |
| Vendor A | 158 | 153 | 0 | 5 |
| Vendor B | 86 | 79 | 4 | 3 |
| Vendor C | 103 | 99 | 0 | 4 |
| Manual | 40 | 20 | 19 | 1 |

Import kedua menerima **0 transaksi baru**. Vendor A, B, C, dan manual masing-masing melaporkan 153, 83, 99, dan 39 duplikat/replay serta jumlah review yang sama. Snapshot persisten setelah proses selesai:

| Metrik | Setelah import pertama | Setelah import kedua |
| --- | ---: | ---: |
| Transaksi efektif | 351 | 351 |
| Total efektif | Rp159.994.487,50 | Rp159.994.487,50 |
| Raw record | 383 | 383 |
| Relasi deduplikasi eksplisit | 19 | 19 |
| Record review | 13 | 13 |
| Alert sukses | 3 | 3 |
| Request yang diterima mock webhook | 3 | 3 |

Vendor C diambil dalam dua request HTTP: halaman pertama 100 record dan halaman kedua 3 record. Build produksi pada database bersih mengembalikan enam proyek, tujuh vendor, enam minggu WIB, total budget Rp237.750.000, pemakaian 67,30%, dan sisa Rp77.755.512,50.

Mock webhook menerima HTTP request untuk GBX-01 (111,60%), INT-00 (91,51%), dan KMD-02 (85,99%). Semua percobaan mendapat HTTP 204. Import kedua melaporkan `already_sent` untuk ketiga proyek dan tidak menambah baris log.

## Record yang belum terpetakan

Tidak ada referensi, ID lintas sumber, atau konteks baris yang membuktikan proyek untuk 13 record berikut. Label `test`, `sandbox`, `misc`, dan pitch baru tidak otomatis berarti Internal R&D. Memasukkannya ke INT-00 akan menjadi asumsi bisnis yang tidak terdapat pada fixture.

| Sumber | Record | Label | Nilai IDR ternormalisasi |
| --- | --- | --- | ---: |
| Vendor A | TXN101021 | kosong | Rp105.760 |
| Vendor A | TXN101027 | `misc` | Rp63.200 |
| Vendor A | TXN101022 | `test` | Rp132.960 |
| Vendor A | TXN101032 | `new client pitch` | Rp11.360 |
| Vendor A | TXN101034 | kosong | Rp39.840 |
| Vendor B | INV2609-4402 | `misc` | Rp1.408.062,50 |
| Vendor B | INV2609-4403 | `misc` | Rp1.034.475 |
| Vendor B | INV2609-4405 | `sandbox` | Rp1.080.300 |
| Vendor C | vc_30304 | `sandbox` | Rp214.500 |
| Vendor C | vc_30299 | `sandbox` | Rp617.012,50 |
| Vendor C | vc_30294 | `sandbox` | Rp44.037,50 |
| Vendor C | vc_30307 | `sandbox` | Rp634.725 |
| Manual | baris 22 / INV-950 | kosong | Rp450.000 |
| **Total** | **13 record** |  | **Rp5.836.232,50** |

Total tersebut adalah nilai mentah ternormalisasi yang tertahan. Ini bukan penyesuaian yang aman terhadap total proyek karena status billable, kemungkinan data uji, dan proyek tujuannya belum dikonfirmasi. Jika seluruhnya dinyatakan valid dan bukan duplikat, total gabungan maksimum menjadi Rp165.830.720; keputusan itu belum didukung data.

## Audit requirement fungsional

| Requirement | Status | Bukti / batas |
| --- | --- | --- |
| FR-01 Import dan penyimpanan | Terpenuhi | Empat sumber masuk SQLite persisten; status per sumber tersedia |
| FR-02 API Vendor C | Terpenuhi | HTTP Bearer, pagination 103 record, 429/5xx retry, error 400/401 |
| FR-03 Normalisasi | Terpenuhi | Credits/USD/sen/IDR dan seluruh format waktu dinormalisasi; refund negatif |
| FR-04 Pemetaan proyek | **Belum penuh** | 351 transaksi valid terhubung; 13 record senilai Rp5.836.232,50 menunggu keputusan bisnis |
| FR-05 Duplikasi dan refund | Terpenuhi | Reimport mempertahankan 351 transaksi dan total; 19 relasi lintas sumber; 6 refund tertaut |
| FR-06 Dashboard proyek | Terpenuhi dengan kondisi data terlihat | Semua proyek, budget, biaya, sisa, persentase, nol transaksi, dan overbudget didukung |
| FR-07 Vendor dan tren mingguan | Terpenuhi dengan kondisi data terlihat | Total vendor/minggu sama dengan transaksi efektif; WIB dan refund konsisten |
| FR-08 Webhook budget | Terpenuhi | Tiga request diterima; riwayat sukses, retry gagal, dan idempotensi dibuktikan |

FR-06–FR-08 berfungsi terhadap transaksi efektif. Banner dashboard dan payload webhook membawa kondisi review agar angka tersebut tidak disalahartikan sebagai total final seluruh raw input.

## Audit nonfungsional dan deliverables

| Item | Status | Bukti |
| --- | --- | --- |
| NFR-01 Secrets | Terpenuhi | `.env`, input, database, dan log runtime diabaikan Git; scan working tree dan seluruh commit terjangkau tidak menemukan pola secret |
| NFR-02 Tes kritis | Terpenuhi | 206 tes pada 10 file meliputi T-01–T-14 |
| NFR-03 Dokumentasi | Terpenuhi | README, rencana sprint, dan laporan Sprint 1–5 |
| NFR-04 Dashboard nonteknis | Terpenuhi | Format Rupiah/WIB, status budget, kondisi kosong, dan banner kualitas data |
| NFR-05 Penelusuran | Terpenuhi | Raw payload, source ID/baris, kurs, dedup link, refund, import run, dan alert attempt |
| NFR-06 Kegagalan/retry | Terpenuhi | Partial import, review, API retry, webhook failure, dan rerun idempotent |
| Repository | Terpenuhi | URL GitHub memberi HTTP 200 tanpa login; enam commit sebelum perubahan Sprint 5 |
| Build dan kode | Terpenuhi | Importer, dashboard, webhook, mock, tes, dan dokumentasi tersedia |

## Pemeriksaan otomatis akhir

```text
npm run check
Test Files  10 passed (10)
Tests       206 passed (206)
TypeScript  passed
Vite build  passed
Server build passed

npm audit
found 0 vulnerabilities
```

Tes waktu juga dijalankan dengan `TZ=America/Los_Angeles` untuk memastikan hasil UTC/WIB tidak bergantung pada zona host.

## Pekerjaan lanjutan

Prioritas pertama adalah memperoleh keputusan pemilik data untuk 13 record review, lalu menambah alias/koreksi sumber dan menjalankan retry. Setelah itu dashboard dan kelayakan alert perlu direkonsiliasi ulang. Pengembangan berikutnya dapat menambahkan UI koreksi dengan audit trail, autentikasi, scheduler import, filter dashboard, deployment, serta versi budget pada identitas alert.
