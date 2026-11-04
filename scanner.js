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
        return async (canvas) => { const r = await d.detect(canvas); return r[0]?.rawValue || null; };
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

export class Scanner {
  constructor(video, onCode) {
    this.video = video;
    this.onCode = onCode;
    this.stream = null;
    this.running = false;
    this.canvas = document.createElement('canvas');
    this.last = { code: null, n: 0 };
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

  async loop() {
    if (!this.running) return;
    const v = this.video;
    if (v.readyState >= 2 && v.videoWidth) {
      // mittleren Bereich ausschneiden (dort ist der Rahmen) – schneller und genauer
      const cw = Math.round(v.videoWidth * 0.8), ch = Math.round(v.videoHeight * 0.5);
      const sx = (v.videoWidth - cw) / 2, sy = (v.videoHeight - ch) / 2;
      this.canvas.width = cw; this.canvas.height = ch;
      this.canvas.getContext('2d', { willReadFrequently: true }).drawImage(v, sx, sy, cw, ch, 0, 0, cw, ch);
      const code = await this.detect(this.canvas);
      if (code && validEan(code)) {
        // zweimal gleich gelesen = sicher
        if (this.last.code === code) this.last.n++; else this.last = { code, n: 1 };
        if (this.last.n >= 2) { this.stop(); navigator.vibrate?.(60); this.onCode(code); return; }
      }
    }
    setTimeout(() => this.loop(), 120);
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }
}
