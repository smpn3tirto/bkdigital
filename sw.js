/* ============================================================
   BK DIGITAL — SERVICE WORKER
   ------------------------------------------------------------
   Tujuan file ini CUMA supaya aplikasi memenuhi syarat "installable"
   sebagai PWA (bisa di-Install lewat Chrome/Edge dan muncul sebagai
   ikon aplikasi sendiri di Desktop/Start Menu/taskbar), BUKAN untuk
   membuat aplikasi bisa dipakai penuh secara offline — karena aplikasi
   ini butuh koneksi ke Google Apps Script (Google Sheet) untuk
   membaca/menyimpan data, jadi tetap butuh internet saat dipakai.

   Strategi cache sengaja "network-first" (selalu coba ambil versi
   TERBARU dari jaringan dulu; cache cuma dipakai kalau sedang offline)
   supaya update kode di GitHub Pages langsung kepakai begitu di-refresh,
   tidak pernah "nyangkut" di versi lama gara-gara cache browser.
   Setiap kali file ini di-deploy ulang, ganti CACHE_VERSION di bawah
   supaya service worker lama otomatis diganti & cache lama dibersihkan.
   ============================================================ */
const CACHE_VERSION = 'bkdigital-v3';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './pwa.js'
];

self.addEventListener('install', (event) => {
  // Langsung aktif tanpa nunggu tab lama ditutup, supaya update service
  // worker (dan jadinya cache) tidak butuh reload manual berkali-kali.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL).catch(() => {
      // Kalau salah satu gagal di-cache (mis. offline saat install pertama),
      // jangan sampai bikin instalasi service worker gagal total.
    }))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Cuma tangani permintaan GET dari origin sendiri (file app shell). Semua
  // panggilan lain — terutama ke Google Apps Script (data siswa/absensi/dst),
  // Google Fonts, dan Font Awesome CDN — dibiarkan lewat langsung ke jaringan
  // apa adanya, TIDAK pernah di-cache, supaya data selalu yang terbaru.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin){
    return;
  }
  event.respondWith(
    fetch(req)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(req, resClone));
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
  );
});
