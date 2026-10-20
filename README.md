# AI Production Cost Tracker

Aplikasi internal untuk menyatukan biaya produksi, memantau budget proyek, dan mengirim peringatan budget. **Implementasi saat ini menyelesaikan Sprint 2:** fondasi data, import empat sumber, deduplikasi, refund, dan daftar record yang perlu ditinjau. Ringkasan pengeluaran/dashboard dan webhook dikerjakan pada sprint berikutnya.

## Menjalankan aplikasi dan import

Gunakan **Node.js 24 LTS** (`.nvmrc`) dan npm. Lingkungan pengerjaan juga telah menjalankan tes dengan Node.js 26.7. Database menggunakan `node:sqlite` bawaan Node, sehingga tidak memerlukan server database atau kompilasi driver SQLite tambahan. API ini masih berstatus experimental pada Node 24; peringatan Node terkait status tersebut bukan kegagalan inisialisasi.

```bash
npm ci
cp .env.example .env
npm run db:init -- --data-dir data/master
npm run dev
```

Buka **http://127.0.0.1:5173**. API berjalan di **http://127.0.0.1:3001**. `data/master` berisi enam master proyek dan kurs asli dari paket tugas; halaman awal menampilkan master proyek, budget, jumlah transaksi efektif, dan jumlah record yang perlu ditinjau. Ringkasan biaya per proyek/vendor/minggu belum dibangun.

Untuk memakai semua file dari paket tugas, salin isi folder `AI_Cost_Tracker_Take_Home/data/` ke `data/input/`, lalu jalankan:

```bash
npm run db:init
npm run db:status
```

Pada workspace pengerjaan, salinan data asli sudah tersedia di `data/input`. Folder tersebut diabaikan Git; file asli di Downloads tidak diubah. Perintah `db:init` hanya memuat `projects.csv` dan `rates.json`. Direktori input bisa diganti lewat `DATA_DIR` atau `--data-dir`. Dataset mentah dan database lokal tidak ikut commit.

Jalankan mock Vendor C dari paket tugas pada terminal terpisah:

```bash
cd AI_Cost_Tracker_Take_Home/vendor-c-mock
VC_FAIL_RATE=0 node server.js
```

Untuk menguji retry 429/5xx sebagaimana perilaku default fixture, hilangkan `VC_FAIL_RATE=0`. Isi API key yang diberikan dokumentasi mock hanya pada environment lokal, lalu import seluruh sumber:

```bash
VENDOR_C_API_KEY=<api-key-dari-docs-mock> npm run import
npm run db:status
npm run review:list
```

Importer memproses urutan Vendor A → Vendor B → Vendor C → manual agar `Ref` manual dapat dicocokkan ke Vendor A. Menjalankan perintah yang sama kembali aman: transaksi efektif dan total tidak bertambah. Untuk mengulang satu sumber setelah koreksi alias atau kegagalan:

```bash
VENDOR_C_API_KEY=<api-key> npm run import -- --source vendor_c
npm run import -- --source manual
```

Nilai `status: complete` pada laporan berarti seluruh sumber yang dipilih selesai dibaca; record `review` tetap merupakan pengecualian yang harus diselesaikan. Bila salah satu sumber gagal, hasil keseluruhan `incomplete`, exit code nonzero, dan sumber lain tetap dilaporkan terpisah.

Build produksi lokal:

```bash
npm run build
npm start
```

Buka http://127.0.0.1:3001 untuk halaman hasil build dan API dari satu server. Jalankan perintah dari root repository. Hentikan server dengan Ctrl+C.

## Perintah dan konfigurasi

| Perintah | Fungsi |
| --- | --- |
| `npm run dev` | React/Vite dan API Express dengan restart otomatis |
| `npm run db:init` | Migrasi database, validasi, lalu muat master proyek dan kurs secara atomik |
| `npm run db:status` | Baca master, kurs, jumlah transaksi, dan record yang perlu ditinjau |
| `npm run import` | Import empat sumber dan cetak hitungan read/accepted/duplicate/review per sumber |
| `npm run review:list` | Lihat record yang tertahan beserta sumber, nilai asli, dan alasan |
| `npm run review:retry` | Proses ulang pemetaan nonmanual yang tertahan memakai alias terbaru |
| `npm test` | Tes domain dan integrasi SQLite |
| `npm run typecheck` | Pemeriksaan TypeScript strict |
| `npm run check` | Seluruh tes, typecheck, dan build frontend/backend |

| Environment | Default / penggunaan |
| --- | --- |
| `PORT` | `3001`; proxy Vite mengikuti port ini |
| `HOST` | `127.0.0.1`; pengembangan dan review lokal |
| `DATABASE_PATH` | `data/runtime/cost-tracker.sqlite` |
| `DATA_DIR` | `data/input` |
| `PROJECT_ALIASES_PATH` | `config/project-aliases.json` |
| `VENDOR_C_BASE_URL` | `http://127.0.0.1:4010`; origin mock/API Vendor C |
| `VENDOR_C_API_KEY` | Kosong dalam contoh; wajib diisi melalui environment untuk import Vendor C |
| `VENDOR_C_TIMEOUT_MS` | `10000`; timeout tiap request HTTP |
| `VENDOR_C_MAX_RETRIES` | `4`; retry tambahan untuk 429, 5xx, timeout, atau gangguan jaringan |
| `WEBHOOK_URL` | Kosong dalam contoh; dipakai Sprint 4 |

`.env` dimuat tanpa menggantikan environment yang sudah diberikan shell. Secrets tidak boleh disimpan dalam source, fixture, atau commit. Jangan gunakan prefix `VITE_` untuk secrets karena variabel tersebut dapat terekspos ke browser. Tidak ada API key atau URL webhook nyata dalam repository.

## Arsitektur

```text
src/
  domain/       Konversi uang, waktu, dan pemetaan proyek; tidak bergantung HTTP/DB
  db/           Migrasi SQLite, master data, kontrak transaksi, staging dan review
  cli/          Inisialisasi, status, dan pemrosesan ulang record tertahan
  server/       Express: health, master proyek, status
  web/          React: halaman awal master proyek
config/         Alias proyek yang dapat ditinjau dan diedit
data/master/    Master proyek dan kurs dari paket tugas, tanpa transaksi
data/input/     Salinan input lokal, tidak di-commit
data/runtime/   Database persisten lokal, tidak di-commit
```

React membaca data dari API. Semua akses database, kurs sumber, import, deduplikasi, dan pemrosesan transaksi ada di server/CLI. Untuk dataset take-home, operasi SQLite sinkron membuat alur transaksi mudah diperiksa; skala concurrency tinggi belum menjadi target.

Tabel inti:

- `projects`: kode, nama, client, budget IDR.
- `exchange_rates`: kurs tetap yang dibaca dari file.
- `master_loads`: waktu pemuatan dan SHA-256 kedua file master untuk penelusuran.
- `import_runs`: status dan hitungan setiap percobaan import per sumber.
- `raw_records`: identitas sumber, lokasi baris, payload asli bertipe, hash, status dan alasan tinjauan.
- `transactions`: hasil normalisasi yang sudah terhubung proyek, kurs yang dipakai, UTC/WIB, minggu, referensi dan refund.
- `record_deduplications`: raw record yang tidak dihitung lagi, transaksi kanonisnya, dan alasan deduplikasi.
- `schema_migrations`: versi skema yang sudah diterapkan.

Foreign key aktif. Satu identitas `(source, source_record_id)` memiliki maksimal satu raw record dan satu transaksi efektif. Pemuatan master dan penerimaan record memakai transaksi SQLite. Database dan master tetap tersedia setelah proses dimulai ulang.

## Kontrak master dan nominal

`projects.csv` harus memiliki header unik `project_code,project_name,client,budget_idr`, kode proyek unik, nama/client terisi, dan budget positif. Budget nol/negatif ditolak secara eksplisit supaya persentase pemakaian tidak memiliki pembagi nol. Penghapusan proyek dari master ditolak; butuh migrasi yang disengaja.

`rates.json` mengikuti file asli:

```json
{
  "credit_to_idr": 160,
  "usd_to_idr": 16250
}
```

Kolom tambahan seperti `note` boleh ada. Kurs harus positif dan berlaku untuk semua tanggal. Mengganti kurs setelah ada transaksi ditolak untuk mencegah campuran konversi lama/baru; gunakan database baru atau migrasi perhitungan yang eksplisit.

| Sumber | Format nominal | Konversi |
| --- | --- | --- |
| Vendor A | Credits, titik sebagai desimal | credits × `credit_to_idr` |
| Vendor B | USD, `$` opsional, titik desimal/koma ribuan | USD × `usd_to_idr` |
| Vendor C | Integer sen USD | sen × (`usd_to_idr` ÷ 100) |
| Manual | String Indonesia atau sel numerik Excel | Nilai IDR |

String manual `Rp 1.850.000`, `47.040`, dan `1.234,50` menjadi `1850000`, `47040`, dan `1234.5`. Sel numerik `47.04` tetap `47.04`; format sel tidak mengubah nilainya. Format ambigu/tidak valid ditahan untuk ditinjau, bukan dibersihkan dengan menghapus semua tanda baca.

`decimal.js` memakai konteks presisi 100 digit, dengan operand maksimum 40 digit dan 20 angka desimal. Nilai numerik di atas batas integer aman JavaScript ditolak; gunakan string desimal. Tidak ada perkalian/divisi uang memakai floating point JavaScript. Nilai uang disimpan sebagai **string desimal kanonik dalam kolom SQLite TEXT**, beserta nominal asli, unit, dan kurs; gunakan aritmetika desimal, bukan `SUM`/`CAST` floating point SQLite, saat membuat agregasi Sprint 3. Pembulatan Rupiah dilakukan hanya saat ditampilkan. Nilai refund negatif dipertahankan.

## Waktu dan proyek

- Vendor A: `MM/DD/YYYY HH:mm`, sumber **UTC** sesuai header asli `timestamp_utc`.
- Vendor B: `DD-MM-YYYY HH:mm`, sumber **UTC** sesuai header asli `time_utc`.
- Vendor C: ISO 8601 dengan timezone eksplisit. Tidak menganggap string tanpa timezone sebagai UTC secara diam-diam.
- Manual: tanggal Excel (serial sistem 1900/1904 atau objek Date), `D/M/YYYY`, `D-M-YYYY`, `YYYY-MM-DD`, dan nama bulan seperti `Sep`/`Okt`. String tanggal dapat memuat jam. Format numerik ambigu pada manual diinterpretasikan **hari/bulan/tahun**.
- Tanggal manual tanpa jam diasumsikan **00.00 WIB**. Objek Date dari pembaca Excel diperlakukan sebagai komponen UTC yang merepresentasikan jam sel, bukan waktu lokal host. Importer spreadsheet sebaiknya mempertahankan serial Excel asli.
- Output WIB memakai offset tetap **UTC+07:00**, tanggal WIB, dan kunci minggu Senin. UTC disimpan untuk audit; pergeseran tanggal setelah konversi ikut memengaruhi minggu.
- Tanggal kalender tidak valid, Excel serial 60 pada sistem 1900, dan waktu yang ambigu pada override zona DST ditolak.

Resolver mencocokkan kode (case, spasi, tanda hubung), nama master, dan alias eksplisit. Tidak ada fuzzy matching. Konfigurasi awal memuat 14 alias terverifikasi untuk enam proyek, termasuk `Kopi Malam`, `Greenbox`, `glowlab serum`, `Senja`, `barakuda lookbook`, `R&D`, dan `rnd`.

Format `config/project-aliases.json`:

```json
[
  { "alias": "Kopi Malam", "projectCode": "KMD-02" }
]
```

Target alias harus ada pada master. Bila label cocok dengan lebih dari satu proyek, statusnya `ambiguous_project`; label kosong menjadi `missing_project`; label tidak dikenal menjadi `unknown_project`.

Untuk memperbaiki record tertahan: periksa `npm run review:list`, verifikasi proyek sebenarnya, lalu tambahkan alias ke array konfigurasi tanpa menghapus alias yang masih valid. Jalankan `npm run review:retry` untuk Vendor A/B/C atau ulangi `npm run import -- --source manual` untuk data manual, karena sumber manual harus melewati aturan invoice dan `Ref` lagi. Record yang belum jelas tetap tertahan. Blank label memerlukan koreksi sumber/record secara eksplisit; jangan membuat alias kosong.

## Aturan transaksi dan sprint lanjutan

Kontrak `TransactionDraft` di `src/db/records.ts` membawa sumber, ID stabil, file/baris, label proyek, vendor, nominal, timestamp, referensi, dan referensi refund. `stageRecord` menyimpan payload asli, menormalisasi, memetakan, dan menyimpan transaksi jika valid. Input yang belum valid disimpan dengan alasan tinjauan, terpisah dari transaksi efektif.

Perilaku yang sudah tersedia:

- Replay identitas sumber dengan isi sama tidak menambah transaksi.
- File atau nomor baris berbeda tidak dianggap perubahan isi bisnis. Lokasi kemunculan pertama tetap disimpan.
- ID sama dengan isi bisnis berubah menghasilkan konflik eksplisit; data lama tidak ditimpa.
- Setelah alias diperbaiki, record tertahan bisa diproses ulang tanpa transaksi ganda.
- Refund negatif disimpan beserta `refundOfSourceId` bila tersedia; tidak ada pengurangan kedua di luar nilai negatifnya.
- Duplikat `line_id` Vendor B dihitung sekali; dua transaksi dengan nominal sama dan ID berbeda tetap dipertahankan.
- Invoice manual yang sama dikenali dari nomor `INV-*` meskipun format tanggal/nominal berbeda.
- Manual dengan `Ref` Vendor A ditautkan ke transaksi Vendor A dan tidak dihitung lagi.
- Manual Vendor A tanpa `Ref` hanya dideduplikasi bila kombinasi proyek, tanggal WIB, dan nominal menghasilkan tepat satu kandidat. Kandidat ganda ditahan untuk review.
- Vendor C selalu diambil melalui HTTP dengan maksimum 100 record per halaman. Seluruh halaman dikumpulkan dan divalidasi sebelum record pertama disimpan.
- `429` menunggu `Retry-After`; 5xx dan gangguan jaringan memakai jeda bertahap serta batas retry. 400/401 dilaporkan langsung.

Perilaku yang **belum diimplementasikan**, dengan keputusan awal untuk sprint berikutnya:

1. **Sprint 3:** pengeluaran bersih proyek, vendor, dan mingguan harus berasal dari transaksi efektif yang sama. Minggu mulai Senin 00.00 WIB, refund masuk minggu tanggal refund. Proyek tanpa transaksi tetap ditampilkan; persentase boleh >100%.
2. **Sprint 4:** evaluasi setelah import semua sumber berhasil, ambang `pengeluaran > 0,8 × budget`. Tepat 80% belum memicu. Import pertama yang sudah di atas ambang memenuhi syarat. Satu alert berhasil per proyek untuk budget tetap; sukses dicatat setelah konfirmasi endpoint. Refund tidak menghapus riwayat. Pengiriman gagal boleh dicoba ulang.
3. **Sprint 5:** validasi gabungan, bukti webhook, rekonsiliasi, dan penyerahan repository.

Aturan awal minggu, perlakuan jam manual, kebijakan alert, batas nilai parser, pilihan schema dan penanganan record tertahan adalah **keputusan implementasi**, bukan syarat tambahan resmi dari brief.

## Verifikasi dan keterbatasan

Tes mencakup T-01–T-10: konversi, nominal manual, WIB, alias/ambigu, import ulang, duplikat, transaksi bernominal sama, refund, pagination 103 record, 429/5xx/401, serta persistensi, rollback, raw provenance, dan retry.

```bash
npm run check
TZ=America/Los_Angeles npm test -- src/domain/time.test.ts
npm run db:init -- --data-dir data/master
npm run db:status
```

Menjalankan `db:status` sebagai proses baru membuktikan pembacaan database dari disk; tes juga menutup dan membuka kembali koneksi ke file SQLite sementara. Rincian validasi ada di `docs/sprint-1.md` dan `docs/sprint-2.md`.

Belum ada autentikasi atau deployment publik. Target saat ini adalah review lokal. Pengiriman webhook, agregasi pengeluaran, dan grafik belum tersedia. Dataset asli masih memiliki 13 record belum terpetakan; tersedianya daftar tinjauan tidak membuat target pemetaan seluruh record otomatis terpenuhi.

Lihat [rencana sprint](AI_Production_Cost_Tracker_Sprint_Plan.md) untuk keseluruhan backlog.
