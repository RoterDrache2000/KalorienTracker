// Barcode-Scanner mit der Handykamera. Nutzt den eingebauten BarcodeDetector (Android/Chrome),
// sonst ZXing (iPhone/Safari, Firefox). Alles läuft auf dem Gerät.
const zxingSrc = new URL('../vendor/zxing/zxing.min.js', import.meta.url).href;
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

let zxingP;
function loadZXing() {
  if (!zxingP) zxingP = new Promise((res, rej) => {
    if (window.ZXing) return res(window.ZXing);
    const s = document.createElement('script');
    s.src = zxingSrc;
    s.onload = () => res(window.ZXing);
    s.onerror = () => { zxingP = null; rej(new Error('Scanner konnte nicht geladen werden.')); };
    document.head.appendChild(s);
  });
  return zxingP;
}

async function makeDetector() {
  if ('BarcodeDetector' in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const f = FORMATS.filter((x) => supported.includes(x));
      if (f.length) {
        const d = new window.BarcodeDetector({ formats: f });
        const fn = async (canvas) => { const r = await d.detect(canvas); return r[0]?.rawValue || null; };
        fn.native = true; return fn;
      }
    } catch { /* weiter mit ZXing */ }
  }
  const Z = await loadZXing();
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  const reader = new Z.MultiFormatReader();
  reader.setHints(hints);
  return async (canvas) => {
    try {
      const src = new Z.HTMLCanvasElementLuminanceSource(canvas);
      const bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(src));
      return reader.decode(bmp).getText();
    } catch { return null; }
  };
}

// Prüfziffer von EAN/UPC: schützt vor Fehllesungen
export function validEan(code) {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const d = code.split('').map(Number);
  const check = d.pop();
  const sum = d.reverse().reduce((a, v, i) => a + v * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

const ANGLES = [20, -20, 40, -40, 60, -60, 90];

// Mittleren Ausschnitt (cw × ch) aus der Quelle nehmen, um `deg` Grad drehen, höchstens `max` Pixel groß
export function cropRotated(canvas, src, sw, sh, cw, ch, deg, max = 1280) {
  const k = Math.min(1, max / Math.max(cw, ch)), w = Math.round(cw * k), h = Math.round(ch * k);
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate((-deg * Math.PI) / 180); ctx.scale(k, k);
  // bei Drehung etwas mehr vom Bild nehmen, damit die Ecken nicht leer bleiben
  const ex = deg ? 1.3 : 1, dw = Math.min(sw, cw * ex), dh = Math.min(sh, ch * ex);
  ctx.drawImage(src, (sw - dw) / 2, (sh - dh) / 2, dw, dh, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
  return canvas;
}

export { makeDetector };

export class Scanner {
  constructor(video, onCode) {
    this.video = video;
    this.onCode = onCode;
    this.stream = null;
    this.running = false;
    this.canvas = document.createElement('canvas');
    this.last = { code: null, n: 0 };
    this.turn = 0;
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Dieser Browser erlaubt keinen Kamerazugriff. Die App muss über https geöffnet sein.');
    this.detect = await makeDetector();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    await this.video.play();
    this.running = true;
    this.loop();
  }

  get track() { return this.stream?.getVideoTracks()[0]; }
  get hasTorch() { try { return !!this.track?.getCapabilities?.().torch; } catch { return false; } }
  async torch(on) { try { await this.track.applyConstraints({ advanced: [{ torch: on }] }); return true; } catch { return false; } }

  // Ein Bild aus dem Video auswerten. Der eingebaute BarcodeDetector findet auch schräge Codes,
  // ZXing liest nur waagerechte Zeilen: darum wird das Bild abwechselnd gedreht (0°, ±20°, ±40°, ±60°, 90°).
  async scanFrame() {
    const v = this.video, vw = v.videoWidth, vh = v.videoHeight;
    if (this.detect.native) {
      const cw = Math.round(vw * 0.9), ch = Math.round(vh * 0.8);
      return this.detect(cropRotated(this.canvas, v, vw, vh, cw, ch, 0));
    }
    // Quadratischer Ausschnitt aus der Mitte, damit ein schräger Code ganz drin ist
    const side = Math.round(Math.min(vw, vh) * 0.95);
    let code = await this.detect(cropRotated(this.canvas, v, vw, vh, side, side, 0, 720));
    if (code) return code;
    const a = ANGLES[this.turn++ % ANGLES.length];
    code = await this.detect(cropRotated(this.canvas, v, vw, vh, side, side, a, 720));
    if (code) return code;
    const b = ANGLES[this.turn++ % ANGLES.length];
    return this.detect(cropRotated(this.canvas, v, vw, vh, side, side, b, 720));
  }

  async loop() {
    if (!this.running) return;
    const v = this.video;
    if (v.readyState >= 2 && v.videoWidth) {
      const code = await this.scanFrame();
      if (code && validEan(code)) {
        // zweimal gleich gelesen = sicher
        if (this.last.code === code) this.last.n++; else this.last = { code, n: 1 };
        if (this.last.n >= 2) { this.stop(); navigator.vibrate?.(60); this.onCode(code); return; }
      }
    }
    setTimeout(() => this.loop(), 90);
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }
}
