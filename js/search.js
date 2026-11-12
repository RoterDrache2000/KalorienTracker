// Intelligente Suche: Tippfehler, Wortstamm, ä = ae, Wortteile, Synonyme und Ranking nach Nutzung.
// Läuft komplett auf dem Gerät, ohne Internet.
import { SYNONYMS } from './synonyms.js';

// Text in vergleichbare Wörter zerlegen: klein, ohne Akzente, ß = ss, ae/oe/ue = a/o/u, Endungen weg
const base = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u');
export function stem(w) {
  if (w.length < 5 || /\d/.test(w)) return w;
  for (const end of ['en', 'er', 'n', 'e', 's']) if (w.endsWith(end) && w.length - end.length >= 4) return w.slice(0, -end.length);
  return w;
}
const rawWords = (s) => base(s).split(/[^a-z0-9]+/).filter(Boolean);
export const words = (s) => rawWords(s).map(stem);

// Damerau-Levenshtein (Vertauschung zählt als 1 Fehler), bricht ab, sobald es mehr als max Fehler sind
export function dist(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = b.length; let p2 = null, p1 = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const c = [i]; let low = i;
    for (let j = 1; j <= n; j++) {
      let v = Math.min(p1[j] + 1, c[j - 1] + 1, p1[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (p2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
      c.push(v); if (v < low) low = v;
    }
    if (low > max) return max + 1;
    p2 = p1; p1 = c;
  }
  return p1[n];
}
const sub = (w, h) => { let i = 0; for (const ch of h) if (ch === w[i]) i++; return i === w.length; };
const allowed = (len) => (len <= 3 ? 0 : len <= 7 ? 1 : 2);

// Synonyme: jedes Wort zeigt auf die anderen Wörter seiner Gruppe
const SYN = new Map(), SYN_RAW = new Map();
for (const g of SYNONYMS) {
  const ws = g.map((x) => words(x).join(' ')).filter(Boolean);
  g.forEach((x) => SYN_RAW.set(words(x).join(' '), rawWords(x).join(' ')));
  for (const w of ws) { if (!SYN.has(w)) SYN.set(w, new Set()); ws.forEach((o) => o !== w && SYN.get(w).add(o)); }
}
const SYN_KEYS = [...SYN.keys()];

// Wörter eines Lebensmittels (Name + Marke), gemerkt pro Objekt
const cache = new WeakMap();
function prepFood(f) {
  let c = cache.get(f);
  if (!c || c.key !== f.name + '|' + (f.brand || '')) {
    const nw = words(f.name);
    c = { key: f.name + '|' + (f.brand || ''), nw, all: [...nw, ...words(f.brand)], raw: [...rawWords(f.name), ...rawWords(f.brand)], len: String(f.name || '').length };
    cache.set(f, c);
  }
  return c;
}

// Wie gut passt ein Suchwort zu einem Wort des Lebensmittels? 10 genau, 8 Wortanfang, 6 Wortteil, 4 Tippfehler
function plain(w, h, last, rw, rh) {
  if (w === h) return 10;
  if (h.startsWith(w) && (last || w.length >= 3)) return 8;
  if ((rw.length >= 4 && rh.includes(rw)) || (w.length >= 5 && h.includes(w))) return 6;
  const k = allowed(w.length);
  // ganzes Wort mit Tippfehler minimal besser als nur der Wortanfang („kartofel“: Kartoffeln vor Kartoffelchips)
  // fehlt nur ein Buchstabe („piza“ → Pizza), ist das wahrscheinlicher als ein falscher Buchstabe („piza“ → Piña)
  // auch ungestemmt vergleichen („buter“ → Butter: die Stämme „buter“ und „butt“ liegen zu weit auseinander)
  const kr = allowed(rw.length);
  if ((k && dist(w, h, k) <= k) || (kr && dist(rw, rh, kr) <= kr)) return sub(w, h) || sub(rw, rh) ? 4.7 : 4.5;
  if (k && last && h.length > w.length && dist(w, h.slice(0, w.length), k) <= k) return 4;
  return 0;
}
// Synonym-Treffer zählt 6 (Gruppenwort genau oder beim letzten Wort als Anfang)
function synScore(w, hs, joined, last, raws) {
  const keys = SYN.has(w) ? [w] : last && w.length >= 3 ? SYN_KEYS.filter((k) => k.startsWith(w)) : [];
  for (const k of keys) for (const s of SYN.get(k)) {
    if (s.includes(' ')) { if (joined.includes(s)) return 6; continue; }
    // ganzes Wort, oder ungestemmt als Anfang/Ende eines zusammengesetzten Wortes (ab 4 Buchstaben), oder Wortteil ab 5
    const r = SYN_RAW.get(s) || s;
    if (hs.some((h, j) => h === s || (s.length >= 5 && h.includes(s)) || (r.length >= 5 && raws[j].includes(r))
      || (r.length >= 4 && raws[j].length - r.length >= 3 && (raws[j].startsWith(r) || raws[j].endsWith(r))))) return 6;
  }
  return 0;
}

// Text-Punkte für eine Suche (vorbereitet mit prepQuery). null = passt nicht
export function prepQuery(q) { const qw = words(q); qw.raw = rawWords(q); return qw; }
export function textScore(qw, f, marks) {
  if (!qw.length) return null;
  const qr = qw.raw || qw;
  const c = prepFood(f), joined = c.all.join(' ');
  let sum = 0; const pos = [];
  for (let i = 0; i < qw.length; i++) {
    const w = qw[i], last = i === qw.length - 1;
    let best = 0, at = -1;
    c.all.forEach((h, j) => { const s = plain(w, h, last, qr[i], c.raw[j]); if (s > best) { best = s; at = j; } });
    if (best < 6) { const s = synScore(w, c.all, joined, last, c.raw); if (s > best) { best = s; at = -1; } }
    if (!best) return null;
    sum += best; pos.push(at); if (marks) marks.push(best);
  }
  let s = sum / qw.length;
  if (c.nw[0] && (c.nw[0] === qw[0] || c.nw[0].startsWith(qw[0]))) s += 2;
  // Tippfehler am Namensanfang zählt etwas („piza“: Pizza vor Döner-Pizza)
  else if (c.nw[0] && allowed(qw[0].length) && dist(qw[0], c.nw[0].slice(0, qw[0].length), allowed(qw[0].length)) <= allowed(qw[0].length)) s += 1;
  if (qw.length > 1 && pos.every((p, i) => p >= 0 && (i === 0 || p > pos[i - 1]))) s += 1;
  s -= Math.max(0, c.len - 20) * 0.03;
  return s;
}

// Nutzung: h = Summe 0,5^(Alter in Tagen / 30); Punkte = min(8, 3·log2(1+h))
export const usagePoints = (h) => (h > 0 ? Math.min(8, 3 * Math.log2(1 + h)) : 0);
export function usageFrom(entries, todayStr) {
  const t0 = Date.parse(todayStr + 'T12:00:00');
  const h = new Map(), meal = new Map(), last = new Map();
  for (const e of entries) {
    if (!e.foodId || e.src === 'Schnell') continue;
    const age = Math.max(0, (t0 - Date.parse(e.date + 'T12:00:00')) / 864e5);
    h.set(e.foodId, (h.get(e.foodId) || 0) + 0.5 ** (age / 30));
    const k = e.meal + '|' + e.foodId; meal.set(k, (meal.get(k) || 0) + 1);
    const l = last.get(e.foodId); if (!l || l.date < e.date || (l.date === e.date && (l.t || 0) < (e.t || 0))) last.set(e.foodId, e);
  }
  return { h, meal, last };
}

// Kontext-Punkte: Favorit +3, in dieser Mahlzeit schon mind. 2× gegessen +2, eigenes Lebensmittel/Rezept +1
function extra(f, ctx, qw) {
  const u = usagePoints(ctx.usage?.h.get(f.id) || 0);
  let learned = 0;
  if (qw && ctx.qmem?.length) {
    const q = qw.join(' ');
    if (ctx.qmem.some((m) => m.id === f.id && words(m.q).join(' ').startsWith(q))) learned = 5;
  }
  let k = 0;
  if (ctx.favs?.has(f.id)) k += 3;
  if ((ctx.usage?.meal.get(ctx.meal + '|' + f.id) || 0) >= 2) k += 2;
  if (f.src === 'Eigen' || f.src === 'Rezept' || f.src === 'Foto') k += 1;
  return u + learned + k;
}

// Suchtreffer sortiert: Text + Nutzung + Gelernt + Kontext. Passt der Text nur über Tippfehler (< 6), zählt der Rest halb.
export function rank(q, pool, ctx = {}, limit = 40) {
  const qw = prepQuery(q); if (!qw.length) return [];
  let out = []; const seen = new Set(), good = [];
  for (const f of pool) {
    // gleicher Name zweimal (Grundlebensmittel und Gericht): nur der erste (eigene, dann Grundlebensmittel)
    const nk = 'n:' + base(f.name).trim() + '|' + base(f.brand).trim();
    if (seen.has(f.id) || seen.has(nk)) continue;
    const m = []; const t = textScore(qw, f, m); if (t == null) continue;
    seen.add(f.id); seen.add(nk);
    const x = extra(f, ctx, qw);
    m.forEach((v, i) => { if (v >= 6) good[i] = (good[i] || 0) + 1; });
    out.push([t + (t < 6 ? x / 2 : x), f, m]);
  }
  // Tippfehler-Treffer nur für Suchwörter, die nirgends genau, als Anfang, Teil oder Synonym passen
  out = out.filter((o) => o[2].every((v, i) => v >= 6 || !(good[i] >= 3)));
  return out.sort((a, b) => b[0] - a[0] || a[1].name.length - b[1].name.length || a[1].name.localeCompare(b[1].name, 'de')).slice(0, limit).map((x) => x[1]);
}
// „Häufig“: nach Nutzung und Kontext
export function frequent(foods, ctx = {}, limit = 30) {
  return foods.map((f) => [extra(f, ctx, null), f]).sort((a, b) => b[0] - a[0]).slice(0, limit).map((x) => x[1]);
}
// Online-Treffer nach Textpassung umsortieren (stabil)
export function sortOnline(q, list) {
  const qw = prepQuery(q);
  return list.map((f, i) => [textScore(qw, f) ?? -1, i, f]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map((x) => x[2]);
}
