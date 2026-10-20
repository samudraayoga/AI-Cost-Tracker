# AI Production Cost Tracker

Aplikasi internal untuk menyatukan biaya produksi, memantau budget proyek, dan mengirim peringatan budget. **Sprint 1–5 telah dijalankan:** fondasi data, import empat sumber, deduplikasi, refund, agregasi presisi, dashboard operasional, webhook budget, dan validasi akhir.

Repository: [github.com/samudraayoga/AI-Cost-Tracker](https://github.com/samudraayoga/AI-Cost-Tracker). Audit akhir menemukan satu pengecualian terbuka terhadap FR-04: 13 record fixture belum dapat dihubungkan ke proyek tanpa keputusan bisnis tambahan. Dashboard dan alert hanya menghitung transaksi yang sudah terpetakan dan menyatakan kondisi ini secara eksplisit.

## Menjalankan aplikasi dan import

Gunakan **Node.js 24 LTS** (`.nvmrc`) dan npm. Lingkungan pengerjaan juga telah menjalankan tes dengan Node.js 26.7. Database menggunakan `node:sqlite` bawaan Node, sehingga tidak memerlukan server database atau kompilasi driver SQLite tambahan. API ini masih berstatus experimental pada Node 24; peringatan Node terkait status tersebut bukan kegagalan inisialisasi.

```bash
npm ci
cp .env.example .env
npm run db:init -- --data-dir data/master
npm run dev
```

Buka **http://127.0.0.1:5173**. API berjalan di **http://127.0.0.1:3001**. `data/master` berisi enam master proyek dan kurs asli dari paket tugas. Dashboard menampilkan total biaya, pemakaian budget seluruh proyek, rincian vendor, tren mingguan, dan kondisi kelengkapan data. Tanpa transaksi, semua proyek tetap terlihat dengan pengeluaran nol.

Untuk memakai semua file dari paket tugas, salin isi folder `AI_Cost_Tracker_Take_Home/data/` ke `data/input/`, lalu jalankan:

```bash
npm run db:init
npm run db:status
```

Pada workspace pengerjaan, salinan data asli sudah tersedia di `data/input`. Folder tersebut diabaikan Git; file asli di Downloads tidak diubah. Perintah `db:init` hanya memuat `projects.csv` dan `rates.json`. Direktori input bisa diganti lewat `DATA_DIR` atau `--data-dir`. Dataset mentah dan database lokal tidak ikut commit.

Jalankan mock Vendor C dari direktori paket tugas asli yang sudah diekstrak, pada terminal terpisah:

```bash
cd AI_Cost_Tracker_Take_Home/vendor-c-mock
VC_FAIL_RATE=0 node server.js
```

Untuk menguji retry 429/5xx sebagaimana perilaku default fixture, hilangkan `VC_FAIL_RATE=0`. Isi API key yang diberikan dokumentasi mock hanya pada environment lokal. Untuk membuktikan alert secara lokal, jalankan mock webhook pada terminal lain:

```bash
npm run webhook:mock
```

Mock menerima `POST /webhook` pada port `4020` dan menyimpan request ke `data/runtime/webhook-received.ndjson`. Kemudian import seluruh sumber dan arahkan alert ke mock:

```bash
VENDOR_C_API_KEY=<api-key-dari-docs-mock> \
WEBHOOK_URL=http://127.0.0.1:4020/webhook \
npm run import
npm run db:status
npm run review:list
npm run alerts:status
```

Importer memproses urutan Vendor A → Vendor B → Vendor C → manual agar `Ref` manual dapat dicocokkan ke Vendor A. Alert dievaluasi setelah run lengkap keempat sumber berhasil. Menjalankan perintah yang sama kembali aman: transaksi efektif, total, dan jumlah alert sukses tidak bertambah. Untuk mengulang satu sumber setelah koreksi alias atau kegagalan:

```bash
VENDOR_C_API_KEY=<api-key> npm run import -- --source vendor_c
npm run import -- --source manual
```

Nilai `status: complete` pada laporan berarti seluruh sumber yang dipilih selesai dibaca; record `review` tetap merupakan pengecualian yang harus diselesaikan. Bila salah satu sumber gagal, hasil keseluruhan `incomplete`, exit code nonzero, dan alert tidak dievaluasi. Import satu sumber juga tidak mengevaluasi alert. Bila webhook gagal, status menjadi `alert_failed` dan proses keluar nonzero. Perbaiki endpoint lalu coba lagi tanpa mengimpor ulang:

```bash
WEBHOOK_URL=http://127.0.0.1:4020/webhook npm run alerts:send
```

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
| `npm run webhook:mock` | Jalankan penerima webhook lokal dan simpan request sebagai NDJSON |
| `npm run alerts:send` | Evaluasi budget dan kirim alert yang belum pernah berhasil |
| `npm run alerts:status` | Lihat seluruh percobaan, status HTTP, dan error pengiriman |
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
| `WEBHOOK_URL` | Kosong; URL HTTP/HTTPS tujuan alert, misalnya `http://127.0.0.1:4020/webhook` |
| `WEBHOOK_TIMEOUT_MS` | `10000`; timeout satu request webhook |
| `WEBHOOK_MOCK_PORT` | `4020`; port untuk perintah mock lokal |
| `WEBHOOK_MOCK_LOG` | `data/runtime/webhook-received.ndjson`; bukti request mock lokal |

`.env` dimuat tanpa menggantikan environment yang sudah diberikan shell. Secrets tidak boleh disimpan dalam source, fixture, atau commit. Jangan gunakan prefix `VITE_` untuk secrets karena variabel tersebut dapat terekspos ke browser. Tidak ada API key atau URL webhook nyata dalam repository.

## Arsitektur

```text
src/
  alerts/       Evaluasi ambang, payload, pengiriman, deduplikasi, dan riwayat alert
  domain/       Konversi uang, waktu, dan pemetaan proyek; tidak bergantung HTTP/DB
  db/           Migrasi SQLite, master data, transaksi, review, dan agregasi dashboard
  cli/          Inisialisasi, import, review, alert, status, dan mock webhook
  server/       Express: health, master proyek, status, dan dashboard
  web/          React: dashboard proyek, vendor, tren mingguan, dan kondisi data
config/         Alias proyek yang dapat ditinjau dan diedit
data/master/    Master proyek dan kurs dari paket tugas, tanpa transaksi
data/input/     Salinan input lokal, tidak di-commit
data/runtime/   Database persisten lokal, tidak di-commit
```

React membaca data dari API. Semua akses database, kurs sumber, import, deduplikasi, pemrosesan transaksi, dan agregasi ada di server/CLI. Endpoint `GET /api/dashboard` membentuk semua bagian ringkasan dari kumpulan transaksi efektif yang sama. Untuk dataset take-home, operasi SQLite sinkron membuat alur transaksi mudah diperiksa; skala concurrency tinggi belum menjadi target.

Tabel inti:

- `projects`: kode, nama, client, budget IDR.
- `exchange_rates`: kurs tetap yang dibaca dari file.
- `master_loads`: waktu pemuatan dan SHA-256 kedua file master untuk penelusuran.
- `import_runs`: status dan hitungan setiap percobaan import per sumber.
- `raw_records`: identitas sumber, lokasi baris, payload asli bertipe, hash, status dan alasan tinjauan.
- `transactions`: hasil normalisasi yang sudah terhubung proyek, kurs yang dipakai, UTC/WIB, minggu, referensi dan refund.
- `record_deduplications`: raw record yang tidak dihitung lagi, transaksi kanonisnya, dan alasan deduplikasi.
- `budget_alert_attempts`: snapshot payload, angka, waktu, status HTTP, dan error setiap percobaan alert.
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

`decimal.js` memakai konteks presisi 100 digit, dengan operand maksimum 40 digit dan 20 angka desimal. Nilai numerik di atas batas integer aman JavaScript ditolak; gunakan string desimal. Tidak ada perkalian/divisi uang memakai floating point JavaScript. Nilai uang disimpan sebagai **string desimal kanonik dalam kolom SQLite TEXT**, beserta nominal asli, unit, dan kurs. Agregasi membaca nilai teks tersebut dan menjumlahkannya dengan aritmetika desimal, bukan `SUM`/`CAST` floating point SQLite. Pembulatan Rupiah dilakukan hanya saat ditampilkan. Nilai refund negatif dipertahankan.

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

## Aturan transaksi, dashboard, dan alert

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
- Ringkasan proyek, vendor, dan minggu berasal dari seluruh baris `transactions` efektif yang sama. Refund tetap negatif dan masuk pada minggu tanggal refund.
- Minggu berjalan Senin–Minggu menurut WIB. Semua proyek master tetap ditampilkan, termasuk yang belum memiliki transaksi; persentase overbudget tidak dibatasi ke 100%.
- Status kelengkapan memakai hasil import terbaru setiap sumber. Dashboard memberi peringatan bila suatu sumber belum sukses atau masih ada record yang perlu ditinjau.
- Alert memakai pengeluaran bersih yang sama dengan dashboard dan hanya memenuhi syarat bila `pengeluaran > 80% × budget`; nilai tepat 80% tidak memicu.
- Payload webhook memuat proyek, pengeluaran, budget, persentase, mata uang, kebijakan, waktu evaluasi, dan jumlah record yang masih perlu ditinjau.
- Respons HTTP 2xx baru dicatat sebagai sukses. Kegagalan HTTP, jaringan, atau timeout tersimpan dan bisa dicoba lagi. Satu sukses per proyek/kebijakan mencegah pengiriman berulang.

Aturan awal minggu, perlakuan jam manual, kebijakan alert, batas nilai parser, pilihan schema dan penanganan record tertahan adalah **keputusan implementasi**, bukan syarat tambahan resmi dari brief.

## Verifikasi dan keterbatasan

Tes mencakup T-01–T-14: konversi, nominal manual, WIB, alias/ambigu, import ulang, duplikat, transaksi bernominal sama, refund, pagination 103 record, 429/5xx/401, persistensi, rollback, raw provenance, konsistensi agregasi, batas 80%, pencegahan alert berulang, dan retry webhook gagal.

```bash
npm run check
TZ=America/Los_Angeles npm test -- src/domain/time.test.ts
npm run db:init -- --data-dir data/master
npm run db:status
```

Menjalankan `db:status` dan `alerts:status` sebagai proses baru membuktikan pembacaan database dari disk. Tes juga menutup dan membuka kembali koneksi ke file SQLite sementara. Rincian validasi ada di `docs/sprint-1.md` sampai `docs/sprint-4.md`.

Validasi akhir dari database kosong menghasilkan 351 transaksi efektif, total Rp159.994.487,50, 19 relasi deduplikasi, 13 review, dan tiga webhook sukses. Import kedua menerima nol transaksi baru, mempertahankan total, dan tidak mengirim webhook ulang. `npm run check` meluluskan 206 tes pada 10 file; audit dependency melaporkan nol vulnerability. Lihat [laporan validasi akhir](docs/final-validation.md) untuk perintah, rekonsiliasi, audit FR/NFR, dan bukti repository.

Dataset asli masih memiliki 13 record belum terpetakan dengan nilai mentah ternormalisasi Rp5.836.232,50. Nilai tersebut adalah potensi biaya yang tertahan, bukan angka yang aman ditambahkan ke proyek tertentu: sebagian berlabel `test`/`sandbox`, sebagian `misc`/pitch baru, dan tiga label kosong. Pemetaan memerlukan konfirmasi pemilik data. Karena itu FR-04 belum sepenuhnya terpenuhi dan total dashboard belum boleh dianggap final.

Belum ada autentikasi, deployment publik, penjadwalan otomatis, UI koreksi mapping, atau filter periode/proyek; fitur tersebut tidak diwajibkan brief awal. Untuk dataset dengan budget tetap ini, perubahan budget setelah alert sukses juga tidak mengirim ulang. Versi berikutnya sebaiknya menambahkan alur koreksi review dengan audit trail, versi budget pada identitas alert, scheduler import, autentikasi, serta filter dashboard.

Lihat [rencana sprint](AI_Production_Cost_Tracker_Sprint_Plan.md) untuk keseluruhan backlog.
