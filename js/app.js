// KalorienTracker – Haupt-App. Läuft komplett im Browser, Daten bleiben auf dem Gerät.
import { db, getSetting, setSetting, exportAll, importAll, uid } from './db.js';
import { BASIS } from './basis.js';
import * as OFF from './off.js';
import { Scanner, validEan } from './scanner.js';
import { FIELDS, plausibility } from './parser.js';
import { MICRO, MKEYS } from './nutrients.js';
import * as ING from './ingredients.js';
import { LIFE, GOALS, DEFAULT_PROFILE, DEFAULT_SPLIT, calc, goalText, trend, checkProfile, migrateProfile, macroGrams } from './goals.js';
import { $, $$, ic, fmt, num, num0, inVal, esc, today, addDays, dayDiff, dayLabel, dateLong, colorFor, initials, norm, download, parseD, dstr } from './util.js';

const APP_VERSION = '1.2.0';
const screen = $('#screen');
const MEALS = ['Frühstück', 'Mittagessen', 'Abendessen', 'Snacks'];
const SRC = { OFF: ['Open Food Facts', 'off'], BLS: ['Grundlebensmittel', 'bls'], Eigen: ['Eigenes', 'eigen'], Rezept: ['Rezept', 'rezept'], Foto: ['Foto-Erfassung', 'foto'], Schnell: ['Schnell-Eintrag', 'foto'] };
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
};

function defaultMeal() {
  const h = new Date().getHours();
  return h < 10 ? 0 : h < 15 ? 1 : h < 21 ? 2 : 3;
}

const isOnline = () => navigator.onLine !== false;
const getFood = (id) => S.foods.get(id) || S.tmp.get(id) || BASIS_MAP.get(id);
const BASIS_MAP = new Map(BASIS.map((f) => [f.id, f]));
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
  const k = S.goal.perDay ? S.goal.days?.[wd] : null;
  if (!k || k === kcal0) return { kcal: kcal0, prot: base.prot, carb: base.carb, fat: base.fat, wd, custom: false };
  const rest = Math.max(0, k - base.prot * 4), old = base.carb * 4 + base.fat * 9, f = old > 0 ? rest / old : 0;
  return { kcal: k, prot: base.prot, carb: Math.round(base.carb * f), fat: Math.round(base.fat * f), wd, custom: true };
}
const nutOf = (n, g) => { const f = g / 100; return { kcal: n.kcal * f, prot: n.prot * f, carb: n.carb * f, fat: n.fat * f }; };

async function loadDay(d, force) {
  if (!force && S.days.has(d)) return S.days.get(d);
  const list = await db.byIndex('entries', 'date', d);
  list.sort((a, b) => (a.t || 0) - (b.t || 0));
  S.days.set(d, list);
  return list;
}
const totals = (list) => list.reduce((a, e) => { const n = nutOf(e.n, e.g); a.kcal += n.kcal; a.prot += n.prot; a.carb += n.carb; a.fat += n.fat; return a; }, { kcal: 0, prot: 0, carb: 0, fat: 0 });

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
function toast(msg, warn) {
  $$('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.innerHTML = ic(warn ? 'warn' : 'check') + esc(msg);
  document.body.appendChild(t);
  clearTimeout(toastT);
  toastT = setTimeout(() => t.remove(), 2800);
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
  load: () => Promise.all([loadDay(S.day), loadDay(addDays(S.day, -1))]),
  html() {
    const list = S.days.get(S.day) || [];
    const prev = S.days.get(addDays(S.day, -1)) || [];
    const t = totals(list), G = goalFor(S.day), goal = G.kcal;
    const left = goal - t.kcal, pct = Math.min(t.kcal / Math.max(goal, 1), 1), C = 2 * Math.PI * 54;
    const macro = (k, l, col) => `<div class="macro"><div class="t"><span>${l}</span><span class="num">${fmt(t[k])} / ${fmt(G[k])} g</span></div><div class="bar"><i style="width:${Math.min(t[k] / Math.max(G[k], 1), 1) * 100}%;background:var(${col})"></i></div></div>`;
    const meals = MEALS.map((m, i) => {
      const es = list.filter((e) => e.meal === i);
      const k = es.reduce((a, e) => a + nutOf(e.n, e.g).kcal, 0);
      const prevMeal = prev.filter((e) => e.meal === i);
      return `<div class="card meal">
        <div class="meal-h"><div><h3 style="display:inline">${m}</h3><span class="k num">${es.length ? fmt(k) + ' kcal' : ''}</span></div>
        <button class="addmini" data-act="addTo" data-meal="${i}" aria-label="Zu ${m} hinzufügen">${ic('plus')}</button></div>
        ${es.length ? es.map((e) => `<button class="item" data-act="entry" data-id="${e.id}">${thumb(e)}<span class="tx"><span class="n">${esc(e.name)}</span><span class="s num">${e.src === 'Schnell' ? 'ohne Lebensmittel' : fmt(e.g) + ' g'}${e.brand ? ' · ' + esc(e.brand) : ''}</span></span><span class="kc">${fmt(nutOf(e.n, e.g).kcal)}</span></button>`).join('')
          : `<div class="empty">Noch nichts eingetragen.${prevMeal.length ? ` <button class="linkbtn" data-act="repeat" data-meal="${i}">Wie am Vortag (${prevMeal.length})</button>` : ''}</div>`}
      </div>`;
    }).join('');
    return `<div class="pad">
      <div class="datebar"><button class="iconbtn" data-act="day" data-d="-1" aria-label="Vortag">${ic('back')}</button>
        <button data-act="pickday" style="border:0;background:none;text-align:center"><strong>${dayLabel(S.day)}</strong><div class="lbl" style="text-transform:none;letter-spacing:0;font-weight:500">${dateLong(S.day)}</div></button>
        <button class="iconbtn" data-act="day" data-d="1" aria-label="Nächster Tag">${ic('fwd')}</button></div>
      <div class="heute-grid"><div class="sticky">
      <div class="card sumcard" data-act="details" role="button" tabindex="0" aria-label="Alle Nährwerte des Tages ansehen">
        <div class="summary">
          <div class="ring" role="img" aria-label="${fmt(t.kcal)} von ${fmt(goal)} kcal"><svg viewBox="0 0 128 128"><circle cx="64" cy="64" r="54" stroke="var(--surface2)" stroke-width="12" fill="none"/><circle cx="64" cy="64" r="54" stroke="${left < 0 ? 'var(--danger)' : 'var(--accent)'}" stroke-width="12" fill="none" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg>
            <div class="mid"><span class="big num">${fmt(Math.abs(left))}</span><span class="small">${left < 0 ? 'kcal drüber' : 'kcal übrig'}</span></div></div>
          <div class="macros">${macro('prot', 'Eiweiß', '--prot')}${macro('carb', 'Kohlenhydrate', '--carb')}${macro('fat', 'Fett', '--fat')}</div>
        </div>
        <div class="kpis"><div><b class="num">${fmt(goal)}</b><span>Ziel${G.custom ? ' ' + WD[G.wd] : ''}</span></div><div><b class="num">${fmt(t.kcal)}</b><span>Gegessen</span></div><div><b class="num">${fmt(Math.max(left, 0))}</b><span>Übrig</span></div></div>
        ${left < 0 ? `<div style="font-size:12.5px;color:var(--muted);text-align:center">Ein Tag drüber ist okay, wenn die Woche passt.</div>` : ''}
        <div class="more">Alle Nährwerte ${ic('fwd')}</div>
      </div>
      ${S.day !== today() ? `<button class="btn sec" data-act="gotoday">Zu heute springen</button>` : ''}
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
      <div style="font-size:13px;color:var(--muted);margin-top:-6px">${esc(dateLong(c.date))} · ${list.length} ${list.length === 1 ? 'Eintrag' : 'Einträge'}</div>
      ${list.length ? `
      <div class="card"><div class="lbl">Energie und Makros</div>${main}
        <div class="fine" style="margin:0;text-align:left">Zucker und gesättigte Fette höchstens 10 % der Kalorien (WHO), Ballaststoffe mindestens 30 g und Salz höchstens 6 g (DGE).</div></div>
      <div class="card"><div class="lbl">Vitamine und Mineralstoffe</div>
        ${micro || `<div class="empty" style="padding:0">Für die heutigen Lebensmittel sind keine Vitamine oder Mineralstoffe hinterlegt.</div>`}
        ${unknown.length && known.length ? `<div class="fine" style="margin:0;text-align:left">Keine Angaben: ${unknown.map((m) => m.l).join(', ')}.</div>` : ''}
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
  const pool = [...S.foods.values(), ...BASIS];
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
      return S.combos.length ? `<div class="list">${S.combos.map(comboItem).join('')}</div>` : `<div class="empty" style="padding:4px 2px">Noch keine gespeicherten Mahlzeiten. Wähl ein Lebensmittel und tippe auf „Noch etwas dazu“. So stellst du z. B. Pommes mit Mayo und Ketchup zusammen und kannst sie dir merken.</div>`;
    }
    if (S.addTab === 'Rezepte') { list = [...S.foods.values()].filter((f) => f.src === 'Rezept').sort((a, b) => a.name.localeCompare(b.name, 'de')); extra = `<button class="btn sec" data-act="newrecipe">${ic('pot')} Neues Rezept</button>`; }
    const empty = { Zuletzt: 'Hier erscheint, was du zuletzt gegessen hast. Such oben nach einem Lebensmittel oder scanne einen Barcode.', Favoriten: 'Noch keine Favoriten. Tippe in einem Produkt auf den Stern.', Eigene: 'Noch keine eigenen Lebensmittel.', Rezepte: 'Noch keine Rezepte.' }[S.addTab];
    return `${list.length ? `<div class="list">${list.map(resultItem).join('')}</div>` : `<div class="empty" style="padding:4px 2px">${empty}</div>`}${extra}`;
  }
  const quick = /^\d{1,4}$/.test(q) && S.pickFor !== 'recipe' ? `<button class="btn sec" data-act="quick" data-k="${q}">${ic('plus')} ${q} kcal als Schnell-Eintrag zu ${MEALS[S.addMeal]}</button>` : '';
  if (quick) return quick + `<div class="empty" style="padding:0">Für Kalorien ohne Lebensmittel, z. B. im Restaurant.</div>`;
  const local = localSearch(q);
  const localIds = new Set(local.map((f) => f.id));
  let html = `<div class="sec-h"><span class="lbl">Auf dem Gerät</span><span class="lbl num">${local.length}</span></div>`;
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
function basketTotals() { return totals(S.basket.items); }
function basketCard() {
  const b = S.basket, t = basketTotals();
  return `<div class="card basket" id="basket">
    <div class="sec-h"><span class="lbl">${b.name ? esc(b.name) : 'Deine Mahlzeit'}</span><button class="linkbtn" data-act="basketDrop">Verwerfen</button></div>
    <div>${b.items.map((i, ix) => `<div class="ing">${thumb(i)}<div style="min-width:0"><div class="n">${esc(i.name)}</div><div class="s num" id="bk${ix}">${fmt(nutOf(i.n, i.g).kcal)} kcal</div></div><span class="in" style="display:flex;align-items:center;gap:4px"><input data-bg="${ix}" inputmode="decimal" value="${inVal(i.g)}" aria-label="Menge ${esc(i.name)} in Gramm"><span class="u" style="font-size:12px;color:var(--muted)">g</span></span><button class="x" data-act="basketRm" data-ix="${ix}" aria-label="Entfernen">${ic('close')}</button></div>`).join('')}</div>
    <div class="calc"><div class="k"><b id="bt-kcal">${fmt(t.kcal)}</b><span>kcal</span></div><div><b id="bt-prot">${fmt(t.prot, 1)}</b><span>Eiweiß</span></div><div><b id="bt-carb">${fmt(t.carb, 1)}</b><span>Kohlenh.</span></div><div><b id="bt-fat">${fmt(t.fat, 1)}</b><span>Fett</span></div></div>
    <div style="font-size:13px;color:var(--muted)">Noch etwas dazu? Einfach unten suchen oder scannen.</div>
    <label class="check"><input type="checkbox" id="b-keep" ${b.comboId ? 'checked' : ''}> <span>Als Mahlzeit merken, um sie später mit einem Tipp einzutragen</span></label>
    <div class="field" id="b-namebox" ${b.comboId ? '' : 'hidden'}><label for="b-name">Name der Mahlzeit</label><input id="b-name" value="${esc(b.name || '')}" placeholder="z. B. Pommes mit Mayo und Ketchup"></div>
    <button class="btn" data-act="basketSave">${ic('check')} Alles zu ${MEALS[S.addMeal]} eintragen</button>
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
    const picking = S.pickFor === 'recipe';
    return `${topbar(picking ? 'Zutat wählen' : 'Hinzufügen')}
    <div class="pad" style="padding-top:0">
      ${picking ? '' : `<div class="mealpick">zu <button class="chip on" data-act="mealmenu">${MEALS[S.addMeal]} ▾</button> · ${dayLabel(S.day)}</div>`}
      ${S.basket && !picking ? basketCard() : ''}
      <form class="search" role="search" data-form="search">${ic('search')}<input id="q" type="search" enterkeyhint="search" placeholder="Lebensmittel, Marke oder Rezept" value="${esc(S.q)}" autocomplete="off" aria-label="Suchen"></form>
      <div class="bigbtns">
        <button data-act="scan"><span class="ic">${ic('scan')}</span><span>Scannen<small>Barcode</small></span></button>
        <button data-act="photo"><span class="ic">${ic('cam')}</span><span>Foto<small>Nährwerttabelle</small></span></button>
      </div>
      <div class="chips" id="tabs" ${S.q ? 'hidden' : ''}>${['Zuletzt', 'Favoriten', 'Mahlzeiten', 'Eigene', 'Rezepte'].map((t) => `<button class="chip ${S.addTab === t ? 'on' : ''}" data-act="tab" data-t="${t}">${t}</button>`).join('')}</div>
      <div id="results" style="display:flex;flex-direction:column;gap:10px">${searchResults()}</div>
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
      <div class="hero">${thumb(f)}<div style="min-width:0"><h3>${esc(f.name)}</h3><div class="s">${f.brand ? esc(f.brand) + ' ·' : ''} ${srcBadge(f)}${f.barcode ? ` <span class="num">EAN ${esc(f.barcode)}</span>` : ''}</div></div></div>
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
      ${f.src === 'Rezept' && f.recipe?.steps?.length ? `<button class="btn sec" data-act="openCook" data-id="${esc(f.id)}">${ic('timer')} Zubereitung ansehen (${f.recipe.steps.length} ${f.recipe.steps.length === 1 ? 'Schritt' : 'Schritte'})</button>` : ''}
      ${e ? `<div class="row2"><button class="btn sec" data-act="copyEntry">${ic('copy')} Kopieren</button><button class="btn danger" data-act="del">${ic('trash')} Löschen</button></div>` : ''}
    </div>
    <div class="foot">${e ? `<button class="btn" data-act="saveEntry">Änderungen speichern</button>`
      : S.basket ? `<button class="btn" data-act="saveEntry">${ic('plus')} Zur Mahlzeit hinzufügen</button>`
      : `<button class="btn" data-act="saveEntry">Zu ${MEALS[meal]} hinzufügen</button>${quickE ? '' : `<button class="btn ghost" data-act="addMore">${ic('plus')} Noch etwas dazu (z. B. Soße, Getränk)</button>`}`}</div>`;
  },
};
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
      ${S.checks.length ? `<div class="list">${S.checks.map((h) => `<button class="item" data-act="checkOpen" data-id="${esc(h.id)}">${thumb(h)}<span class="tx"><span class="n">${esc(h.name)}</span><span class="s">${h.kind === 'cos' ? 'Kosmetik' : 'Lebensmittel'}${h.brand ? ' · ' + esc(h.brand) : ''}</span></span><span class="cbadges">${[3, 2].map((lv) => (h.counts?.[lv] ? `<span class="cb" style="background:${ING.LEVELS[lv].c}">${h.counts[lv]}</span>` : '')).join('')}</span></button>`).join('')}</div>` : `<div class="empty" style="padding:0">Noch nichts geprüft.</div>`}
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
    const n = c.range === 'month' ? 30 : 7;
    c.from = addDays(today(), -(n - 1));
    c.list = await db.range('entries', 'date', c.from, today());
    c.weights = (await db.all('weights')).sort((a, b) => a.date.localeCompare(b.date));
  },
  html() {
    const c = cur(), n = c.range === 'month' ? 30 : 7;
    const days = Array.from({ length: n }, (_, i) => addDays(c.from, i));
    const goals = days.map((d) => goalFor(d).kcal), goal = Math.max(...goals), same = goals.every((g) => g === goals[0]);
    const per = new Map(days.map((d) => [d, []]));
    c.list.forEach((e) => per.get(e.date)?.push(e));
    const tots = days.map((d) => totals(per.get(d)));
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
    // Gewicht
    const ws = c.weights.slice(-12);
    let wchart = `<div class="empty" style="padding:0">Noch kein Gewicht eingetragen.</div>`;
    if (ws.length) {
      const vals = ws.map((w) => w.kg);
      const mn = Math.floor(Math.min(...vals) - 1), mx = Math.ceil(Math.max(...vals) + 1);
      const H2 = 140, y2 = (v) => 10 + (H2 - 32) * (1 - (v - mn) / (mx - mn)), x2 = (i) => (ws.length === 1 ? (pl + W) / 2 : pl + i * ((W - pl - 10) / (ws.length - 1)));
      const pts = ws.map((w, i) => `${x2(i)},${y2(w.kg)}`).join(' ');
      const area = `${x2(0)},${H2 - 22} ${pts} ${x2(ws.length - 1)},${H2 - 22}`;
      const ticks = [mn, (mn + mx) / 2, mx].map((v) => `<line x1="${pl}" x2="${W}" y1="${y2(v)}" y2="${y2(v)}" stroke="var(--line)"/><text x="${pl - 5}" y="${y2(v) + 3}" text-anchor="end">${fmt(v)}</text>`).join('');
      const last = ws[ws.length - 1];
      wchart = `<svg viewBox="0 0 ${W} ${H2}" role="img" aria-label="Gewichtsverlauf">${ticks}${ws.length > 1 ? `<polygon points="${area}" fill="var(--accent-soft)"/><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>` : ''}${ws.map((w, i) => `<circle cx="${x2(i)}" cy="${y2(w.kg)}" r="${i === ws.length - 1 ? 5 : 2.5}" fill="${i === ws.length - 1 ? 'var(--accent)' : 'var(--surface)'}" stroke="var(--accent)" stroke-width="2"><title>${dateLong(w.date)}: ${fmt(w.kg, 1)} kg</title></circle>`).join('')}<text x="${x2(ws.length - 1)}" y="${y2(last.kg) - 10}" text-anchor="end" style="fill:var(--ink);font-weight:700">${fmt(last.kg, 1)} kg</text></svg>`;
    }
    const delta = ws.length > 1 ? ws[ws.length - 1].kg - ws[0].kg : null;
    return `${topbar('Verlauf')}
    <div class="pad" style="padding-top:0">
      <div class="chips"><button class="chip ${c.range !== 'month' ? 'on' : ''}" data-act="range" data-v="week">Woche</button><button class="chip ${c.range === 'month' ? 'on' : ''}" data-act="range" data-v="month">Monat</button></div>
      <div class="card chart"><div class="sec-h"><span class="lbl">Kalorien, letzte ${n} Tage</span><span class="num" style="font-size:13px;color:var(--muted)">Ø <b style="color:var(--ink)">${fmt(avg('kcal'))}</b> kcal</span></div>
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Kalorien pro Tag">${grid}${bars}${goalLine}</svg>
        <div class="legend"><span><i style="background:var(--accent)"></i>im Ziel</span><span><i style="background:var(--carb)"></i>über dem Ziel</span><span><i style="background:none;border-top:2px dashed var(--ink);border-radius:0;height:0;width:14px"></i>${same ? 'Ziel ' + fmt(goal) : 'Ziel je Tag'}</span></div></div>
      <div class="card"><div class="lbl">Durchschnitt an ${logged.length} ${logged.length === 1 ? 'Tag' : 'Tagen'} mit Einträgen</div>
        <div class="calc"><div class="k"><b>${fmt(avg('kcal'))}</b><span>kcal</span></div><div><b>${fmt(avg('prot'))}</b><span>Eiweiß g</span></div><div><b>${fmt(avg('carb'))}</b><span>Kohlenh. g</span></div><div><b>${fmt(avg('fat'))}</b><span>Fett g</span></div></div></div>
      <div class="card chart"><div class="sec-h"><span class="lbl">Gewicht</span>${delta != null ? `<span class="num" style="font-size:13px;color:${delta <= 0 ? 'var(--accent)' : 'var(--carb)'};font-weight:700">${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${fmt(Math.abs(delta), 1)} kg</span>` : ''}</div>
        ${wchart}
        <button class="btn sec" data-act="addWeight">${ic('plus')} Gewicht eintragen</button>
        ${c.weights.length ? `<button class="btn ghost" data-act="weightList" style="align-self:center">Alle Einträge</button>` : ''}</div>
    </div>`;
  },
};

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
      <div class="lbl">Profil und Ziel</div>
      <div class="setlist"><button class="setrow" data-act="openCalc">${ic('chart')}<span class="tx">Kalorien-Rechner<small>${p ? `${p.sex === 'w' ? 'Frau' : 'Mann'} · ${p.age} Jahre · ${fmt(p.height)} cm · ${fmt(p.weight, 1)} kg · ${esc(GOALS.find((g) => g[0] === p.goal)?.[1] || '')}` : 'Profil eintragen und Tagesziel berechnen'}</small></span>${ic('fwd')}</button></div>
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
      <div class="card"><div class="lbl">Kalorien pro Wochentag</div>
        <div style="font-size:13px;color:var(--muted)">Willst du an bestimmten Tagen mehr oder weniger essen, z. B. am Wochenende? Trag dort die Kalorien ein.</div>
        <div id="g-days" style="display:flex;flex-direction:column;gap:10px">
          <div class="wdays">${WD_ORDER.map((d) => `<div class="field"><label for="gd-${d}">${WD[d]}</label><input id="gd-${d}" inputmode="numeric" placeholder="${S.goal.kcal}" value="${(S.goal.perDay && S.goal.days?.[d]) || ''}" aria-label="Kalorien am ${WD_LONG[d]}"></div>`).join('')}</div>
          <div style="font-size:12.5px;color:var(--muted)">Leere Tage nutzen das normale Tagesziel (<span id="g-base">${fmt(S.goal.kcal)}</span> kcal). Eiweiß bleibt an jedem Tag gleich, Kohlenhydrate und Fett passen sich an.</div>
        </div>
        <button class="btn sec" data-act="saveSettings">${ic('check')} Wochentage speichern</button>
      </div>
      <div class="lbl">App</div>
      <div class="card"><div class="field"><label for="theme">Design</label><select id="theme">${[['system', 'Wie das Gerät'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([v, l]) => `<option value="${v}" ${S.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
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
    </div>`;
  },
  mount() { updateGoalSum(); },
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

/* Zoomen abschalten (Zwei-Finger- und Doppeltipp-Zoom, auch auf dem iPhone) */
['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || (e.scale && e.scale !== 1)) e.preventDefault(); }, { passive: false });

/* ---------- Aktionen ---------- */
// Karten, die wie Knöpfe funktionieren, auch per Tastatur öffnen
document.addEventListener('keydown', (ev) => {
  const t = ev.target;
  if ((ev.key === 'Enter' || ev.key === ' ') && t.getAttribute?.('role') === 'button' && t.dataset.act) { ev.preventDefault(); t.click(); }
});
document.addEventListener('click', async (ev) => {
  const tab = ev.target.closest('[data-tab]');
  if (tab) {
    const t = tab.dataset.tab;
    if (t === 'add') { S.pickFor = null; S.q = ''; S.addMeal = S.day === today() ? defaultMeal() : S.addMeal; }
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
    case 'addTo': S.addMeal = +a.dataset.meal; S.pickFor = null; S.q = ''; go('add'); break;
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
      backToAdd(); toast(`${f.name} ist in deiner Mahlzeit. Such jetzt das Nächste.`);
      break;
    }
    case 'basketRm': S.basket.items.splice(+a.dataset.ix, 1); if (!S.basket.items.length && !S.basket.comboId) S.basket = null; render(); break;
    case 'basketDrop': S.basket = null; render(); break;
    case 'useCombo': { const m = S.combos.find((x) => x.id === a.dataset.id); if (m) { S.basket = { items: structuredClone(m.items), comboId: m.id, name: m.name }; S.q = ''; render(true); } break; }
    case 'comboDel': {
      if (!(await ask(`Gespeicherte Mahlzeit „${S.basket.name}“ löschen? Bereits eingetragene Tage bleiben.`, 'Löschen'))) return;
      S.combos = S.combos.filter((x) => x.id !== S.basket.comboId); await setSetting('combos', S.combos);
      S.basket = null; render(); toast('Mahlzeit gelöscht');
      break;
    }
    case 'basketSave': {
      const b = S.basket;
      if (!b.items.length) return toast('Die Mahlzeit ist noch leer.', true);
      if (b.items.some((i) => !(i.g > 0))) return toast('Bitte bei jedem Teil eine Menge eintragen.', true);
      if ($('#b-keep').checked) {
        const name = $('#b-name').value.trim();
        if (!name) { $('#b-name').focus(); return toast('Bitte einen Namen für die Mahlzeit eintragen.', true); }
        const old = b.comboId && S.combos.find((x) => x.id === b.comboId);
        const m = { id: old && old.name === name ? old.id : uid(), name, items: structuredClone(b.items) };
        S.combos = [m, ...S.combos.filter((x) => x.id !== m.id)];
        await setSetting('combos', S.combos);
      }
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
      const auto = $('#g-auto').checked, days = {};
      for (const d of WD_ORDER) {
        const raw = $('#gd-' + d).value.trim();
        if (!raw) continue;
        const k = Math.round(num(raw));
        if (!(k >= 1200 && k <= 8000)) { $('#gd-' + d).focus(); return toast(`${WD_LONG[d]}: bitte zwischen 1.200 und 8.000 kcal eintragen.`, true); }
        days[d] = k;
      }
      const perDay = Object.keys(days).length > 0;
      if (auto) { S.goal = { ...S.goal, auto: true, perDay, days }; applyAuto(); }
      else if ($('#g-mode').dataset.mode === 'g') {
        const prot = Math.round(num($('#g-pg').value)), carb = Math.round(num($('#g-cg').value)), fat = Math.round(num($('#g-fg').value));
        if (![prot, carb, fat].every((v) => v >= 0)) return toast('Bitte für Eiweiß, Kohlenhydrate und Fett Gramm eintragen.', true);
        const mk = prot * 4 + carb * 4 + fat * 9, kcal = Math.round(num($('#g-kcal').value)) || mk;
        if (!(kcal >= 1200 && kcal <= 8000)) return toast('Bitte ein Tagesziel zwischen 1.200 und 8.000 kcal eintragen.', true);
        if (!(mk > 0)) return toast('Bitte Gramm für die Makros eintragen.', true);
        const pp = Math.round((prot * 400) / mk), cp = Math.round((carb * 400) / mk);
        S.goal = { kcal, auto: false, mode: 'g', split: { prot: pp, carb: cp, fat: 100 - pp - cp }, macros: { prot, carb, fat }, perDay, days };
      } else {
        const split = { prot: num0($('#g-prot').value), carb: num0($('#g-carb').value), fat: num0($('#g-fat').value) };
        const psum = split.prot + split.carb + split.fat;
        if (!(psum >= 50 && psum <= 150)) return toast(`Die Makros ergeben zusammen ${fmt(psum)} %. Bitte grob um die 100 % bleiben.`, true);
        const kcal = Math.round(num($('#g-kcal').value));
        if (!(kcal >= 1200 && kcal <= 8000)) return toast('Bitte ein Tagesziel zwischen 1.200 und 8.000 kcal eintragen.', true);
        S.goal = { kcal, auto: false, mode: 'pct', split, macros: null, perDay, days };
      }
      await setSetting('goal', S.goal);
      const nDays = perDay ? Object.keys(days).length : 0;
      render(); toast(`Gespeichert. Tagesziel ${fmt(S.goal.kcal)} kcal${nDays ? `, ${nDays} ${nDays === 1 ? 'Tag' : 'Tage'} mit eigenem Ziel` : ''}`);
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
  if (t.id === 'b-keep') { $('#b-namebox').hidden = !t.checked; if (t.checked) $('#b-name').focus(); }
  if (t.id === 'g-auto') { $('#g-manual').hidden = t.checked; updateGoalSum(); }
  if (t.id === 'theme') { S.theme = t.value; applyTheme(); await setSetting('theme', S.theme); }
});

$('#ingInput').addEventListener('change', (ev) => { const f = ev.target.files?.[0]; if (!f) return; if (cur().v === 'check') { go('checktext', { kind: S.ingKind || 'cos' }); } else cur().kind = S.ingKind || cur().kind; runIngOcr(f); });
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
  const [foods, profile, goal, favs, theme, combos, checks] = await Promise.all([db.all('foods'), getSetting('profile', null), getSetting('goal', null), getSetting('favs', []), getSetting('theme', 'system'), getSetting('combos', []), getSetting('checks', [])]);
  foods.forEach((f) => S.foods.set(f.id, f));
  S.profile = migrateProfile(profile);
  if (goal) S.goal = { ...S.goal, ...goal, split: { ...DEFAULT_SPLIT, ...(goal.split || {}) } };
  applyAuto();
  S.favs = new Set(favs);
  S.combos = combos || [];
  S.checks = checks || [];
  S.theme = theme; applyTheme();
  history.replaceState({ d: 1 }, '');
  S.stack = [{ v: profile ? 'heute' : 'welcome' }];
  await render(true);

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
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
