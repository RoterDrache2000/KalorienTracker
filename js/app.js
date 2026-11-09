// KalorienTracker – Haupt-App. Läuft komplett im Browser, Daten bleiben auf dem Gerät.
import { db, getSetting, setSetting, exportAll, importAll, uid } from './db.js';
import { BASIS } from './basis.js';
import * as OFF from './off.js';
import { Scanner, validEan } from './scanner.js';
import { FIELDS, plausibility } from './parser.js';
import { MICRO, MKEYS } from './nutrients.js';
import * as ING from './ingredients.js';
import { nutriScore } from './nutriscore.js';
import { DISHES, DISH_MAP, rankDishes, CLIP_TEXTS, rankClip } from './dishes.js';
import { LIFE, GOALS, DEFAULT_PROFILE, DEFAULT_SPLIT, calc, goalText, trend, checkProfile, migrateProfile, macroGrams } from './goals.js';
import { $, $$, ic, fmt, num, num0, inVal, esc, today, addDays, dayDiff, dayLabel, dateLong, colorFor, initials, norm, download, parseD, dstr } from './util.js';

const APP_VERSION = '1.5.1';
const screen = $('#screen');
const MEALS = ['Frühstück', 'Mittagessen', 'Abendessen', 'Snacks'];
const SRC = { Gericht: ['Gericht, Richtwert', 'bls'], OFF: ['Open Food Facts', 'off'], BLS: ['Grundlebensmittel', 'bls'], Eigen: ['Eigenes', 'eigen'], Rezept: ['Rezept', 'rezept'], Foto: ['Foto-Erfassung', 'foto'], Schnell: ['Schnell-Eintrag', 'foto'] };
const NKEYS = ['kcal', 'kj', 'fat', 'sat', 'carb', 'sugar', 'fiber', 'prot', 'salt'];
const emptyN = () => Object.fromEntries(NKEYS.map((k) => [k, 0]));
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']; // Index wie Date.getDay()
const WD_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];

/* ---------- Zustand ---------- */
const S = {
  day: today(),
  stack: [{ v: 'heute' }],
  addMeal: defaultMeal(),
  addTab: 'Zuletzt',
  basket: null, // Mahlzeit, die gerade aus mehreren Teilen zusammengestellt wird
  combos: [], // gespeicherte Mahlzeiten
  checks: [], // zuletzt geprüfte Produkte (Inhaltsstoff-Check)
  q: '',
  pickFor: null, // 'recipe' wenn Zutat gesucht wird
  foods: new Map(), // eigene, Foto, Rezepte, gespeicherte OFF-Produkte
  tmp: new Map(), // Online-Treffer, noch nicht gespeichert
  favs: new Set(),
  days: new Map(), // Datum -> Einträge
  online: { q: '', status: 'idle', list: [], msg: '' },
  profile: null,
  goal: { kcal: 2000, auto: true, split: { ...DEFAULT_SPLIT } },
  theme: 'system',
  draft: null, // Rezept in Bearbeitung
  scanner: null,
  ignorePops: 0,
  goals: [], // eigene Ziele (Gewicht, Körperfett, Eiweiß pro Tag …)
  measures: {}, // Messwerte je Zielart: { fat: [{ date, v }], water: { '2026-11-04': 0.75 } }
  supps: [], // Supplements
  supplog: {}, // Datum -> { Supplement-ID: Anzahl }
  plan: {}, // Essensplan: Wochentag (0 = So) -> Mahlzeit -> Einträge
  prefs: { planOnly: false, weekStart: 1, home: 'day', health: { set: false, last: 0, send: { kcal: true, macros: true, supps: true, weight: true } },
    water: { on: true, goal: 2500, glass: 250 }, streak: 'kcal', period: '3M', sunday: true },
  vtab: 'woche', // Verlauf: "Diese Woche" oder "Rückblick"
  ringMode: null, // Tag oder Woche auf der Startseite (für diese Sitzung)
};

function defaultMeal() {
  const h = new Date().getHours();
  return h < 10 ? 0 : h < 15 ? 1 : h < 21 ? 2 : 3;
}

const isOnline = () => navigator.onLine !== false;
const getFood = (id) => S.foods.get(id) || S.tmp.get(id) || BASIS_MAP.get(id) || DISH_FOODS.get(id);
const BASIS_MAP = new Map(BASIS.map((f) => [f.id, f]));
// Gerichte aus der Essensfoto-Liste sind auch normal such- und eintragbar (als Richtwert)
const dishFood = (d) => ({ id: 'dish:' + d.k, src: 'Gericht', name: d.name, n: { ...d.n }, portions: [{ l: 'klein', g: d.p[0] }, { l: 'mittel', g: d.p[1] }, { l: 'groß', g: d.p[2] }] });
const DISH_FOODS = new Map(DISHES.map((d) => [`dish:${d.k}`, dishFood(d)]));
const goalMacros = () => S.goal.macros || macroGrams(S.goal.kcal, S.goal.split);
// Tagesziel aus dem Rechner übernehmen (wenn "automatisch" an ist)
function applyAuto() {
  if (!S.goal.auto || !S.profile || S.profile.skipped || checkProfile(S.profile)) return;
  const r = calc(S.profile);
  S.goal.kcal = r.target;
  S.goal.macros = { prot: r.prot, carb: r.carb, fat: r.fat };
}
// Ziel für einen bestimmten Tag. Bei eigenem Wochentags-Ziel bleibt Eiweiß gleich, Kohlenhydrate und Fett werden angepasst.
function goalFor(d) {
  const base = goalMacros(), kcal0 = S.goal.kcal, wd = parseD(d).getDay();
  const k = S.goal.perDay ? S.goal.days?.[wd] || keepWeekKcal(wd) : null;
  if (!k || k === kcal0) return { kcal: kcal0, prot: base.prot, carb: base.carb, fat: base.fat, wd, custom: false };
  const rest = Math.max(0, k - base.prot * 4), old = base.carb * 4 + base.fat * 9, f = old > 0 ? rest / old : 0;
  return { kcal: k, prot: base.prot, carb: Math.round(base.carb * f), fat: Math.round(base.fat * f), wd, custom: true };
}
// "Wochensumme gleich lassen": Mehr oder Weniger an eigenen Tagen wird auf die übrigen Tage verteilt
function keepWeekKcal(wd) {
  if (!S.goal.keepWeek || !S.goal.perDay) return null;
  const set = Object.entries(S.goal.days || {}).filter(([, v]) => v > 0);
  if (set.some(([d]) => +d === wd)) return null;
  const extra = set.reduce((a, [, v]) => a + v - S.goal.kcal, 0), free = 7 - set.length;
  return free > 0 && extra ? S.goal.kcal - extra / free : null; // nicht runden, damit die Wochensumme genau bleibt
}
// Woche: beginnt am Montag (oder Sonntag, einstellbar)
function weekDays(d) {
  const dt = parseD(d), off = (dt.getDay() - S.prefs.weekStart + 7) % 7, start = addDays(d, -off);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}
const loadWeek = (d) => Promise.all(weekDays(d).map((x) => loadDay(x)));
const nutOf = (n, g) => { const f = g / 100; return { kcal: n.kcal * f, prot: n.prot * f, carb: n.carb * f, fat: n.fat * f }; };

async function loadDay(d, force) {
  if (!force && S.days.has(d)) return S.days.get(d);
  const list = await db.byIndex('entries', 'date', d);
  list.sort((a, b) => (a.t || 0) - (b.t || 0));
  S.days.set(d, list);
  return list;
}
const totals = (list) => list.reduce((a, e) => { const n = nutOf(e.n, e.g); a.kcal += n.kcal; a.prot += n.prot; a.carb += n.carb; a.fat += n.fat; return a; }, { kcal: 0, prot: 0, carb: 0, fat: 0 });

/* Supplements: Anzahl je Tag, zählen mit Kalorien (z. B. Eiweißpulver) und Wirkstoff zum Tageswert */
// Zahl ohne unnötige Nachkommastellen (1.000 statt 1.000,00; 0,25 bleibt)
const fmtA = (v) => fmt(v, Math.abs(v - Math.round(v)) < 1e-9 ? 0 : Math.abs(v * 10 - Math.round(v * 10)) < 1e-9 ? 1 : 2);
const SUPP_UNITS = ['mg', 'µg', 'g', 'IE'], SUPP_FORMS = ['Tablette', 'Kapsel', 'Messlöffel', 'Tropfen', 'Portion'];
const IE = { vitd: 0.025, vita: 0.3, vite: 0.67 }; // 1 IE in der Einheit des Nährstoffs
const suppTaken = (d) => S.supplog[d] || {};
// Menge des Wirkstoffs in der Einheit, die die App für den Nährstoff nutzt
function suppDose(s, count) {
  const m = MICRO.find((x) => x.k === s.nutr);
  if (!m) return 0;
  const amt = s.amt * count;
  if (s.unit === 'IE') return IE[m.k] ? amt * IE[m.k] : 0;
  const toG = { g: 1, mg: 1e-3, 'µg': 1e-6 }[s.unit] || 0;
  return amt * toG * m.f;
}
function suppTotals(d) {
  const t = { kcal: 0, prot: 0, carb: 0, fat: 0, micro: {} }, log = suppTaken(d);
  for (const s of S.supps) {
    const n = log[s.id];
    if (!n) continue;
    t.kcal += (s.kcal || 0) * n; t.prot += (s.prot || 0) * n;
    if (s.nutr) t.micro[s.nutr] = (t.micro[s.nutr] || 0) + suppDose(s, n);
  }
  return t;
}
// Tagessumme aus Tagebuch und Supplements
function dayTotals(d, list = S.days.get(d) || []) {
  const t = totals(list), s = suppTotals(d);
  return { kcal: t.kcal + s.kcal, prot: t.prot + s.prot, carb: t.carb, fat: t.fat };
}

/* Verlauf über längere Zeit: Tageswerte, Serien und Rückblick */
const PERIODS = [['1W', '1 Woche', 7], ['1M', '1 Monat', 30], ['3M', '3 Monate', 91], ['6M', '6 Monate', 182], ['1J', '1 Jahr', 365], ['ALL', 'Gesamt', 0]];
const perShort = (k) => (k === 'ALL' ? 'Alle' : k.replace(/(\d)/, '$1 '));
const STREAKS = { kcal: 'im Rahmen', prot: 'Eiweißziel erreicht', water: 'Wasserziel erreicht', supps: 'alle Supplements' };
const daysBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / 864e5);
// Einträge ab `from` laden und nach Tag sortieren
async function loadHist(from) {
  const es = await db.range('entries', 'date', from, today());
  const per = new Map();
  es.forEach((e) => { if (!per.has(e.date)) per.set(e.date, []); per.get(e.date).push(e); });
  return { from, es, per, cache: new Map() };
}
function histDay(H, d) {
  let x = H.cache.get(d);
  if (!x) { const list = H.per.get(d) || []; x = { d, ...dayTotals(d, list), n: list.length, goal: goalFor(d), water: water(d) }; H.cache.set(d, x); }
  return x;
}
// Zählt der Tag für die Serie? Kalorien "im Rahmen": 70 bis 105 % vom Tagesziel; mit Wochenbudget zählt die Woche bis zu dem Tag
function dayOk(H, kind, d) {
  const x = histDay(H, d);
  if (kind === 'water') return x.water > 0 && x.water * 1000 >= S.prefs.water.goal - 1;
  if (kind === 'prot') return x.n > 0 && x.prot >= x.goal.prot;
  if (kind === 'supps') { const log = suppTaken(d); return S.supps.length > 0 && S.supps.every((s) => log[s.id]); }
  if (!x.n || x.kcal < x.goal.kcal * 0.7) return false;
  if (S.goal.perDay && S.goal.keepWeek) {
    const wd = weekDays(d).filter((w) => w <= d && w >= H.from);
    return wd.reduce((a, w) => a + histDay(H, w).kcal, 0) <= wd.reduce((a, w) => a + histDay(H, w).goal.kcal, 0) * 1.05;
  }
  return x.kcal <= x.goal.kcal * 1.05;
}
// Aktuelle Serie: bis gestern (heute zählt mit, sobald erreicht; Kalorien erst, wenn der Tag vorbei ist)
function currentStreak(H, kind = S.prefs.streak) {
  if (!H || !STREAKS[kind]) return 0;
  let c = kind !== 'kcal' && dayOk(H, kind, today()) ? 1 : 0, d = addDays(today(), -1);
  while (d >= H.from && dayOk(H, kind, d)) { c++; d = addDays(d, -1); }
  return c;
}
const streakText = (n, kind = S.prefs.streak) => `${fmt(n)} ${n === 1 ? 'Tag' : 'Tage'} ${STREAKS[kind]}`;

/* Eigene Ziele: Messwerte (vom Start zum Ziel) und Tagesziele (pro Tag bzw. Woche) */
const GOAL_TYPES = {
  weight: { l: 'Gewicht', u: 'kg', d: 1, m: true, min: 30, max: 350 },
  fat: { l: 'Körperfett', u: '%', d: 1, m: true, min: 3, max: 70 },
  waist: { l: 'Bauchumfang', u: 'cm', d: 0, m: true, min: 40, max: 250 },
  muscle: { l: 'Muskelmasse', u: 'kg', d: 1, m: true, min: 10, max: 150 },
  kcal: { l: 'Kalorien pro Tag', u: 'kcal', d: 0, day: 'kcal' },
  kcalw: { l: 'Kalorien pro Woche', u: 'kcal', d: 0, week: true },
  prot: { l: 'Eiweiß pro Tag', u: 'g', d: 0, day: 'prot' },
  water: { l: 'Wasser pro Tag', u: 'l', d: 2, day: 'water' },
};
const GOAL_ORDER = ['weight', 'fat', 'waist', 'muscle', 'kcal', 'kcalw', 'prot', 'water'];
let weightsCache = null;
async function loadWeights(force) { if (force || !weightsCache) weightsCache = (await db.all('weights')).sort((a, b) => a.date.localeCompare(b.date)); return weightsCache; }
// Messreihe einer Zielart, älteste zuerst
function series(type) {
  if (type === 'weight') return (weightsCache || []).map((w) => ({ date: w.date, v: w.kg }));
  if (!GOAL_TYPES[type]?.m) return [];
  return [...(S.measures[type] || [])].sort((a, b) => a.date.localeCompare(b.date));
}
const water = (d) => (S.measures.water && !Array.isArray(S.measures.water) ? S.measures.water[d] || 0 : 0);
function goalValue(g, d = S.day) {
  const T = GOAL_TYPES[g.type];
  if (T.m) { const s = series(g.type); return s.length ? s[s.length - 1].v : g.start; }
  if (T.week) return weekDays(d).reduce((a, x) => a + dayTotals(x).kcal, 0);
  if (T.day === 'water') return water(d);
  return dayTotals(d)[T.day];
}
function goalPct(g, d = S.day) {
  const T = GOAL_TYPES[g.type], v = goalValue(g, d);
  if (T.m) { const span = g.start - g.target; return span ? Math.max(0, Math.min(1, (g.start - v) / span)) : v === g.target ? 1 : 0; }
  return g.target > 0 ? Math.max(0, Math.min(1, v / g.target)) : 0;
}
function goalRest(g, d = S.day) {
  const T = GOAL_TYPES[g.type], v = goalValue(g, d), p = goalPct(g, d);
  if (p >= 1) return 'Ziel erreicht';
  const rest = Math.abs((T.m ? v : g.target) - (T.m ? g.target : v));
  return `noch ${fmt(rest, T.d)} ${T.u}`;
}
function goalSub(g, d = S.day) {
  const T = GOAL_TYPES[g.type], v = goalValue(g, d);
  if (T.m) return `jetzt ${fmt(v, T.d)} ${T.u} · Start ${fmt(g.start, T.d)} · Ziel ${fmt(g.target, T.d)} ${T.u}${g.until ? ' bis ' + esc(dateLong(g.until)) : ''}`;
  return `${fmt(v, T.d)} von ${fmt(g.target, T.d)} ${T.u}${T.week ? ' diese Woche' : dayLabel(d) === 'Heute' ? ' heute' : ''}`;
}
const goalRow = (g, act = 'goalOpen') => {
  const p = goalPct(g);
  return `<button class="goalrow" data-act="${act}" data-id="${esc(g.id)}"><span class="gt"><span>${GOAL_TYPES[g.type].l}</span><span>${fmt(p * 100)} % geschafft</span></span><span class="bar"><i style="width:${p * 100}%;background:var(--accent)"></i></span><span class="gs">${goalSub(g)} · ${goalRest(g)}</span></button>`;
};
// Neuen Messwert speichern (Gewicht im Gewichtsverlauf, alles andere bei den Messwerten)
async function addMeasure(type, date, v) {
  if (type === 'weight') {
    await db.put('weights', { date, kg: v });
    const all = await loadWeights(true);
    if (S.profile && all[all.length - 1].date === date) { S.profile.weight = v; await setSetting('profile', S.profile); if (S.goal.auto) { applyAuto(); await setSetting('goal', S.goal); } }
    return;
  }
  if (type === 'water') { const w = S.measures.water && !Array.isArray(S.measures.water) ? S.measures.water : {}; w[date] = Math.max(0, Math.round(v * 100) / 100); S.measures.water = w; }
  else S.measures[type] = [...(S.measures[type] || []).filter((x) => x.date !== date), { date, v }];
  await setSetting('measures', S.measures);
}

/* Essensplan: S.plan[Wochentag][Mahlzeit] = [{ pid, foodId, name, g, n, … }] */
const planFor = (d, meal) => S.plan[parseD(d).getDay()]?.[meal] || [];
const planItem = (f, g) => ({ pid: uid(), foodId: f.id, name: f.name, brand: f.brand || '', src: f.src, img: f.img || '', g, n: { ...f.n }, portions: f.portions || [] });
const planKcal = (list) => list.reduce((a, p) => a + nutOf(p.n, p.g).kcal, 0);
async function logPlanned(items, meal) {
  const list = await loadDay(S.day), t0 = Date.now();
  for (const [ix, p] of items.entries()) {
    const e = { id: uid(), date: S.day, meal, t: t0 + ix, foodId: p.foodId, name: p.name, brand: p.brand, src: p.src, img: p.img, g: p.g, n: { ...p.n }, portions: p.portions || [] };
    await db.put('entries', e); list.push(e);
  }
}
// Plan-Eintrag als Lebensmittel verfügbar machen (falls ein Online-Produkt nicht gespeichert ist)
const planFood = (p) => getFood(p.foodId) || (S.tmp.set(p.foodId, { id: p.foodId, src: p.src, name: p.name, brand: p.brand, img: p.img, n: p.n, portions: p.portions || [] }), S.tmp.get(p.foodId));

/* Nutri-Score */
const NS = ['a', 'b', 'c', 'd', 'e'];
function nutriOf(f) {
  if (!f || f.src === 'Schnell') return null;
  if (f.nutri) return { g: f.nutri, calc: false };
  const g = nutriScore(f.n);
  return g ? { g, calc: true } : { g: null, calc: true };
}
const nsBadge = (g) => (g ? `<span class="nsbadge ${g}" title="Nutri-Score ${g.toUpperCase()}">${g.toUpperCase()}</span>` : '');

async function saveFood(f) {
  f.updated = Date.now();
  await db.put('foods', f);
  S.foods.set(f.id, f);
  S.tmp.delete(f.id);
  return f;
}

/* ---------- Navigation (mit Zurück-Taste des Handys) ---------- */
const cur = () => S.stack[S.stack.length - 1];
function go(v, p = {}) { S.stack.push({ v, ...p }); history.pushState({ d: S.stack.length }, ''); render(true); }
function replace(v, p = {}) { S.stack[S.stack.length - 1] = { v, ...p }; render(true); }
function back() { if (S.stack.length > 1) history.back(); }
function popN(n) {
  n = Math.min(n, S.stack.length - 1);
  if (n <= 0) return;
  S.stack.length -= n;
  S.ignorePops++;
  history.go(-n);
}
function root(v, p = {}) { popN(S.stack.length - 1); S.stack = [{ v, ...p }]; render(true); }
function popTo(v) { const i = S.stack.map((s) => s.v).lastIndexOf(v); if (i >= 0) popN(S.stack.length - 1 - i); render(true); }
addEventListener('popstate', () => {
  if (S.ignorePops > 0) { S.ignorePops--; return; }
  if (S.stack.length > 1) { S.stack.pop(); render(true); }
});

let toastT;
function toast(msg, warn, undo) {
  $$('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.innerHTML = ic(warn ? 'warn' : undo ? 'trash' : 'check') + `<span>${esc(msg)}</span>` + (undo ? `<button class="undo" type="button">Rückgängig</button>` : '');
  if (undo) t.querySelector('.undo').addEventListener('click', async () => { t.remove(); await undo(); });
  document.body.appendChild(t);
  clearTimeout(toastT);
  toastT = setTimeout(() => t.remove(), undo || msg.length > 60 ? 5000 : 2800);
}

/* ---------- Wischen zum Löschen (ein Baustein für alle Listen) ---------- */
// Kurz nach links: roter Knopf bleibt stehen. Weit nach links: weg, mit 5 Sekunden "Rückgängig".
const swipeRow = (kind, id, inner) => `<div class="swipe" data-swipe="${kind}" data-id="${esc(id)}"><div class="swipe-bg"><button type="button" data-act="swipeDel" aria-label="Löschen" tabindex="-1">${ic('trash')}Löschen</button></div><div class="fg">${inner}<button type="button" class="hdel" data-act="swipeDel" aria-label="Löschen">${ic('trash')}</button></div></div>`;
let sw = null, swipeAt = 0;
const closeSwipe = (row) => { row.classList.remove('open'); const fg = row.querySelector('.fg'); fg.style.transition = ''; fg.style.transform = ''; };
document.addEventListener('pointerdown', (e) => {
  const fg = e.target.closest('.swipe > .fg');
  $$('.swipe.open').forEach((r) => { if (!fg || r !== fg.parentElement) closeSwipe(r); });
  if (!fg || e.button > 0 || e.target.closest('.hdel')) { sw = null; return; }
  const row = fg.parentElement;
  sw = { fg, row, x: e.clientX, y: e.clientY, dx: 0, base: row.classList.contains('open') ? -88 : 0, on: false, id: e.pointerId };
});
document.addEventListener('pointermove', (e) => {
  if (!sw || e.pointerId !== sw.id) return;
  const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
  if (!sw.on) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { sw = null; return; }
    if (Math.abs(dx) < 10) return;
    sw.on = true; sw.fg.style.transition = 'none';
    try { sw.fg.setPointerCapture(e.pointerId); } catch { /* egal */ }
  }
  sw.dx = Math.min(0, sw.base + dx);
  sw.fg.style.transform = `translateX(${sw.dx}px)`;
});
function swipeEnd(e) {
  if (!sw || e.pointerId !== sw.id) return;
  const s = sw; sw = null;
  if (!s.on) return;
  swipeAt = Date.now();
  s.fg.style.transition = '';
  const w = s.row.offsetWidth;
  if (-s.dx > w * 0.55) { s.fg.style.transform = `translateX(${-w}px)`; setTimeout(() => swipeDelete(s.row), 160); }
  else if (-s.dx > Math.min(w * 0.25, 70)) { s.row.classList.add('open'); s.fg.style.transform = 'translateX(-88px)'; }
  else closeSwipe(s.row);
}
document.addEventListener('pointerup', swipeEnd);
document.addEventListener('pointercancel', swipeEnd);
// Nach dem Wischen keinen Klick auslösen; Tipp auf eine offene Zeile schließt sie nur
document.addEventListener('click', (e) => {
  if (Date.now() - swipeAt < 400) { e.stopPropagation(); e.preventDefault(); return; }
  const fg = e.target.closest('.swipe.open > .fg');
  if (fg && !e.target.closest('.hdel')) { e.stopPropagation(); e.preventDefault(); closeSwipe(fg.parentElement); }
}, true);

// Löschen je Listenart. Gibt Meldung und eine Funktion zum Rückgängigmachen zurück.
const DEL = {
  async entry(id) {
    const d = S.day, list = S.days.get(d) || [], e = list.find((x) => x.id === id);
    if (!e) return null;
    await db.del('entries', id); S.days.set(d, list.filter((x) => x !== e));
    return { msg: `${e.name} gelöscht`, undo: async () => { await db.put('entries', e); S.days.get(d).push(e); S.days.get(d).sort((a, b) => (a.t || 0) - (b.t || 0)); } };
  },
  async food(id) {
    const f = S.foods.get(id), fav = S.favs.has(id);
    if (!f) return null;
    await db.del('foods', id); S.foods.delete(id); S.favs.delete(id); await setSetting('favs', [...S.favs]);
    return { msg: `${f.name} gelöscht`, undo: async () => { await saveFood(f); if (fav) { S.favs.add(id); await setSetting('favs', [...S.favs]); } } };
  },
  async combo(id) {
    const i = S.combos.findIndex((x) => x.id === id);
    if (i < 0) return null;
    const [m] = S.combos.splice(i, 1); await setSetting('combos', S.combos);
    return { msg: `${m.name} gelöscht`, undo: async () => { S.combos.splice(i, 0, m); await setSetting('combos', S.combos); } };
  },
  async supp(id) {
    const i = S.supps.findIndex((x) => x.id === id);
    if (i < 0) return null;
    const [m] = S.supps.splice(i, 1); await setSetting('supps', S.supps);
    return { msg: `${m.name} gelöscht`, undo: async () => { S.supps.splice(i, 0, m); await setSetting('supps', S.supps); } };
  },
  async goal(id) {
    const i = S.goals.findIndex((x) => x.id === id);
    if (i < 0) return null;
    const [m] = S.goals.splice(i, 1); await setSetting('goals', S.goals);
    return { msg: `Ziel „${GOAL_TYPES[m.type].l}“ gelöscht`, undo: async () => { S.goals.splice(i, 0, m); await setSetting('goals', S.goals); } };
  },
  async plan(id) {
    const [wd, meal, pid] = id.split('|'), list = S.plan[wd]?.[meal] || [], i = list.findIndex((x) => x.pid === pid);
    if (i < 0) return null;
    const [m] = list.splice(i, 1); await setSetting('plan', S.plan);
    return { msg: `${m.name} aus dem Plan genommen`, undo: async () => { list.splice(i, 0, m); await setSetting('plan', S.plan); } };
  },
  async check(id) {
    const i = S.checks.findIndex((x) => x.id === id);
    if (i < 0) return null;
    const [m] = S.checks.splice(i, 1); await setSetting('checks', S.checks);
    return { msg: `${m.name} aus der Liste genommen`, undo: async () => { S.checks.splice(i, 0, m); await setSetting('checks', S.checks); } };
  },
};
const refreshView = () => { if (cur().v === 'add') refreshResults(); else renderKeep(); };
async function swipeDelete(row) {
  const kind = row.dataset.swipe, id = row.dataset.id;
  row.style.height = row.offsetHeight + 'px';
  requestAnimationFrame(() => { row.classList.add('gone'); row.style.height = '0px'; });
  const r = await DEL[kind]?.(id);
  setTimeout(refreshView, 180);
  if (r) toast(r.msg, false, async () => { await r.undo(); refreshView(); });
}

function sheet(html) {
  closeSheet();
  const s = document.createElement('div');
  s.className = 'scrim';
  s.id = 'sheet';
  s.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  s.addEventListener('click', (e) => { if (e.target === s) closeSheet(); });
  document.body.appendChild(s);
  return s;
}
function closeSheet() { $('#sheet')?.remove(); }
// Eigene Rückfrage statt confirm(): funktioniert überall, auch in eingebetteten Ansichten
function ask(text, okLabel, danger = true) {
  return new Promise((res) => {
    const s = sheet(`<h3>${esc(text)}</h3><div class="row2"><button class="btn sec" data-ask="0">Abbrechen</button><button class="btn ${danger ? 'danger' : ''}" data-ask="1" style="${danger ? 'background:var(--danger);color:#fff;border:0' : ''}">${esc(okLabel)}</button></div>`);
    const done = (v) => { closeSheet(); res(v); };
    s.addEventListener('click', (e) => { const b = e.target.closest('[data-ask]'); if (b) done(b.dataset.ask === '1'); else if (e.target === s) res(false); });
  });
}

/* ---------- Bausteine ---------- */
function thumb(f) {
  const name = f?.name || '?';
  const col = f?.src === 'Rezept' ? 'var(--fat)' : f?.src === 'Eigen' ? 'var(--accent)' : colorFor(name);
  if (f?.img && isOnline()) return `<span class="thumb" style="background:${col}"><img src="${esc(f.img)}" alt="" loading="lazy" onerror="this.remove()"></span>`;
  return `<span class="thumb" style="background:${col}">${esc(initials(name))}</span>`;
}
const srcBadge = (f) => { const [t, c] = SRC[f.src] || SRC.Eigen; return `<span class="src ${c}">${t}</span>`; };
function resultItem(f) {
  const p = f.portions?.[0];
  return `<button class="item" data-act="pick" data-id="${esc(f.id)}">${thumb(f)}<span class="tx"><span class="n">${esc(f.name)}</span><span class="s">${f.brand ? esc(f.brand) + ' · ' : ''}${fmt(f.n.kcal)} kcal / 100 g${p ? ` · ${esc(p.l)} ${fmt(p.g)} g` : ''}</span></span>${srcBadge(f)}</button>`;
}
const topbar = (title, right = '', backIcon = 'back') => `<div class="top">${S.stack.length > 1 ? `<button class="iconbtn" data-act="back" aria-label="Zurück">${ic(backIcon)}</button>` : ''}<h2>${title}</h2>${right}</div>`;

/* ---------- Bildschirme ---------- */
const V = {};

/* Besondere Treffer in der Suche: Kalorien-Eintrag ohne Lebensmittel und Wasser */
function specialResults(q) {
  const l = q.toLowerCase().replace(',', '.');
  let out = '';
  const kc = l.match(/^(\d{1,4})\s*(kcal|kal|kalorien|cal)$/);
  if (kc) out += `<button class="btn sec" data-act="quick" data-k="${kc[1]}">${ic('plus')} ${kc[1]} kcal als Schnell-Eintrag zu ${MEALS[S.addMeal]}</button>`;
  else if (/^(kal|kcal|cal|dumm|schnell|kalorien)/.test(l) && l.length >= 3) out += `<div class="card special"><div class="cardh"><h3>Kalorien eintragen</h3><span class="k">ohne Lebensmittel</span></div>
    <div class="qrow"><input id="qk" inputmode="numeric" placeholder="z. B. 450" aria-label="Kalorien"><span class="u">kcal</span><button class="btn" data-act="quickIn">Zu ${MEALS[S.addMeal]}</button></div>
    <small>Praktisch im Restaurant oder wenn du nur die Kalorien kennst.</small></div>`;
  const wm = l.match(/^(\d+(?:\.\d+)?)\s*(ml|l|liter)\b(?:\s*wasser)?$/);
  const wq = /^(wass|water|trink|getr)/.test(l) && l.length >= 3;
  if (S.prefs.water?.on !== false && (wm || wq)) {
    const gl = S.prefs.water.glass, ml = wm ? Math.round(+wm[1] * (wm[2] === 'ml' ? 1 : 1000)) : 0;
    const opts = [...new Set([ml, gl, 500, 1000].filter((x) => x > 0 && x <= 5000))];
    out += `<div class="card special"><div class="cardh"><h3>${ic('drop')} Wasser</h3><span class="k num">heute ${fmt(water(S.day), 2)} l</span></div>
      <div class="chips">${opts.map((v) => `<button class="chip wchip" data-act="qWater" data-ml="${v}">+ ${v >= 1000 ? fmt(v / 1000, 1) + ' l' : v + ' ml'}</button>`).join('')}${water(S.day) > 0 ? `<button class="chip" data-act="qWater" data-ml="${-gl}">− ${gl} ml</button>` : ''}</div></div>`;
  }
  return out;
}

/* Wasser-Glas: tippen = ein Glas mehr, lange drücken = eins zurück */
let glassT = null, glassLong = false;
async function addWater(ml) {
  const v = Math.max(0, water(S.day) + ml / 1000);
  await addMeasure('water', S.day, v); renderKeep();
}
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('#glass')) return;
  glassLong = false;
  clearTimeout(glassT);
  glassT = setTimeout(() => { glassLong = true; navigator.vibrate?.(30); if (water(S.day) > 0) { addWater(-S.prefs.water.glass); toast(`${S.prefs.water.glass} ml zurückgenommen`); } }, 550);
});
['pointerup', 'pointercancel', 'pointerleave'].forEach((n) => document.addEventListener(n, () => clearTimeout(glassT)));
document.addEventListener('contextmenu', (e) => { if (e.target.closest('#glass')) e.preventDefault(); });
document.addEventListener('click', (e) => {
  if (!e.target.closest('#glass')) return;
  e.stopPropagation();
  if (!glassLong) addWater(S.prefs.water.glass);
  glassLong = false;
}, true);

/* Updates: neue Version im Hintergrund holen und einen "Neu laden"-Knopf zeigen */
function showUpdateBar() {
  if ($('#updbar')) return;
  const bar = document.createElement('div');
  bar.id = 'updbar'; bar.className = 'updbar'; bar.setAttribute('role', 'status');
  bar.innerHTML = `${ic('down')}<span>Neue Version verfügbar</span><button type="button">Neu laden</button>`;
  bar.querySelector('button').onclick = () => location.reload();
  document.body.appendChild(bar);
}
function initUpdates() {
  const sw = navigator.serviceWorker, had = !!sw.controller;
  sw.addEventListener('controllerchange', () => { if (had) showUpdateBar(); });
  sw.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    S.swReg = reg;
    const check = () => { if (isOnline()) reg.update().catch(() => {}); };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 30 * 60 * 1000);
  }).catch(() => {});
}
async function checkUpdate() {
  const reg = S.swReg || await navigator.serviceWorker?.getRegistration?.();
  if (!reg) return toast('Updates gibt es nur in der installierten App.', true);
  if (!isOnline()) return toast('Dafür brauchst du Internet.', true);
  toast('Suche nach Update …');
  try { await reg.update(); } catch { return toast('Update-Suche hat nicht geklappt.', true); }
  await new Promise((r) => setTimeout(r, 2500));
  if (reg.installing || reg.waiting || $('#updbar')) toast('Neue Version wird geladen. Gleich erscheint „Neu laden“.');
  else toast(`Du hast die neueste Version (${APP_VERSION}).`);
}

/* Willkommen / erstes Einrichten */
V.welcome = () => `<div class="pad welcome" style="padding-top:28px">
  <img src="icons/icon.svg" alt="" width="64" height="64" style="border-radius:18px">
  <h1>Willkommen bei KalorienTracker</h1>
  <p>Scanne Barcodes, suche Lebensmittel, lege Rezepte an oder fotografiere eine Nährwerttabelle. Alles bleibt auf deinem Gerät, ohne Konto.</p>
  <p>Damit die App dein Tagesziel berechnen kann, brauche ich ein paar Angaben. Du kannst sie später jederzeit ändern.</p>
  ${profileForm(S.profile || DEFAULT_PROFILE)}
  <button class="btn" data-act="welcomeSave">${ic('check')} Los geht's</button>
  <button class="btn ghost" data-act="welcomeSkip">Überspringen (Ziel 2.000 kcal)</button>
  <p class="fine">Das Tagesziel ist ein Richtwert und keine medizinische Beratung.</p>
</div>`;

function profileForm(p, full) {
  const opt = (id, label, v, ph) => `<div class="field"><label for="${id}">${label}</label><input id="${id}" inputmode="decimal" value="${v ? esc(inVal(v)) : ''}" placeholder="${ph}"></div>`;
  return `<div class="card" id="profile">
    <div class="lbl">Über dich</div>
    <div class="seg" role="radiogroup" aria-label="Geschlecht"><button type="button" data-act="sex" data-v="w" class="${p.sex === 'w' ? 'on' : ''}">Frau</button><button type="button" data-act="sex" data-v="m" class="${p.sex !== 'w' ? 'on' : ''}">Mann</button></div>
    <div class="row2"><div class="field"><label for="pf-age">Alter</label><input id="pf-age" inputmode="numeric" value="${esc(p.age)}"></div>
    <div class="field"><label for="pf-height">Größe (cm)</label><input id="pf-height" inputmode="numeric" value="${esc(p.height)}"></div></div>
    <div class="row2"><div class="field"><label for="pf-weight">Gewicht (kg)</label><input id="pf-weight" inputmode="decimal" value="${esc(inVal(p.weight))}"></div>
    <div class="field"><label for="pf-td">Training pro Woche</label><select id="pf-td">${[0, 1, 2, 3, 4, 5, 6, 7].map((n) => `<option value="${n}" ${n == (p.td ?? 3) ? 'selected' : ''}>${n === 0 ? 'kein Training' : n + (n === 1 ? ' Tag' : ' Tage')}</option>`).join('')}</select></div></div>
    <div class="field"><label for="pf-life">Alltag (ohne Training)</label><select id="pf-life">${LIFE.map(([v, l, d, st]) => `<option value="${v}" ${v == p.life ? 'selected' : ''}>${l}: ${d} (${st})</option>`).join('')}</select></div>
    <div class="field"><label for="pf-goal">Ziel</label><select id="pf-goal">${GOALS.map(([k, l, d]) => `<option value="${k}" ${k === p.goal ? 'selected' : ''}>${l} (${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)} kcal)</option>`).join('')}</select></div>
    ${full ? `<div class="lbl" style="margin-top:6px">Optional</div>
    <div class="row2">${opt('pf-gw', 'Zielgewicht (kg)', p.gw, 'optional')}${opt('pf-bf', 'Körperfett (%)', p.bf, 'optional')}</div>
    <div class="row2">${opt('pf-bft', 'Ziel-Körperfett (%)', p.bft, 'optional')}<div></div></div>
    <div style="font-size:12.5px;color:var(--muted)">Mit Körperfett rechnet der Rechner genauer (Katch-McArdle). Messungen mit Waage oder Zange können aber um mehrere Prozentpunkte danebenliegen.</div>` : `<div class="ok" id="pf-sugg">${ic('check')}<span></span></div>`}
  </div>`;
}
function readProfile() {
  const v = (id) => num(($('#' + id) || {}).value);
  const p = {
    sex: $('#profile .seg .on')?.dataset.v || 'm',
    age: Math.round(v('pf-age')),
    height: v('pf-height'),
    weight: v('pf-weight'),
    life: v('pf-life') || 1.4,
    td: Math.round(v('pf-td')) || 0,
    goal: $('#pf-goal')?.value || 'keep',
  };
  if ($('#pf-gw')) { for (const [k, id] of [['gw', 'pf-gw'], ['bf', 'pf-bf'], ['bft', 'pf-bft']]) { const x = v(id); if (x > 0) p[k] = x; } }
  else if (S.profile) { for (const k of ['gw', 'bf', 'bft']) if (S.profile[k]) p[k] = S.profile[k]; }
  return p;
}
const YOUNG = 'Der Rechner ist für Erwachsene ab 18 gedacht. Für Jüngere frag bitte eine Ärztin, einen Arzt oder eine Ernährungsfachkraft.';
function updateSuggestion() {
  const p = readProfile(), err = checkProfile(p);
  const box = $('#pf-sugg span');
  if (box) box.innerHTML = err ? esc(err === 'young' ? YOUNG : err) : `Vorschlag: <b>${fmt(calc(p).target)} kcal</b> pro Tag, davon ${fmt(calc(p).prot)} g Eiweiß.`;
  const out = $('#calc-out');
  if (out) out.innerHTML = err ? `<div class="notice">${ic('warn')}<span>${esc(err === 'young' ? YOUNG : err)}</span></div>` : calcResultHtml(p);
}
function calcResultHtml(p) {
  const r = calc(p);
  const tile = (v, l, cls = '') => `<div class="${cls}"><b>${v}</b><span>${l}</span></div>`;
  const tr = cur().trend;
  let adapt = '';
  if (tr?.ok) adapt = `<div class="card"><div class="lbl">Dein echter Bedarf</div>
      <div style="font-size:14px">In den letzten 5 Wochen hast du an ${tr.days} Tagen im Schnitt <b>${fmt(tr.avg)} kcal</b> gegessen und ${tr.kgWeek <= 0 ? 'abgenommen' : 'zugenommen'}: etwa <b>${fmt(Math.abs(tr.kgWeek), 2)} kg pro Woche</b>. Daraus ergibt sich ein echter Erhaltungsbedarf von etwa <b>${fmt(tr.real)} kcal</b> (Rechner: ${fmt(r.maintain)} kcal).</div>
      <div class="ok">${ic('check')}<span>Angepasstes Ziel für „${esc(GOALS.find((g) => g[0] === p.goal)[1])}“: <b>${fmt(tr.adapted)} kcal</b></span></div>
      <button class="btn sec" data-act="calcAdapt" data-k="${tr.adapted}">Angepasstes Ziel übernehmen</button></div>`;
  else if (tr) adapt = `<div class="card"><div class="lbl">Dein echter Bedarf</div><div style="font-size:13.5px;color:var(--muted)">Sobald genug Daten da sind, rechnet die App aus deinem Gewichtsverlauf und den gezählten Kalorien deinen echten Bedarf aus. ${esc(tr.reason)}</div></div>`;
  return `<div class="card"><div class="lbl">Ergebnis</div>
      <div class="calc" style="grid-template-columns:repeat(3,1fr)">${tile(fmt(r.target), 'kcal Ziel', 'k')}${tile(`${r.protLo}–${r.protHi}`, 'g Eiweiß')}${tile(fmt(r.maintain), 'kcal halten')}${tile(fmt(r.bmr), 'Grundumsatz')}${tile(r.fat, 'g Fett')}${tile(r.carb, 'g Kohlenh.')}</div>
      <div style="font-size:14px">${esc(goalText(p, r))}</div>
      ${r.floored ? `<div class="notice">${ic('warn')}<span>Das Ziel wurde auf ${fmt(r.target)} kcal angehoben: Weniger als dein Grundumsatz (und nie unter 1.200 kcal) ist nicht sinnvoll.</span></div>` : ''}
      ${r.weeks ? `<div class="ok">${ic('check')}<span>Zielgewicht ${fmt(p.gw, 1)} kg in etwa <b>${r.weeks} Wochen</b>.</span></div>` : ''}
      ${r.gwWarn ? `<div class="notice">${ic('warn')}<span>${esc(r.gwWarn)}</span></div>` : ''}
      ${r.bfGoal ? `<div style="font-size:14px">Mit ${fmt(p.bft)} % Körperfett und gleicher Muskelmasse wiegst du etwa <b>${fmt(r.bfGoal.weight, 1)} kg</b>. <button class="linkbtn" data-act="bfToGw" data-v="${r.bfGoal.weight}">Als Zielgewicht übernehmen</button></div>${r.bfGoal.warn ? `<div class="notice">${ic('warn')}<span>${esc(r.bfGoal.warn)}</span></div>` : ''}` : ''}
      <button class="btn" data-act="calcSave">${ic('check')} Als Tagesziel übernehmen</button>
    </div>
    ${adapt}
    <details class="card raw"><summary>So rechnet der Rechner</summary><div style="font-size:13.5px;color:var(--muted);display:flex;flex-direction:column;gap:6px;margin-top:8px">
      <div><b style="color:var(--ink)">Grundumsatz:</b> ${r.method === 'Katch-McArdle' ? `Katch-McArdle mit Körperfett: 370 + 21,6 × fettfreie Masse (${fmt(r.lbm, 1)} kg) = ${fmt(r.bmr)} kcal.` : `Mifflin-St Jeor: 10 × Gewicht + 6,25 × Größe − 5 × Alter ${p.sex === 'w' ? '− 161' : '+ 5'} = ${fmt(r.bmr)} kcal.`}</div>
      <div><b style="color:var(--ink)">Bedarf:</b> Grundumsatz × Aktivität ${fmt(r.pal, 2)} (Alltag ${fmt(p.life, 1)} + ${p.td} Trainingstage × 0,05, höchstens 2,4) = ${fmt(r.tdee)} kcal.</div>
      <div><b style="color:var(--ink)">Ziel:</b> Bedarf ${r.delta >= 0 ? '+' : '−'} ${Math.abs(r.delta)} kcal, nie unter dem Grundumsatz, auf 10 gerundet.</div>
      <div><b style="color:var(--ink)">Eiweiß:</b> ${p.goal === 'cut' ? '2,0–2,4' : '1,6–2,0'} g pro kg ${p.gw ? 'Zielgewicht' : 'Körpergewicht'} (${fmt(r.ref, 1)} kg). Fett: 27 % der Ziel-Kalorien. Kohlenhydrate: der Rest.</div>
      <div><b style="color:var(--ink)">Tempo:</b> 1 kg Körpergewicht entspricht etwa 7.700 kcal.</div>
      <div>Mehr dazu: <a href="https://www.youtube.com/results?search_query=Kaloriendefizit+einfach+erkl%C3%A4rt" target="_blank" rel="noopener">Videos zum Kaloriendefizit</a> · <a href="https://www.youtube.com/results?search_query=Eiwei%C3%9F+Bedarf+Muskelaufbau" target="_blank" rel="noopener">Videos zum Eiweißbedarf</a></div>
    </div></details>
    <p class="fine">Schätzwerte, kein Ersatz für ärztlichen Rat.</p>`;
}

/* Rechner */
V.rechner = {
  async load(c) {
    const lo = addDays(today(), -36);
    const [ws, es] = await Promise.all([db.all('weights'), db.range('entries', 'date', lo, today())]);
    const per = new Map();
    es.forEach((e) => per.set(e.date, (per.get(e.date) || 0) + nutOf(e.n, e.g).kcal));
    const p = S.profile && !S.profile.skipped ? S.profile : null;
    c.trend = p && !checkProfile(p) ? trend(ws, [...per].map(([date, kcal]) => ({ date, kcal })), p, today()) : null;
  },
  html() {
    return `${topbar('Kalorien-Rechner')}
    <div class="pad" style="padding-top:0">
      <p style="margin:0;color:var(--muted);font-size:14px">Berechnet, wie viele Kalorien und wie viel Eiweiß du pro Tag brauchst. Das Ergebnis kannst du als Tagesziel übernehmen.</p>
      ${profileForm(S.profile && !S.profile.skipped ? S.profile : DEFAULT_PROFILE, true)}
      <div id="calc-out" style="display:flex;flex-direction:column;gap:14px"></div>
    </div>`;
  },
  mount() { updateSuggestion(); },
};

/* Heute */
V.heute = {
  load: async () => { const [, , , , H] = await Promise.all([loadDay(S.day), loadDay(addDays(S.day, -1)), loadWeek(S.day), loadWeights(), loadHist(addDays(today(), -400))]); S.hist = H; },
  html() {
    const list = S.days.get(S.day) || [];
    const prev = S.days.get(addDays(S.day, -1)) || [];
    const t = dayTotals(S.day), G = goalFor(S.day), goal = G.kcal;
    const wk = (S.ringMode || S.prefs.home) === 'week';
    const C = 2 * Math.PI * 54;
    let big, small, avg = '', pct, over, kpis, strip = '';
    if (wk) {
      const days = weekDays(S.day), goals = days.map((d) => goalFor(d).kcal), eaten = days.map((d) => dayTotals(d).kcal);
      const gW = goals.reduce((a, b) => a + b, 0), eW = eaten.reduce((a, b) => a + b, 0), leftW = gW - eW;
      const restDays = days.filter((d) => d >= S.day).length || 1;
      over = leftW < 0; pct = Math.min(eW / Math.max(gW, 1), 1);
      big = fmt(Math.abs(leftW)); small = over ? 'kcal drüber diese Woche' : 'noch diese Woche';
      if (!over) avg = `Ø ${fmt(leftW / restDays)} pro Tag`;
      kpis = `<div><b class="num">${fmt(gW)}</b><span>Wochenziel</span></div><div><b class="num">${fmt(eW)}</b><span>Gegessen</span></div><div><b class="num">${fmt(Math.max(leftW, 0))}</b><span>Übrig</span></div>`;
      const mx = Math.max(...goals, ...eaten) * 1.1 || 1;
      strip = `<div class="weekstrip">${days.map((d, i) => `<div class="wk ${d === S.day ? 'now' : ''}"><div class="col"><div class="fill ${eaten[i] > goals[i] ? 'over' : ''}" style="height:${(eaten[i] / mx) * 100}%"></div><div class="tick" style="bottom:${(goals[i] / mx) * 100}%"></div></div>${WD[parseD(d).getDay()]}</div>`).join('')}</div>`;
    } else {
      const left = goal - t.kcal;
      over = left < 0; pct = Math.min(t.kcal / Math.max(goal, 1), 1);
      big = fmt(Math.abs(left)); small = over ? 'kcal drüber' : dayLabel(S.day) === 'Heute' ? 'kcal übrig heute' : 'kcal übrig';
      kpis = `<div><b class="num">${fmt(goal)}</b><span>Ziel${G.custom ? ' ' + WD[G.wd] : ''}</span></div><div><b class="num">${fmt(t.kcal)}</b><span>Gegessen</span></div><div><b class="num">${fmt(Math.max(left, 0))}</b><span>Übrig</span></div>`;
    }
    const macro = (k, l, col) => `<div class="macro"><div class="t"><span>${l}</span><span class="num">${fmt(t[k])} / ${fmt(G[k])} g</span></div><div class="bar"><i style="width:${Math.min(t[k] / Math.max(G[k], 1), 1) * 100}%;background:var(${col})"></i></div></div>`;
    // Ziele auf der Startseite
    const homeGoals = S.goals.filter((g) => g.home);
    const goalsCard = homeGoals.length ? `<div class="card"><div class="cardh"><h3>Deine Ziele</h3><button class="btn ghost" data-act="go" data-v="goals" style="padding:2px 4px">Alle</button></div><div>${homeGoals.map((g) => goalRow(g)).join('')}</div></div>` : '';
    // Supplements heute
    let suppCard = '';
    if (S.supps.length) {
      const log = suppTaken(S.day), pend = (S.suppPend ||= {});
      const rows = S.supps.map((s) => ({ s, done: !!log[s.id], n: log[s.id] || pend[S.day + s.id] || s.count || 1 })).sort((a, b) => a.done - b.done);
      const done = rows.filter((r) => r.done).length;
      suppCard = done === rows.length && !S.suppOpen
        ? `<div class="card"><div class="cardh"><h3>Supplements heute</h3><button class="btn ghost" data-act="suppOpen" style="padding:2px 4px">${ic('check')} Alle ${rows.length} genommen</button></div></div>`
        : `<div class="card"><div class="cardh"><h3>Supplements heute</h3><span class="k num">${done} von ${rows.length}</span></div><div>${rows.map(({ s, done: dn, n }) => `<div class="supp ${dn ? 'done' : ''}"><button class="chk" data-act="suppToggle" data-id="${esc(s.id)}" aria-label="${esc(s.name)} genommen" aria-pressed="${dn}">${dn ? ic('check') : ''}</button><div style="min-width:0"><div class="n">${esc(s.name)}</div><div class="s">${n} × ${fmtA(s.amt)} ${esc(s.unit)} = ${fmtA(n * s.amt)} ${esc(s.unit)}${s.kcal ? ` · ${fmt(n * s.kcal)} kcal` : ''}</div></div><div class="stepper"><button data-act="suppDec" data-id="${esc(s.id)}" aria-label="Weniger">−</button><b>${n}</b><button data-act="suppInc" data-id="${esc(s.id)}" aria-label="Mehr">+</button></div></div>`).join('')}</div>${S.suppOpen && done === rows.length ? `<button class="btn ghost" data-act="suppOpen" style="align-self:center;padding:2px">Zuklappen</button>` : ''}</div>`;
    }
    // Wasser: Glas antippen = +1 Glas, lange drücken = eins zurück
    let waterCard = '';
    const Wp = S.prefs.water;
    if (Wp.on) {
      const ml = water(S.day) * 1000, p = Math.min(ml / Math.max(Wp.goal, 1), 1), fillY = 84 - 70 * p;
      waterCard = `<div class="card"><div class="cardh"><h3>Wasser</h3><span class="k num">${fmt(p * 100)} %</span></div>
        <div class="water"><button class="glassbtn" id="glass" aria-label="${Wp.glass} ml trinken. Lange drücken nimmt ein Glas zurück"><svg viewBox="0 0 76 92" aria-hidden="true"><defs><clipPath id="gclip"><path d="M10 8h56l-6 76H16z"/></clipPath></defs><rect x="0" y="${fillY}" width="76" height="92" fill="var(--water)" opacity=".85" clip-path="url(#gclip)"/><path d="M10 8h56l-6 76H16z" fill="none" stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round"/></svg><span class="pl">+${Wp.glass}</span></button>
        <div style="min-width:0"><div class="wv num">${fmt(ml / 1000, 2)} <span>von ${fmt(Wp.goal / 1000, 1)} l</span></div><div class="bar"><i style="width:${p * 100}%"></i></div><div class="wrow"><small>Glas antippen: +${Wp.glass} ml</small><button class="wminus" data-act="waterMinus" ${ml > 0 ? '' : 'disabled'} aria-label="${Wp.glass} ml abziehen">− ${Wp.glass} ml</button></div></div></div></div>`;
    }
    // Sonntags (letzter Tag der Woche): kleiner Wochenrückblick
    let sundayCard = '';
    const wdays = weekDays(today());
    if (S.prefs.sunday && S.day === today() && wdays[6] === today() && S.hist) {
      const past = wdays.map((d) => histDay(S.hist, d)).filter((x) => x.n > 0), ok = wdays.filter((d) => dayOk(S.hist, 'kcal', d)).length;
      const avgK = past.length ? past.reduce((a, x) => a + x.kcal, 0) / past.length : 0;
      if (past.length) sundayCard = `<div class="card sunday"><div class="cardh"><h3>Dein Wochenrückblick</h3><span class="k">${WD_LONG[parseD(today()).getDay()]}</span></div>
        <div class="stats"><div class="stat good"><span class="lbl">Im Rahmen</span><b>${ok} <small>von ${past.length} ${past.length === 1 ? 'Tag' : 'Tagen'}</small></b></div><div class="stat"><span class="lbl">Ø pro Tag</span><b class="num">${fmt(avgK)} <small>kcal</small></b></div></div>
        <button class="btn sec" data-act="vtab" data-v="rueck" data-p="1W">Ganzen Rückblick ansehen</button></div>`;
    }
    const streakN = S.day === today() ? currentStreak(S.hist) : 0;
    const meals = MEALS.map((m, i) => {
      const es = list.filter((e) => e.meal === i);
      const k = es.reduce((a, e) => a + nutOf(e.n, e.g).kcal, 0);
      const prevMeal = prev.filter((e) => e.meal === i);
      const planned = planFor(S.day, i).filter((p) => !es.some((e) => e.foodId === p.foodId));
      return `<div class="card meal">
        <div class="meal-h"><div><h3 style="display:inline">${m}</h3><span class="k num">${es.length ? fmt(k) + ' kcal' : ''}</span></div>
        <button class="addmini" data-act="addTo" data-meal="${i}" aria-label="Zu ${m} hinzufügen">${ic('plus')}</button></div>
        ${es.length ? es.map((e) => swipeRow('entry', e.id, `<button class="item" data-act="entry" data-id="${e.id}">${thumb(e)}<span class="tx"><span class="n">${esc(e.name)}${e.est ? '<span class="est">geschätzt</span>' : ''}</span><span class="s num">${e.src === 'Schnell' ? 'ohne Lebensmittel' : fmt(e.g) + ' g'}${e.brand ? ' · ' + esc(e.brand) : ''}${e.est ? ` · ca. ${fmt(nutOf(e.n, e.g).kcal * 0.8)}–${fmt(nutOf(e.n, e.g).kcal * 1.25)} kcal` : ''}</span></span><span class="kc">${fmt(nutOf(e.n, e.g).kcal)}</span></button>`)).join('')
          : planned.length ? '' : `<div class="empty">Noch nichts eingetragen.${prevMeal.length ? ` <button class="linkbtn" data-act="repeat" data-meal="${i}">Wie am Vortag (${prevMeal.length})</button>` : ''}</div>`}
        ${planned.length ? `<div class="planhead"><span>Geplant</span><button data-act="planAll" data-meal="${i}">Alles eintragen</button></div>${planned.map((p) => `<div class="planned">${thumb(p)}<span class="tx"><span class="n">${esc(p.name)}</span><span class="s num">${fmt(p.g)} g · ${fmt(nutOf(p.n, p.g).kcal)} kcal</span></span><button class="addmini" data-act="planOne" data-meal="${i}" data-pid="${esc(p.pid)}" aria-label="${esc(p.name)} eintragen">${ic('plus')}</button></div>`).join('')}` : ''}
      </div>`;
    }).join('');
    return `<div class="pad">
      <div class="datebar"><button class="iconbtn" data-act="day" data-d="-1" aria-label="Vortag">${ic('back')}</button>
        <button data-act="pickday" style="border:0;background:none;text-align:center"><strong>${dayLabel(S.day)}</strong><div class="lbl" style="text-transform:none;letter-spacing:0;font-weight:500">${dateLong(S.day)}</div></button>
        <button class="iconbtn" data-act="day" data-d="1" aria-label="Nächster Tag">${ic('fwd')}</button></div>
      <div class="heute-grid"><div class="sticky">
      <div class="card sumcard" data-act="details" role="button" tabindex="0" aria-label="Alle Nährwerte des Tages ansehen">
        <div class="ringtop"><div class="minis" role="tablist" aria-label="Rest anzeigen für"><button role="tab" aria-selected="${!wk}" class="${wk ? '' : 'on'}" data-act="ring" data-v="day">Tag</button><button role="tab" aria-selected="${wk}" class="${wk ? 'on' : ''}" data-act="ring" data-v="week">Woche</button></div>${streakN > 0 ? `<button class="streak" data-act="vtab" data-v="rueck" aria-label="Serie: ${streakText(streakN)}. Rückblick öffnen">${ic('flame')}${streakText(streakN)}</button>` : ''}</div>
        <div class="summary">
          <div class="ring" role="img" aria-label="${big} ${small}"><svg viewBox="0 0 128 128"><circle cx="64" cy="64" r="54" stroke="var(--surface2)" stroke-width="12" fill="none"/><circle cx="64" cy="64" r="54" stroke="${over ? 'var(--danger)' : 'var(--accent)'}" stroke-width="12" fill="none" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg>
            <div class="mid"><span class="big num" ${wk ? 'style="font-size:23px"' : ''}>${big}</span><span class="small">${small}</span>${avg ? `<span class="avg num">${avg}</span>` : ''}</div></div>
          <div class="macros">${macro('prot', 'Eiweiß', '--prot')}${macro('carb', 'Kohlenhydrate', '--carb')}${macro('fat', 'Fett', '--fat')}</div>
        </div>
        <div class="kpis">${kpis}</div>
        ${strip}
        ${over && !wk ? `<div style="font-size:12.5px;color:var(--muted);text-align:center">Ein Tag drüber ist okay, wenn die Woche passt.</div>` : ''}
        <div class="more">Alle Nährwerte ${ic('fwd')}</div>
      </div>
      ${S.day !== today() ? `<button class="btn sec" data-act="gotoday">Zu heute springen</button>` : ''}
      ${sundayCard}${goalsCard}${suppCard}${waterCard}
      </div><div>${meals}</div></div>
    </div>`;
  },
  wide: true,
};

/* Alle Nährwerte eines Tages */
function dayNutrients(list) {
  const T = {}, has = {};
  for (const k of [...NKEYS, ...MKEYS]) { T[k] = 0; has[k] = 0; }
  for (const e of list) {
    const f = e.g / 100;
    for (const k of [...NKEYS, ...MKEYS]) if (e.n[k] != null && !(e.src === 'Schnell' && k !== 'kcal')) { T[k] += e.n[k] * f; has[k]++; }
  }
  return { T, has };
}
V.naehrwerte = {
  load: (c) => loadDay(c.date),
  html(c) {
    const list = S.days.get(c.date) || [], G = goalFor(c.date);
    const { T, has } = dayNutrients(list);
    const n = list.filter((e) => e.src !== 'Schnell').length;
    // Supplements zählen mit (Kalorien, Eiweiß und Wirkstoff)
    const sup = suppTotals(c.date), supN = Object.keys(suppTaken(c.date)).length;
    T.kcal += sup.kcal; T.prot += sup.prot;
    for (const [k, v] of Object.entries(sup.micro)) { T[k] += v; has[k] = Math.max(has[k], n) || 1; }
    // kind: goal = Ziel, min = mindestens, max = höchstens
    const row = (l, v, ref, u, kind, col, d = 0, sub = false, note = '') => {
      const p = ref > 0 ? v / ref : 0;
      const over = kind === 'max' ? p > 1 : kind === 'goal' ? p > 1.05 : false;
      const word = kind === 'goal' ? 'Ziel ' : kind === 'min' ? 'mind. ' : kind === 'max' ? 'höchstens ' : '';
      return `<div class="nw ${sub ? 'sub' : ''}"><div class="t"><span>${l}</span><span class="num"><b>${fmt(v, d)}</b> / ${word}${fmt(ref, Number.isInteger(ref) ? 0 : d)} ${u}</span></div>
        <div class="bar"><i style="width:${Math.min(p, 1) * 100}%;background:${over ? 'var(--danger)' : `var(${col})`}"></i></div>${note ? `<div class="s">${note}</div>` : ''}</div>`;
    };
    const sugarMax = (G.kcal * 0.1) / 4, satMax = (G.kcal * 0.1) / 9;
    const main = [
      row('Kalorien', T.kcal, G.kcal, 'kcal', 'goal', '--accent'),
      row('Eiweiß', T.prot, G.prot, 'g', 'goal', '--prot'),
      row('Kohlenhydrate', T.carb, G.carb, 'g', 'goal', '--carb'),
      row('davon Zucker', T.sugar, sugarMax, 'g', 'max', '--carb', 0, true),
      row('Ballaststoffe', T.fiber, 30, 'g', 'min', '--accent', 1),
      row('Fett', T.fat, G.fat, 'g', 'goal', '--fat'),
      row('davon gesättigte Fettsäuren', T.sat, satMax, 'g', 'max', '--fat', 0, true),
      row('Salz', T.salt, 6, 'g', 'max', '--muted', 1),
    ].join('');
    const known = MICRO.filter((m) => has[m.k] > 0), unknown = MICRO.filter((m) => !has[m.k]);
    const micro = known.map((m) => row(m.l, T[m.k], m.ref, m.u, 'ref', '--accent', m.d || 0, false,
      `${fmt((T[m.k] / m.ref) * 100)} % des Referenzwerts${has[m.k] < n ? ` · nur aus ${has[m.k]} von ${n} Einträgen` : ''}`)).join('');
    const meals = MEALS.map((m, i) => {
      const es = list.filter((e) => e.meal === i);
      if (!es.length) return '';
      const t = totals(es);
      return `<tr><td>${m}</td><td>${fmt(t.kcal)}</td><td>${fmt(t.prot)}</td><td>${fmt(t.carb)}</td><td>${fmt(t.fat)}</td></tr>`;
    }).join('');
    return `${topbar('Nährwerte')}
    <div class="pad" style="padding-top:0">
      <div style="font-size:13px;color:var(--muted);margin-top:-6px">${esc(dateLong(c.date))} · ${list.length} ${list.length === 1 ? 'Eintrag' : 'Einträge'}${supN ? ` · ${supN} ${supN === 1 ? 'Supplement' : 'Supplements'}` : ''}</div>
      ${list.length || supN ? `
      <div class="card"><div class="lbl">Energie und Makros</div>${main}
        <div class="fine" style="margin:0;text-align:left">Zucker und gesättigte Fette höchstens 10 % der Kalorien (WHO), Ballaststoffe mindestens 30 g und Salz höchstens 6 g (DGE).</div></div>
      <div class="card"><div class="lbl">Vitamine und Mineralstoffe</div>
        ${micro || `<div class="empty" style="padding:0">Für die heutigen Lebensmittel sind keine Vitamine oder Mineralstoffe hinterlegt.</div>`}
        ${unknown.length && known.length ? `<div class="fine" style="margin:0;text-align:left">Keine Angaben: ${unknown.map((m) => m.l).join(', ')}.</div>` : ''}
        ${supN ? `<div class="fine" style="margin:0;text-align:left">Abgehakte Supplements sind mitgezählt.</div>` : ''}
        <div class="fine" style="margin:0;text-align:left">Vitamine und Mineralstoffe stehen nur bei einem Teil der Produkte in Open Food Facts. Bei eigenen Lebensmitteln kannst du sie selbst eintragen. Referenzwert ist der EU-Nährstoffbezugswert für Erwachsene, wie er auf Packungen steht.</div></div>
      <div class="card"><div class="lbl">Nach Mahlzeiten</div>
        <table class="nt meals"><thead><tr><th></th><th>kcal</th><th>Eiweiß</th><th>Kohlenh.</th><th>Fett</th></tr></thead><tbody>${meals}
        <tr class="sum"><td>Gesamt</td><td>${fmt(T.kcal)}</td><td>${fmt(T.prot)}</td><td>${fmt(T.carb)}</td><td>${fmt(T.fat)}</td></tr></tbody></table></div>`
      : `<div class="card"><div class="empty" style="padding:0">An diesem Tag ist noch nichts eingetragen.</div></div>`}
    </div>`;
  },
};

/* Hinzufügen & Suche */
function recentFoods() {
  const seen = new Map();
  const days = [...S.days.keys()].sort().reverse();
  for (const d of days) for (const e of [...S.days.get(d)].reverse()) if (e.src !== 'Schnell' && !seen.has(e.foodId)) seen.set(e.foodId, e);
  return [...seen.values()].map((e) => getFood(e.foodId) || entryAsFood(e)).slice(0, 30);
}
function entryAsFood(e) { return { id: e.foodId, src: e.src, name: e.name, brand: e.brand, img: e.img, n: e.n, portions: e.portions || [] }; }

// Tippfehler-tolerant: ein Buchstabe falsch, zu viel oder zu wenig ist okay (ab 4 Buchstaben)
function near(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}
function wordHit(w, hay, hayWords) {
  if (hay.includes(w)) return 2;
  if (w.length >= 4 && hayWords.some((h) => near(w, h) || near(w, h.slice(0, w.length)))) return 1;
  return 0;
}
function localSearch(q) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  const pool = [...S.foods.values(), ...BASIS, ...DISH_FOODS.values()];
  const scored = [];
  for (const f of pool) {
    const hay = norm(f.name + ' ' + (f.brand || ''));
    const hayWords = hay.split(/[^a-z0-9]+/).filter(Boolean);
    const hits = words.map((w) => wordHit(w, hay, hayWords));
    if (hits.some((h) => h === 0)) continue;
    let s = hits.every((h) => h === 2) ? 2 : 0;
    if (norm(f.name).startsWith(words[0])) s += 3;
    if (f.src === 'Eigen' || f.src === 'Rezept' || f.src === 'Foto') s += 4;
    if (S.favs.has(f.id)) s += 5;
    if (f.src === 'OFF') s += 1;
    scored.push([s, f]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name, 'de')).slice(0, 40).map((x) => x[1]);
}

function searchResults() {
  const q = S.q.trim();
  if (!q) {
    let list = [], extra = '';
    if (S.addTab === 'Zuletzt') list = recentFoods();
    if (S.addTab === 'Favoriten') list = [...S.favs].map(getFood).filter(Boolean);
    if (S.addTab === 'Eigene') { list = [...S.foods.values()].filter((f) => f.src === 'Eigen' || f.src === 'Foto').sort((a, b) => a.name.localeCompare(b.name, 'de')); extra = `<button class="btn sec" data-act="newfood">${ic('plus')} Eigenes Lebensmittel anlegen</button>`; }
    if (S.addTab === 'Mahlzeiten') {
      return S.combos.length ? `<div class="list">${S.combos.map((m) => swipeRow('combo', m.id, comboItem(m))).join('')}</div>` : `<div class="empty" style="padding:4px 2px">Noch keine gespeicherten Mahlzeiten. Wähl ein Lebensmittel und tippe auf „Hinzufügen“. So stellst du z. B. Pommes mit Mayo und Ketchup zusammen und kannst sie dir mit Namen merken.</div>`;
    }
    if (S.addTab === 'Rezepte') { list = [...S.foods.values()].filter((f) => f.src === 'Rezept').sort((a, b) => a.name.localeCompare(b.name, 'de')); extra = `<button class="btn sec" data-act="newrecipe">${ic('pot')} Neues Rezept</button>`; }
    const empty = { Zuletzt: 'Hier erscheint, was du zuletzt gegessen hast. Such oben nach einem Lebensmittel oder scanne einen Barcode.', Favoriten: 'Noch keine Favoriten. Tippe in einem Produkt auf den Stern.', Eigene: 'Noch keine eigenen Lebensmittel.', Rezepte: 'Noch keine Rezepte.' }[S.addTab];
    const own = S.addTab === 'Eigene' || S.addTab === 'Rezepte';
    return `${list.length ? `<div class="list">${list.map((f) => (own ? swipeRow('food', f.id, resultItem(f)) : resultItem(f))).join('')}</div>` : `<div class="empty" style="padding:4px 2px">${empty}</div>`}${extra}`;
  }
  const quick = /^\d{1,4}$/.test(q) && !S.pickFor ? `<button class="btn sec" data-act="quick" data-k="${q}">${ic('plus')} ${q} kcal als Schnell-Eintrag zu ${MEALS[S.addMeal]}</button>` : '';
  if (quick) return quick + `<div class="empty" style="padding:0">Für Kalorien ohne Lebensmittel, z. B. im Restaurant.</div>`;
  const special = S.pickFor ? '' : specialResults(q);
  const local = localSearch(q);
  const localIds = new Set(local.map((f) => f.id));
  let html = special + `<div class="sec-h"><span class="lbl">Auf dem Gerät</span><span class="lbl num">${local.length}</span></div>`;
  html += local.length ? `<div class="list">${local.map(resultItem).join('')}</div>` : `<div class="empty" style="padding:0">Keine gespeicherten Treffer.</div>`;
  html += `<div class="sec-h"><span class="lbl">Open Food Facts</span>${S.online.status === 'done' && S.online.q === q ? `<span class="lbl num">${S.online.list.length}</span>` : ''}</div>`;
  if (!isOnline()) html += `<div class="notice">${ic('cloud')}<span><b>Kein Internet.</b> Du siehst nur Treffer, die auf dem Handy gespeichert sind. Die Online-Suche läuft wieder, sobald du verbunden bist.</span></div>`;
  else if (q.length < 3) html += `<div class="empty" style="padding:0">Ab 3 Buchstaben wird auch online gesucht.</div>`;
  else if (S.online.q !== q || S.online.status === 'loading') html += `<div class="empty" style="padding:0;display:flex;gap:10px;align-items:center"><span class="spin" style="width:18px;height:18px;border-width:3px"></span> Suche online …</div>`;
  else if (S.online.status === 'error') html += `<div class="notice">${ic('warn')}<span>${esc(S.online.msg)} <button class="linkbtn" data-act="retrySearch">Nochmal</button></span></div>`;
  else {
    const on = S.online.list.filter((f) => !localIds.has(f.id));
    html += on.length ? `<div class="list">${on.map(resultItem).join('')}</div>` : `<div class="empty" style="padding:0">Online nichts gefunden.</div>`;
  }
  html += `<button class="btn sec" data-act="newfood">${ic('plus')} „${esc(q)}“ selbst anlegen</button>`;
  return html;
}

let searchT, searchSeq = 0, lastSearchAt = 0;
function scheduleOnline(immediate) {
  clearTimeout(searchT);
  const q = S.q.trim();
  if (q.length < 3 || !isOnline()) return;
  if (S.online.q === q && S.online.status !== 'error') return;
  // Open Food Facts erlaubt nur etwa 10 Suchen pro Minute: nach Tipp-Pause und höchstens alle 6 s
  const wait = Math.max(immediate ? 0 : 800, lastSearchAt + 6000 - Date.now());
  searchT = setTimeout(async () => {
    lastSearchAt = Date.now();
    const my = ++searchSeq;
    S.online = { q, status: 'loading', list: [], msg: '' };
    refreshResults();
    try {
      const list = await OFF.search(q);
      if (my !== searchSeq) return;
      list.forEach((f) => { if (!S.foods.has(f.id)) S.tmp.set(f.id, f); });
      S.online = { q, status: 'done', list: list.map((f) => S.foods.get(f.id) || f), msg: '' };
    } catch (e) {
      if (my !== searchSeq) return;
      S.online = { q, status: 'error', list: [], msg: e.message || 'Online-Suche fehlgeschlagen.' };
    }
    refreshResults();
  }, wait);
}
function refreshResults() { const r = $('#results'); if (r && cur().v === 'add') r.innerHTML = searchResults(); }

/* Mahlzeit aus mehreren Teilen */
const basketItem = (f, g) => ({ foodId: f.id, name: f.name, brand: f.brand || '', src: f.src, img: f.img || '', g, n: { ...f.n }, portions: f.portions || [] });
function backToAdd() { if (S.stack.some((x) => x.v === 'add')) popTo('add'); else root('add'); }
// Mahlzeit mit Name speichern bzw. die gespeicherte aktualisieren
async function storeCombo(b, name) {
  const m = { id: b.comboId || uid(), name, items: structuredClone(b.items) };
  S.combos = [m, ...S.combos.filter((x) => x.id !== m.id)];
  b.comboId = m.id; b.name = name;
  await setSetting('combos', S.combos);
}
function basketTotals() { return totals(S.basket.items); }
function basketCard() {
  const b = S.basket, t = basketTotals();
  return `<div class="card basket" id="basket">
    <div class="sec-h"><span class="lbl">${b.name ? esc(b.name) : 'Deine Mahlzeit'}</span><button class="linkbtn" data-act="basketDrop">Verwerfen</button></div>
    <div>${b.items.map((i, ix) => `<div class="ing">${thumb(i)}<div style="min-width:0"><div class="n">${esc(i.name)}</div><div class="s num" id="bk${ix}">${fmt(nutOf(i.n, i.g).kcal)} kcal</div></div><span class="in" style="display:flex;align-items:center;gap:4px"><input data-bg="${ix}" inputmode="decimal" value="${inVal(i.g)}" aria-label="Menge ${esc(i.name)} in Gramm"><span class="u" style="font-size:12px;color:var(--muted)">g</span></span><button class="x" data-act="basketRm" data-ix="${ix}" aria-label="Entfernen">${ic('close')}</button></div>`).join('')}</div>
    <div class="calc"><div class="k"><b id="bt-kcal">${fmt(t.kcal)}</b><span>kcal</span></div><div><b id="bt-prot">${fmt(t.prot, 1)}</b><span>Eiweiß</span></div><div><b id="bt-carb">${fmt(t.carb, 1)}</b><span>Kohlenh.</span></div><div><b id="bt-fat">${fmt(t.fat, 1)}</b><span>Fett</span></div></div>
    <div style="font-size:13px;color:var(--muted)">Noch etwas dazu? Einfach unten suchen oder scannen.</div>
    <div class="field"><label for="b-name">Name (optional)</label><input id="b-name" value="${esc(b.name || '')}" placeholder="z. B. Pommes mit Mayo und Ketchup"></div>
    <div style="font-size:12.5px;color:var(--muted);margin-top:-4px">Mit Name wird die Mahlzeit gespeichert und steht unter „Mahlzeiten“ zum schnellen Eintragen bereit. Ohne Name wird sie nur eingetragen.</div>
    <button class="btn" data-act="basketSave">${ic('check')} Zu ${MEALS[S.addMeal]} hinzufügen</button>
    <button class="btn ghost" data-act="comboSave">${b.comboId ? 'Nur Änderungen speichern' : 'Nur speichern, nicht eintragen'}</button>
    ${b.comboId ? `<button class="btn ghost danger-t" data-act="comboDel">${ic('trash')} Gespeicherte Mahlzeit löschen</button>` : ''}
  </div>`;
}
function updateBasketTotals() {
  const t = basketTotals(), set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set('#bt-kcal', fmt(t.kcal)); set('#bt-prot', fmt(t.prot, 1)); set('#bt-carb', fmt(t.carb, 1)); set('#bt-fat', fmt(t.fat, 1));
}
function comboItem(m) {
  const k = totals(m.items).kcal;
  return `<button class="item" data-act="useCombo" data-id="${esc(m.id)}">${thumb({ name: m.name })}<span class="tx"><span class="n">${esc(m.name)}</span><span class="s">${m.items.map((i) => esc(i.name)).join(', ')}</span></span><span class="kc">${fmt(k)}</span></button>`;
}

V.add = {
  // für "Zuletzt": Einträge der letzten 60 Tage laden
  async load() {
    if (S.recentLoaded) return;
    const all = await db.range('entries', 'date', addDays(today(), -60), addDays(today(), 7));
    const byDay = new Map();
    all.forEach((e) => { if (!byDay.has(e.date)) byDay.set(e.date, []); byDay.get(e.date).push(e); });
    byDay.forEach((l, d) => { if (!S.days.has(d)) S.days.set(d, l.sort((a, b) => (a.t || 0) - (b.t || 0))); });
    S.recentLoaded = true;
  },
  html() {
    const picking = !!S.pickFor;
    const wd = parseD(S.day).getDay(), plan = picking ? [] : planFor(S.day, S.addMeal);
    const planBlock = plan.length ? `<div class="card plancard"><div class="cardh"><h3>Dein Plan: ${MEALS[S.addMeal]}</h3><span class="k">${WD_LONG[wd]}</span></div>
      <div class="list">${plan.map((p) => `<button class="item" data-act="planPick" data-pid="${esc(p.pid)}">${thumb(p)}<span class="tx"><span class="n">${esc(p.name)}</span><span class="s num">${fmt(p.g)} g · ${fmt(nutOf(p.n, p.g).kcal)} kcal</span></span>${ic('fwd')}</button>`).join('')}</div>
      <button class="btn" data-act="planAll" data-meal="${S.addMeal}">${ic('check')} Alles eintragen · ${fmt(planKcal(plan))} kcal</button></div>` : '';
    const hide = plan.length && S.prefs.planOnly && !S.showSearch && !S.basket;
    const title = S.pickFor === 'recipe' ? 'Zutat wählen' : S.pickFor === 'plan' ? `Für den Plan: ${MEALS[S.planTarget.meal]} (${WD[S.planTarget.wd]})` : 'Hinzufügen';
    return `${topbar(title)}
    <div class="pad" style="padding-top:0">
      ${picking ? '' : `<div class="mealpick">zu <button class="chip on" data-act="mealmenu">${MEALS[S.addMeal]} ▾</button> · ${dayLabel(S.day)}</div>`}
      ${S.basket && !picking ? basketCard() : ''}
      ${S.basket ? '' : planBlock}
      ${hide ? `<button class="btn sec" data-act="showSearch">${ic('search')} Anderes suchen</button>` : `
      <form class="search" role="search" data-form="search">${ic('search')}<input id="q" type="search" enterkeyhint="search" placeholder="Lebensmittel, Marke oder Rezept" value="${esc(S.q)}" autocomplete="off" aria-label="Suchen"></form>
      <div class="bigbtns ${picking ? '' : 'three'}">
        <button data-act="scan"><span class="ic">${ic('scan')}</span><span>Scannen<small>Barcode</small></span></button>
        <button data-act="photo"><span class="ic">${ic('cam')}</span><span>Etikett<small>Nährwerttabelle</small></span></button>
        ${picking ? '' : `<button data-act="mealPhoto"><span class="ic">${ic('plate')}</span><span>Essen<small>Foto vom Teller</small></span></button>`}
      </div>
      <div class="chips" id="tabs" ${S.q ? 'hidden' : ''}>${['Zuletzt', 'Favoriten', 'Mahlzeiten', 'Eigene', 'Rezepte'].map((t) => `<button class="chip ${S.addTab === t ? 'on' : ''}" data-act="tab" data-t="${t}">${t}</button>`).join('')}</div>
      <div id="results" style="display:flex;flex-direction:column;gap:10px">${searchResults()}</div>`}
    </div>`;
  },
  mount() { if (S.q) scheduleOnline(); },
};

/* Scanner */
V.scanner = {
  html() {
    const c = cur();
    return `<div class="cam">
    <div class="top"><button class="iconbtn" data-act="back" aria-label="Schließen">${ic('close')}</button><h2>${c.mode === 'check' ? 'Produkt prüfen' : 'Barcode scannen'}</h2><button class="iconbtn torch" id="torch" data-act="torch" aria-label="Taschenlampe" hidden>${ic('flash')}</button></div>
    <div class="viewfinder"><video id="video" playsinline muted></video><div class="target"><span class="c c1"></span><span class="c c2"></span><span class="c c3"></span><span class="c c4"></span><div class="scanline"></div></div><div class="camerr" id="camerr" hidden></div></div>
    <div class="camhint" id="camhint">Barcode in den Rahmen halten. Die App erkennt ihn automatisch.</div>
    <div class="camfoot"><form class="manual" data-form="manual"><input id="manualCode" inputmode="numeric" pattern="[0-9]*" placeholder="Barcode eintippen" aria-label="Barcode eintippen" autocomplete="off"><button>Suchen</button></form></div>
    ${c.unknown ? unknownSheet(c) : ''}
    </div>`;
  },
  mount() { if (!cur().unknown && !cur().busy) startScanner(); },
};
function unknownSheet(c) {
  return `<div class="scrim" data-act="rescan"><div class="sheet" data-stop>
    <div class="grab"></div><h3>${c.err ? 'Keine Verbindung' : 'Produkt nicht gefunden'}</h3>
    <p>${c.err ? `Barcode <span class="code">${esc(c.code)}</span> ist nicht auf deinem Handy gespeichert und Open Food Facts ist gerade nicht erreichbar (${esc(c.err)}).` : `Barcode <span class="code">${esc(c.code)}</span> ist weder auf deinem Handy noch bei Open Food Facts bekannt. Wenn du es jetzt anlegst, erkennt die App es beim nächsten Scan sofort.`}</p>
    <button class="opt main" data-act="photo" data-bc="${esc(c.code)}"><span class="ic">${ic('cam')}</span><span><b>Nährwerttabelle fotografieren</b><small>Werte werden automatisch ausgelesen</small></span></button>
    <button class="opt alt" data-act="newfood" data-bc="${esc(c.code)}"><span class="ic">${ic('edit')}</span><span><b>Selbst eintippen</b><small>Formular für eigene Lebensmittel</small></span></button>
    ${c.err ? `<button class="btn sec" data-act="retryCode" data-bc="${esc(c.code)}">Nochmal online suchen</button>` : ''}
    <button class="btn ghost" data-act="rescan">Nochmal scannen</button>
  </div></div>`;
}
async function startScanner() {
  stopScanner();
  const video = $('#video');
  if (!video) return;
  const sc = new Scanner(video, (code) => handleBarcode(code));
  S.scanner = sc;
  try {
    await sc.start();
    if (S.scanner !== sc) { sc.stop(); return; }
    if (sc.hasTorch) $('#torch').hidden = false;
  } catch (e) {
    const box = $('#camerr');
    if (!box) return;
    box.hidden = false;
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    box.innerHTML = `<div><b>${denied ? 'Kein Kamerazugriff' : 'Kamera nicht verfügbar'}</b><br><span style="opacity:.8">${denied ? 'Bitte erlaube der App die Kamera in den Browser-Einstellungen. Du kannst den Barcode auch unten eintippen.' : esc(e.message || 'Du kannst den Barcode unten eintippen.')}</span></div>`;
  }
}
function stopScanner() { if (S.scanner) { S.scanner.stop(); S.scanner = null; } }

async function findByBarcode(code) {
  const local = await db.byIndex('foods', 'barcode', code);
  if (local.length) return local.sort((a, b) => (b.src !== 'OFF') - (a.src !== 'OFF'))[0];
  return null;
}
async function handleBarcode(code) {
  code = String(code).replace(/\D/g, '');
  const c = cur();
  if (c.v !== 'scanner') return;
  stopScanner();
  if (c.mode === 'check') return replace('checkres', { code });
  c.busy = true;
  const hint = $('#camhint');
  if (hint) hint.innerHTML = `<b>${esc(code)}</b> erkannt. Suche Produkt …`;
  let f = await findByBarcode(code);
  let err = null;
  if (!f && isOnline()) {
    try { f = await OFF.lookupBarcode(code); if (f) f = await saveFood(f); } catch (e) { err = e.message || 'Fehler'; }
  } else if (!f) err = 'kein Internet';
  if (cur() !== c) return;
  c.busy = false;
  if (f) return foodChosen(f, { replaceView: true });
  c.unknown = true; c.code = code; c.err = err;
  render(true);
}

// Ein Lebensmittel wurde gewählt (Suche, Scan, Foto, Formular)
function foodChosen(f, { replaceView } = {}) {
  if (S.pickFor === 'recipe') {
    if (!S.foods.has(f.id) && f.src === 'OFF') saveFood(f);
    S.draft.items.push({ foodId: f.id, name: f.name, g: f.portions?.[0]?.g || 100, n: { ...f.n } });
    S.pickFor = null;
    S.q = '';
    popTo('recipe');
    toast(f.name + ' als Zutat hinzugefügt');
    return;
  }
  if (S.pickFor === 'plan') return (replaceView ? replace : go)('product', { id: f.id, plan: true });
  (replaceView ? replace : go)('product', { id: f.id });
}

/* Foto der Nährwerttabelle */
V.photo = {
  html() {
    const c = cur();
    if (c.busy) return `<div class="cam"><div class="top"><span style="width:40px"></span><h2>Werte werden gelesen</h2><span style="width:40px"></span></div>
      <div class="viewfinder" style="padding:20px">${c.preview ? `<img src="${c.preview}" alt="Dein Foto" style="max-width:100%;max-height:100%;border-radius:12px;opacity:.6">` : ''}</div>
      <div class="camfoot"><div class="camhint" id="ocrMsg" style="padding-top:0">${esc(c.msg || 'Texterkennung wird vorbereitet …')}</div><div class="progress"><i id="ocrBar" style="width:${c.pct || 3}%"></i></div><div class="fine" style="color:rgba(255,255,255,.6)">Läuft auf deinem Gerät. Beim ersten Mal wird die Erkennung einmalig geladen.</div></div></div>`;
    return `<div class="cam">
    <div class="top"><button class="iconbtn" data-act="back" aria-label="Schließen">${ic('close')}</button><h2>Nährwerttabelle fotografieren</h2><span style="width:40px"></span></div>
    <div class="viewfinder"><div class="target label-target"><span class="c c1"></span><span class="c c2"></span><span class="c c3"></span><span class="c c4"></span>
      <div class="label-paper"><b>Nährwerte pro 100 g</b><div><span>Brennwert</span><span>1854 kJ / 442 kcal</span></div><div><span>Fett</span><span>17 g</span></div><div><span>– davon gesättigte Fettsäuren</span><span>1,9 g</span></div><div><span>Kohlenhydrate</span><span>58 g</span></div><div><span>– davon Zucker</span><span>3,1 g</span></div><div><span>Ballaststoffe</span><span>6,2 g</span></div><div><span>Eiweiß</span><span>11 g</span></div><div><span>Salz</span><span>1,4 g</span></div></div></div></div>
    <div class="camhint">So soll dein Foto aussehen: nur die Tabelle, gerade und scharf. Spiegelungen vermeiden.</div>
    <div class="tips" style="padding:0 16px"><span>Gutes Licht</span><span>Gerade halten</span><span>Nah genug</span></div>
    <div class="camfoot"><button class="shutter" data-act="shoot" aria-label="Foto aufnehmen"><i></i></button>
      <button class="btn ghost" data-act="gallery" style="color:var(--cam-ink)">${ic('image')} Foto aus der Galerie wählen</button></div>
  </div>`;
  },
};
async function runOcr(file) {
  const c = cur();
  if (c.v !== 'photo') return;
  c.busy = true; c.msg = 'Foto wird vorbereitet …'; c.pct = 3;
  render(true);
  try {
    const { readLabel } = await import('./ocr.js');
    const res = await readLabel(file, (m) => {
      if (cur() !== c) return;
      const pct = m.status === 'recognizing text' ? 30 + m.progress * 70 : Math.min(30, 3 + (m.progress || 0) * 27);
      c.pct = pct;
      c.msg = m.status === 'recognizing text' ? 'Text wird gelesen …' : 'Texterkennung wird geladen …';
      const bar = $('#ocrBar'); if (bar) bar.style.width = pct + '%';
      const msg = $('#ocrMsg'); if (msg) msg.textContent = c.msg;
    });
    if (cur() !== c) return;
    replace('review', { res, bc: c.bc || '' });
  } catch (e) {
    console.error(e);
    if (cur() !== c) return;
    c.busy = false;
    render(true);
    toast(isOnline() ? 'Die Texterkennung hat nicht geklappt. Bitte nochmal versuchen.' : 'Die Texterkennung muss einmal mit Internet geladen werden.', true);
  }
}

/* Essensfoto: Gericht erkennen, Portion wählen, als "geschätzt" eintragen */
V.mealcam = () => `<div class="cam">
  <div class="top"><button class="iconbtn" data-act="back" aria-label="Schließen">${ic('close')}</button><h2>Essen fotografieren</h2><span style="width:40px"></span></div>
  <div class="viewfinder"><div class="round-target"><svg class="plate-ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-plate"/></svg></div></div>
  <div class="camhint">Teller von oben fotografieren, ganz im Bild. Die App schlägt dir dann passende Gerichte vor.</div>
  <div class="tips" style="padding:0 16px"><span>Von oben</span><span>Gutes Licht</span><span>Ein Gericht pro Foto</span></div>
  <div class="camfoot"><button class="shutter" data-act="mealShoot" aria-label="Foto aufnehmen"><i></i></button>
    <button class="btn ghost" data-act="mealGallery" style="color:var(--cam-ink)">${ic('image')} Foto aus der Galerie wählen</button></div>
</div>`;
const MEAL_DISCLAIMER = `<div class="notice">${ic('warn')}<span><b>Nur eine Schätzung.</b> Die KI kann sich beim Gericht irren, und Menge, Öl, Soßen oder versteckte Zutaten sieht sie nicht. Die Werte sind Durchschnittswerte und können stark abweichen. Nicht für medizinische Zwecke nutzen, etwa zum Berechnen von Insulin oder bei Allergien. Der Eintrag wird im Tagebuch als „geschätzt“ markiert.</span></div>`;
V.mealguess = {
  html(c) {
    if (c.busy) return `${topbar('Was ist auf dem Teller?')}<div class="pad" style="padding-top:0"><div class="card" style="align-items:center;text-align:center">${c.preview ? `<img src="${c.preview}" alt="Dein Foto" style="max-width:100%;max-height:220px;border-radius:12px;opacity:.7">` : ''}<span class="spin"></span><div id="mgMsg">${esc(c.msg || 'Foto wird vorbereitet …')}</div><div class="progress" style="width:100%"><i id="mgBar" style="width:${c.pct || 3}%"></i></div><div class="fine" style="margin:0">Läuft auf deinem Gerät, das Foto wird nicht hochgeladen. Beim ersten Mal wird die Erkennung einmalig geladen (${c.big ? 'ca. 150 MB' : 'ca. 15 MB'}).</div></div></div>`;
    if (c.ask) return `${topbar('Was ist auf dem Teller?')}<div class="pad" style="padding-top:0">
      ${c.preview ? `<div class="photothumb"><img src="${c.preview}" alt="Dein Foto"></div>` : ''}
      <div class="card"><b>Welche Erkennung möchtest du?</b>
        <p style="margin:0;color:var(--muted);font-size:14px">Die <b style="color:var(--ink)">große KI</b> kennt rund 1000 Gerichte, Beilagen und Getränke, auch typische Restaurantgerichte. Sie wird einmalig geladen (ca. 150 MB, am besten im WLAN) und bleibt dann auf dem Handy.</p>
        <p style="margin:0;color:var(--muted);font-size:14px">Die <b style="color:var(--ink)">kleine KI</b> ist schnell geladen (ca. 15 MB), erkennt aber weniger.</p>
        <button class="btn" data-act="aiPick" data-v="big">Große KI laden</button>
        <button class="btn sec" data-act="aiPick" data-v="small">Kleine KI nutzen</button>
        ${MEAL_DISCLAIMER}
        <p class="fine" style="margin:0;text-align:left">Das kannst du später unter Einstellungen > App ändern. Beide laufen auf deinem Gerät, das Foto wird nicht hochgeladen.</p>
      </div></div>`;
    if (c.err) return `${topbar('Was ist auf dem Teller?')}<div class="pad" style="padding-top:0"><div class="card"><b>Das hat nicht geklappt</b><p style="margin:0;color:var(--muted)">${esc(c.err)}</p><button class="btn" data-act="mealPhoto">${ic('cam')} Nochmal versuchen</button><button class="btn sec" data-act="mealSearch">${ic('search')} Selbst suchen</button></div></div>`;
    const list = c.guess || [];
    return `${topbar('Was ist auf dem Teller?')}
    <div class="pad" style="padding-top:0">
      ${c.shots?.length > 1 ? `<div class="shots">${c.shots.map((sh, i) => `<img src="${sh.preview}" alt="Foto ${i + 1}">`).join('')}</div>` : c.preview ? `<div class="photothumb"><img src="${c.preview}" alt="Dein Foto"><span class="badge">Dein Foto</span></div>` : ''}
      ${(c.shots?.length || 0) < 3 ? `<div class="row3" style="display:flex;gap:8px"><button class="btn sec" data-act="mealMore" style="flex:1">${ic('cam')} Noch ein Foto aus anderem Winkel</button><button class="iconbtn" data-act="mealMore" data-g="1" aria-label="Weiteres Foto aus der Galerie">${ic('image')}</button></div>
      <p class="fine" style="margin:-4px 0 0;text-align:left">${c.shots?.length > 1 ? `${c.shots.length} Fotos zusammen ausgewertet. ` : ''}Mehr Winkel machen die Erkennung sicherer (bis zu 3 Fotos).</p>` : `<p class="fine" style="margin:0;text-align:left">3 Fotos zusammen ausgewertet.</p>`}
      <div class="lbl">Das könnte es sein</div>
      ${list.length ? list.map(guessBtn).join('')
        : `<div class="notice">${ic('warn')}<span><b>Kein Gericht erkannt.</b> Die Erkennung kennt vor allem bekannte Gerichte wie Pizza, Burger, Nudeln, Suppe, Obst und Gemüse. Such das Gericht einfach selbst.</span></div>`}
      ${c.extras?.length ? `<div class="lbl">Auch auf dem Teller erkannt</div>${c.extras.map(guessBtn).join('')}` : ''}
      <div class="lbl">Noch etwas dabei?</div>
      <div class="chips sidechips">${SIDE_CHIPS.filter((k) => DISH_MAP.has(k) && !list.some((g) => g.d.k === k) && !c.extras?.some((g) => g.d.k === k)).map((k) => `<button class="chip ${c.sel?.includes(k) ? 'on' : ''}" data-act="mealPick" data-k="${k}" aria-pressed="${!!c.sel?.includes(k)}">${esc(DISH_MAP.get(k).name)}</button>`).join('')}</div>
      <p class="fine" style="margin:0;text-align:left">Tippe alles an, was auf dem Teller ist. Jedes Teil bekommt danach seine eigene Portion.</p>
      <button class="btn sec" data-act="mealSearch">${ic('search')} Nichts davon? Selbst suchen</button>
      ${MEAL_DISCLAIMER}
      <p class="fine" style="text-align:left;margin:0">Die Erkennung läuft auf dem Handy (${c.big ? 'große KI' : 'kleine KI'}). Die Prozente vergleichen die Vorschläge untereinander.${c.big ? '' : ' Hausmannskost wie Rouladen oder Eintopf erkennt sie oft nicht genau.'}</p>
    </div>
    <div class="foot"><button class="btn" data-act="mealNext" ${c.sel?.length ? '' : 'disabled'}>${mealNextLabel(c)}</button></div>`;
  },
};
const SIDE_CHIPS = ['pommes', 'beilagensalat', 'reis', 'brot_scheibe', 'ketchup', 'mayo', 'cola', 'wasser'];
const mealNextLabel = (c) => (c.sel?.length > 1 ? `Weiter zur Portion (${c.sel.length} Teile)` : 'Weiter zur Portion');
function guessBtn({ d, s }) {
  const on = !!cur().sel?.includes(d.k);
  return `<button class="guess ${on ? 'on' : ''}" data-act="mealPick" data-k="${d.k}" aria-pressed="${on}"><b>${on ? ic('check') : ''}${esc(d.name)}</b><span class="p">${fmt(Math.max(1, Math.min(99, s * 100)))} %</span><span class="bar"><i style="width:${Math.max(2, Math.min(100, s * 100))}%;background:var(--accent)"></i></span></button>`;
}
// Ist Gericht x schon im Hauptgericht enthalten (oder umgekehrt)? z. B. „Pommes frites“ in „Currywurst mit Pommes“
const nameWords = (n) => n.toLowerCase().split(/[^a-zäöüß]+/).filter((w) => w.length >= 4 && !['gegart', 'gekocht'].includes(w));
const overlaps = (a, b) => nameWords(a.name).some((w) => b.name.toLowerCase().includes(w)) || nameWords(b.name).some((w) => a.name.toLowerCase().includes(w));
const SIDE_RE = /^(Pommes|Süßkartoffel-Pommes|Curly|Kartoffelecken|Zwiebelringe|Beilagensalat|Gemischter Salat|Krautsalat|Gurkensalat|Tomatensalat|Reis|Basmatireis|Baguette|Brot|Brötchen|Fladenbrot|Naan|Knoblauchbrot|Kräuterbaguette|Ketchup|Mayonnaise|Senf|Knoblauchsoße|BBQ-Soße|Kräuterquark|Tzatziki|Cola|Limonade|Wasser|Sprudelwasser|Bier|Pils|Weißbier|Rotwein|Weißwein|Saft|Apfelschorle|Eistee)/;
// Treffer aus den Bildausschnitten -> zusätzliche Teile auf dem Teller. Ein Teil zählt nur, wenn es in seinem
// Ausschnitt sicherer erkannt wird als das Hauptgericht (z. B. die Pommes-Hälfte neben dem Burger).
function mealExtras(guess, crops) {
  const main = guess[0]?.d, out = [], hits = new Map();
  for (const crop of crops || []) {
    const mainS = main ? crop.find((x) => x.d.k === main.k)?.s || 0 : 0;
    const h = crop.find((x) => !main || (x.d.k !== main.k && !overlaps(x.d, main)));
    const ok = h && (h.s > mainS || (SIDE_RE.test(h.d.name) && h.s >= 0.25)); // Beilagen und Getränke dürfen etwas unsicherer sein
    if (ok && (!hits.has(h.d.k) || hits.get(h.d.k).s < h.s)) hits.set(h.d.k, h);
  }
  for (const h of [...hits.values()].sort((a, b) => b.s - a.s)) {
    if (h.s < 0.15 || out.length >= 3) continue;
    if (main && (h.d.k === main.k || overlaps(h.d, main))) continue;
    if (out.some((o) => o.d.k === h.d.k || overlaps(o.d, h.d))) continue;
    out.push(h);
  }
  return out;
}
const plateSvg = (r) => `<svg viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="26" fill="var(--surface2)" stroke="var(--line)" stroke-width="2"/><circle cx="28" cy="28" r="${r}" fill="#D9B45E"/><circle cx="28" cy="28" r="${r * 0.5}" fill="#B5482B"/></svg>`;
V.mealportion = {
  html(c) {
    const d = DISH_MAP.get(c.k);
    if (!d) return `${topbar('Portion')}<div class="pad"><p>Gericht nicht gefunden.</p></div>`;
    const g = c.g ?? d.p[1]; c.g = g;
    if (c.safe == null) c.safe = !!S.prefs.safety;
    const n = nutOf(d.n, mealG(c));
    return `${topbar(c.total > 1 ? `Wie viel war es? (${c.idx} von ${c.total})` : 'Wie viel war es?')}
    <div class="pad" style="padding-top:0">
      <div class="hero"><span class="thumb" style="background:var(--warn-soft);color:var(--warn)">${ic('plate')}</span><div style="min-width:0"><h3>${esc(d.name)}</h3><div class="s">zu ${MEALS[S.addMeal]} · ${dayLabel(S.day)} <span class="est" style="margin:0">geschätzt</span></div></div></div>
      <div class="card"><div class="lbl">Portion</div>
        <div class="plates">${['klein', 'mittel', 'groß'].map((l, i) => `<button data-act="mealSize" data-g="${d.p[i]}" class="${g === d.p[i] ? 'on' : ''}">${plateSvg(9 + i * 5)}${l}<small>${fmt(d.p[i])} g</small></button>`).join('')}</div>
        <label for="mp-g" style="font-size:13px;color:var(--muted)">Feiner einstellen: <b id="mp-gv" style="color:var(--ink)">${fmt(g)} g</b></label>
        <input type="range" id="mp-g" min="${Math.round(d.p[0] * 0.5 / 10) * 10}" max="${Math.round(d.p[2] * 1.5 / 10) * 10}" step="${d.p[2] > 300 ? 10 : 5}" value="${g}">
        <div class="calc"><div class="k"><b id="mp-kcal">${fmt(n.kcal)}</b><span>kcal</span></div><div><b id="mp-prot">${fmt(n.prot, 1)}</b><span>Eiweiß</span></div><div><b id="mp-carb">${fmt(n.carb, 1)}</b><span>Kohlenh.</span></div><div><b id="mp-fat">${fmt(n.fat, 1)}</b><span>Fett</span></div></div>
        <label class="togglerow"><span>+10 % Sicherheit<small id="mp-safe">${c.safe ? `Trägt ${fmt(mealG(c))} g statt ${fmt(g)} g ein` : 'Lieber etwas mehr zählen als zu wenig'}</small></span><input type="checkbox" class="tg" id="mp-sf" ${c.safe ? 'checked' : ''}></label>
        <div style="font-size:13px;color:var(--muted)" id="mp-range">Ungefähr ${fmt(n.kcal * 0.8)} bis ${fmt(n.kcal * 1.25)} kcal</div>
      </div>
      ${MEAL_DISCLAIMER}
    </div>
    <div class="foot"><button class="btn" data-act="mealSave">${ic('check')} ${c.queue?.length ? 'Eintragen und weiter' : 'Als Schätzung eintragen'}</button></div>`;
  },
};
const mealG = (c) => (c.safe ? Math.round(c.g * 1.1) : c.g);
function updateMealPortion() {
  const c = cur(), d = DISH_MAP.get(c.k), n = nutOf(d.n, mealG(c)), set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set('#mp-kcal', fmt(n.kcal)); set('#mp-prot', fmt(n.prot, 1)); set('#mp-carb', fmt(n.carb, 1)); set('#mp-fat', fmt(n.fat, 1)); set('#mp-gv', fmt(c.g) + ' g');
  set('#mp-safe', c.safe ? `Trägt ${fmt(mealG(c))} g statt ${fmt(c.g)} g ein` : 'Lieber etwas mehr zählen als zu wenig');
  set('#mp-range', `Ungefähr ${fmt(n.kcal * 0.8)} bis ${fmt(n.kcal * 1.25)} kcal`);
  $$('.plates button').forEach((b) => b.classList.toggle('on', +b.dataset.g === c.g));
}
async function runMealCam(file) {
  const c = cur();
  if (c.v !== 'mealcam' && c.v !== 'mealguess') return;
  const adding = c.v === 'mealguess' && S.mealAdd && c.shots?.length;
  S.mealAdd = false;
  if (!adding) replace('mealguess', { busy: true, msg: 'Foto wird vorbereitet …', pct: 3, shots: [] });
  const me = cur();
  if (adding) { me.busy = true; me.msg = 'Foto wird vorbereitet …'; me.pct = 3; render(true); }
  try {
    const cam = await import('./foodcam.js');
    const shot = await cam.prepare(file);
    if (cur() !== me) return;
    me.shots.push({ file, canvas: shot.canvas, preview: shot.preview, regions: shot.regions });
    me.preview = me.shots[0].preview;
    if (!S.prefs.ai) { me.busy = false; me.ask = true; render(true); return; }
    await recognizeMeal(me);
  } catch (e) { mealFail(me, e); }
}
function mealFail(me, e) {
  console.error(e);
  if (cur() !== me) return;
  me.busy = false; me.err = isOnline() ? (e.message || 'Die Bilderkennung hat nicht geklappt.') : 'Die Bilderkennung muss einmal mit Internet geladen werden. Danach geht sie auch offline.';
  render(true);
}
// Mehrere Fotos (bis 3, verschiedene Winkel): Wahrscheinlichkeiten werden gemittelt
async function recognizeMeal(me) {
  const step = (msg, pct) => { me.msg = msg; me.pct = pct; const m = $('#mgMsg'), b = $('#mgBar'); if (m) m.textContent = msg; if (b) b.style.width = pct + '%'; };
  const cam = await import('./foodcam.js');
  const big = S.prefs.ai === 'big';
  if (me.big !== big || !me.acc) { me.big = big; me.acc = null; me.done = 0; me.crops = []; }
  me.busy = true; me.ask = false; me.err = null; render(true);
  const prog = (f) => { if (cur() === me) step(`Bilderkennung wird geladen … ${Math.round(f * 100)} %`, 8 + f * 80); };
  const add = (probs) => { me.acc = me.acc ? me.acc.map((x, i) => x + probs[i]) : Array.from(probs); me.done++; };
  try {
    step('Bilderkennung wird geladen …', 8);
    while (me.done < me.shots.length) {
      const sh = me.shots[me.done];
      if (me.big) {
        try { add(await cam.classifyClip(sh.file, CLIP_TEXTS, prog)); }
        catch (e) {
          console.error(e);
          if (cur() !== me) return;
          toast('Die große KI ließ sich nicht laden. Ich nehme die kleine.', true);
          me.big = false; me.acc = null; me.done = 0; me.crops = []; render(true);
          continue;
        }
      } else add(await cam.classify(sh.canvas, prog));
      if (cur() !== me) return;
      // Bildausschnitte: Beilagen und weitere Teile finden
      for (const [ri, r] of (sh.regions || []).entries()) {
        step(`Teller wird abgesucht … ${ri + 1} von ${sh.regions.length}`, 90 + ri);
        try {
          const probs = me.big ? await cam.classifyClip(r.big, CLIP_TEXTS) : await cam.classify(r.sq);
          me.crops.push(me.big ? rankClip(probs, 5) : rankDishes(probs, 5));
        } catch (e) { console.error(e); break; } // Ausschnitte sind ein Extra: ohne sie geht es trotzdem weiter
        if (cur() !== me) return;
      }
      if (me.shots.length > 1) step(`Foto ${me.done} von ${me.shots.length} erkannt …`, 90);
    }
    step('Gericht wird erkannt …', 95);
    const avg = me.acc.map((x) => x / me.done);
    me.guess = me.big ? rankClip(avg, 3) : rankDishes(avg, 3);
    me.extras = mealExtras(me.guess, me.crops);
    me.guess = me.guess.filter((g, i) => !i || !me.extras.some((x) => x.d.k === g.d.k)); // nicht doppelt anzeigen
    const keep = (me.sel || []).filter((k) => SIDE_CHIPS.includes(k)); // selbst angetippte Beilagen bleiben
    me.sel = [...new Set([...(me.guess[0] ? [me.guess[0].d.k] : []), ...me.extras.filter((x) => x.s >= 0.3).map((x) => x.d.k), ...keep])];
    me.busy = false;
    render(true);
  } catch (e) { mealFail(me, e); }
}

/* Werte prüfen nach dem Foto */
V.review = {
  html() {
    const c = cur(), r = c.res, v = r.values, uns = r.unsure;
    const nUnsure = Object.keys(uns).length;
    return `${topbar('Werte prüfen', `<button class="btn ghost" data-act="photoAgain">Neues Foto</button>`)}
    <div class="pad" style="padding-top:0">
      ${r.preview ? `<div class="photo"><img src="${r.preview}" alt="Dein Foto der Nährwerttabelle"><span class="badge">Dein Foto</span></div>` : ''}
      ${nUnsure ? `<div class="notice">${ic('warn')}<span><b>${nUnsure} ${nUnsure === 1 ? 'Wert' : 'Werte'} unsicher.</b> Gelb markierte Felder bitte mit dem Foto vergleichen.</span></div>` : `<div class="ok">${ic('check')}<span>Alle Werte erkannt. Bitte trotzdem kurz mit dem Foto vergleichen.</span></div>`}
      <div class="card">
        <div class="field"><label for="pname">Name</label><input id="pname" value="${esc(c.name || '')}" placeholder="z. B. Dinkel-Cracker Rosmarin"></div>
        <div class="row2"><div class="field"><label for="pbrand">Marke (optional)</label><input id="pbrand" value="${esc(c.brand || '')}"></div><div class="field"><label for="pbc">Barcode</label><input id="pbc" inputmode="numeric" value="${esc(c.bc || '')}" placeholder="optional"></div></div>
      </div>
      <div class="card"><div class="lbl">Erkannt, pro 100 g</div>
        ${FIELDS.map((o) => `<div class="nrow ${o.sub ? 'sub' : ''} ${uns[o.k] ? 'unsure' : ''}" data-row="${o.k}"><label for="o-${o.k}">${o.l}</label><span class="in"><input id="o-${o.k}" data-n="${o.k}" inputmode="decimal" value="${inVal(v[o.k], 3)}" placeholder="0"><span class="u">${o.u}</span></span>${uns[o.k] ? `<span class="flag">${esc(uns[o.k])}</span>` : ''}</div>`).join('')}
      </div>
      <div id="plaus"></div>
      <div class="card"><div class="lbl">Portionsgröße (optional)</div><div class="row2"><div class="field"><label for="pp">Bezeichnung</label><input id="pp" placeholder="z. B. 5 Cracker"></div><div class="field"><label for="ppg">Gramm</label><input id="ppg" inputmode="decimal" placeholder="z. B. 25"></div></div></div>
      <details class="raw"><summary>Erkannten Text anzeigen</summary><pre>${esc(r.text || '')}</pre></details>
    </div>
    <div class="foot"><button class="btn" data-act="saveOcr">${ic('check')} ${S.pickFor === 'recipe' ? 'Speichern und als Zutat nehmen' : 'Speichern und eintragen'}</button></div>`;
  },
  mount() { updatePlaus(); },
};
function readNutrients(prefix) {
  const n = {};
  for (const k of NKEYS) { const el = $(`#${prefix}${k}`); if (el) n[k] = num(el.value); }
  return n;
}
function updatePlaus() {
  const box = $('#plaus');
  if (!box) return;
  const n = readNutrients('o-');
  const p = plausibility(n);
  box.innerHTML = `<div class="${p.ok ? 'ok' : 'notice'}">${ic(p.ok ? 'check' : 'warn')}<span><b>${p.ok ? 'Plausibel:' : 'Bitte prüfen:'}</b> ${esc(p.message)}</span></div>`;
}

/* Produkt & Menge */
V.product = {
  html() {
    const c = cur();
    const e = c.entry ? (S.days.get(c.date) || []).find((x) => x.id === c.entry) : null;
    const f = e ? { ...(getFood(e.foodId) || {}), ...entryAsFood(e) } : getFood(c.id);
    if (!f) return `${topbar('Nicht gefunden')}<div class="pad"><p>Dieses Lebensmittel gibt es nicht mehr.</p></div>`;
    const portions = f.portions || [];
    const g = c.g ?? (e ? e.g : portions[0]?.g || 100);
    c.g = g;
    const meal = c.meal ?? (e ? e.meal : S.addMeal);
    const n = nutOf(f.n, g), N = f.n;
    const rows = [['Brennwert', 'kcal', N.kcal, 'kcal'], ['Fett', 'fat', N.fat, 'g'], ['davon gesättigte Fettsäuren', 'sat', N.sat, 'g', 1], ['Kohlenhydrate', 'carb', N.carb, 'g'], ['davon Zucker', 'sugar', N.sugar, 'g', 1], ['Ballaststoffe', 'fiber', N.fiber, 'g'], ['Eiweiß', 'prot', N.prot, 'g'], ['Salz', 'salt', N.salt, 'g']]
      .map((r) => [...r.slice(0, 4), r[4] || 0, r[3] === 'kcal' ? 0 : 1])
      .concat(MICRO.filter((m) => N[m.k] != null).map((m) => [m.l, m.k, N[m.k], m.u, 0, m.d ?? 0]));
    const quickE = f.src === 'Schnell';
    const own = !e && ['Eigen', 'Foto', 'Rezept'].includes(f.src) && S.foods.has(f.id);
    const fav = S.favs.has(f.id);
    const right = `${own ? `<button class="iconbtn" data-act="editFood" data-id="${esc(f.id)}" aria-label="Bearbeiten">${ic('edit')}</button>` : ''}${!e ? `<button class="iconbtn star ${fav ? 'on' : ''}" data-act="fav" data-id="${esc(f.id)}" aria-label="${fav ? 'Aus Favoriten entfernen' : 'Zu Favoriten'}" aria-pressed="${fav}">${ic('star')}</button>` : ''}`;
    return `${topbar(e ? 'Eintrag bearbeiten' : 'Menge wählen', right)}
    <div class="pad" style="padding-top:0">
      <div class="hero">${thumb(f)}<div style="min-width:0"><h3>${esc(f.name)} ${quickE ? '' : nsBadge(nutriOf(f)?.g)}</h3><div class="s">${f.brand ? esc(f.brand) + ' ·' : ''} ${srcBadge(f)}${e?.est ? '<span class="est" style="margin:0">geschätzt</span>' : ''}${f.barcode ? ` <span class="num">EAN ${esc(f.barcode)}</span>` : ''}</div></div></div>
      <div class="card">
        <div class="lbl">${quickE ? 'Kalorien' : 'Menge in Gramm'}</div>
        <div class="amount"><input id="amt" inputmode="decimal" value="${inVal(g)}" aria-label="${quickE ? 'Kalorien' : 'Menge in Gramm'}"><div class="unit" ${quickE ? 'hidden' : ''}><button class="chip ${portions.every((p) => p.g !== g) && g === 100 ? 'on' : ''}" data-act="unit" data-g="100">100 g</button>${portions.map((p) => `<button class="chip ${p.g === g ? 'on' : ''}" data-act="unit" data-g="${p.g}">${esc(p.l)} · ${fmt(p.g)} g</button>`).join('')}</div></div>
        <div class="calc"><div class="k"><b id="c-kcal">${fmt(n.kcal)}</b><span>kcal</span></div><div><b id="c-prot">${fmt(n.prot, 1)}</b><span>Eiweiß</span></div><div><b id="c-carb">${fmt(n.carb, 1)}</b><span>Kohlenh.</span></div><div><b id="c-fat">${fmt(n.fat, 1)}</b><span>Fett</span></div></div>
        <div class="lbl" style="margin-top:4px">Mahlzeit</div>
        <div class="chips">${MEALS.map((m, i) => `<button class="chip ${i === meal ? 'on' : ''}" data-act="meal" data-m="${i}">${m}</button>`).join('')}</div>
        ${e ? '' : `<div style="font-size:13px;color:var(--muted)">am ${dayLabel(S.day) === 'Heute' ? 'heutigen Tag' : esc(dateLong(S.day))}</div>`}
      </div>
      <div class="card" ${quickE ? 'hidden' : ''}><table class="nt"><thead><tr><th>Nährwerte</th><th>pro 100 g</th><th>pro <span id="t-g">${fmt(g)}</span> g</th></tr></thead><tbody>
        ${rows.map((r) => `<tr class="${r[4] ? 'sub' : ''}"><td>${r[0]}</td><td>${fmt(r[2], r[5])} ${r[3]}</td><td data-per="${r[2]}" data-d="${r[5]}" data-u="${r[3]}">${fmt((r[2] * g) / 100, r[5])} ${r[3]}</td></tr>`).join('')}
      </tbody></table>
      <div style="font-size:12px;color:var(--muted)">Quelle: ${SRC[f.src]?.[0] || 'Eigenes'}${f.src === 'OFF' ? ' (ODbL, von Freiwilligen gepflegt). Werte bitte mit der Packung vergleichen.' : f.src === 'BLS' ? ' (gerundete Richtwerte).' : ''}</div></div>
      ${quickE ? '' : nutriCard(f)}
      ${f.src === 'Rezept' && f.recipe?.steps?.length ? `<button class="btn sec" data-act="openCook" data-id="${esc(f.id)}">${ic('timer')} Zubereitung ansehen (${f.recipe.steps.length} ${f.recipe.steps.length === 1 ? 'Schritt' : 'Schritte'})</button>` : ''}
      ${e ? `<div class="row2"><button class="btn sec" data-act="copyEntry">${ic('copy')} Kopieren</button><button class="btn danger" data-act="del">${ic('trash')} Löschen</button></div>` : ''}
    </div>
    <div class="foot">${c.plan ? `<button class="btn" data-act="planSave">${ic('cal')} Zum Plan hinzufügen</button>`
      : e ? `<button class="btn" data-act="saveEntry">Änderungen speichern</button>`
      : S.basket ? `<button class="btn" data-act="saveEntry">${ic('plus')} Zur Mahlzeit hinzufügen</button>`
      : quickE ? `<button class="btn" data-act="saveEntry">Zu ${MEALS[meal]} hinzufügen</button>`
      : `<button class="btn" data-act="addMore">${ic('plus')} Hinzufügen</button><button class="btn ghost" data-act="saveEntry">Direkt zu ${MEALS[meal]} eintragen</button>`}</div>`;
  },
};
function nutriCard(f) {
  const r = nutriOf(f);
  if (!r) return '';
  return `<div class="card"><div class="sec-h"><span class="lbl">Nutri-Score</span>${r.g ? `<span style="font-size:13px;font-weight:700">${r.g.toUpperCase()}</span>` : ''}</div>
    <div class="ns ${r.g ? '' : 'grey'}" role="img" aria-label="${r.g ? 'Nutri-Score ' + r.g.toUpperCase() : 'Nutri-Score unbekannt'}">${NS.map((x) => `<span class="${x} ${x === r.g ? 'on' : ''}">${x.toUpperCase()}</span>`).join('')}</div>
    <div style="font-size:12.5px;color:var(--muted)">${!r.g ? 'Nicht genug Daten für den Nutri-Score.' : r.calc ? 'Aus den Nährwerten berechnet (ohne Obst- und Gemüseanteil), daher nur ein Richtwert.' : 'Laut Open Food Facts. A ist am günstigsten, E am ungünstigsten.'}</div></div>`;
}
function readAmt() { const i = $('#amt'); const v = num(i ? i.value : cur().g); return isNaN(v) ? 0 : v; }

/* Eigenes Lebensmittel */
V.food = {
  html() {
    const c = cur();
    const f = c.id ? S.foods.get(c.id) : null;
    const per = c.per || 'g100';
    const N = f?.n || {};
    const pg = f?.portions?.[0]?.g || 0;
    const shown = (k) => (f ? (per === 'portion' && pg ? (N[k] * pg) / 100 : N[k]) : NaN);
    const portions = c.portions || f?.portions?.map((p) => ({ ...p })) || [{ l: '1 Portion', g: '' }];
    c.portions = portions;
    const rows = [['Brennwert', 'kcal', 'kcal'], ['Fett', 'fat', 'g'], ['davon gesättigte Fettsäuren', 'sat', 'g', 1], ['Kohlenhydrate', 'carb', 'g'], ['davon Zucker', 'sugar', 'g', 1], ['Ballaststoffe', 'fiber', 'g'], ['Eiweiß', 'prot', 'g'], ['Salz', 'salt', 'g']];
    return `${topbar(f ? 'Lebensmittel bearbeiten' : 'Eigenes Lebensmittel')}
    <div class="pad" style="padding-top:0">
      <div class="card">
        <div class="field"><label for="fn">Name</label><input id="fn" value="${esc(c.name ?? f?.name ?? '')}" placeholder="z. B. Bauernbrot vom Markt"></div>
        <div class="row2"><div class="field"><label for="fb">Marke (optional)</label><input id="fb" value="${esc(f?.brand || '')}" placeholder="optional"></div>
        <div class="field"><label for="fbc">Barcode (optional)</label><input id="fbc" inputmode="numeric" value="${esc(c.bc || f?.barcode || '')}" placeholder="optional"></div></div>
      </div>
      <div class="card">
        <div class="seg" role="tablist"><button data-act="per" data-v="g100" class="${per === 'g100' ? 'on' : ''}">pro 100 g</button><button data-act="per" data-v="portion" class="${per === 'portion' ? 'on' : ''}">pro Portion</button></div>
        ${per === 'portion' ? `<div style="font-size:13px;color:var(--muted)">Werte für die erste Portion unten eintragen. Die App rechnet auf 100 g um.</div>` : ''}
        ${rows.map((r) => `<div class="nrow ${r[3] ? 'sub' : ''}"><label for="fv-${r[1]}">${r[0]}</label><span class="in"><input id="fv-${r[1]}" inputmode="decimal" placeholder="0" value="${inVal(shown(r[1]), 2)}"><span class="u">${r[2]}</span></span></div>`).join('')}
        <details class="micro" ${c.microOpen || MKEYS.some((k) => N[k] != null) ? 'open' : ''}><summary>Vitamine und Mineralstoffe (optional)</summary>
        ${MICRO.map((m) => `<div class="nrow"><label for="fv-${m.k}">${m.l}</label><span class="in"><input id="fv-${m.k}" inputmode="decimal" placeholder="–" value="${N[m.k] != null ? inVal(shown(m.k), 3) : ''}"><span class="u">${m.u}</span></span></div>`).join('')}
        <div class="fine" style="margin:0">Nur eintragen, was auf der Packung steht. Leere Felder zählen als „keine Angabe“.</div></details>
      </div>
      <div class="card"><div class="lbl">Portionsgrößen</div>
        ${portions.map((p, i) => `<div class="prow"><div class="field"><label for="fp${i}">Bezeichnung</label><input id="fp${i}" data-pl="${i}" value="${esc(p.l)}"></div><div class="field"><label for="fpg${i}">Gramm</label><input id="fpg${i}" data-pg="${i}" inputmode="decimal" value="${inVal(num(p.g))}"></div><button class="x" data-act="rmPortion" data-i="${i}" aria-label="Portion entfernen">${ic('close')}</button></div>`).join('')}
        <button class="btn ghost" data-act="addPortion" style="align-self:flex-start">${ic('plus')} Weitere Portion</button>
      </div>
      ${f ? `<button class="btn danger" data-act="delFood">${ic('trash')} Lebensmittel löschen</button><p class="fine">Bereits eingetragene Tage bleiben unverändert.</p>` : ''}
    </div>
    <div class="foot"><button class="btn" data-act="saveFood">Speichern</button></div>`;
  },
};
function syncPortions() {
  const c = cur();
  $$('[data-pl]').forEach((el) => { c.portions[+el.dataset.pl].l = el.value; });
  $$('[data-pg]').forEach((el) => { c.portions[+el.dataset.pg].g = el.value; });
}

/* Rezept */
function recipeCalc(r) {
  const t = emptyN();
  let raw = 0;
  for (const i of r.items) { for (const k of NKEYS) t[k] += ((i.n[k] || 0) * i.g) / 100; raw += i.g; }
  const mk = MKEYS.filter((k) => r.items.some((i) => i.n[k] != null)); // nur Mikronährstoffe, die mindestens eine Zutat angibt
  for (const k of mk) t[k] = r.items.reduce((a, i) => a + ((i.n[k] || 0) * i.g) / 100, 0);
  const w = r.cooked > 0 ? r.cooked : raw;
  const p = Math.max(r.portions, 1);
  const per100 = Object.fromEntries([...NKEYS, ...mk].map((k) => [k, w ? (t[k] / w) * 100 : 0]));
  return { t, raw, w, per: { kcal: t.kcal / p, prot: t.prot / p, carb: t.carb / p, fat: t.fat / p }, per100 };
}
V.recipe = {
  html() {
    const r = S.draft, c = recipeCalc(r);
    return `${topbar(r.id ? 'Rezept bearbeiten' : 'Neues Rezept')}
    <div class="pad" style="padding-top:0">
      <div class="card"><div class="field"><label for="rn">Name</label><input id="rn" value="${esc(r.name)}" placeholder="z. B. Chili sin Carne"></div></div>
      <div class="card"><div class="sec-h"><span class="lbl">Zutaten</span><span class="lbl num">${fmt(c.raw)} g roh</span></div>
        <div>${r.items.length ? r.items.map((i, ix) => `<div class="ing">${thumb({ name: i.name })}<div style="min-width:0"><div class="n">${esc(i.name)}</div><div class="s num" id="ik${ix}">${fmt((i.n.kcal * i.g) / 100)} kcal</div></div><span class="in" style="display:flex;align-items:center;gap:4px"><input data-ing="${ix}" inputmode="decimal" value="${inVal(i.g)}" aria-label="Menge ${esc(i.name)} in Gramm"><span class="u" style="font-size:12px;color:var(--muted)">g</span></span><button class="x" data-act="rmIng" data-ix="${ix}" aria-label="Entfernen">${ic('close')}</button></div>`).join('') : `<div class="empty" style="padding:0">Noch keine Zutaten. Füge sie über Suchen oder Scannen hinzu.</div>`}</div>
        <div class="row2"><button class="btn sec" data-act="ingSearch">${ic('search')} Suchen</button><button class="btn sec" data-act="ingScan">${ic('scan')} Scannen</button></div>
      </div>
      <div class="card"><div class="row2"><div class="field"><label for="rp">Portionen</label><input id="rp" inputmode="numeric" value="${r.portions}"></div><div class="field"><label for="rw">Gewicht gekocht (g)</label><input id="rw" inputmode="decimal" value="${r.cooked ? inVal(r.cooked) : ''}" placeholder="optional"></div></div>
        <div style="font-size:12.5px;color:var(--muted)">Wiege den fertigen Topf (ohne Topf), dann stimmen die Werte pro 100 g auch, wenn Wasser verkocht.</div></div>
      <div class="card"><div class="lbl">Pro Portion · <span id="rpw" class="num">${fmt(c.w / Math.max(r.portions, 1))}</span> g</div>
        <div class="calc"><div class="k"><b id="r-kcal">${fmt(c.per.kcal)}</b><span>kcal</span></div><div><b id="r-prot">${fmt(c.per.prot, 1)}</b><span>Eiweiß</span></div><div><b id="r-carb">${fmt(c.per.carb, 1)}</b><span>Kohlenh.</span></div><div><b id="r-fat">${fmt(c.per.fat, 1)}</b><span>Fett</span></div></div>
        <div style="font-size:13px;color:var(--muted)">Pro 100 g ${r.cooked ? 'gekocht' : ''}: <b class="num" id="r-100" style="color:var(--ink)">${fmt(c.per100.kcal)} kcal</b></div>
      </div>
      <div class="card"><div class="lbl">Zubereitung</div>
        ${(r.steps || []).map((st, ix) => `<div class="estep"><div class="enum">${ix + 1}</div><div class="ebody">
          <textarea data-step="${ix}" rows="2" placeholder="z. B. Teig kneten und abgedeckt gehen lassen" aria-label="Schritt ${ix + 1}">${esc(st.t)}</textarea>
          <div class="edur"><span>Timer</span><input data-steph="${ix}" inputmode="numeric" value="${st.min ? Math.floor(st.min / 60) || '' : ''}" placeholder="0" aria-label="Stunden"><span>Std</span><input data-stepm="${ix}" inputmode="numeric" value="${st.min ? Math.round(st.min % 60) || '' : ''}" placeholder="0" aria-label="Minuten"><span>Min</span></div></div>
          <div class="emove"><button class="x" data-act="stepUp" data-ix="${ix}" aria-label="Nach oben" ${ix ? '' : 'disabled'}>${ic('up')}</button><button class="x" data-act="rmStep" data-ix="${ix}" aria-label="Schritt entfernen">${ic('close')}</button></div></div>`).join('')}
        ${(r.steps || []).length ? '' : `<div style="font-size:13px;color:var(--muted)">Beschreibe hier, wie das Rezept gemacht wird. Für Wartezeiten wie „Teig 2 Std gehen lassen“ trägst du die Zeit ein und bekommst beim Kochen einen Timer.</div>`}
        <button class="btn ghost" data-act="addStep" style="align-self:flex-start">${ic('plus')} Schritt hinzufügen</button>
      </div>
      ${r.id ? `<div class="row2"><button class="btn sec" data-act="dupRecipe">${ic('copy')} Als Kopie</button><button class="btn danger" data-act="delFood">${ic('trash')} Löschen</button></div>` : ''}
    </div>
    <div class="foot"><button class="btn" data-act="saveRecipe">Rezept speichern</button></div>`;
  },
};
function updateRecipeCalc() {
  const r = recipeCalc(S.draft);
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set('#r-kcal', fmt(r.per.kcal)); set('#r-prot', fmt(r.per.prot, 1)); set('#r-carb', fmt(r.per.carb, 1)); set('#r-fat', fmt(r.per.fat, 1));
  set('#r-100', fmt(r.per100.kcal) + ' kcal'); set('#rpw', fmt(r.w / Math.max(S.draft.portions, 1)));
}

/* ---------- Zubereitung & Timer ---------- */
const durText = (min) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return [h ? h + ' Std' : '', m ? m + ' Min' : ''].filter(Boolean).join(' ') || '0 Min'; };
const clock = (sec) => { sec = Math.max(0, Math.ceil(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
// Laufende Timer: [{ id, food, step, label, end, total }]. Im Browser gespeichert, damit sie ein Neuladen überstehen.
let timers = [];
try { timers = JSON.parse(localStorage.getItem('timers') || '[]'); } catch { timers = []; }
const saveTimers = () => { try { localStorage.setItem('timers', JSON.stringify(timers)); } catch { /* egal */ } };
const timerFor = (food, step) => timers.find((t) => t.food === food && t.step === step);
function startTimer(food, step, label, min) {
  stopTimer(food, step, true);
  timers.push({ id: uid(), food, step, label, end: Date.now() + min * 60000, total: min * 60 });
  saveTimers(); unlockAudio(); tickTimers();
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
}
function stopTimer(food, step, quiet) {
  timers = timers.filter((t) => !(t.food === food && t.step === step));
  saveTimers(); if (!quiet) tickTimers();
}
let audioCtx = null;
function unlockAudio() {
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch { /* ohne Ton */ }
}
function beep() {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime;
  for (let i = 0; i < 6; i++) {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'sine'; o.frequency.value = i % 2 ? 660 : 880;
    g.gain.setValueAtTime(0.0001, t0 + i * 0.35); g.gain.exponentialRampToValueAtTime(0.4, t0 + i * 0.35 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.35 + 0.3);
    o.connect(g).connect(audioCtx.destination); o.start(t0 + i * 0.35); o.stop(t0 + i * 0.35 + 0.32);
  }
}
let alarmLoop = null;
function ring(t) {
  beep(); navigator.vibrate?.([400, 200, 400, 200, 400]);
  try { if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') new Notification('Timer fertig', { body: t.label, icon: 'icons/icon-192.png' }); } catch { /* egal */ }
  let box = $('#alarm');
  if (!box) { box = document.createElement('div'); box.id = 'alarm'; box.className = 'alarm'; box.setAttribute('role', 'alertdialog'); document.body.appendChild(box); }
  const list = box.dataset.list ? JSON.parse(box.dataset.list) : [];
  list.push(t.label); box.dataset.list = JSON.stringify(list);
  box.innerHTML = `<div class="alarm-in">${ic('timer')}<h3>Timer fertig</h3>${list.map((l) => `<p>${esc(l)}</p>`).join('')}<button class="btn" data-act="alarmOk">OK</button></div>`;
  clearInterval(alarmLoop); alarmLoop = setInterval(() => { beep(); navigator.vibrate?.([400, 200, 400]); }, 4000);
  setTimeout(() => clearInterval(alarmLoop), 60000);
}
function tickTimers() {
  const now = Date.now();
  const done = timers.filter((t) => t.end <= now);
  if (done.length) { timers = timers.filter((t) => t.end > now); saveTimers(); done.forEach(ring); }
  // Anzeigen in der Kochansicht
  $$('[data-timer]').forEach((el) => {
    const [food, step] = el.dataset.timer.split('|'), t = timerFor(food, +step);
    const run = !!t;
    if (el.dataset.run !== String(run)) { if (cur().v === 'cook') { renderKeep(); return; } }
    if (t) el.querySelector('.left').textContent = clock((t.end - now) / 1000);
  });
  // schwebende Anzeige auf allen anderen Seiten
  let pill = $('#timerpill');
  const next = [...timers].sort((a, b) => a.end - b.end)[0];
  if (!next || cur().v === 'cook') { pill?.remove(); return; }
  if (!pill) { pill = document.createElement('button'); pill.id = 'timerpill'; pill.className = 'timerpill'; document.body.appendChild(pill); }
  pill.dataset.act = 'openCook'; pill.dataset.id = next.food;
  pill.innerHTML = `${ic('timer')}<span class="num">${clock((next.end - now) / 1000)}</span><small>${esc(next.label.split(' · ')[0])}${timers.length > 1 ? ` +${timers.length - 1}` : ''}</small>`;
}
function renderKeep() { const y = window.scrollY; render().then(() => window.scrollTo(0, y)); }
setInterval(tickTimers, 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tickTimers(); });

V.cook = {
  html(c) {
    const f = getFood(c.id);
    const steps = f?.recipe?.steps || [];
    if (!f) return `${topbar('Nicht gefunden')}<div class="pad"><p>Dieses Rezept gibt es nicht mehr.</p></div>`;
    const doneSet = new Set(c.done || []);
    const total = steps.reduce((a, s) => a + (s.min || 0), 0);
    return `${topbar('Zubereitung', `<button class="iconbtn" data-act="editFood" data-id="${esc(f.id)}" aria-label="Rezept bearbeiten">${ic('edit')}</button>`)}
    <div class="pad" style="padding-top:0">
      <div style="margin-top:-6px"><h3 style="margin:0">${esc(f.name)}</h3><div style="font-size:13px;color:var(--muted)">${steps.length} ${steps.length === 1 ? 'Schritt' : 'Schritte'}${total ? ` · Wartezeiten zusammen ${durText(total)}` : ''}</div></div>
      ${steps.length ? steps.map((s, i) => {
        const t = timerFor(f.id, i), left = t ? (t.end - Date.now()) / 1000 : 0;
        return `<div class="card cstep ${doneSet.has(i) ? 'done' : ''}">
          <div class="cstep-h"><button class="cnum" data-act="stepDone" data-i="${i}" aria-label="Schritt ${i + 1} ${doneSet.has(i) ? 'nicht mehr ' : ''}als erledigt markieren" aria-pressed="${doneSet.has(i)}">${doneSet.has(i) ? ic('check') : i + 1}</button>
          <div class="ctext">${esc(s.t).replace(/\n/g, '<br>')}</div></div>
          ${s.min ? `<div class="ctimer ${t ? 'run' : ''}" data-timer="${esc(f.id)}|${i}" data-run="${!!t}">
            ${t ? `<div class="ring-t"><span class="left num">${clock(left)}</span><small>von ${durText(s.min)}</small></div><button class="btn sec" data-act="timerStop" data-i="${i}">${ic('close')} Stoppen</button>`
              : `<button class="btn" data-act="timerStart" data-i="${i}">${ic('timer')} Timer ${durText(s.min)} starten</button>`}
          </div>` : ''}
        </div>`;
      }).join('') : `<div class="card"><div class="empty" style="padding:0">Für dieses Rezept sind noch keine Schritte angelegt. Tipp oben rechts auf Bearbeiten.</div></div>`}
      <p class="fine">Der Bildschirm bleibt in dieser Ansicht an. Timer laufen weiter, wenn du woanders in der App bist. Lass die App dafür offen, im Hintergrund kann das Handy den Ton verzögern.</p>
    </div>`;
  },
  mount() { tickTimers(); keepAwake(true); },
};
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}

/* ---------- Inhaltsstoff-Check ---------- */
const ALLERG = { gluten: 'Gluten', milk: 'Milch', eggs: 'Eier', nuts: 'Schalenfrüchte', peanuts: 'Erdnüsse', soybeans: 'Soja', fish: 'Fisch', crustaceans: 'Krebstiere', molluscs: 'Weichtiere', celery: 'Sellerie', mustard: 'Senf', 'sesame-seeds': 'Sesam', 'sulphur-dioxide-and-sulphites': 'Sulfite', lupin: 'Lupinen' };
const NOVA = { 1: 'unverarbeitet oder kaum verarbeitet', 2: 'verarbeitete Küchenzutat', 3: 'verarbeitetes Lebensmittel', 4: 'stark verarbeitetes Lebensmittel' };
const checkCache = new Map();
async function rememberCheck(h) {
  S.checks = [h, ...S.checks.filter((x) => x.id !== h.id)].slice(0, 30);
  await setSetting('checks', S.checks);
}
const lvDot = (lv) => `<i class="lvdot" style="background:${lv == null ? 'var(--muted)' : ING.LEVELS[lv].c}"></i>`;
function checkRing(counts, unrated) {
  const total = counts.reduce((a, b) => a + b, 0);
  const C = 2 * Math.PI * 46;
  let off = 0;
  const segs = [3, 2, 1, 0].map((lv) => {
    if (!counts[lv]) return '';
    const len = (counts[lv] / total) * C;
    const s = `<circle cx="60" cy="60" r="46" fill="none" stroke="${ING.LEVELS[lv].c}" stroke-width="16" stroke-dasharray="${Math.max(len - 2, 0.1)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"/>`;
    off += len;
    return s;
  }).join('');
  return `<div class="cring" role="img" aria-label="${counts[3]} problematisch, ${counts[2]} einschränken, ${counts[1]} eingeschränkt empfehlenswert, ${counts[0]} unbedenklich"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="46" fill="none" stroke="var(--surface2)" stroke-width="16"/>${segs}</svg>
    <div class="mid"><b class="num">${total}</b><small>bewertet${unrated ? `<br>${unrated} offen` : ''}</small></div></div>`;
}
V.check = {
  html() {
    return `${topbar('Inhaltsstoff-Check')}
    <div class="pad" style="padding-top:0">
      <p style="margin:-4px 0 0;color:var(--muted);font-size:14px">Scanne Duschgel, Creme oder ein Lebensmittel und sieh, welche Inhaltsstoffe bedenklich sind.</p>
      <div class="bigbtns">
        <button data-act="checkScan"><span class="ic">${ic('scan')}</span><span>Scannen<small>Barcode</small></span></button>
        <button data-act="checkPhoto"><span class="ic">${ic('cam')}</span><span>Foto<small>Zutatenliste</small></span></button>
      </div>
      <button class="btn sec" data-act="checkText">${ic('edit')} Zutatenliste eintippen oder einfügen</button>
      <div class="sec-h"><span class="lbl">Zuletzt geprüft</span></div>
      ${S.checks.length ? `<div class="list">${S.checks.map((h) => swipeRow('check', h.id, `<button class="item" data-act="checkOpen" data-id="${esc(h.id)}">${thumb(h)}<span class="tx"><span class="n">${esc(h.name)}</span><span class="s">${h.kind === 'cos' ? 'Kosmetik' : 'Lebensmittel'}${h.brand ? ' · ' + esc(h.brand) : ''}</span></span><span class="cbadges">${[3, 2].map((lv) => (h.counts?.[lv] ? `<span class="cb" style="background:${ING.LEVELS[lv].c}">${h.counts[lv]}</span>` : '')).join('')}</span></button>`)).join('')}</div>` : `<div class="empty" style="padding:0">Noch nichts geprüft.</div>`}
      <button class="btn ghost" data-act="checkInfo" style="align-self:center">So bewertet die App</button>
    </div>`;
  },
};
V.checktext = {
  html(c) {
    const kind = c.kind || 'cos';
    if (c.busy) return `${topbar('Zutatenliste lesen')}<div class="pad" style="padding-top:0"><div class="card" style="align-items:center;text-align:center">${c.preview ? `<img src="${c.preview}" alt="" style="max-width:100%;max-height:220px;border-radius:12px;opacity:.7">` : ''}<span class="spin"></span><div id="ingMsg">${esc(c.msg || 'Texterkennung läuft …')}</div><div class="progress" style="width:100%"><i id="ingBar" style="width:${c.pct || 3}%"></i></div></div></div>`;
    return `${topbar(c.fromPhoto ? 'Erkannten Text prüfen' : 'Zutatenliste')}
    <div class="pad" style="padding-top:0">
      <div class="card">
        <div class="seg"><button data-act="ctKind" data-v="cos" class="${kind === 'cos' ? 'on' : ''}">Kosmetik</button><button data-act="ctKind" data-v="food" class="${kind === 'food' ? 'on' : ''}">Lebensmittel</button></div>
        <div class="field"><label for="ct-name">Produktname (optional)</label><input id="ct-name" value="${esc(c.name || '')}" placeholder="z. B. Duschgel Meeresbrise"></div>
        <div class="field"><label for="ct-text">Zutaten / Ingredients</label><textarea id="ct-text" rows="8" placeholder="Aqua, Sodium Laureth Sulfate, Cocamidopropyl Betaine, Parfum, …">${esc(c.text || '')}</textarea></div>
        ${c.fromPhoto ? `<div style="font-size:12.5px;color:var(--muted)">Bitte kurz prüfen: Die Texterkennung kann sich bei kleiner oder gewölbter Schrift verlesen. Einzelne Fehler erkennt die App trotzdem.</div>` : `<div style="font-size:12.5px;color:var(--muted)">Stoffe mit Komma trennen, so wie auf der Packung.</div>`}
      </div>
    </div>
    <div class="foot"><button class="btn" data-act="checkEval">${ic('check')} Bewerten</button></div>`;
  },
};
V.checkres = {
  async load(c) {
    if (c.code && !c.data && !c.err) {
      if (checkCache.has(c.code)) { c.data = checkCache.get(c.code); return; }
      const h = S.checks.find((x) => x.id === c.code && x.data);
      try {
        if (!isOnline()) throw new Error('Kein Internet');
        const d = await OFF.lookupCheck(c.code);
        if (d) { c.data = d; checkCache.set(c.code, d); } else c.err = 'notfound';
      } catch (e) { if (h) c.data = h.data; else c.err = e.message || 'Fehler'; }
    }
  },
  html(c) {
    if (c.err) {
      const nf = c.err === 'notfound';
      return `${topbar('Inhaltsstoff-Check')}<div class="pad" style="padding-top:0"><div class="card">
        <h3 style="margin:0">${nf ? 'Produkt nicht gefunden' : 'Keine Verbindung'}</h3>
        <p style="margin:0;color:var(--muted)">${nf ? `Barcode <span class="code">${esc(c.code)}</span> ist weder bei Open Food Facts noch bei Open Beauty Facts bekannt.` : `Die Datenbanken sind gerade nicht erreichbar (${esc(c.err)}).`} Du kannst die Zutatenliste fotografieren oder eintippen.</p>
        <button class="btn" data-act="checkPhoto">${ic('cam')} Zutatenliste fotografieren</button>
        <button class="btn sec" data-act="checkText">${ic('edit')} Eintippen</button>
        ${nf ? '' : `<button class="btn ghost" data-act="checkRetry">Nochmal versuchen</button>`}</div></div>`;
    }
    const d = c.data;
    if (!d) return `${topbar('Inhaltsstoff-Check')}<div class="pad"><span class="spin"></span></div>`;
    const res = ING.analyze(d.text, d.kind, d.additives);
    c.res = res;
    const counts = [0, 0, 0, 0];
    res.forEach((r) => { if (r.it) counts[r.it.level]++; });
    const unrated = res.filter((r) => !r.it).length;
    const groups = [3, 2, 1, 0].map((lv) => {
      const items = res.map((r, i) => [r, i]).filter(([r]) => r.it?.level === lv);
      if (!items.length) return '';
      return `<details class="cgroup" ${lv >= 2 ? 'open' : ''}><summary>${lvDot(lv)}<b class="num">${items.length}</b> ${ING.LEVELS[lv].l}</summary>
        <div class="list">${items.map(([r, i]) => ingRow(r, i)).join('')}</div></details>`;
    }).join('') + (unrated ? `<details class="cgroup"><summary>${lvDot(null)}<b class="num">${unrated}</b> Nicht bewertet</summary><div class="list">${res.map((r, i) => [r, i]).filter(([r]) => !r.it).map(([r, i]) => ingRow(r, i)).join('')}</div></details>` : '');
    const tl = d.kind === 'food' && d.food ? ING.traffic(d.food.n, d.drink) : [];
    const TL = { fat: 'Fett', sat: 'Gesättigte Fette', sugar: 'Zucker', salt: 'Salz' }, WORD = ['gering', 'mittel', 'hoch'], COL = ['var(--lv0)', 'var(--lv1)', 'var(--lv3)'];
    const extras = [];
    if (d.kind === 'food') {
      if (d.allergens?.length) extras.push(['Allergene', d.allergens.map((a) => ALLERG[a] || a).join(', ')]);
      if (d.nova) extras.push(['Verarbeitung (NOVA)', `${d.nova}: ${NOVA[d.nova]}`]);
      if (d.nutri) extras.push(['Nutri-Score', `<span class="nutri n-${d.nutri}">${d.nutri.toUpperCase()}</span>`]);
    }
    if (d.vegan) extras.push(['Vegan', d.vegan === 'ja' ? 'ja' : 'nein']);
    const micro = res.some((r) => r.it?.r === 'microplastic'), fr = res.filter((r) => r.it?.r === 'fallerg' || r.it?.r === 'fstrong' || r.it?.r === 'fban').length;
    if (d.kind === 'cos') { extras.push(['Mikroplastik', micro ? 'ja' : 'nicht gefunden']); extras.push(['Duftstoff-Allergene', fr ? String(fr) : 'keine gefunden']); }
    return `${topbar('Inhaltsstoff-Check')}
    <div class="pad" style="padding-top:0">
      <div class="hero">${thumb(d)}<div style="min-width:0"><h3>${esc(d.name)}</h3><div class="s">${d.brand ? esc(d.brand) + ' · ' : ''}${d.kind === 'cos' ? 'Kosmetik' : 'Lebensmittel'} · Daten: ${esc(d.src)}</div></div></div>
      ${counts[3] ? `<div class="notice danger">${ic('warn')}<span><b>${counts[3]} problematische${counts[3] === 1 ? 'r' : ''} Inhaltsstoff${counts[3] === 1 ? '' : 'e'}</b> gefunden.</span></div>` : ''}
      ${!d.text && !d.additives.length ? `<div class="card"><b>Für dieses Produkt fehlt die Zutatenliste.</b><p style="margin:0;color:var(--muted);font-size:14px">Fotografiere sie oder tippe sie ab, dann bewertet die App die Stoffe.</p><div class="row2"><button class="btn sec" data-act="checkPhoto" data-kind="${d.kind}">${ic('cam')} Foto</button><button class="btn sec" data-act="checkText" data-kind="${d.kind}">${ic('edit')} Eintippen</button></div></div>` : `
      <div class="card"><div class="cres">${checkRing(counts, unrated)}
        <div class="clegend">${[3, 2, 1, 0].map((lv) => `<div>${lvDot(lv)}<b class="num">${counts[lv]}</b><span>${ING.LEVELS[lv].l}</span></div>`).join('')}</div></div>
        <div class="fine" style="margin:0;text-align:left">Bewertet wird jeder Inhaltsstoff für sich, nicht die Menge im Produkt. <button class="linkbtn" data-act="checkInfo">Mehr erfahren</button></div></div>
      ${c.all ? `<div class="card"><div class="sec-h"><span class="lbl">Alle Inhaltsstoffe in Reihenfolge</span><button class="linkbtn" data-act="checkAll">Gruppiert</button></div><div class="list flat">${res.map((r, i) => ingRow(r, i)).join('')}</div></div>`
        : `${groups}<button class="btn sec" data-act="checkAll">Alle sehen (${res.length})</button>`}`}
      ${tl.length ? `<div class="card"><div class="lbl">Nährwert-Ampel pro 100 ${d.drink ? 'ml' : 'g'}</div>
        ${tl.map((t) => `<div class="tlrow"><i class="lvdot" style="background:${COL[t.lvl]}"></i><span>${TL[t.k]}</span><b>${WORD[t.lvl]}</b><span class="num">${fmt(t.v, 1)} g</span></div>`).join('')}
        <div class="fine" style="margin:0;text-align:left">Grenzwerte: britische Food Standards Agency (FSA), ${d.drink ? 'für Getränke' : 'für Lebensmittel'}.</div></div>` : ''}
      ${extras.length ? `<div class="card"><div class="lbl">Weitere Infos</div>${extras.map(([k, v]) => `<div class="tlrow"><span>${k}</span><b style="margin-left:auto;text-align:right">${v}</b></div>`).join('')}</div>` : ''}
      ${d.food ? `<button class="btn" data-act="checkDiary">${ic('plus')} Ins Tagebuch übernehmen</button>` : ''}
      ${d.code ? `<a class="btn ghost" href="${d.kind === 'cos' ? 'https://world.openbeautyfacts.org' : 'https://world.openfoodfacts.org'}/product/${esc(d.code)}" target="_blank" rel="noopener">Daten bei ${esc(d.src)} korrigieren</a>` : `<button class="btn ghost" data-act="checkEdit">Zutatenliste bearbeiten</button>`}
    </div>`;
  },
  mount(c) {
    const d = c.data;
    if (!d || c.saved) return;
    c.saved = true;
    const counts = [0, 0, 0, 0];
    (c.res || []).forEach((r) => { if (r.it) counts[r.it.level]++; });
    rememberCheck({ id: d.code || c.hid, name: d.name, brand: d.brand, img: d.img, kind: d.kind, counts, data: d });
  },
};
function ingRow(r, i) {
  const it = r.it;
  return `<button class="item cing" data-act="ingInfo" data-i="${i}">${lvDot(it ? it.level : null)}<span class="tx"><span class="n">${esc(it && !it.plain ? (it.e ? `${it.e} ${it.name}` : it.name) : r.name)}</span><span class="s">${it ? esc(it.fn || '') : 'nicht in der Liste'}${it && (r.how === 'part' || r.how === 'fuzzy') && keyText(r.name) !== keyText(it.name) ? ` · gelesen: „${esc(r.name)}“` : ''}</span></span>${ic('fwd')}</button>`;
}
const keyText = (s) => norm(s).replace(/[^a-z0-9]/g, '');
function ingSheet(r) {
  const it = r.it;
  if (!it) return sheet(`<h3>${esc(r.name)}</h3><p>Dieser Stoff steht noch nicht in der Liste der App und wird deshalb nicht bewertet.</p><p class="fine" style="text-align:left">Falls die Texterkennung sich verlesen hat, kannst du die Zutatenliste korrigieren.</p><button class="btn sec" data-act="closeSheet">OK</button>`);
  const q = it.src && ING.Q[it.src];
  sheet(`<div class="ingh">${lvDot(it.level)}<span class="lvl" style="color:${ING.LEVELS[it.level].c}">${ING.LEVELS[it.level].l}</span></div>
    <h3 style="margin:0">${esc(it.e ? `${it.e} · ${it.name}` : it.plain ? r.name : it.name)}</h3>
    ${it.names?.length > 1 ? `<div style="font-size:12.5px;color:var(--muted)">Auch: ${it.names.slice(1).map(esc).join(', ')}</div>` : ''}
    <div style="font-size:13px"><b>Funktion:</b> ${esc(it.fn || '–')}</div>
    <p style="margin:0">${esc(ING.R[it.r] || '')}</p>
    ${r.how === 'fuzzy' || r.how === 'part' ? `<div style="font-size:12.5px;color:var(--muted)">Auf der Packung gelesen als „${esc(r.name)}“.</div>` : ''}
    ${q ? `<div style="font-size:12.5px;color:var(--muted)">Quelle: <a href="${q[1]}" target="_blank" rel="noopener">${esc(q[0])}</a> · Stand ${ING.CHECKED}</div>` : ''}
    <button class="btn sec" data-act="closeSheet">Schließen</button>`);
}
const checkInfoHtml = () => `<h3>So bewertet die App</h3>
  <p>Jeder Inhaltsstoff wird mit einer eigenen Liste der App abgeglichen und in vier Stufen eingeteilt: <b style="color:var(--lv0)">unbedenklich</b>, <b style="color:var(--lv1)">eingeschränkt empfehlenswert</b>, <b style="color:var(--lv2)">einschränken</b> und <b style="color:var(--lv3)">problematisch</b>. Jede Einstufung hat eine Begründung und eine Quelle, z. B. EU-Verordnungen, die EFSA oder den EU-Ausschuss für Verbrauchersicherheit (SCCS).</p>
  <p>Bewertet wird der Stoff an sich, nicht die Menge im Produkt. Eine Gesamtnote gibt es deshalb nicht. Der Ring zeigt nur, wie viele Stoffe in welcher Stufe sind. Stoffe, die nicht in der Liste stehen, erscheinen grau.</p>
  <p>Bei Lebensmitteln zeigt die Nährwert-Ampel Fett, gesättigte Fette, Zucker und Salz nach den Grenzwerten der britischen Food Standards Agency.</p>
  <p class="fine" style="text-align:left">Produktdaten: Open Food Facts und Open Beauty Facts (ODbL). Das ist keine medizinische Beratung. Liste geprüft: ${ING.CHECKED}.</p>
  <button class="btn sec" data-act="closeSheet">OK</button>`;
async function runIngOcr(file) {
  const c = cur();
  replace('checktext', { busy: true, kind: c.kind || 'cos', fromPhoto: true, code: c.code });
  const me = cur();
  try {
    const ocr = await import('./ocr.js');
    const { canvas, preview } = await ocr.prepareImage(file);
    me.preview = preview; render();
    const w = await ocr.getWorker((m) => {
      if (cur() !== me) return;
      const pct = m.status === 'recognizing text' ? 40 + m.progress * 60 : Math.min(40, (m.progress || 0) * 40);
      const bar = $('#ingBar'), msg = $('#ingMsg');
      if (bar) bar.style.width = pct + '%';
      if (msg) msg.textContent = m.status === 'recognizing text' ? 'Text wird gelesen …' : 'Texterkennung wird geladen …';
    });
    await w.setParameters({ tessedit_pageseg_mode: '6' });
    const { data } = await w.recognize(canvas);
    if (cur() !== me) return;
    me.busy = false; me.text = data.text.replace(/-\n/g, '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    render(true);
  } catch (e) {
    if (cur() !== me) return;
    me.busy = false; me.fromPhoto = false; render(); toast(e.message || 'Texterkennung fehlgeschlagen', true);
  }
}

/* Verlauf */
V.verlauf = {
  async load() {
    const c = cur();
    if (S.vtab === 'rueck') return loadRueck(c);
    const n = c.range === 'month' ? 30 : 7;
    c.from = addDays(today(), -(n - 1));
    c.list = await db.range('entries', 'date', c.from, today());
    c.weights = await loadWeights(true);
    await loadWeek(today());
  },
  html() {
    if (S.vtab === 'rueck') return rueckHtml(cur());
    const c = cur(), n = c.range === 'month' ? 30 : 7;
    const days = Array.from({ length: n }, (_, i) => addDays(c.from, i));
    const goals = days.map((d) => goalFor(d).kcal), goal = Math.max(...goals), same = goals.every((g) => g === goals[0]);
    const per = new Map(days.map((d) => [d, []]));
    c.list.forEach((e) => per.get(e.date)?.push(e));
    const tots = days.map((d) => dayTotals(d, per.get(d)));
    const logged = tots.filter((t) => t.kcal > 0);
    const avg = (k) => (logged.length ? logged.reduce((a, t) => a + t[k], 0) / logged.length : 0);
    const W = 320, H = 170, pl = 30, pb = 22, pt = 10;
    const max = Math.max(goal * 1.3, ...tots.map((t) => t.kcal)) || 2500;
    const step = max > 4000 ? 2000 : 1000;
    const y = (v) => pt + (H - pt - pb) * (1 - v / max), bw = (W - pl) / n;
    const bars = tots.map((t, i) => `<rect x="${pl + i * bw + bw * 0.18}" y="${y(t.kcal)}" width="${bw * 0.64}" height="${Math.max(0, H - pb - y(t.kcal))}" rx="${n > 7 ? 1.5 : 4}" fill="${t.kcal > goals[i] ? 'var(--carb)' : 'var(--accent)'}"><title>${dateLong(days[i])}: ${fmt(t.kcal)} kcal</title></rect>${n === 7 || i % 5 === 0 ? `<text x="${pl + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${n === 7 ? parseD(days[i]).toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '') : parseD(days[i]).getDate() + '.'}</text>` : ''}`).join('');
    const grid = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step).map((v) => `<line x1="${pl}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${pl - 5}" y="${y(v) + 3}" text-anchor="end">${v / 1000}k</text>`).join('');
    const goalLine = same ? `<line x1="${pl}" x2="${W}" y1="${y(goal)}" y2="${y(goal)}" stroke="var(--ink)" stroke-dasharray="4 4"/>`
      : goals.map((g, i) => `<line x1="${pl + i * bw + 1}" x2="${pl + (i + 1) * bw - 1}" y1="${y(g)}" y2="${y(g)}" stroke="var(--ink)" stroke-width="2" stroke-dasharray="${n > 7 ? '2 1' : '4 3'}"/>`).join('');
    // Gewicht und weitere Messwert-Ziele
    const ws = c.weights.slice(-12);
    const wGoal = S.goals.find((g) => g.type === 'weight');
    const wchart = ws.length ? lineChart(ws.map((w) => ({ date: w.date, v: w.kg })), 'kg', 1, wGoal?.target) : `<div class="empty" style="padding:0">Noch kein Gewicht eingetragen.</div>`;
    const delta = ws.length > 1 ? ws[ws.length - 1].kg - ws[0].kg : null;
    const mCharts = S.goals.filter((g) => GOAL_TYPES[g.type].m && g.type !== 'weight').map((g) => {
      const T = GOAL_TYPES[g.type], s = series(g.type).slice(-12);
      return `<div class="card chart"><div class="sec-h"><span class="lbl">${T.l}</span><span class="num" style="font-size:13px;color:var(--muted)">Ziel ${fmt(g.target, T.d)} ${T.u}</span></div>${s.length ? lineChart(s, T.u, T.d, g.target) : `<div class="empty" style="padding:0">Noch keine Werte.</div>`}<button class="btn sec" data-act="goalOpen" data-id="${esc(g.id)}">${ic('plus')} Wert eintragen</button></div>`;
    }).join('');
    // Diese Woche (Kalenderwoche)
    const wdays = weekDays(today()), gW = wdays.reduce((a, d) => a + goalFor(d).kcal, 0), eW = wdays.reduce((a, d) => a + dayTotals(d).kcal, 0);
    const estK = c.list.filter((e) => e.est).reduce((a, e) => a + nutOf(e.n, e.g).kcal, 0), allK = tots.reduce((a, t) => a + t.kcal, 0);
    return `${topbar('Verlauf')}
    <div class="pad" style="padding-top:0">
      ${vtabs()}
      <div class="card"><div class="sec-h"><span class="lbl">Diese Woche</span><span class="num" style="font-size:13px;color:var(--muted)">${fmt(Math.min(eW / Math.max(gW, 1), 9.99) * 100)} %</span></div>
        <div style="font-size:15px"><b class="num" style="font-family:var(--display);font-size:22px">${fmt(eW)}</b> von ${fmt(gW)} kcal</div>
        <div class="bar" style="height:9px"><i style="width:${Math.min(eW / Math.max(gW, 1), 1) * 100}%;background:${eW > gW ? 'var(--carb)' : 'var(--accent)'}"></i></div>
        <div style="font-size:12.5px;color:var(--muted)">${eW > gW ? `${fmt(eW - gW)} kcal über dem Wochenziel.` : `Noch ${fmt(gW - eW)} kcal bis zum Wochenziel.`}</div></div>
      <div class="chips"><button class="chip ${c.range !== 'month' ? 'on' : ''}" data-act="range" data-v="week">7 Tage</button><button class="chip ${c.range === 'month' ? 'on' : ''}" data-act="range" data-v="month">30 Tage</button></div>
      <div class="card chart"><div class="sec-h"><span class="lbl">Kalorien, letzte ${n} Tage</span><span class="num" style="font-size:13px;color:var(--muted)">Ø <b style="color:var(--ink)">${fmt(avg('kcal'))}</b> kcal</span></div>
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Kalorien pro Tag">${grid}${bars}${goalLine}</svg>
        <div class="legend"><span><i style="background:var(--accent)"></i>im Ziel</span><span><i style="background:var(--carb)"></i>über dem Ziel</span><span><i style="background:none;border-top:2px dashed var(--ink);border-radius:0;height:0;width:14px"></i>${same ? 'Ziel ' + fmt(goal) : 'Ziel je Tag'}</span></div>
        ${estK > 0 && allK > 0 ? `<div style="font-size:12.5px;color:var(--muted)">${fmt((estK / allK) * 100)} % der Kalorien in diesem Zeitraum sind aus Essensfotos geschätzt.</div>` : ''}</div>
      <div class="card"><div class="lbl">Durchschnitt an ${logged.length} ${logged.length === 1 ? 'Tag' : 'Tagen'} mit Einträgen</div>
        <div class="calc"><div class="k"><b>${fmt(avg('kcal'))}</b><span>kcal</span></div><div><b>${fmt(avg('prot'))}</b><span>Eiweiß g</span></div><div><b>${fmt(avg('carb'))}</b><span>Kohlenh. g</span></div><div><b>${fmt(avg('fat'))}</b><span>Fett g</span></div></div></div>
      <div class="card chart"><div class="sec-h"><span class="lbl">Gewicht</span>${delta != null ? `<span class="num" style="font-size:13px;color:${delta <= 0 ? 'var(--accent)' : 'var(--carb)'};font-weight:700">${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${fmt(Math.abs(delta), 1)} kg</span>` : ''}</div>
        ${wchart}
        <button class="btn sec" data-act="addWeight">${ic('plus')} Gewicht eintragen</button>
        ${c.weights.length ? `<button class="btn ghost" data-act="weightList" style="align-self:center">Alle Einträge</button>` : ''}</div>
      ${mCharts}
    </div>`;
  },
};

const vtabs = () => `<div class="seg" role="tablist" aria-label="Ansicht"><button role="tab" aria-selected="${S.vtab !== 'rueck'}" class="${S.vtab !== 'rueck' ? 'on' : ''}" data-act="vtab" data-v="woche">Diese Woche</button><button role="tab" aria-selected="${S.vtab === 'rueck'}" class="${S.vtab === 'rueck' ? 'on' : ''}" data-act="vtab" data-v="rueck">Rückblick</button></div>`;

/* Rückblick: Zeitraum 1 Woche bis Gesamt */
async function loadRueck(c) {
  const P = PERIODS.find((p) => p[0] === S.period) || PERIODS[2];
  const ws = await loadWeights();
  let from;
  if (P[2]) from = addDays(today(), -(P[2] - 1));
  else {
    const first = (await db.range('entries', 'date', '0000-01-01', today())).reduce((a, e) => (e.date < a ? e.date : a), today());
    const wFirst = ws[0]?.date || today(), wat = Object.keys(S.measures.water && !Array.isArray(S.measures.water) ? S.measures.water : {}).sort()[0] || today();
    from = [first, wFirst, wat].sort()[0];
  }
  // für die Serie etwas weiter zurück laden
  c.H = await loadHist(addDays(from, -400) < from ? addDays(today(), -Math.max(400, daysBetween(from, today()) + 1)) : from);
  c.from = from; c.P = P; c.ws = ws;
}
function rueckHtml(c) {
  const H = c.H, P = c.P, from = c.from, n = daysBetween(from, today()) + 1;
  const days = Array.from({ length: n }, (_, i) => addDays(from, i));
  const past = days.filter((d) => d < today()).map((d) => histDay(H, d));
  const logged = past.filter((x) => x.n > 0);
  const avg = (arr, f) => (arr.length ? arr.reduce((a, x) => a + f(x), 0) / arr.length : 0);
  const ok = past.filter((x) => dayOk(H, 'kcal', x.d)).length;
  let best = 0, run = 0; past.forEach((x) => { run = dayOk(H, 'kcal', x.d) ? run + 1 : 0; best = Math.max(best, run); });
  const kind = STREAKS[S.prefs.streak] ? S.prefs.streak : 'kcal', cs = currentStreak(H, kind);
  // Gewicht im Zeitraum
  const wIn = c.ws.filter((w) => w.date >= from), w0 = wIn[0], w1 = wIn[wIn.length - 1];
  const wDiff = wIn.length > 1 ? w1.kg - w0.kg : null;
  // Diagramm: Tage bei 1 Woche, Wochen bis 6 Monate, Monate ab 1 Jahr (bei kurzer Gesamtzeit Wochen)
  const per = P[0] === '1W' ? 1 : (P[0] === '1J' || (P[0] === 'ALL' && n > 180)) ? 'm' : P[0] === 'ALL' && n <= 14 ? 1 : 7;
  const buckets = [];
  if (per === 'm') {
    const byM = new Map(); days.forEach((d) => { const k = d.slice(0, 7); if (!byM.has(k)) byM.set(k, []); byM.get(k).push(d); });
    byM.forEach((ds, k) => buckets.push({ ds, lab: parseD(k + '-01').toLocaleDateString('de-DE', { month: 'short' }).replace('.', '') }));
  } else for (let i = 0; i < n; i += per) { const ds = days.slice(i, i + per); buckets.push({ ds, lab: per === 1 ? WD[parseD(ds[0]).getDay()] : `${parseD(ds[0]).getDate()}.${parseD(ds[0]).getMonth() + 1}.` }); }
  buckets.forEach((b) => { const xs = b.ds.map((d) => histDay(H, d)).filter((x) => x.n > 0); b.kcal = avg(xs, (x) => x.kcal); b.goal = avg(b.ds.map((d) => histDay(H, d)), (x) => x.goal.kcal); b.has = xs.length > 0; });
  const W = 320, Hh = 150, pL = 30, pb = 20, pt = 8, max = Math.max(3000, ...buckets.map((b) => Math.max(b.kcal, b.goal) * 1.1)), y = (v) => pt + (Hh - pt - pb) * (1 - v / max), bw = (W - pL) / Math.max(buckets.length, 1);
  const every = Math.ceil(buckets.length / 7);
  const step = max > 4500 ? 2000 : 1000;
  const chart = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Durchschnittliche Kalorien">${Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step).map((v) => `<line x1="${pL}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${pL - 5}" y="${y(v) + 3}" text-anchor="end">${v / 1000}k</text>`).join('')}
    ${buckets.map((b, i) => `${b.has ? `<rect x="${pL + i * bw + bw * 0.18}" y="${y(b.kcal)}" width="${Math.max(bw * 0.64, 2)}" height="${Math.max(0, Hh - pb - y(b.kcal))}" rx="${bw > 14 ? 3 : 1}" fill="${b.kcal > b.goal * 1.05 ? 'var(--carb)' : 'var(--accent)'}"><title>${b.lab}: Ø ${fmt(b.kcal)} kcal</title></rect>` : ''}${i % every === 0 ? `<text x="${pL + i * bw + bw / 2}" y="${Hh - 5}" text-anchor="middle">${b.lab}</text>` : ''}`).join('')}
    ${buckets.length > 1 ? `<polyline points="${buckets.map((b, i) => `${pL + i * bw + bw / 2},${y(b.goal)}`).join(' ')}" fill="none" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="4 3"/>` : `<line x1="${pL}" x2="${W}" y1="${y(buckets[0]?.goal || 0)}" y2="${y(buckets[0]?.goal || 0)}" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="4 3"/>`}</svg>`;
  // Wasser
  const Wp = S.prefs.water, wat = past.filter((x) => x.water > 0), wok = past.filter((x) => dayOk(H, 'water', x.d)).length;
  // Häufigste Lebensmittel
  const cnt = new Map();
  H.es.filter((e) => e.date >= from && e.src !== 'Schnell').forEach((e) => { const k = e.name; cnt.set(k, (cnt.get(k) || 0) + 1); });
  const tops = [...cnt].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const top = logged.reduce((a, x) => (!a || x.kcal > a.kcal ? x : a), null);
  const dShort = (d) => parseD(d).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${topbar('Verlauf')}
  <div class="pad" style="padding-top:0">
    ${vtabs()}
    <div class="periods" role="tablist" aria-label="Zeitraum">${PERIODS.map(([k, l]) => `<button role="tab" aria-selected="${S.period === k}" class="${S.period === k ? 'on' : ''}" data-act="period" data-v="${k}" aria-label="${l}">${perShort(k)}</button>`).join('')}</div>
    <div style="font-size:13px;color:var(--muted)">${P[1]}: ${dShort(from)} bis heute</div>
    ${!logged.length ? `<div class="card"><div class="empty" style="padding:0">Noch keine Einträge in diesem Zeitraum. Heute zählt erst, wenn der Tag vorbei ist.</div></div>` : `
    <div class="stats">
      <div class="stat"><span class="lbl">Ø Kalorien</span><b class="num">${fmt(avg(logged, (x) => x.kcal))} <small>/ Tag</small></b><span>Ziel Ø ${fmt(avg(logged, (x) => x.goal.kcal))}</span></div>
      <div class="stat good"><span class="lbl">Im Rahmen</span><b class="num">${ok} <small>von ${logged.length}</small></b><span>${fmt((ok / logged.length) * 100)} % der Tage mit Einträgen</span></div>
      <div class="stat"><span class="lbl">Längste Serie</span><b class="num">${best} <small>${best === 1 ? 'Tag' : 'Tage'}</small></b><span>aktuell ${cs} ${STREAKS[kind]}</span></div>
      <div class="stat ${wDiff != null && wDiff <= 0 ? 'good' : ''}"><span class="lbl">Gewicht</span>${wDiff != null ? `<b class="num">${wDiff > 0 ? '+' : wDiff < 0 ? '−' : '±'}${fmt(Math.abs(wDiff), 1)} <small>kg</small></b><span>${fmt(w0.kg, 1)} → ${fmt(w1.kg, 1)} kg</span>` : `<b>–</b><span>${wIn.length ? 'nur ein Wert' : 'keine Werte'} im Zeitraum</span>`}</div>
    </div>
    <div class="card chart"><div class="sec-h"><span class="lbl">Ø Kalorien pro ${per === 1 ? 'Tag' : per === 'm' ? 'Monat' : 'Woche'}</span></div>${chart}
      <div class="legend"><span><i style="background:var(--accent)"></i>im Ziel</span><span><i style="background:var(--carb)"></i>drüber</span><span><i style="background:none;border-top:2px dashed var(--ink);border-radius:0;height:0;width:14px"></i>Ziel</span></div></div>
    <div class="card"><div class="lbl">Ø Makros pro Tag</div>
      <div class="calc" style="grid-template-columns:repeat(3,1fr)"><div><b style="color:var(--prot)">${fmt(avg(logged, (x) => x.prot))} g</b><span>Eiweiß</span></div><div><b style="color:var(--carb)">${fmt(avg(logged, (x) => x.carb))} g</b><span>Kohlenh.</span></div><div><b style="color:var(--fat)">${fmt(avg(logged, (x) => x.fat))} g</b><span>Fett</span></div></div></div>`}
    ${Wp.on && wat.length ? `<div class="stats"><div class="stat"><span class="lbl">Ø Wasser</span><b class="num">${fmt(avg(wat, (x) => x.water), 1)} <small>l / Tag</small></b><span>Ziel ${fmt(Wp.goal / 1000, 1)} l</span></div><div class="stat"><span class="lbl">Wasserziel</span><b class="num">${wok} <small>${wok === 1 ? 'Tag' : 'Tage'}</small></b><span>${fmt((wok / wat.length) * 100)} % der Tage mit Wasser</span></div></div>` : ''}
    ${tops.length ? `<div class="card"><div class="cardh"><span class="lbl">Am häufigsten gegessen</span></div><div class="toplist">${tops.map(([nm, k], i) => `<div class="row"><b>${i + 1}</b><span>${esc(nm)}</span><span>${k}×</span></div>`).join('')}</div></div>` : ''}
    ${top ? `<div class="card"><div class="lbl">Meiste Kalorien</div><div style="font-size:14px"><b class="num">${fmt(top.kcal)} kcal</b> am ${parseD(top.d).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>` : ''}
    <p class="fine">Den Standard-Zeitraum legst du unter Einstellungen → Rückblick und Serien fest.</p>
  </div>`;
}

// Linienverlauf für Messwerte, optional mit Ziellinie
function lineChart(ws, unit, d, target) {
  const W = 320, pl = 30, H2 = 140;
  const vals = ws.map((w) => w.v).concat(target != null ? [target] : []);
  const mn = Math.floor(Math.min(...vals) - 1), mx = Math.ceil(Math.max(...vals) + 1);
  const y2 = (v) => 10 + (H2 - 32) * (1 - (v - mn) / (mx - mn)), x2 = (i) => (ws.length === 1 ? (pl + W) / 2 : pl + i * ((W - pl - 10) / (ws.length - 1)));
  const pts = ws.map((w, i) => `${x2(i)},${y2(w.v)}`).join(' ');
  const area = `${x2(0)},${H2 - 22} ${pts} ${x2(ws.length - 1)},${H2 - 22}`;
  const ticks = [mn, (mn + mx) / 2, mx].map((v) => `<line x1="${pl}" x2="${W}" y1="${y2(v)}" y2="${y2(v)}" stroke="var(--line)"/><text x="${pl - 5}" y="${y2(v) + 3}" text-anchor="end">${fmt(v)}</text>`).join('');
  const goalL = target != null ? `<line x1="${pl}" x2="${W}" y1="${y2(target)}" y2="${y2(target)}" stroke="var(--ink)" stroke-dasharray="4 4"/><text x="${pl + 4}" y="${y2(target) - 4}" style="fill:var(--muted)">Ziel ${fmt(target, d)}</text>` : '';
  const last = ws[ws.length - 1];
  return `<svg viewBox="0 0 ${W} ${H2}" role="img" aria-label="Verlauf in ${unit}">${ticks}${goalL}${ws.length > 1 ? `<polygon points="${area}" fill="var(--accent-soft)"/><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>` : ''}${ws.map((w, i) => `<circle cx="${x2(i)}" cy="${y2(w.v)}" r="${i === ws.length - 1 ? 5 : 2.5}" fill="${i === ws.length - 1 ? 'var(--accent)' : 'var(--surface)'}" stroke="var(--accent)" stroke-width="2"><title>${dateLong(w.date)}: ${fmt(w.v, d)} ${unit}</title></circle>`).join('')}<text x="${x2(ws.length - 1)}" y="${y2(last.v) - 10}" text-anchor="end" style="fill:var(--ink);font-weight:700">${fmt(last.v, d)} ${unit}</text></svg>`;
}

V.watercfg = () => `${topbar('Wasser')}
  <div class="pad" style="padding-top:0">
    <div class="card"><label class="togglerow"><span>Wasser-Tracker<small>Karte auf der Startseite</small></span><input type="checkbox" class="tg" id="w-on" ${S.prefs.water.on ? 'checked' : ''}></label></div>
    <div class="card"><div class="row2"><div class="field"><label for="w-goal">Tagesziel (ml)</label><input id="w-goal" inputmode="numeric" value="${S.prefs.water.goal}"></div><div class="field"><label for="w-glass">Ein Glas (ml)</label><select id="w-glass">${[150, 200, 250, 300, 330, 500].map((v) => `<option value="${v}" ${v === S.prefs.water.glass ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>
      <div style="font-size:12.5px;color:var(--muted)">Faustregel: etwa 30 bis 35 ml pro kg Körpergewicht${S.profile && !S.profile.skipped && S.profile.weight ? ` (bei dir etwa ${fmt(Math.round((S.profile.weight * 32) / 100) * 100)} ml)` : ''}, mehr bei Sport und Hitze.</div></div>
  </div>`;
V.reviewcfg = () => `${topbar('Rückblick und Serien')}
  <div class="pad" style="padding-top:0">
    <div class="card"><div class="lbl">Standard-Zeitraum</div>
      <div class="periods" style="background:var(--surface2)">${PERIODS.map(([k, l]) => `<button class="${S.prefs.period === k ? 'on' : ''}" data-act="defPeriod" data-v="${k}" aria-label="${l}" aria-pressed="${S.prefs.period === k}">${perShort(k)}</button>`).join('')}</div>
      <div style="font-size:12.5px;color:var(--muted)">So öffnet sich der Rückblick. Im Verlauf kannst du jederzeit umschalten.</div></div>
    <div class="card"><div class="lbl">Serie auf der Startseite</div>
      <div class="typelist">${[...Object.entries(STREAKS).map(([k, l]) => [k, 'Tage ' + l]), ['off', 'Keine Serie zeigen']].map(([k, l]) => `<button data-act="streakKind" data-v="${k}" aria-pressed="${S.prefs.streak === k}" style="${S.prefs.streak === k ? 'border-color:var(--accent);background:var(--accent-soft)' : ''}">${l}${S.prefs.streak === k ? ic('check') : ''}</button>`).join('')}</div>
      <div style="font-size:12.5px;color:var(--muted)">Im Rahmen heißt 70 bis 105 % vom Tagesziel. Mit Wochenbudget („Wochensumme gleich lassen“) zählt die Woche, damit ein Freitag mit mehr Kalorien die Serie nicht bricht.</div></div>
    <div class="card"><label class="togglerow"><span>Wochenrückblick am Wochenende<small>Kleine Karte auf der Startseite am letzten Tag der Woche</small></span><input type="checkbox" class="tg" id="sun-on" ${S.prefs.sunday ? 'checked' : ''}></label></div>
  </div>`;

/* Einstellungen */
V.settings = {
  html() {
    const p = S.profile && !S.profile.skipped ? S.profile : null;
    const G = goalMacros(), mode = S.goal.mode || 'pct', kc = Math.max(S.goal.kcal, 1);
    // Prozente aus den Gramm, falls das Ziel aus dem Rechner oder in Gramm kommt
    const sp = S.goal.macros ? { prot: Math.round((G.prot * 400) / kc), carb: Math.round((G.carb * 400) / kc) } : { ...S.goal.split };
    if (S.goal.macros) sp.fat = 100 - sp.prot - sp.carb;
    const mfield = (id, l, col, v) => `<div class="field" style="background:none;padding:0"><label for="${id}" style="color:var(${col})">${l}</label><input id="${id}" inputmode="numeric" value="${v}"></div>`;
    return `${topbar('Einstellungen')}
    <div class="pad" style="padding-top:0">
      <div class="lbl">Ziele</div>
      <div class="setlist"><button class="setrow" data-act="openCalc"><span class="ico">${ic('chart')}</span><span class="tx">Kalorien-Rechner<small>${p ? `${p.sex === 'w' ? 'Frau' : 'Mann'} · ${p.age} Jahre · ${fmt(p.height)} cm · ${fmt(p.weight, 1)} kg · ${esc(GOALS.find((g) => g[0] === p.goal)?.[1] || '')}` : 'Profil eintragen und Tagesziel berechnen'}</small></span>${ic('fwd')}</button>
        <button class="setrow" data-act="go" data-v="week"><span class="ico">${ic('cal')}</span><span class="tx">Kalorien und Woche<small>Wochenziel ${fmt(weekDays(today()).reduce((a, d) => a + goalFor(d).kcal, 0))} kcal${S.goal.perDay && Object.keys(S.goal.days || {}).length ? ` · ${Object.keys(S.goal.days).length} ${Object.keys(S.goal.days).length === 1 ? 'Tag' : 'Tage'} mit eigenem Ziel` : ''}</small></span>${ic('fwd')}</button>
        <button class="setrow" data-act="go" data-v="goals"><span class="ico">${ic('flag')}</span><span class="tx">Meine Ziele<small>${S.goals.length ? `${S.goals.length} ${S.goals.length === 1 ? 'Ziel' : 'Ziele'}, ${S.goals.filter((g) => g.home).length} auf der Startseite` : 'Gewicht, Körperfett, Eiweiß, Wasser und mehr'}</small></span>${ic('fwd')}</button></div>
      <div class="card"><div class="lbl">Tagesziel</div>
        <label class="check"><input type="checkbox" id="g-auto" ${S.goal.auto ? 'checked' : ''} ${p ? '' : 'disabled'}> <span>Aus dem Kalorien-Rechner übernehmen${p ? '' : ' (erst Profil eintragen)'}</span></label>
        <div id="g-manual" ${S.goal.auto ? 'hidden' : ''} style="display:flex;flex-direction:column;gap:10px">
          <div class="row2"><div class="field"><label for="g-kcal">Kalorien pro Tag</label><input id="g-kcal" inputmode="numeric" value="${S.goal.kcal}"></div><div></div></div>
          <div class="seg" id="g-mode" data-mode="${mode}"><button data-act="gmode" data-v="pct" class="${mode === 'pct' ? 'on' : ''}">Makros in %</button><button data-act="gmode" data-v="g" class="${mode === 'g' ? 'on' : ''}">Makros in Gramm</button></div>
          <div id="g-pctbox" ${mode === 'g' ? 'hidden' : ''} style="display:flex;flex-direction:column;gap:10px">
            <div class="calc" style="grid-template-columns:repeat(3,1fr)">
              ${mfield('g-prot', 'Eiweiß %', '--prot', sp.prot)}${mfield('g-carb', 'Kohlenh. %', '--carb', sp.carb)}${mfield('g-fat', 'Fett %', '--fat', sp.fat)}
            </div>
          </div>
          <div id="g-gbox" ${mode === 'g' ? '' : 'hidden'} style="display:flex;flex-direction:column;gap:10px">
            <div class="calc" style="grid-template-columns:repeat(3,1fr)">
              ${mfield('g-pg', 'Eiweiß g', '--prot', Math.round(G.prot))}${mfield('g-cg', 'Kohlenh. g', '--carb', Math.round(G.carb))}${mfield('g-fg', 'Fett g', '--fat', Math.round(G.fat))}
            </div>
          </div>
        </div>
        <div style="font-size:13px;color:var(--muted)" id="g-sum"></div>
        <button class="btn ghost" data-act="fillCarb" id="g-fill" hidden style="align-self:flex-start">Kohlenhydrate genau passend machen (optional)</button>
        <button class="btn" data-act="saveSettings">${ic('check')} Speichern</button>
      </div>
      <div class="lbl">Planen</div>
      <div class="setlist">
        <button class="setrow" data-act="go" data-v="plan"><span class="ico">${ic('pot')}</span><span class="tx">Mein Essensplan<small>${Object.values(S.plan).some((d) => Object.values(d || {}).some((l) => l?.length)) ? `An ${Object.values(S.plan).filter((d) => Object.values(d || {}).some((l) => l?.length)).length} Wochentagen geplant` : 'Mahlzeiten pro Wochentag voreinstellen'}</small></span>${ic('fwd')}</button>
        <button class="setrow" data-act="go" data-v="supps"><span class="ico">${ic('pill')}</span><span class="tx">Supplements<small>${S.supps.length ? S.supps.map((s) => esc(s.name)).join(', ') : 'Tabletten und Pulver zum Abhaken'}</small></span>${ic('fwd')}</button>
        <button class="setrow" data-act="go" data-v="watercfg"><span class="ico">${ic('drop')}</span><span class="tx">Wasser<small>Tagesziel und Glasgröße</small></span><span class="v">${S.prefs.water.on ? `${fmt(S.prefs.water.goal / 1000, 1)} l` : 'aus'}</span>${ic('fwd')}</button>
      </div>
      <div class="lbl">Verlauf</div>
      <div class="setlist"><button class="setrow" data-act="go" data-v="reviewcfg"><span class="ico">${ic('flame')}</span><span class="tx">Rückblick und Serien<small>Standard-Zeitraum, Serie auf der Startseite</small></span><span class="v">${(PERIODS.find((p) => p[0] === S.prefs.period) || PERIODS[2])[1]}</span>${ic('fwd')}</button></div>
      <div class="lbl">Verbindungen</div>
      <div class="setlist"><button class="setrow" data-act="go" data-v="health"><span class="ico heart">${ic('heart')}</span><span class="tx">Apple Health<small>Tageswerte an Health senden</small></span><span class="v">${S.prefs.health.set ? 'Verbunden' : 'Einrichten'}</span>${ic('fwd')}</button></div>
      <div class="lbl">App</div>
      <div class="card"><div class="field"><label for="theme">Design</label><select id="theme">${[['system', 'Wie das Gerät'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([v, l]) => `<option value="${v}" ${S.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label for="wstart">Woche beginnt am</label><select id="wstart"><option value="1" ${S.prefs.weekStart === 1 ? 'selected' : ''}>Montag</option><option value="0" ${S.prefs.weekStart === 0 ? 'selected' : ''}>Sonntag</option><option value="6" ${S.prefs.weekStart === 6 ? 'selected' : ''}>Samstag</option></select></div>
        <div class="field"><label for="aimode">Foto-Erkennung</label><select id="aimode"><option value="" ${!S.prefs.ai ? 'selected' : ''}>Beim ersten Foto fragen</option><option value="big" ${S.prefs.ai === 'big' ? 'selected' : ''}>Große KI (genauer, einmalig ca. 150 MB)</option><option value="small" ${S.prefs.ai === 'small' ? 'selected' : ''}>Kleine KI (ca. 15 MB)</option></select></div></div>
      <div class="lbl">Deine Daten</div>
      <div class="setlist">
        <button class="setrow" data-act="exportJson">${ic('down')}<span class="tx">Sicherung speichern<small>Alles als Datei (JSON), z. B. für ein neues Handy</small></span></button>
        <button class="setrow" data-act="exportCsv">${ic('down')}<span class="tx">Tagebuch als Tabelle<small>CSV für Excel oder Numbers</small></span></button>
        <button class="setrow" data-act="import">${ic('up')}<span class="tx">Sicherung laden<small>Ersetzt die Daten auf diesem Gerät</small></span></button>
        <button class="setrow" data-act="wipe" style="color:var(--danger)">${ic('trash')}<span class="tx">Alle Daten löschen</span></button>
      </div>
      <div class="lbl">Über die App</div>
      <div class="card" style="font-size:13.5px;color:var(--muted);gap:8px">
        <div><b style="color:var(--ink)">Datenquellen:</b> Produktdaten von <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a> (Open Database License, Inhalte CC BY-SA). Grundlebensmittel sind gerundete Richtwerte.</div>
        <div><b style="color:var(--ink)">Technik:</b> Texterkennung mit Tesseract.js (Apache 2.0), Barcode mit ZXing (Apache 2.0). Schriften Figtree und Bricolage Grotesque (OFL).</div>
        <div><b style="color:var(--ink)">Datenschutz:</b> Alle Daten liegen nur auf diesem Gerät. Fotos werden auf dem Gerät ausgewertet und nicht hochgeladen. Ins Internet gehen nur Barcode- und Suchanfragen an Open Food Facts.</div>
        <div>Das Tagesziel ist ein Richtwert und keine medizinische Beratung. Version ${APP_VERSION}.</div>
      </div>
      <button class="btn sec" data-act="checkUpdate">${ic('down')} Nach Update suchen</button>
      <div class="setlist"><button class="setrow quiet" data-act="go" data-v="tips">${ic('bulb')}<span class="tx">Tipps und Videos</span>${ic('fwd')}</button></div>
    </div>`;
  },
  mount() { updateGoalSum(); },
};

/* Kalorien und Woche */
const weekOrder = () => Array.from({ length: 7 }, (_, i) => (S.prefs.weekStart + i) % 7);
V.week = {
  html() {
    const days = S.goal.perDay ? S.goal.days || {} : {}, home = S.prefs.home;
    return `${topbar('Kalorien und Woche')}
    <div class="pad" style="padding-top:0">
      <div class="card"><div class="sec-h"><span class="lbl">Normaler Tag</span><button class="linkbtn" data-act="back">ändern</button></div>
        <div style="font-family:var(--display);font-size:24px;font-weight:800" class="num">${fmt(S.goal.kcal)} kcal</div>
        <div style="font-size:12.5px;color:var(--muted)">Kommt aus deinem Tagesziel in den Einstellungen. Unten kannst du einzelne Tage anders einstellen, leer heißt „wie normal“.</div></div>
      <div class="card" id="wdays">${weekOrder().map((d) => `<div class="wdrow"><b>${WD[d]}</b><span class="h" id="wh-${d}"></span><input id="wd-${d}" inputmode="numeric" placeholder="${S.goal.kcal}" value="${days[d] || ''}" aria-label="Kalorien am ${WD_LONG[d]}"></div>`).join('')}</div>
      <div class="sumbox" id="wsum"></div>
      <div class="card">
        <label class="togglerow"><span>Wochensumme gleich lassen<small>Mehr an einem Tag wird auf die anderen Tage verteilt</small></span><input type="checkbox" class="tg" id="w-keep" ${S.goal.keepWeek ? 'checked' : ''}></label>
        <div class="lbl" style="margin-top:6px">Auf der Startseite zeigen</div>
        <div class="seg" id="w-home" data-v="${home}"><button data-act="wHome" data-v="day" class="${home === 'day' ? 'on' : ''}">Rest heute</button><button data-act="wHome" data-v="week" class="${home === 'week' ? 'on' : ''}">Rest der Woche</button></div>
        <div style="font-size:12.5px;color:var(--muted)">Auf der Startseite kannst du jederzeit zwischen Tag und Woche umschalten. Hier legst du fest, was beim Öffnen gezeigt wird.</div>
      </div>
      <div style="font-size:12.5px;color:var(--muted)">Eiweiß bleibt an jedem Tag gleich, Kohlenhydrate und Fett passen sich an.</div>
    </div>
    <div class="foot"><button class="btn" data-act="saveWeek">${ic('check')} Speichern</button></div>`;
  },
  mount() { updateWeekSum(); },
};
function readWeek() {
  const days = {};
  for (let d = 0; d < 7; d++) { const raw = $('#wd-' + d)?.value.trim(); if (raw) days[d] = Math.round(num(raw)); }
  return days;
}
function updateWeekSum() {
  const box = $('#wsum');
  if (!box) return;
  const base = S.goal.kcal, days = readWeek(), keep = $('#w-keep').checked;
  const set = Object.entries(days).filter(([, v]) => v > 0), extra = set.reduce((a, [, v]) => a + v - base, 0), free = 7 - set.length;
  const other = keep && free > 0 && extra ? base - extra / free : base;
  let sum = 0;
  for (let d = 0; d < 7; d++) {
    const v = days[d] > 0 ? days[d] : other, h = $('#wh-' + d);
    sum += v;
    if (!h) continue;
    if (days[d] > 0) { const df = days[d] - base; h.textContent = df ? (df > 0 ? '+' : '−') + fmt(Math.abs(df)) : 'wie normal'; h.className = 'h' + (df > 0 ? ' plus' : ''); }
    else { h.textContent = other !== base ? '≈ ' + fmt(other) : ''; h.className = 'h'; }
  }
  const diff = sum - base * 7;
  box.innerHTML = `<span>Wochenziel</span><b>${fmt(sum)} kcal</b><span>${diff ? `${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff))} gegenüber 7 × ${fmt(base)}` : `gleich wie 7 × ${fmt(base)}`}</span>`;
}

/* Meine Ziele */
V.goals = {
  load: () => Promise.all([loadDay(S.day), loadWeek(S.day), loadWeights()]),
  html() {
    return `${topbar('Meine Ziele')}
    <div class="pad" style="padding-top:0">
      ${S.goals.length ? `<div class="list">${S.goals.map((g) => swipeRow('goal', g.id, `<div class="goalitem">${goalRow(g, 'goalEdit')}<label class="togglerow"><span>Auf Startseite</span><input type="checkbox" class="tg" data-ghome="${esc(g.id)}" ${g.home ? 'checked' : ''}></label></div>`)).join('')}</div>`
        : `<div class="card"><div class="empty" style="padding:0">Noch keine Ziele. Leg z. B. ein Zielgewicht oder ein Eiweißziel pro Tag an. Mit „Auf Startseite“ siehst du den Fortschritt jeden Tag.</div></div>`}
      <button class="btn sec" data-act="goalAdd">${ic('plus')} Ziel hinzufügen</button>
      <p class="fine">Bei Messwerten wie Gewicht zählt der Weg vom Startwert zum Ziel, bei Tageszielen wie Eiweiß der heutige Tag.</p>
    </div>`;
  },
};
V.goal = {
  load: () => Promise.all([loadDay(today()), loadWeek(today()), loadWeights()]),
  html(c) {
    const g = c.id ? S.goals.find((x) => x.id === c.id) : null;
    if (c.id && !g) return `${topbar('Ziel')}<div class="pad"><p>Dieses Ziel gibt es nicht mehr.</p></div>`;
    const type = g?.type || c.type, T = GOAL_TYPES[type], s = series(type);
    const now = s.length ? s[s.length - 1].v : type === 'weight' ? S.profile?.weight : null;
    const defTarget = { weight: S.profile?.gw, fat: S.profile?.bft, kcal: goalFor(today()).kcal, kcalw: weekDays(today()).reduce((a, d) => a + goalFor(d).kcal, 0), prot: Math.round(goalMacros().prot), water: 2 }[type];
    const v = (x) => (x != null && x !== '' && !isNaN(x) ? inVal(x) : '');
    const recent = s.slice(-5).reverse();
    return `${topbar(g ? T.l : 'Neues Ziel: ' + T.l)}
    <div class="pad" style="padding-top:0">
      ${g ? `<div class="card">${goalRow(g, 'none')}</div>` : ''}
      ${g && type === 'water' ? `<div class="card"><div class="lbl">Heute getrunken</div><div style="font-family:var(--display);font-size:26px;font-weight:800" class="num">${fmt(water(today()), 2)} l</div>
        <div class="row3"><button class="btn sec" data-act="water" data-v="0.25">+ 0,25 l</button><button class="btn sec" data-act="water" data-v="0.5">+ 0,5 l</button><button class="btn sec" data-act="water" data-v="-0.25">− 0,25 l</button></div></div>` : ''}
      ${g && T.m ? `<div class="card"><div class="lbl">Neuen Wert eintragen</div>
        <div class="row2"><div class="field"><label for="gm-v">${T.l} (${T.u})</label><input id="gm-v" inputmode="decimal" value="${v(now)}"></div><div class="field"><label for="gm-d">Datum</label><input id="gm-d" type="date" value="${today()}"></div></div>
        <button class="btn sec" data-act="goalMeasure">${ic('check')} Wert speichern</button>
        ${recent.length ? `<div style="font-size:13px;color:var(--muted)">${recent.map((x) => `${esc(dateLong(x.date))}: <b style="color:var(--ink)">${fmt(x.v, T.d)} ${T.u}</b>`).join('<br>')}</div>` : ''}</div>` : ''}
      <div class="card">
        ${T.m ? `<div class="row2"><div class="field"><label for="g-start">Startwert (${T.u})</label><input id="g-start" inputmode="decimal" value="${v(g?.start ?? now)}"></div><div class="field"><label for="g-target">Zielwert (${T.u})</label><input id="g-target" inputmode="decimal" value="${v(g?.target ?? defTarget)}"></div></div>
          <div class="field"><label for="g-until">Zieldatum (optional)</label><input id="g-until" type="date" value="${g?.until || ''}"></div>`
          : `<div class="field"><label for="g-target">Ziel (${T.u}${T.week ? ' pro Woche' : ' pro Tag'})</label><input id="g-target" inputmode="decimal" value="${v(g?.target ?? defTarget)}"></div>
          <div style="font-size:12.5px;color:var(--muted)">${type === 'water' ? 'Getrunkenes trägst du hier im Ziel ein, über die Startseite kommst du schnell hin.' : 'Zählt automatisch aus deinem Tagebuch.'}</div>`}
        <label class="togglerow"><span>Auf der Startseite zeigen</span><input type="checkbox" class="tg" id="g-home" ${g ? (g.home ? 'checked' : '') : 'checked'}></label>
      </div>
      ${g ? `<button class="btn danger" data-act="goalDel">${ic('trash')} Ziel löschen</button>` : ''}
    </div>
    <div class="foot"><button class="btn" data-act="goalSave">${ic('check')} ${g ? 'Speichern' : 'Ziel anlegen'}</button></div>`;
  },
};

/* Supplements */
V.supps = {
  html() {
    return `${topbar('Supplements')}
    <div class="pad" style="padding-top:0">
      ${S.supps.length ? `<div class="list">${S.supps.map((s) => swipeRow('supp', s.id, `<button class="item" data-act="suppEdit" data-id="${esc(s.id)}"><span class="thumb" style="background:var(--accent-soft);color:var(--accent)">${ic('pill')}</span><span class="tx"><span class="n">${esc(s.name)}</span><span class="s">${fmtA(s.amt)} ${esc(s.unit)} pro ${esc(s.form)} · ${s.count} ${s.count === 1 ? 'Stück' : 'Stück'} pro Tag${s.kcal ? ` · ${fmt(s.kcal)} kcal` : ''}</span></span>${ic('fwd')}</button>`)).join('')}</div>`
        : `<div class="card"><div class="empty" style="padding:0">Noch keine Supplements. Leg z. B. „Calcium, 1000 mg pro Tablette, 2 Stück“ an. Auf der Startseite hakst du sie dann jeden Tag ab.</div></div>`}
      <button class="btn sec" data-act="suppEdit">${ic('plus')} Supplement hinzufügen</button>
      <p class="fine">Abgehakte Supplements zählen in der Nährwert-Ansicht zum Tageswert, z. B. Calcium. Kalorien zählen nur, wenn du welche einträgst (z. B. bei Eiweißpulver).</p>
    </div>`;
  },
};
V.supp = {
  html(c) {
    const s = c.id ? S.supps.find((x) => x.id === c.id) : null;
    const opt = (list, v) => list.map((x) => `<option ${x === v ? 'selected' : ''}>${x}</option>`).join('');
    return `${topbar(s ? 'Supplement bearbeiten' : 'Neues Supplement')}
    <div class="pad" style="padding-top:0">
      <div class="card">
        <div class="field"><label for="s-name">Name</label><input id="s-name" value="${esc(s?.name || '')}" placeholder="z. B. Calcium"></div>
        <div class="row2"><div class="field"><label for="s-amt">Menge pro Einheit</label><input id="s-amt" inputmode="decimal" value="${s ? inVal(s.amt) : ''}" placeholder="z. B. 1000"></div><div class="field"><label for="s-unit">Einheit</label><select id="s-unit">${opt(SUPP_UNITS, s?.unit || 'mg')}</select></div></div>
        <div class="row2"><div class="field"><label for="s-form">Form</label><select id="s-form">${opt(SUPP_FORMS, s?.form || 'Tablette')}</select></div><div class="field"><label for="s-count">Anzahl pro Tag</label><input id="s-count" inputmode="numeric" value="${s?.count || 1}"></div></div>
        <div class="field"><label for="s-nutr">Wirkstoff (zählt zum Tageswert)</label><select id="s-nutr"><option value="">anderer oder keiner</option>${MICRO.map((m) => `<option value="${m.k}" ${s?.nutr === m.k ? 'selected' : ''}>${m.l}</option>`).join('')}</select></div>
      </div>
      <div class="card"><div class="lbl">Optional, z. B. bei Eiweißpulver</div>
        <div class="row2"><div class="field"><label for="s-kcal">kcal pro Einheit</label><input id="s-kcal" inputmode="decimal" value="${s?.kcal ? inVal(s.kcal) : ''}" placeholder="0"></div><div class="field"><label for="s-prot">Eiweiß g pro Einheit</label><input id="s-prot" inputmode="decimal" value="${s?.prot ? inVal(s.prot) : ''}" placeholder="0"></div></div>
      </div>
      ${s ? `<button class="btn danger" data-act="suppDel">${ic('trash')} Supplement löschen</button>` : ''}
    </div>
    <div class="foot"><button class="btn" data-act="suppSave">${ic('check')} Speichern</button></div>`;
  },
};

/* Mein Essensplan */
V.plan = {
  html(c) {
    const wd = c.wd ?? parseD(today()).getDay(); c.wd = wd;
    const day = S.plan[wd] || {}, sum = Object.values(day).reduce((a, l) => a + planKcal(l || []), 0);
    const has = (d) => Object.values(S.plan[d] || {}).some((l) => l?.length);
    const goal = goalFor(addDays(today(), (wd - parseD(today()).getDay() + 7) % 7)).kcal;
    return `${topbar('Mein Essensplan')}
    <div class="pad" style="padding-top:0">
      <div class="wdchips">${weekOrder().map((d) => `<button class="${d === wd ? 'on' : ''}" data-act="planDay" data-d="${d}" aria-label="${WD_LONG[d]}">${WD[d]}${has(d) ? '<i></i>' : ''}</button>`).join('')}</div>
      ${MEALS.map((m, i) => { const l = day[i] || []; return `<div class="card meal">
        <div class="meal-h"><div><h3 style="display:inline">${m}</h3><span class="k num">${l.length ? fmt(planKcal(l)) + ' kcal' : ''}</span></div><button class="addmini" data-act="planAdd" data-meal="${i}" aria-label="Zu ${m} hinzufügen">${ic('plus')}</button></div>
        ${l.length ? l.map((p) => swipeRow('plan', `${wd}|${i}|${p.pid}`, `<button class="item" data-act="planEdit" data-meal="${i}" data-pid="${esc(p.pid)}">${thumb(p)}<span class="tx"><span class="n">${esc(p.name)}</span><span class="s num">${fmt(p.g)} g</span></span><span class="kc">${fmt(nutOf(p.n, p.g).kcal)}</span></button>`)).join('') : `<div class="empty">Nichts geplant.</div>`}</div>`; }).join('')}
      <div class="sumbox"><span>Plan ${WD_LONG[wd]}</span><b>${fmt(sum)} von ${fmt(goal)} kcal</b></div>
      <div class="row2"><button class="btn sec" data-act="planCopy">${ic('copy')} Tag kopieren</button><button class="btn sec" data-act="planWork">Auf alle Werktage</button></div>
      <div class="card"><label class="togglerow"><span>Im Plus-Menü nur den Plan zeigen<small>Die Suche bleibt über „Anderes suchen“ erreichbar</small></span><input type="checkbox" class="tg" id="p-only" ${S.prefs.planOnly ? 'checked' : ''}></label></div>
      <p class="fine">Auf der Startseite stehen geplante Lebensmittel gestrichelt in der Mahlzeit. Mit Plus trägst du sie ein.</p>
    </div>`;
  },
};

/* Apple Health über einen iPhone-Kurzbefehl */
const isIPhone = () => /iPhone|iPod/.test(navigator.userAgent) || (/iPad|Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const SHORTCUT = 'KalorienTracker Health';
const HEALTH_KEYS = [['kcal', 'kcal', 'Nahrungsenergie'], ['eiweiss', 'prot', 'Protein'], ['kohlenhydrate', 'carb', 'Kohlenhydrate'], ['fett', 'fat', 'Fett gesamt']];
const HEALTH_MICRO = { vitc: 'vitaminC', vitd: 'vitaminD', ca: 'calcium', mg: 'magnesium', fe: 'eisen', zn: 'zink', k: 'kalium', vitb12: 'vitaminB12' };
V.health = {
  load: () => Promise.all([loadDay(today()), loadWeights()]),
  html() {
    const H = S.prefs.health, ios = isIPhone();
    const last = H.last ? `${dayLabel(dstr(new Date(H.last)))} ${new Date(H.last).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : 'noch nie';
    const box = (k, l) => `<label class="check"><input type="checkbox" data-hsend="${k}" ${H.send[k] ? 'checked' : ''}> <span>${l}</span></label>`;
    return `${topbar('Apple Health')}
    <div class="pad" style="padding-top:0">
      <div class="heartbig">${ic('heart')}</div>
      ${!ios ? `<div class="card"><b>Nur auf dem iPhone verfügbar</b><div style="font-size:14px;color:var(--muted)">Apple Health gibt es nur auf dem iPhone. Hier kannst du dein Tagebuch als Tabelle speichern und in andere Apps übernehmen.</div><button class="btn sec" data-act="exportCsv">${ic('down')} Tagebuch als Tabelle (CSV)</button></div>
        <button class="btn ghost" data-act="healthShow">Anleitung trotzdem ansehen</button>` : ''}
      ${ios || S.healthShow ? (H.set ? `<div class="card">
          <div class="status"><i></i> Verbunden</div>
          <div style="font-size:13px;color:var(--muted)">Zuletzt gesendet: ${last}</div>
          <div class="lbl" style="margin-top:4px">Was gesendet wird</div>
          ${box('kcal', 'Kalorien')}${box('macros', 'Eiweiß, Kohlenhydrate, Fett')}${box('supps', 'Calcium und andere Vitamine und Mineralstoffe (mit Supplements)')}${box('weight', 'Gewicht (wenn heute eingetragen)')}
          <button class="btn" data-act="healthSend">${ic('heart')} Jetzt an Health senden</button>
          <div style="font-size:12.5px;color:var(--muted)">Gesendet werden die Werte von heute. Schick sie am besten abends, wenn alles eingetragen ist. Health speichert jeden Sendevorgang, also bitte nur einmal am Tag senden.</div></div>
        <details class="card raw"><summary>Jeden Abend daran denken</summary><div style="font-size:13.5px;color:var(--muted);display:flex;flex-direction:column;gap:6px;margin-top:8px">
          <div>In der App „Kurzbefehle“ unter „Automation“ eine neue Automation „Tageszeit“ anlegen, z. B. 21:00 Uhr, mit der Aktion „Mitteilung anzeigen: Werte an Health senden“. Dann tippst du abends nur noch hier auf „Jetzt an Health senden“.</div></div></details>
        <button class="btn ghost" data-act="healthReset">Kurzbefehl neu einrichten</button>`
      : `<div class="card"><h3 style="margin:0">So verbindest du die App</h3>
          <div style="font-size:14px;color:var(--muted)">Eine Web-App darf nicht direkt in Health schreiben. Ein Kurzbefehl auf deinem iPhone übernimmt das. Du legst ihn einmal an:</div>
          <ol class="steps">
            <li>Öffne die App <b>Kurzbefehle</b> und tippe oben auf <b>+</b>.</li>
            <li>Füge die Aktion <b>Wörterbuch abrufen</b> hinzu und wähle als Eingabe <b>Kurzbefehleingabe</b>.</li>
            <li>Füge <b>Wörterbuchwert abrufen</b> hinzu, Schlüssel <b>kcal</b>. Danach <b>Health-Sample protokollieren</b>: Typ <b>Nahrungsenergie</b>, Wert = Wörterbuchwert.</li>
            <li>Wiederhole Schritt 3 für <b>eiweiss</b> (Protein), <b>kohlenhydrate</b> (Kohlenhydrate) und <b>fett</b> (Fett gesamt). Wer mag, auch für <b>calcium</b>, <b>magnesium</b>, <b>vitaminD</b> oder <b>gewicht</b>.</li>
            <li>Nenne den Kurzbefehl genau <b>${SHORTCUT}</b>. Beim ersten Start fragt das iPhone, ob Health-Daten geschrieben werden dürfen: erlauben.</li>
          </ol>
          <button class="btn" data-act="healthSet">${ic('check')} Kurzbefehl ist angelegt</button></div>
        <p class="fine">Das offizielle Apple-Health-Logo dürfen nur Store-Apps zeigen, deshalb hier das rote Herz. Es werden nur Werte an deinen eigenen Kurzbefehl übergeben, nichts geht ins Internet.</p>`) : ''}
    </div>`;
  },
};
function healthPayload(d) {
  const H = S.prefs.health, t = dayTotals(d), out = { datum: d };
  if (H.send.kcal) out.kcal = Math.round(t.kcal);
  if (H.send.macros) { out.eiweiss = Math.round(t.prot * 10) / 10; out.kohlenhydrate = Math.round(t.carb * 10) / 10; out.fett = Math.round(t.fat * 10) / 10; }
  if (H.send.supps) {
    const { T, has } = dayNutrients(S.days.get(d) || []), sup = suppTotals(d);
    for (const [k, name] of Object.entries(HEALTH_MICRO)) { const v = (has[k] ? T[k] : 0) + (sup.micro[k] || 0); if (v > 0) out[name] = Math.round(v * 100) / 100; }
  }
  if (H.send.weight) { const w = (weightsCache || []).find((x) => x.date === d); if (w) out.gewicht = w.kg; }
  return out;
}
const runShortcut = (data) => { location.href = `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT)}&input=text&text=${encodeURIComponent(JSON.stringify(data))}`; };

/* Tipps und Videos: Links zur YouTube-Suche */
const TIPS = {
  lose: ['Abnehmen', ['Wie nehme ich gesund ab', 'Kaloriendefizit einfach erklärt', 'Sättigende Rezepte mit wenig Kalorien', 'Abnehmen ohne Hunger Tipps', 'Heißhunger vermeiden']],
  gain: ['Zunehmen und Muskelaufbau', ['Gesund zunehmen Tipps', 'Muskelaufbau Ernährung für Anfänger', 'Kalorienreiche gesunde Snacks', 'Wie viel Eiweiß brauche ich']],
  cook: ['Kochen und Planen', ['Meal Prep für die Woche', 'Eiweißreiche Rezepte einfach', 'Schnelle gesunde Abendessen', 'Gesund einkaufen Tipps']],
  know: ['Wissen', ['Nährwerttabelle richtig lesen', 'Nutri-Score erklärt', 'Gesunde Ernährung Grundlagen', 'Wie viel Wasser am Tag trinken']],
};
V.tips = {
  html() {
    const g = S.profile?.goal || 'keep', first = ['lose', 'cut', 'slow'].includes(g) ? ['lose', 'cook', 'know', 'gain'] : ['muscle', 'gain'].includes(g) ? ['gain', 'cook', 'know', 'lose'] : ['cook', 'know', 'lose', 'gain'];
    return `${topbar('Tipps und Videos')}
    <div class="pad" style="padding-top:0">
      ${first.map((k) => `<div class="lbl">${TIPS[k][0]}</div><div class="setlist tipgroup">${TIPS[k][1].map((q) => `<a class="setrow" href="https://www.youtube.com/results?search_query=${encodeURIComponent(q)}" target="_blank" rel="noopener">${ic('search')}<span class="tx">${esc(q)}</span>${ic('ext')}</a>`).join('')}</div>`).join('')}
      <p class="fine">Öffnet die YouTube-Suche zum Begriff. Die App sendet dabei keine Daten mit.</p>
    </div>`;
  },
};

/* ---------- Rendern ---------- */
let renderSeq = 0;
async function render(scrollTop) {
  const c = cur();
  const my = ++renderSeq;
  if (c.v !== 'scanner') stopScanner();
  if (c.v !== 'cook') keepAwake(false);
  closeSheet();
  const view = typeof V[c.v] === 'function' ? { html: V[c.v] } : V[c.v];
  try { if (view.load) await view.load(c); } catch (e) { console.error(e); }
  if (my !== renderSeq) return;
  screen.innerHTML = view.html(c);
  const tabs = ['heute', 'add', 'check', 'verlauf', 'settings'].includes(c.v) && !(c.v === 'add' && S.pickFor);
  $('#tabbar').hidden = c.v === 'welcome' || (!tabs && !matchMedia('(min-width:900px)').matches);
  screen.classList.toggle('nofoot', !tabs);
  screen.classList.toggle('wide', !!view.wide);
  const rootV = S.stack[0].v;
  $$('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === (S.stack.length === 1 ? rootV : c.v)));
  if (scrollTop) window.scrollTo(0, 0);
  view.mount?.(c);
  if (c.v === 'welcome') updateSuggestion();
}

/* Hochformat sperren, wo der Browser es erlaubt (Android, installierte App) */
const lockPortrait = () => { try { window.screen.orientation?.lock?.('portrait').catch(() => {}); } catch { /* geht nicht überall */ } };
lockPortrait(); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') lockPortrait(); });

/* Zoomen abschalten (Zwei-Finger- und Doppeltipp-Zoom, auch auf dem iPhone) */
['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || (e.scale && e.scale !== 1)) e.preventDefault(); }, { passive: false });

/* ---------- Aktionen ---------- */
// Karten, die wie Knöpfe funktionieren, auch per Tastatur öffnen
document.addEventListener('keydown', (ev) => {
  const t = ev.target;
  if ((ev.key === 'Enter' || ev.key === ' ') && t.getAttribute?.('role') === 'button' && t.dataset.act) { ev.preventDefault(); t.click(); }
  if (ev.key === 'Enter' && t.id === 'qk') { ev.preventDefault(); $('[data-act="quickIn"]')?.click(); }
});
document.addEventListener('click', async (ev) => {
  const tab = ev.target.closest('[data-tab]');
  if (tab) {
    const t = tab.dataset.tab;
    if (t === 'add') { S.pickFor = null; S.q = ''; S.showSearch = false; S.addMeal = S.day === today() ? defaultMeal() : S.addMeal; }
    if (t === 'verlauf') { S.vtab = 'woche'; S.period = S.prefs.period; }
    root(t);
    return;
  }
  const a = ev.target.closest('[data-act]');
  if (!a) return;
  if (a.classList.contains('scrim') && ev.target.closest('[data-stop]')) return;
  const c = cur(), act = a.dataset.act;
  switch (act) {
    case 'back': back(); break;
    case 'closeSheet': closeSheet(); break;
    case 'go': go(a.dataset.v); break;
    case 'none': break;
    case 'swipeDel': { const row = a.closest('.swipe'); if (row) swipeDelete(row); break; }
    case 'ring': S.ringMode = a.dataset.v; renderKeep(); break;
    case 'qWater': {
      const ml = +a.dataset.ml, v = Math.max(0, water(S.day) + ml / 1000);
      await addMeasure('water', S.day, v); refreshResults();
      toast(ml > 0 ? `${ml} ml Wasser eingetragen · heute ${fmt(v, 2)} l` : `${-ml} ml zurückgenommen`);
      break;
    }
    case 'waterMinus': if (water(S.day) > 0) addWater(-S.prefs.water.glass); break;
    case 'vtab': {
      const fromOutside = S.stack[0].v !== 'verlauf';
      S.vtab = a.dataset.v;
      if (a.dataset.p) S.period = a.dataset.p; else if (S.vtab === 'rueck' && (fromOutside || !S.period)) S.period = S.prefs.period;
      if (fromOutside || S.stack.length > 1) root('verlauf'); else render(true);
      break;
    }
    case 'period': S.period = a.dataset.v; renderKeep(); break;
    case 'defPeriod': S.prefs.period = a.dataset.v; S.period = a.dataset.v; await setSetting('prefs', S.prefs); renderKeep(); break;
    case 'streakKind': S.prefs.streak = a.dataset.v; await setSetting('prefs', S.prefs); renderKeep(); break;

    /* Supplements */
    case 'suppOpen': S.suppOpen = !S.suppOpen; renderKeep(); break;
    case 'suppToggle': case 'suppInc': case 'suppDec': {
      const id = a.dataset.id, s = S.supps.find((x) => x.id === id), log = { ...suppTaken(S.day) }, pend = (S.suppPend ||= {}), k = S.day + id;
      if (!s) break;
      if (act === 'suppToggle') { if (log[id]) { pend[k] = log[id]; delete log[id]; } else log[id] = pend[k] || s.count || 1; }
      else { const d = act === 'suppInc' ? 1 : -1; if (log[id]) log[id] = Math.max(1, log[id] + d); else pend[k] = Math.max(1, (pend[k] || s.count || 1) + d); }
      if (Object.keys(log).length) S.supplog[S.day] = log; else delete S.supplog[S.day];
      await setSetting('supplog', S.supplog);
      renderKeep();
      break;
    }
    case 'suppEdit': go('supp', { id: a.dataset.id }); break;
    case 'suppSave': {
      const name = $('#s-name').value.trim(), amt = num($('#s-amt').value), count = Math.round(num($('#s-count').value));
      if (!name) { $('#s-name').focus(); return toast('Bitte einen Namen eintragen.', true); }
      if (!(amt > 0)) { $('#s-amt').focus(); return toast('Bitte die Menge pro Einheit eintragen, z. B. 1000.', true); }
      if (!(count >= 1 && count <= 30)) { $('#s-count').focus(); return toast('Bitte eine Anzahl pro Tag zwischen 1 und 30 eintragen.', true); }
      const s = { id: c.id || uid(), name, amt, unit: $('#s-unit').value, form: $('#s-form').value, count, nutr: $('#s-nutr').value, kcal: num0($('#s-kcal').value), prot: num0($('#s-prot').value) };
      if (s.unit === 'IE' && s.nutr && !IE[s.nutr]) toast('IE lässt sich nur bei Vitamin A, D und E umrechnen. Für den Tageswert bitte mg oder µg wählen.', true);
      const i = S.supps.findIndex((x) => x.id === s.id);
      if (i >= 0) S.supps[i] = s; else S.supps.push(s);
      await setSetting('supps', S.supps);
      back(); if (!(s.unit === 'IE' && s.nutr && !IE[s.nutr])) toast(`${name} gespeichert`);
      break;
    }
    case 'suppDel': {
      const s = S.supps.find((x) => x.id === c.id);
      if (!s || !(await ask(`${s.name} löschen? Bereits abgehakte Tage bleiben gezählt, solange es das Supplement gibt.`, 'Löschen'))) return;
      S.supps = S.supps.filter((x) => x !== s); await setSetting('supps', S.supps); back(); toast('Gelöscht');
      break;
    }

    /* Ziele */
    case 'goalOpen': case 'goalEdit': go('goal', { id: a.dataset.id }); break;
    case 'goalAdd': sheet(`<h3>Welches Ziel?</h3><div class="typelist">${GOAL_ORDER.map((t) => { const ex = S.goals.find((g) => g.type === t); return `<button data-act="${ex ? 'goalEdit' : 'goalNew'}" data-t="${t}" ${ex ? `data-id="${esc(ex.id)}"` : ''}><span>${GOAL_TYPES[t].l}</span><small>${ex ? 'schon angelegt' : GOAL_TYPES[t].u}</small></button>`; }).join('')}</div>`); break;
    case 'goalNew': closeSheet(); go('goal', { type: a.dataset.t }); break;
    case 'goalSave': {
      const g0 = c.id ? S.goals.find((x) => x.id === c.id) : null, type = g0?.type || c.type, T = GOAL_TYPES[type];
      const target = num($('#g-target').value), start = T.m ? num($('#g-start').value) : 0;
      if (T.m) {
        for (const [v, el] of [[start, '#g-start'], [target, '#g-target']]) if (!(v >= T.min && v <= T.max)) { $(el).focus(); return toast(`Bitte einen Wert zwischen ${T.min} und ${T.max} ${T.u} eintragen.`, true); }
        if (start === target) { $('#g-target').focus(); return toast('Start und Ziel sind gleich. Bitte einen anderen Zielwert eintragen.', true); }
      } else if (!(target > 0)) { $('#g-target').focus(); return toast('Bitte einen Zielwert eintragen.', true); }
      const g = { ...(g0 || { id: uid(), type }), start, target, until: $('#g-until')?.value || '', home: $('#g-home').checked };
      if (g0) Object.assign(g0, g); else S.goals.push(g);
      if (!g0 && T.m && !series(type).length) await addMeasure(type, today(), start);
      await setSetting('goals', S.goals);
      back(); toast(g0 ? 'Ziel gespeichert' : `Ziel „${T.l}“ angelegt`);
      break;
    }
    case 'goalMeasure': {
      const g = S.goals.find((x) => x.id === c.id), T = GOAL_TYPES[g.type], v = num($('#gm-v').value), date = $('#gm-d').value || today();
      if (!(v >= T.min && v <= T.max)) { $('#gm-v').focus(); return toast(`Bitte einen Wert zwischen ${T.min} und ${T.max} ${T.u} eintragen.`, true); }
      await addMeasure(g.type, date, v);
      renderKeep(); toast(`${T.l}: ${fmt(v, T.d)} ${T.u} gespeichert`);
      break;
    }
    case 'water': await addMeasure('water', today(), water(today()) + +a.dataset.v); renderKeep(); break;
    case 'goalDel': {
      const g = S.goals.find((x) => x.id === c.id);
      if (!g || !(await ask(`Ziel „${GOAL_TYPES[g.type].l}“ löschen? Deine Messwerte bleiben erhalten.`, 'Löschen'))) return;
      S.goals = S.goals.filter((x) => x !== g); await setSetting('goals', S.goals); back(); toast('Ziel gelöscht');
      break;
    }

    /* Kalorien und Woche */
    case 'wHome': { const box = $('#w-home'); box.dataset.v = a.dataset.v; $$('#w-home button').forEach((b) => b.classList.toggle('on', b === a)); break; }
    case 'saveWeek': {
      const days = readWeek();
      for (const [d, k] of Object.entries(days)) if (!(k >= 1200 && k <= 8000)) { $('#wd-' + d).focus(); return toast(`${WD_LONG[d]}: bitte zwischen 1.200 und 8.000 kcal eintragen.`, true); }
      S.goal = { ...S.goal, days, perDay: Object.keys(days).length > 0, keepWeek: $('#w-keep').checked };
      S.prefs.home = $('#w-home').dataset.v; S.ringMode = null;
      await setSetting('goal', S.goal); await setSetting('prefs', S.prefs);
      back(); toast(`Gespeichert. Wochenziel ${fmt(weekDays(today()).reduce((a2, d) => a2 + goalFor(d).kcal, 0))} kcal`);
      break;
    }

    /* Essensplan */
    case 'planDay': c.wd = +a.dataset.d; render(); break;
    case 'planAdd': S.pickFor = 'plan'; S.planTarget = { wd: c.wd, meal: +a.dataset.meal }; S.q = ''; go('add'); break;
    case 'planSave': {
      const g = readAmt();
      if (!(g > 0)) { $('#amt').focus(); return toast('Bitte eine Menge eintragen.', true); }
      let f = getFood(c.id);
      if (f.src === 'OFF' && !S.foods.has(f.id)) f = await saveFood(f);
      const { wd, meal } = S.planTarget, day = (S.plan[wd] ||= {});
      (day[meal] ||= []).push(planItem(f, g));
      await setSetting('plan', S.plan);
      S.pickFor = null; S.q = '';
      popTo('plan'); toast(`${f.name} im Plan für ${WD_LONG[wd]}`);
      break;
    }
    case 'planEdit': {
      const p = (S.plan[c.wd]?.[+a.dataset.meal] || []).find((x) => x.pid === a.dataset.pid);
      if (!p) break;
      const s = sheet(`<h3>${esc(p.name)}</h3><div class="field"><label for="pe-g">Menge in Gramm</label><input id="pe-g" inputmode="decimal" value="${inVal(p.g)}"></div>${(p.portions || []).length ? `<div class="chips">${p.portions.map((x) => `<button class="chip" data-act="peUnit" data-g="${x.g}">${esc(x.l)} · ${fmt(x.g)} g</button>`).join('')}</div>` : ''}<button class="btn" data-act="planEditOk" data-meal="${a.dataset.meal}" data-pid="${esc(p.pid)}">Speichern</button>`);
      s.querySelector('#pe-g').select();
      break;
    }
    case 'peUnit': $('#pe-g').value = a.dataset.g; break;
    case 'planEditOk': {
      const p = (S.plan[c.wd]?.[+a.dataset.meal] || []).find((x) => x.pid === a.dataset.pid), g = num($('#pe-g').value);
      if (!(g > 0)) return toast('Bitte eine Menge eintragen.', true);
      p.g = g; await setSetting('plan', S.plan); closeSheet(); renderKeep();
      break;
    }
    case 'planCopy': {
      const src = weekOrder().filter((d) => d !== c.wd && Object.values(S.plan[d] || {}).some((l) => l?.length));
      sheet(`<h3>Welchen Tag übernehmen?</h3><p>Der Plan vom ${WD_LONG[c.wd]} wird dabei ersetzt.</p>${src.length ? `<div class="typelist">${src.map((d) => `<button data-act="planCopyFrom" data-d="${d}"><span>${WD_LONG[d]}</span><small>${fmt(Object.values(S.plan[d]).reduce((x, l) => x + planKcal(l || []), 0))} kcal</small></button>`).join('')}</div>` : `<p class="fine" style="text-align:left">Noch kein anderer Tag geplant.</p>`}`);
      break;
    }
    case 'planCopyFrom': {
      const d = +a.dataset.d;
      S.plan[c.wd] = Object.fromEntries(Object.entries(S.plan[d] || {}).map(([m, l]) => [m, (l || []).map((p) => ({ ...structuredClone(p), pid: uid() }))]));
      await setSetting('plan', S.plan); closeSheet(); render(); toast(`${WD_LONG[d]} übernommen`);
      break;
    }
    case 'planWork': {
      if (!Object.values(S.plan[c.wd] || {}).some((l) => l?.length)) return toast(`Für ${WD_LONG[c.wd]} ist noch nichts geplant.`, true);
      if (!(await ask(`Plan vom ${WD_LONG[c.wd]} auf Montag bis Freitag übernehmen? Pläne dieser Tage werden ersetzt.`, 'Übernehmen', false))) return;
      for (const d of [1, 2, 3, 4, 5]) if (d !== c.wd) S.plan[d] = Object.fromEntries(Object.entries(S.plan[c.wd]).map(([m, l]) => [m, (l || []).map((p) => ({ ...structuredClone(p), pid: uid() }))]));
      await setSetting('plan', S.plan); render(); toast('Auf alle Werktage übernommen');
      break;
    }
    case 'planAll': case 'planOne': {
      const meal = +a.dataset.meal, list = await loadDay(S.day);
      let items = planFor(S.day, meal).filter((p) => !list.some((e) => e.meal === meal && e.foodId === p.foodId));
      if (act === 'planOne') items = items.filter((p) => p.pid === a.dataset.pid);
      if (!items.length) return toast('Schon alles eingetragen.');
      await logPlanned(items, meal);
      const k = planKcal(items);
      if (c.v === 'add') root('heute'); else renderKeep();
      toast(items.length === 1 ? `${items[0].name} eingetragen` : `${items.length} Teile mit ${fmt(k)} kcal zu ${MEALS[meal]} eingetragen`);
      break;
    }
    case 'planPick': { const p = planFor(S.day, S.addMeal).find((x) => x.pid === a.dataset.pid); if (p) go('product', { id: planFood(p).id, g: p.g }); break; }
    case 'showSearch': S.showSearch = true; render(); setTimeout(() => $('#q')?.focus(), 50); break;

    /* Apple Health */
    case 'healthShow': S.healthShow = true; render(); break;
    case 'healthSet': S.prefs.health.set = true; await setSetting('prefs', S.prefs); render(); toast('Eingerichtet. Jetzt kannst du Werte senden.'); break;
    case 'healthReset': S.prefs.health.set = false; await setSetting('prefs', S.prefs); render(); break;
    case 'healthSend': {
      await loadDay(today());
      const data = healthPayload(today());
      if (!(data.kcal > 0) && !data.gewicht && Object.keys(data).length <= 2) return toast('Heute ist noch nichts eingetragen.', true);
      S.prefs.health.last = Date.now(); await setSetting('prefs', S.prefs);
      runShortcut(data);
      setTimeout(() => { if (cur().v === 'health') render(); }, 800);
      break;
    }
    case 'checkScan': go('scanner', { mode: 'check' }); break;
    case 'checkPhoto': S.ingKind = a.dataset.kind || c.data?.kind || c.kind; $('#ingInput').value = ''; $('#ingInput').click(); break;
    case 'checkText': go('checktext', { kind: a.dataset.kind || c.data?.kind || 'cos', code: c.code }); break;
    case 'checkEdit': go('checktext', { kind: c.data.kind, text: c.data.text, name: c.data.name, hid: c.hid }); break;
    case 'ctKind': c.kind = a.dataset.v; c.text = $('#ct-text').value; c.name = $('#ct-name').value; render(); break;
    case 'checkEval': {
      const text = $('#ct-text').value.trim();
      if (!text) { $('#ct-text').focus(); return toast('Bitte die Zutatenliste eintragen.', true); }
      const kind = c.kind || 'cos', name = $('#ct-name').value.trim();
      const data = { kind, src: c.fromPhoto ? 'Foto' : 'Eigene Eingabe', code: c.code || null, name: name || (kind === 'cos' ? 'Kosmetikprodukt' : 'Lebensmittel'), brand: '', img: '', text, additives: [], allergens: [], nova: null, nutri: null, vegan: null, drink: false, food: null };
      const hid = c.hid || c.code || uid();
      if (S.stack.length > 2 && S.stack[S.stack.length - 2].v === 'checkres') popN(1); // altes Ergebnis ersetzen
      replace('checkres', { data, hid });
      break;
    }
    case 'checkRetry': c.err = null; render(); break;
    case 'checkAll': c.all = !c.all; renderKeep(); break;
    case 'ingInfo': ingSheet(c.res[+a.dataset.i]); break;
    case 'checkInfo': sheet(checkInfoHtml()); break;
    case 'checkOpen': { const h = S.checks.find((x) => x.id === a.dataset.id); if (h) go('checkres', h.data ? { data: h.data, hid: h.id, saved: true } : { code: h.id }); break; }
    case 'checkDiary': { const f = c.data.food; const own = (f.barcode && (await findByBarcode(f.barcode))) || S.foods.get(f.id); if (!own) S.tmp.set(f.id, f); S.pickFor = null; S.basket = null; go('product', { id: (own || f).id }); break; }
    case 'details': go('naehrwerte', { date: S.day }); break;
    case 'welcomeSave': {
      const p = readProfile(), err = checkProfile(p);
      if (err) return toast(err === 'young' ? YOUNG : err, true);
      S.profile = p; S.goal = { ...S.goal, auto: true }; applyAuto();
      await setSetting('profile', p); await setSetting('goal', S.goal);
      await db.put('weights', { date: today(), kg: p.weight });
      root('heute'); toast(`Dein Tagesziel: ${fmt(S.goal.kcal)} kcal`);
      break;
    }
    case 'welcomeSkip': S.profile = { ...DEFAULT_PROFILE, skipped: true }; S.goal = { kcal: 2000, auto: false, split: { ...DEFAULT_SPLIT }, macros: null }; await setSetting('profile', S.profile); await setSetting('goal', S.goal); root('heute'); break;
    case 'openCalc': go('rechner'); break;
    case 'calcSave': {
      const p = readProfile(), err = checkProfile(p);
      if (err) return toast(err === 'young' ? YOUNG : err, true);
      const weightChanged = !S.profile || S.profile.weight !== p.weight;
      S.profile = p; S.goal = { ...S.goal, auto: true }; applyAuto();
      await setSetting('profile', p); await setSetting('goal', S.goal);
      if (weightChanged) await db.put('weights', { date: today(), kg: p.weight });
      toast(`Tagesziel: ${fmt(S.goal.kcal)} kcal, ${fmt(S.goal.macros.prot)} g Eiweiß`);
      break;
    }
    case 'calcAdapt': {
      const p = readProfile(), err = checkProfile(p);
      if (err) return toast(err === 'young' ? YOUNG : err, true);
      const kcal = +a.dataset.k, r = calc(p);
      const fat = Math.round((kcal * 0.27) / 9), carb = Math.max(0, Math.round((kcal - r.prot * 4 - fat * 9) / 4));
      S.profile = p; S.goal = { ...S.goal, kcal, auto: false, macros: { prot: r.prot, carb, fat } };
      await setSetting('profile', p); await setSetting('goal', S.goal);
      toast(`Angepasstes Tagesziel: ${fmt(kcal)} kcal`);
      break;
    }
    case 'bfToGw': { const el = $('#pf-gw'); if (el) { el.value = inVal(+a.dataset.v); updateSuggestion(); } break; }
    case 'sex': $$('#profile .seg button').forEach((b) => b.classList.toggle('on', b === a)); updateSuggestion(); break;

    case 'day': S.day = addDays(S.day, +a.dataset.d); render(); break;
    case 'gotoday': S.day = today(); render(); break;
    case 'pickday': {
      const s = sheet(`<h3>Tag wählen</h3><div class="field"><label for="dpick">Datum</label><input type="date" id="dpick" value="${S.day}"></div><button class="btn" data-act="pickdayOk">Anzeigen</button>`);
      s.querySelector('#dpick').focus();
      break;
    }
    case 'pickdayOk': { const v = $('#dpick').value; if (v) { S.day = v; closeSheet(); render(); } break; }
    case 'addTo': S.addMeal = +a.dataset.meal; S.pickFor = null; S.q = ''; S.showSearch = false; go('add'); break;
    case 'repeat': {
      const m = +a.dataset.meal;
      const prev = (S.days.get(addDays(S.day, -1)) || []).filter((e) => e.meal === m);
      const list = S.days.get(S.day);
      for (const e of prev) { const n = { ...e, id: uid(), date: S.day, t: Date.now() }; await db.put('entries', n); list.push(n); }
      render(); toast(`${MEALS[m]} vom Vortag übernommen`);
      break;
    }
    case 'entry': go('product', { entry: a.dataset.id, date: S.day }); break;
    case 'mealmenu': {
      sheet(`<h3>Zu welcher Mahlzeit?</h3>${MEALS.map((m, i) => `<button class="opt ${i === S.addMeal ? 'main' : ''}" data-act="setMeal" data-m="${i}"><span><b>${m}</b></span></button>`).join('')}`);
      break;
    }
    case 'setMeal': S.addMeal = +a.dataset.m; closeSheet(); render(); break;
    case 'tab': S.addTab = a.dataset.t; refreshResults(); $$('#tabs .chip').forEach((b) => b.classList.toggle('on', b === a)); break;
    case 'retrySearch': S.online.q = ''; scheduleOnline(true); break;
    case 'quickIn': {
      const k = Math.round(num($('#qk')?.value || ''));
      if (!(k > 0 && k < 10000)) { toast('Bitte eine Kalorienzahl eingeben', true); $('#qk')?.focus(); break; }
      a.dataset.k = k;
    }
    // fällt durch zum Schnell-Eintrag
    case 'quick': {
      const k = num(a.dataset.k);
      const e = { id: uid(), date: S.day, meal: S.addMeal, t: Date.now(), foodId: 'schnell', name: 'Schnell-Eintrag', brand: '', src: 'Schnell', g: k, n: { ...emptyN(), kcal: 100 }, portions: [] };
      await db.put('entries', e);
      (await loadDay(S.day)).push(e);
      S.q = ''; root('heute'); toast(`${k} kcal zu ${MEALS[e.meal]} hinzugefügt`);
      break;
    }
    case 'addMore': {
      const g = readAmt();
      if (!(g > 0)) { $('#amt').focus(); return toast('Bitte eine Menge eintragen.', true); }
      let f = getFood(c.id);
      if (f.src === 'OFF' && !S.foods.has(f.id)) f = await saveFood(f);
      S.addMeal = c.meal ?? S.addMeal;
      S.basket = { items: [basketItem(f, g)] }; S.q = '';
      backToAdd(); toast(`${f.name} ist in deiner Mahlzeit. Noch etwas dazu oder gleich hinzufügen.`);
      break;
    }
    case 'basketRm': S.basket.items.splice(+a.dataset.ix, 1); if (!S.basket.items.length && !S.basket.comboId) S.basket = null; render(); break;
    case 'basketDrop': S.basket = null; render(); break;
    case 'useCombo': { const m = S.combos.find((x) => x.id === a.dataset.id); if (m && S.pickFor === 'plan') {
        const { wd, meal } = S.planTarget, day = (S.plan[wd] ||= {});
        (day[meal] ||= []).push(...m.items.map((i) => ({ ...structuredClone(i), pid: uid() })));
        await setSetting('plan', S.plan); S.pickFor = null; popTo('plan'); toast(`${m.name} im Plan`);
      } else if (m && S.pickFor === 'recipe') {
        S.draft.items.push(...m.items.map((i) => ({ foodId: i.foodId, name: i.name, g: i.g, n: { ...i.n } }))); S.pickFor = null; popTo('recipe'); toast(`${m.name} als Zutaten hinzugefügt`);
      } else if (m) { S.basket = { items: structuredClone(m.items), comboId: m.id, name: m.name }; S.q = ''; render(true); } break; }
    case 'comboDel': {
      if (!(await ask(`Gespeicherte Mahlzeit „${S.basket.name}“ löschen? Bereits eingetragene Tage bleiben.`, 'Löschen'))) return;
      S.combos = S.combos.filter((x) => x.id !== S.basket.comboId); await setSetting('combos', S.combos);
      S.basket = null; render(); toast('Mahlzeit gelöscht');
      break;
    }
    case 'comboSave': {
      const b = S.basket, name = $('#b-name').value.trim();
      if (!b.items.length) return toast('Die Mahlzeit ist noch leer.', true);
      if (!name) { $('#b-name').focus(); return toast('Zum Speichern bitte einen Namen eintragen.', true); }
      if (b.items.some((i) => !(i.g > 0))) return toast('Bitte bei jedem Teil eine Menge eintragen.', true);
      await storeCombo(b, name);
      S.basket = null; S.addTab = 'Mahlzeiten'; render(); toast(`„${name}“ gespeichert`);
      break;
    }
    case 'basketSave': {
      const b = S.basket;
      if (!b.items.length) return toast('Die Mahlzeit ist noch leer.', true);
      if (b.items.some((i) => !(i.g > 0))) return toast('Bitte bei jedem Teil eine Menge eintragen.', true);
      const name = $('#b-name').value.trim();
      if (name) await storeCombo(b, name);
      const list = await loadDay(S.day), t0 = Date.now();
      for (const [ix, i] of b.items.entries()) {
        const e = { id: uid(), date: S.day, meal: S.addMeal, t: t0 + ix, ...structuredClone(i) };
        await db.put('entries', e); list.push(e);
      }
      const k = basketTotals().kcal, n = b.items.length;
      S.basket = null; S.q = '';
      root('heute'); toast(`${n} ${n === 1 ? 'Teil' : 'Teile'} mit ${fmt(k)} kcal zu ${MEALS[S.addMeal]} hinzugefügt`);
      break;
    }
    case 'pick': { const f = getFood(a.dataset.id); if (f) foodChosen(f); break; }
    case 'mealPhoto': if (c.v === 'mealguess') replace('mealcam'); else go('mealcam'); break;
    case 'mealShoot': $('#mealInput').value = ''; $('#mealInput').click(); break;
    case 'mealGallery': $('#mealGallery').value = ''; $('#mealGallery').click(); break;
    case 'mealPick': {
      const k = a.dataset.k; c.sel = c.sel || [];
      c.sel = c.sel.includes(k) ? c.sel.filter((x) => x !== k) : [...c.sel, k];
      renderKeep(); break;
    }
    case 'aiPick': S.prefs.ai = a.dataset.v; await setSetting('prefs', S.prefs); if (c.shots?.length) recognizeMeal(c); break;
    case 'mealMore': S.mealAdd = true; { const inp = $(a.dataset.g ? '#mealGallery' : '#mealInput'); inp.value = ''; inp.click(); } break;
    case 'checkUpdate': checkUpdate(); break;
    case 'mealNext': if (c.sel?.length) go('mealportion', { k: c.sel[0], queue: c.sel.slice(1), total: c.sel.length, idx: 1, saved: [] }); break;
    case 'mealSize': c.g = +a.dataset.g; $('#mp-g').value = c.g; updateMealPortion(); break;
    case 'mealSearch': S.q = ''; S.showSearch = true; backToAdd(); setTimeout(() => $('#q')?.focus(), 80); break;
    case 'mealSave': {
      const d = DISH_MAP.get(c.k), g = mealG(c);
      if (d.k === 'wasser') await addMeasure('water', S.day, water(S.day) + g / 1000); // Wasser zählt beim Wasser-Tracker
      else {
        const f = dishFood(d);
        const e = { id: uid(), date: S.day, meal: S.addMeal, t: Date.now(), foodId: f.id, name: f.name, brand: '', src: 'Gericht', img: '', g, n: { ...f.n }, portions: f.portions, est: true };
        await db.put('entries', e); (await loadDay(S.day)).push(e);
      }
      const saved = [...(c.saved || []), d.name];
      if (c.queue?.length) { replace('mealportion', { k: c.queue[0], queue: c.queue.slice(1), total: c.total, idx: c.idx + 1, saved, safe: c.safe }); break; }
      S.q = ''; root('heute');
      toast(saved.length > 1 ? `${saved.length} Teile als Schätzung zu ${MEALS[S.addMeal]} eingetragen` : `${d.name} als Schätzung zu ${MEALS[S.addMeal]} eingetragen`);
      break;
    }

    case 'scan': go('scanner'); break;
    case 'torch': if (S.scanner) { S.torchOn = !S.torchOn; const ok = await S.scanner.torch(S.torchOn); a.classList.toggle('on', ok && S.torchOn); } break;
    case 'rescan': c.unknown = false; render(); break;
    case 'retryCode': { c.unknown = false; render(); setTimeout(() => handleBarcode(a.dataset.bc), 50); break; }

    case 'photo': {
      const bc = a.dataset.bc || '';
      if (c.v === 'scanner') replace('photo', { bc }); else go('photo', { bc });
      break;
    }
    case 'photoAgain': replace('photo', { bc: $('#pbc')?.value || c.bc || '' }); break;
    case 'shoot': $('#photoInput').value = ''; $('#photoInput').click(); break;
    case 'gallery': $('#galleryInput').value = ''; $('#galleryInput').click(); break;
    case 'saveOcr': {
      const name = $('#pname').value.trim();
      if (!name) { $('#pname').focus(); return toast('Bitte einen Namen eintragen.', true); }
      const n = readNutrients('o-');
      if (isNaN(n.kcal)) { $('#o-kcal').focus(); return toast('Bitte den Brennwert in kcal eintragen.', true); }
      for (const k of NKEYS) if (isNaN(n[k])) n[k] = 0;
      const pg = num($('#ppg').value);
      const f = { id: 'foto:' + uid(), src: 'Foto', name, brand: $('#pbrand').value.trim(), barcode: $('#pbc').value.replace(/\D/g, '') || undefined, n, portions: pg > 0 ? [{ l: $('#pp').value.trim() || 'Portion', g: pg }] : [] };
      await saveFood(f);
      toast(f.barcode ? 'Gespeichert und mit Barcode verknüpft' : 'Als eigenes Lebensmittel gespeichert');
      foodChosen(f, { replaceView: true });
      break;
    }

    case 'fav': {
      const id = a.dataset.id, f = getFood(id);
      if (S.favs.has(id)) S.favs.delete(id); else { S.favs.add(id); if (f && !S.foods.has(id) && f.src === 'OFF') await saveFood(f); }
      await setSetting('favs', [...S.favs]);
      const on = S.favs.has(id);
      a.classList.toggle('on', on); a.setAttribute('aria-pressed', on);
      toast(on ? 'Zu Favoriten hinzugefügt' : 'Aus Favoriten entfernt');
      break;
    }
    case 'unit': c.g = +a.dataset.g; render(); break;
    case 'meal': c.meal = +a.dataset.m; c.g = readAmt(); render(); break;
    case 'saveEntry': {
      const g = readAmt();
      if (!(g > 0)) { $('#amt').focus(); return toast('Bitte eine Menge eintragen.', true); }
      if (c.entry) {
        const list = S.days.get(c.date), e = list.find((x) => x.id === c.entry);
        e.g = g; e.meal = c.meal ?? e.meal;
        await db.put('entries', e);
        S.day = c.date;
        root('heute'); toast('Eintrag gespeichert');
      } else {
        let f = getFood(c.id);
        if (f.src === 'OFF' && !S.foods.has(f.id)) f = await saveFood(f);
        const meal = c.meal ?? S.addMeal;
        if (S.basket) { S.addMeal = meal; S.basket.items.push(basketItem(f, g)); S.q = ''; backToAdd(); toast(`${f.name} zur Mahlzeit hinzugefügt`); break; }
        const e = { id: uid(), date: S.day, meal, t: Date.now(), foodId: f.id, name: f.name, brand: f.brand || '', src: f.src, img: f.img || '', g, n: { ...f.n }, portions: f.portions || [] };
        await db.put('entries', e);
        (await loadDay(S.day)).push(e);
        S.addMeal = meal;
        root('heute'); toast(`${f.name} zu ${MEALS[meal]} hinzugefügt`);
      }
      break;
    }
    case 'del': {
      if (!(await ask('Eintrag löschen?', 'Löschen'))) return;
      await db.del('entries', c.entry);
      S.days.set(c.date, S.days.get(c.date).filter((x) => x.id !== c.entry));
      S.day = c.date; root('heute'); toast('Eintrag gelöscht');
      break;
    }
    case 'copyEntry': sheet(`<h3>Eintrag kopieren</h3><p>Auf welchen Tag soll der Eintrag kopiert werden?</p><div class="row2"><button class="btn sec" data-act="copyTo" data-d="${addDays(c.date, 1)}">Folgetag</button><button class="btn sec" data-act="copyTo" data-d="${today()}">Heute</button></div><div class="field"><label for="cdate">Anderes Datum</label><input type="date" id="cdate" value="${addDays(c.date, 1)}"></div><button class="btn" data-act="copyTo">Kopieren</button>`); break;
    case 'copyTo': {
      const d = a.dataset.d || $('#cdate').value;
      if (!d) return;
      const e = S.days.get(c.date).find((x) => x.id === c.entry);
      const n = { ...e, id: uid(), date: d, t: Date.now(), g: readAmt() || e.g };
      await db.put('entries', n);
      await loadDay(d, true);
      closeSheet(); toast(`Kopiert auf ${dayLabel(d) === 'Heute' || dayLabel(d) === 'Morgen' || dayLabel(d) === 'Gestern' ? dayLabel(d).toLowerCase() : dateLong(d)}`);
      break;
    }

    case 'newfood': go('food', { name: S.q.trim(), bc: a.dataset.bc || '' }); break;
    case 'editFood': { const f = S.foods.get(a.dataset.id); if (f?.src === 'Rezept') { S.draft = structuredClone({ ...f.recipe, id: f.id, name: f.name }); go('recipe'); } else go('food', { id: a.dataset.id }); break; }
    case 'per': {
      // Umschalten zwischen pro 100 g und pro Portion: eingegebene Werte umrechnen
      syncPortions();
      const to = a.dataset.v, from = c.per || 'g100';
      if (to === from) break;
      const pg = num(c.portions?.[0]?.g);
      if (!(pg > 0)) { toast('Bitte zuerst unten die Gramm der ersten Portion eintragen.', true); $('#fpg0')?.focus(); break; }
      const vals = Object.fromEntries([...NKEYS, ...MKEYS].map((k) => [k, num($('#fv-' + k)?.value)]));
      c.per = to; c.name = $('#fn').value; c.bc = $('#fbc').value; c.microOpen = $('details.micro')?.open;
      render();
      for (const k of [...NKEYS, ...MKEYS]) { const el = $('#fv-' + k); if (el && !isNaN(vals[k])) el.value = inVal(to === 'portion' ? (vals[k] * pg) / 100 : (vals[k] / pg) * 100, 2); }
      break;
    }
    case 'addPortion': syncPortions(); c.portions.push({ l: '', g: '' }); keepFoodForm(() => render()); break;
    case 'rmPortion': syncPortions(); c.portions.splice(+a.dataset.i, 1); keepFoodForm(() => render()); break;
    case 'saveFood': {
      syncPortions();
      const name = $('#fn').value.trim();
      if (!name) { $('#fn').focus(); return toast('Bitte einen Namen eintragen.', true); }
      const vals = Object.fromEntries(NKEYS.map((k) => [k, num0($('#fv-' + k)?.value)]));
      if (!(vals.kcal > 0) && !(vals.fat || vals.carb || vals.prot)) { $('#fv-kcal').focus(); return toast('Bitte mindestens die Kalorien eintragen.', true); }
      const portions = c.portions.map((p) => ({ l: String(p.l).trim() || 'Portion', g: num(p.g) })).filter((p) => p.g > 0);
      let n = vals;
      if ((c.per || 'g100') === 'portion') {
        const pg = portions[0]?.g;
        if (!pg) return toast('Bitte die Gramm der ersten Portion eintragen.', true);
        n = Object.fromEntries(NKEYS.map((k) => [k, (vals[k] / pg) * 100]));
      }
      for (const k of MKEYS) {
        const v = num($('#fv-' + k)?.value);
        if (!isNaN(v) && v >= 0) n[k] = (c.per || 'g100') === 'portion' ? (v / portions[0].g) * 100 : v;
      }
      if (!n.kj) n.kj = Math.round(n.kcal * 4.184);
      const old = c.id ? S.foods.get(c.id) : null;
      const f = { ...(old || {}), id: old?.id || 'eigen:' + uid(), src: old?.src || 'Eigen', name, brand: $('#fb').value.trim(), barcode: $('#fbc').value.replace(/\D/g, '') || undefined, n, portions };
      await saveFood(f);
      toast(name + ' gespeichert');
      if (old) back(); else foodChosen(f, { replaceView: true });
      break;
    }
    case 'delFood': {
      const id = c.id || S.draft?.id;
      if (!id || !(await ask('Wirklich löschen? Bereits eingetragene Tage bleiben erhalten.', 'Löschen'))) return;
      await db.del('foods', id); S.foods.delete(id); S.favs.delete(id); await setSetting('favs', [...S.favs]);
      toast('Gelöscht');
      // zurück vor die Produktansicht
      const i = S.stack.findIndex((s) => s.v === 'product' && s.id === id);
      if (i > 0) { popN(S.stack.length - i); render(true); } else back();
      break;
    }

    case 'newrecipe': S.draft = { name: '', items: [], portions: 2, cooked: 0, steps: [] }; go('recipe'); break;
    case 'ingSearch': S.pickFor = 'recipe'; S.q = ''; go('add'); break;
    case 'ingScan': S.pickFor = 'recipe'; go('scanner'); break;
    case 'rmIng': S.draft.items.splice(+a.dataset.ix, 1); render(); break;
    case 'addStep': (S.draft.steps ||= []).push({ t: '', min: 0 }); renderKeep(); setTimeout(() => $$('[data-step]').pop()?.focus(), 50); break;
    case 'rmStep': S.draft.steps.splice(+a.dataset.ix, 1); renderKeep(); break;
    case 'stepUp': { const ix = +a.dataset.ix, st = S.draft.steps; if (ix > 0) [st[ix - 1], st[ix]] = [st[ix], st[ix - 1]]; renderKeep(); break; }
    case 'openCook': if (cur().v === 'cook' && cur().id === a.dataset.id) break; go('cook', { id: a.dataset.id }); break;
    case 'stepDone': { const i = +a.dataset.i; c.done = c.done || []; c.done = c.done.includes(i) ? c.done.filter((x) => x !== i) : [...c.done, i]; renderKeep(); break; }
    case 'timerStart': { const f = getFood(c.id), i = +a.dataset.i, st = f.recipe.steps[i]; startTimer(f.id, i, `${f.name} · Schritt ${i + 1}: ${st.t.slice(0, 60)}`, st.min); renderKeep(); break; }
    case 'timerStop': stopTimer(c.id, +a.dataset.i); renderKeep(); break;
    case 'alarmOk': clearInterval(alarmLoop); $('#alarm')?.remove(); break;
    case 'dupRecipe': S.draft = { ...structuredClone(S.draft), id: undefined, name: S.draft.name + ' (Kopie)' }; replace('recipe'); toast('Kopie erstellt. Jetzt anpassen und speichern.'); break;
    case 'saveRecipe': {
      const r = S.draft;
      r.name = $('#rn').value.trim();
      if (!r.name) { $('#rn').focus(); return toast('Bitte einen Namen eintragen.', true); }
      if (!r.items.length) return toast('Bitte mindestens eine Zutat hinzufügen.', true);
      const calc = recipeCalc(r);
      const old = r.id ? S.foods.get(r.id) : null;
      const f = { ...(old || {}), id: r.id || 'rezept:' + uid(), src: 'Rezept', name: r.name, brand: '', n: calc.per100, portions: [{ l: 'Portion', g: Math.round(calc.w / Math.max(r.portions, 1)) }], recipe: { items: r.items, portions: r.portions, cooked: r.cooked, steps: (r.steps || []).filter((st) => st.t.trim() || st.min).map((st) => ({ t: st.t.trim(), min: st.min || 0 })) } };
      await saveFood(f);
      toast('Rezept gespeichert');
      S.draft = null;
      if (old) back(); else replace('product', { id: f.id });
      break;
    }

    case 'range': c.range = a.dataset.v; render(); break;
    case 'addWeight': sheet(`<h3>Gewicht eintragen</h3><div class="row2"><div class="field"><label for="wkg">Gewicht (kg)</label><input id="wkg" inputmode="decimal" value="${inVal(S.profile?.weight)}"></div><div class="field"><label for="wdate">Datum</label><input id="wdate" type="date" value="${today()}"></div></div><button class="btn" data-act="saveWeight">Speichern</button>`); $('#wkg').select(); break;
    case 'saveWeight': {
      const kg = num($('#wkg').value), date = $('#wdate').value || today();
      if (!(kg >= 30 && kg <= 350)) return toast('Bitte ein Gewicht zwischen 30 und 350 kg eintragen.', true);
      await db.put('weights', { date, kg });
      const all = (await db.all('weights')).sort((x, y) => x.date.localeCompare(y.date));
      if (S.profile && all[all.length - 1].date === date) { S.profile.weight = kg; await setSetting('profile', S.profile); if (S.goal.auto) { applyAuto(); await setSetting('goal', S.goal); } }
      closeSheet(); render(); toast('Gewicht gespeichert');
      break;
    }
    case 'weightList': {
      const ws = (await db.all('weights')).sort((x, y) => y.date.localeCompare(x.date));
      sheet(`<h3>Gewichtseinträge</h3><div class="list">${ws.map((w) => `<div class="item"><span class="tx"><span class="n">${fmt(w.kg, 1)} kg</span><span class="s">${esc(dateLong(w.date))}</span></span><button class="iconbtn" data-act="delWeight" data-d="${w.date}" aria-label="Löschen">${ic('trash')}</button></div>`).join('')}</div>`);
      break;
    }
    case 'delWeight': await db.del('weights', a.dataset.d); a.closest('.item').remove(); render(); break;

    case 'gmode': {
      const box = $('#g-mode'), to = a.dataset.v;
      if (box.dataset.mode === to) break;
      if (to === 'g') {
        // Prozent -> Gramm vorbelegen
        const kcal = num0($('#g-kcal').value), G = macroGrams(kcal, { prot: num0($('#g-prot').value), carb: num0($('#g-carb').value), fat: num0($('#g-fat').value) });
        $('#g-pg').value = Math.round(G.prot); $('#g-cg').value = Math.round(G.carb); $('#g-fg').value = Math.round(G.fat);
      } else {
        const pg = num0($('#g-pg').value), cg = num0($('#g-cg').value), fg = num0($('#g-fg').value), kcal = pg * 4 + cg * 4 + fg * 9;
        if (kcal > 0) {
          const pp = Math.round((pg * 400) / kcal), cp = Math.round((cg * 400) / kcal);
          $('#g-prot').value = pp; $('#g-carb').value = cp; $('#g-fat').value = 100 - pp - cp;
        }
      }
      box.dataset.mode = to;
      $$('#g-mode button').forEach((b) => b.classList.toggle('on', b.dataset.v === to));
      $('#g-pctbox').hidden = to === 'g'; $('#g-gbox').hidden = to !== 'g';
      updateGoalSum();
      break;
    }
    case 'fillCarb': {
      const kcal = num0($('#g-kcal').value), pg = num0($('#g-pg').value), fg = num0($('#g-fg').value);
      $('#g-cg').value = Math.max(0, Math.round((kcal - pg * 4 - fg * 9) / 4));
      updateGoalSum();
      break;
    }
    case 'saveSettings': {
      const auto = $('#g-auto').checked, days = S.goal.days || {}, perDay = !!S.goal.perDay, keepWeek = !!S.goal.keepWeek;
      if (auto) { S.goal = { ...S.goal, auto: true, perDay, days }; applyAuto(); }
      else if ($('#g-mode').dataset.mode === 'g') {
        const prot = Math.round(num($('#g-pg').value)), carb = Math.round(num($('#g-cg').value)), fat = Math.round(num($('#g-fg').value));
        if (![prot, carb, fat].every((v) => v >= 0)) return toast('Bitte für Eiweiß, Kohlenhydrate und Fett Gramm eintragen.', true);
        const mk = prot * 4 + carb * 4 + fat * 9, kcal = Math.round(num($('#g-kcal').value)) || mk;
        if (!(kcal >= 1200 && kcal <= 8000)) return toast('Bitte ein Tagesziel zwischen 1.200 und 8.000 kcal eintragen.', true);
        if (!(mk > 0)) return toast('Bitte Gramm für die Makros eintragen.', true);
        const pp = Math.round((prot * 400) / mk), cp = Math.round((carb * 400) / mk);
        S.goal = { kcal, auto: false, mode: 'g', split: { prot: pp, carb: cp, fat: 100 - pp - cp }, macros: { prot, carb, fat }, perDay, days, keepWeek };
      } else {
        const split = { prot: num0($('#g-prot').value), carb: num0($('#g-carb').value), fat: num0($('#g-fat').value) };
        const psum = split.prot + split.carb + split.fat;
        if (!(psum >= 50 && psum <= 150)) return toast(`Die Makros ergeben zusammen ${fmt(psum)} %. Bitte grob um die 100 % bleiben.`, true);
        const kcal = Math.round(num($('#g-kcal').value));
        if (!(kcal >= 1200 && kcal <= 8000)) return toast('Bitte ein Tagesziel zwischen 1.200 und 8.000 kcal eintragen.', true);
        S.goal = { kcal, auto: false, mode: 'pct', split, macros: null, perDay, days, keepWeek };
      }
      await setSetting('goal', S.goal);
      render(); toast(`Gespeichert. Tagesziel ${fmt(S.goal.kcal)} kcal`);
      break;
    }
    case 'exportJson': { const data = await exportAll(); if (await download(`kalorien-sicherung-${today()}.json`, JSON.stringify(data, null, 1), 'application/json')) toast('Sicherung gespeichert'); else toast('Speichern wurde abgebrochen.', true); break; }
    case 'exportCsv': {
      const all = (await db.all('entries')).sort((x, y) => x.date.localeCompare(y.date) || x.meal - y.meal);
      const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
      const d = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
      const rows = [['Datum', 'Mahlzeit', 'Lebensmittel', 'Marke', 'Menge (g)', 'kcal', 'Eiweiß (g)', 'Kohlenhydrate (g)', 'Fett (g)'].map(q).join(';')];
      for (const e of all) { const n = nutOf(e.n, e.g); rows.push([e.date, MEALS[e.meal], e.name, e.brand, d(e.g), d(n.kcal), d(n.prot), d(n.carb), d(n.fat)].map(q).join(';')); }
      download(`kalorien-tagebuch-${today()}.csv`, '﻿' + rows.join('\r\n'), 'text/csv');
      break;
    }
    case 'import': $('#importInput').value = ''; $('#importInput').click(); break;
    case 'wipe': {
      if (!(await ask('Wirklich alle Daten auf diesem Gerät löschen? Das lässt sich nicht rückgängig machen. Speichere vorher eine Sicherung.', 'Alles löschen'))) return;
      for (const s of ['foods', 'entries', 'weights', 'settings']) await db.clear(s);
      location.reload();
      break;
    }
  }
});

// Formularwerte beim Neuzeichnen des Lebensmittel-Formulars behalten
function keepFoodForm(fn) {
  const vals = {};
  $$('#screen input').forEach((el) => { if (el.id && !el.dataset.pl && !el.dataset.pg) vals[el.id] = el.value; });
  fn();
  setTimeout(() => { for (const [id, v] of Object.entries(vals)) { const el = document.getElementById(id); if (el) el.value = v; } }, 0);
}

document.addEventListener('submit', (ev) => {
  const f = ev.target.closest('[data-form]');
  if (!f) return;
  ev.preventDefault();
  if (f.dataset.form === 'search') { $('#q').blur(); scheduleOnline(true); }
  if (f.dataset.form === 'manual') {
    const code = $('#manualCode').value.replace(/\D/g, '');
    if (!validEan(code)) return toast('Das ist kein gültiger Barcode (8 oder 13 Ziffern).', true);
    handleBarcode(code);
  }
});

screen.addEventListener('input', (ev) => {
  const t = ev.target, c = cur();
  if (t.id === 'q') { S.q = t.value; $('#tabs').hidden = !!S.q.trim(); refreshResults(); scheduleOnline(); return; }
  if (t.id === 'amt') {
    const g = readAmt(); c.g = g; const e = c.entry ? S.days.get(c.date).find((x) => x.id === c.entry) : null;
    const f = e || getFood(c.id); const n = nutOf(f.n, g);
    $('#c-kcal').textContent = fmt(n.kcal); $('#c-prot').textContent = fmt(n.prot, 1); $('#c-carb').textContent = fmt(n.carb, 1); $('#c-fat').textContent = fmt(n.fat, 1); $('#t-g').textContent = fmt(g);
    $$('[data-per]').forEach((td) => (td.textContent = fmt((+td.dataset.per * g) / 100, +td.dataset.d) + ' ' + td.dataset.u));
    $$('.amount .chip').forEach((b) => b.classList.toggle('on', +b.dataset.g === g));
    return;
  }
  if (t.dataset.n) { updatePlaus(); const row = t.closest('.nrow'); if (row?.classList.contains('unsure')) { row.classList.remove('unsure'); row.querySelector('.flag')?.remove(); } return; }
  if (t.dataset.bg != null) { const ix = +t.dataset.bg, i = S.basket.items[ix]; i.g = num0(t.value); $('#bk' + ix).textContent = fmt(nutOf(i.n, i.g).kcal) + ' kcal'; updateBasketTotals(); return; }
  if (t.id === 'b-name') { S.basket.name = t.value; return; }
  if (t.id === 'rn') { S.draft.name = t.value; return; }
  if (t.dataset.step != null) { S.draft.steps[+t.dataset.step].t = t.value; return; }
  if (t.dataset.steph != null || t.dataset.stepm != null) {
    const ix = +(t.dataset.steph ?? t.dataset.stepm);
    S.draft.steps[ix].min = Math.max(0, Math.round(num0($(`[data-steph="${ix}"]`).value) * 60 + num0($(`[data-stepm="${ix}"]`).value)));
    return;
  }
  if (t.dataset.ing != null || t.id === 'rp' || t.id === 'rw') {
    if (t.dataset.ing != null) { const ix = +t.dataset.ing; S.draft.items[ix].g = num0(t.value); $('#ik' + ix).textContent = fmt((S.draft.items[ix].n.kcal * S.draft.items[ix].g) / 100) + ' kcal'; }
    if (t.id === 'rp') S.draft.portions = Math.max(1, Math.round(num0(t.value)) || 1);
    if (t.id === 'rw') S.draft.cooked = num0(t.value);
    updateRecipeCalc();
    return;
  }
  if (t.id?.startsWith('wd-')) { updateWeekSum(); return; }
  if (t.id === 'mp-g') { c.g = +t.value; updateMealPortion(); return; }
  if (t.closest('#profile')) updateSuggestion();
  if (['g-prot', 'g-carb', 'g-fat', 'g-kcal', 'g-pg', 'g-cg', 'g-fg'].includes(t.id)) updateGoalSum();
});
function updateGoalSum() {
  const box = $('#g-sum');
  if (!box) return;
  const fill = $('#g-fill'); fill.hidden = true;
  const line = (k, p, c, f) => `${fmt(k)} kcal = ${fmt(p)} g Eiweiß · ${fmt(c)} g Kohlenhydrate · ${fmt(f)} g Fett`;
  let base;
  if ($('#g-auto').checked && S.profile && !checkProfile(S.profile)) {
    const r = calc(S.profile);
    box.innerHTML = line(r.target, r.prot, r.carb, r.fat);
    base = r.target;
  } else if ($('#g-mode').dataset.mode === 'g') {
    const p = num0($('#g-pg').value), c = num0($('#g-cg').value), f = num0($('#g-fg').value), k = p * 4 + c * 4 + f * 9;
    const kcal = num0($('#g-kcal').value) || k, diff = Math.round(k - kcal);
    box.innerHTML = k > 0 ? `Die Makros ergeben ${fmt(k)} kcal (${fmt((p * 400) / k)} % Eiweiß · ${fmt((c * 400) / k)} % Kohlenhydrate · ${fmt((f * 900) / k)} % Fett).${Math.abs(diff) > 25 ? ` Das sind ${fmt(Math.abs(diff))} kcal ${diff > 0 ? 'mehr' : 'weniger'} als dein Tagesziel. Das ist okay, die Makros müssen nicht genau passen.` : ''}` : 'Bitte Gramm eintragen.';
    fill.hidden = !(k > 0 && Math.abs(diff) > 25);
    base = kcal;
  } else {
    const sp = { prot: num0($('#g-prot').value), carb: num0($('#g-carb').value), fat: num0($('#g-fat').value) };
    const sum = sp.prot + sp.carb + sp.fat, kcal = num0($('#g-kcal').value), G = macroGrams(kcal, sp);
    box.innerHTML = line(kcal, G.prot, G.carb, G.fat) + (Math.round(sum) !== 100 ? `. Zusammen ${fmt(sum)} % statt 100 %. Das ist okay, die Makros müssen nicht genau passen.` : '');
    base = kcal;
  }
  if (base > 0) {
    const b = $('#g-base'); if (b) b.textContent = fmt(Math.round(base));
    $$('#g-days input').forEach((el) => (el.placeholder = Math.round(base)));
  }
}
screen.addEventListener('change', async (ev) => {
  const t = ev.target;
  if (t.closest('#profile') && t.tagName === 'SELECT') updateSuggestion(); // Eingabefelder laufen schon über "input"
  if (t.id === 'g-auto') { $('#g-manual').hidden = t.checked; updateGoalSum(); }
  if (t.id === 'theme') { S.theme = t.value; applyTheme(); await setSetting('theme', S.theme); }
  if (t.id === 'w-on') { S.prefs.water.on = t.checked; await setSetting('prefs', S.prefs); }
  if (t.id === 'w-glass') { S.prefs.water.glass = +t.value; await setSetting('prefs', S.prefs); }
  if (t.id === 'w-goal') { const v = Math.round(num(t.value)); if (v >= 250 && v <= 8000) { S.prefs.water.goal = v; await setSetting('prefs', S.prefs); } else { t.value = S.prefs.water.goal; toast('Bitte zwischen 250 und 8.000 ml.', true); } }
  if (t.id === 'sun-on') { S.prefs.sunday = t.checked; await setSetting('prefs', S.prefs); }
  if (t.id === 'aimode') { S.prefs.ai = t.value || undefined; await setSetting('prefs', S.prefs); }
  if (t.id === 'wstart') { S.prefs.weekStart = +t.value; await setSetting('prefs', S.prefs); }
  if (t.id === 'p-only') { S.prefs.planOnly = t.checked; await setSetting('prefs', S.prefs); }
  if (t.id === 'w-keep') updateWeekSum();
  if (t.id === 'mp-sf') { cur().safe = t.checked; S.prefs.safety = t.checked; await setSetting('prefs', S.prefs); updateMealPortion(); return; }
  if (t.dataset.hsend) { S.prefs.health.send[t.dataset.hsend] = t.checked; await setSetting('prefs', S.prefs); }
  if (t.dataset.ghome) { const g = S.goals.find((x) => x.id === t.dataset.ghome); if (g) { g.home = t.checked; await setSetting('goals', S.goals); toast(g.home ? 'Auf der Startseite' : 'Nicht mehr auf der Startseite'); } }
});

$('#ingInput').addEventListener('change', (ev) => { const f = ev.target.files?.[0]; if (!f) return; if (cur().v === 'check') { go('checktext', { kind: S.ingKind || 'cos' }); } else cur().kind = S.ingKind || cur().kind; runIngOcr(f); });
for (const id of ['mealInput', 'mealGallery']) {
  $('#' + id).addEventListener('change', (ev) => { const f = ev.target.files?.[0]; if (f) runMealCam(f); });
}
for (const id of ['photoInput', 'galleryInput']) {
  $('#' + id).addEventListener('change', (ev) => { const f = ev.target.files?.[0]; if (f) runOcr(f); });
}
$('#importInput').addEventListener('change', async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!(await ask('Sicherung laden? Die Daten auf diesem Gerät werden dabei ersetzt.', 'Laden', false))) return;
    await importAll(data);
    toast('Sicherung geladen');
    setTimeout(() => location.reload(), 600);
  } catch (e) { toast(e.message || 'Datei konnte nicht gelesen werden.', true); }
});

function applyTheme() {
  if (S.theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = S.theme;
}

addEventListener('online', () => { if (cur().v === 'add') { refreshResults(); scheduleOnline(); } });
addEventListener('offline', () => { if (cur().v === 'add') refreshResults(); });
// Tageswechsel um Mitternacht, wenn die App offen bleibt
let lastToday = today();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') { stopScanner(); return; }
  if (today() !== lastToday) { if (S.day === lastToday) S.day = today(); lastToday = today(); render(); }
  else if (cur().v === 'scanner' && !cur().unknown) startScanner();
});

/* ---------- Start ---------- */
async function init() {
  try { await navigator.storage?.persist?.(); } catch { /* egal */ }
  const [foods, profile, goal, favs, theme, combos, checks, goals, measures, supps, supplog, plan, prefs] = await Promise.all([db.all('foods'), getSetting('profile', null), getSetting('goal', null), getSetting('favs', []), getSetting('theme', 'system'), getSetting('combos', []), getSetting('checks', []),
    getSetting('goals', []), getSetting('measures', {}), getSetting('supps', []), getSetting('supplog', {}), getSetting('plan', {}), getSetting('prefs', null)]);
  S.goals = goals || []; S.measures = measures || {}; S.supps = supps || []; S.supplog = supplog || {}; S.plan = plan || {};
  if (prefs) S.prefs = { ...S.prefs, ...prefs, water: { ...S.prefs.water, ...(prefs.water || {}) }, health: { ...S.prefs.health, ...(prefs.health || {}), send: { ...S.prefs.health.send, ...(prefs.health?.send || {}) } } };
  foods.forEach((f) => S.foods.set(f.id, f));
  S.profile = migrateProfile(profile);
  if (goal) S.goal = { ...S.goal, ...goal, split: { ...DEFAULT_SPLIT, ...(goal.split || {}) } };
  applyAuto();
  S.favs = new Set(favs);
  S.combos = combos || [];
  S.checks = checks || [];
  S.theme = theme; applyTheme();
  history.replaceState({ d: 1 }, '');
  let fresh = false;
  if (!profile) { // Erster Start: kein Pflicht-Rechner, Standardziel. Rechner ist freiwillig in den Einstellungen.
    fresh = true;
    S.profile = { ...DEFAULT_PROFILE, skipped: true }; S.goal = { kcal: 2000, auto: false, split: { ...DEFAULT_SPLIT }, macros: null };
    await setSetting('profile', S.profile); await setSetting('goal', S.goal);
  }
  S.stack = [{ v: 'heute' }];
  await render(true);
  if (fresh) toast('Tagesziel 2.000 kcal. Persönlich berechnen kannst du es unter Einstellungen > Kalorien-Rechner.');

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    initUpdates();
  }
  // Texterkennung einmal im Hintergrund laden, damit sie später offline klappt
  if (isOnline() && !localStorage.getItem('ocrReady')) {
    setTimeout(async () => {
      try { const m = await import('./ocr.js'); await m.warmUp(); localStorage.setItem('ocrReady', '1'); } catch { /* später */ }
    }, 6000);
  }
}
init().catch((e) => { console.error(e); screen.innerHTML = `<div class="center"><h2>Die App konnte nicht starten</h2><p>${esc(e.message)}</p><p class="fine">Im privaten Modus mancher Browser ist die lokale Datenbank gesperrt.</p></div>`; });

// für Tests
window.__app = { S, db };
