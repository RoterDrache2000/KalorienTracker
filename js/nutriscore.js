// Nutri-Score aus den Nährwerten pro 100 g ausrechnen (Grundverfahren für feste Lebensmittel).
// Obst-/Gemüseanteil ist meist unbekannt und zählt deshalb mit 0. Ergebnis: 'a' bis 'e' oder null.
const steps = (v, list) => list.filter((t) => v > t).length;

export function nutriScore(n) {
  if (!n || [n.kcal, n.sugar, n.sat, n.salt].some((v) => v == null || isNaN(v))) return null;
  const kj = n.kj > 0 ? n.kj : n.kcal * 4.184;
  const neg = steps(kj, [335, 670, 1005, 1340, 1675, 2010, 2345, 2680, 3015, 3350])
    + steps(n.sugar, [4.5, 9, 13.5, 18, 22.5, 27, 31, 36, 40, 45])
    + steps(n.sat, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    + steps(n.salt * 400, [90, 180, 270, 360, 450, 540, 630, 720, 810, 900]); // Natrium in mg = Salz in g × 400
  const fiber = steps(n.fiber || 0, [0.9, 1.9, 2.8, 3.7, 4.7]);
  const prot = steps(n.prot || 0, [1.6, 3.2, 4.8, 6.4, 8.0]);
  const score = neg >= 11 ? neg - fiber : neg - fiber - prot;
  return score <= -1 ? 'a' : score <= 2 ? 'b' : score <= 10 ? 'c' : score <= 18 ? 'd' : 'e';
}
