#!/usr/bin/env node
// Erzeugt die Offline-Wortliste aus dem deutschen Wiktionary-Dump von kaikki.org.
//
// Quelle:  https://kaikki.org/dewiktionary/raw-wiktextract-data.jsonl.gz
//          (Wiktextract-Auszug aus dem deutschsprachigen Wiktionary, CC BY-SA 4.0)
//
// Aufruf:  DUMP_DATE=JJJJ-MM-TT node tools/build-wordlist.mjs <pfad/zu/raw-wiktextract-data.jsonl.gz> [ausgabeordner]
//
// Ergebnis: ein gzip-komprimiertes, sortiertes Textfile pro Anfangsbuchstabe
// (A.txt.gz … Z.txt.gz, AE/OE/UE für Ä/Ö/Ü) plus index.json mit Metadaten.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { normalizeWord, shardKey, MIN_LEN, MAX_LEN } from '../js/normalize.js';

const input = process.argv[2];
const outDir = process.argv[3] || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'words', 'de');
if (!input) {
  console.error('Aufruf: node tools/build-wordlist.mjs <raw-wiktextract-data.jsonl.gz> [ausgabeordner]');
  process.exit(1);
}

// Wortarten, die im Scrabble nicht gelten (Namen, Abkürzungen, Wortgruppen, Affixe …)
const SKIP_POS = new Set([
  'name', 'abbrev', 'phrase', 'prefix', 'suffix', 'affix', 'infix', 'interfix',
  'circumfix', 'character', 'symbol', 'num', 'punct',
]);
// Formen mit diesen Tags werden ignoriert
const SKIP_FORM_TAGS = new Set(['abbreviation', 'symbol']);
// Einträge in alter Rechtschreibung überspringen
const SKIP_CATEGORY = /Alte Schreibweise/;

const words = new Set();
// Grundformen echter Wörter (für die Vokal-Regel: HM, PST, BRR bleiben)
const lemmas = new Set();
// Grundformen, die Abkürzungen sind (Lkw, BMW, GmbH …)
const abbrevLemmas = new Set();
// Beugungs-Einträge („Lkws“ → Lkw, „heb“ → heben): erst am Ende entscheiden
const pending = [];
let entries = 0;

const norm = (raw) => {
  if (typeof raw !== 'string') return '';
  const w = normalizeWord(raw);
  return w && w.length >= MIN_LEN && w.length <= MAX_LEN && /^[A-ZÄÖÜ]+$/.test(w) ? w : '';
};
// Komplett in Großbuchstaben geschrieben = Abkürzung (BH, LKW, SMS …)
const allCaps = (raw) => typeof raw === 'string' && raw.length >= 2 && raw === raw.toUpperCase() && raw !== raw.toLowerCase();

function add(raw) {
  const w = allCaps(raw) ? '' : norm(raw);
  if (w) words.add(w);
  return w;
}

const rl = readline.createInterface({
  input: fs.createReadStream(input).pipe(zlib.createGunzip()),
  crlfDelay: Infinity,
});

for await (const line of rl) {
  if (!line) continue;
  let e;
  try { e = JSON.parse(line); } catch { continue; }
  if (e.lang_code !== 'de') continue;
  const cats = e.categories || [];
  const contraction = e.pos_title === 'Kontraktion'; // IM, AM, ZUM, BEIM … sind erlaubt
  // Abkürzungen – auch solche, die als Substantiv geführt werden (Pkw, Kfz, GmbH …)
  const isAbbrev = !contraction && (
    e.pos === 'abbrev' || cats.includes('Abkürzung (Deutsch)') ||
    (e.tags || []).some((t) => t === 'abbreviation' || t === 'abbrev'));
  if (isAbbrev) { abbrevLemmas.add(e.word); continue; }
  if (SKIP_POS.has(e.pos) && !contraction) continue;
  if (cats.some((c) => SKIP_CATEGORY.test(c))) continue;
  entries++;

  const formOf = (e.senses || []).flatMap((s) => (s.form_of || []).map((f) => f.word)).filter(Boolean);
  if (formOf.length) {
    pending.push({ raw: e.word, lemmas: formOf });
    continue;
  }
  const w = add(e.word);
  if (w && cats.includes('Grundformeintrag (Deutsch)')) lemmas.add(w);
  for (const f of e.forms || []) {
    if ((f.tags || []).some((t) => SKIP_FORM_TAGS.has(t))) continue;
    add(f.form);
  }
}

// Beugungsformen nur übernehmen, wenn mindestens eine Grundform keine Abkürzung ist
let dropped = 0;
for (const p of pending) {
  if (p.lemmas.some((l) => !abbrevLemmas.has(l))) add(p.raw);
  else dropped++;
}
// Wörter ganz ohne Vokal sind fast immer Abkürzungen – außer echte Grundformen (HM, PST, BRR)
for (const w of words) {
  if (!/[AEIOUÄÖÜY]/.test(w) && !lemmas.has(w)) { words.delete(w); dropped++; }
}
console.log(`${dropped} Abkürzungsformen verworfen`);

const shards = new Map();
for (const w of words) {
  const k = shardKey(w);
  if (!shards.has(k)) shards.set(k, []);
  shards.get(k).push(w);
}

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) {
  if (f.endsWith('.txt.gz')) fs.unlinkSync(path.join(outDir, f));
}

const index = {
  version: new Date().toISOString().slice(0, 10).replaceAll('-', ''),
  generated: new Date().toISOString(),
  // Stand des Dumps (Last-Modified auf kaikki.org), z. B. DUMP_DATE=2026-11-01
  dumpDate: process.env.DUMP_DATE || null,
  source: 'Deutschsprachiges Wiktionary über kaikki.org (Wiktextract)',
  sourceUrl: 'https://kaikki.org/dewiktionary/',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  entries,
  count: words.size,
  shards: {},
};

let bytes = 0;
const contentHash = crypto.createHash('sha256');
for (const k of [...shards.keys()].sort()) {
  // Sortierung nach UTF-16-Codeeinheiten – identisch zum Vergleich im Browser.
  const list = shards.get(k).sort();
  contentHash.update(k + '\n' + list.join('\n') + '\n');
  const gz = zlib.gzipSync(list.join('\n') + '\n', { level: 9 });
  const file = `${k}.txt.gz`;
  fs.writeFileSync(path.join(outDir, file), gz);
  index.shards[k] = { file, count: list.length, bytes: gz.length };
  bytes += gz.length;
}
index.bytes = bytes;
// Version = Datum + Inhalts-Hash, damit Geräte eine geänderte Liste sicher neu laden
index.version += '-' + contentHash.digest('hex').slice(0, 8);
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');

console.log(`${entries} Einträge, ${words.size} Wörter, ${shards.size} Dateien, ${(bytes / 1048576).toFixed(1)} MB`);
