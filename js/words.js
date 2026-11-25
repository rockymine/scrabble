// Offline-Wortprüfung. Ergebnis ist nur ein Hinweis – gewertet werden darf immer.
//
// Die Wortliste liegt als ein gzip-Textfile pro Anfangsbuchstabe unter words/de/.
// Jede Datei ist sortiert (UTF-16-Reihenfolge), ein Wort pro Zeile. Gesucht wird
// per Binärsuche direkt im Text – ohne große Arrays/Sets im Speicher.

import { normalizeWord, isPlayableWord, shardKey, MIN_LEN, MAX_LEN } from './normalize.js';

const BASE = new URL('../words/de/', import.meta.url);
let indexPromise = null;
const shards = new Map(); // key -> Promise<string>

export const wordCheckSupported = typeof DecompressionStream !== 'undefined';

export function loadIndex() {
  indexPromise ??= fetch(new URL('index.json', BASE)).then((r) => {
    if (!r.ok) throw new Error('Wortliste nicht gefunden');
    return r.json();
  });
  indexPromise.catch(() => (indexPromise = null));
  return indexPromise;
}

function shardUrl(index, key) {
  const s = index.shards[key];
  return s ? new URL(`${s.file}?v=${index.version}`, BASE) : null;
}

async function gunzipText(res) {
  const stream = res.body.pipeThrough(new DecompressionStream('gzip')).pipeThrough(new TextDecoderStream());
  let text = '';
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += value;
  }
  return text;
}

function loadShard(index, key) {
  if (!shards.has(key)) {
    const url = shardUrl(index, key);
    const p = url
      ? fetch(url).then((r) => {
          if (!r.ok) throw new Error('Wortliste konnte nicht geladen werden');
          return gunzipText(r);
        })
      : Promise.resolve('');
    p.catch(() => shards.delete(key));
    shards.set(key, p);
  }
  return shards.get(key);
}

/** Binärsuche nach einer ganzen Zeile in einem sortierten, \n-getrennten Text. */
export function containsLine(text, word) {
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const start = text.lastIndexOf('\n', mid - 1) + 1;
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    const line = text.slice(start, end);
    if (line === word) return true;
    if (line < word) lo = end + 1;
    else hi = start;
  }
  return false;
}

/**
 * @returns {Promise<{status: 'found'|'missing'|'invalid'|'unavailable', word: string, reason?: string}>}
 */
export async function checkWord(raw) {
  const word = normalizeWord(raw);
  if (!word) return { status: 'invalid', word, reason: 'Kein Wort eingegeben' };
  if (!isPlayableWord(word)) return { status: 'invalid', word, reason: 'Nur Buchstaben erlaubt' };
  if (word.length < MIN_LEN) return { status: 'invalid', word, reason: 'Zu kurz' };
  if (word.length > MAX_LEN) return { status: 'invalid', word, reason: `Länger als ${MAX_LEN} Buchstaben` };
  if (!wordCheckSupported) return { status: 'unavailable', word, reason: 'Browser zu alt für die Wortprüfung' };
  try {
    const index = await loadIndex();
    const text = await loadShard(index, shardKey(word));
    return { status: containsLine(text, word) ? 'found' : 'missing', word };
  } catch (e) {
    return { status: 'unavailable', word, reason: 'Wortliste nicht verfügbar' };
  }
}

/** Alle Teile der Wortliste laden (füllt den Offline-Speicher des Service Workers). */
export async function downloadAll(onProgress) {
  const index = await loadIndex();
  const keys = Object.keys(index.shards);
  let done = 0;
  for (const k of keys) {
    const url = shardUrl(index, k);
    const r = await fetch(url);
    if (!r.ok) throw new Error('Download fehlgeschlagen');
    await r.arrayBuffer();
    onProgress?.(++done, keys.length);
  }
  return index;
}

/** Wie viele Teile liegen schon im Offline-Speicher? */
export async function offlineStatus() {
  const index = await loadIndex();
  const keys = Object.keys(index.shards);
  if (!('caches' in globalThis)) return { index, cached: 0, total: keys.length };
  let cached = 0;
  for (const k of keys) {
    if (await caches.match(shardUrl(index, k).href)) cached++;
  }
  return { index, cached, total: keys.length };
}
