// Kalorien- und Eiweiß-Rechner (Formeln wie im Muskelplan-Rechner).
// Nur ein Richtwert, keine medizinische Beratung.

// Alltag: Faktor, Name, Beschreibung, Schritte pro Tag
export const LIFE = [
  [1.2, 'Sitzend', 'Bürojob, kaum Wege zu Fuß', 'unter 5.000 Schritte'],
  [1.4, 'Wenig aktiv', 'meist sitzend, etwas Bewegung', '5.000–7.500 Schritte'],
  [1.5, 'Etwas aktiv', 'öfter auf den Beinen', '7.500–10.000 Schritte'],
  [1.6, 'Aktiv', 'stehender Beruf, viel unterwegs', '10.000–12.500 Schritte'],
  [1.8, 'Sehr aktiv', 'körperliche Arbeit', '12.500–15.000 Schritte'],
  [2.0, 'Extrem aktiv', 'schwere körperliche Arbeit', 'über 15.000 Schritte'],
];

// Ziel: Schlüssel, Name, kcal pro Tag
export const GOALS = [
  ['lose', 'Abnehmen', -500],
  ['cut', 'Nur Fett verlieren', -300],
  ['slow', 'Langsam abnehmen', -250],
  ['keep', 'Gewicht halten', 0],
  ['muscle', 'Muskelaufbau', 250],
  ['gain', 'Zunehmen', 500],
];
export const goalDelta = (k) => (GOALS.find((g) => g[0] === k) || GOALS[3])[2];
export const goalName = (k) => (GOALS.find((g) => g[0] === k) || GOALS[3])[1];

export const DEFAULT_PROFILE = { sex: 'm', age: 30, height: 175, weight: 75, life: 1.4, td: 3, goal: 'keep' };
export const DEFAULT_SPLIT = { prot: 25, carb: 45, fat: 30 };
export const KCAL_PER_KG = 7700;

// Alte Profile (Version 1.0.0) umwandeln
export function migrateProfile(p) {
  if (!p || p.life) return p;
  const q = { ...p };
  const act = p.activity || 1.375;
  q.life = LIFE.reduce((a, l) => (Math.abs(l[0] - act) < Math.abs(a - act) ? l[0] : a), 1.2);
  q.td = 3;
  q.goal = p.goal === 'lose' ? (p.rate <= 0.25 ? 'slow' : 'lose') : p.goal === 'gain' ? 'gain' : 'keep';
  delete q.activity; delete q.rate;
  return q;
}

export function checkProfile(p) {
  if (!(p.age >= 18 && p.age <= 110)) return p.age > 0 && p.age < 18 ? 'young' : 'Bitte ein Alter zwischen 18 und 110 eintragen.';
  if (!(p.height >= 120 && p.height <= 230)) return 'Bitte eine Größe zwischen 120 und 230 cm eintragen.';
  if (!(p.weight >= 30 && p.weight <= 300)) return 'Bitte ein Gewicht zwischen 30 und 300 kg eintragen.';
  return null;
}

const r10 = (v) => Math.round(v / 10) * 10;

export function calc(p) {
  const w = p.weight, bf = p.bf > 3 && p.bf < 60 ? p.bf : null;
  const lbm = bf ? w * (1 - bf / 100) : null; // fettfreie Masse
  const bmr = bf ? 370 + 21.6 * lbm : 10 * w + 6.25 * p.height - 5 * p.age + (p.sex === 'w' ? -161 : 5);
  const pal = Math.min(2.4, (p.life || 1.2) + (p.td || 0) * 0.05);
  const tdee = bmr * pal;
  const delta = goalDelta(p.goal);
  const floor = Math.max(bmr, 1200);
  const raw = tdee + delta;
  const target = r10(Math.max(raw, floor));
  const floored = raw < floor;
  const ref = p.gw >= 30 && p.gw <= 300 ? p.gw : w; // Eiweiß auf Zielgewicht beziehen
  const [lo, hi] = p.goal === 'cut' ? [2.0, 2.4] : [1.6, 2.0];
  const protLo = Math.round(ref * lo), protHi = Math.round(ref * hi), prot = Math.round((protLo + protHi) / 2);
  const fat = Math.round((target * 0.27) / 9);
  const carb = Math.max(0, Math.round((target - prot * 4 - fat * 9) / 4));
  const kgWeek = (Math.abs(target - tdee) * 7) / KCAL_PER_KG;

  // Zielgewicht
  let weeks = null, gwWarn = null;
  if (p.gw >= 30 && p.gw <= 300 && Math.abs(p.gw - w) >= 0.5) {
    const down = p.gw < w;
    if ((down && delta > 0) || (!down && delta < 0)) gwWarn = `Dein Zielgewicht ist ${down ? 'niedriger' : 'höher'} als jetzt, aber das Ziel heißt „${goalName(p.goal)}“.`;
    else if (delta === 0) gwWarn = 'Mit „Gewicht halten“ erreichst du kein anderes Zielgewicht.';
    else if (kgWeek > 0) weeks = Math.ceil(Math.abs(p.gw - w) / kgWeek);
  }
  // Körperfett-Ziel
  let bfGoal = null;
  if (lbm && p.bft > 3 && p.bft < 60) {
    const min = p.sex === 'w' ? 15 : 8;
    bfGoal = { weight: Math.round((lbm / (1 - p.bft / 100)) * 10) / 10, warn: p.bft < min ? `Unter etwa ${min} % Körperfett wird es für ${p.sex === 'w' ? 'Frauen' : 'Männer'} gesundheitlich heikel.` : null };
  }
  return { bmr: Math.round(bmr), method: bf ? 'Katch-McArdle' : 'Mifflin-St Jeor', lbm, pal, tdee: Math.round(tdee), maintain: r10(tdee), delta, target, floored, protLo, protHi, prot, fat, carb, kgWeek, weeks, gwWarn, bfGoal, ref };
}

export function goalText(p, r) {
  const d = r.delta;
  if (d === 0) return 'Du isst etwa so viel, wie du verbrauchst. Dein Gewicht bleibt ungefähr gleich.';
  const kg = r.kgWeek.toLocaleString('de-DE', { maximumFractionDigits: 2 });
  if (d < 0) return `${Math.abs(d)} kcal weniger als dein Bedarf pro Tag. Das sind etwa ${kg} kg ${p.goal === 'cut' ? 'Fett ' : ''}pro Woche.${p.goal === 'cut' ? ' Mit viel Eiweiß und Krafttraining bleiben die Muskeln.' : ''}`;
  return `${d} kcal mehr als dein Bedarf pro Tag. Das sind etwa ${kg} kg pro Woche.${p.goal === 'muscle' ? ' Ein kleines Plus reicht, damit vor allem Muskeln dazukommen.' : ''}`;
}

// Echter Bedarf aus Gewichtsverlauf und gezählten Kalorien
// weights: [{date, kg}], eaten: [{date, kcal}] (nur Tage mit Einträgen)
export function trend(weights, eaten, p, todayStr) {
  const day = (s) => Math.round(new Date(s + 'T12:00:00') / 864e5);
  const t0 = day(todayStr) - 35;
  const ws = weights.filter((w) => day(w.date) >= t0);
  if (ws.length < 3) return { reason: `Dafür braucht es mindestens 3 Gewichts-Einträge in den letzten 5 Wochen (bisher ${ws.length}).` };
  const xs = ws.map((w) => day(w.date)), ys = ws.map((w) => w.kg);
  const span = Math.max(...xs) - Math.min(...xs);
  if (span < 14) return { reason: 'Die Gewichts-Einträge müssen mindestens 14 Tage auseinanderliegen.' };
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0); // kg pro Tag
  const days = eaten.filter((e) => day(e.date) >= t0 && day(e.date) <= day(todayStr) - 1 && e.kcal >= 800);
  if (days.length < 7) return { reason: `Dafür braucht es mindestens 7 vollständig eingetragene Tage in den letzten 5 Wochen (bisher ${days.length}).` };
  const avg = days.reduce((a, e) => a + e.kcal, 0) / days.length;
  const kgWeek = slope * 7;
  const real = avg - (kgWeek * KCAL_PER_KG) / 7;
  const r = calc(p);
  const adapted = Math.round(Math.max(real + r.delta, r.bmr, 1200) / 50) * 50;
  return { ok: true, kgWeek, avg: Math.round(avg), real: Math.round(real / 10) * 10, adapted, days: days.length, entries: ws.length };
}

export function macroGrams(kcal, split) {
  return {
    prot: Math.round((kcal * split.prot) / 100 / 4),
    carb: Math.round((kcal * split.carb) / 100 / 4),
    fat: Math.round((kcal * split.fat) / 100 / 9),
  };
}
