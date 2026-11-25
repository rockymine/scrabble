// Deutsche Buchstabenwerte – für spätere Funktionen (z. B. Foto-Auswertung).
// In Version 1 gibt es bewusst KEINE automatische Punkteberechnung.

export const LETTER_VALUES = Object.freeze({
  E: 1, N: 1, S: 1, I: 1, R: 1, T: 1, U: 1, A: 1, D: 1,
  H: 2, G: 2, L: 2, O: 2,
  M: 3, B: 3, W: 3, Z: 3,
  C: 4, F: 4, K: 4, P: 4,
  Ä: 6, J: 6, Ü: 6, V: 6,
  Ö: 8, X: 8,
  Q: 10, Y: 10,
});

export const BLANK_VALUE = 0;

/** Summe der Steinwerte eines Wortes (ohne Prämienfelder). */
export function letterSum(word) {
  let sum = 0;
  for (const ch of String(word).toUpperCase()) sum += LETTER_VALUES[ch] ?? 0;
  return sum;
}
