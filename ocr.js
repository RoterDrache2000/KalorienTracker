// Texterkennung auf dem Gerät mit Tesseract.js (WebAssembly). Das Foto verlässt das Handy nicht.
import { parseNutrition } from './parser.js';

const base = new URL('../vendor/tesseract/', import.meta.url).href;
let workerP = null;

function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.Tesseract) return res();
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error('Texterkennung konnte nicht geladen werden.'));
    document.head.appendChild(s);
  });
}

export async function getWorker(onProgress) {
  if (!workerP) {
    workerP = (async () => {
      await loadScript(base + 'tesseract.min.js');
      // Sprachmodell liegt als lang/deu.traineddata.gz.wasm (gzip-Daten). Die Endung .wasm sorgt dafür, dass jeder
      // Webserver die Datei ausliefert; worker.min.js ist dafür an einer Stelle angepasst (hängt ".wasm" an).
      const w = await window.Tesseract.createWorker('deu', 1, {
        workerPath: base + 'worker.min.js',
        corePath: base + 'core',
        langPath: base + 'lang',
        gzip: true,
        cacheMethod: 'write',
        logger: (m) => onProgress && onProgress(m),
      });
      await w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
      return w;
    })().catch((e) => { workerP = null; throw e; });
  }
  return workerP;
}

// Bild verkleinern und in Graustufen umwandeln: schneller und für Tesseract gut lesbar.
export async function prepareImage(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(async () => {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await img.decode();
    return img;
  });
  const w0 = bmp.width, h0 = bmp.height;
  const target = 1800;
  const sc = Math.min(1, target / Math.max(w0, h0));
  const w = Math.round(w0 * sc), h = Math.round(h0 * sc);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bmp, 0, 0, w, h);
  const preview = c.toDataURL('image/jpeg', 0.8);
  const d = x.getImageData(0, 0, w, h);
  const p = d.data;
  // Graustufen; Tesseract trennt Text und Hintergrund danach selbst (Otsu)
  for (let i = 0; i < p.length; i += 4) {
    const v = (p[i] * 299 + p[i + 1] * 587 + p[i + 2] * 114) / 1000;
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  x.putImageData(d, 0, 0);
  return { canvas: c, preview };
}

function linesFrom(data) {
  const out = [];
  const walk = (blocks) => {
    for (const b of blocks || []) for (const par of b.paragraphs || []) for (const ln of par.lines || []) {
      const digitWords = (ln.words || []).filter((w) => /\d/.test(w.text));
      const conf = digitWords.length ? Math.min(...digitWords.map((w) => w.confidence)) : ln.confidence;
      out.push({ text: ln.text.replace(/\n/g, ' '), conf });
    }
  };
  walk(data.blocks);
  if (!out.length && data.text) data.text.split('\n').forEach((t) => out.push({ text: t, conf: data.confidence ?? 80 }));
  return out;
}

const score = (r) => Object.keys(r.values).length * 2 - Object.keys(r.unsure).length + (r.check.ok ? 6 : 0);

export async function readLabel(file, onProgress) {
  const { canvas, preview } = await prepareImage(file);
  const w = await getWorker(onProgress);
  // Erst als Textblock lesen (Tabelle zeilenweise); klappt das nicht gut, weitere Lesarten probieren.
  let best = null;
  for (const psm of ['6', '3', '11']) {
    await w.setParameters({ tessedit_pageseg_mode: psm });
    const { data } = await w.recognize(canvas, {}, { text: true, blocks: true });
    const lines = linesFrom(data);
    const r = { ...parseNutrition(lines), text: lines.map((l) => l.text).join('\n') };
    if (!best || score(r) > score(best)) best = r;
    if (best.check.ok && Object.keys(best.unsure).length <= 1) break;
  }
  return { ...best, preview };
}

// Einmalig im Hintergrund laden, damit die Erkennung später auch offline klappt.
export async function warmUp() {
  try { await getWorker(); } catch { /* egal, beim ersten Foto nochmal */ }
}
