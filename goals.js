// Tagesziel aus Profil (Mifflin-St-Jeor). Nur ein Richtwert, keine medizinische Beratung.
export const ACTIVITY = [
  [1.2, 'Kaum aktiv', 'Bürojob, wenig Bewegung'],
  [1.375, 'Leicht aktiv', '1–3× Sport pro Woche'],
  [1.55, 'Mäßig aktiv', '3–5× Sport pro Woche'],
  [1.725, 'Sehr aktiv', '6–7× Sport pro Woche'],
  [1.9, 'Extrem aktiv', 'körperliche Arbeit und Sport'],
];
export const GOALS = { lose: 'Abnehmen', keep: 'Gewicht halten', gain: 'Zunehmen' };
export const RATES = [0.25, 0.5, 0.75];

export const DEFAULT_PROFILE = { sex: 'm', age: 30, height: 175, weight: 75, activity: 1.375, goal: 'keep', rate: 0.5 };
export const DEFAULT_SPLIT = { prot: 25, carb: 45, fat: 30 };

export function bmr(p) {
  const base = 10 * p.weight + 6.25 * p.height - 5 * p.age;
  return p.sex === 'w' ? base - 161 : base + 5;
}

export function suggestKcal(p) {
  const tdee = bmr(p) * (p.activity || 1.2);
  const delta = (p.rate || 0) * 7700 / 7;
  let k = p.goal === 'lose' ? tdee - delta : p.goal === 'gain' ? tdee + delta : tdee;
  k = Math.max(k, 1200); // nie unter 1.200 kcal
  return Math.round(k / 10) * 10;
}

export function macroGrams(kcal, split) {
  return {
    prot: Math.round((kcal * split.prot) / 100 / 4),
    carb: Math.round((kcal * split.carb) / 100 / 4),
    fat: Math.round((kcal * split.fat) / 100 / 9),
  };
}
