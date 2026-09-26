/* ============================================================
   BK DIGITAL — PWA per sekolah
   Ikon aplikasi, nama, splash screen & tombol "Install" otomatis
   memakai LOGO + NAMA SEKOLAH yang diupload di Pengaturan.
   - Android/Chrome/Edge (HP & PC): manifest dibuat dinamis; splash
     bawaan Android otomatis memakai ikon + nama + warna latar dari sini.
   - iPhone/iPad: apple-touch-icon & apple-touch-startup-image dibuat dinamis.
   - Splash di dalam aplikasi (saat dibuka dari ikon) juga pakai logo sekolah.
   ============================================================ */
(function(){
  'use strict';
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const THEME = '#2F6F63';
  let lastSig = '', manifestUrl = '', deferredPrompt = null;

  // ---------- service worker ----------
  if ('serviceWorker' in navigator){
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  // ---------- helpers gambar ----------
  function loadImg(src){
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  }
  // Gambar logo di tengah kanvas persegi (latar putih). ratio = porsi logo terhadap sisi kanvas.
  function makeIcon(img, size, ratio){
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d');
    x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, size, size);
    x.imageSmoothingQuality = 'high';
    const s = Math.min(size * ratio / img.width, size * ratio / img.height);
    const w = img.width * s, h = img.height * s;
    x.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    return c.toDataURL('image/png');
  }
  function makeSplash(img, name){
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(screen.width * dpr), H = Math.round(screen.height * dpr);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, W, H);
    const box = Math.min(W, H) * 0.32;
    const s = Math.min(box / img.width, box / img.height);
    const w = img.width * s, h = img.height * s, cy = H * 0.42;
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, (W - w) / 2, cy - h / 2, w, h);
    x.fillStyle = '#1B2430'; x.textAlign = 'center';
    x.font = `700 ${Math.round(W * 0.05)}px sans-serif`;
    x.fillText(name, W / 2, cy + h / 2 + W * 0.09, W * 0.86);
    x.fillStyle = '#5B6472'; x.font = `500 ${Math.round(W * 0.035)}px sans-serif`;
    x.fillText('BK Digital', W / 2, cy + h / 2 + W * 0.15);
    return { url: c.toDataURL('image/png'), dpr, w: screen.width, h: screen.height };
  }
  function setLink(rel, attrs){
    let l = document.querySelector(`link[rel="${rel}"]${attrs.dataKey ? '[data-k="' + attrs.dataKey + '"]' : ''}`);
    if (!l){ l = document.createElement('link'); l.rel = rel; if (attrs.dataKey) l.dataset.k = attrs.dataKey; document.head.appendChild(l); }
    Object.keys(attrs).forEach(k => { if (k !== 'dataKey') l.setAttribute(k, attrs[k]); });
  }
  function setMeta(name, content){
    let m = document.querySelector(`meta[name="${name}"]`);
    if (!m){ m = document.createElement('meta'); m.name = name; document.head.appendChild(m); }
    m.content = content;
  }

  // ---------- identitas sekolah -> manifest / ikon ----------
  async function updatePwaIdentity(){
    const logo = localStorage.getItem('bk_school_logo') || '';
    const name = (localStorage.getItem('bk_school_name') || '').trim();
    const sig = name + '|' + logo.length + '|' + logo.slice(-40);
    if (sig === lastSig) return;
    lastSig = sig;

    const title = name || 'BK Digital';
    setMeta('apple-mobile-web-app-capable', 'yes');
    setMeta('mobile-web-app-capable', 'yes');
    setMeta('apple-mobile-web-app-title', title);
    setMeta('apple-mobile-web-app-status-bar-style', 'default');
    setMeta('theme-color', THEME);
    if (!logo) return; // belum ada logo -> pakai manifest.json & ikon bawaan

    try{
      const img = await loadImg(logo);
      const any192 = makeIcon(img, 192, 0.88), any512 = makeIcon(img, 512, 0.88);
      const mask192 = makeIcon(img, 192, 0.62), mask512 = makeIcon(img, 512, 0.62);
      const base = new URL('./', location.href).href;
      const manifest = {
        name: name ? `BK Digital — ${name}` : 'BK Digital — Sistem Bimbingan Konseling',
        short_name: title.length > 24 ? title.slice(0, 24) : title,
        description: 'Aplikasi Bimbingan & Konseling ' + (name || 'sekolah'),
        id: base, start_url: base + 'index.html', scope: base,
        display: 'standalone', orientation: 'any', lang: 'id',
        background_color: '#FFFFFF', theme_color: THEME,
        icons: [
          { src: any192, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: any512, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: mask192, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: mask512, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      };
      const old = manifestUrl;
      manifestUrl = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' }));
      setLink('manifest', { href: manifestUrl });
      if (old) setTimeout(() => URL.revokeObjectURL(old), 10000);

      const touch = makeIcon(img, 180, 0.88);
      setLink('apple-touch-icon', { href: touch, sizes: '180x180' });
      setLink('icon', { href: makeIcon(img, 64, 0.9), type: 'image/png' });

      if (isIOS){
        const sp = makeSplash(img, title);
        setLink('apple-touch-startup-image', {
          dataKey: 'splash', href: sp.url,
          media: `(device-width: ${sp.w}px) and (device-height: ${sp.h}px) and (-webkit-device-pixel-ratio: ${sp.dpr}) and (orientation: portrait)`
        });
      }
    }catch(e){ /* logo rusak -> biarkan manifest bawaan */ }
    refreshLoginBrand();
  }
  window.updatePwaIdentity = updatePwaIdentity;

  // ---------- logo di kartu login ----------
  function refreshLoginBrand(){
    const logo = localStorage.getItem('bk_school_logo') || '';
    const name = localStorage.getItem('bk_school_name') || '';
    document.querySelectorAll('.setup-card').forEach(card => {
      let b = card.querySelector('.login-brand');
      if (!logo){ if (b) b.remove(); return; }
      if (!b){ b = document.createElement('div'); b.className = 'login-brand'; b.innerHTML = '<img alt="Logo sekolah"><span></span>'; card.insertBefore(b, card.firstChild); }
      b.querySelector('img').src = logo;
      b.querySelector('span').textContent = name;
    });
  }

  // ---------- tombol Install ----------
  function refreshInstallButtons(){
    const show = !isStandalone() && (deferredPrompt || isIOS);
    document.querySelectorAll('.pwa-install-btn').forEach(b => b.classList.toggle('hidden', !show));
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; refreshInstallButtons(); });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; refreshInstallButtons(); });
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.pwa-install-btn');
    if (!btn) return;
    e.preventDefault();
    if (deferredPrompt){
      deferredPrompt.prompt();
      await deferredPrompt.userChoice.catch(() => {});
      deferredPrompt = null; refreshInstallButtons();
    } else if (isIOS){
      alert('Cara memasang di iPhone/iPad:\n1. Buka lewat Safari\n2. Ketuk tombol Bagikan (kotak dengan panah ke atas)\n3. Pilih "Tambah ke Layar Utama"');
    }
  });

  // ---------- splash di dalam aplikasi (hanya saat dibuka dari ikon) ----------
  function hideSplash(){
    const s = document.getElementById('appSplash'); if (!s) return;
    s.classList.add('out'); setTimeout(() => s.remove(), 500);
  }
  const t0 = Date.now();
  window.addEventListener('load', () => setTimeout(hideSplash, Math.max(0, 1100 - (Date.now() - t0))));

  refreshLoginBrand();
  refreshInstallButtons();
  updatePwaIdentity();
})();
