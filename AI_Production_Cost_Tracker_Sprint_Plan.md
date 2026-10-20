**Rencana Sprint — AI Production Cost Tracker**

Rencana ini disusun dari requirement yang diberikan, untuk membangun aplikasi take-home secara bertahap. Pembagian sprint, estimasi, dan keputusan implementasi di bawah adalah usulan pengerjaan, bukan ketentuan tambahan dari pemberi tugas.

Asumsi estimasi: 1 engineer, hari kerja efektif, dengan stack yang sudah dikuasai. Estimasi belum divalidasi terhadap paket data/API asli dan belum mencakup waktu menunggu klarifikasi. Jika tenggat lebih pendek, pertahankan seluruh requirement wajib dan kurangi fitur opsional.

| Sprint | Tujuan | Estimasi awal | Dependensi | Hasil utama |
| --- | --- | --- | --- | --- |
| 1 | Fondasi dan aturan pengolahan data | 1–2 hari | — | Database, master data, normalisasi, pemetaan proyek |
| 2 | Import lengkap dengan total yang benar | 2–3 hari | Sprint 1 | Empat sumber masuk, duplikat ditangani, refund benar |
| 3 | Dashboard yang dapat dipakai operasional | 2–3 hari | Sprint 2 | Ringkasan budget, rincian vendor, tren mingguan |
| 4 | Notifikasi budget yang dapat dibuktikan | 1–2 hari | Sprint 2 dan agregasi Sprint 3 | Webhook, riwayat pengiriman, retry |
| 5 | Validasi menyeluruh dan penyerahan | 1–2 hari | Sprint 1–4 | Repository dan README siap direview |

Total perkiraan: **7–12 hari kerja efektif**. Istilah sprint di sini berarti paket pekerjaan dengan hasil yang bisa didemokan; durasinya tidak harus mengikuti sprint dua mingguan.

**Sprint 1 — Fondasi dan aturan pengolahan data**

Tujuan: membentuk model data dan aturan perhitungan yang dipakai seluruh importer dan dashboard.

Backlog:

- [x] **S1-01 — Siapkan proyek dan konfigurasi.** Pilih stack, buat repository Git, struktur aplikasi, database persisten, migrasi, `.env.example`, dan aturan agar secrets tidak ikut commit. Mulai README setup dan keputusan arsitektur.
- [x] **S1-02 — Tetapkan kontrak transaksi.** Rancang penyimpanan identitas sumber, nominal/satuan asli, nominal IDR, waktu transaksi, proyek, vendor, referensi refund, serta status import dan record yang perlu ditinjau. Bentuk tabel boleh disesuaikan stack.
- [x] **S1-03 — Muat master proyek dan kurs.** Baca `projects.csv` dan `rates.json`; kurs tidak ditulis permanen di logika konversi. Master mencakup proyek yang belum memiliki transaksi.
- [x] **S1-04 — Bangun normalisasi nominal.** Konversi credits, USD, sen USD, dan nominal manual. Tangani simbol `$`, `Rp 1.850.000`, `47.040`, angka numerik, dan nilai negatif. Pertahankan presisi perhitungan; pembulatan hanya untuk tampilan.
- [x] **S1-05 — Bangun normalisasi waktu.** Parse format Vendor A `MM/DD/YYYY HH:mm`, Vendor B `DD-MM-YYYY HH:mm`, ISO UTC Vendor C, tanggal Excel, dan teks termasuk `Okt`. Pastikan tanggal hasil konversi WIB dipakai untuk agregasi. Periksa informasi zona waktu sumber; dokumentasikan asumsi yang belum ditentukan.
- [x] **S1-06 — Bangun pemetaan proyek.** Dukung alias yang terverifikasi seperti `KMD-02`, `KMD 02`, `kmd02`, dan `Kopi Malam`. Label kosong/ambigu masuk daftar tinjauan beserta alasan dan sumber, lalu dapat diproses ulang setelah alias diperbaiki.
- [x] **S1-07 — Dokumentasikan keputusan bisnis.** Tetapkan aturan identitas/deduplikasi, refund, awal minggu, dan alert sebelum implementasi lanjutan.
- [x] **S1-08 — Tambahkan tes normalisasi dan pemetaan.** Cakupan T-01–T-04.

Kriteria selesai:

- Database dan master data tersedia setelah aplikasi dimulai ulang.
- Contoh konversi menghasilkan 100 credits = Rp16.000, USD 2 = Rp32.500, dan 250 sen USD = Rp40.625 menggunakan kurs dari fixture yang sesuai.
- Parsing nominal/tanggal, perubahan tanggal UTC ke WIB, alias yang dikenal, dan penolakan tebakan proyek lolos tes.
- Cara setup awal dan asumsi bisnis sudah tercatat di README.

Cakupan: fondasi FR-01, FR-03, FR-04; NFR-01, NFR-02, NFR-03, NFR-05.

**Sprint 2 — Import seluruh sumber, deduplikasi, dan refund**

Tujuan: menghasilkan kumpulan transaksi yang lengkap, dapat ditelusuri, dan tidak berubah totalnya saat dataset yang sama diimpor ulang.

Urutan backlog di dalam sprint: importer file → API → deduplikasi lintas sumber → pengujian gabungan.

- [ ] **S2-01 — Import Vendor A dan B.** Baca kedua CSV melalui aturan normalisasi dan pemetaan Sprint 1. Simpan identitas transaksi sumber, termasuk `line_id` Vendor B.
- [ ] **S2-02 — Import spreadsheet manual.** Baca XLSX dan abaikan judul, header, baris kosong, serta `TOTAL`. Simpan invoice, vendor, dan `Ref` yang diperlukan untuk pencocokan.
- [ ] **S2-03 — Integrasikan API Vendor C.** Gunakan HTTP `GET /v1/usage` dengan Bearer API key dari environment. Ambil seluruh halaman mulai halaman 1 sampai selesai; jangan membaca backing file API secara langsung.
- [ ] **S2-04 — Tangani kegagalan API.** Hormati `Retry-After` pada 429, gunakan timeout dan retry terbatas untuk 5xx, serta tampilkan kesalahan kredensial/parameter dengan jelas. Laporkan kegagalan setelah retry habis.
- [ ] **S2-05 — Terapkan deduplikasi.** Tangani `line_id` identik dengan isi sama, invoice manual berulang meskipun format berbeda, dan `Ref` manual yang cocok dengan Vendor A. Gunakan identitas stabil; nominal sama saja tidak cukup untuk menghapus transaksi. Kasus ambigu masuk tinjauan.
- [ ] **S2-06 — Tangani refund.** Simpan refund sebagai transaksi negatif, tautkan ke transaksi asal bila tersedia, dan pastikan pengurangannya hanya terjadi sekali.
- [ ] **S2-07 — Buat perintah import dan laporan hasil.** Sediakan perintah yang terdokumentasi, status per sumber, jumlah record dibaca/diterima/duplikat/perlu ditinjau, dan cara memproses ulang record setelah koreksi alias. Import yang gagal sebagian tidak diberi status sukses lengkap.
- [ ] **S2-08 — Tambahkan tes import.** Cakupan T-05–T-10, termasuk menjalankan ulang import setelah kegagalan parsial.

Kriteria selesai:

- Keempat sumber diproses dan data bertahan setelah restart.
- Seluruh **103 record fixture Vendor C diambil sebelum validasi dan deduplikasi**; jumlah transaksi akhir dapat lebih kecil karena aturan pengolahan.
- Import dataset yang sama dua kali mempertahankan jumlah transaksi efektif dan total pengeluaran, termasuk refund.
- Duplikat dalam satu sumber dan lintas sumber dihitung sekali; transaksi berbeda dengan nominal sama tetap dipertahankan.
- Perbaikan alias memungkinkan pemrosesan ulang tanpa menambah duplikat.
- Semua transaksi valid terhubung ke master proyek. Record yang masih belum terpetakan dicatat sebagai pekerjaan yang belum tuntas terhadap FR-04; pencatatan saja tidak membuat target pemetaan seluruh record dianggap terpenuhi.
- README memuat cara import, retry, koreksi pemetaan, dan pemeriksaan hasilnya.

Cakupan: FR-01–FR-05; NFR-02, NFR-05, NFR-06.

**Sprint 3 — Agregasi dan dashboard operasional**

Tujuan: tim operasional dapat memahami pengeluaran proyek dan kondisi budget dari data yang sudah diproses.

- [ ] **S3-01 — Bangun agregasi proyek.** Hitung pengeluaran bersih, budget, dan persentase `pengeluaran bersih ÷ budget × 100%`. Gunakan transaksi setelah deduplikasi dan refund.
- [ ] **S3-02 — Bangun agregasi vendor dan mingguan.** Sertakan biaya manual yang valid. Pengelompokan minggu menggunakan WIB dan aturan minggu yang terdokumentasi.
- [ ] **S3-03 — Bangun ringkasan proyek.** Tampilkan seluruh proyek, nama/kode, budget IDR, pengeluaran IDR, dan persentase pemakaian. Tampilkan proyek tanpa transaksi serta persentase di atas 100% dengan benar.
- [ ] **S3-04 — Bangun rincian vendor dan tren mingguan.** Gunakan tabel/grafik sederhana dengan label dan format Rupiah yang dipahami pengguna nonteknis.
- [ ] **S3-05 — Tampilkan kondisi data.** Sediakan kondisi kosong dan keterangan jika import belum lengkap atau masih ada record belum terpetakan. Usulan tambahan ringan: sisa budget dan penanda di atas 80%.
- [ ] **S3-06 — Verifikasi konsistensi ringkasan.** Tambahkan T-11 dan periksa tampilan dengan data normal, kosong, refund, serta proyek overbudget.

Kriteria selesai:

- Dashboard menjawab pengeluaran versus budget, distribusi vendor, dan perubahan pengeluaran mingguan.
- Total proyek, vendor, dan minggu cocok dengan transaksi pada cakupan data yang sama.
- Refund dihitung konsisten dan tanggal WIB menentukan minggu transaksi.
- Proyek tanpa transaksi terlihat; persentase overbudget tidak dibatasi ke 100%.
- Ketidaklengkapan data terlihat agar angka tidak dianggap final secara keliru.

Cakupan: FR-06, FR-07; NFR-02, NFR-04.

**Sprint 4 — Notifikasi budget melalui webhook**

Tujuan: proyek yang melewati ambang budget memicu notifikasi yang dapat dibuktikan penerimaannya dan aman dicoba ulang.

- [ ] **S4-01 — Implementasikan evaluasi ambang.** Gunakan total bersih yang sama dengan dashboard. Jalankan evaluasi sesudah import lengkap berhasil.
- [ ] **S4-02 — Buat pengiriman webhook.** URL tujuan melalui konfigurasi environment. Payload mencantumkan proyek, pengeluaran, budget, dan persentase pemakaian. Endpoint mock lokal cukup untuk pembuktian take-home.
- [ ] **S4-03 — Simpan riwayat pengiriman.** Catat status, waktu, dan hasil/kesalahan. Status berhasil hanya disimpan setelah endpoint mengonfirmasi penerimaan.
- [ ] **S4-04 — Cegah alert berulang dan dukung retry.** Import ulang tidak mengirim alert yang sama setelah sukses; pengiriman gagal tetap dapat dicoba ulang.
- [ ] **S4-05 — Tambahkan tes dan bukti penerimaan.** Cakupan T-12–T-14. Dokumentasikan cara menjalankan mock, memicu alert, dan melihat request yang diterima.

Kebijakan usulan untuk versi pertama, mengikuti rekomendasi requirement:

- Kondisi alert adalah `pengeluaran > 0,8 × budget`; tepat 80% belum memicu alert.
- Proyek yang sudah melewati ambang pada import pertama juga memenuhi syarat.
- Untuk budget tetap, satu alert berhasil per proyek. Refund tidak menghapus riwayat pengiriman.
- Perubahan budget dan kebijakan pengiriman ulang setelah perubahan budget menjadi pengembangan berikutnya.

Kriteria selesai:

- Kasus di bawah, tepat, dan di atas 80% mengikuti kebijakan yang disepakati dalam README.
- Ada bukti request benar-benar diterima endpoint untuk proyek yang memenuhi syarat.
- Import ulang sesudah alert berhasil tidak mengirim alert yang sama.
- Webhook gagal tidak ditandai sukses dan dapat dicoba ulang.
- Import yang gagal sebagian tidak memicu evaluasi seolah seluruh sumber sudah lengkap.

Cakupan: FR-08; NFR-01, NFR-02, NFR-06.

**Sprint 5 — Validasi menyeluruh dan penyerahan**

Tujuan: reviewer dapat menjalankan, memeriksa hasil, dan memahami keputusan implementasi tanpa penjelasan tambahan.

- [ ] **S5-01 — Jalankan dari setup bersih.** Ikuti README untuk menyiapkan konfigurasi, database, API mock Vendor C, aplikasi, dan endpoint webhook.
- [ ] **S5-02 — Jalankan alur ujung ke ujung.** Import seluruh sumber → tinjau dan perbaiki pemetaan → cocokkan dashboard → buktikan webhook diterima → import ulang → periksa jumlah transaksi, total, dan riwayat alert tetap sesuai kebijakan.
- [ ] **S5-03 — Jalankan semua tes.** Cakupan T-01–T-14 sudah dibangun bertahap pada sprint terkait. Perbaiki kegagalan; catat hasil validasi akhir.
- [ ] **S5-04 — Lengkapi README.** Sertakan setup, cara menjalankan aplikasi/import/alert/tes, arsitektur, aturan konversi dan deduplikasi, asumsi zona waktu/pemetaan, kebijakan alert, keterbatasan, dan rencana pengembangan.
- [ ] **S5-05 — Periksa repository dan bukti.** Pastikan secrets nyata tidak masuk file atau riwayat commit, riwayat pengerjaan dipertahankan, dan link repository dapat diakses reviewer. Simpan ringkasan hasil tes, total sebelum/sesudah import ulang, serta bukti webhook diterima.
- [ ] **S5-06 — Audit requirement.** Periksa FR-01–FR-08 dan deliverables. Bila masih ada record belum terpetakan, jelaskan jumlah, sumber, dampak pada total sejauh dapat dihitung, serta pekerjaan yang belum selesai. Jangan menyatakan seluruh requirement terpenuhi jika masih ada pengecualian.

Kriteria selesai:

- Aplikasi dapat dijalankan dari awal menggunakan README.
- Tes kritis lolos, total dapat direkonsiliasi, import ulang tidak menggandakan biaya, dan webhook terbukti diterima.
- Kode importer, dashboard, webhook, tes, dan dokumentasi tersedia dalam repository dengan riwayat commit.
- Semua kekurangan yang belum diselesaikan dinyatakan secara jelas; target penyerahan tetap seluruh requirement wajib terpenuhi.

Cakupan: validasi akhir FR-01–FR-08, NFR-01–NFR-06, serta seluruh deliverables.

**Aturan kerja lintas sprint**

- Kerjakan tes logika kritis dan pembaruan README bersama fitur terkait; jangan menumpuk semuanya pada Sprint 5.
- Buat commit bermakna selama pengerjaan agar riwayat perubahan terjaga.
- Pertahankan perbedaan antara kewajiban brief dan keputusan implementasi. Penyimpanan record mentah, format laporan import, konfigurasi alias, dan kebijakan alert adalah pilihan implementasi yang harus dijelaskan.
- Usulan aturan waktu: tanggal manual tanpa jam dianggap 00.00 WIB; minggu dimulai Senin 00.00 WIB sampai sebelum Senin berikutnya; refund masuk minggu tanggal refund.
- Sprint 2 menjadi prioritas risiko karena mencakup empat sumber, format campuran, duplikasi lintas sumber, dan ketahanan API. Jangan mengurangi pengujian ketepatan total untuk mengejar tampilan.

**Di luar prioritas penyerahan awal**

Autentikasi pengguna, deployment publik, penjadwalan otomatis, tombol import di dashboard, filter proyek/periode, video demo, dan desain visual kompleks tidak diwajibkan brief. Pertimbangkan setelah seluruh pekerjaan wajib selesai.

**Pemetaan pengujian**

| Sprint | Skenario |
| --- | --- |
| 1 | T-01 konversi, T-02 nominal manual, T-03 WIB, T-04 pemetaan proyek |
| 2 | T-05 import ulang, T-06 duplikat, T-07 nominal sama, T-08 refund, T-09 pagination, T-10 error API |
| 3 | T-11 konsistensi total proyek/vendor/mingguan |
| 4 | T-12 ambang 80%, T-13 alert ulang, T-14 webhook gagal |
| 5 | Validasi gabungan T-01–T-14 dan alur setup sampai penyerahan |
