# Panduan Update BK Digital

Ringkasan perubahan dan cara memasangnya. Kode frontend (GitHub) dan data (Google Sheet)
tetap terpisah seperti sebelumnya — **update kode ini tidak pernah menyentuh data yang
sudah tersimpan di Sheet kamu.**

## -4. PENTING (update terbaru) — Rekap Absensi format lembar sekolah

Laporan **Rekap Absensi** sekarang punya pilihan baru **"Bentuk Rekap Absensi"** di
halaman Laporan:

1. **Grid Bulanan (format buku absensi)** — meniru lembar "ABSENSI KELAS" manual:
   satu baris per siswa, kolom tanggal 1–31, sel diisi kode **S / I / A** (Hadir
   sengaja dibiarkan kosong seperti di lembar aslinya), kolom **JUMLAH (S | I | A)**
   dan **KETR** di ujung kanan, lalu rekap **PUTRA / PUTRI / TOTAL**, keterangan
   kode, dan blok tanda tangan Guru BK. Wajib pilih **Kelas** + **Bulan**; otomatis
   dicetak **landscape**. Semua siswa kelas itu tetap muncul barisnya walau belum
   pernah dicatat absensinya.
2. **Rekap per Siswa (per anak)** — satu baris per siswa: Hadir / Sakit / Izin /
   Alpa, jumlah, dan **% kehadiran**, plus baris Total.
3. **Rekap per Kelas** — total H/S/I/A tiap kelas untuk periode yang dipilih.
4. **Rekap per Bulan** — bulan demi bulan; paling berguna kalau Periode dipilih
   **Semester**, jadi satu semester terlihat dalam satu tabel.
5. **Rincian Harian** — daftar catatan seperti versi sebelumnya (tidak berubah).

Bentuk 2–4 mengikuti **Periode** yang dipilih (Harian / Bulanan / Semester / Semua
Tanggal), jadi rekap per bulan & per semester tinggal ganti periodenya.

Di **Pengaturan > Profil Sekolah** ada tiga isian baru untuk kaki laporan:
**Kota/Tempat Tanda Tangan**, **Nama Guru BK**, dan **NIP Guru BK** (contoh hasil:
"Sragi, 15 September 2026 / Guru BK / SURYA IHZA MAHISTA, S.Pd / NIP. -").

Cukup ganti `index.html`, `script.js`, dan `style.css`. **Tidak ada perubahan
`Code.gs` dan tidak ada perubahan struktur Sheet** — tiga isian baru tadi tersimpan
sebagai baris key-value biasa di sheet **Pengaturan** yang sudah ada.

## -3. PENTING (update sebelumnya) — Pengetatan Keamanan

Karena `DEFAULT_API_URL` tertanam langsung di `script.js` (jadi terlihat publik kalau
repo GitHub-nya publik), update ini menambahkan:

1. **Proteksi brute-force di login Guru Mapel & Konselor** — setelah 5x gagal berturut-
   turut, Username itu dikunci otomatis selama 15 menit (memakai `CacheService`, bukan
   Sheet, jadi otomatis kadaluarsa sendiri). Tiap percobaan gagal juga diberi jeda ±1.2
   detik supaya tebak-tebak otomatis jauh lebih lambat. **Wajib ganti `Code.gs`** untuk
   dapat proteksi ini.
2. **Menutup 6 celah stored-XSS** di fitur TTD Tanda Tangan, Bukti Foto Home Visit, dan
   Logo Sekolah — semua sekarang di-escape sebelum ditampilkan. **Wajib ganti `script.js`**.
3. **Kolom "Konselor" pada data Konseling kini otomatis "distempel"** nama akun Konselor
   yang login saat membuat sesi baru (tidak bisa dipalsukan lewat DevTools), supaya
   Laporan Konseling per-konselor selalu akurat.
4. **BARU: Notifikasi email otomatis** ke Admin setiap kali ada akun Guru/Konselor yang
   kena lockout brute-force (lihat poin 1). Secara default terkirim ke email pemilik
   script ini — kalau mau kirim ke alamat lain, tambahkan Script Property
   **`ALERT_EMAIL`** (Project Settings > Script Properties) berisi email tujuan.

Tidak ada perubahan struktur Sheet di update ini — cukup timpa `Code.gs` & `script.js`,
lalu deploy ulang Web App.

## -2. PENTING (update sebelumnya) — ganti Code.gs lagi: TTD Siswa di Konseling

Form **Tambah/Edit Sesi Konseling** sekarang punya kotak **Tanda Tangan / Paraf Siswa**
(digambar langsung di layar pakai mouse atau jari di HP/tablet). Setelah sesi konseling
selesai, minta siswa tanda tangan/paraf di kotak itu sebelum disimpan.

- Tersimpan sebagai kolom baru **"TTD"** di sheet Konseling — kolom ini **otomatis
  ditambahkan sendiri** ke sheet Konseling yang sudah ada (lewat `ensureHeaderColumns()`
  di `Code.gs`), jadi tidak perlu edit manual header sheet, dan data konseling lama sama
  sekali tidak tersentuh.
- TTD ini otomatis ikut muncul di halaman **Laporan** (Rekap Konseling & Laporan Individu
  Siswa), ditampilkan sebagai gambar kecil tepat di sebelah kolom **Tindak Lanjut** —
  klik gambarnya untuk memperbesar.
- Karena ada kolom baru, **wajib timpa ulang `Code.gs`** kamu (lihat langkah di bagian 1
  di bawah), kalau tidak TTD yang digambar akan diam-diam terbuang karena backend lama
  tidak mengenali kolom "TTD".

## -1. PENTING (update sebelumnya) — ganti Code.gs lagi

Update kali ini:

1. **Konselor (Guru BK) sekarang boleh mencatat Kolaborasi, Absensi, dan Pelanggaran**,
   tidak cuma Konseling seperti sebelumnya — dibatasi ke kelas tanggung jawabnya sama
   seperti aturan Konseling. Ini murni perubahan aturan akses di `Code.gs`
   (`ROLE_WRITABLE_TYPES`), jadi **wajib timpa ulang `Code.gs`** kamu, kalau tidak akun
   Konselor akan tetap mendapat error "hanya bisa mencatat data Konseling" saat mencoba
   menambah data lain.
2. **Kolaborasi jenis "Home Visit" sekarang punya field Upload Bukti Foto** (bisa
   diganti lagi lewat Edit). Foto disimpan sebagai kolom baru **"BuktiFoto"** di sheet
   Kolaborasi — kolom ini **otomatis ditambahkan sendiri** ke sheet Kolaborasi yang
   sudah ada (lewat `ensureHeaderColumns()` di `Code.gs`), jadi tidak perlu edit manual
   header sheet, dan data lama sama sekali tidak tersentuh. Ini juga butuh `Code.gs`
   baru supaya kolom itu benar-benar tersimpan (backend lama akan diam-diam membuang
   data foto karena tidak mengenali kolomnya).

Cara update `Code.gs`-nya sama seperti bagian 1 di bawah: timpa isi `Code.gs` di Apps
Script Editor kamu dengan file `Code.gs` di paket ini, lalu **Deploy → Manage deployments
→ pilih deployment aktif → Edit (ikon pensil) → Version: New version → Deploy** (supaya
URL Web App tidak berubah, tidak perlu update ulang di layar login aplikasi).

## 0. PENTING — update ini WAJIB ganti Code.gs lagi

Update kali ini menambahkan penyimpanan **Profil Sekolah** (Nama Sekolah, Tahun
Pelajaran, Logo) ke Google Sheet lewat sheet baru bernama **"Pengaturan"**, supaya
identitas sekolah otomatis muncul lagi di perangkat/browser manapun — bukan cuma
tersimpan di localStorage satu browser seperti sebelumnya. Update ini juga
menambahkan **akun Guru Mapel** (lihat bagian 8) lewat sheet baru **"Guru"**.

Karena itu, **Code.gs di Apps Script kamu wajib ditimpa ulang** dengan isi `Code.gs`
yang ada di paket ini (langkah-langkahnya sama seperti bagian 1 di bawah). Kalau tidak
diganti, tombol "Simpan Profil Sekolah" akan gagal dengan pesan error "Aksi POST tidak
dikenal" karena backend lama belum mengenal aksi `saveSettings`, dan menu "Kelola Akun
Guru Mapel" / login Guru Mapel juga belum akan berfungsi.

Sheet "Pengaturan" dan "Guru" akan otomatis dibuat sendiri oleh backend saat pertama
kali dipakai (klik "Simpan Profil Sekolah" / tambah akun guru pertama) — tidak perlu
dibuat manual.

## 1. Kenapa harus ganti Code.gs?

File `Code.gs` di folder ini adalah backend baru untuk Google Apps Script kamu. Backend
lama tidak ikut ter-upload ke GitHub (memang wajar, itu hidup terpisah di Apps Script
Editor kamu), jadi backend ini dibuat generik: dia otomatis membaca sheet yang sudah ada
sesuai nama tab & header kolom yang dipakai aplikasi (Siswa, Absensi, Pelanggaran,
Konseling, Kolaborasi) — **tidak menimpa data yang sudah ada**, hanya menambah kolom/sheet
baru kalau belum ada.

### Cara pasang
1. Buka Google Sheet database BK Digital kamu → **Extensions → Apps Script**.
2. Backup dulu: copy semua isi `Code.gs` lama kamu ke tempat aman (jaga-jaga).
3. Hapus isi `Code.gs` di editor, ganti dengan seluruh isi file `Code.gs` di paket ini.
4. Klik ikon gerigi **Project Settings** → scroll ke **Script Properties** → **Add script property**:
   - Property: `ACCESS_TOKEN`
   - Value: buat kata sandi acak sendiri, contoh `bkdigital-smpn1-2026-x7q`
   - Simpan.
5. **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone** (atau **Anyone within [nama sekolah]** kalau sekolah pakai
     Google Workspace — ini pilihan paling aman, karena hanya akun sekolah yang bisa akses).
6. Salin URL Web App yang baru (kalau redeploy dari deployment lama, URL biasanya tetap sama).

## 2. Kenapa ini bikin data lebih aman?

- Sebelumnya, siapapun yang tahu URL Web App bisa langsung baca/ubah data lewat API —
  tanpa perlu password apapun.
- Sekarang setiap request wajib menyertakan `ACCESS_TOKEN`. Tanpa token yang benar,
  backend menolak semua request (baca maupun tulis).
- Token ini **tidak disimpan di kode GitHub** — hanya kamu yang set lewat Script Properties,
  dan pengguna aplikasi memasukkannya sekali di layar login (tersimpan di localStorage
  browser mereka, sama seperti URL Web App).
- Kalau sekolah kamu pakai Google Workspace, pilihan "Anyone within [organisasi]" di
  langkah deploy adalah lapis keamanan tambahan yang jauh lebih kuat — hanya akun
  @sekolahmu.sch.id yang bisa memanggil API sama sekali, terlepas dari token.

## 3. Masuk ke aplikasi (frontend)

Saat pertama buka aplikasi (atau lewat Pengaturan di sidebar), isi:
- **URL Web App** — sama seperti sebelumnya.
- **Token / Kata Sandi Akses** — isi persis sama dengan `ACCESS_TOKEN` yang kamu set di
  Script Properties tadi.

Kalau kamu belum sempat set `ACCESS_TOKEN` di Script Properties, backend tetap jalan
tanpa token (supaya tidak mengunci diri sendiri saat setup) — tapi sangat disarankan
segera diisi begitu deployment berhasil.

## 4. Fitur baru

### a) Pencarian
- Kotak pencarian di atas sekarang aktif di semua halaman (Siswa, Absensi, Pelanggaran,
  Konseling, Kolaborasi) — ketik untuk memfilter tabel/kartu yang sedang dibuka.
- Ketik nama/NIS siswa dari halaman manapun → muncul dropdown hasil pencarian siswa.
  Klik salah satu hasil untuk langsung membuka **Laporan Individu** siswa itu (siap cetak).

### b) Import data siswa dari Excel
- Di halaman **Data Siswa**, klik **Template Excel** untuk mengunduh file `.xlsx` kosong
  dengan kolom yang benar (NIS, Nama, Kelas, dst).
- Isi template itu di Excel/Spreadsheet, lalu klik **Import Excel** dan pilih file yang
  sudah diisi.
- **Aturan pentingnya:** import ini HANYA menambahkan siswa yang NIS-nya belum ada di
  database. Siswa yang NIS-nya sudah tercatat akan otomatis dilewati — data yang sudah
  ada, baik hasil input manual maupun import sebelumnya, **tidak akan pernah tertimpa**.
  Input manual lewat tombol "Tambah Siswa" tetap berfungsi seperti biasa dan bisa
  dipakai bergantian dengan import kapan saja.

## 5. Menjamin update kode tidak menghapus data

Karena kode di GitHub Pages (frontend) dan data siswa di Google Sheet (lewat Apps Script)
adalah dua sistem yang terpisah total:
- Push/update kode ke GitHub **tidak pernah** menyentuh isi Google Sheet.
- Fungsi `update` di backend baru hanya mengubah kolom yang benar-benar dikirim, baris
  lain dan kolom lain di sheet tidak disentuh sama sekali.
- Fungsi import (`importBulk`) murni menambah baris baru, tidak pernah menimpa baris
  yang cocok NIS-nya.

Jadi urutan aman untuk update ke depan: cukup update file frontend (`index.html`,
`script.js`, `style.css`) di GitHub, dan kalau ada perubahan backend, tempel ulang isi
`Code.gs` ke Apps Script Editor lalu **Deploy → Manage deployments → Edit → Deploy versi
baru** (pakai deployment yang sama supaya URL tidak berubah). Data di Sheet tidak akan
terpengaruh oleh kedua langkah ini.

## 6. Update performa (pemuatan data & Absen Massal lebih cepat)

Backend `Code.gs` di paket ini menambahkan dua aksi baru:
- `getAllBatch` — mengambil semua jenis data (Siswa, Absensi, dst) dalam **satu**
  permintaan ke server, bukan 6 permintaan terpisah seperti sebelumnya. Halaman jadi
  lebih responsif saat pertama dibuka atau saat klik tombol refresh.
- `bulkInsert` — dipakai fitur **Absen Massal per Kelas** untuk menyimpan semua siswa
  yang dicentang dalam satu permintaan, bukan satu-per-satu. Untuk kelas isi 30 siswa,
  ini bisa jauh lebih cepat dibanding sebelumnya.

**Wajib:** tempel ulang isi `Code.gs` yang baru ke Apps Script Editor (langkah sama
seperti bagian 1 di atas), lalu **Deploy → Manage deployments → Edit → Deploy** versi
baru (pakai deployment yang sama supaya URL tidak berubah). Kalau langkah ini
dilewati, fitur lama tetap jalan normal (tidak error), hanya saja peningkatan
kecepatannya belum aktif.

## 7. Template Pelanggaran (dropdown Jenis Pelanggaran & Poin)

Sekarang saat mencatat pelanggaran, **Jenis Pelanggaran** dipilih lewat dropdown
(bukan ketik bebas), dan **Poin** otomatis terisi sesuai jenis yang dipilih —
supaya konsisten antar guru. Ada juga opsi **"+ Jenis lainnya (ketik manual)"**
kalau memang belum ada di daftar baku.

- Tombol **Template Pelanggaran** (halaman Pelanggaran) untuk menambah/ubah/hapus
  daftar Jenis Pelanggaran & Poin baku sekolah kapan saja.
- Mengubah/menghapus item di Template **tidak** mengubah data pelanggaran siswa
  yang sudah pernah tercatat sebelumnya — keduanya disimpan terpisah.
- Backend `Code.gs` di paket ini menambahkan sheet baru **"MasterPelanggaran"**,
  otomatis dibuat & diisi ~19 jenis pelanggaran umum saat pertama kali dipakai
  (tetap bisa diubah/dihapus semuanya lewat menu Template Pelanggaran).

**Wajib:** tempel ulang `Code.gs` yang baru ke Apps Script Editor (bagian 1) lalu
**Deploy → Manage deployments → Edit → Deploy** versi baru (deployment yang sama,
supaya URL tidak berubah), baru kemudian ganti `index.html`, `script.js`,
`style.css` di GitHub seperti biasa.

## 8. Akun Guru Mapel — supaya tiap guru bisa input & pantau Pelanggaran sendiri

Sekarang guru mapel bisa punya akun login sendiri, **tanpa perlu tahu URL Web App
atau ACCESS_TOKEN sama sekali** — mereka cukup diberi Username & Password. Setelah
login, tampilan mereka otomatis dikepras: cuma menu **Pelanggaran** yang muncul
(untuk mencatat & memantau), dan hanya untuk kelas yang kamu tentukan sebagai
tanggung jawabnya. Pembatasan ini ditegakkan di server (Code.gs), bukan cuma
disembunyikan di tampilan — jadi walau guru iseng buka DevTools, tetap tidak bisa
mengintip/mengubah data Siswa, Absensi, Konseling, dll di luar akses tersebut.

### a) Sekali saja: isi URL Web App bawaan di `script.js`

Supaya guru tidak perlu tempel URL Apps Script sendiri, buka `script.js`, cari baris:

```js
const DEFAULT_API_URL = '';
```

Isi dengan URL Web App kamu (yang sama seperti yang kamu pakai sendiri sebagai
Admin/Guru BK), lalu commit ulang ke GitHub / upload ulang. URL ini **bukan
rahasia** (tanpa token, URL saja tidak bisa dipakai mengambil data apapun),
jadi aman ikut ter-commit ke repo publik. Kalau field ini dikosongkan, aplikasi
tetap berfungsi seperti sebelumnya (Admin isi URL manual di layar setup).

### b) Buat akun untuk tiap guru

1. Login sebagai Admin/Guru BK seperti biasa → klik **Pengaturan** → **Kelola Akun
   Guru Mapel**.
2. Isi Nama, Username, Password, dan **Kelas Tanggung Jawab** (pisahkan dengan
   koma kalau lebih dari satu kelas, contoh: `VII-A, VII-B`).
3. Klik Tambah Akun. Ulangi untuk tiap guru.
4. Bagikan **satu link** situs BK Digital yang sama ke semua guru (link yang sama
   persis dengan yang kamu pakai), plus Username & Password masing-masing lewat
   jalur pribadi (WhatsApp/japri), bukan digabung dengan link publiknya.

Guru tinggal buka link tersebut → kalau `DEFAULT_API_URL` sudah diisi, layar login
Guru Mapel (Username & Password saja) akan langsung muncul duluan — tidak ada field
URL/token yang perlu mereka isi.

### c) Beberapa catatan penting

- Password di sini disimpan **apa adanya (plain text)** di sheet "Guru" untuk
  kesederhanaan (sesuai isi kolom yang kamu ketik di menu Kelola Akun). Siapapun
  yang bisa membuka Google Sheet database ini otomatis bisa melihatnya — jadi
  jangan bagikan akses "Editor" ke Sheet database ke sembarang orang, dan sarankan
  guru tidak memakai password yang sama dengan akun penting lain.
- Sesi login guru otomatis kadaluarsa setelah **16 jam** — kalau tiba-tiba tidak
  bisa menyimpan lagi, minta mereka login ulang.
- Nonaktifkan akun (ubah Status jadi "Nonaktif") kalau seorang guru pindah tugas —
  tidak perlu dihapus kalau masih mau menyimpan riwayatnya.
- Backup Excel (`Unduh Backup`) **tidak pernah ikut membawa akun Guru/Password** —
  hanya data Siswa, Absensi, Pelanggaran, Konseling, dan Kolaborasi.

**Wajib:** tempel ulang `Code.gs` yang baru ke Apps Script Editor (bagian 1) lalu
**Deploy → Manage deployments → Edit → Deploy** versi baru (deployment yang sama),
baru kemudian ganti `index.html`, `script.js`, `style.css` di GitHub.

## 8. Laporan Pemanggilan Orang Tua & Home Visit dipisah + foto bisa diperbesar

- Di halaman **Laporan**, "Rekap Kolaborasi" sekarang dipecah jadi dua pilihan
  terpisah: **Rekap Pemanggilan Orang Tua** dan **Rekap Home Visit** — begitu
  juga di **Laporan Individu Siswa**, keduanya tampil sebagai dua bagian
  terpisah, bukan digabung seperti sebelumnya.
- Khusus laporan **Home Visit**, foto bukti kunjungan ikut ditampilkan di
  laporan (bukan cuma di kartu Kolaborasi), jadi siap dicetak/PDF lengkap
  dengan buktinya.
- Foto (di kartu Kolaborasi maupun di Laporan) sekarang **tidak lagi buka tab
  baru** kalau diklik — muncul jendela pratinjau dengan tombol **perbesar /
  perkecil** (juga bisa scroll mouse untuk zoom, klik foto untuk toggle
  zoom, atau tombol Reset/X untuk menutup).

Ini murni perubahan frontend (`index.html`, `script.js`, `style.css`) — tidak
perlu update `Code.gs` untuk bagian ini.
