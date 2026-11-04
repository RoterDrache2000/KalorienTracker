// Vitamine und Mineralstoffe: Einheiten, Open-Food-Facts-Felder und Referenzwerte für Erwachsene.
// Referenz = Nährstoffbezugswert der EU (LMIV, Anhang XIII), wie er auf Packungen als "% NRV" steht.
// f = Faktor von Gramm (so liefert Open Food Facts die Werte) in die angezeigte Einheit.
export const MICRO = [
  { k: 'vita', l: 'Vitamin A', u: 'µg', off: 'vitamin-a', f: 1e6, ref: 800 },
  { k: 'vitd', l: 'Vitamin D', u: 'µg', off: 'vitamin-d', f: 1e6, ref: 5, d: 1 },
  { k: 'vite', l: 'Vitamin E', u: 'mg', off: 'vitamin-e', f: 1e3, ref: 12, d: 1 },
  { k: 'vitk', l: 'Vitamin K', u: 'µg', off: 'vitamin-k', f: 1e6, ref: 75 },
  { k: 'vitc', l: 'Vitamin C', u: 'mg', off: 'vitamin-c', f: 1e3, ref: 80 },
  { k: 'vitb1', l: 'Vitamin B1', u: 'mg', off: 'vitamin-b1', f: 1e3, ref: 1.1, d: 2 },
  { k: 'vitb2', l: 'Vitamin B2', u: 'mg', off: 'vitamin-b2', f: 1e3, ref: 1.4, d: 2 },
  { k: 'vitb6', l: 'Vitamin B6', u: 'mg', off: 'vitamin-b6', f: 1e3, ref: 1.4, d: 2 },
  { k: 'vitb12', l: 'Vitamin B12', u: 'µg', off: 'vitamin-b12', f: 1e6, ref: 2.5, d: 1 },
  { k: 'folate', l: 'Folat', u: 'µg', off: 'vitamin-b9', alt: 'folates', f: 1e6, ref: 200 },
  { k: 'ca', l: 'Calcium', u: 'mg', off: 'calcium', f: 1e3, ref: 800 },
  { k: 'mg', l: 'Magnesium', u: 'mg', off: 'magnesium', f: 1e3, ref: 375 },
  { k: 'fe', l: 'Eisen', u: 'mg', off: 'iron', f: 1e3, ref: 14, d: 1 },
  { k: 'zn', l: 'Zink', u: 'mg', off: 'zinc', f: 1e3, ref: 10, d: 1 },
  { k: 'k', l: 'Kalium', u: 'mg', off: 'potassium', f: 1e3, ref: 2000 },
];
export const MKEYS = MICRO.map((m) => m.k);

// Open-Food-Facts-Nährwerte -> nur die Mikronährstoffe, die wirklich angegeben sind
export function microFromOff(nm) {
  const out = {};
  for (const m of MICRO) {
    let v = nm[m.off + '_100g'];
    if (v == null && m.alt) v = nm[m.alt + '_100g'];
    const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v;
    if (!(typeof n === 'number' && isFinite(n) && n >= 0)) continue;
    const val = n * m.f;
    if (val > m.ref * 50) continue; // offensichtlich falsche Einheit in der Datenbank
    out[m.k] = Math.round(val * 1000) / 1000;
  }
  return out;
}
