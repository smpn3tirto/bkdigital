/* ============================================================
   BK DIGITAL — FRONTEND LOGIC
   ============================================================ */

/* Escape data siswa/guru sebelum dimasukkan ke innerHTML, supaya data yang berisi
   karakter HTML (mis. "<", ">", nama yang mengandung tag) tidak dieksekusi sebagai
   kode di browser pengguna lain (mencegah stored XSS). SELALU pakai fungsi ini
   untuk setiap nilai dari STATE (Nama, Kelas, Catatan, Keterangan, dst) yang
   ditaruh lewat innerHTML/template string, kecuali memang sengaja HTML aman
   yang kita tulis sendiri (mis. tag <tr>, <td> statis). */
function escapeHtml(value){
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TYPES = ['siswa','absensi','pelanggaran','konseling','kolaborasi'];
const STATE = { siswa:[], absensi:[], pelanggaran:[], konseling:[], kolaborasi:[], masterPelanggaran:[], guru:[], konselor:[], siswaLulus:[] };

/* URL Web App bawaan — diisi SEKALI oleh Admin BK saat pertama kali men-deploy
   situs ini (lihat PANDUAN-UPDATE.md), supaya guru mapel tidak perlu tahu atau
   menempel URL Apps Script sama sekali. Kalau dikosongkan, layar Admin BK tetap
   bisa mengisi URL secara manual seperti sebelumnya (mode lama tidak rusak). */
const DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbzt0Q8LiLvBj3hXNasmU8GlvkSzsh3cBtdYVEp_7dQBvWDv-X2y8GRd85KASRLyftPT/exec';

let API_URL = localStorage.getItem('bk_api_url') || DEFAULT_API_URL;
let API_TOKEN = localStorage.getItem('bk_api_token') || '';
/* Peran yang sedang login: 'admin' (Guru BK utama, akses penuh), 'guru'
   (Guru Mapel, dibatasi ke menu Pelanggaran & kelasnya sendiri saja), atau
   'konselor' (Guru BK per-kelas, dibatasi ke menu Konseling & kelasnya
   sendiri saja — supaya tiap Guru BK cuma melihat/mencatat konseling murid
   asuhnya, bukan murid Guru BK lain). */
let USER_ROLE = localStorage.getItem('bk_role') || 'admin';
let GURU_NAMA = localStorage.getItem('bk_guru_nama') || '';
let GURU_KELAS = JSON.parse(localStorage.getItem('bk_guru_kelas') || '[]');
let KONSELOR_NAMA = localStorage.getItem('bk_konselor_nama') || '';
let KONSELOR_KELAS = JSON.parse(localStorage.getItem('bk_konselor_kelas') || '[]');
let currentPage = 'dashboard';
let charts = {};

/* ---------------- PROFIL SEKOLAH ----------------
   Disimpan di localStorage saja (murni tampilan), tidak dikirim ke Google Sheet,
   supaya tidak perlu mengubah struktur backend. Logo disimpan sebagai base64
   data URL agar bisa langsung ditampilkan tanpa perlu hosting file terpisah. */
let SCHOOL_NAME = localStorage.getItem('bk_school_name') || '';
let SCHOOL_YEAR = localStorage.getItem('bk_school_year') || '';
let SCHOOL_LOGO = localStorage.getItem('bk_school_logo') || '';
/* Dipakai untuk blok tanda tangan di kaki laporan cetak (mis. "Sragi, 15 September 2026 /
   Guru BK / SURYA IHZA MAHISTA, S.Pd / NIP. -"), mengikuti format lembar absensi manual
   sekolah. Ikut tersimpan di sheet "Pengaturan" seperti profil sekolah lainnya. */
let SCHOOL_CITY = localStorage.getItem('bk_school_city') || '';
let SCHOOL_BK_NAME = localStorage.getItem('bk_school_bk_name') || '';
let SCHOOL_BK_NIP = localStorage.getItem('bk_school_bk_nip') || '';

function renderSchoolProfile(){
  const bar = $('#schoolProfileBar');
  if (!bar) return;
  const hasAny = SCHOOL_NAME || SCHOOL_YEAR || SCHOOL_LOGO;
  bar.style.display = hasAny ? 'flex' : 'none';
  $('#schoolProfileName').textContent = SCHOOL_NAME || 'Nama Sekolah';
  $('#schoolProfileYear').textContent = SCHOOL_YEAR ? `Tahun Pelajaran ${SCHOOL_YEAR}` : 'Tahun Pelajaran belum diatur';
  const img = $('#schoolProfileLogo');
  const icon = $('#schoolProfileLogoIcon');
  if (SCHOOL_LOGO){
    img.src = SCHOOL_LOGO; img.style.display = 'block'; icon.style.display = 'none';
  } else {
    img.style.display = 'none'; icon.style.display = 'block';
  }
  document.title = SCHOOL_NAME ? `BK Digital — ${SCHOOL_NAME}` : 'BK Digital — Sistem Bimbingan Konseling';
  if (window.updatePwaIdentity) window.updatePwaIdentity(); // ikon/manifest/splash mengikuti logo sekolah
}

/* ---------------- ADAPTER: real Apps Script vs offline demo ---------------- */
const RealAdapter = {
  /* Login Guru Mapel: hanya kirim username & password (tidak pernah URL/token
     master), backend membalas sessionToken terbatas yang lalu dipakai sebagai
     API_TOKEN untuk request-request berikutnya. */
  async loginGuru(username, password){
    const res = await fetch(API_URL, { method:'POST', body: JSON.stringify({ action:'loginGuru', username, password }) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Gagal login');
    return json.data;
  },
  /* Login Konselor (Guru BK per-kelas): sama alurnya dengan loginGuru, hanya
     beda action & sheet yang dibaca server (lihat Code.gs: loginKonselor). */
  async loginKonselor(username, password){
    const res = await fetch(API_URL, { method:'POST', body: JSON.stringify({ action:'loginKonselor', username, password }) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Gagal login');
    return json.data;
  },
  async getAll(type){
    // Token dikirim lewat body POST (bukan query string URL) supaya tidak
    // tersimpan di riwayat browser / log server.
    const res = await fetch(API_URL, { method:'POST', body: JSON.stringify({ action:'getAll', type, token: API_TOKEN }) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Gagal mengambil data');
    return json.data;
  },
  /* Ambil semua jenis data (Siswa, Absensi, dst) dalam SATU kali permintaan ke server,
     jauh lebih cepat dibanding 6 permintaan terpisah karena Apps Script hanya perlu
     "bangun" satu kali untuk melayani semuanya sekaligus. */
  async getAllBatch(){
    const res = await fetch(API_URL, { method:'POST', body: JSON.stringify({ action:'getAllBatch', token: API_TOKEN }) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Gagal mengambil data');
    return json.data;
  },
  async create(type, data){
    const res = await fetch(API_URL, { method:'POST', body: JSON.stringify({ action:'create', type, data, token: API_TOKEN }) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Gagal menyimpan data');
    return json.data;
  },
  async update(type, id, data){
    const res = await fetch(API_URL, { method:'POST', body: JSON.stringify({ action:'update', type, id, data, token: API_TOKEN }) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Gagal memperbarui data');
    return json.data;
  },
  async delete(type, id){
    const res = await fetch(API_URL, { method:'POST', body: JSON.stringify({ action:'delete', type, id, token: API_TOKEN }) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Gagal menghapus data');
    return true;
  },
  async importBulk(type, rows, matchField){
    const res = await fetch(API_URL, { method:'POST', body: JSON.stringify({ action:'importBulk', type, rows, matchField, token: API_TOKEN }) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Gagal mengimpor data');
    return json.data;
  },
  /* Simpan banyak baris sekaligus dalam SATU permintaan (dipakai Absen Massal) —
     jauh lebih cepat dibanding memanggil create() satu-satu per siswa. */
  async bulkInsert(type, rows){
    const res = await fetch(API_URL, { method:'POST', body: JSON.stringify({ action:'bulkInsert', type, rows, token: API_TOKEN }) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Gagal menyimpan data massal');
    return json.data;
  },
  /* Profil Sekolah & pengaturan lain disimpan sebagai key-value di sheet
     "Pengaturan" — supaya ikut tersimpan di Google Sheet dan otomatis muncul
     lagi di perangkat/browser lain, bukan cuma di localStorage. */
  async getSettings(){
    const res = await fetch(API_URL, { method:'POST', body: JSON.stringify({ action:'getSettings', token: API_TOKEN }) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Gagal memuat pengaturan');
    return json.data;
  },
  async saveSettings(data){
    const res = await fetch(API_URL, { method:'POST', body: JSON.stringify({ action:'saveSettings', data, token: API_TOKEN }) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Gagal menyimpan pengaturan');
    return json.data;
  },
  /* Kenaikan Kelas: ubah kolom Kelas untuk banyak siswa terpilih sekaligus
     ke satu Kelas Tujuan, dalam SATU permintaan (bukan update() satu-satu). */
  async promoteSiswa(ids, kelasTujuan){
    const res = await fetch(API_URL, { method:'POST', body: JSON.stringify({ action:'promoteSiswa', ids, kelasTujuan, token: API_TOKEN }) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Gagal melakukan kenaikan kelas');
    return json.data;
  },
  /* Kelulusan: pindahkan banyak siswa terpilih sekaligus dari Data Siswa ke arsip
     "Siswa Lulus" (tampil di menu Laporan). */
  async lulusSiswa(ids, tahunLulus){
    const res = await fetch(API_URL, { method:'POST', body: JSON.stringify({ action:'lulusSiswa', ids, tahunLulus, token: API_TOKEN }) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Gagal melakukan kelulusan siswa');
    return json.data;
  }
};

const DemoAdapter = {
  key(type){ return `bk_demo_${type}`; },
  read(type){ return JSON.parse(localStorage.getItem(this.key(type)) || '[]'); },
  write(type, arr){ localStorage.setItem(this.key(type), JSON.stringify(arr)); },
  async getAll(type){ return this.read(type); },
  /* Padanan getAllBatch di RealAdapter, supaya kode loadAll() bisa sama untuk kedua mode. */
  async getAllBatch(){
    const out = {};
    TYPES.forEach(t => out[t] = this.read(t));
    out.masterPelanggaran = this.read('masterPelanggaran');
    out.guru = this.read('guru');
    out.konselor = this.read('konselor');
    out.siswaLulus = this.read('siswaLulus');
    out.pengaturan = await this.getSettings();
    return out;
  },
  async create(type, data){
    const arr = this.read(type);
    data.ID = data.ID || (type.substring(0,3).toUpperCase() + '-' + Date.now().toString(36));
    arr.push(data); this.write(type, arr); return data;
  },
  async update(type, id, data){
    const arr = this.read(type);
    const idx = arr.findIndex(o => String(o.ID) === String(id));
    if (idx === -1) throw new Error('Data tidak ditemukan');
    arr[idx] = { ...arr[idx], ...data }; this.write(type, arr); return arr[idx];
  },
  async delete(type, id){
    const arr = this.read(type).filter(o => String(o.ID) !== String(id));
    this.write(type, arr); return true;
  },
  async importBulk(type, rows, matchField){
    const arr = this.read(type);
    const existingKeys = new Set(arr.map(o => String(o[matchField]||'').trim().toLowerCase()).filter(Boolean));
    let added = 0, skipped = 0; const skippedKeys = [];
    rows.forEach((r,i) => {
      const key = String(r[matchField]||'').trim().toLowerCase();
      if (key && existingKeys.has(key)){ skipped++; skippedKeys.push(r[matchField]); return; }
      const row = { ...r, ID: r.ID || (type.substring(0,3).toUpperCase() + '-' + Date.now().toString(36) + '-' + i) };
      arr.push(row);
      if (key) existingKeys.add(key);
      added++;
    });
    this.write(type, arr);
    return { added, skipped, skippedKeys };
  },
  /* Padanan bulkInsert di RealAdapter — simpan banyak baris sekaligus. */
  async bulkInsert(type, rows){
    const arr = this.read(type);
    const inserted = rows.map((r,i) => ({ ...r, ID: r.ID || (type.substring(0,3).toUpperCase() + '-' + Date.now().toString(36) + '-' + i) }));
    inserted.forEach(row => arr.push(row));
    this.write(type, arr);
    return { inserted: inserted.length, rows: inserted };
  },
  /* Padanan getSettings/saveSettings di RealAdapter, tapi murni di localStorage
     karena mode demo memang tidak punya Google Sheet sungguhan. */
  async getSettings(){
    return {
      NamaSekolah: localStorage.getItem('bk_school_name') || '',
      TahunPelajaran: localStorage.getItem('bk_school_year') || '',
      LogoSekolah: localStorage.getItem('bk_school_logo') || '',
      KotaSekolah: localStorage.getItem('bk_school_city') || '',
      NamaGuruBK: localStorage.getItem('bk_school_bk_name') || '',
      NipGuruBK: localStorage.getItem('bk_school_bk_nip') || ''
    };
  },
  async saveSettings(data){
    if (data.NamaSekolah !== undefined) localStorage.setItem('bk_school_name', data.NamaSekolah);
    if (data.TahunPelajaran !== undefined) localStorage.setItem('bk_school_year', data.TahunPelajaran);
    if (data.KotaSekolah !== undefined) localStorage.setItem('bk_school_city', data.KotaSekolah);
    if (data.NamaGuruBK !== undefined) localStorage.setItem('bk_school_bk_name', data.NamaGuruBK);
    if (data.NipGuruBK !== undefined) localStorage.setItem('bk_school_bk_nip', data.NipGuruBK);
    if (data.LogoSekolah !== undefined){
      if (data.LogoSekolah) localStorage.setItem('bk_school_logo', data.LogoSekolah);
      else localStorage.removeItem('bk_school_logo');
    }
    return this.getSettings();
  },
  /* Padanan promoteSiswa di RealAdapter, murni di localStorage untuk mode demo. */
  async promoteSiswa(ids, kelasTujuan){
    const idSet = new Set((ids||[]).map(String));
    const arr = this.read('siswa');
    let updated = 0;
    arr.forEach(s => { if (idSet.has(String(s.ID))){ s.Kelas = kelasTujuan; updated++; } });
    this.write('siswa', arr);
    return { updated, kelasTujuan };
  },
  /* Padanan lulusSiswa di RealAdapter, murni di localStorage untuk mode demo. */
  async lulusSiswa(ids, tahunLulus){
    const idSet = new Set((ids||[]).map(String));
    const before = this.read('siswa');
    const after = before.filter(s => !idSet.has(String(s.ID)));
    const tgl = new Date().toISOString().slice(0,10);
    const arsip = this.read('siswaLulus');
    before.filter(s => idSet.has(String(s.ID))).forEach((s, i) => {
      arsip.push({ ID:'LUL-' + Date.now().toString(36).toUpperCase() + '-' + i, SiswaID:s.ID, NIS:s.NIS, Nama:s.Nama, Kelas:s.Kelas,
        JenisKelamin:s.JenisKelamin, TempatTglLahir:s.TempatTglLahir, Alamat:s.Alamat, NamaOrtu:s.NamaOrtu, NoHPOrtu:s.NoHPOrtu,
        Catatan:s.Catatan, TahunLulus:tahunLulus || '', TanggalLulus:tgl });
    });
    this.write('siswa', after);
    this.write('siswaLulus', arsip);
    return { deleted: before.length - after.length, archived: before.length - after.length };
  },
  seedIfEmpty(){
    if (this.read('siswa').length) return;
    const siswa = [
      { ID:'SIS-1', NIS:'2201001', Nama:'Ahmad Fadillah', Kelas:'IX-A', JenisKelamin:'L', TempatTglLahir:'Semarang, 12-04-2011', Alamat:'Jl. Merdeka No. 12', NamaOrtu:'Budi Santoso', NoHPOrtu:'081234567801', Catatan:'' },
      { ID:'SIS-2', NIS:'2201002', Nama:'Siti Nurhaliza', Kelas:'IX-A', JenisKelamin:'P', TempatTglLahir:'Purwodadi, 03-08-2011', Alamat:'Jl. Anggrek No. 5', NamaOrtu:'Sri Wahyuni', NoHPOrtu:'081234567802', Catatan:'' },
      { ID:'SIS-3', NIS:'2201003', Nama:'Rizky Maulana', Kelas:'VIII-B', JenisKelamin:'L', TempatTglLahir:'Grobogan, 21-01-2012', Alamat:'Jl. Melati No. 9', NamaOrtu:'Agus Wibowo', NoHPOrtu:'081234567803', Catatan:'Perlu pemantauan kedisiplinan' },
      { ID:'SIS-4', NIS:'2201004', Nama:'Dewi Lestari', Kelas:'VIII-B', JenisKelamin:'P', TempatTglLahir:'Purwodadi, 15-11-2011', Alamat:'Jl. Kenanga No. 2', NamaOrtu:'Hendra Kusuma', NoHPOrtu:'081234567804', Catatan:'' },
      { ID:'SIS-5', NIS:'2201005', Nama:'Muhammad Iqbal', Kelas:'VII-C', JenisKelamin:'L', TempatTglLahir:'Semarang, 30-06-2012', Alamat:'Jl. Mawar No. 18', NamaOrtu:'Joko Prasetyo', NoHPOrtu:'081234567805', Catatan:'' }
    ];
    this.write('siswa', siswa);
    const today = new Date(); const ymd = (d) => d.toISOString().slice(0,10);
    const absensi = [
      { ID:'ABS-1', Tanggal: ymd(today), SiswaID:'SIS-1', Nama:'Ahmad Fadillah', Kelas:'IX-A', Status:'Hadir', Keterangan:'' },
      { ID:'ABS-2', Tanggal: ymd(today), SiswaID:'SIS-3', Nama:'Rizky Maulana', Kelas:'VIII-B', Status:'Alpa', Keterangan:'Tanpa keterangan' },
      { ID:'ABS-3', Tanggal: ymd(today), SiswaID:'SIS-4', Nama:'Dewi Lestari', Kelas:'VIII-B', Status:'Sakit', Keterangan:'Demam' }
    ];
    this.write('absensi', absensi);
    const pelanggaran = [
      { ID:'PEL-1', Tanggal: ymd(today), SiswaID:'SIS-3', Nama:'Rizky Maulana', Kelas:'VIII-B', JenisPelanggaran:'Terlambat masuk sekolah', Poin:5, Keterangan:'Terlambat 20 menit', Penanganan:'Teguran lisan' },
      { ID:'PEL-2', Tanggal: ymd(today), SiswaID:'SIS-3', Nama:'Rizky Maulana', Kelas:'VIII-B', JenisPelanggaran:'Tidak mengerjakan tugas', Poin:5, Keterangan:'3x berturut-turut', Penanganan:'Pemanggilan siswa' }
    ];
    this.write('pelanggaran', pelanggaran);
    const konseling = [
      { ID:'KON-1', Tanggal: ymd(today), SiswaID:'SIS-3', Nama:'Rizky Maulana', Kelas:'VIII-B', Topik:'Kedisiplinan', Masalah:'Sering terlambat dan menunda tugas', HasilKonseling:'Siswa berjanji memperbaiki manajemen waktu', TindakLanjut:'Pemantauan 2 minggu', Konselor:'Bu Ratna, S.Pd' }
    ];
    this.write('konseling', konseling);
    const kolaborasi = [
      { ID:'KOL-1', Tanggal: ymd(today), SiswaID:'SIS-3', Nama:'Rizky Maulana', Kelas:'VIII-B', Jenis:'Pemanggilan Orang Tua', Tujuan:'Membahas kedisiplinan anak', Hasil:'Orang tua berkomitmen mendampingi di rumah', Petugas:'Bu Ratna, S.Pd' }
    ];
    this.write('kolaborasi', kolaborasi);
    const masterPelanggaran = [
      ['Terlambat masuk sekolah', 5, 'Ringan'],
      ['Tidak memakai atribut lengkap', 5, 'Ringan'],
      ['Tidak mengerjakan tugas/PR', 5, 'Ringan'],
      ['Makan/minum di kelas saat KBM', 5, 'Ringan'],
      ['Membuang sampah sembarangan', 5, 'Ringan'],
      ['Tidak mengikuti upacara', 10, 'Ringan'],
      ['Rambut/seragam tidak sesuai aturan', 10, 'Ringan'],
      ['Membawa HP tanpa izin', 15, 'Sedang'],
      ['Bolos jam pelajaran', 15, 'Sedang'],
      ['Keluar kelas tanpa izin', 15, 'Sedang'],
      ['Berkata tidak sopan kepada teman', 20, 'Sedang'],
      ['Mencontek saat ujian', 25, 'Sedang'],
      ['Merokok di lingkungan sekolah', 50, 'Berat'],
      ['Berkelahi dengan teman', 50, 'Berat'],
      ['Membawa/menggunakan barang terlarang', 75, 'Berat'],
      ['Melawan/tidak sopan kepada guru', 75, 'Berat'],
      ['Merusak fasilitas sekolah', 50, 'Berat'],
      ['Bullying/perundungan', 75, 'Berat'],
      ['Lainnya', 5, 'Lainnya']
    ].map((r,i) => ({ ID:'MPL-'+(i+1), JenisPelanggaran:r[0], Poin:r[1], Kategori:r[2] }));
    this.write('masterPelanggaran', masterPelanggaran);
  }
};

let adapter = RealAdapter;

/* ---------------- UTIL ---------------- */
function $(sel, ctx=document){ return ctx.querySelector(sel); }
function $all(sel, ctx=document){ return Array.from(ctx.querySelectorAll(sel)); }
function showLoading(v){ $('#loadingOverlay').classList.toggle('show', v); }
function toast(msg, type=''){
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3000);
}
function fmtDate(d){
  if (!d) return '-';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' });
}
function initials(name){ return (name||'?').trim().split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase(); }

/* ---------------- KIRIM WA KE ORANG TUA (manual, via wa.me — gratis, tanpa API pihak ketiga) ---------------- */
/* Rapikan nomor HP orang tua ke format wa.me (62xxxxxxxxxx, tanpa spasi/strip/tanda +).
   Menerima input umum orang Indonesia: 08xxx, +62xxx, 62xxx, atau 8xxx polos. */
function formatPhoneWa(raw){
  let d = String(raw || '').replace(/[^0-9]/g, '');
  if (!d) return '';
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (!d.startsWith('62')) d = '62' + d;
  return d;
}
function buildAbsenWaText(siswa, absen){
  const namaOrtu = (siswa && siswa.NamaOrtu) ? `Bpk/Ibu ${siswa.NamaOrtu}` : 'Bapak/Ibu Orang Tua/Wali';
  const tgl = fmtDate(absen.Tanggal);
  const jam = new Date().toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' });
  const ket = absen.Keterangan ? `\nKeterangan: ${absen.Keterangan}` : '';
  return `Yth. ${namaOrtu},\n\nKami informasikan bahwa ananda *${(siswa && siswa.Nama) || absen.Nama || '-'}* (Kelas ${(siswa && siswa.Kelas) || absen.Kelas || '-'}) tercatat *${absen.Status}* di sekolah pada ${tgl} pukul ${jam}.${ket}\n\nTerima kasih atas perhatiannya.\n— Pesan dari BK Digital`;
}
/* Buka wa.me dengan pesan sudah terisi — guru/BK tinggal tap "Kirim" di WhatsApp.
   Tidak ada yang terkirim otomatis tanpa tap manual ini (gratis, tanpa API pihak ketiga). */
function openWaForAbsen(absenId){
  const absen = STATE.absensi.find(a => String(a.ID) === String(absenId));
  if (!absen){ toast('Data absensi tidak ditemukan.', 'error'); return; }
  const siswa = STATE.siswa.find(s => String(s.ID) === String(absen.SiswaID));
  const phone = formatPhoneWa(siswa ? siswa.NoHPOrtu : '');
  if (!phone){ toast('Nomor HP orang tua belum diisi untuk siswa ini.', 'error'); return; }
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(buildAbsenWaText(siswa, absen))}`;
  window.open(url, '_blank');
}
function colorFromString(str){
  const colors = ['#2F6F63','#E0932F','#3B7DD8','#D9614F','#8A5FC7','#3E9A63'];
  let h = 0; for (let i=0;i<(str||'').length;i++) h = str.charCodeAt(i) + ((h<<5)-h);
  return colors[Math.abs(h) % colors.length];
}
function uniqueClasses(){
  const set = new Set(STATE.siswa.map(s => s.Kelas).filter(Boolean));
  return Array.from(set).sort();
}
function siswaById(id){
  return STATE.siswa.find(s => String(s.ID) === String(id))
    || (STATE.siswaLulus || []).map(a => ({ ...a, ID: a.SiswaID })).find(a => String(a.ID) === String(id));
}
function isThisMonth(dateStr){
  if (!dateStr) return false;
  const d = new Date(dateStr); const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

/* ---------------- DATA LOADING ---------------- */
async function loadAll(){
  showLoading(true);
  try{
    const data = await adapter.getAllBatch();
    TYPES.forEach(t => STATE[t] = data[t] || []);
    STATE.masterPelanggaran = data.masterPelanggaran || [];
    STATE.guru = data.guru || [];
    STATE.konselor = data.konselor || [];
    STATE.siswaLulus = data.siswaLulus || [];
    applySettingsFromServer(data.pengaturan || {});
    populateClassFilters();
    renderCurrentPage();
    renderDashboard();
  }catch(err){
    toast('Gagal memuat data: ' + err.message, 'error');
  }finally{
    showLoading(false);
  }
}

/* Terapkan Profil Sekolah yang datang dari server (Google Sheet / mode demo) dan
   simpan salinannya di localStorage supaya lain kali app dibuka, identitas
   sekolah langsung tampil seketika (dari cache) sebelum data server selesai
   dimuat, lalu diperbarui lagi begitu respons server datang. */
function applySettingsFromServer(map){
  SCHOOL_NAME = map.NamaSekolah || '';
  SCHOOL_YEAR = map.TahunPelajaran || '';
  SCHOOL_LOGO = map.LogoSekolah || '';
  SCHOOL_CITY = map.KotaSekolah || '';
  SCHOOL_BK_NAME = map.NamaGuruBK || '';
  SCHOOL_BK_NIP = map.NipGuruBK || '';
  localStorage.setItem('bk_school_city', SCHOOL_CITY);
  localStorage.setItem('bk_school_bk_name', SCHOOL_BK_NAME);
  localStorage.setItem('bk_school_bk_nip', SCHOOL_BK_NIP);
  localStorage.setItem('bk_school_name', SCHOOL_NAME);
  localStorage.setItem('bk_school_year', SCHOOL_YEAR);
  if (SCHOOL_LOGO) localStorage.setItem('bk_school_logo', SCHOOL_LOGO);
  else localStorage.removeItem('bk_school_logo');
  renderSchoolProfile();
}

function populateClassFilters(){
  const classes = uniqueClasses();
  const selectors = ['#filterKelasSiswa','#filterKelasAbsensi','#filterKelasPelanggaran','#filterKelasKonseling','#reportKelas'];
  selectors.forEach(sel => {
    const el = $(sel); if (!el) return;
    const current = el.value;
    el.innerHTML = '<option value="">Semua Kelas</option>' + classes.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    el.value = current;
  });
  populateReportSiswaSelect();
  populateLulusTahunOptions();
}

function populateReportSiswaSelect(){
  const el = $('#reportSiswa'); if (!el) return;
  const current = el.value;
  const sorted = STATE.siswa.slice().sort((a,b) => (a.Nama||'').localeCompare(b.Nama||''));
  const alumni = (STATE.siswaLulus || []).slice().sort((a,b) => (a.Nama||'').localeCompare(b.Nama||''));
  el.innerHTML = '<option value="">Pilih siswa...</option>' + sorted.map(s => `<option value="${escapeHtml(s.ID)}">${escapeHtml(s.Nama)} — ${escapeHtml(s.Kelas)}</option>`).join('')
    + (alumni.length ? `<optgroup label="Siswa Lulus (Alumni)">${alumni.map(a => `<option value="${escapeHtml(a.SiswaID)}">${escapeHtml(a.Nama)} — Lulus ${escapeHtml(a.TahunLulus || '')}</option>`).join('')}</optgroup>` : '');
  el.value = current;
}

/* ---------------- KENAIKAN KELAS & KELULUSAN ----------------
   Halaman terpisah (di bawah menu Laporan) untuk dua aksi massal terhadap
   Data Siswa:
   1) Kenaikan Kelas — centang beberapa/semua siswa di satu Kelas Asal, lalu
      pindahkan sekaligus ke Kelas Tujuan (mis. VII-A -> VIII-A).
   2) Kelulusan — centang beberapa/semua siswa kelas akhir yang benar-benar
      sudah lulus, lalu keluarkan sekaligus dari Data Siswa (checkbox
      "Kelulusan Massal" = pilih semua siswa di kelas itu).
   Backend hanya mengizinkan Admin/Guru BK utama untuk kedua aksi ini (lihat
   assertIsAdmin di Code.gs), dan menu ini pun disembunyikan untuk Guru
   Mapel & Konselor di applyRoleUI(). */
function renderKenaikan(){
  const lt = $('#lulusTahun'); if (lt && !lt.value) lt.value = SCHOOL_YEAR || '';
  const classes = uniqueClasses();
  const kelasOptHtml = classes.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

  const naikAsal = $('#naikKelasAsal');
  if (naikAsal){
    const cur = naikAsal.value;
    naikAsal.innerHTML = '<option value="">Pilih kelas...</option>' + kelasOptHtml;
    naikAsal.value = cur;
  }
  const naikTujuan = $('#naikKelasTujuan');
  if (naikTujuan){
    const cur = naikTujuan.value;
    naikTujuan.innerHTML = '<option value="">Pilih kelas...</option>' + kelasOptHtml;
    naikTujuan.value = cur;
  }
  const lulusKelas = $('#lulusKelas');
  if (lulusKelas){
    const cur = lulusKelas.value;
    lulusKelas.innerHTML = '<option value="">Pilih kelas...</option>' + kelasOptHtml;
    lulusKelas.value = cur;
  }
  renderKenaikanSiswaList('naik', naikAsal ? naikAsal.value : '');
  renderKenaikanSiswaList('lulus', lulusKelas ? lulusKelas.value : '');
}

/* prefix: 'naik' atau 'lulus' — dipakai bersama karena kedua kartu (Kenaikan
   Kelas & Kelulusan) punya struktur checklist siswa per kelas yang identik. */
function renderKenaikanSiswaList(prefix, kelas){
  const list = $(`#${prefix}SiswaList`);
  const countEl = $(`#${prefix}Count`);
  const checkAll = $(`#${prefix}CheckAll`);
  if (!list) return;
  if (!kelas){
    list.innerHTML = `<p class="muted">Pilih kelas dahulu untuk menampilkan daftar siswa.</p>`;
    if (checkAll) checkAll.checked = false;
    if (countEl) countEl.textContent = 'Pilih kelas dahulu untuk menampilkan daftar siswa.';
    return;
  }
  const siswaKelas = STATE.siswa.filter(s => s.Kelas === kelas).sort((a,b) => (a.Nama||'').localeCompare(b.Nama||''));
  if (!siswaKelas.length){
    list.innerHTML = `<p class="muted">Tidak ada data siswa untuk kelas ini.</p>`;
    if (checkAll) checkAll.checked = false;
    if (countEl) countEl.textContent = 'Tidak ada data siswa untuk kelas ini.';
    return;
  }
  list.innerHTML = siswaKelas.map(s => `
    <label class="checkbox-pill bulk-item">
      <input type="checkbox" class="${prefix}-siswa-check" value="${escapeHtml(s.ID)}" checked />
      <span class="avatar-ring" style="width:24px;height:24px;font-size:9.5px;background:${colorFromString(s.Nama)}">${escapeHtml(initials(s.Nama))}</span>
      <span>${escapeHtml(s.Nama)} <span class="muted">· NIS ${escapeHtml(s.NIS||'-')}</span></span>
    </label>`).join('');
  if (checkAll) checkAll.checked = true;
  updateKenaikanCount(prefix);
}

function updateKenaikanCount(prefix){
  const countEl = $(`#${prefix}Count`);
  if (!countEl) return;
  const total = $all(`.${prefix}-siswa-check`).length;
  const checked = $all(`.${prefix}-siswa-check:checked`).length;
  countEl.textContent = total ? `${checked} dari ${total} siswa dicentang` : 'Tidak ada data siswa untuk kelas ini.';
}

/* --- Kenaikan Kelas --- */
$('#naikKelasAsal')?.addEventListener('change', e => renderKenaikanSiswaList('naik', e.target.value));
$('#naikCheckAll')?.addEventListener('change', e => {
  $all('.naik-siswa-check').forEach(cb => cb.checked = e.target.checked);
  updateKenaikanCount('naik');
});
$('#naikSiswaList')?.addEventListener('change', e => {
  if (e.target.classList.contains('naik-siswa-check')) updateKenaikanCount('naik');
});
$('#btnNaikkanKelas')?.addEventListener('click', async () => {
  const kelasAsal = $('#naikKelasAsal').value;
  const kelasTujuan = $('#naikKelasTujuan').value.trim();
  if (!kelasAsal){ toast('Pilih Kelas Asal terlebih dahulu.', 'error'); return; }
  if (!kelasTujuan){ toast('Kelas Tujuan wajib diisi.', 'error'); return; }
  const checkedIds = $all('.naik-siswa-check:checked').map(cb => cb.value);
  if (!checkedIds.length){ toast('Centang minimal satu siswa untuk dinaikkan kelasnya.', 'error'); return; }
  if (!confirm(`Naikkan ${checkedIds.length} siswa dari ${kelasAsal} ke ${kelasTujuan}?`)) return;

  showLoading(true);
  try{
    const result = await adapter.promoteSiswa(checkedIds, kelasTujuan);
    STATE.siswa.forEach(s => { if (checkedIds.includes(String(s.ID))) s.Kelas = kelasTujuan; });
    $('#naikKelasTujuan').value = '';
    populateClassFilters();
    renderKenaikan();
    renderDashboard();
    toast(`${result?.updated ?? checkedIds.length} siswa berhasil dinaikkan ke kelas ${kelasTujuan}.`, 'success');
  }catch(err){
    toast(err.message, 'error');
  }finally{
    showLoading(false);
  }
});

/* --- Kelulusan --- */
$('#lulusKelas')?.addEventListener('change', e => renderKenaikanSiswaList('lulus', e.target.value));
$('#lulusCheckAll')?.addEventListener('change', e => {
  $all('.lulus-siswa-check').forEach(cb => cb.checked = e.target.checked);
  updateKenaikanCount('lulus');
});
$('#lulusSiswaList')?.addEventListener('change', e => {
  if (e.target.classList.contains('lulus-siswa-check')) updateKenaikanCount('lulus');
});
$('#btnLuluskan')?.addEventListener('click', async () => {
  const kelas = $('#lulusKelas').value;
  if (!kelas){ toast('Pilih kelas terlebih dahulu.', 'error'); return; }
  const checkedIds = $all('.lulus-siswa-check:checked').map(cb => cb.value);
  if (!checkedIds.length){ toast('Centang minimal satu siswa untuk diluluskan.', 'error'); return; }
  const tahunLulus = ($('#lulusTahun')?.value || '').trim() || SCHOOL_YEAR || String(new Date().getFullYear());
  if (!confirm(`Luluskan ${checkedIds.length} siswa dari kelas ${kelas} (Tahun Lulus ${tahunLulus})? Siswa akan dikeluarkan dari Data Siswa dan dipindahkan ke laporan "Siswa Lulus". Riwayat BK mereka tetap tersimpan.`)) return;

  showLoading(true);
  try{
    const result = await adapter.lulusSiswa(checkedIds, tahunLulus);
    const tgl = new Date().toISOString().slice(0,10);
    STATE.siswa.filter(s => checkedIds.includes(String(s.ID))).forEach(s => {
      STATE.siswaLulus.push({ ID:'LUL-' + s.ID, SiswaID:s.ID, NIS:s.NIS, Nama:s.Nama, Kelas:s.Kelas, JenisKelamin:s.JenisKelamin,
        TempatTglLahir:s.TempatTglLahir, Alamat:s.Alamat, NamaOrtu:s.NamaOrtu, NoHPOrtu:s.NoHPOrtu, Catatan:s.Catatan,
        TahunLulus:tahunLulus, TanggalLulus:tgl });
    });
    STATE.siswa = STATE.siswa.filter(s => !checkedIds.includes(String(s.ID)));
    populateClassFilters();
    populateLulusTahunOptions();
    renderKenaikan();
    renderDashboard();
    toast(`${result?.deleted ?? checkedIds.length} siswa berhasil diluluskan dan masuk ke Laporan > Siswa Lulus.`, 'success');
  }catch(err){
    toast(err.message, 'error');
  }finally{
    showLoading(false);
  }
});

/* ---------------- NAVIGATION ---------------- */
function goToPage(page){
  currentPage = page;
  $all('.page').forEach(p => p.classList.remove('active'));
  $(`#page-${page}`)?.classList.add('active');
  $all('.nav-item[data-page]').forEach(n => n.classList.toggle('active', n.dataset.page === page));
  $all('.bn-item[data-page]').forEach(n => n.classList.toggle('active', n.dataset.page === page));
  const titles = { dashboard:'Dashboard', siswa:'Data Siswa', absensi:'Absensi', pelanggaran:'Pelanggaran', konseling:'Konseling', kolaborasi:'Kolaborasi', laporan:'Laporan', kenaikan:'Kenaikan & Kelulusan' };
  $('#pageTitle').textContent = titles[page] || page;
  closeMoreSheet();
  hideSearchDropdown();
  renderCurrentPage();
}
function renderCurrentPage(q){
  if (currentPage === 'dashboard') renderDashboard();
  if (currentPage === 'siswa') renderSiswa(q);
  if (currentPage === 'absensi') renderAbsensi(q);
  if (currentPage === 'pelanggaran') renderPelanggaran(q);
  if (currentPage === 'konseling') renderKonseling(q);
  if (currentPage === 'kolaborasi') renderKolaborasi(q);
  if (currentPage === 'kenaikan') renderKenaikan();
}

$all('.nav-item[data-page]').forEach(n => n.addEventListener('click', e => { e.preventDefault(); goToPage(n.dataset.page); }));
$all('.bn-item[data-page]').forEach(n => n.addEventListener('click', e => { e.preventDefault(); goToPage(n.dataset.page); }));

/* mobile more sheet */
function openMoreSheet(){ $('#moreSheet').classList.add('open'); $('#sheetBackdrop').classList.add('open'); }
function closeMoreSheet(){ $('#moreSheet').classList.remove('open'); $('#sheetBackdrop').classList.remove('open'); }
$('#bnMore').addEventListener('click', e => { e.preventDefault(); openMoreSheet(); });
$('#sheetBackdrop').addEventListener('click', closeMoreSheet);
$all('#moreSheet .nav-item[data-page]').forEach(n => n.addEventListener('click', e => { e.preventDefault(); goToPage(n.dataset.page); }));

$('#refreshBtn').addEventListener('click', loadAll);

/* ---------------- PENCARIAN GLOBAL ----------------
   Ketik di kotak pencarian atas untuk:
   1) Memfilter tabel/kartu di halaman yang sedang dibuka (siswa, absensi,
      pelanggaran, konseling, kolaborasi), dan
   2) Menampilkan dropdown hasil pencarian siswa lintas halaman — klik salah
      satu hasil untuk langsung membuka Laporan Individu siswa tersebut. */
$('#globalSearch').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  renderCurrentPage(q || undefined);
  if (!q || q.length < 2){ hideSearchDropdown(); return; }
  renderSearchDropdown(q);
});
$('#globalSearch').addEventListener('focus', e => {
  const q = e.target.value.trim().toLowerCase();
  if (q.length >= 2) renderSearchDropdown(q);
});
document.addEventListener('click', e => {
  if (!e.target.closest('.search-box') && !e.target.closest('#searchDropdown')) hideSearchDropdown();
});

function hideSearchDropdown(){ const el = $('#searchDropdown'); if (el) el.classList.remove('open'); }

function renderSearchDropdown(q){
  const dd = $('#searchDropdown');
  if (!dd) return;

  const matchSiswa = STATE.siswa.filter(s =>
    (s.Nama||'').toLowerCase().includes(q) || (s.NIS||'').toString().toLowerCase().includes(q) || (s.Kelas||'').toLowerCase().includes(q)
  ).slice(0, 6);

  const countsFor = (id) => ({
    absensiAlpa: STATE.absensi.filter(a => String(a.SiswaID)===String(id) && a.Status==='Alpa').length,
    pelanggaran: STATE.pelanggaran.filter(p => String(p.SiswaID)===String(id)).length,
    konseling: STATE.konseling.filter(k => String(k.SiswaID)===String(id)).length
  });

  if (!matchSiswa.length){
    dd.innerHTML = `<div class="search-dd-empty">Tidak ada siswa yang cocok dengan "${escapeHtml(q)}".</div>`;
  } else {
    dd.innerHTML = matchSiswa.map(s => {
      const c = countsFor(s.ID);
      return `<div class="search-dd-item">
        <span class="avatar-ring" style="width:28px;height:28px;font-size:10.5px;background:${colorFromString(s.Nama)}">${escapeHtml(initials(s.Nama))}</span>
        <span class="search-dd-info">
          <span class="search-dd-name">${escapeHtml(s.Nama)}</span>
          <span class="search-dd-sub">${escapeHtml(s.Kelas||'-')} · NIS ${escapeHtml(s.NIS||'-')} ${c.pelanggaran?`· ${c.pelanggaran} pelanggaran`:''} ${c.absensiAlpa?`· ${c.absensiAlpa}x alpa`:''}</span>
        </span>
        <span class="search-dd-actions">
          <button type="button" class="icon-btn-sm" data-quick-absensi="${escapeHtml(s.ID)}" title="Catat Absensi"><i class="fa-solid fa-calendar-check"></i></button>
          <button type="button" class="icon-btn-sm" data-goto-siswa="${escapeHtml(s.ID)}" title="Lihat Laporan"><i class="fa-solid fa-file-lines"></i></button>
        </span>
      </div>`;
    }).join('');
  }
  dd.classList.add('open');
}

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-goto-siswa]');
  if (btn){
    const id = btn.dataset.gotoSiswa;
    hideSearchDropdown();
    $('#globalSearch').value = '';
    goToPage('laporan');
    $('#reportType').value = 'individu';
    $('#reportType').dispatchEvent(new Event('change'));
    $('#reportSiswa').value = id;
    $('#btnGenerateReport').click();
    return;
  }
  const absBtn = e.target.closest('[data-quick-absensi]');
  if (absBtn){
    const id = absBtn.dataset.quickAbsensi;
    hideSearchDropdown();
    $('#globalSearch').value = '';
    goToPage('absensi');
    openForm('absensi', null, { SiswaID: id });
  }
});

/* ---------------- DROPDOWN JENIS PELANGGARAN (dari Template Pelanggaran) ---------------- */
document.addEventListener('change', e => {
  if (!e.target.classList.contains('jenis-pelanggaran-select')) return;
  const wrap = e.target.closest('.jenis-pelanggaran-picker');
  const hidden = wrap.querySelector('input[type=hidden]');
  const customInput = wrap.querySelector('.jenis-pelanggaran-custom');
  const form = wrap.closest('form');
  const poinInput = form ? form.querySelector('[name="Poin"]') : null;
  if (e.target.value === '__custom__'){
    customInput.classList.remove('hidden');
    customInput.value = '';
    hidden.value = '';
    customInput.focus();
  } else {
    customInput.classList.add('hidden');
    hidden.value = e.target.value;
    const opt = e.target.selectedOptions[0];
    const poin = opt ? opt.dataset.poin : '';
    if (poinInput && poin !== undefined && poin !== '') poinInput.value = poin;
  }
});
document.addEventListener('input', e => {
  if (!e.target.classList.contains('jenis-pelanggaran-custom')) return;
  const wrap = e.target.closest('.jenis-pelanggaran-picker');
  wrap.querySelector('input[type=hidden]').value = e.target.value;
});

/* ---------------- BUKTI FOTO HOME VISIT (Kolaborasi) ----------------
   Field foto cuma ditampilkan saat Jenis Kegiatan = "Home Visit", dan foto
   yang diupload otomatis diperkecil/dikompres (reuse resizeImageToDataUrl,
   dipakai juga oleh Logo Sekolah) supaya muat disimpan sebagai satu sel di
   Google Sheet maupun saat diekspor ke Excel lewat fitur Backup. */
document.addEventListener('change', e => {
  if (!(e.target.tagName === 'SELECT' && e.target.name === 'Jenis')) return;
  const form = e.target.closest('form');
  const wrap = form ? form.querySelector('[data-bukti-foto-wrap]') : null;
  if (wrap) wrap.style.display = (e.target.value === 'Home Visit') ? '' : 'none';
});
document.addEventListener('click', e => {
  const uploadBtn = e.target.closest('.bukti-foto-btn');
  if (uploadBtn){
    uploadBtn.closest('.bukti-foto-wrap').querySelector('.bukti-foto-file').click();
    return;
  }
  const removeBtn = e.target.closest('.bukti-foto-remove-btn');
  if (removeBtn){
    const wrap = removeBtn.closest('.bukti-foto-wrap');
    wrap.querySelector('.bukti-foto-preview-wrap').innerHTML = `<i class="fa-solid fa-camera"></i>`;
    wrap.querySelector('.bukti-foto-hidden').value = '';
    removeBtn.style.display = 'none';
    wrap.querySelector('.bukti-foto-btn').innerHTML = '<i class="fa-solid fa-upload"></i> Upload Foto';
  }
});
document.addEventListener('change', async e => {
  if (!e.target.classList.contains('bukti-foto-file')) return;
  const file = e.target.files[0];
  if (!file) return;
  const wrap = e.target.closest('.bukti-foto-wrap');
  if (!file.type.startsWith('image/')){ toast('File harus berupa gambar.', 'error'); e.target.value=''; return; }
  const btn = wrap.querySelector('.bukti-foto-btn');
  const originalLabel = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';
  try{
    // maxChars dijaga di bawah 32.767 (batas karakter per sel Excel), supaya
    // foto ini tetap aman diekspor lewat fitur Backup (Excel) tanpa terpotong/error.
    const dataUrl = await resizeImageToDataUrl(file, 420, 30000);
    wrap.querySelector('.bukti-foto-preview-wrap').innerHTML = `<img src="${escapeHtml(dataUrl)}" alt="Bukti Foto" />`;
    wrap.querySelector('.bukti-foto-hidden').value = dataUrl;
    wrap.querySelector('.bukti-foto-remove-btn').style.display = '';
    btn.innerHTML = '<i class="fa-solid fa-upload"></i> Ganti Foto';
  }catch(err){
    toast(err.message, 'error');
    btn.innerHTML = originalLabel;
  }finally{
    btn.disabled = false;
    e.target.value = '';
  }
});

/* ---------------- TANDA TANGAN / PARAF (Signature Pad) ----------------
   Dipakai di form Sesi Konseling supaya siswa bisa langsung tanda tangan
   atau paraf di layar (mouse/trackpad atau sentuh di HP/tablet) begitu
   sesi konseling selesai. Hasilnya disimpan sebagai gambar (PNG data URL)
   ke kolom tersembunyi TTD — persis seperti pola Bukti Foto Home Visit di
   atas — sehingga otomatis ikut tersimpan ke Google Sheet lewat createRow/
   updateRow yang sudah ada, dan otomatis ikut tampil di Laporan (kolom TTD,
   di sebelah Rencana Tindak Lanjut) tanpa perlu perubahan lain. */
function initSignaturePads(){
  $all('.signature-wrap .signature-canvas').forEach(canvas => {
    if (canvas.dataset.inited) return;
    canvas.dataset.inited = '1';
    const wrap = canvas.closest('.signature-wrap');
    const hidden = wrap.querySelector('.signature-hidden');
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || 300;
    const cssHeight = 150;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.height = cssHeight + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = '#1a2733';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    canvas._sigCtx = ctx;
    canvas._sigCssSize = { w: cssWidth, h: cssHeight };
    if (hidden.value){
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, cssWidth, cssHeight);
      img.src = hidden.value;
    }
  });
}
function signatureCanvasPos(canvas, evt){
  const rect = canvas.getBoundingClientRect();
  return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
}
function endSignatureStroke(canvas){
  if (!canvas || !canvas._sigDrawing) return;
  canvas._sigDrawing = false;
  const wrap = canvas.closest('.signature-wrap');
  wrap.querySelector('.signature-hidden').value = canvas.toDataURL('image/png');
}
document.addEventListener('pointerdown', e => {
  const canvas = e.target.closest('.signature-canvas');
  if (!canvas || !canvas._sigCtx) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  const pos = signatureCanvasPos(canvas, e);
  canvas._sigCtx.beginPath();
  canvas._sigCtx.moveTo(pos.x, pos.y);
  canvas._sigDrawing = true;
  const placeholder = canvas.closest('.signature-wrap').querySelector('.signature-placeholder');
  if (placeholder) placeholder.style.display = 'none';
});
document.addEventListener('pointermove', e => {
  const canvas = e.target.closest('.signature-canvas');
  if (!canvas || !canvas._sigDrawing) return;
  const pos = signatureCanvasPos(canvas, e);
  canvas._sigCtx.lineTo(pos.x, pos.y);
  canvas._sigCtx.stroke();
});
document.addEventListener('pointerup', e => endSignatureStroke(e.target.closest('.signature-canvas')));
document.addEventListener('pointercancel', e => endSignatureStroke(e.target.closest('.signature-canvas')));
document.addEventListener('click', e => {
  const clearBtn = e.target.closest('.signature-clear-btn');
  if (!clearBtn) return;
  const wrap = clearBtn.closest('.signature-wrap');
  const canvas = wrap.querySelector('.signature-canvas');
  if (canvas && canvas._sigCtx) canvas._sigCtx.clearRect(0, 0, canvas._sigCssSize.w, canvas._sigCssSize.h);
  wrap.querySelector('.signature-hidden').value = '';
  const placeholder = wrap.querySelector('.signature-placeholder');
  if (placeholder) placeholder.style.display = '';
});

/* ---------------- KOMBOBOX PENCARIAN SISWA (dipakai di semua form: absensi, pelanggaran, dst) ---------------- */
function siswaPickerFilter(wrap, query){
  const q = (query||'').trim().toLowerCase();
  const kelasSel = wrap.querySelector('.siswa-picker-kelas');
  const kelas = kelasSel ? kelasSel.value : '';
  let list = STATE.siswa;
  if (kelas) list = list.filter(s => s.Kelas === kelas);
  return list.filter(s => !q ||
    (s.Nama||'').toLowerCase().includes(q) ||
    (s.NIS||'').toString().toLowerCase().includes(q) ||
    (s.Kelas||'').toLowerCase().includes(q)
  ).slice(0, 50);
}
function siswaPickerRenderDropdown(wrap, query){
  const dd = wrap.querySelector('.siswa-picker-dropdown');
  const matches = siswaPickerFilter(wrap, query);
  dd.innerHTML = matches.length ? matches.map(s => `
      <button type="button" class="search-dd-item" data-pick-siswa="${escapeHtml(s.ID)}">
        <span class="avatar-ring" style="width:26px;height:26px;font-size:10px;background:${colorFromString(s.Nama)}">${escapeHtml(initials(s.Nama))}</span>
        <span class="search-dd-info"><span class="search-dd-name">${escapeHtml(s.Nama)}</span><span class="search-dd-sub">${escapeHtml(s.Kelas||'-')} · NIS ${escapeHtml(s.NIS||'-')}</span></span>
      </button>`).join('')
    : '<div class="search-dd-empty">Siswa tidak ditemukan untuk filter ini.</div>';
  dd.classList.add('open');
}
document.addEventListener('input', e => {
  if (!e.target.classList.contains('siswa-picker-input')) return;
  const wrap = e.target.closest('.siswa-picker');
  wrap.querySelector('input[type=hidden]').value = '';
  siswaPickerRenderDropdown(wrap, e.target.value);
});
document.addEventListener('focusin', e => {
  if (!e.target.classList.contains('siswa-picker-input')) return;
  const wrap = e.target.closest('.siswa-picker');
  siswaPickerRenderDropdown(wrap, e.target.value);
});
document.addEventListener('change', e => {
  if (!e.target.classList.contains('siswa-picker-kelas')) return;
  const wrap = e.target.closest('.siswa-picker');
  const input = wrap.querySelector('.siswa-picker-input');
  wrap.querySelector('input[type=hidden]').value = '';
  input.value = '';
  siswaPickerRenderDropdown(wrap, '');
  input.focus();
});
document.addEventListener('click', e => {
  const pickBtn = e.target.closest('[data-pick-siswa]');
  if (pickBtn && pickBtn.closest('.siswa-picker-dropdown')){
    const wrap = pickBtn.closest('.siswa-picker');
    const s = siswaById(pickBtn.dataset.pickSiswa);
    if (!s) return;
    wrap.querySelector('input[type=hidden]').value = s.ID;
    wrap.querySelector('.siswa-picker-input').value = `${s.Nama} — ${s.Kelas||'-'}`;
    wrap.querySelector('.siswa-picker-dropdown').classList.remove('open');
    return;
  }
  $all('.siswa-picker-dropdown.open').forEach(dd => {
    if (!dd.closest('.siswa-picker').contains(e.target)) dd.classList.remove('open');
  });
});

/* ---------------- DASHBOARD ---------------- */
function renderDashboard(){
  // Chart.js gagal (dan bisa "macet" sampai reload penuh) kalau dipaksa menggambar ke
  // canvas yang sedang disembunyikan (halaman Dashboard tidak sedang aktif). Jadi kalau
  // dipanggil dari halaman lain (mis. setelah simpan Absensi/Pelanggaran), cukup lewati —
  // grafik akan otomatis digambar ulang dengan data terbaru begitu Dashboard dibuka lagi.
  if (currentPage !== 'dashboard') return;

  $('#statSiswa').textContent = STATE.siswa.length;
  $('#statAlpa').textContent = STATE.absensi.filter(a => a.Status === 'Alpa' && isThisMonth(a.Tanggal)).length;
  $('#statPelanggaran').textContent = STATE.pelanggaran.filter(p => isThisMonth(p.Tanggal)).length;
  $('#statKonseling').textContent = STATE.konseling.filter(k => isThisMonth(k.Tanggal)).length;

  renderTrendChart();
  renderPelanggaranChart();
  renderAbsensiChart('chartAbsensi', STATE.absensi);
  renderActivityList();
}

function last6Months(){
  const out = [];
  const now = new Date();
  for (let i=5;i>=0;i--){
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    out.push({ label: d.toLocaleDateString('id-ID',{month:'short',year:'2-digit'}), y:d.getFullYear(), m:d.getMonth() });
  }
  return out;
}
function destroyChart(id){ if (charts[id]) { charts[id].destroy(); delete charts[id]; } }

function renderTrendChart(){
  const months = last6Months();
  const pelData = months.map(mo => STATE.pelanggaran.filter(p => { const d=new Date(p.Tanggal); return d.getFullYear()===mo.y && d.getMonth()===mo.m; }).length);
  const alpaData = months.map(mo => STATE.absensi.filter(a => a.Status==='Alpa' && (()=>{ const d=new Date(a.Tanggal); return d.getFullYear()===mo.y && d.getMonth()===mo.m; })()).length);
  destroyChart('trend');
  charts.trend = new Chart($('#chartTrend'), {
    type:'line',
    data:{ labels: months.map(m=>m.label), datasets:[
      { label:'Pelanggaran', data:pelData, borderColor:'#D9614F', backgroundColor:'rgba(217,97,79,.12)', tension:.35, fill:true },
      { label:'Alpa', data:alpaData, borderColor:'#2F6F63', backgroundColor:'rgba(47,111,99,.12)', tension:.35, fill:true }
    ]},
    options:{ responsive:true, plugins:{ legend:{ position:'bottom', labels:{ boxWidth:10, font:{ size:11 } } } }, scales:{ y:{ beginAtZero:true, ticks:{ precision:0 } } } }
  });
}

function renderPelanggaranChart(){
  const counts = {};
  STATE.pelanggaran.forEach(p => { counts[p.JenisPelanggaran || 'Lainnya'] = (counts[p.JenisPelanggaran || 'Lainnya']||0)+1; });
  const entries = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,6);
  destroyChart('pel');
  charts.pel = new Chart($('#chartPelanggaran'), {
    type:'bar',
    data:{ labels: entries.map(e=>e[0]), datasets:[{ data: entries.map(e=>e[1]), backgroundColor:'#E0932F', borderRadius:6, maxBarThickness:28 }] },
    options:{ indexAxis:'y', responsive:true, plugins:{ legend:{ display:false } }, scales:{ x:{ beginAtZero:true, ticks:{ precision:0 } } } }
  });
}

function renderAbsensiChart(canvasId, absensiData){
  const statuses = ['Hadir','Sakit','Izin','Alpa'];
  const colorMap = { Hadir:'#3E9A63', Sakit:'#3B7DD8', Izin:'#E0932F', Alpa:'#D9614F' };
  const counts = statuses.map(s => absensiData.filter(a=>a.Status===s).length);
  destroyChart(canvasId);
  const isDoughnut = canvasId === 'chartAbsensi';
  charts[canvasId] = new Chart($('#'+canvasId), {
    type: isDoughnut ? 'doughnut' : 'bar',
    data:{ labels: statuses, datasets:[{ data: counts, backgroundColor: statuses.map(s=>colorMap[s]), borderRadius: isDoughnut?0:6, borderWidth: isDoughnut?2:0, borderColor:'#fff' }] },
    options:{ responsive:true, plugins:{ legend:{ position: isDoughnut?'bottom':'display', labels:{ boxWidth:10, font:{size:11} } } }, scales: isDoughnut? {} : { y:{ beginAtZero:true, ticks:{precision:0} } } }
  });
}

function renderActivityList(){
  const items = [];
  STATE.pelanggaran.forEach(p => items.push({ t:p.Tanggal, html:`<b>${escapeHtml(p.Nama||'-')}</b> — pelanggaran: ${escapeHtml(p.JenisPelanggaran||'-')}`, color:'#D9614F' }));
  STATE.konseling.forEach(k => items.push({ t:k.Tanggal, html:`<b>${escapeHtml(k.Nama||'-')}</b> — sesi konseling: ${escapeHtml(k.Topik||'-')}`, color:'#3E9A63' }));
  STATE.kolaborasi.forEach(k => items.push({ t:k.Tanggal, html:`<b>${escapeHtml(k.Nama||'-')}</b> — ${escapeHtml(k.Jenis||'-')}`, color:'#3B7DD8' }));
  STATE.absensi.filter(a=>a.Status==='Alpa').forEach(a => items.push({ t:a.Tanggal, html:`<b>${escapeHtml(a.Nama||'-')}</b> — tidak hadir tanpa keterangan`, color:'#E0932F' }));
  items.sort((a,b) => new Date(b.t) - new Date(a.t));
  const list = $('#activityList');
  if (!items.length){ list.innerHTML = '<li class="muted" style="border:none;padding:20px 4px;text-align:center">Belum ada aktivitas.</li>'; return; }
  list.innerHTML = items.slice(0,8).map(it => `<li><span class="activity-dot" style="background:${it.color}"></span><div><div>${it.html}</div><div class="a-time">${fmtDate(it.t)}</div></div></li>`).join('');
}

/* ---------------- DATA SISWA ---------------- */
function renderSiswa(searchQuery){
  const kelas = $('#filterKelasSiswa').value;
  let rows = STATE.siswa.filter(s => !kelas || s.Kelas === kelas);
  if (searchQuery) rows = rows.filter(s =>
    (s.Nama||'').toLowerCase().includes(searchQuery) ||
    (s.NIS||'').toString().toLowerCase().includes(searchQuery) ||
    (s.NamaOrtu||'').toLowerCase().includes(searchQuery)
  );
  const tbody = $('#tableSiswa tbody');
  const emptyState = $('#page-siswa .empty-state');
  if (!rows.length){ tbody.innerHTML=''; emptyState.style.display='block'; return; }
  emptyState.style.display='none';
  tbody.innerHTML = rows.map(s => {
    const pelanggaranCount = STATE.pelanggaran.filter(p => String(p.SiswaID)===String(s.ID)).length;
    const status = pelanggaranCount >= 3 ? { txt:'Perlu Perhatian', cls:'danger' } : pelanggaranCount >= 1 ? { txt:'Pemantauan', cls:'amber' } : { txt:'Baik', cls:'success' };
    return `<tr>
      <td>${escapeHtml(s.NIS||'-')}</td>
      <td><div style="display:flex;align-items:center;gap:10px">
            <span class="avatar-ring" style="width:30px;height:30px;font-size:11px;background:${colorFromString(s.Nama)}">${escapeHtml(initials(s.Nama))}</span>
            ${escapeHtml(s.Nama||'-')}
          </div></td>
      <td>${escapeHtml(s.Kelas||'-')}</td>
      <td>${escapeHtml(s.JenisKelamin||'-')}</td>
      <td>${escapeHtml(s.NamaOrtu||'-')}</td>
      <td>${escapeHtml(s.NoHPOrtu||'-')}</td>
      <td><span class="badge badge--${status.cls}"><span class="badge-dot" style="background:currentColor"></span>${status.txt}</span></td>
      <td><div class="row-actions">
            <button class="icon-btn-sm" data-edit="siswa" data-id="${escapeHtml(s.ID)}"><i class="fa-solid fa-pen"></i></button>
            <button class="icon-btn-sm danger" data-del="siswa" data-id="${escapeHtml(s.ID)}"><i class="fa-solid fa-trash"></i></button>
          </div></td>
    </tr>`;
  }).join('');
}
$('#filterKelasSiswa').addEventListener('change', () => renderSiswa());

/* ---------------- ABSENSI ---------------- */
function renderAbsensi(searchQuery){
  const tgl = $('#filterTglAbsensi').value;
  const kelas = $('#filterKelasAbsensi').value;
  const status = $('#filterStatusAbsensi').value;
  let rows = STATE.absensi.filter(a => (!tgl || a.Tanggal===tgl) && (!kelas || a.Kelas===kelas) && (!status || a.Status===status));
  if (searchQuery) rows = rows.filter(a => (a.Nama||'').toLowerCase().includes(searchQuery) || (a.Keterangan||'').toLowerCase().includes(searchQuery));
  rows.sort((a,b)=> new Date(b.Tanggal)-new Date(a.Tanggal));
  renderAbsensiChart('chartAbsensiPage', rows);
  const tbody = $('#tableAbsensi tbody');
  const emptyState = $('#page-absensi .empty-state');
  if (!rows.length){ tbody.innerHTML=''; emptyState.style.display='block'; return; }
  emptyState.style.display='none';
  const badgeCls = { Hadir:'success', Sakit:'info', Izin:'amber', Alpa:'danger' };
  tbody.innerHTML = rows.map(a => `<tr>
      <td>${fmtDate(a.Tanggal)}</td><td>${escapeHtml(a.Nama||'-')}</td><td>${escapeHtml(a.Kelas||'-')}</td>
      <td><span class="badge badge--${badgeCls[a.Status]||'muted'}">${escapeHtml(a.Status||'-')}</span></td>
      <td>${escapeHtml(a.Keterangan||'-')}</td>
      <td><div class="row-actions">
        <button class="icon-btn-sm wa" data-wa="${escapeHtml(a.ID)}" title="Kirim WA ke orang tua"><i class="fa-brands fa-whatsapp"></i></button>
        <button class="icon-btn-sm" data-edit="absensi" data-id="${escapeHtml(a.ID)}"><i class="fa-solid fa-pen"></i></button>
        <button class="icon-btn-sm danger" data-del="absensi" data-id="${escapeHtml(a.ID)}"><i class="fa-solid fa-trash"></i></button>
      </div></td></tr>`).join('');
}
['#filterTglAbsensi','#filterKelasAbsensi','#filterStatusAbsensi'].forEach(sel => $(sel).addEventListener('change', renderAbsensi));

/* ---------------- PELANGGARAN ---------------- */
function renderPelanggaran(searchQuery){
  const kelas = $('#filterKelasPelanggaran').value;
  const bulan = $('#filterBulanPelanggaran').value; // yyyy-mm
  let rows = STATE.pelanggaran.filter(p => (!kelas || p.Kelas===kelas) && (!bulan || (p.Tanggal||'').startsWith(bulan)));
  if (searchQuery) rows = rows.filter(p => (p.Nama||'').toLowerCase().includes(searchQuery) || (p.JenisPelanggaran||'').toLowerCase().includes(searchQuery));
  rows.sort((a,b)=> new Date(b.Tanggal)-new Date(a.Tanggal));
  const tbody = $('#tablePelanggaran tbody');
  const emptyState = $('#page-pelanggaran .empty-state');
  if (!rows.length){ tbody.innerHTML=''; emptyState.style.display='block'; return; }
  emptyState.style.display='none';
  tbody.innerHTML = rows.map(p => `<tr>
      <td>${fmtDate(p.Tanggal)}</td><td>${escapeHtml(p.Nama||'-')}</td><td>${escapeHtml(p.Kelas||'-')}</td>
      <td>${escapeHtml(p.JenisPelanggaran||'-')}</td>
      <td><span class="badge badge--danger">${escapeHtml(p.Poin||0)} poin</span></td>
      <td>${escapeHtml(p.Penanganan||'-')}</td>
      <td><div class="row-actions">
        <button class="icon-btn-sm" data-edit="pelanggaran" data-id="${escapeHtml(p.ID)}"><i class="fa-solid fa-pen"></i></button>
        <button class="icon-btn-sm danger" data-del="pelanggaran" data-id="${escapeHtml(p.ID)}"><i class="fa-solid fa-trash"></i></button>
      </div></td></tr>`).join('');
}
['#filterKelasPelanggaran','#filterBulanPelanggaran'].forEach(sel => $(sel).addEventListener('change', renderPelanggaran));

/* ---------------- KONSELING (card list) ---------------- */
/* Untuk tampilan Konseling, identitas siswa ditampilkan sebagai NIS (bukan Nama)
   supaya lebih ringkas & sesuai kebutuhan sekolah — diambil dari data Siswa yang
   masih aktif lewat SiswaID, dengan fallback aman kalau siswa itu sudah dihapus. */
function konselingDisplayNis(k){
  const s = siswaById(k.SiswaID);
  if (s && s.NIS) return s.NIS;
  return k.NIS || '-';
}

function renderKonseling(searchQuery){
  const kelas = $('#filterKelasKonseling').value;
  let rows = STATE.konseling.filter(k => !kelas || k.Kelas===kelas);
  if (searchQuery) rows = rows.filter(k => (k.Nama||'').toLowerCase().includes(searchQuery) || (k.Topik||'').toLowerCase().includes(searchQuery) || konselingDisplayNis(k).toLowerCase().includes(searchQuery));
  rows.sort((a,b)=> new Date(b.Tanggal)-new Date(a.Tanggal));
  const list = $('#listKonseling');
  $('#emptyKonseling').style.display = rows.length ? 'none' : 'block';
  list.innerHTML = rows.map(k => `
    <div class="entry-card">
      <div class="entry-card-head">
        <div class="entry-avatar-row">
          <span class="avatar-ring" style="background:${colorFromString(k.Nama)}">${escapeHtml(initials(k.Nama))}</span>
          <div><div class="entry-name">${escapeHtml(konselingDisplayNis(k))}</div><div class="entry-sub">${escapeHtml(k.Kelas||'-')} · ${escapeHtml(k.Topik||'Konseling')}</div></div>
        </div>
        <div class="row-actions">
          <button class="icon-btn-sm" data-edit="konseling" data-id="${escapeHtml(k.ID)}"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn-sm danger" data-del="konseling" data-id="${escapeHtml(k.ID)}"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
      <div class="entry-body">
        <p><b>Masalah:</b> ${escapeHtml(k.Masalah||'-')}</p>
        <p><b>Hasil:</b> ${escapeHtml(k.HasilKonseling||'-')}</p>
        <p><b>Tindak lanjut:</b> ${escapeHtml(k.TindakLanjut||'-')}</p>
        ${k.TTD ? `<p style="margin-top:8px"><b>TTD Siswa:</b><br/><img src="${escapeHtml(k.TTD)}" alt="Tanda Tangan Siswa" class="signature-thumb" data-lightbox-src="${escapeHtml(k.TTD)}" title="Klik untuk perbesar" /></p>` : ''}
      </div>
      <div class="entry-foot"><span class="entry-date">${fmtDate(k.Tanggal)}</span><span class="entry-sub">${escapeHtml(k.Konselor||'')}</span></div>
    </div>`).join('');
}
$('#filterKelasKonseling').addEventListener('change', renderKonseling);

/* ---------------- KOLABORASI (card list) ---------------- */
function renderKolaborasi(searchQuery){
  const jenis = $('#filterJenisKolaborasi').value;
  let rows = STATE.kolaborasi.filter(k => !jenis || k.Jenis===jenis);
  if (searchQuery) rows = rows.filter(k => (k.Nama||'').toLowerCase().includes(searchQuery) || (k.Jenis||'').toLowerCase().includes(searchQuery));
  rows.sort((a,b)=> new Date(b.Tanggal)-new Date(a.Tanggal));
  const list = $('#listKolaborasi');
  $('#emptyKolaborasi').style.display = rows.length ? 'none' : 'block';
  list.innerHTML = rows.map(k => `
    <div class="entry-card">
      <div class="entry-card-head">
        <div class="entry-avatar-row">
          <span class="avatar-ring" style="background:${colorFromString(k.Nama)}">${escapeHtml(initials(k.Nama))}</span>
          <div><div class="entry-name">${escapeHtml(k.Nama||'-')}</div><div class="entry-sub">${escapeHtml(k.Kelas||'-')}</div></div>
        </div>
        <div class="row-actions">
          <button class="icon-btn-sm" data-edit="kolaborasi" data-id="${escapeHtml(k.ID)}"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn-sm danger" data-del="kolaborasi" data-id="${escapeHtml(k.ID)}"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
      <div class="entry-body">
        <p><span class="badge badge--info">${escapeHtml(k.Jenis||'-')}</span></p>
        <p style="margin-top:8px"><b>Tujuan:</b> ${escapeHtml(k.Tujuan||'-')}</p>
        <p><b>Hasil:</b> ${escapeHtml(k.Hasil||'-')}</p>
        ${k.BuktiFoto ? `<p style="margin-top:8px"><b>Bukti Home Visit:</b><br/><img src="${escapeHtml(k.BuktiFoto)}" alt="Bukti Home Visit" class="bukti-foto-thumb" data-lightbox-id="${escapeHtml(k.ID)}" title="Klik untuk perbesar" /></p>` : ''}
      </div>
      <div class="entry-foot"><span class="entry-date">${fmtDate(k.Tanggal)}</span><span class="entry-sub">${escapeHtml(k.Petugas||'')}</span></div>
    </div>`).join('');
}
$('#filterJenisKolaborasi').addEventListener('change', renderKolaborasi);

/* ---------------- IMAGE LIGHTBOX (perbesar foto bukti, tidak buka tab baru) ----------------
   Dipakai untuk foto Bukti Home Visit — baik di kartu Kolaborasi maupun di
   halaman Laporan. Klik thumbnail untuk membuka, scroll/tombol untuk
   zoom in-out, klik area gelap / tombol X / Esc untuk menutup. */
let lightboxScale = 1;
const LIGHTBOX_MIN = 1, LIGHTBOX_MAX = 4, LIGHTBOX_STEP = 0.5;
function openImageLightbox(src){
  if (!src) return;
  $('#lightboxImg').src = src;
  setLightboxScale(1);
  $('#lightboxBackdrop').classList.add('open');
}
function closeImageLightbox(){
  $('#lightboxBackdrop').classList.remove('open');
  $('#lightboxImg').src = '';
}
function setLightboxScale(scale){
  lightboxScale = Math.min(LIGHTBOX_MAX, Math.max(LIGHTBOX_MIN, scale));
  const img = $('#lightboxImg');
  img.style.transform = `scale(${lightboxScale})`;
  img.classList.toggle('zoomed', lightboxScale > 1);
}
document.addEventListener('click', e => {
  const trigger = e.target.closest('[data-lightbox-id]');
  if (trigger){
    const k = STATE.kolaborasi.find(o => String(o.ID) === String(trigger.dataset.lightboxId));
    if (k && k.BuktiFoto) openImageLightbox(k.BuktiFoto);
    return;
  }
  const trigger2 = e.target.closest('[data-lightbox-src]');
  if (trigger2){ openImageLightbox(trigger2.dataset.lightboxSrc); }
});
$('#lightboxImg').addEventListener('click', () => setLightboxScale(lightboxScale > 1 ? 1 : 2));
$('#lightboxZoomIn').addEventListener('click', () => setLightboxScale(lightboxScale + LIGHTBOX_STEP));
$('#lightboxZoomOut').addEventListener('click', () => setLightboxScale(lightboxScale - LIGHTBOX_STEP));
$('#lightboxReset').addEventListener('click', () => setLightboxScale(1));
$('#lightboxClose').addEventListener('click', closeImageLightbox);
$('#lightboxBackdrop').addEventListener('click', e => { if (e.target.id === 'lightboxBackdrop') closeImageLightbox(); });
$('#lightboxBackdrop').addEventListener('wheel', e => {
  if (!$('#lightboxBackdrop').classList.contains('open')) return;
  e.preventDefault();
  setLightboxScale(lightboxScale + (e.deltaY < 0 ? LIGHTBOX_STEP : -LIGHTBOX_STEP));
}, { passive:false });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#lightboxBackdrop').classList.contains('open')) closeImageLightbox();
});

/* ---------------- ROW ACTION DELEGATION (edit/delete) ---------------- */
/* Konselor (Guru BK) sekarang boleh mengubah/menghapus bukan cuma Konseling,
   tapi juga Kolaborasi, Absensi, dan Pelanggaran — selaras dengan
   ROLE_WRITABLE_TYPES.konselor di backend. Pembatasan sesungguhnya (per
   kelas tanggung jawab) tetap ditegakkan di server; validasi di sini murni
   supaya tombol edit/delete tidak memunculkan form untuk tipe yang memang
   tidak boleh diakses konselor sama sekali (mis. Data Siswa). */
const KONSELOR_WRITABLE_TYPES_UI = ['konseling', 'kolaborasi', 'absensi', 'pelanggaran'];
document.addEventListener('click', async (e) => {
  const editBtn = e.target.closest('[data-edit]');
  const delBtn = e.target.closest('[data-del]');
  const waBtn = e.target.closest('[data-wa]');
  if (waBtn){ openWaForAbsen(waBtn.dataset.wa); return; }
  if ((editBtn || delBtn) && USER_ROLE === 'konselor'){
    const t = (editBtn || delBtn).dataset.edit || (editBtn || delBtn).dataset.del;
    if (!KONSELOR_WRITABLE_TYPES_UI.includes(t)){
      toast('Akun Guru BK (Konselor) tidak bisa mengubah/menghapus data ini.', 'error');
      return;
    }
  }
  if (editBtn) openForm(editBtn.dataset.edit, editBtn.dataset.id);
  if (delBtn){
    const type = delBtn.dataset.del, id = delBtn.dataset.id;
    if (!confirm('Yakin ingin menghapus data ini? Tindakan ini tidak dapat dibatalkan.')) return;
    showLoading(true);
    try{
      await adapter.delete(type, id);
      STATE[type] = STATE[type].filter(o => String(o.ID) !== String(id));
      renderCurrentPage(); renderDashboard(); populateClassFilters();
      toast('Data berhasil dihapus.', 'success');
    }catch(err){ toast(err.message, 'error'); }
    finally{ showLoading(false); }
  }
});

/* ---------------- FORM CONFIG ---------------- */
function siswaSelectOptions(selectedId){
  return STATE.siswa.map(s => `<option value="${s.ID}" ${String(s.ID)===String(selectedId)?'selected':''}>${s.Nama} — ${s.Kelas}</option>`).join('');
}

const FORM_CONFIG = {
  siswa: {
    title: 'Data Siswa',
    fields: [
      { key:'NIS', label:'NIS', type:'text', required:true },
      { key:'Nama', label:'Nama Lengkap', type:'text', required:true },
      { key:'Kelas', label:'Kelas', type:'text', required:true, placeholder:'contoh: VIII-A' },
      { key:'JenisKelamin', label:'Jenis Kelamin', type:'select', options:['L','P'] },
      { key:'TempatTglLahir', label:'Tempat, Tgl Lahir', type:'text' },
      { key:'NamaOrtu', label:'Nama Orang Tua/Wali', type:'text' },
      { key:'NoHPOrtu', label:'No. HP Orang Tua', type:'text' },
      { key:'Alamat', label:'Alamat', type:'textarea', full:true },
      { key:'Catatan', label:'Catatan Khusus', type:'textarea', full:true }
    ]
  },
  absensi: {
    title: 'Absensi Siswa',
    fields: [
      { key:'Tanggal', label:'Tanggal', type:'date', required:true, default: () => new Date().toISOString().slice(0,10) },
      { key:'SiswaID', label:'Siswa', type:'select-siswa', required:true, full:true },
      { key:'Status', label:'Status', type:'select', options:['Hadir','Sakit','Izin','Alpa'], required:true },
      { key:'Keterangan', label:'Keterangan', type:'textarea', full:true }
    ]
  },
  pelanggaran: {
    title: 'Pelanggaran Siswa',
    fields: [
      { key:'Tanggal', label:'Tanggal', type:'date', required:true, default: () => new Date().toISOString().slice(0,10) },
      { key:'SiswaID', label:'Siswa', type:'select-siswa', required:true, full:true },
      { key:'JenisPelanggaran', label:'Jenis Pelanggaran', type:'select-jenis-pelanggaran', required:true, full:true },
      { key:'Poin', label:'Poin Pelanggaran', type:'number' },
      { key:'Keterangan', label:'Keterangan', type:'textarea', full:true },
      { key:'Penanganan', label:'Penanganan', type:'textarea', full:true }
    ]
  },
  konseling: {
    title: 'Sesi Konseling',
    fields: [
      { key:'Tanggal', label:'Tanggal', type:'date', required:true, default: () => new Date().toISOString().slice(0,10) },
      { key:'SiswaID', label:'Siswa', type:'select-siswa', required:true, full:true },
      { key:'Topik', label:'Topik', type:'text', required:true },
      { key:'Konselor', label:'Konselor / Guru BK', type:'text', default: () => (USER_ROLE === 'konselor' ? KONSELOR_NAMA : '') },
      { key:'Masalah', label:'Uraian Masalah', type:'textarea', full:true },
      { key:'HasilKonseling', label:'Hasil Konseling', type:'textarea', full:true },
      { key:'TindakLanjut', label:'Rencana Tindak Lanjut', type:'textarea', full:true },
      { key:'TTD', label:'Tanda Tangan / Paraf Siswa', type:'signature-pad', full:true }
    ]
  },
  kolaborasi: {
    title: 'Kolaborasi (Panggilan Ortu / Home Visit)',
    fields: [
      { key:'Tanggal', label:'Tanggal', type:'date', required:true, default: () => new Date().toISOString().slice(0,10) },
      { key:'SiswaID', label:'Siswa', type:'select-siswa', required:true, full:true },
      { key:'Jenis', label:'Jenis Kegiatan', type:'select', options:['Pemanggilan Orang Tua','Home Visit'], required:true },
      { key:'Petugas', label:'Petugas BK', type:'text', default: () => (USER_ROLE === 'konselor' ? KONSELOR_NAMA : '') },
      { key:'Tujuan', label:'Tujuan Kegiatan', type:'textarea', full:true },
      { key:'Hasil', label:'Hasil / Kesepakatan', type:'textarea', full:true },
      { key:'BuktiFoto', label:'Bukti Foto Home Visit', type:'photo-buktihomevisit', full:true }
    ]
  }
};

/* ---------------- MODAL FORM ---------------- */
function openForm(type, id, prefill){
  const cfg = FORM_CONFIG[type];
  const existing = id ? STATE[type].find(o => String(o.ID)===String(id)) : null;
  $('#modalTitle').textContent = (existing ? 'Edit ' : 'Tambah ') + cfg.title;

  const fieldsHtml = cfg.fields.map(f => {
    const val = existing ? (existing[f.key] ?? '')
      : (prefill && prefill[f.key] !== undefined ? prefill[f.key]
      : (typeof f.default==='function' ? f.default() : ''));
    const wrapClass = 'field' + (f.full ? ' full' : '');
    if (f.type === 'select-jenis-pelanggaran'){
      const master = (STATE.masterPelanggaran||[]).slice().sort((a,b)=>(a.JenisPelanggaran||'').localeCompare(b.JenisPelanggaran||''));
      const matched = master.find(m => m.JenisPelanggaran === val);
      const isCustom = !!val && !matched;
      return `<div class="${wrapClass}"><label>${f.label}</label>
        <div class="jenis-pelanggaran-picker">
          <select class="jenis-pelanggaran-select" ${master.length ? '' : 'disabled'}>
            <option value="">${master.length ? 'Pilih jenis pelanggaran...' : 'Belum ada Template Pelanggaran'}</option>
            ${master.map(m => `<option value="${escapeHtml(m.JenisPelanggaran)}" data-poin="${escapeHtml(String(m.Poin ?? ''))}" ${m.JenisPelanggaran===val?'selected':''}>${escapeHtml(m.JenisPelanggaran)} (${escapeHtml(String(m.Poin ?? 0))} poin)</option>`).join('')}
            <option value="__custom__" ${isCustom?'selected':''}>+ Jenis lainnya (ketik manual)</option>
          </select>
          <input type="text" class="jenis-pelanggaran-custom${isCustom?'':' hidden'}" placeholder="Ketik jenis pelanggaran lainnya..." value="${isCustom?escapeHtml(val):''}" />
          <input type="hidden" name="${f.key}" value="${escapeHtml(val||'')}" />
        </div>
        <p class="muted" style="margin-top:6px;font-size:11.5px">Daftar bisa diatur lewat tombol "Template Pelanggaran" di halaman Pelanggaran.</p>
      </div>`;
    }
    if (f.type === 'photo-buktihomevisit'){
      const hasPhoto = !!val;
      // Field ini cuma relevan untuk Jenis = "Home Visit" — dicek dari data yang sudah
      // ada (mode edit) atau prefill, supaya kalau sedang mengedit catatan Home Visit,
      // field foto langsung kelihatan tanpa harus ganti-ganti dropdown Jenis dulu.
      const jenisVal = existing ? (existing.Jenis || '') : (prefill && prefill.Jenis !== undefined ? prefill.Jenis : '');
      const showNow = jenisVal === 'Home Visit';
      return `<div class="${wrapClass} bukti-foto-wrap" data-bukti-foto-wrap style="${showNow ? '' : 'display:none'}">
        <label>${f.label}</label>
        <div class="logo-upload-row">
          <div class="logo-preview bukti-foto-preview-wrap" style="width:90px;height:90px">
            ${hasPhoto ? `<img src="${escapeHtml(val)}" alt="Bukti Foto" />` : `<i class="fa-solid fa-camera"></i>`}
          </div>
          <div class="logo-upload-actions">
            <input type="file" class="hidden bukti-foto-file" accept="image/*" />
            <button class="btn btn-ghost bukti-foto-btn" type="button"><i class="fa-solid fa-upload"></i> ${hasPhoto?'Ganti Foto':'Upload Foto'}</button>
            <button class="btn btn-ghost bukti-foto-remove-btn" type="button" style="${hasPhoto?'':'display:none'}"><i class="fa-solid fa-trash"></i> Hapus</button>
          </div>
        </div>
        <input type="hidden" name="${f.key}" class="bukti-foto-hidden" value="${escapeHtml(val||'')}" />
        <p class="muted" style="margin-top:6px;font-size:11.5px">Sebagai bukti kunjungan Home Visit sudah dilaksanakan. Foto otomatis diperkecil &amp; dikompres.</p>
      </div>`;
    }
    if (f.type === 'signature-pad'){
      const hasSig = !!val;
      return `<div class="${wrapClass} signature-wrap" data-signature-wrap>
        <label>${f.label}</label>
        <div class="signature-pad-box">
          <canvas class="signature-canvas"></canvas>
          <span class="signature-placeholder" style="${hasSig ? 'display:none' : ''}">Tanda tangan / paraf di sini...</span>
        </div>
        <div class="signature-actions">
          <button class="btn btn-ghost signature-clear-btn" type="button"><i class="fa-solid fa-eraser"></i> Hapus</button>
        </div>
        <input type="hidden" name="${f.key}" class="signature-hidden" value="${escapeHtml(val||'')}" />
        <p class="muted" style="margin-top:6px;font-size:11.5px">Minta siswa tanda tangan atau paraf di kotak ini setelah sesi konseling selesai. TTD ini akan ikut tampil di Laporan, di sebelah Rencana Tindak Lanjut.</p>
      </div>`;
    }
    if (f.type === 'select'){
      return `<div class="${wrapClass}"><label>${f.label}</label>
        <select name="${f.key}" ${f.required?'required':''}>
          <option value="">Pilih...</option>
          ${f.options.map(o=>`<option value="${o}" ${o===val?'selected':''}>${o}</option>`).join('')}
        </select></div>`;
    }
    if (f.type === 'select-siswa'){
      const selSiswa = val ? siswaById(val) : null;
      const displayVal = selSiswa ? `${selSiswa.Nama} — ${selSiswa.Kelas||'-'}` : '';
      const kelasOpts = uniqueClasses().map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
      return `<div class="${wrapClass}"><label>${f.label}</label>
        <div class="siswa-picker">
          <div class="siswa-picker-row">
            <select class="siswa-picker-kelas" title="Filter kelas"><option value="">Semua Kelas</option>${kelasOpts}</select>
            <input type="text" class="siswa-picker-input" autocomplete="off" placeholder="Ketik nama, NIS, atau kelas siswa..." value="${escapeHtml(displayVal)}" />
          </div>
          <input type="hidden" name="${f.key}" value="${escapeHtml(val||'')}" />
          <div class="siswa-picker-dropdown search-dropdown"></div>
        </div></div>`;
    }
    if (f.type === 'textarea'){
      return `<div class="${wrapClass}"><label>${f.label}</label><textarea name="${f.key}">${escapeHtml(val||'')}</textarea></div>`;
    }
    return `<div class="${wrapClass}"><label>${f.label}</label><input type="${f.type}" name="${f.key}" value="${escapeHtml(val||'')}" ${f.placeholder?`placeholder="${escapeHtml(f.placeholder)}"`:''} ${f.required?'required':''} /></div>`;
  }).join('');

  $('#modalBody').innerHTML = `
    <form id="entityForm">
      <div class="form-grid">${fieldsHtml}</div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="formCancel">Batal</button>
        <button type="submit" class="btn btn-primary"><i class="fa-solid fa-check"></i> Simpan</button>
      </div>
    </form>`;

  initSignaturePads();
  $('#formCancel').addEventListener('click', closeModal);
  $('#entityForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {};
    cfg.fields.forEach(f => {
      if (f.type === 'checkbox-group'){ data[f.key] = fd.getAll(f.key).join(', '); }
      else if (f.type === 'checkbox'){ data[f.key] = fd.get(f.key) ? 'Ya' : ''; }
      else { data[f.key] = fd.get(f.key) || ''; }
    });
    if (data.SiswaID !== undefined){
      const s = siswaById(data.SiswaID);
      if (s){ data.Nama = s.Nama; data.Kelas = s.Kelas; }
    }
    // Kalau Jenis Kegiatan bukan Home Visit, jangan ikut kirim foto (mis. sisa upload
    // sebelum pengguna berganti pikiran memilih Jenis lain) — supaya tidak menyimpan
    // data foto yang tidak relevan dengan Pemanggilan Orang Tua.
    if (type === 'kolaborasi' && data.Jenis !== 'Home Visit'){ data.BuktiFoto = ''; }
    const missingSiswa = cfg.fields.find(f => f.type === 'select-siswa' && f.required && !data[f.key]);
    if (missingSiswa){ toast(`${missingSiswa.label} wajib dipilih — ketik nama lalu klik salah satu hasil.`, 'error'); return; }
    const missingJenis = cfg.fields.find(f => f.type === 'select-jenis-pelanggaran' && f.required && !data[f.key]);
    if (missingJenis){ toast(`${missingJenis.label} wajib dipilih atau diisi.`, 'error'); return; }
    showLoading(true);
    try{
      if (existing){
        const updated = await adapter.update(type, existing.ID, data);
        const idx = STATE[type].findIndex(o=>String(o.ID)===String(existing.ID));
        STATE[type][idx] = { ...existing, ...updated, ...data, ID: existing.ID };
        toast('Data berhasil diperbarui.', 'success');
      }else{
        const created = await adapter.create(type, data);
        STATE[type].push({ ...data, ...created });
        toast('Data berhasil disimpan.', 'success');
      }
      closeModal();
      populateClassFilters();
      renderCurrentPage();
      renderDashboard();
    }catch(err){
      toast(err.message, 'error');
    }finally{
      showLoading(false);
    }
  });

  openModal();
}

function openModal(){ $('#modalBackdrop').classList.add('open'); }
function closeModal(){ $('#modalBackdrop').classList.remove('open'); }

/* ---------------- ABSEN MASSAL PER KELAS ----------------
   Fitur tambahan di halaman Absensi: centang beberapa siswa sekaligus (mis. satu
   kelas masuk semua), pilih satu status, lalu simpan sekaligus. Tidak mengubah
   tampilan/alur "Catat Absensi" satu-per-satu yang sudah ada — ini murni tombol
   tambahan di sebelahnya. */
function openBulkAbsensi(){
  $('#modalTitle').textContent = 'Absen Massal per Kelas';
  const today = new Date().toISOString().slice(0,10);
  const kelasOpts = uniqueClasses().map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

  $('#modalBody').innerHTML = `
    <form id="bulkAbsensiForm">
      <div class="form-grid">
        <div class="field"><label>Tanggal</label><input type="date" id="bulkTanggal" value="${today}" required /></div>
        <div class="field"><label>Kelas</label>
          <select id="bulkKelas" required><option value="">Pilih kelas...</option>${kelasOpts}</select>
        </div>
        <div class="field"><label>Status untuk siswa yang dicentang</label>
          <select id="bulkStatus" required>
            <option value="">Pilih...</option>
            <option value="Hadir">Hadir</option>
            <option value="Sakit">Sakit</option>
            <option value="Izin">Izin</option>
            <option value="Alpa">Alpa</option>
          </select>
        </div>
        <div class="field"><label>Keterangan (opsional, berlaku untuk semua yang dicentang)</label>
          <input type="text" id="bulkKeterangan" placeholder="Contoh: -" />
        </div>
      </div>
      <div class="bulk-list-head">
        <label class="checkbox-pill"><input type="checkbox" id="bulkCheckAll" /> Pilih Semua</label>
        <span class="muted" id="bulkCount">Pilih kelas dahulu untuk menampilkan daftar siswa.</span>
      </div>
      <div class="bulk-siswa-list" id="bulkSiswaList"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="bulkCancel">Batal</button>
        <button type="submit" class="btn btn-primary"><i class="fa-solid fa-check"></i> Simpan Semua</button>
      </div>
    </form>`;

  function updateBulkCount(){
    const total = $all('.bulk-siswa-check').length;
    const checked = $all('.bulk-siswa-check:checked').length;
    $('#bulkCount').textContent = total ? `${checked} dari ${total} siswa dicentang` : 'Pilih kelas dahulu untuk menampilkan daftar siswa.';
  }
  function renderBulkList(kelas){
    const list = $('#bulkSiswaList');
    const siswaKelas = STATE.siswa.filter(s => s.Kelas === kelas).sort((a,b)=>(a.Nama||'').localeCompare(b.Nama||''));
    if (!siswaKelas.length){
      list.innerHTML = `<p class="muted">Tidak ada data siswa untuk kelas ini.</p>`;
      $('#bulkCheckAll').checked = false;
      updateBulkCount();
      return;
    }
    list.innerHTML = siswaKelas.map(s => `
      <label class="checkbox-pill bulk-item">
        <input type="checkbox" class="bulk-siswa-check" value="${escapeHtml(s.ID)}" checked />
        <span class="avatar-ring" style="width:24px;height:24px;font-size:9.5px;background:${colorFromString(s.Nama)}">${escapeHtml(initials(s.Nama))}</span>
        <span>${escapeHtml(s.Nama)} <span class="muted">· NIS ${escapeHtml(s.NIS||'-')}</span></span>
      </label>`).join('');
    $('#bulkCheckAll').checked = true;
    updateBulkCount();
  }

  $('#bulkKelas').addEventListener('change', e => renderBulkList(e.target.value));
  $('#bulkCheckAll').addEventListener('change', e => {
    $all('.bulk-siswa-check').forEach(cb => cb.checked = e.target.checked);
    updateBulkCount();
  });
  $('#bulkSiswaList').addEventListener('change', e => {
    if (e.target.classList.contains('bulk-siswa-check')) updateBulkCount();
  });
  $('#bulkCancel').addEventListener('click', closeModal);

  $('#bulkAbsensiForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const tanggal = $('#bulkTanggal').value;
    const kelas = $('#bulkKelas').value;
    const status = $('#bulkStatus').value;
    const keterangan = $('#bulkKeterangan').value || '';
    if (!tanggal || !kelas || !status){ toast('Tanggal, kelas, dan status wajib diisi.', 'error'); return; }
    const checkedIds = $all('.bulk-siswa-check:checked').map(cb => cb.value);
    if (!checkedIds.length){ toast('Centang minimal satu siswa.', 'error'); return; }

    showLoading(true);
    let saved = 0, skipped = 0;
    try{
      const rowsToInsert = [];
      checkedIds.forEach(id => {
        const already = STATE.absensi.some(a => String(a.SiswaID)===String(id) && a.Tanggal===tanggal);
        if (already){ skipped++; return; }
        const s = siswaById(id);
        rowsToInsert.push({ Tanggal: tanggal, SiswaID: id, Nama: s?.Nama||'', Kelas: s?.Kelas||'', Status: status, Keterangan: keterangan });
      });
      if (rowsToInsert.length){
        // Satu permintaan untuk semua siswa sekaligus (jauh lebih cepat dibanding satu-satu)
        const result = await adapter.bulkInsert('absensi', rowsToInsert);
        const insertedRows = (result && result.rows) || rowsToInsert;
        STATE.absensi.push(...insertedRows);
        saved = insertedRows.length;
      }
      closeModal();
      populateClassFilters();
      renderCurrentPage();
      renderDashboard();
      toast(`${saved} siswa dicatat sebagai ${status}${skipped ? `, ${skipped} dilewati (sudah ada catatan absensi tanggal ini)` : ''}.`, 'success');
    }catch(err){
      toast(err.message, 'error');
    }finally{
      showLoading(false);
    }
  });

  openModal();
}
$('#btnBulkAbsensi').addEventListener('click', openBulkAbsensi);
$('#modalClose').addEventListener('click', closeModal);
$('#modalBackdrop').addEventListener('click', e => { if (e.target.id==='modalBackdrop') closeModal(); });

$('#btnAddSiswa').addEventListener('click', () => openForm('siswa'));
$('#btnAddAbsensi').addEventListener('click', () => openForm('absensi'));
$('#btnAddPelanggaran').addEventListener('click', () => openForm('pelanggaran'));
$('#btnMasterPelanggaran').addEventListener('click', () => openMasterPelanggaran());

/* ---------------- TEMPLATE PELANGGARAN (kelola Jenis Pelanggaran & Poin) ----------------
   Daftar baku Jenis Pelanggaran + Poin yang dipakai sebagai pilihan dropdown saat
   mencatat pelanggaran, supaya konsisten antar guru (tidak ketik bebas beda-beda
   istilah). Sekolah bisa tambah/ubah/hapus daftar ini kapan saja lewat menu ini —
   mengubah daftar TIDAK mengubah data pelanggaran siswa yang sudah tercatat
   sebelumnya (karena JenisPelanggaran & Poin disimpan sebagai teks/angka biasa
   di baris pelanggaran masing-masing siswa, bukan referensi/link ke baris ini). */
function openMasterPelanggaran(){
  $('#modalTitle').textContent = 'Template Pelanggaran';
  let editingId = null;

  $('#modalBody').innerHTML = `
    <p class="muted" style="margin:0 0 14px">Daftar Jenis Pelanggaran &amp; Poin baku ini akan muncul sebagai pilihan dropdown saat mencatat pelanggaran siswa. Mengubah daftar di sini tidak mengubah data pelanggaran yang sudah pernah dicatat.</p>
    <form id="masterPelanggaranForm">
      <div class="form-grid">
        <div class="field full"><label>Jenis Pelanggaran</label>
          <input type="text" id="mplJenis" placeholder="Contoh: Terlambat masuk sekolah" required />
        </div>
        <div class="field"><label>Poin</label>
          <input type="number" id="mplPoin" min="0" value="5" required />
        </div>
        <div class="field"><label>Kategori</label>
          <select id="mplKategori">
            <option value="Ringan">Ringan</option>
            <option value="Sedang">Sedang</option>
            <option value="Berat">Berat</option>
            <option value="Lainnya">Lainnya</option>
          </select>
        </div>
      </div>
      <div class="modal-actions" style="justify-content:flex-start; margin-bottom:18px">
        <button type="submit" class="btn btn-primary" id="mplSubmitBtn"><i class="fa-solid fa-plus"></i> Tambah ke Template</button>
        <button type="button" class="btn btn-ghost hidden" id="mplCancelEditBtn">Batal Edit</button>
      </div>
    </form>
    <div class="bulk-siswa-list" id="mplList" style="max-height:280px"></div>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" id="mplCloseBtn">Tutup</button>
    </div>`;

  function renderList(){
    const list = $('#mplList');
    const rows = STATE.masterPelanggaran.slice().sort((a,b) => (a.JenisPelanggaran||'').localeCompare(b.JenisPelanggaran||''));
    if (!rows.length){
      list.innerHTML = `<p class="muted" style="padding:8px">Belum ada Template Pelanggaran. Tambahkan lewat form di atas.</p>`;
      return;
    }
    list.innerHTML = rows.map(m => `
      <div class="bulk-item mpl-item">
        <span class="mpl-info"><b>${escapeHtml(m.JenisPelanggaran||'-')}</b> <span class="muted">· ${escapeHtml(String(m.Poin ?? 0))} poin · ${escapeHtml(m.Kategori||'-')}</span></span>
        <span class="search-dd-actions">
          <button type="button" class="icon-btn-sm" data-mpl-edit="${escapeHtml(m.ID)}" title="Edit"><i class="fa-solid fa-pen"></i></button>
          <button type="button" class="icon-btn-sm danger" data-mpl-del="${escapeHtml(m.ID)}" title="Hapus"><i class="fa-solid fa-trash"></i></button>
        </span>
      </div>`).join('');
  }
  renderList();

  $('#mplList').addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-mpl-edit]');
    const delBtn = e.target.closest('[data-mpl-del]');
    if (editBtn){
      const m = STATE.masterPelanggaran.find(o => String(o.ID)===String(editBtn.dataset.mplEdit));
      if (!m) return;
      editingId = m.ID;
      $('#mplJenis').value = m.JenisPelanggaran || '';
      $('#mplPoin').value = m.Poin ?? 5;
      $('#mplKategori').value = m.Kategori || 'Ringan';
      $('#mplSubmitBtn').innerHTML = '<i class="fa-solid fa-check"></i> Update Template';
      $('#mplCancelEditBtn').classList.remove('hidden');
      $('#mplJenis').focus();
      return;
    }
    if (delBtn){
      if (!confirm('Hapus jenis pelanggaran ini dari Template? Data pelanggaran siswa yang sudah tercatat sebelumnya tidak akan terhapus.')) return;
      const id = delBtn.dataset.mplDel;
      try{
        await adapter.delete('masterPelanggaran', id);
        STATE.masterPelanggaran = STATE.masterPelanggaran.filter(o => String(o.ID)!==String(id));
        renderList();
        toast('Template pelanggaran dihapus.', 'success');
      }catch(err){
        toast(err.message, 'error');
      }
    }
  });

  $('#mplCancelEditBtn').addEventListener('click', () => {
    editingId = null;
    $('#masterPelanggaranForm').reset();
    $('#mplPoin').value = 5;
    $('#mplSubmitBtn').innerHTML = '<i class="fa-solid fa-plus"></i> Tambah ke Template';
    $('#mplCancelEditBtn').classList.add('hidden');
  });

  $('#masterPelanggaranForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const jenis = $('#mplJenis').value.trim();
    const poin = Number($('#mplPoin').value || 0);
    const kategori = $('#mplKategori').value;
    if (!jenis){ toast('Jenis Pelanggaran wajib diisi.', 'error'); return; }
    const btn = $('#mplSubmitBtn');
    const originalLabel = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
    try{
      const data = { JenisPelanggaran: jenis, Poin: poin, Kategori: kategori };
      if (editingId){
        const updated = await adapter.update('masterPelanggaran', editingId, data);
        const idx = STATE.masterPelanggaran.findIndex(o => String(o.ID)===String(editingId));
        if (idx > -1) STATE.masterPelanggaran[idx] = { ...STATE.masterPelanggaran[idx], ...updated, ...data, ID: editingId };
        toast('Template pelanggaran diperbarui.', 'success');
      } else {
        const created = await adapter.create('masterPelanggaran', data);
        STATE.masterPelanggaran.push({ ...data, ...created });
        toast('Ditambahkan ke Template Pelanggaran.', 'success');
      }
      editingId = null;
      $('#masterPelanggaranForm').reset();
      $('#mplPoin').value = 5;
      $('#mplSubmitBtn').innerHTML = '<i class="fa-solid fa-plus"></i> Tambah ke Template';
      $('#mplCancelEditBtn').classList.add('hidden');
      renderList();
    }catch(err){
      toast(err.message, 'error');
    }finally{
      btn.disabled = false;
    }
  });

  $('#mplCloseBtn').addEventListener('click', closeModal);
  openModal();
}
$('#btnAddKonseling').addEventListener('click', () => openForm('konseling'));
$('#btnAddKolaborasi').addEventListener('click', () => openForm('kolaborasi'));

/* ---------------- LAPORAN / CETAK PDF ---------------- */
const REPORT_COLUMNS = {
  siswa: ['NIS','Nama','Kelas','JenisKelamin','NamaOrtu','NoHPOrtu'],
  absensi: ['Tanggal','Nama','Kelas','Status','Keterangan'],
  pelanggaran: ['Tanggal','Nama','Kelas','JenisPelanggaran','Poin','Penanganan'],
  konseling: ['Tanggal','Nama','Kelas','Topik','HasilKonseling','TindakLanjut','TTD'],
  kolaborasi: ['Tanggal','Nama','Kelas','Jenis','Tujuan','Hasil'],
  pemanggilan_ortu: ['Tanggal','Nama','Kelas','Tujuan','Hasil','Petugas'],
  home_visit: ['Tanggal','Nama','Kelas','Tujuan','Hasil','Petugas'],
  siswa_lulus: ['NIS','Nama','Kelas','JenisKelamin','NamaOrtu','NoHPOrtu','TahunLulus','TanggalLulus']
};
const REPORT_TITLES = {
  siswa:'Data Siswa', absensi:'Rekap Absensi Siswa', pelanggaran:'Rekap Pelanggaran Siswa',
  konseling:'Rekap Sesi Konseling', kolaborasi:'Rekap Kolaborasi (Panggilan Ortu / Home Visit)',
  pemanggilan_ortu:'Rekap Pemanggilan Orang Tua', home_visit:'Rekap Home Visit',
  siswa_lulus:'Laporan Siswa Lulus (Alumni)'
};

$('#reportPeriode').addEventListener('change', () => {
  const val = $('#reportPeriode').value;
  $('#reportTanggalField').classList.toggle('hidden', val !== 'harian');
  $('#reportBulanField').classList.toggle('hidden', val !== 'bulanan');
  $('#reportSemesterField').classList.toggle('hidden', val !== 'semester');
  $('#reportTahunAjaranField').classList.toggle('hidden', val !== 'semester');
  if (val === 'semester' && !$('#reportTahunAjaran').value.trim()){
    $('#reportTahunAjaran').value = SCHOOL_YEAR || '';
  }
});
$('#reportType').addEventListener('change', () => {
  const isIndividu = $('#reportType').value === 'individu';
  const isLulus = $('#reportType').value === 'siswa_lulus';
  $('#reportTahunLulusField').classList.toggle('hidden', !isLulus);
  $('#reportPeriodeField').classList.toggle('hidden', isLulus);
  if (isLulus){ ['Tanggal','Bulan','Semester','TahunAjaran'].forEach(k => $(`#report${k}Field`).classList.add('hidden')); populateLulusTahunOptions(); }
  if (!isLulus) $('#reportPeriode').dispatchEvent(new Event('change'));
  $('#reportKelasField').classList.toggle('hidden', isIndividu);
  $('#reportSiswaField').classList.toggle('hidden', !isIndividu);
  $('#reportRekapKelasWrap').style.display = isIndividu ? 'none' : '';
  syncAbsensiViewUI();
});

/* Pilihan "Bentuk Rekap Absensi" hanya relevan saat Jenis Laporan = Rekap Absensi.
   Khusus bentuk "Grid Bulanan" (meniru lembar absensi manual sekolah), periode
   otomatis dikunci ke Bulanan karena satu lembar grid memang selalu mewakili
   satu bulan penuh (kolom tanggal 1–31). */
function syncAbsensiViewUI(){
  const type = $('#reportType').value;
  const isAbsensi = type === 'absensi';
  const view = $('#reportAbsensiView').value;
  $('#reportAbsensiViewField').classList.toggle('hidden', !isAbsensi);
  const isGrid = isAbsensi && view === 'grid';
  if (isGrid){
    $('#reportPeriode').value = 'bulanan';
    $('#reportTanggalField').classList.add('hidden');
    $('#reportSemesterField').classList.add('hidden');
    $('#reportTahunAjaranField').classList.add('hidden');
    $('#reportBulanField').classList.remove('hidden');
  }
  $('#reportPeriodeField').classList.toggle('hidden', isGrid || type === 'siswa_lulus');
  // Rekap per kelas otomatis sudah jadi isi laporannya sendiri pada bentuk
  // "Per Kelas"/"Grid", jadi checkbox rekap ringkas disembunyikan di situ.
  if (isAbsensi && (view === 'grid' || view === 'kelas')){
    $('#reportRekapKelasWrap').style.display = 'none';
  } else if (type !== 'individu'){
    $('#reportRekapKelasWrap').style.display = '';
  }
}
$('#reportAbsensiView').addEventListener('change', syncAbsensiViewUI);
(function initReportDefaults(){
  const today = new Date();
  $('#reportTanggal').value = today.toISOString().slice(0,10);
  $('#reportBulan').value = today.toISOString().slice(0,7);
  $('#reportTahunAjaran').value = SCHOOL_YEAR || '';
  syncAbsensiViewUI();
})();

/* Ubah "2025/2026" (atau "2025-2026", "2025 2026") jadi { y1:2025, y2:2026 }.
   Kalau formatnya tidak dikenali, pakai tahun berjalan sebagai fallback supaya
   fitur semester tetap bisa dipakai walau Tahun Pelajaran di Pengaturan belum diisi. */
function parseTahunAjaran(str){
  const m = String(str || '').match(/(\d{4}).*?(\d{4})/);
  if (m) return { y1: parseInt(m[1],10), y2: parseInt(m[2],10) };
  const y = new Date().getFullYear();
  return { y1: y, y2: y+1 };
}
function monthLabel(ym){
  if (!ym) return '-';
  const [y,m] = ym.split('-');
  return new Date(y, m-1, 1).toLocaleDateString('id-ID',{month:'long',year:'numeric'});
}
/* Semester Ganjil = Juli–Desember (tahun pertama tahun pelajaran);
   Semester Genap = Januari–Juni (tahun kedua tahun pelajaran) — konvensi umum sekolah di Indonesia. */
function semesterMonthRange(){
  const { y1, y2 } = parseTahunAjaran($('#reportTahunAjaran').value || SCHOOL_YEAR);
  const isGenap = $('#reportSemester').value === 'genap';
  return isGenap ? { startYM: `${y2}-01`, endYM: `${y2}-06` } : { startYM: `${y1}-07`, endYM: `${y1}-12` };
}

/* Untuk laporan Konseling, kolom "Nama" tetap berlabel "Nama" tapi ISInya
   ditampilkan sebagai NIS siswa (permintaan: identitas di laporan konseling
   pakai NIS, bukan nama, walau header tabel tetap "Nama"). Tipe laporan lain
   tidak terpengaruh. */
function reportCellValue(type, col, row){
  if (type === 'konseling' && col === 'Nama') return konselingDisplayNis(row);
  return row[col];
}
/* Kolom TTD (tanda tangan/paraf siswa) disimpan sebagai gambar (data URL),
   jadi ditampilkan sebagai thumbnail gambar di Laporan (bukan teks panjang
   yang di-escape seperti kolom lain), dengan klik untuk memperbesar lewat
   lightbox yang sudah ada. */
function reportSignatureCellHtml(val){
  if (!val) return '<span class="muted">Belum TTD</span>';
  return `<img src="${escapeHtml(val)}" alt="Tanda tangan siswa" class="signature-thumb" data-lightbox-src="${escapeHtml(val)}" title="Klik untuk perbesar" />`;
}
function filterByPeriode(rows, type){
  const periode = $('#reportPeriode').value;
  if (!periode) return rows;
  if (!('Tanggal' in (rows[0]||{})) && !REPORT_COLUMNS[type].includes('Tanggal')) return rows;
  if (periode === 'harian'){
    const tgl = $('#reportTanggal').value;
    if (!tgl) return rows;
    return rows.filter(r => normalizeTanggal(r.Tanggal) === tgl);
  }
  if (periode === 'bulanan'){
    const bln = $('#reportBulan').value; // yyyy-mm
    if (!bln) return rows;
    return rows.filter(r => normalizeTanggal(r.Tanggal).slice(0,7) === bln);
  }
  if (periode === 'semester'){
    const { startYM, endYM } = semesterMonthRange();
    return rows.filter(r => {
      const ym = normalizeTanggal(r.Tanggal).slice(0,7);
      return ym && ym >= startYM && ym <= endYM;
    });
  }
  return rows;
}
function periodeLabel(){
  const periode = $('#reportPeriode').value;
  if (periode === 'harian'){
    const tgl = $('#reportTanggal').value;
    return tgl ? `Harian — ${fmtDate(tgl)}` : 'Harian';
  }
  if (periode === 'bulanan'){
    const bln = $('#reportBulan').value;
    if (!bln) return 'Bulanan';
    const [y,m] = bln.split('-');
    return `Bulanan — ${new Date(y, m-1, 1).toLocaleDateString('id-ID',{month:'long',year:'numeric'})}`;
  }
  if (periode === 'semester'){
    const { startYM, endYM } = semesterMonthRange();
    const semLabel = $('#reportSemester').value === 'genap' ? 'Genap' : 'Ganjil';
    const taj = ($('#reportTahunAjaran').value || SCHOOL_YEAR || '-').trim() || '-';
    return `Semester ${semLabel} — Tahun Pelajaran ${taj} (${monthLabel(startYM)} s.d. ${monthLabel(endYM)})`;
  }
  return 'Semua Tanggal';
}

$('#btnGenerateReport').addEventListener('click', () => {
  const type = $('#reportType').value;

  if (type === 'individu'){
    const siswaId = $('#reportSiswa').value;
    if (!siswaId){ toast('Pilih siswa terlebih dahulu.', 'error'); return; }
    const s = siswaById(siswaId);
    if (!s){ toast('Data siswa tidak ditemukan.', 'error'); return; }

    const mine = (type) => filterByPeriode((STATE[type]||[]).filter(r => String(r.SiswaID) === String(siswaId)), type)
      .slice().sort((a,b)=> new Date(a.Tanggal) - new Date(b.Tanggal));
    const absensi = mine('absensi');
    const pelanggaran = mine('pelanggaran');
    const konseling = mine('konseling');
    const kolaborasi = mine('kolaborasi');
    const today = new Date().toLocaleDateString('id-ID',{day:'2-digit',month:'long',year:'numeric'});

    const section = (title, cols, rows, emptyMsg) => `
      <h3 style="margin-top:22px">${title}</h3>
      <table>
        <thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead>
        <tbody>
          ${rows.length ? rows.map(r => `<tr>${cols.map(c => `<td>${c==='Tanggal'?fmtDate(r[c]):(c==='TTD'?reportSignatureCellHtml(r[c]):escapeHtml(r[c] ?? '-'))}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" style="text-align:center;color:#999">${emptyMsg}</td></tr>`}
        </tbody>
      </table>`;

    const html = `
      <h2>Laporan Individu Siswa</h2>
      <div class="report-head-line"><span>Periode: ${periodeLabel()}</span><span>Dicetak: ${today}</span></div>
      <div class="report-summary">
        <div class="report-summary-item"><span class="label">Nama</span><span class="value" style="font-size:14px">${escapeHtml(s.Nama)}</span></div>
        <div class="report-summary-item"><span class="label">NIS</span><span class="value" style="font-size:14px">${escapeHtml(s.NIS||'-')}</span></div>
        <div class="report-summary-item"><span class="label">Kelas</span><span class="value" style="font-size:14px">${escapeHtml(s.Kelas||'-')}</span></div>
        <div class="report-summary-item"><span class="label">Jenis Kelamin</span><span class="value" style="font-size:14px">${escapeHtml(s.JenisKelamin||'-')}</span></div>
        <div class="report-summary-item"><span class="label">Orang Tua/Wali</span><span class="value" style="font-size:14px">${escapeHtml(s.NamaOrtu||'-')}</span></div>
        <div class="report-summary-item"><span class="label">No. HP Ortu</span><span class="value" style="font-size:14px">${escapeHtml(s.NoHPOrtu||'-')}</span></div>
      </div>
      ${buildReportSummaryHtml('absensi', absensi)}
      ${section('Rekap Absensi', ['Tanggal','Status','Keterangan'], absensi, 'Tidak ada catatan absensi')}
      ${buildReportSummaryHtml('pelanggaran', pelanggaran)}
      ${section('Rekap Pelanggaran', ['Tanggal','JenisPelanggaran','Poin','Penanganan'], pelanggaran, 'Tidak ada catatan pelanggaran')}
      ${section('Rekap Konseling', ['Tanggal','Topik','HasilKonseling','TindakLanjut','TTD'], konseling, 'Tidak ada catatan konseling')}
      ${section('Rekap Pemanggilan Orang Tua', ['Tanggal','Tujuan','Hasil','Petugas'], kolaborasi.filter(r => r.Jenis === 'Pemanggilan Orang Tua'), 'Tidak ada catatan pemanggilan orang tua')}
      <h3 style="margin-top:22px">Rekap Home Visit</h3>
      ${buildHomeVisitReportHtml(kolaborasi.filter(r => r.Jenis === 'Home Visit'))}
      ${s.Catatan ? `<h3 style="margin-top:22px">Catatan Tambahan</h3><p>${escapeHtml(s.Catatan)}</p>` : ''}
    `;
    showReportPreview(html);
    return;
  }

  /* ----- Siswa Lulus (arsip hasil menu Kenaikan & Kelulusan) ----- */
  if (type === 'siswa_lulus'){
    showReportPreview(buildSiswaLulusReportHtml());
    return;
  }

  /* ----- Rekap Absensi: grid bulanan / per siswa / per kelas / per bulan ----- */
  if (type === 'absensi'){
    const view = $('#reportAbsensiView').value;
    if (view !== 'rincian'){
      const html = buildAbsensiReportHtml(view);
      if (html === null) return; // validasi gagal, pesan sudah ditampilkan
      showReportPreview(html, view === 'grid');
      return;
    }
  }

  const kelas = $('#reportKelas').value;
  let rows = (type === 'pemanggilan_ortu' || type === 'home_visit')
    ? STATE.kolaborasi.filter(r => r.Jenis === (type === 'pemanggilan_ortu' ? 'Pemanggilan Orang Tua' : 'Home Visit'))
    : (STATE[type] || []);
  if (kelas) rows = rows.filter(r => r.Kelas === kelas);
  rows = filterByPeriode(rows, type);
  if ('Tanggal' in (rows[0]||{}) || REPORT_COLUMNS[type].includes('Tanggal')){
    rows = rows.slice().sort((a,b)=> new Date(a.Tanggal)-new Date(b.Tanggal));
  }
  const cols = REPORT_COLUMNS[type];
  const today = new Date().toLocaleDateString('id-ID',{day:'2-digit',month:'long',year:'numeric'});
  const showRekapKelas = $('#reportRekapKelas').checked;

  const html = `
    <h2>${REPORT_TITLES[type]}</h2>
    <div class="report-head-line"><span>Kelas: ${escapeHtml(kelas || 'Semua Kelas')} &nbsp;|&nbsp; Periode: ${periodeLabel()}</span><span>Dicetak: ${today}</span></div>
    ${buildReportSummaryHtml(type, rows)}
    ${showRekapKelas ? buildKelasRecapHtml(type, rows) : ''}
    <h3 style="margin-top:22px">Rincian Data</h3>
    ${type === 'home_visit' ? buildHomeVisitReportHtml(rows) : `
    <table>
      <thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead>
      <tbody>
        ${rows.length ? rows.map(r => `<tr>${cols.map(c => `<td>${c==='Tanggal'?fmtDate(r[c]):(c==='TTD'?reportSignatureCellHtml(r[c]):escapeHtml(reportCellValue(type, c, r) ?? '-'))}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" style="text-align:center;color:#999">Tidak ada data</td></tr>`}
      </tbody>
    </table>`}
    <p style="margin-top:24px;font-size:12px;color:#999">Total data: ${rows.length}</p>
  `;
  showReportPreview(html);
});

/* ================= LAPORAN SISWA LULUS =================
   Sumber datanya arsip "SiswaLulus" yang otomatis terisi saat Admin menjalankan
   Kelulusan di menu Kenaikan & Kelulusan. Kolom Kelas = kelas terakhir siswa
   sebelum lulus. Bisa disaring per Tahun Lulus & Kelas. */
function populateLulusTahunOptions(){
  const el = $('#reportTahunLulus'); if (!el) return;
  const current = el.value;
  const years = Array.from(new Set((STATE.siswaLulus||[]).map(r => String(r.TahunLulus || '').trim()).filter(Boolean))).sort().reverse();
  el.innerHTML = '<option value="">Semua Tahun Lulus</option>' + years.map(y => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join('');
  el.value = years.includes(current) ? current : '';
  // isi juga daftar kelas laporan dengan kelas asal alumni (menyatu dengan kelas aktif)
  const kel = $('#reportKelas');
  if (kel){
    const have = new Set($all('option', kel).map(o => o.value));
    (STATE.siswaLulus||[]).map(r => r.Kelas).filter(k => k && !have.has(k)).forEach(k => { have.add(k); kel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`); });
  }
}
function buildSiswaLulusReportHtml(){
  const kelas = $('#reportKelas').value;
  const tahun = $('#reportTahunLulus').value;
  let rows = (STATE.siswaLulus || []).slice();
  if (kelas) rows = rows.filter(r => r.Kelas === kelas);
  if (tahun) rows = rows.filter(r => String(r.TahunLulus || '').trim() === tahun);
  rows.sort((a,b) => String(b.TahunLulus||'').localeCompare(String(a.TahunLulus||'')) || String(a.Kelas||'').localeCompare(String(b.Kelas||''), 'id') || String(a.Nama||'').localeCompare(String(b.Nama||''), 'id'));
  const cols = REPORT_COLUMNS.siswa_lulus;
  const today = new Date().toLocaleDateString('id-ID',{day:'2-digit',month:'long',year:'numeric'});
  const lk = rows.filter(r => String(r.JenisKelamin).toUpperCase().startsWith('L')).length;
  const pr = rows.filter(r => String(r.JenisKelamin).toUpperCase().startsWith('P')).length;
  const groups = {};
  rows.forEach(r => { const k = `${r.TahunLulus || '-'}||${r.Kelas || '-'}`; groups[k] = (groups[k] || 0) + 1; });
  const recap = Object.keys(groups).length ? `
    <h3 style="margin-top:22px">Rekap per Tahun Lulus &amp; Kelas</h3>
    <table><thead><tr><th>Tahun Lulus</th><th>Kelas Terakhir</th><th>Jumlah Siswa</th></tr></thead><tbody>
    ${Object.keys(groups).map(k => { const [t, c] = k.split('||'); return `<tr><td>${escapeHtml(t)}</td><td>${escapeHtml(c)}</td><td>${groups[k]}</td></tr>`; }).join('')}
    </tbody></table>` : '';
  return `
    <h2>${REPORT_TITLES.siswa_lulus}</h2>
    <div class="report-head-line"><span>Tahun Lulus: ${escapeHtml(tahun || 'Semua')} &nbsp;|&nbsp; Kelas Terakhir: ${escapeHtml(kelas || 'Semua Kelas')}</span><span>Dicetak: ${today}</span></div>
    <div class="report-summary">
      <div class="report-summary-item"><span class="label">Total Siswa Lulus</span><span class="value">${rows.length}</span></div>
      <div class="report-summary-item"><span class="label">Laki-laki</span><span class="value">${lk}</span></div>
      <div class="report-summary-item"><span class="label">Perempuan</span><span class="value">${pr}</span></div>
    </div>
    ${recap}
    <h3 style="margin-top:22px">Rincian Data</h3>
    <table>
      <thead><tr><th>No</th>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead>
      <tbody>
        ${rows.length ? rows.map((r,i) => `<tr><td>${i+1}</td>${cols.map(c => `<td>${c==='TanggalLulus'?fmtDate(r[c]):escapeHtml(r[c] ?? '-')}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length+1}" style="text-align:center;color:#999">Belum ada siswa yang diluluskan</td></tr>`}
      </tbody>
    </table>
    <p style="margin-top:24px;font-size:12px;color:#999">Total data: ${rows.length}</p>`;
}

/* ================= REKAP ABSENSI (FORMAT LEMBAR ABSENSI SEKOLAH) =================
   Meniru lembar "ABSENSI KELAS" manual: satu baris per siswa, kolom tanggal 1–31,
   sel diisi kode S/I/A (Hadir sengaja dibiarkan kosong seperti di lembar aslinya),
   lalu kolom JUMLAH (S | I | A) dan KETR di ujung kanan, ditutup rekap jumlah
   siswa Putra/Putri serta blok tanda tangan Guru BK.
   Empat bentuk rekap yang tersedia:
   - grid   : grid bulanan per kelas (persis lembar manual)
   - siswa  : rekap per anak (satu baris per siswa, total H/S/I/A + % kehadiran)
   - kelas  : rekap per kelas (total H/S/I/A tiap kelas)
   - bulan  : rekap per bulan (berguna untuk melihat satu semester sekaligus)
   Semua bentuk selain "grid" mengikuti Periode yang dipilih (harian/bulanan/
   semester/semua tanggal), jadi rekap per semester & per bulan tinggal memilih
   periodenya. */

/* Kode singkat di sel grid. Hadir ditandai centang (✓), sedangkan Sakit/Izin/Alfa
   ditandai huruf S/I/A seperti lembar manual — jadi sel yang benar-benar kosong
   berarti memang belum ada catatan absensi untuk siswa & tanggal itu. */
function absenKode(status){
  const s = String(status || '').trim().toLowerCase();
  if (s === 'sakit') return 'S';
  if (s === 'izin') return 'I';
  if (s === 'alpa' || s === 'alpha' || s === 'tanpa keterangan') return 'A';
  if (s === 'hadir' || s === 'masuk' || s === 'h') return '✓';
  return '';
}
/* Tanggal bisa datang dalam beberapa bentuk: 'yyyy-mm-dd' (format normal dari
   backend), ISO lengkap dengan jam ('2026-09-15T00:00:00.000Z') kalau sel Sheet
   tersimpan sebagai Date, atau 'dd/mm/yyyy' kalau pernah diketik manual di Sheet.
   Semua dinormalkan ke 'yyyy-mm-dd' supaya cocok saat dipetakan ke kolom tanggal. */
function normalizeTanggal(value){
  if (!value) return '';
  if (value instanceof Date && !isNaN(value)){
    const p = n => String(n).padStart(2,'0');
    return `${value.getFullYear()}-${p(value.getMonth()+1)}-${p(value.getDate())}`;
  }
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/); // dd/mm/yyyy
  if (m) return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
  const d = new Date(s);
  if (!isNaN(d)){
    const p = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
  }
  return '';
}
function daysInMonth(ym){
  const [y,m] = String(ym||'').split('-').map(Number);
  if (!y || !m) return 31;
  return new Date(y, m, 0).getDate();
}
function isPutra(s){ return String(s.JenisKelamin||'').trim().toUpperCase().startsWith('L'); }
function isPutri(s){ return String(s.JenisKelamin||'').trim().toUpperCase().startsWith('P'); }
function sortSiswaByNama(list){
  return list.slice().sort((a,b) => String(a.Nama||'').localeCompare(String(b.Nama||''), 'id'));
}
/* Daftar siswa yang jadi baris rekap: diambil dari Data Siswa (bukan dari catatan
   absensi) supaya siswa yang selalu hadir / belum pernah dicatat pun tetap muncul
   barisnya — sama seperti lembar absensi manual yang memuat seluruh siswa kelas. */
function siswaForReport(kelas){
  const list = (STATE.siswa || []).filter(s => !kelas || s.Kelas === kelas);
  return sortSiswaByNama(list);
}
/* Cocokkan catatan absensi ke siswa: utamakan SiswaID, tapi tetap bisa jatuh ke
   pencocokan Nama+Kelas supaya data lama yang SiswaID-nya kosong tidak hilang. */
function absensiSiswaKey(row){
  return String(row.SiswaID || '').trim() || ('nama:' + String(row.Nama||'').trim().toLowerCase() + '|' + String(row.Kelas||'').trim().toLowerCase());
}
function siswaKeys(s){
  return [String(s.ID||'').trim(), 'nama:' + String(s.Nama||'').trim().toLowerCase() + '|' + String(s.Kelas||'').trim().toLowerCase()];
}

function buildAbsensiReportHtml(view){
  const kelas = $('#reportKelas').value;
  if (view === 'grid'){
    if (!kelas){ toast('Pilih Kelas terlebih dahulu untuk Grid Bulanan (satu lembar = satu kelas).', 'error'); return null; }
    const ym = $('#reportBulan').value;
    if (!ym){ toast('Pilih Bulan terlebih dahulu.', 'error'); return null; }
    return buildAbsensiGridHtml(kelas, ym);
  }
  let rows = filterByPeriode((STATE.absensi || []).filter(r => !kelas || r.Kelas === kelas), 'absensi');
  const headLine = `<div class="report-head-line"><span>Kelas: ${escapeHtml(kelas || 'Semua Kelas')} &nbsp;|&nbsp; Periode: ${periodeLabel()}</span><span>Dicetak: ${todayLabel()}</span></div>`;
  if (view === 'siswa'){
    return `<h2>Rekap Absensi Per Siswa</h2>${headLine}${buildReportSummaryHtml('absensi', rows)}
      ${buildAbsensiPerSiswaHtml(rows, kelas)}${buildSignatureBlockHtml()}`;
  }
  if (view === 'kelas'){
    return `<h2>Rekap Absensi Per Kelas</h2>${headLine}${buildReportSummaryHtml('absensi', rows)}
      ${buildKelasRecapHtml('absensi', rows) || '<p style="text-align:center;color:#999;margin-top:16px">Tidak ada data absensi pada periode ini</p>'}${buildSignatureBlockHtml()}`;
  }
  // view === 'bulan'
  return `<h2>Rekap Absensi Per Bulan</h2>${headLine}${buildReportSummaryHtml('absensi', rows)}
    ${buildAbsensiPerBulanHtml(rows)}${buildSignatureBlockHtml()}`;
}

/* Grid bulanan satu kelas — tiruan lembar "ABSENSI KELAS" pada lampiran. */
function buildAbsensiGridHtml(kelas, ym){
  const siswa = siswaForReport(kelas);
  const jml = daysInMonth(ym);
  const days = Array.from({length: jml}, (_,i) => i+1);

  /* Peta: kunci siswa + tanggal -> kode (✓ / S / I / A). Tanggal dinormalkan dulu
     lewat normalizeTanggal() supaya catatan yang tersimpan sebagai Date di Sheet
     (mis. '2026-09-15T00:00:00.000Z') atau diketik 'dd/mm/yyyy' tetap terbaca. */
  const map = {};
  (STATE.absensi || []).forEach(r => {
    const tgl = normalizeTanggal(r.Tanggal);
    if (!tgl || tgl.slice(0,7) !== ym) return;
    const kode = absenKode(r.Status);
    if (!kode) return;
    const day = parseInt(tgl.slice(8,10), 10);
    if (!day) return;
    map[absensiSiswaKey(r) + '#' + day] = kode;
  });

  const body = siswa.map((s, i) => {
    const keys = siswaKeys(s);
    const count = { S:0, I:0, A:0, '✓':0 };
    const cells = days.map(d => {
      let kode = '';
      for (const k of keys){ if (map[k + '#' + d]){ kode = map[k + '#' + d]; break; } }
      if (kode) count[kode]++;
      return `<td class="ag-day${kode === '✓' ? ' ag-hadir' : ''}">${kode}</td>`;
    }).join('');
    return `<tr>
      <td class="ag-no">${i+1}</td>
      <td class="ag-nama">${escapeHtml(s.Nama || '-')}</td>
      <td class="ag-lp">${escapeHtml(String(s.JenisKelamin||'').trim().toUpperCase().charAt(0) || '-')}</td>
      ${cells}
      <td class="ag-sum">${count.S || ''}</td>
      <td class="ag-sum">${count.I || ''}</td>
      <td class="ag-sum">${count.A || ''}</td>
      <td class="ag-ketr"></td>
    </tr>`;
  }).join('');

  const putra = siswa.filter(isPutra).length;
  const putri = siswa.filter(isPutri).length;

  return `
    <h2 class="ag-title">ABSENSI KELAS</h2>
    ${SCHOOL_NAME ? `<p class="ag-school">${escapeHtml(SCHOOL_NAME)}${SCHOOL_YEAR ? ` — Tahun Pelajaran ${escapeHtml(SCHOOL_YEAR)}` : ''}</p>` : ''}
    <div class="ag-headline">
      <span>KELAS : <b>${escapeHtml(kelas)}</b></span>
      <span>BULAN : <b>${escapeHtml(monthLabel(ym))}</b></span>
    </div>
    <table class="absensi-grid">
      <thead>
        <tr>
          <th rowspan="2" class="ag-no">NO</th>
          <th rowspan="2" class="ag-nama">NAMA PESERTA DIDIK</th>
          <th rowspan="2" class="ag-lp">L/P</th>
          <th colspan="${jml}">TANGGAL</th>
          <th colspan="3">JUMLAH</th>
          <th rowspan="2" class="ag-ketr">KETR</th>
        </tr>
        <tr>
          ${days.map(d => `<th class="ag-day">${d}</th>`).join('')}
          <th class="ag-sum">S</th><th class="ag-sum">I</th><th class="ag-sum">A</th>
        </tr>
      </thead>
      <tbody>
        ${siswa.length ? body : `<tr><td colspan="${jml+7}" style="text-align:center;color:#999">Belum ada siswa di kelas ini</td></tr>`}
      </tbody>
    </table>
    <div class="ag-foot">
      <div class="ag-foot-left">
        <div class="ag-foot-row"><b>JUMLAH</b> &nbsp; PUTRA : <b>${putra}</b> Anak</div>
        <div class="ag-foot-row" style="padding-left:62px">PUTRI : <b>${putri}</b> Anak</div>
        <div class="ag-foot-row" style="padding-left:62px">TOTAL &nbsp;: <b>${siswa.length}</b> Anak</div>
        <div class="ag-foot-row" style="margin-top:8px"><b>KETERANGAN</b></div>
        <div class="ag-foot-row">&#10003; : Hadir &nbsp; &nbsp; S : Sakit &nbsp; &nbsp; I : Izin &nbsp; &nbsp; A : Alfa</div>
      </div>
      ${buildSignatureBlockHtml(true)}
    </div>`;
}

/* Rekap per anak: satu baris per siswa berisi total Hadir/Sakit/Izin/Alpa dan
   persentase kehadiran terhadap jumlah hari yang tercatat untuk siswa itu. */
function buildAbsensiPerSiswaHtml(rows, kelas){
  const siswa = siswaForReport(kelas);
  const byKey = {};
  rows.forEach(r => {
    const k = absensiSiswaKey(r);
    if (!byKey[k]) byKey[k] = { Hadir:0, Sakit:0, Izin:0, Alpa:0 };
    const st = String(r.Status||'').trim();
    if (byKey[k][st] !== undefined) byKey[k][st]++;
    else if (absenKode(st) === 'A') byKey[k].Alpa++;
  });

  const total = { Hadir:0, Sakit:0, Izin:0, Alpa:0 };
  const body = siswa.map((s, i) => {
    let c = { Hadir:0, Sakit:0, Izin:0, Alpa:0 };
    siswaKeys(s).forEach(k => {
      if (byKey[k]) Object.keys(c).forEach(st => { c[st] += byKey[k][st]; });
    });
    const jumlah = c.Hadir + c.Sakit + c.Izin + c.Alpa;
    const persen = jumlah ? Math.round((c.Hadir / jumlah) * 100) : 0;
    Object.keys(total).forEach(st => { total[st] += c[st]; });
    return `<tr>
      <td style="text-align:center">${i+1}</td>
      <td>${escapeHtml(s.NIS || '-')}</td>
      <td>${escapeHtml(s.Nama || '-')}</td>
      <td style="text-align:center">${escapeHtml(String(s.JenisKelamin||'-').trim().toUpperCase().charAt(0) || '-')}</td>
      <td style="text-align:center">${escapeHtml(s.Kelas || '-')}</td>
      <td style="text-align:center">${c.Hadir}</td>
      <td style="text-align:center">${c.Sakit}</td>
      <td style="text-align:center">${c.Izin}</td>
      <td style="text-align:center">${c.Alpa}</td>
      <td style="text-align:center">${jumlah}</td>
      <td style="text-align:center">${jumlah ? persen + '%' : '-'}</td>
    </tr>`;
  }).join('');

  const totalHari = total.Hadir + total.Sakit + total.Izin + total.Alpa;
  return `
    <h3 style="margin-top:22px">Rekap Per Siswa</h3>
    <table>
      <thead><tr>
        <th>No</th><th>NIS</th><th>Nama</th><th>L/P</th><th>Kelas</th>
        <th>Hadir</th><th>Sakit</th><th>Izin</th><th>Alpa</th><th>Jumlah</th><th>% Hadir</th>
      </tr></thead>
      <tbody>
        ${siswa.length ? body : `<tr><td colspan="11" style="text-align:center;color:#999">Tidak ada siswa</td></tr>`}
        <tr style="font-weight:700;background:#f7f8f6">
          <td colspan="5">Total</td>
          <td style="text-align:center">${total.Hadir}</td>
          <td style="text-align:center">${total.Sakit}</td>
          <td style="text-align:center">${total.Izin}</td>
          <td style="text-align:center">${total.Alpa}</td>
          <td style="text-align:center">${totalHari}</td>
          <td style="text-align:center">${totalHari ? Math.round((total.Hadir/totalHari)*100) + '%' : '-'}</td>
        </tr>
      </tbody>
    </table>`;
}

/* Rekap per bulan — paling berguna saat Periode dipilih "Semester", supaya satu
   semester terlihat bulan demi bulan dalam satu tabel. */
function buildAbsensiPerBulanHtml(rows){
  const byMonth = {};
  rows.forEach(r => {
    const ym = normalizeTanggal(r.Tanggal).slice(0,7);
    if (!ym) return;
    if (!byMonth[ym]) byMonth[ym] = { Hadir:0, Sakit:0, Izin:0, Alpa:0 };
    const st = String(r.Status||'').trim();
    if (byMonth[ym][st] !== undefined) byMonth[ym][st]++;
    else if (absenKode(st) === 'A') byMonth[ym].Alpa++;
  });
  const months = Object.keys(byMonth).sort();
  const total = { Hadir:0, Sakit:0, Izin:0, Alpa:0 };
  const body = months.map(ym => {
    const c = byMonth[ym];
    Object.keys(total).forEach(st => { total[st] += c[st]; });
    const jml = c.Hadir + c.Sakit + c.Izin + c.Alpa;
    return `<tr>
      <td>${escapeHtml(monthLabel(ym))}</td>
      <td style="text-align:center">${c.Hadir}</td>
      <td style="text-align:center">${c.Sakit}</td>
      <td style="text-align:center">${c.Izin}</td>
      <td style="text-align:center">${c.Alpa}</td>
      <td style="text-align:center">${jml}</td>
      <td style="text-align:center">${jml ? Math.round((c.Hadir/jml)*100) + '%' : '-'}</td>
    </tr>`;
  }).join('');
  const totalHari = total.Hadir + total.Sakit + total.Izin + total.Alpa;
  return `
    <h3 style="margin-top:22px">Rekap Per Bulan</h3>
    <table>
      <thead><tr><th>Bulan</th><th>Hadir</th><th>Sakit</th><th>Izin</th><th>Alpa</th><th>Jumlah</th><th>% Hadir</th></tr></thead>
      <tbody>
        ${months.length ? body : `<tr><td colspan="7" style="text-align:center;color:#999">Tidak ada data pada periode ini</td></tr>`}
        <tr style="font-weight:700;background:#f7f8f6">
          <td>Total</td>
          <td style="text-align:center">${total.Hadir}</td>
          <td style="text-align:center">${total.Sakit}</td>
          <td style="text-align:center">${total.Izin}</td>
          <td style="text-align:center">${total.Alpa}</td>
          <td style="text-align:center">${totalHari}</td>
          <td style="text-align:center">${totalHari ? Math.round((total.Hadir/totalHari)*100) + '%' : '-'}</td>
        </tr>
      </tbody>
    </table>`;
}

function todayLabel(){
  return new Date().toLocaleDateString('id-ID',{day:'2-digit',month:'long',year:'numeric'});
}
/* Blok tanda tangan Guru BK di kaki laporan, mengikuti lembar absensi manual.
   Nama kota, nama Guru BK & NIP diambil dari menu Pengaturan > Profil Sekolah. */
function buildSignatureBlockHtml(inline){
  const kota = SCHOOL_CITY || '..................';
  const nama = SCHOOL_BK_NAME || '..................................';
  const nip = SCHOOL_BK_NIP || '-';
  return `
    <div class="report-signature${inline ? ' report-signature--inline' : ''}">
      <p>${escapeHtml(kota)}, ${todayLabel()}</p>
      <p>Guru BK</p>
      <div class="report-signature-space"></div>
      <p class="report-signature-name">${escapeHtml(nama)}</p>
      <p>NIP. ${escapeHtml(nip)}</p>
    </div>`;
}

/* Satu pintu untuk menampilkan & mencetak laporan. Grid bulanan otomatis dicetak
   landscape (kolom tanggal 1–31 tidak muat di portrait) lewat aturan @page yang
   disuntikkan sementara, lalu dikembalikan ke portrait untuk laporan lain. */
function showReportPreview(html, landscape){
  $('#reportPreview').innerHTML = html;
  $('#reportPreview').classList.toggle('report-preview--wide', !!landscape);
  let styleEl = document.getElementById('printOrientationStyle');
  if (!styleEl){
    styleEl = document.createElement('style');
    styleEl.id = 'printOrientationStyle';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = landscape
    ? '@page { size: A4 landscape; margin: 10mm; }'
    : '@page { size: A4 portrait; margin: 14mm; }';
  $('#reportPreviewCard').style.display = 'block';
  $('#reportPreviewCard').scrollIntoView({ behavior:'smooth' });
  setTimeout(() => window.print(), 400);
}

/* Ringkasan total absensi (Hadir/Sakit/Izin/Alpa) & total pelanggaran, ditampilkan di atas tabel laporan */
function buildReportSummaryHtml(type, rows){
  if (type === 'absensi'){
    const count = { Hadir:0, Sakit:0, Izin:0, Alpa:0 };
    rows.forEach(r => { if (count[r.Status] !== undefined) count[r.Status]++; });
    return `
      <div class="report-summary">
        <div class="report-summary-item"><span class="label">Total Hadir</span><span class="value">${count.Hadir}</span></div>
        <div class="report-summary-item"><span class="label">Total Sakit</span><span class="value">${count.Sakit}</span></div>
        <div class="report-summary-item"><span class="label">Total Izin</span><span class="value">${count.Izin}</span></div>
        <div class="report-summary-item"><span class="label">Total Alpa</span><span class="value">${count.Alpa}</span></div>
        <div class="report-summary-item"><span class="label">Total Keseluruhan</span><span class="value">${rows.length}</span></div>
      </div>`;
  }
  if (type === 'pelanggaran'){
    const totalPoin = rows.reduce((sum, r) => sum + (Number(r.Poin) || 0), 0);
    return `
      <div class="report-summary">
        <div class="report-summary-item"><span class="label">Total Kasus Pelanggaran</span><span class="value">${rows.length}</span></div>
        <div class="report-summary-item"><span class="label">Total Poin Pelanggaran</span><span class="value">${totalPoin}</span></div>
      </div>`;
  }
  return '';
}

/* Rekap ringkas per kelas — mengelompokkan data (yang sudah difilter periode/kelas)
   berdasarkan kolom Kelas, supaya guru BK bisa langsung lihat perbandingan antar
   kelas dalam satu bulan / satu semester tanpa harus scroll rincian satu-satu. */
function buildKelasRecapHtml(type, rows){
  if (!rows.length) return '';
  const classes = Array.from(new Set(rows.map(r => r.Kelas || '-'))).sort((a,b)=> String(a).localeCompare(String(b), 'id'));
  if (classes.length < 1) return '';

  let head, body;
  if (type === 'siswa'){
    head = ['Kelas','Jumlah Siswa','Laki-laki','Perempuan'];
    body = classes.map(k => {
      const grp = rows.filter(r => (r.Kelas||'-') === k);
      const l = grp.filter(r => String(r.JenisKelamin).toUpperCase().startsWith('L')).length;
      const p = grp.filter(r => String(r.JenisKelamin).toUpperCase().startsWith('P')).length;
      return [k, grp.length, l, p];
    });
  } else if (type === 'absensi'){
    head = ['Kelas','Hadir','Sakit','Izin','Alpa','Total'];
    body = classes.map(k => {
      const grp = rows.filter(r => (r.Kelas||'-') === k);
      const c = { Hadir:0, Sakit:0, Izin:0, Alpa:0 };
      grp.forEach(r => { if (c[r.Status] !== undefined) c[r.Status]++; });
      return [k, c.Hadir, c.Sakit, c.Izin, c.Alpa, grp.length];
    });
  } else if (type === 'pelanggaran'){
    head = ['Kelas','Jumlah Kasus','Total Poin'];
    body = classes.map(k => {
      const grp = rows.filter(r => (r.Kelas||'-') === k);
      const totalPoin = grp.reduce((s,r)=> s + (Number(r.Poin)||0), 0);
      return [k, grp.length, totalPoin];
    });
  } else {
    // konseling, kolaborasi, pemanggilan_ortu, home_visit: cukup jumlah catatan per kelas
    const labelMap = { konseling:'Jumlah Sesi Konseling', kolaborasi:'Jumlah Kegiatan Kolaborasi', pemanggilan_ortu:'Jumlah Pemanggilan Orang Tua', home_visit:'Jumlah Home Visit' };
    head = ['Kelas', labelMap[type] || 'Jumlah Data'];
    body = classes.map(k => {
      const grp = rows.filter(r => (r.Kelas||'-') === k);
      return [k, grp.length];
    });
  }

  const totalsRow = head.map((h,i) => {
    if (i === 0) return 'Total';
    const isNumericCol = body.every(row => typeof row[i] === 'number');
    return isNumericCol ? body.reduce((s,row)=> s + row[i], 0) : '';
  });

  return `
    <h3 style="margin-top:22px">Rekap per Kelas</h3>
    <table>
      <thead><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
      <tbody>
        ${body.map(row => `<tr>${row.map((v,i)=> `<td${i>0?' style="text-align:center"':''}>${escapeHtml(v)}</td>`).join('')}</tr>`).join('')}
        <tr style="font-weight:700;background:#f7f8f6">${totalsRow.map((v,i)=> `<td${i>0?' style="text-align:center"':''}>${escapeHtml(v)}</td>`).join('')}</tr>
      </tbody>
    </table>`;
}

/* Rincian Rekap Home Visit ditampilkan sebagai kartu (bukan tabel biasa) supaya
   foto bukti kunjungan ikut tampil & bisa diperbesar (klik foto = lightbox),
   baik di Laporan per kelas maupun Laporan Individu Siswa. */
function buildHomeVisitReportHtml(rows){
  if (!rows.length) return `<p style="text-align:center;color:#999;margin-top:16px">Tidak ada data Home Visit</p>`;
  return `<div class="report-homevisit-grid">${rows.map(r => `
    <div class="report-homevisit-card">
      <div class="report-homevisit-head">
        <b>${escapeHtml(r.Nama||'-')}</b>&nbsp;<span class="muted">(${escapeHtml(r.Kelas||'-')})</span>
        <span class="report-homevisit-date">${fmtDate(r.Tanggal)}</span>
      </div>
      <p><b>Tujuan:</b> ${escapeHtml(r.Tujuan||'-')}</p>
      <p><b>Hasil:</b> ${escapeHtml(r.Hasil||'-')}</p>
      <p><b>Petugas:</b> ${escapeHtml(r.Petugas||'-')}</p>
      ${r.BuktiFoto ? `<img src="${escapeHtml(r.BuktiFoto)}" alt="Bukti Home Visit" class="report-homevisit-photo" data-lightbox-id="${escapeHtml(r.ID)}" title="Klik untuk perbesar" />` : '<p class="muted">Tidak ada foto bukti</p>'}
    </div>`).join('')}</div>`;
}

/* ---------------- IMPORT DATA SISWA DARI EXCEL ----------------
   Import HANYA menambahkan siswa baru (dicocokkan lewat NIS).
   Siswa yang NIS-nya sudah ada di database TIDAK akan ditimpa —
   data yang sudah kamu input manual sebelumnya tetap aman. Input
   manual lewat tombol "Tambah Siswa" tetap berfungsi seperti biasa. */
const SISWA_TEMPLATE_COLUMNS = ['NIS','Nama','Kelas','JenisKelamin','TempatTglLahir','NamaOrtu','NoHPOrtu','Alamat','Catatan'];

function downloadSiswaTemplate(){
  const contoh = { NIS:'2201099', Nama:'Contoh Nama Siswa', Kelas:'VII-A', JenisKelamin:'L',
    TempatTglLahir:'Kota, 01-01-2012', NamaOrtu:'Nama Orang Tua', NoHPOrtu:'0812xxxxxxx',
    Alamat:'Alamat lengkap', Catatan:'' };
  const ws = XLSX.utils.json_to_sheet([contoh], { header: SISWA_TEMPLATE_COLUMNS });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Siswa');
  XLSX.writeFile(wb, 'Template_Import_Siswa_BKDigital.xlsx');
}
$('#btnDownloadTemplate').addEventListener('click', downloadSiswaTemplate);

$('#btnImportSiswa').addEventListener('click', () => $('#importSiswaFile').click());
$('#importSiswaFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  showLoading(true);
  try{
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type:'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval:'' });
    const cleaned = rows
      .map(r => {
        const o = {};
        SISWA_TEMPLATE_COLUMNS.forEach(c => { o[c] = (r[c] !== undefined ? String(r[c]).trim() : ''); });
        return o;
      })
      .filter(r => r.NIS && r.Nama); // baris tanpa NIS/Nama diabaikan
    if (!cleaned.length){ toast('Tidak ada baris valid (butuh minimal kolom NIS & Nama).', 'error'); return; }
    const result = await adapter.importBulk('siswa', cleaned, 'NIS');
    await loadAll();
    toast(`Import selesai: ${result.added} siswa baru ditambahkan, ${result.skipped} dilewati (NIS sudah ada).`, 'success');
  }catch(err){
    toast('Gagal mengimpor file: ' + err.message, 'error');
  }finally{
    showLoading(false);
    e.target.value = '';
  }
});

/* ---------------- SETUP SCREEN / API URL ---------------- */
function enterApp(){
  $('#setupScreen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  applyRoleUI();
  renderSchoolProfile();
  loadAll();
}
$('#apiUrlSave').addEventListener('click', () => {
  const val = $('#apiUrlInput').value.trim();
  const tokenVal = $('#apiTokenInput').value.trim();
  if (!val){ toast('Masukkan URL Web App terlebih dahulu.', 'error'); return; }
  API_URL = val; API_TOKEN = tokenVal;
  USER_ROLE = 'admin'; GURU_NAMA = ''; GURU_KELAS = []; KONSELOR_NAMA = ''; KONSELOR_KELAS = [];
  adapter = RealAdapter;
  localStorage.setItem('bk_api_url', API_URL);
  localStorage.setItem('bk_api_token', API_TOKEN);
  localStorage.setItem('bk_role', 'admin');
  localStorage.removeItem('bk_guru_nama');
  localStorage.removeItem('bk_guru_kelas');
  localStorage.removeItem('bk_konselor_nama');
  localStorage.removeItem('bk_konselor_kelas');
  localStorage.removeItem('bk_demo_mode');
  enterApp();
});

/* ---------------- LOGIN GURU MAPEL & LOGIN KONSELOR (GURU BK) ----------------
   Guru mapel / Konselor hanya mengisi Username & Password (atau PIN) — URL
   Web App sudah otomatis terisi (DEFAULT_API_URL yang di-bake admin, atau
   tersisa dari sesi sebelumnya di browser yang sama). Tidak ada field
   URL/token yang perlu mereka sentuh sama sekali. Ada 3 kartu login yang
   saling berpindah: Admin/Guru BK utama, Guru Mapel, dan Konselor. */
$('#showGuruLoginLink').addEventListener('click', (e) => {
  e.preventDefault();
  $('#adminSetupCard').classList.add('hidden');
  $('#konselorLoginCard').classList.add('hidden');
  $('#guruLoginCard').classList.remove('hidden');
});
$('#showAdminLoginLink').addEventListener('click', (e) => {
  e.preventDefault();
  $('#guruLoginCard').classList.add('hidden');
  $('#konselorLoginCard').classList.add('hidden');
  $('#adminSetupCard').classList.remove('hidden');
});
$('#showKonselorLoginLink').addEventListener('click', (e) => {
  e.preventDefault();
  $('#adminSetupCard').classList.add('hidden');
  $('#guruLoginCard').classList.add('hidden');
  $('#konselorLoginCard').classList.remove('hidden');
});
$('#showKonselorLoginFromGuruLink').addEventListener('click', (e) => {
  e.preventDefault();
  $('#guruLoginCard').classList.add('hidden');
  $('#konselorLoginCard').classList.remove('hidden');
});
$('#showGuruLoginFromKonselorLink').addEventListener('click', (e) => {
  e.preventDefault();
  $('#konselorLoginCard').classList.add('hidden');
  $('#guruLoginCard').classList.remove('hidden');
});
$('#showAdminLoginLink2').addEventListener('click', (e) => {
  e.preventDefault();
  $('#konselorLoginCard').classList.add('hidden');
  $('#guruLoginCard').classList.add('hidden');
  $('#adminSetupCard').classList.remove('hidden');
});
async function submitGuruLogin(){
  const username = $('#guruUsernameInput').value.trim();
  const password = $('#guruPasswordInput').value;
  if (!username || !password){ toast('Username dan password wajib diisi.', 'error'); return; }
  if (!API_URL){
    toast('Aplikasi belum tersambung ke server sekolah. Hubungi Guru BK/admin.', 'error');
    return;
  }
  const btn = $('#guruLoginBtn');
  const originalLabel = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Masuk...';
  try{
    const session = await RealAdapter.loginGuru(username, password);
    API_TOKEN = session.sessionToken;
    USER_ROLE = 'guru';
    GURU_NAMA = session.nama || '';
    GURU_KELAS = session.kelas || [];
    adapter = RealAdapter;
    localStorage.setItem('bk_api_url', API_URL);
    localStorage.setItem('bk_api_token', API_TOKEN);
    localStorage.setItem('bk_role', 'guru');
    localStorage.setItem('bk_guru_nama', GURU_NAMA);
    localStorage.setItem('bk_guru_kelas', JSON.stringify(GURU_KELAS));
    localStorage.removeItem('bk_demo_mode');
    $('#guruPasswordInput').value = '';
    enterApp();
  }catch(err){
    toast(err.message, 'error');
  }finally{
    btn.disabled = false; btn.innerHTML = originalLabel;
  }
}
$('#guruLoginBtn').addEventListener('click', submitGuruLogin);
$('#guruPasswordInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitGuruLogin(); });

/* Sama seperti submitGuruLogin(), tapi untuk akun Konselor (Guru BK per-kelas)
   yang dibatasi ke menu Konseling saja. */
async function submitKonselorLogin(){
  const username = $('#konselorUsernameInput').value.trim();
  const password = $('#konselorPasswordInput').value;
  if (!username || !password){ toast('Username dan Password/PIN wajib diisi.', 'error'); return; }
  if (!API_URL){
    toast('Aplikasi belum tersambung ke server sekolah. Hubungi Admin/Guru BK.', 'error');
    return;
  }
  const btn = $('#konselorLoginBtn');
  const originalLabel = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Masuk...';
  try{
    const session = await RealAdapter.loginKonselor(username, password);
    API_TOKEN = session.sessionToken;
    USER_ROLE = 'konselor';
    KONSELOR_NAMA = session.nama || '';
    KONSELOR_KELAS = session.kelas || [];
    adapter = RealAdapter;
    localStorage.setItem('bk_api_url', API_URL);
    localStorage.setItem('bk_api_token', API_TOKEN);
    localStorage.setItem('bk_role', 'konselor');
    localStorage.setItem('bk_konselor_nama', KONSELOR_NAMA);
    localStorage.setItem('bk_konselor_kelas', JSON.stringify(KONSELOR_KELAS));
    localStorage.removeItem('bk_demo_mode');
    $('#konselorPasswordInput').value = '';
    enterApp();
  }catch(err){
    toast(err.message, 'error');
  }finally{
    btn.disabled = false; btn.innerHTML = originalLabel;
  }
}
$('#konselorLoginBtn').addEventListener('click', submitKonselorLogin);
$('#konselorPasswordInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitKonselorLogin(); });

/* Tampilkan/sembunyikan menu sesuai peran yang login.
   - Guru Mapel: menu dibatasi HANYA ke halaman Pelanggaran (perilaku lama,
     tidak berubah).
   - Konselor (Guru BK): menu tampil LENGKAP seperti Admin (Dashboard, Siswa,
     Absensi, Pelanggaran, Konseling, Kolaborasi, Laporan) karena
     backend juga mengizinkan dia membaca semua data itu (lihat Code.gs).
     Yang tetap disembunyikan hanya tombol Pengaturan & Kelola Akun (Guru
     Mapel/Konselor), karena itu wilayah Admin. Pembatasan sesungguhnya untuk
     Konselor ada di data Konseling itu sendiri (server hanya mengirim &
     menerima data Konseling untuk kelas tanggung jawabnya — lihat Code.gs),
     bukan di penyembunyian menu.
   Ini murni tampilan — backend TETAP menolak akses ke tipe/kelas data yang
   tidak diizinkan walau menu terlihat (lihat Code.gs). */
function applyRoleUI(){
  const isGuru = USER_ROLE === 'guru';
  const isKonselor = USER_ROLE === 'konselor';
  $all('.nav-item[data-page]').forEach(n => n.classList.toggle('hidden', isGuru && n.dataset.page !== 'pelanggaran'));
  $all('.bn-item[data-page]').forEach(n => n.classList.toggle('hidden', isGuru && n.dataset.page !== 'pelanggaran'));
  $('#settingsBtn').classList.toggle('hidden', isGuru || isKonselor);
  $('#settingsBtnMobile').classList.toggle('hidden', isGuru || isKonselor);
  $('#guruAccountsBtn').classList.toggle('hidden', isGuru || isKonselor);
  $('#guruAccountsBtnMobile').classList.toggle('hidden', isGuru || isKonselor);
  $('#konselorAccountsBtn').classList.toggle('hidden', isGuru || isKonselor);
  $('#konselorAccountsBtnMobile').classList.toggle('hidden', isGuru || isKonselor);
  /* Tombol "Keluar" ditampilkan untuk SEMUA peran (Admin, Guru Mapel, maupun
     Konselor) — sebelumnya hanya tampil untuk Guru Mapel/Konselor, sehingga
     Admin yang sesi login-nya otomatis tersimpan (lihat init() di bawah) tidak
     punya cara untuk keluar dan kembali ke layar login awal lewat tampilan. */
  $('#logoutBtn').classList.remove('hidden');
  $('#logoutBtnMobile').classList.remove('hidden');
  const mplBtn = $('#btnMasterPelanggaran');
  if (mplBtn) mplBtn.classList.toggle('hidden', isGuru || isKonselor);
  /* Konselor sekarang boleh MENULIS ke Konseling, Kolaborasi, Absensi, dan
     Pelanggaran (lihat ROLE_WRITABLE_TYPES.konselor di Code.gs) — jadi tombol
     tambah untuk keempat itu TIDAK disembunyikan lagi. Yang tetap disembunyikan
     hanya untuk tipe yang memang masih tertutup total buat Konselor (Data Siswa)
     dan fitur admin-only (Absen Massal, Import Siswa) yang tetap
     ditolak server siapa pun selain Admin. */
  ['#btnAddSiswa','#btnImportSiswa','#btnBulkAbsensi']
    .forEach(sel => { const el = $(sel); if (el) el.classList.toggle('hidden', isKonselor); });
  /* Menu "Kenaikan & Kelulusan" mengelola Data Siswa secara massal (termasuk
     menghapus siswa saat kelulusan) — backend hanya mengizinkan Admin/Guru BK
     utama (lihat assertIsAdmin di Code.gs), jadi disembunyikan juga untuk
     Konselor di tampilan (bukan cuma Guru Mapel yang sudah tertutup lewat
     aturan umum di atas). */
  $all('.nav-item[data-page="kenaikan"]').forEach(n => n.classList.toggle('hidden', isGuru || isKonselor));
  const badge = $('#guruBadge');
  if (badge){
    badge.classList.toggle('hidden', false);
    if (isGuru) badge.textContent = `${GURU_NAMA}${GURU_KELAS.length ? ' · ' + GURU_KELAS.join(', ') : ' · Semua Kelas'}`;
    else if (isKonselor) badge.textContent = `${KONSELOR_NAMA}${KONSELOR_KELAS.length ? ' · Konseling: ' + KONSELOR_KELAS.join(', ') : ' · Konseling: Semua Kelas'}`;
    else badge.textContent = 'Admin BK';
  }
  if (isGuru) goToPage('pelanggaran');
  else if (isKonselor) goToPage('konseling');
}

function logout(){
  API_TOKEN = ''; USER_ROLE = 'admin'; GURU_NAMA = ''; GURU_KELAS = []; KONSELOR_NAMA = ''; KONSELOR_KELAS = [];
  localStorage.removeItem('bk_api_token');
  localStorage.removeItem('bk_role');
  localStorage.removeItem('bk_guru_nama');
  localStorage.removeItem('bk_guru_kelas');
  localStorage.removeItem('bk_konselor_nama');
  localStorage.removeItem('bk_konselor_kelas');
  $('#app').classList.add('hidden');
  $('#setupScreen').classList.remove('hidden');
  // Kembali ke kartu login yang sama seperti pengunjung baru akan lihat (lihat
  // init() di bawah): kalau URL Web App sudah ter-bake (DEFAULT_API_URL),
  // tampilkan dulu form Guru Mapel; kalau tidak, tampilkan kartu Admin/Guru BK
  // utama. Ini juga berlaku saat Admin sendiri yang menekan "Keluar".
  $('#adminSetupCard').classList.toggle('hidden', !!DEFAULT_API_URL);
  $('#guruLoginCard').classList.toggle('hidden', !DEFAULT_API_URL);
  $('#konselorLoginCard').classList.add('hidden');
  $('#guruUsernameInput').value = '';
  $('#guruPasswordInput').value = '';
  $('#konselorUsernameInput').value = '';
  $('#konselorPasswordInput').value = '';
  // Kosongkan ACCESS_TOKEN yang sempat terisi di kartu Admin supaya tidak
  // tertinggal ter-prefill di layar login untuk pengguna berikutnya di
  // perangkat/browser yang sama.
  $('#apiTokenInput').value = '';
}
$('#logoutBtn').addEventListener('click', logout);
$('#logoutBtnMobile').addEventListener('click', () => { closeMoreSheet(); logout(); });

/* demo mode link (added dynamically under the setup note) */
(function addDemoLink(){
  const note = document.querySelector('.setup-note');
  const a = document.createElement('a');
  a.href = '#'; a.textContent = 'Coba mode demo tanpa Google Sheets →';
  a.style.cssText = 'display:inline-block;margin-top:10px;color:var(--primary);font-weight:600;font-size:12.5px;';
  a.addEventListener('click', (e) => {
    e.preventDefault();
    adapter = DemoAdapter;
    DemoAdapter.seedIfEmpty();
    localStorage.setItem('bk_demo_mode','1');
    enterApp();
  });
  note.after(a);
})();

/* ---------------- BACKUP DATABASE (Excel, satu file semua tabel) ----------------
   Murni untuk jaga-jaga: unduh salinan semua data (Siswa, Absensi, Pelanggaran,
   Konseling, Kolaborasi) jadi satu file .xlsx, satu tab per jenis
   data. Tidak mengubah data apapun di Sheet — cuma membaca STATE yang sedang
   dimuat lalu menuliskannya ke file baru di komputer pengguna. */
const BACKUP_SHEET_NAMES = { siswa:'Siswa', absensi:'Absensi', pelanggaran:'Pelanggaran', konseling:'Konseling', kolaborasi:'Kolaborasi' };
function downloadFullBackup(){
  if (!TYPES.some(t => STATE[t] && STATE[t].length)){
    toast('Belum ada data yang bisa di-backup. Muat ulang data terlebih dahulu.', 'error');
    return;
  }
  const wb = XLSX.utils.book_new();
  TYPES.forEach(type => {
    const rows = (STATE[type] || []).map(r => {
      // buang properti internal (mis. _row dari backend) agar file backup bersih
      const { _row, ...clean } = r;
      return clean;
    });
    const ws = rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([['(Belum ada data)']]);
    XLSX.utils.book_append_sheet(wb, ws, BACKUP_SHEET_NAMES[type] || type);
  });
  const lulusRows = (STATE.siswaLulus || []).map(({ _row, ...clean }) => clean);
  XLSX.utils.book_append_sheet(wb, lulusRows.length ? XLSX.utils.json_to_sheet(lulusRows) : XLSX.utils.aoa_to_sheet([['(Belum ada data)']]), 'SiswaLulus');
  const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  XLSX.writeFile(wb, `Backup_BKDigital_${stamp}.xlsx`);
  toast('Backup berhasil diunduh.', 'success');
}

/* Settings button lets user change/reset API URL */
/* Ubah file gambar yang dipilih user jadi base64 data URL yang sudah diperkecil
   (resize + kompres), supaya cukup kecil untuk disimpan dalam SATU sel Google
   Sheets (batas ±50.000 karakter per sel) — bukan cuma disimpan di localStorage. */
function resizeImageToDataUrl(file, maxDim = 512, maxChars = 45000){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        const scale = Math.min(1, maxDim / Math.max(w, h));
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));

        const draw = (cw, ch) => {
          canvas.width = cw; canvas.height = ch;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch); // latar putih agar tidak jadi hitam saat diubah ke JPEG
          ctx.drawImage(img, 0, 0, cw, ch);
        };
        draw(w, h);

        let quality = 0.85;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length > maxChars && quality > 0.35){
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        while (dataUrl.length > maxChars && Math.min(w, h) > 32){
          w = Math.round(w * 0.85); h = Math.round(h * 0.85);
          draw(w, h);
          dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        }
        if (dataUrl.length > maxChars){
          reject(new Error('Gambar terlalu kompleks untuk dijadikan logo. Coba gambar lain yang lebih sederhana (mis. logo polos berbentuk PNG/JPG).'));
          return;
        }
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('File bukan gambar yang valid.'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.readAsDataURL(file);
  });
}

function openSettings(){
  $('#modalTitle').textContent = 'Pengaturan';
  $('#modalBody').innerHTML = `
    <div class="field full backup-box profile-box">
      <label>Profil Sekolah</label>
      <p class="muted" style="margin:2px 0 10px">Tampil di halaman Dashboard. Tersimpan di Google Sheet (sheet "Pengaturan") sehingga otomatis muncul lagi di perangkat/browser manapun yang login ke Web App yang sama.</p>
      <div class="field full" style="margin-bottom:12px">
        <label>Nama Sekolah</label>
        <input type="text" id="settingsSchoolName" value="${escapeHtml(SCHOOL_NAME)}" placeholder="Contoh: SMA Negeri 1 Harapan" />
      </div>
      <div class="field full" style="margin-bottom:12px">
        <label>Tahun Pelajaran Aktif</label>
        <input type="text" id="settingsSchoolYear" value="${escapeHtml(SCHOOL_YEAR)}" placeholder="Contoh: 2025/2026" />
      </div>
      <div class="field full" style="margin-bottom:12px">
        <label>Kota / Tempat Tanda Tangan</label>
        <input type="text" id="settingsSchoolCity" value="${escapeHtml(SCHOOL_CITY)}" placeholder="Contoh: Sragi" />
        <p class="muted" style="margin-top:4px;font-size:11.5px">Dipakai di kaki laporan cetak, contoh: “Sragi, 15 September 2026”.</p>
      </div>
      <div class="field full" style="margin-bottom:12px">
        <label>Nama Guru BK (penanda tangan)</label>
        <input type="text" id="settingsBkName" value="${escapeHtml(SCHOOL_BK_NAME)}" placeholder="Contoh: SURYA IHZA MAHISTA, S.Pd" />
      </div>
      <div class="field full" style="margin-bottom:12px">
        <label>NIP Guru BK</label>
        <input type="text" id="settingsBkNip" value="${escapeHtml(SCHOOL_BK_NIP)}" placeholder="Contoh: 19900101 201501 1 001 (isi - bila tidak ada)" />
      </div>
      <div class="field full" style="margin-bottom:4px">
        <label>Logo Sekolah</label>
        <div class="logo-upload-row">
          <div class="logo-preview" id="settingsLogoPreviewWrap">
            ${SCHOOL_LOGO ? `<img id="settingsLogoPreview" src="${escapeHtml(SCHOOL_LOGO)}" alt="Logo" />` : `<i class="fa-solid fa-image"></i>`}
          </div>
          <div class="logo-upload-actions">
            <input type="file" id="settingsLogoFile" accept="image/*" class="hidden" />
            <button class="btn btn-ghost" id="settingsLogoBtn" type="button"><i class="fa-solid fa-upload"></i> Upload Logo</button>
            <button class="btn btn-ghost" id="settingsLogoRemoveBtn" type="button" style="${SCHOOL_LOGO ? '' : 'display:none'}"><i class="fa-solid fa-trash"></i> Hapus</button>
          </div>
        </div>
        <p class="muted" style="margin-top:6px;font-size:11.5px">Logo otomatis diperkecil & dikompres agar muat disimpan di Google Sheet.</p>
      </div>
      <button class="btn btn-primary" id="settingsProfileSaveBtn" type="button" style="margin-top:14px"><i class="fa-solid fa-check"></i> Simpan Profil Sekolah</button>
    </div>

    <div class="field full" style="margin-bottom:16px">
      <label>URL Web App Google Apps Script</label>
      <input type="url" id="settingsApiUrl" value="${escapeHtml(API_URL)}" placeholder="https://script.google.com/macros/s/xxxxx/exec" />
    </div>
    <div class="field full" style="margin-bottom:16px">
      <label>Token / Kata Sandi Akses</label>
      <input type="password" id="settingsApiToken" value="${escapeHtml(API_TOKEN)}" placeholder="Sesuai ACCESS_TOKEN di Script Properties" />
    </div>
    <div class="field full backup-box">
      <label>Backup Database</label>
      <p class="muted" style="margin:2px 0 10px">Unduh salinan semua data (Siswa, Absensi, Pelanggaran, Konseling, Kolaborasi) jadi satu file Excel — untuk jaga-jaga, tidak mengubah data apapun di Sheet.</p>
      <button class="btn btn-ghost" id="settingsBackupBtn" type="button"><i class="fa-solid fa-file-arrow-down"></i> Unduh Backup (Excel)</button>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="settingsDemoBtn" type="button">Gunakan Mode Demo</button>
      <button class="btn btn-primary" id="settingsSaveBtn" type="button"><i class="fa-solid fa-check"></i> Simpan &amp; Muat Ulang</button>
    </div>`;

  // ---- Profil Sekolah ----
  let pendingLogoDataUrl = SCHOOL_LOGO;
  $('#settingsLogoBtn').addEventListener('click', () => $('#settingsLogoFile').click());
  $('#settingsLogoFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')){ toast('File harus berupa gambar.', 'error'); return; }
    const btn = $('#settingsLogoBtn');
    const originalLabel = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';
    try{
      pendingLogoDataUrl = await resizeImageToDataUrl(file);
      $('#settingsLogoPreviewWrap').innerHTML = `<img id="settingsLogoPreview" src="${escapeHtml(pendingLogoDataUrl)}" alt="Logo" />`;
      $('#settingsLogoRemoveBtn').style.display = '';
    }catch(err){
      toast(err.message, 'error');
    }finally{
      btn.disabled = false; btn.innerHTML = originalLabel;
      e.target.value = '';
    }
  });
  $('#settingsLogoRemoveBtn').addEventListener('click', () => {
    pendingLogoDataUrl = '';
    $('#settingsLogoPreviewWrap').innerHTML = `<i class="fa-solid fa-image"></i>`;
    $('#settingsLogoRemoveBtn').style.display = 'none';
  });
  $('#settingsProfileSaveBtn').addEventListener('click', async () => {
    const name = $('#settingsSchoolName').value.trim();
    const year = $('#settingsSchoolYear').value.trim();
    const city = $('#settingsSchoolCity').value.trim();
    const bkName = $('#settingsBkName').value.trim();
    const bkNip = $('#settingsBkNip').value.trim();
    const logo = pendingLogoDataUrl || '';
    const btn = $('#settingsProfileSaveBtn');
    const originalLabel = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
    try{
      await adapter.saveSettings({ NamaSekolah: name, TahunPelajaran: year, LogoSekolah: logo,
        KotaSekolah: city, NamaGuruBK: bkName, NipGuruBK: bkNip });
      SCHOOL_NAME = name; SCHOOL_YEAR = year; SCHOOL_LOGO = logo;
      SCHOOL_CITY = city; SCHOOL_BK_NAME = bkName; SCHOOL_BK_NIP = bkNip;
      localStorage.setItem('bk_school_city', SCHOOL_CITY);
      localStorage.setItem('bk_school_bk_name', SCHOOL_BK_NAME);
      localStorage.setItem('bk_school_bk_nip', SCHOOL_BK_NIP);
      localStorage.setItem('bk_school_name', SCHOOL_NAME);
      localStorage.setItem('bk_school_year', SCHOOL_YEAR);
      if (SCHOOL_LOGO) localStorage.setItem('bk_school_logo', SCHOOL_LOGO);
      else localStorage.removeItem('bk_school_logo');
      renderSchoolProfile();
      toast('Profil sekolah disimpan ke Google Sheet.', 'success');
    }catch(err){
      toast('Gagal menyimpan profil sekolah: ' + err.message, 'error');
    }finally{
      btn.disabled = false; btn.innerHTML = originalLabel;
    }
  });

  // ---- Koneksi & backup ----
  $('#settingsBackupBtn').addEventListener('click', downloadFullBackup);
  $('#settingsSaveBtn').addEventListener('click', () => {
    const val = $('#settingsApiUrl').value.trim();
    const tokenVal = $('#settingsApiToken').value.trim();
    if (!val){ toast('URL tidak boleh kosong.', 'error'); return; }
    API_URL = val; API_TOKEN = tokenVal; adapter = RealAdapter;
    localStorage.setItem('bk_api_url', API_URL);
    localStorage.setItem('bk_api_token', API_TOKEN);
    localStorage.removeItem('bk_demo_mode');
    closeModal(); loadAll(); toast('Pengaturan disimpan.', 'success');
  });
  $('#settingsDemoBtn').addEventListener('click', () => {
    adapter = DemoAdapter; DemoAdapter.seedIfEmpty();
    localStorage.setItem('bk_demo_mode','1');
    closeModal(); loadAll(); toast('Mode demo diaktifkan.', 'success');
  });
  openModal();
}
$('#settingsBtn').addEventListener('click', openSettings);
$('#settingsBtnMobile').addEventListener('click', () => { closeMoreSheet(); openSettings(); });
$('#guruAccountsBtn').addEventListener('click', () => openGuruAccounts());
$('#guruAccountsBtnMobile').addEventListener('click', () => { closeMoreSheet(); openGuruAccounts(); });
$('#konselorAccountsBtn').addEventListener('click', () => openKonselorAccounts());
$('#konselorAccountsBtnMobile').addEventListener('click', () => { closeMoreSheet(); openKonselorAccounts(); });

/* ---------------- KELOLA AKUN GURU MAPEL ----------------
   Admin/Guru BK menambah, mengedit, dan menghapus akun login guru mapel
   dari sini. Kelas diketik dipisah koma (mis. "VII-A, VII-B") — itulah
   satu-satunya kelas yang bisa dilihat/dicatat pelanggarannya oleh akun ini,
   ditegakkan di server (lihat Code.gs), bukan cuma disembunyikan di tampilan. */
function openGuruAccounts(){
  $('#modalTitle').textContent = 'Kelola Akun Guru Mapel';
  let editingId = null;

  $('#modalBody').innerHTML = `
    <p class="muted" style="margin:0 0 14px">Setiap akun di bawah bisa login (tanpa perlu tahu URL Web App/token) dan hanya melihat &amp; mencatat Pelanggaran untuk kelas yang kamu tulis di sini.</p>
    <form id="guruAccountForm">
      <div class="form-grid">
        <div class="field"><label>Nama Guru</label>
          <input type="text" id="gaNama" placeholder="Contoh: Budi Santoso, S.Pd" required />
        </div>
        <div class="field"><label>Username</label>
          <input type="text" id="gaUsername" placeholder="Contoh: budi.santoso" required autocomplete="off" />
        </div>
        <div class="field"><label>Password</label>
          <input type="text" id="gaPassword" placeholder="${'Isi/ganti password'}" />
        </div>
        <div class="field"><label>Status</label>
          <select id="gaStatus">
            <option value="Aktif">Aktif</option>
            <option value="Nonaktif">Nonaktif</option>
          </select>
        </div>
        <div class="field full"><label>Kelas Tanggung Jawab</label>
          <input type="text" id="gaKelas" placeholder="Contoh: VII-A, VII-B (pisahkan dengan koma) — kosongkan untuk akses ke SEMUA kelas" />
        </div>
      </div>
      <p class="muted" style="margin:-8px 0 14px">Kosongkan kolom Kelas kalau guru ini boleh mencatat pelanggaran untuk semua kelas, bukan hanya kelas tertentu.</p>
      <div class="modal-actions" style="justify-content:flex-start; margin-bottom:18px">
        <button type="submit" class="btn btn-primary" id="gaSubmitBtn"><i class="fa-solid fa-plus"></i> Tambah Akun</button>
        <button type="button" class="btn btn-ghost hidden" id="gaCancelEditBtn">Batal Edit</button>
      </div>
    </form>
    <div class="bulk-siswa-list" id="gaList" style="max-height:280px"></div>
    <div class="field full backup-box" style="margin-top:14px">
      <label>Import Banyak Akun Sekaligus dari Excel</label>
      <p class="muted" style="margin:2px 0 10px">Unduh template, isi daftar guru di Excel, lalu upload lagi. Akun yang Username-nya sudah ada akan dilewati (tidak menimpa password yang sudah ada).</p>
      <div style="display:flex; gap:8px; flex-wrap:wrap">
        <button class="btn btn-ghost" id="btnDownloadGuruTemplate" type="button"><i class="fa-solid fa-file-arrow-down"></i> Unduh Template</button>
        <button class="btn btn-ghost" id="btnImportGuru" type="button"><i class="fa-solid fa-file-arrow-up"></i> Import dari Excel</button>
        <input type="file" id="importGuruFile" accept=".xlsx,.xls,.csv" class="hidden" />
      </div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" id="gaCloseBtn">Tutup</button>
    </div>`;

  function renderList(){
    const list = $('#gaList');
    const rows = STATE.guru.slice().sort((a,b) => (a.Nama||'').localeCompare(b.Nama||''));
    if (!rows.length){
      list.innerHTML = `<p class="muted" style="padding:8px">Belum ada akun Guru Mapel. Tambahkan lewat form di atas.</p>`;
      return;
    }
    list.innerHTML = rows.map(g => `
      <div class="bulk-item mpl-item">
        <span class="mpl-info"><b>${escapeHtml(g.Nama||'-')}</b> <span class="muted">· @${escapeHtml(g.Username||'-')} · ${g.Kelas ? escapeHtml(g.Kelas) : 'Semua Kelas'} · ${escapeHtml(g.Status||'Aktif')}</span></span>
        <span class="search-dd-actions">
          <button type="button" class="icon-btn-sm" data-ga-edit="${escapeHtml(g.ID)}" title="Edit"><i class="fa-solid fa-pen"></i></button>
          <button type="button" class="icon-btn-sm danger" data-ga-del="${escapeHtml(g.ID)}" title="Hapus"><i class="fa-solid fa-trash"></i></button>
        </span>
      </div>`).join('');
  }
  renderList();

  $('#gaList').addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-ga-edit]');
    const delBtn = e.target.closest('[data-ga-del]');
    if (editBtn){
      const g = STATE.guru.find(o => String(o.ID)===String(editBtn.dataset.gaEdit));
      if (!g) return;
      editingId = g.ID;
      $('#gaNama').value = g.Nama || '';
      $('#gaUsername').value = g.Username || '';
      $('#gaPassword').value = '';
      $('#gaPassword').placeholder = 'Kosongkan jika tidak ingin mengubah password';
      $('#gaStatus').value = g.Status || 'Aktif';
      $('#gaKelas').value = g.Kelas || '';
      $('#gaSubmitBtn').innerHTML = '<i class="fa-solid fa-check"></i> Update Akun';
      $('#gaCancelEditBtn').classList.remove('hidden');
      $('#gaNama').focus();
      return;
    }
    if (delBtn){
      if (!confirm('Hapus akun guru mapel ini? Guru yang bersangkutan tidak akan bisa login lagi.')) return;
      const id = delBtn.dataset.gaDel;
      try{
        await adapter.delete('guru', id);
        STATE.guru = STATE.guru.filter(o => String(o.ID)!==String(id));
        renderList();
        toast('Akun guru mapel dihapus.', 'success');
      }catch(err){
        toast(err.message, 'error');
      }
    }
  });

  $('#gaCancelEditBtn').addEventListener('click', () => {
    editingId = null;
    $('#guruAccountForm').reset();
    $('#gaPassword').placeholder = 'Isi/ganti password';
    $('#gaSubmitBtn').innerHTML = '<i class="fa-solid fa-plus"></i> Tambah Akun';
    $('#gaCancelEditBtn').classList.add('hidden');
  });

  $('#guruAccountForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nama = $('#gaNama').value.trim();
    const username = $('#gaUsername').value.trim();
    const password = $('#gaPassword').value;
    const status = $('#gaStatus').value;
    const kelas = $('#gaKelas').value.trim();
    if (!nama || !username){ toast('Nama dan Username wajib diisi.', 'error'); return; }
    if (!editingId && !password){ toast('Password wajib diisi untuk akun baru.', 'error'); return; }
    const btn = $('#gaSubmitBtn');
    const originalLabel = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
    try{
      const data = { Nama: nama, Username: username, Status: status, Kelas: kelas };
      if (password) data.Password = password;
      if (editingId){
        const updated = await adapter.update('guru', editingId, data);
        const idx = STATE.guru.findIndex(o => String(o.ID)===String(editingId));
        if (idx > -1) STATE.guru[idx] = { ...STATE.guru[idx], ...updated, ...data, ID: editingId };
        toast('Akun guru mapel diperbarui.', 'success');
      } else {
        const created = await adapter.create('guru', data);
        STATE.guru.push({ ...data, ...created });
        toast('Akun guru mapel ditambahkan.', 'success');
      }
      editingId = null;
      $('#guruAccountForm').reset();
      $('#gaPassword').placeholder = 'Isi/ganti password';
      $('#gaSubmitBtn').innerHTML = '<i class="fa-solid fa-plus"></i> Tambah Akun';
      $('#gaCancelEditBtn').classList.add('hidden');
      renderList();
    }catch(err){
      toast(err.message, 'error');
    }finally{
      btn.disabled = false; btn.innerHTML = originalLabel;
    }
  });

  $('#gaCloseBtn').addEventListener('click', closeModal);

  /* ---- Import banyak akun guru sekaligus dari Excel ----
     Kolom Kelas boleh dikosongkan di template -> guru itu otomatis dapat
     akses ke SEMUA kelas (lihat kelasListIncludes() di Code.gs). Username
     yang sudah ada di database DILEWATI (tidak menimpa password lama),
     sama seperti prinsip import Data Siswa. */
  const GURU_TEMPLATE_COLUMNS = ['Nama','Username','Password','Kelas','Status'];
  function downloadGuruTemplate(){
    const contoh = { Nama:'Budi Santoso, S.Pd', Username:'budi.santoso', Password:'password123', Kelas:'VII-A, VII-B', Status:'Aktif' };
    const contoh2 = { Nama:'Siti Aminah, S.Pd', Username:'siti.aminah', Password:'password123', Kelas:'', Status:'Aktif' };
    const ws = XLSX.utils.json_to_sheet([contoh, contoh2], { header: GURU_TEMPLATE_COLUMNS });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Guru');
    XLSX.writeFile(wb, 'Template_Import_AkunGuru_BKDigital.xlsx');
  }
  $('#btnDownloadGuruTemplate').addEventListener('click', downloadGuruTemplate);

  $('#btnImportGuru').addEventListener('click', () => $('#importGuruFile').click());
  $('#importGuruFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    showLoading(true);
    try{
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type:'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval:'' });
      const cleaned = rows
        .map(r => {
          const o = {};
          GURU_TEMPLATE_COLUMNS.forEach(c => { o[c] = (r[c] !== undefined ? String(r[c]).trim() : ''); });
          if (!o.Status) o.Status = 'Aktif';
          return o;
        })
        .filter(r => r.Nama && r.Username && r.Password); // baris tanpa Nama/Username/Password diabaikan
      if (!cleaned.length){ toast('Tidak ada baris valid (butuh minimal kolom Nama, Username & Password).', 'error'); return; }
      const result = await adapter.importBulk('guru', cleaned, 'Username');
      const batch = await adapter.getAllBatch();
      STATE.guru = batch.guru || [];
      renderList();
      toast(`Import selesai: ${result.added} akun guru baru ditambahkan, ${result.skipped} dilewati (Username sudah ada).`, 'success');
    }catch(err){
      toast('Gagal mengimpor file: ' + err.message, 'error');
    }finally{
      showLoading(false);
      e.target.value = '';
    }
  });

  openModal();
}

/* ---------------- KELOLA AKUN KONSELOR (GURU BK PER-KELAS) ----------------
   Sama persis polanya dengan openGuruAccounts(), tapi untuk sheet "Konselor"
   dan menu Konseling: setiap akun di sini hanya bisa login (tanpa perlu tahu
   URL Web App/token) dan hanya melihat & mencatat KONSELING untuk kelas yang
   kamu tulis di sini — cocok dipakai supaya masing-masing Guru BK di sekolah
   yang sama hanya mengelola laporan konseling murid asuhnya sendiri.
   "Password" di sini bisa diisi PIN pendek (mis. 4-6 digit) kalau mau lebih
   simpel buat Guru BK — nilainya tetap disimpan sebagai teks di sheet, jadi
   bebas dipilih Admin selama mudah diingat & tidak mudah ditebak orang lain. */
function openKonselorAccounts(){
  $('#modalTitle').textContent = 'Kelola Akun Guru BK (Konselor)';
  let editingId = null;

  $('#modalBody').innerHTML = `
    <p class="muted" style="margin:0 0 14px">Setiap akun di bawah bisa login (tanpa perlu tahu URL Web App/token) dan hanya melihat &amp; mencatat <b>Konseling</b> untuk siswa di kelas yang kamu tulis di sini. Password bisa diisi PIN pendek supaya mudah diingat.</p>
    <form id="konselorAccountForm">
      <div class="form-grid">
        <div class="field"><label>Nama Guru BK</label>
          <input type="text" id="kaNama" placeholder="Contoh: Ratna Wijaya, S.Pd" required />
        </div>
        <div class="field"><label>Username</label>
          <input type="text" id="kaUsername" placeholder="Contoh: ratna.wijaya" required autocomplete="off" />
        </div>
        <div class="field"><label>Password / PIN</label>
          <input type="text" id="kaPassword" placeholder="${'Isi/ganti password atau PIN'}" />
        </div>
        <div class="field"><label>Status</label>
          <select id="kaStatus">
            <option value="Aktif">Aktif</option>
            <option value="Nonaktif">Nonaktif</option>
          </select>
        </div>
        <div class="field full"><label>Kelas Tanggung Jawab</label>
          <input type="text" id="kaKelas" placeholder="Contoh: VII-A, VII-B (pisahkan dengan koma) — kosongkan untuk akses ke SEMUA kelas" />
        </div>
      </div>
      <p class="muted" style="margin:-8px 0 14px">Kosongkan kolom Kelas kalau Guru BK ini boleh mencatat konseling untuk semua kelas, bukan hanya kelas tertentu.</p>
      <div class="modal-actions" style="justify-content:flex-start; margin-bottom:18px">
        <button type="submit" class="btn btn-primary" id="kaSubmitBtn"><i class="fa-solid fa-plus"></i> Tambah Akun</button>
        <button type="button" class="btn btn-ghost hidden" id="kaCancelEditBtn">Batal Edit</button>
      </div>
    </form>
    <div class="bulk-siswa-list" id="kaList" style="max-height:280px"></div>
    <div class="field full backup-box" style="margin-top:14px">
      <label>Import Banyak Akun Sekaligus dari Excel</label>
      <p class="muted" style="margin:2px 0 10px">Unduh template, isi daftar Guru BK di Excel, lalu upload lagi. Akun yang Username-nya sudah ada akan dilewati (tidak menimpa password/PIN yang sudah ada).</p>
      <div style="display:flex; gap:8px; flex-wrap:wrap">
        <button class="btn btn-ghost" id="btnDownloadKonselorTemplate" type="button"><i class="fa-solid fa-file-arrow-down"></i> Unduh Template</button>
        <button class="btn btn-ghost" id="btnImportKonselor" type="button"><i class="fa-solid fa-file-arrow-up"></i> Import dari Excel</button>
        <input type="file" id="importKonselorFile" accept=".xlsx,.xls,.csv" class="hidden" />
      </div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" id="kaCloseBtn">Tutup</button>
    </div>`;

  function renderList(){
    const list = $('#kaList');
    const rows = STATE.konselor.slice().sort((a,b) => (a.Nama||'').localeCompare(b.Nama||''));
    if (!rows.length){
      list.innerHTML = `<p class="muted" style="padding:8px">Belum ada akun Guru BK (Konselor). Tambahkan lewat form di atas.</p>`;
      return;
    }
    list.innerHTML = rows.map(k => `
      <div class="bulk-item mpl-item">
        <span class="mpl-info"><b>${escapeHtml(k.Nama||'-')}</b> <span class="muted">· @${escapeHtml(k.Username||'-')} · ${k.Kelas ? escapeHtml(k.Kelas) : 'Semua Kelas'} · ${escapeHtml(k.Status||'Aktif')}</span></span>
        <span class="search-dd-actions">
          <button type="button" class="icon-btn-sm" data-ka-edit="${escapeHtml(k.ID)}" title="Edit"><i class="fa-solid fa-pen"></i></button>
          <button type="button" class="icon-btn-sm danger" data-ka-del="${escapeHtml(k.ID)}" title="Hapus"><i class="fa-solid fa-trash"></i></button>
        </span>
      </div>`).join('');
  }
  renderList();

  $('#kaList').addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-ka-edit]');
    const delBtn = e.target.closest('[data-ka-del]');
    if (editBtn){
      const k = STATE.konselor.find(o => String(o.ID)===String(editBtn.dataset.kaEdit));
      if (!k) return;
      editingId = k.ID;
      $('#kaNama').value = k.Nama || '';
      $('#kaUsername').value = k.Username || '';
      $('#kaPassword').value = '';
      $('#kaPassword').placeholder = 'Kosongkan jika tidak ingin mengubah password/PIN';
      $('#kaStatus').value = k.Status || 'Aktif';
      $('#kaKelas').value = k.Kelas || '';
      $('#kaSubmitBtn').innerHTML = '<i class="fa-solid fa-check"></i> Update Akun';
      $('#kaCancelEditBtn').classList.remove('hidden');
      $('#kaNama').focus();
      return;
    }
    if (delBtn){
      if (!confirm('Hapus akun Guru BK (Konselor) ini? Guru BK yang bersangkutan tidak akan bisa login lagi.')) return;
      const id = delBtn.dataset.kaDel;
      try{
        await adapter.delete('konselor', id);
        STATE.konselor = STATE.konselor.filter(o => String(o.ID)!==String(id));
        renderList();
        toast('Akun Guru BK dihapus.', 'success');
      }catch(err){
        toast(err.message, 'error');
      }
    }
  });

  $('#kaCancelEditBtn').addEventListener('click', () => {
    editingId = null;
    $('#konselorAccountForm').reset();
    $('#kaPassword').placeholder = 'Isi/ganti password atau PIN';
    $('#kaSubmitBtn').innerHTML = '<i class="fa-solid fa-plus"></i> Tambah Akun';
    $('#kaCancelEditBtn').classList.add('hidden');
  });

  $('#konselorAccountForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nama = $('#kaNama').value.trim();
    const username = $('#kaUsername').value.trim();
    const password = $('#kaPassword').value;
    const status = $('#kaStatus').value;
    const kelas = $('#kaKelas').value.trim();
    if (!nama || !username){ toast('Nama dan Username wajib diisi.', 'error'); return; }
    if (!editingId && !password){ toast('Password/PIN wajib diisi untuk akun baru.', 'error'); return; }
    const btn = $('#kaSubmitBtn');
    const originalLabel = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
    try{
      const data = { Nama: nama, Username: username, Status: status, Kelas: kelas };
      if (password) data.Password = password;
      if (editingId){
        const updated = await adapter.update('konselor', editingId, data);
        const idx = STATE.konselor.findIndex(o => String(o.ID)===String(editingId));
        if (idx > -1) STATE.konselor[idx] = { ...STATE.konselor[idx], ...updated, ...data, ID: editingId };
        toast('Akun Guru BK diperbarui.', 'success');
      } else {
        const created = await adapter.create('konselor', data);
        STATE.konselor.push({ ...data, ...created });
        toast('Akun Guru BK ditambahkan.', 'success');
      }
      editingId = null;
      $('#konselorAccountForm').reset();
      $('#kaPassword').placeholder = 'Isi/ganti password atau PIN';
      $('#kaSubmitBtn').innerHTML = '<i class="fa-solid fa-plus"></i> Tambah Akun';
      $('#kaCancelEditBtn').classList.add('hidden');
      renderList();
    }catch(err){
      toast(err.message, 'error');
    }finally{
      btn.disabled = false; btn.innerHTML = originalLabel;
    }
  });

  $('#kaCloseBtn').addEventListener('click', closeModal);

  /* ---- Import banyak akun Konselor sekaligus dari Excel ----
     Kolom Kelas boleh dikosongkan di template -> Guru BK itu otomatis dapat
     akses ke SEMUA kelas. Username yang sudah ada di database DILEWATI
     (tidak menimpa password/PIN lama), sama seperti prinsip import akun
     Guru Mapel. */
  const KONSELOR_TEMPLATE_COLUMNS = ['Nama','Username','Password','Kelas','Status'];
  function downloadKonselorTemplate(){
    const contoh = { Nama:'Ratna Wijaya, S.Pd', Username:'ratna.wijaya', Password:'123456', Kelas:'VIII-A, VIII-B', Status:'Aktif' };
    const contoh2 = { Nama:'Andi Saputra, S.Pd', Username:'andi.saputra', Password:'654321', Kelas:'', Status:'Aktif' };
    const ws = XLSX.utils.json_to_sheet([contoh, contoh2], { header: KONSELOR_TEMPLATE_COLUMNS });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Konselor');
    XLSX.writeFile(wb, 'Template_Import_AkunKonselor_BKDigital.xlsx');
  }
  $('#btnDownloadKonselorTemplate').addEventListener('click', downloadKonselorTemplate);

  $('#btnImportKonselor').addEventListener('click', () => $('#importKonselorFile').click());
  $('#importKonselorFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    showLoading(true);
    try{
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type:'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval:'' });
      const cleaned = rows
        .map(r => {
          const o = {};
          KONSELOR_TEMPLATE_COLUMNS.forEach(c => { o[c] = (r[c] !== undefined ? String(r[c]).trim() : ''); });
          if (!o.Status) o.Status = 'Aktif';
          return o;
        })
        .filter(r => r.Nama && r.Username && r.Password); // baris tanpa Nama/Username/Password diabaikan
      if (!cleaned.length){ toast('Tidak ada baris valid (butuh minimal kolom Nama, Username & Password).', 'error'); return; }
      const result = await adapter.importBulk('konselor', cleaned, 'Username');
      const batch = await adapter.getAllBatch();
      STATE.konselor = batch.konselor || [];
      renderList();
      toast(`Import selesai: ${result.added} akun Guru BK baru ditambahkan, ${result.skipped} dilewati (Username sudah ada).`, 'success');
    }catch(err){
      toast('Gagal mengimpor file: ' + err.message, 'error');
    }finally{
      showLoading(false);
      e.target.value = '';
    }
  });

  openModal();
}

/* ---------------- MOBILE HAMBURGER (opens sidebar-equivalent: more sheet w/ full nav) ---------------- */
$('#hamburgerBtn').addEventListener('click', openMoreSheet);

/* ---------------- INIT ---------------- */
(function init(){
  if (localStorage.getItem('bk_demo_mode') === '1'){
    adapter = DemoAdapter; DemoAdapter.seedIfEmpty(); enterApp();
    return;
  }
  if (API_URL && API_TOKEN){
    // Ada sesi tersimpan (admin ATAU guru mapel yang sudah pernah login) —
    // langsung masuk, applyRoleUI() di dalam enterApp() yang menentukan
    // tampilannya sesuai USER_ROLE yang tersimpan.
    $('#apiUrlInput').value = API_URL;
    $('#apiTokenInput').value = API_TOKEN;
    adapter = RealAdapter; enterApp();
    return;
  }
  // Belum ada sesi aktif -> tampilkan layar login. Kalau URL Web App sudah
  // ter-bake (DEFAULT_API_URL diisi admin saat deploy), asumsikan mayoritas
  // pengunjung adalah Guru Mapel dan langsung tampilkan form Username/Password
  // itu duluan, supaya mereka tidak perlu klik "Login sebagai Guru Mapel" dulu.
  if (DEFAULT_API_URL){
    $('#adminSetupCard').classList.add('hidden');
    $('#guruLoginCard').classList.remove('hidden');
  }
})();
