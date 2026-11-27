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

// ---------- Herkunft (Grundform, Form, Bedeutung, Markierungen) ----------

const infoShards = new Map();
// Einteilung nach Markierungen (für die Hausregeln)
const OLD = /\bveraltet\b/;
const REGIONAL = /regional|mundartlich|landschaftlich|dialektal|süddeutsch|norddeutsch|mitteldeutsch|westdeutsch|ostdeutsch|schweizerisch|österreichisch|bairisch|bayrisch|schwäbisch|sächsisch|berlinisch|rheinisch|fränkisch|alemannisch|hessisch|westfälisch|pfälzisch|badisch|thüringisch|kölsch|wienerisch|tirolerisch|plattdeutsch|niederdeutsch|obersächsisch|ostpreußisch|schlesisch|lothringisch|elsässisch|luxemburgisch|südtirolerisch/i;
const RARE = /poetisch|selten|veraltend/;
export function classify(marks) {
  const m = marks.join(', ');
  return OLD.test(m) ? 'old' : REGIONAL.test(m) ? 'regional' : RARE.test(m) ? 'rare' : 'ok';
}

/** Zeile „WORT\t…“ per Binärsuche in einem sortierten Herkunfts-Text finden. */
export function findInfoLine(text, word) {
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const start = text.lastIndexOf('\n', mid - 1) + 1;
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    const tab = text.indexOf('\t', start);
    const key = text.slice(start, tab > -1 && tab < end ? tab : end);
    if (key === word) return text.slice(start, end);
    if (key < word) lo = end + 1;
    else hi = start;
  }
  return null;
}

/** Herkunftszeile in Objekte zerlegen. */
export function parseInfoLine(line) {
  if (!line) return [];
  const rest = line.slice(line.indexOf('\t') + 1);
  if (!rest) return [];
  return rest.split('\u001e').map((src) => {
    const [lemma, pos, forms, marks, gloss, tr, flags = ''] = src.split('\u001f');
    const markList = marks ? marks.split(', ') : [];
    const klass = classify(markList);
    return { lemma, pos, forms, marks: markList, gloss, translations: Number(tr) || 0, klass, rare: klass !== 'ok', short: flags === 'K' };
  });
}

/** Kurzbeschreibung, z. B. „Genitiv Singular von Glast (süddeutsch, poetisch)“. */
export function describeInfo(src) {
  const form = !src.forms || src.forms.startsWith('Grundform') ? `${src.lemma}${src.pos ? ', ' + src.pos : ''}` : `${src.forms.split(', ')[0]} von ${src.lemma}`;
  return form + (src.marks.length ? ` (${src.marks.join(', ')})` : '');
}

/** Herkunft eines Wortes laden (lädt bei Bedarf eine Datei je Anfangsbuchstabe). */
export async function wordInfo(raw) {
  const word = normalizeWord(raw);
  if (!word || !isPlayableWord(word) || !wordCheckSupported) return [];
  try {
    const index = await loadIndex();
    const key = shardKey(word);
    const meta = index.info?.[key];
    if (!meta) return [];
    if (!infoShards.has(key)) {
      const p = fetch(new URL(`${meta.file}?v=${index.version}`, BASE)).then((r) => {
        if (!r.ok) throw new Error('Herkunft nicht verfügbar');
        return gunzipText(r);
      });
      p.catch(() => infoShards.delete(key));
      infoShards.set(key, p);
    }
    return parseInfoLine(findInfoLine(await infoShards.get(key), word));
  } catch {
    return [];
  }
}

// ---------- Hausregeln ----------

/**
 * Hausregeln für die Wortprüfung (Filter auf die Wortliste).
 * Abkürzungen und Eigennamen (Orte, Länder, Flüsse, Personen) stehen ohnehin nie in der Liste.
 *   shortForms: Kurzwörter wie KITA, KRIPO, AZUBI erlaubt?
 *   old:        veraltete Wörter und Schreibweisen (SEYN, THEIL)  'allow' | 'warn' | 'deny'
 *   regional:   regional/mundartlich (DÄZ) – „nur Hochdeutsch“      'allow' | 'warn' | 'deny'
 *   rare:       selten/poetisch (GLASTS)                           'allow' | 'warn' | 'deny'
 *   allow/deny: eigene Ausnahmen (normalisierte Wörter)
 */
export const DEFAULT_RULES = Object.freeze({ shortForms: true, old: 'deny', regional: 'deny', rare: 'warn', allow: [], deny: [] });
const LEVELS = ['allow', 'warn', 'deny'];
const KLASS_TEXT = { old: 'Veraltet', regional: 'Regional bzw. Mundart', rare: 'Selten oder poetisch' };

export function normalizeRules(r) {
  const x = { ...DEFAULT_RULES, ...(r || {}) };
  x.allow = [...new Set((x.allow || []).map(normalizeWord).filter(Boolean))].sort();
  x.deny = [...new Set((x.deny || []).map(normalizeWord).filter(Boolean))].sort();
  for (const k of ['old', 'regional', 'rare']) if (!LEVELS.includes(x[k])) x[k] = DEFAULT_RULES[k];
  x.shortForms = x.shortForms !== false;
  return x;
}

/** Urteil nach Hausregeln aus Prüfergebnis + Herkunft (reine Funktion, testbar). */
export function applyRules(word, status, info, rules) {
  const r = normalizeRules(rules);
  if (r.deny.includes(word)) return { verdict: 'deny', reason: 'Bei euch nicht erlaubt (eigene Ausnahme)' };
  if (r.allow.includes(word)) return { verdict: 'ok', reason: 'Bei euch erlaubt (eigene Ausnahme)', custom: true };
  if (status !== 'found') return { verdict: status === 'missing' ? 'missing' : 'invalid', reason: '' };
  let sources = info || [];
  if (!r.shortForms && sources.length && sources.every((x) => x.short)) {
    return { verdict: 'deny', reason: 'Kurzwort – laut Hausregel nicht erlaubt' };
  }
  if (!r.shortForms) sources = sources.filter((x) => !x.short);
  if (!sources.length) return { verdict: 'ok', reason: '' };
  // Jede Grundform für sich bewerten; es zählt die günstigste (ein Wort mit einer
  // normalen Bedeutung ist erlaubt, auch wenn es zusätzlich eine veraltete hat)
  let best = null;
  for (const x of sources) {
    const klass = x.klass || 'ok';
    const level = klass === 'ok' ? 'allow' : r[klass];
    if (!best || LEVELS.indexOf(level) < LEVELS.indexOf(best.level)) best = { level, klass };
  }
  if (best.level === 'allow') return { verdict: 'ok', reason: '' };
  const what = KLASS_TEXT[best.klass];
  return best.level === 'deny'
    ? { verdict: 'deny', reason: `${what} – laut Hausregel nicht erlaubt`, klass: best.klass }
    : { verdict: 'warn', reason: `${what} – am Tisch absprechen`, klass: best.klass };
}

/** Wort prüfen inkl. Herkunft und Hausregeln. */
export async function judgeWord(raw, rules) {
  const res = await checkWord(raw);
  const info = res.status === 'found' ? await wordInfo(res.word) : [];
  return { ...res, info, ...applyRules(res.word, res.status, info, rules) };
}
