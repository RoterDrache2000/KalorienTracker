import { microFromOff } from './nutrients.js';

// Open Food Facts: freie Produktdatenbank (ODbL). Direkte Abfrage, kein eigener Server.
const BASE = 'https://world.openfoodfacts.org';
const FIELDS = 'code,product_name,product_name_de,generic_name_de,brands,nutriments,serving_size,serving_quantity,image_front_small_url,quantity,nutriscore_grade';

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
    ...(/^[a-e]$/.test(p.nutriscore_grade || '') ? { nutri: p.nutriscore_grade } : {}),
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

// Für den Inhaltsstoff-Check: Zutatenliste und Zusatzinfos, erst Open Food Facts, dann Open Beauty Facts
const CHECK_FIELDS = 'code,product_name,product_name_de,generic_name_de,brands,image_front_small_url,ingredients_text_de,ingredients_text,ingredients_text_en,additives_tags,allergens_tags,nova_group,nutriscore_grade,ingredients_analysis_tags,categories_tags,nutriments,quantity,serving_size,serving_quantity';
const BEAUTY = 'https://world.openbeautyfacts.org';
function checkData(p, kind) {
  const name = (p.product_name_de || p.product_name || p.generic_name_de || '').trim() || 'Unbekanntes Produkt';
  const cats = p.categories_tags || [];
  return {
    kind, src: kind === 'cos' ? 'Open Beauty Facts' : 'Open Food Facts',
    code: p.code, name, brand: (p.brands || '').split(',')[0].trim(), img: p.image_front_small_url || '',
    text: p.ingredients_text_de || p.ingredients_text || p.ingredients_text_en || '',
    additives: (p.additives_tags || []).map((t) => t.replace(/^en:/, '')),
    allergens: (p.allergens_tags || []).map((t) => t.replace(/^\w\w:/, '')),
    nova: p.nova_group || null, nutri: p.nutriscore_grade && /^[a-e]$/.test(p.nutriscore_grade) ? p.nutriscore_grade : null,
    vegan: (p.ingredients_analysis_tags || []).includes('en:vegan') ? 'ja' : (p.ingredients_analysis_tags || []).includes('en:non-vegan') ? 'nein' : null,
    drink: cats.some((c) => /^en:(beverages|drinks|waters|sodas|juices)/.test(c)) || /\d\s*(ml|cl|l)\b/i.test(p.quantity || ''),
    food: kind === 'food' ? mapProduct(p) : null,
  };
}
export async function lookupCheck(code) {
  const j = await getJSON(`${BASE}/api/v2/product/${encodeURIComponent(code)}.json?fields=${CHECK_FIELDS}&lc=de`);
  if (j && j.status !== 0 && j.product) return checkData({ ...j.product, code }, 'food');
  const k = await getJSON(`${BEAUTY}/api/v2/product/${encodeURIComponent(code)}.json?fields=${CHECK_FIELDS}&lc=de`);
  if (k && k.status !== 0 && k.product) return checkData({ ...k.product, code }, 'cos');
  return null;
}
