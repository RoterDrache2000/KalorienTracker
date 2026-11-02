// Service Worker: macht die App offline nutzbar. Bei Änderungen VERSION erhöhen.
const VERSION = 'kalorien-v1.0.0';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/db.js', 'js/basis.js', 'js/off.js', 'js/scanner.js', 'js/parser.js', 'js/ocr.js', 'js/goals.js', 'js/util.js',
  'fonts/figtree.woff2', 'fonts/bricolage.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
  'vendor/zxing/zxing.min.js', 'vendor/tesseract/tesseract.min.js', 'vendor/tesseract/worker.min.js',
];
// Große Dateien der Texterkennung werden beim ersten Gebrauch gespeichert (nur die passende Variante).
const RUNTIME = 'kalorien-runtime-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Open Food Facts usw. direkt
  if (url.pathname.includes('/vendor/tesseract/core/') || url.pathname.includes('/vendor/tesseract/lang/')) {
    e.respondWith(
      caches.open(RUNTIME).then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) c.put(e.request, res.clone());
        return res;
      })
    );
    return;
  }
  // App-Dateien: sofort aus dem Speicher, im Hintergrund aktualisieren
  e.respondWith(
    caches.open(VERSION).then(async (c) => {
      const hit = await c.match(e.request, { ignoreSearch: true });
      const net = fetch(e.request).then((res) => { if (res.ok) c.put(e.request, res.clone()); return res; }).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      return (await net) || (e.request.mode === 'navigate' ? c.match('index.html') : Response.error());
    })
  );
});
