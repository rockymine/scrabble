// Gemeinsame Normalisierung für Wortliste (Erzeugung) und Wortprüfung (Browser).

export const MIN_LEN = 2;
export const MAX_LEN = 15; // Brettbreite

/** Großschreibung, ß → SS (es gibt keinen ß-Stein). Gibt '' für Leereingaben zurück. */
export function normalizeWord(raw) {
  return String(raw ?? '')
    .normalize('NFC')
    .trim()
    .toUpperCase()
    .replaceAll('ẞ', 'SS');
}

/** true, wenn das Wort nur aus Buchstaben besteht, die es als Stein gibt. */
export function isPlayableWord(w) {
  return /^[A-ZÄÖÜ]+$/.test(w);
}

/** Datei-Schlüssel für den Anfangsbuchstaben. */
export function shardKey(w) {
  const c = w[0];
  return c === 'Ä' ? 'AE' : c === 'Ö' ? 'OE' : c === 'Ü' ? 'UE' : c;
}
