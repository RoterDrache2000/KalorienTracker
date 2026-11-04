// Liest eine EU-Nährwerttabelle aus OCR-Zeilen. Reine Regeln, keine KI, kein Server.
// Eingabe: [{text, conf}] (conf 0..100 = Sicherheit der Ziffern in der Zeile)
// Ausgabe: {values, unsure, check}

export const FIELDS = [
  { k: 'kj', l: 'Brennwert', u: 'kJ' },
  { k: 'kcal', l: 'Brennwert', u: 'kcal' },
  { k: 'fat', l: 'Fett', u: 'g' },
  { k: 'sat', l: 'davon gesättigte Fettsäuren', u: 'g', sub: true },
  { k: 'carb', l: 'Kohlenhydrate', u: 'g' },
  { k: 'sugar', l: 'davon Zucker', u: 'g', sub: true },
  { k: 'fiber', l: 'Ballaststoffe', u: 'g' },
  { k: 'prot', l: 'Eiweiß', u: 'g' },
  { k: 'salt', l: 'Salz', u: 'g' },
];

// Reihenfolge wichtig: spezielle Begriffe zuerst (gesättigte vor Fett, Zucker vor Kohlenhydrate).
const KEYS = [
  ['sat', /ges[aä]tt|fetts[aä]ur|saturat|satur[eé]s|acides gras/],
  ['sugar', /zucker|sugar|sucres?\b/],
  ['fiber', /ballast|fib(re|er)s?\b|fibres alimentaires/],
  ['prot', /eiwei|protein|prot[eé]ines?/],
  ['salt', /\bsalz|\bsalt\b|\bsel\b/],
  ['carb', /kohlen|hydrat|carbohydrat|glucides/],
  ['fat', /\bfett\b|\bfett\s|^fett|\bfat\b|mati[eè]res grasses|lipides/],
  ['energy', /brennwert|energie|energy|[eé]nergie|kcal|\bkj\b/],
];

const NUM = /(<\s*)?(\d{1,4}(?:[.,]\d{1,3})?)/g;

export function toNum(s) {
  if (s == null) return NaN;
  let t = String(s).trim().replace(/\s/g, '');
  if (!t) return NaN;
  // "1.234,5" -> 1234.5 ; "1,4" -> 1.4 ; "1.4" -> 1.4
  if (/\d\.\d{3},/.test(t)) t = t.replace(/\./g, '');
  t = t.replace(',', '.');
  const v = parseFloat(t);
  return isNaN(v) ? NaN : v;
}

function cleanDigits(s) {
  // typische OCR-Verwechslungen in Zahlen
  return s
    .replace(/(?<=\d)[oO](?=\d|[.,]|\s|g|$)/g, '0')
    .replace(/(?<=[\s:(|])[oO](?=[.,]\d)/g, '0')
    .replace(/(?<=\d[.,])[oO]/g, '0')
    .replace(/(?<=\d)[lI|](?=\d)/g, '1')
    .replace(/(\d)\s+([.,])\s*(\d)/g, '$1$2$3')
    .replace(/(\d)([.,])\s+(\d)/g, '$1$2$3');
}

function numbersIn(s) {
  const out = [];
  let m;
  NUM.lastIndex = 0;
  while ((m = NUM.exec(s))) {
    const raw = m[2];
    // Tesseract liest die Einheit „g“ oft als 9: „17 g“ -> „179g“ oder „1,9 g“ -> „1,99“
    const alt = /\d9$/.test(raw) && !/[.,]$/.test(raw.slice(0, -1)) ? toNum(raw.slice(0, -1)) : null;
    out.push({ raw, v: toNum(raw), alt, lt: !!m[1], idx: m.index });
  }
  return out;
}

// Welche Zahlenspalte ist "pro 100 g"? Meist die erste. Steht "Portion" vor "100 g" im Kopf, die zweite.
function detectColumn(lines) {
  for (const ln of lines) {
    const t = ln.text.toLowerCase();
    const i100 = t.search(/100\s*(g|ml)/);
    const iPort = t.search(/portion|serving|pro st[uü]ck|je st[uü]ck/);
    if (i100 >= 0 && iPort >= 0) return iPort < i100 ? 1 : 0;
  }
  return 0;
}

export function parseNutrition(lines) {
  const L = lines
    .map((l) => ({ text: cleanDigits(String(l.text || '')), conf: l.conf ?? 90 }))
    .filter((l) => l.text.trim());
  const col = detectColumn(L);
  const values = {};
  const conf = {};
  const notes = {};
  const alts = {};
  let pending = null; // Stichwort ohne Zahl: Zahl steht in der nächsten Zeile

  const take = (k, nums, c, after) => {
    if (values[k] != null) return;
    const pool = nums.filter((n) => n.idx >= after && !isNaN(n.v));
    // Einheiten-Werte wie "100 g" im Kopf nicht als Wert nehmen
    const n = pool[col] ?? pool[0];
    if (!n) return;
    values[k] = n.v;
    conf[k] = c;
    if (n.alt != null) alts[k] = n.alt;
    if (n.lt) notes[k] = 'Auf der Packung steht „weniger als“. Bitte prüfen.';
  };

  let energyLine = -1;
  L.forEach((ln, i) => {
    const low = ln.text.toLowerCase();
    let key = null, at = 0;
    for (const [k, re] of KEYS) {
      const m = low.match(re);
      if (m) { key = k; at = m.index + m[0].length; break; }
    }
    if (!key) {
      // Zeile direkt nach Brennwert mit "kcal" ohne Stichwort
      if ((energyLine === i - 1 || pending === 'energy') && /kcal|kj/.test(low)) key = 'energy';
      else if (pending && pending !== 'energy') { key = pending; at = 0; }
      else return;
    }
    pending = null;
    if (key === 'energy') {
      energyLine = i;
      const kj = [...low.matchAll(/(\d{1,4}(?:[.,]\d{1,2})?)\s*k\s*j/g)];
      const kc = [...low.matchAll(/(\d{1,4}(?:[.,]\d{1,2})?)\s*k\s*c\s*a\s*l/g)];
      if (kj.length && values.kj == null) { values.kj = toNum((kj[col] || kj[0])[1]); conf.kj = ln.conf; }
      if (kc.length && values.kcal == null) { values.kcal = toNum((kc[col] || kc[0])[1]); conf.kcal = ln.conf; }
      return;
    }
    const nums = numbersIn(low.slice(at));
    if (!nums.length) { pending = key; return; }
    take(key, nums.map((n) => ({ ...n, idx: n.idx + at })), ln.conf, at);
  });

  fixUnitNines(values, alts, notes);

  // fehlende Energie aus der anderen Einheit
  if (values.kcal == null && values.kj != null) { values.kcal = Math.round(values.kj / 4.184); notes.kcal = 'Aus kJ umgerechnet.'; conf.kcal = 60; }
  if (values.kj == null && values.kcal != null) { values.kj = Math.round(values.kcal * 4.184); notes.kj = 'Aus kcal umgerechnet.'; conf.kj = 90; }

  const unsure = {};
  for (const f of FIELDS) {
    if (values[f.k] == null) {
      if (f.k !== 'fiber') unsure[f.k] = 'Nicht gefunden. Bitte vom Foto abtippen.';
      continue;
    }
    if (notes[f.k]) unsure[f.k] = notes[f.k];
    else if ((conf[f.k] ?? 100) < 70) unsure[f.k] = 'Unsicher gelesen. Bitte mit dem Foto vergleichen.';
  }
  const check = plausibility(values);
  for (const [k, msg] of Object.entries(check.flags)) if (!unsure[k]) unsure[k] = msg;
  return { values, unsure, check };
}

// „g“ als 9 gelesen? Entweder systematisch (fast alle Werte enden auf 9) oder einzelne Werte,
// die mit der Korrektur zu kcal und den „davon“-Regeln passen.
function fixUnitNines(values, alts, notes) {
  const keys = Object.keys(alts);
  const valKeys = ['fat', 'sat', 'carb', 'sugar', 'fiber', 'prot', 'salt'].filter((k) => values[k] != null);
  const mark = (k) => { notes[k] = `Automatisch korrigiert (gelesen: ${String(values[k]).replace('.', ',')}). Bitte prüfen.`; values[k] = alts[k]; };
  if (valKeys.length >= 4 && keys.length / valKeys.length >= 0.6) { keys.forEach(mark); return; }
  // Kombination für Fett, Kohlenhydrate, Eiweiß suchen, die am besten zu kcal passt
  if (values.kcal != null) {
    const main = ['fat', 'carb', 'prot'];
    const opts = main.map((k) => (values[k] == null ? [null] : alts[k] != null ? [values[k], alts[k]] : [values[k]]));
    const kc = (f, c, p) => 9 * (f || 0) + 4 * (c || 0) + 4 * (p || 0) + 2 * (values.fiber || 0);
    let best = null;
    for (const f of opts[0]) for (const c of opts[1]) for (const p of opts[2]) {
      const d = Math.abs(values.kcal - kc(f, c, p));
      if (!best || d < best.d - 0.5) best = { d, v: [f, c, p] };
    }
    const orig = Math.abs(values.kcal - kc(values.fat, values.carb, values.prot));
    if (best && best.d < orig && best.d <= Math.max(25, values.kcal * 0.15)) main.forEach((k, i) => { if (values[k] != null && best.v[i] !== values[k]) mark(k); });
  }
  if (values.sat != null && values.fat != null && values.sat > values.fat && alts.sat != null && alts.sat <= values.fat) mark('sat');
  if (values.sugar != null && values.carb != null && values.sugar > values.carb && alts.sugar != null && alts.sugar <= values.carb) mark('sugar');
  for (const k of ['fiber', 'salt']) if (values[k] != null && values[k] > 30 && alts[k] != null) mark(k);
  // Komma verloren („1,2 g“ -> „122“): Teilwert muss kleiner als der Hauptwert sein
  for (const [sub, mainK] of [['sat', 'fat'], ['sugar', 'carb']]) {
    if (values[sub] == null || values[mainK] == null || values[sub] <= values[mainK]) continue;
    const c = [10, 100].map((d) => values[sub] / d).find((v) => v <= values[mainK]);
    if (c != null) { alts[sub] = Math.round(c * 100) / 100; mark(sub); }
  }
}

// Plausibilität nach Konzept. Wird auch live im Formular genutzt.
export function plausibility(v) {
  const n = (k) => (typeof v[k] === 'number' && !isNaN(v[k]) ? v[k] : null);
  const flags = {};
  const msgs = [];
  const fat = n('fat') ?? 0, carb = n('carb') ?? 0, prot = n('prot') ?? 0, fiber = n('fiber') ?? 0;
  const computed = 9 * fat + 4 * carb + 4 * prot + 2 * fiber;
  const kcal = n('kcal');
  let ok = true;
  if (kcal != null && (fat || carb || prot)) {
    const diff = Math.abs(kcal - computed);
    if (diff > Math.max(25, kcal * 0.15)) {
      ok = false;
      flags.kcal = `Passt nicht zu den Nährwerten (gerechnet etwa ${Math.round(computed)} kcal).`;
    }
  }
  const kj = n('kj');
  if (kj != null && kcal != null && kcal > 0 && Math.abs(kj / kcal - 4.184) > 0.25) {
    ok = false;
    flags.kj = 'kJ und kcal passen nicht zusammen.';
  }
  if (n('sat') != null && n('fat') != null && n('sat') > n('fat') + 0.05) { ok = false; flags.sat = 'Größer als Fett. Bitte prüfen.'; }
  if (n('sugar') != null && n('carb') != null && n('sugar') > n('carb') + 0.05) { ok = false; flags.sugar = 'Größer als Kohlenhydrate. Bitte prüfen.'; }
  const sum = fat + carb + prot + fiber + (n('salt') ?? 0);
  if (sum > 100.5) { ok = false; msgs.push('Zusammen mehr als 100 g pro 100 g.'); }
  for (const k of ['fat', 'carb', 'prot', 'fiber', 'salt', 'sugar', 'sat']) if (n(k) != null && n(k) > 100) { ok = false; flags[k] = 'Mehr als 100 g. Fehlt ein Komma?'; }
  if (kcal != null && kcal > 900) { ok = false; flags.kcal = 'Mehr als 900 kcal pro 100 g ist kaum möglich.'; }
  let message;
  if (kcal == null) message = 'Brennwert fehlt noch.';
  else if (ok) message = `Aus Fett, Kohlenhydraten und Eiweiß ergeben sich etwa ${Math.round(computed)} kcal, angegeben sind ${Math.round(kcal)} kcal.`;
  else message = [Object.values(flags)[0], ...msgs].filter(Boolean).join(' ');
  return { ok: ok && kcal != null, computed, flags, message };
}
