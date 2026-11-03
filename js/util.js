// Kleine Helfer für Zahlen, Datum und HTML.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const ic = (n) => `<svg class="i"><use href="#i-${n}"/></svg>`;

export const fmt = (v, d = 0) => {
  const x = Number(v) || 0;
  return x.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
};
// "1,5" / "1.5" / "1.234,5" -> Zahl; leer -> NaN
export const num = (s) => {
  if (typeof s === 'number') return s;
  let t = String(s ?? '').trim().replace(/\s/g, '');
  if (!t) return NaN;
  if (/\d\.\d{3}(,|$)/.test(t) && t.includes(',')) t = t.replace(/\./g, '');
  const v = parseFloat(t.replace(',', '.'));
  return isNaN(v) ? NaN : v;
};
export const num0 = (s) => { const v = num(s); return isNaN(v) ? 0 : v; };
// Zahl für ein Eingabefeld (deutsches Komma, ohne Tausenderpunkt)
export const inVal = (v, d = 1) => (v == null || isNaN(v) ? '' : String(Math.round(v * 10 ** d) / 10 ** d).replace('.', ','));

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pad = (n) => String(n).padStart(2, '0');
export const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => dstr(new Date());
export const parseD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return dstr(d); };
export const dayDiff = (a, b) => Math.round((parseD(a) - parseD(b)) / 864e5);
export function dayLabel(s) {
  const diff = dayDiff(s, today());
  if (diff === 0) return 'Heute';
  if (diff === -1) return 'Gestern';
  if (diff === 1) return 'Morgen';
  return parseD(s).toLocaleDateString('de-DE', { weekday: 'long' });
}
export const dateLong = (s) => parseD(s).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: dayDiff(s, today()) < -300 ? 'numeric' : undefined });

const COLS = ['#B08A3E', '#4D7FB8', '#D4A514', '#7A5530', '#C4703B', '#2E6D4F', '#5B4FA0', '#A33A2A', '#4A6EA0', '#8A5A2C', '#3F8F7A', '#9C4F86'];
export function colorFor(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLS[h % COLS.length];
}
export const initials = (s) => String(s).split(/[\s,-]+/).filter((w) => /\p{L}/u.test(w)).slice(0, 2).map((w) => w.match(/\p{L}/u)[0]).join('').toUpperCase() || '?';

export const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');

// Datei speichern. In der Test-Ansicht im Chat über die Speichern-Funktion von Claude, sonst als normaler Download.
export async function download(name, text, type) {
  if (window.claude?.use) {
    try {
      const dl = await window.claude.use('downloads');
      if (dl) { await dl.save({ filename: name, data: new Blob([text], { type }) }); return true; }
    } catch { return false; }
  }
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return true;
}
