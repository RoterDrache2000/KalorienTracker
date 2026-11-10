// Essensfoto: Bilderkennung direkt im Browser (TensorFlow.js + MobileNet V2, Apache 2.0).
// Das Modell (ca. 14 MB) wird beim ersten Mal geladen und danach vom Service Worker offline bereitgehalten.
const base = new URL('../vendor/', import.meta.url).href;
let modelP = null;

function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.tf) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error('Die Bilderkennung konnte nicht geladen werden.'));
    document.head.appendChild(s);
  });
}

export function loadModel(onProgress) {
  if (!modelP) {
    modelP = (async () => {
      await loadScript(base + 'tfjs/tf.min.js');
      const tf = window.tf;
      try { await tf.setBackend('webgl'); await tf.ready(); } catch { await tf.setBackend('cpu'); }
      return tf.loadGraphModel(base + 'mobilenet/model.json', { onProgress });
    })().catch((e) => { modelP = null; throw e; });
  }
  return modelP;
}

const REGIONS = [[0, 0, 0.6, 1], [0.4, 0, 0.6, 1], [0, 0, 1, 0.6], [0, 0.4, 1, 0.6]];
// Foto -> quadratischer Ausschnitt aus der Mitte, 224 × 224 Pixel
export async function prepare(file) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const cv = document.createElement('canvas'); cv.width = cv.height = 224;
  cv.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 224, 224);
  const pv = document.createElement('canvas'), k = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
  pv.width = Math.round(bmp.width * k); pv.height = Math.round(bmp.height * k);
  pv.getContext('2d').drawImage(bmp, 0, 0, pv.width, pv.height);
  // Ausschnitte (linke/rechte, obere/untere Bildhälfte mit Überlappung): so findet die Erkennung
  // auch Beilagen neben dem Hauptgericht, z. B. Pommes neben dem Burger.
  const regions = REGIONS.map(([x, y, w, h]) => {
    const sx = x * bmp.width, sy = y * bmp.height, sw = w * bmp.width, sh = h * bmp.height;
    const q = Math.min(sw, sh), sq = document.createElement('canvas'); sq.width = sq.height = 224;
    sq.getContext('2d').drawImage(bmp, sx + (sw - q) / 2, sy + (sh - q) / 2, q, q, 0, 0, 224, 224);
    const m = Math.min(1, 336 / Math.max(sw, sh)), big = document.createElement('canvas');
    big.width = Math.round(sw * m); big.height = Math.round(sh * m);
    big.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, big.width, big.height);
    return { sq, big };
  });
  bmp.close?.();
  return { canvas: cv, preview: pv.toDataURL('image/jpeg', 0.8), regions };
}

// Wahrscheinlichkeiten für alle 1001 Bildklassen. probs.vec = Bild-Fingerabdruck (1280 Werte, normiert) zum Lernen.
export async function classify(canvas, onProgress) {
  const model = await loadModel(onProgress);
  const tf = window.tf;
  const [out, feat] = tf.tidy(() => {
    const x = tf.browser.fromPixels(canvas).toFloat().div(255).expandDims(0);
    const [lo, pool] = model.execute(x, ['module_apply_default/MobilenetV2/Logits/output', 'module_apply_default/MobilenetV2/Logits/AvgPool']);
    return [tf.softmax(lo.squeeze()), pool.reshape([-1])]; // Modell liefert Logits
  });
  const probs = await out.data(), f = await feat.data();
  out.dispose(); feat.dispose();
  probs.vec = normRows(f, 1, f.length)[0];
  return probs;
}

// Große Erkennung: CLIP (Xenova/clip-vit-base-patch32, MIT) über Transformers.js (Apache 2.0).
// Vergleicht das Foto mit Textbeschreibungen der Gerichte. Modell kommt einmalig von huggingface.co,
// die Laufzeit von cdn.jsdelivr.net; der Browser speichert beides. Text-Vektoren werden einmal berechnet und gespeichert.
const CLIP = 'Xenova/clip-vit-base-patch32';
export const CLIP_MB = 150;
let clipP = null, T = null;
// Vorbereitete Beschreibungen werden je Text gespeichert: Kommen neue Gerichte dazu, wird nur deren Text neu berechnet.
const EMB_KEY = 'clip-emb-map-v1';

function normRows(data, n, dim) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const v = data.slice(i * dim, (i + 1) * dim); let s = 0;
    for (const x of v) s += x * x; s = Math.sqrt(s) || 1;
    out.push(Array.from(v, (x) => x / s));
  }
  return out;
}

async function cacheGet(key) {
  try { const c = await caches.open('kt-clip'); const r = await c.match('/' + key); return r ? await r.json() : null; } catch { return null; }
}
async function cachePut(key, val) {
  try { const c = await caches.open('kt-clip'); await c.put('/' + key, new Response(JSON.stringify(val), { headers: { 'Content-Type': 'application/json' } })); } catch { /* ohne Speicher geht es trotzdem */ }
}

// texts: Beschreibungen (englisch, darauf ist CLIP trainiert)
export function loadClip(texts, onProgress) {
  if (!clipP) {
    clipP = (async () => {
      navigator.storage?.persist?.().catch(() => {}); // bittet den Browser, das große Modell nicht wegzuräumen
      T = await import(new URL('../vendor/transformers/transformers.min.js', import.meta.url).href);
      T.env.allowLocalModels = false;
      const files = {};
      const progress_callback = (p) => {
        if (p.status !== 'progress' || !p.total) return;
        files[p.file + p.name] = [p.loaded, p.total];
        let l = 0, t = 0; for (const [a, b] of Object.values(files)) { l += a; t += b; }
        onProgress?.(Math.min(0.99, l / Math.max(t, CLIP_MB * 1e6 * (texts.cached ? 0.6 : 1))));
      };
      let map = await cacheGet(EMB_KEY), migrated = false;
      if (!map) { // Übernahme aus Version 1.5.1 und älter (dort ein Block pro Text-Liste), damit nichts neu berechnet wird
        map = {};
        const old = await cacheGet('clip-emb-' + texts.length + '-' + [...texts.join('|')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7));
        if (Array.isArray(old) && old.length === texts.length) { texts.forEach((t, i) => { map[t] = old[i]; }); migrated = true; }
      }
      const missing = [...new Set(texts.filter((t) => !map[t]))];
      texts.cached = !missing.length;
      if (missing.length) {
        const tok = await T.AutoTokenizer.from_pretrained(CLIP);
        const tm = await T.CLIPTextModelWithProjection.from_pretrained(CLIP, { dtype: 'q8', progress_callback });
        for (let i = 0; i < missing.length; i += 32) { // in Paketen, damit das Handy nicht zu viel Speicher braucht
          const part = missing.slice(i, i + 32);
          const { text_embeds } = await tm(tok(part, { padding: true, truncation: true }));
          normRows(text_embeds.data, part.length, text_embeds.dims[1]).forEach((v, j) => { map[part[j]] = v.map((x) => +x.toFixed(5)); });
          onProgress?.(0.5 + 0.4 * Math.min(1, (i + 32) / missing.length), `Gerichte werden vorbereitet … ${Math.min(missing.length, i + 32)} von ${missing.length}`);
        }
        await tm.dispose?.();
      }
      if (missing.length || migrated) {
        const keep = {}; for (const t of texts) keep[t] = map[t]; // alte, nicht mehr genutzte Texte fallen weg
        await cachePut(EMB_KEY, keep);
        try { const c = await caches.open('kt-clip'); for (const r of await c.keys()) if (!r.url.endsWith('/' + EMB_KEY)) await c.delete(r); } catch { /* egal */ }
      }
      const emb = texts.map((t) => map[t]);
      const proc = await T.AutoProcessor.from_pretrained(CLIP);
      const vm = await T.CLIPVisionModelWithProjection.from_pretrained(CLIP, { dtype: 'q8', progress_callback });
      return { emb, proc, vm };
    })().catch((e) => { clipP = null; throw e; });
  }
  return clipP;
}

// Foto (Datei oder Canvas-Ausschnitt) -> Wahrscheinlichkeit je Text (Summe 1)
export async function classifyClip(file, texts, onProgress) {
  const { emb, proc, vm } = await loadClip(texts, onProgress);
  const img = file instanceof Blob ? await T.RawImage.fromBlob(file) : T.RawImage.fromCanvas(file).rgb();
  const { image_embeds } = await vm(await proc(img));
  const [v] = normRows(image_embeds.data, 1, image_embeds.dims[1]);
  const logits = emb.map((t) => 100 * t.reduce((a, x, i) => a + x * v[i], 0));
  const m = Math.max(...logits), ex = logits.map((x) => Math.exp(x - m)), s = ex.reduce((a, b) => a + b, 0);
  const probs = ex.map((x) => x / s);
  probs.vec = v; // Bild-Fingerabdruck (normiert) zum Lernen
  return probs;
}
