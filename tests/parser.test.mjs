// Aufruf: node tests/parser.test.mjs
import { parseNutrition, toNum } from '../js/parser.js';
import assert from 'node:assert/strict';
const L = (s, conf = 92) => s.trim().split('\n').map((text) => ({ text, conf }));
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', name); }

t('Standard-Tabelle deutsch', () => {
  const r = parseNutrition(L(`Nährwerte pro 100 g
Brennwert 1854 kJ / 442 kcal
Fett 17 g
- davon gesättigte Fettsäuren 1,9 g
Kohlenhydrate 58 g
- davon Zucker 3,1 g
Ballaststoffe 6,2 g
Eiweiß 11 g
Salz 1,4 g`));
  assert.deepEqual(r.values, { kj: 1854, kcal: 442, fat: 17, sat: 1.9, carb: 58, sugar: 3.1, fiber: 6.2, prot: 11, salt: 1.4 });
  assert.equal(r.check.ok, true);
  assert.deepEqual(r.unsure, {});
});

t('Zwei Spalten, Portion zuerst', () => {
  const r = parseNutrition(L(`Nährwerte pro Portion (30 g) pro 100 g
Energie 556 kJ 1854 kJ
133 kcal 442 kcal
Fett 5,1 g 17 g
davon gesättigte Fettsäuren 0,6 g 1,9 g
Kohlenhydrate 17 g 58 g
davon Zucker 0,9 g 3,1 g
Eiweiß 3,3 g 11 g
Salz 0,42 g 1,4 g`));
  assert.equal(r.values.kcal, 442); assert.equal(r.values.kj, 1854);
  assert.equal(r.values.fat, 17); assert.equal(r.values.salt, 1.4); assert.equal(r.values.sat, 1.9);
});

t('OCR-Fehler O statt 0 und Leerzeichen im Komma', () => {
  const r = parseNutrition(L(`Brennwert 1569 kJ/ 375 kcal
Fett 7, 0 g
davon gesättigte Fettsäuren 1,O g
Kohlenhydrate 59 g
davon Zucker O,7 g
Eiweiß 13 g
Salz <0,01 g`));
  assert.equal(r.values.fat, 7); assert.equal(r.values.sat, 1); assert.equal(r.values.sugar, 0.7); assert.equal(r.values.salt, 0.01);
  assert.ok(r.unsure.salt);
});

t('Unplausibel wird markiert', () => {
  const r = parseNutrition(L(`Brennwert 1854 kJ / 442 kcal
Fett 17 g
davon gesättigte Fettsäuren 19 g
Kohlenhydrate 58 g
davon Zucker 3,1 g
Eiweiß 11 g
Salz 14 g`));
  assert.ok(r.unsure.sat);
});

t('Geringe Sicherheit wird markiert, fehlende Werte auch', () => {
  const r = parseNutrition([{ text: 'Energie 250 kcal', conf: 95 }, { text: 'Fett 9 g', conf: 40 }]);
  assert.ok(r.unsure.fat); assert.ok(r.unsure.prot); assert.equal(r.values.kj, 1046);
});

t('Englisch', () => {
  const r = parseNutrition(L(`Nutrition per 100g
Energy 2255kJ/539kcal
Fat 30.9g
of which saturates 10.6g
Carbohydrate 57.5g
of which sugars 56.3g
Protein 6.3g
Salt 0.107g`));
  assert.equal(r.values.fat, 30.9); assert.equal(r.values.sat, 10.6); assert.equal(r.values.sugar, 56.3); assert.equal(r.values.prot, 6.3); assert.equal(r.values.salt, 0.107);
});

t('toNum', () => { assert.equal(toNum('1.234,5'), 1234.5); assert.equal(toNum('1,4'), 1.4); assert.ok(isNaN(toNum(''))); });


t('Einheit g als 9 gelesen (systematisch, Werte in eigener Zeile)', () => {
  const r = parseNutrition(L(`Nährwerte
Brennwert
pro 100 g
1854 kJ / 442 kcal
Fett
179g
davon gesättigte Fettsäuren
1,99
Kohlenhydrate
589g
davon Zucker
3,19
Ballaststoffe
6,29
Eiweiß
119g
Salz
1,49`));
  assert.deepEqual(r.values, { kj: 1854, kcal: 442, fat: 17, sat: 1.9, carb: 58, sugar: 3.1, fiber: 6.2, prot: 11, salt: 1.4 });
});

t('Einzelner Wert mit 9 statt g wird über kcal korrigiert', () => {
  const r = parseNutrition(L(`Durchschnittliche Nährwerte. Pro 100g _ pro Portion (30 g)
Energie 1569 kJ 471 kJ
375 kcal 113 kcal
Fett 7,0g 21g
- davon gesättigte Fettsäuren 122g 0,4g
Kohlenhydrate 59g 189g
- davon Zucker 0,7g 0,2g
Ballaststoffe 10g 3,0g
Eiweiß 139 3,99
Salz 0,02g <0,01g9`));
  assert.equal(r.values.prot, 13); assert.ok(r.unsure.prot); assert.equal(r.values.carb, 59); assert.equal(r.values.fat, 7);
  assert.ok(r.unsure.sat); // 122 > 7, nicht automatisch lösbar
});
console.log(n + ' Tests bestanden');
