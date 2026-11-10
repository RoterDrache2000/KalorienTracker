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
  // x: seltener auf Packungen, vor allem für Supplements (nicht in der Liste „Keine Angaben“)
  { k: 'niacin', l: 'Niacin', u: 'mg', off: 'vitamin-pp', f: 1e3, ref: 16, d: 1, x: 1 },
  { k: 'panto', l: 'Pantothensäure', u: 'mg', off: 'pantothenic-acid', f: 1e3, ref: 6, d: 1, x: 1 },
  { k: 'biotin', l: 'Biotin', u: 'µg', off: 'biotin', f: 1e6, ref: 50, x: 1 },
  { k: 'p', l: 'Phosphor', u: 'mg', off: 'phosphorus', f: 1e3, ref: 700, x: 1 },
  { k: 'jod', l: 'Jod', u: 'µg', off: 'iodine', f: 1e6, ref: 150, x: 1 },
  { k: 'se', l: 'Selen', u: 'µg', off: 'selenium', f: 1e6, ref: 55, x: 1 },
  { k: 'cu', l: 'Kupfer', u: 'mg', off: 'copper', f: 1e3, ref: 1, d: 2, x: 1 },
  { k: 'mn', l: 'Mangan', u: 'mg', off: 'manganese', f: 1e3, ref: 2, d: 2, x: 1 },
  { k: 'cr', l: 'Chrom', u: 'µg', off: 'chromium', f: 1e6, ref: 40, x: 1 },
  { k: 'mo', l: 'Molybdän', u: 'µg', off: 'molybdenum', f: 1e6, ref: 50, x: 1 },
  { k: 'fl', l: 'Fluorid', u: 'mg', off: 'fluoride', f: 1e3, ref: 3.5, d: 1, x: 1 },
];
// Wirkstoffe nur für Supplements, ohne offiziellen Referenzwert (die App zählt nur die Tagesmenge)
export const SUPP_EXTRA = [
  { k: 'bor', l: 'Bor', u: 'mg', f: 1e3, d: 1 },
  { k: 'si', l: 'Silizium', u: 'mg', f: 1e3 },
  { k: 'vanad', l: 'Vanadium', u: 'µg', f: 1e6 },
  { k: 'omega3', l: 'Omega-3 (EPA + DHA)', u: 'mg', f: 1e3 },
  { k: 'q10', l: 'Coenzym Q10', u: 'mg', f: 1e3 },
  { k: 'kreatin', l: 'Kreatin', u: 'g', f: 1, d: 1 },
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
