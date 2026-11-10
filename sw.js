// Service Worker: macht die App offline nutzbar. Bei Änderungen VERSION erhöhen.
const VERSION = 'kalorien-v1.6.0';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/db.js', 'js/basis.js', 'js/off.js', 'js/scanner.js', 'js/parser.js', 'js/ocr.js', 'js/goals.js', 'js/nutrients.js', 'js/ingredients.js', 'js/nutriscore.js', 'js/dishes.js', 'js/foodcam.js', 'js/util.js',
  'fonts/figtree.woff2', 'fonts/bricolage.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
  'vendor/zxing/zxing.min.js', 'vendor/tesseract/tesseract.min.js', 'vendor/tesseract/worker.min.js',
];
// Große Dateien (Texterkennung, Bilderkennung fürs Essensfoto) werden beim ersten Gebrauch gespeichert.
const RUNTIME = 'kalorien-runtime-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      // Nur alte App-Versionen löschen. KI-Modelle (transformers-cache), vorbereitete Beschreibungen (kt-clip)
      // und große Dateien (RUNTIME) bleiben bei Updates erhalten und werden nicht neu geladen.
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kalorien-v') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Große Foto-KI: Laufzeit von jsDelivr einmal speichern (das Modell speichert Transformers.js selbst)
  const ortCdn = url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/npm/onnxruntime-web@');
  if (url.origin !== location.origin && !ortCdn) return; // Open Food Facts usw. direkt
  if (ortCdn || /\/vendor\/(tesseract\/core|tesseract\/lang|tfjs|mobilenet|transformers)\//.test(url.pathname)) {
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
