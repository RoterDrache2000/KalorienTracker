import { microFromOff } from './nutrients.js';

// Open Food Facts: freie Produktdatenbank (ODbL). Direkte Abfrage, kein eigener Server.
const BASE = 'https://world.openfoodfacts.org';
const FIELDS = 'code,product_name,product_name_de,generic_name_de,brands,nutriments,serving_size,serving_quantity,image_front_small_url,quantity';

function num(v) {
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v;
  return typeof n === 'number' && isFinite(n) ? n : 0;
}

export function mapProduct(p) {
  if (!p) return null;
  const nm = p.nutriments || {};
  let kcal = nm['energy-kcal_100g'];
  if (kcal == null && nm['energy_100g'] != null) kcal = num(nm['energy_100g']) / 4.184; // energy_100g ist kJ
  const name = (p.product_name_de || p.product_name || p.generic_name_de || '').trim();
  if (!name || kcal == null) return null;
  const portions = [];
  const sq = num(p.serving_quantity);
  if (sq > 0) portions.push({ l: p.serving_size ? `Portion (${p.serving_size})` : 'Portion', g: sq });
  return {
    id: 'off:' + p.code,
    src: 'OFF',
    name,
    brand: (p.brands || '').split(',')[0].trim(),
    barcode: p.code,
    img: p.image_front_small_url || '',
    n: {
      kcal: num(kcal),
      kj: num(nm['energy-kj_100g'] ?? nm['energy_100g']),
      fat: num(nm.fat_100g),
      sat: num(nm['saturated-fat_100g']),
      carb: num(nm.carbohydrates_100g),
      sugar: num(nm.sugars_100g),
      fiber: num(nm.fiber_100g),
      prot: num(nm.proteins_100g),
      salt: num(nm.salt_100g),
      ...microFromOff(nm),
    },
    portions,
  };
}

async function getJSON(url, timeoutMs = 9000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (r.status === 404) return null;
    if (r.status === 429) throw new Error('Open Food Facts bremst gerade (zu viele Anfragen). Bitte kurz warten.');
    if (!r.ok) throw new Error('Open Food Facts antwortet nicht (' + r.status + ').');
    return await r.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Open Food Facts antwortet zu langsam.');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// Ergebnis: Produkt, null (unbekannt) oder Fehler (z. B. offline)
export async function lookupBarcode(code) {
  const j = await getJSON(`${BASE}/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}&lc=de`);
  if (!j || j.status === 0 || !j.product) return null;
  return mapProduct({ ...j.product, code: j.product.code || code });
}

export async function search(q) {
  const u = `${BASE}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=25&lc=de&cc=de&fields=${FIELDS}`;
  const j = await getJSON(u, 12000);
  return (j?.products || []).map(mapProduct).filter(Boolean);
}
