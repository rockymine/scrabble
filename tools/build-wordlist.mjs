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
  'circumfix', 'character', 'symbol', 'punct',
]);
// Formen mit diesen Tags werden ignoriert
const SKIP_FORM_TAGS = new Set(['abbreviation', 'symbol']);
// Einträge in alter Rechtschreibung überspringen
const SKIP_CATEGORY = /Alte Schreibweise/;

const words = new Set();
// Grundformen echter Wörter (normalisiert; für die Vokal-Regel: HM, PST, BRR bleiben)
const lemmas = new Set();
// Grundform-Einträge, die in die Liste aufgenommen wurden (Originalschreibung) → Infos
const lemmaInfo = new Map();
// Beugungs-Einträge („Glasts“ → Glast, „heb“ → heben): erst am Ende entscheiden
const pending = [];
// Herkunft je Wort: Map<Wort, Map<Grundform, Set<Formbeschreibung>>>
const origin = new Map();
let entries = 0;

// ---------- Übersetzungen für die Herkunftsangabe ----------
const POS_DE = {
  noun: 'Substantiv', verb: 'Verb', adj: 'Adjektiv', adv: 'Adverb', intj: 'Interjektion',
  pron: 'Pronomen', prep: 'Präposition', conj: 'Konjunktion', particle: 'Partikel', det: 'Artikel',
  postp: 'Postposition', abbrev: 'Kontraktion', num: 'Zahlwort',
};
const TAG_DE = {
  'first-person': '1. Person', 'second-person': '2. Person', 'third-person': '3. Person',
  nominative: 'Nominativ', genitive: 'Genitiv', dative: 'Dativ', accusative: 'Akkusativ',
  singular: 'Singular', plural: 'Plural', present: 'Präsens', past: 'Präteritum',
  'subjunctive-i': 'Konjunktiv I', 'subjunctive-ii': 'Konjunktiv II', imperative: 'Imperativ',
  infinitive: 'Infinitiv', participle: 'Partizip', 'participle-2': 'Partizip II',
  comparative: 'Komparativ', superlative: 'Superlativ', strong: 'stark', weak: 'schwach', mixed: 'gemischt',
  masculine: 'maskulin', feminine: 'feminin', neuter: 'neutrum', diminutive: 'Verkleinerung',
  alternative: 'Nebenform', extended: 'erweiterter Infinitiv',
};
// Markierungen, die auf seltene/eingeschränkte Wörter hinweisen
const MARK_DE = {
  archaic: 'veraltet', obsolete: 'veraltet', outdated: 'veraltet', poetic: 'poetisch', rare: 'selten',
  regional: 'regional', dialectal: 'mundartlich', 'South-German': 'süddeutsch', 'North-German': 'norddeutsch',
  Switzerland: 'schweizerisch', 'Austrian German': 'österreichisch', Austria: 'österreichisch',
  colloquial: 'umgangssprachlich', slang: 'salopp', vulgar: 'vulgär', derogatory: 'abwertend',
  figurative: 'übertragen', jargon: 'Jargon', humorous: 'scherzhaft', 'Bavarian': 'bairisch',
};

const norm = (raw) => {
  if (typeof raw !== 'string') return '';
  const w = normalizeWord(raw);
  return w && w.length >= MIN_LEN && w.length <= MAX_LEN && /^[A-ZÄÖÜ]+$/.test(w) ? w : '';
};
// Komplett in Großbuchstaben geschrieben = Abkürzung (BH, LKW, SMS …)
const allCaps = (raw) => typeof raw === 'string' && raw.length >= 2 && raw === raw.toUpperCase() && raw !== raw.toLowerCase();

function note(w, lemma, desc) {
  let m = origin.get(w);
  if (!m) origin.set(w, (m = new Map()));
  let s = m.get(lemma);
  if (!s) m.set(lemma, (s = new Set()));
  if (desc && s.size < 3) s.add(desc);
}

function add(raw, lemma, desc) {
  const w = allCaps(raw) ? '' : norm(raw);
  if (!w) return '';
  words.add(w);
  if (lemma) note(w, lemma, desc);
  return w;
}

const formDesc = (tags = []) => tags.map((t) => TAG_DE[t]).filter(Boolean).join(' ') || 'Nebenform';

function senseMarks(senses = []) {
  const marks = new Set();
  const first = senses[0] || {};
  for (const t of first.tags || []) if (MARK_DE[t]) marks.add(MARK_DE[t]);
  for (const t of first.raw_tags || []) if (t.length <= 24 && !/^(sonst|speziell|besonders|meist|oft|auch)\b/.test(t)) marks.add(t);
  return [...marks].slice(0, 3);
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
  if (isAbbrev) continue;
  if (SKIP_POS.has(e.pos) && !contraction) continue;
  if (cats.some((c) => SKIP_CATEGORY.test(c))) continue;
  entries++;

  const senses = e.senses || [];
  const formOf = senses.flatMap((s) => (s.form_of || []).map((f) => f.word)).filter(Boolean);
  if (formOf.length) {
    // „Genitiv Singular des Substantivs Glast“ → „Genitiv Singular“;
    // „… der starken Flexion des Partizips II des Verbs okulieren“ → „… des Partizips II“
    const gloss = (senses.find((s) => s.form_of)?.glosses || [''])[0]
      .replace(/\s+de[sr] (Substantivs|Verbs|Adjektivs|Pronomens|Artikels|Numerales?)\s.*$/, '');
    pending.push({ raw: e.word, lemmas: formOf, desc: gloss || 'Beugungsform' });
    continue;
  }
  const lemma = e.word;
  if (!lemmaInfo.has(lemma)) {
    const gloss = (senses.find((s) => s.glosses?.length)?.glosses || [''])[0];
    lemmaInfo.set(lemma, {
      pos: POS_DE[e.pos] || e.pos_title || '',
      gloss: gloss.length > 90 ? gloss.slice(0, 88).replace(/\s+\S*$/, '') + ' …' : gloss,
      marks: senseMarks(senses),
      tr: (e.translations || []).length,
    });
  }
  const w = add(e.word, lemma, 'Grundform');
  if (w && cats.includes('Grundformeintrag (Deutsch)')) lemmas.add(w);
  for (const f of e.forms || []) {
    if ((f.tags || []).some((t) => SKIP_FORM_TAGS.has(t))) continue;
    add(f.form, lemma, formDesc(f.tags));
  }
}

// Beugungsformen nur übernehmen, wenn ihre Grundform selbst aufgenommen wurde
// (verwirft Formen von Abkürzungen, Orts- und Personennamen, z. B. „Leuns“ von Leun)
// Ketten auflösen: „okulierte“ → „okuliert“ (Partizip II, selbst Beugungsform) → „okulieren“
const pendingByRaw = new Map();
for (const p of pending) pendingByRaw.set(p.raw, [...(pendingByRaw.get(p.raw) || []), ...p.lemmas]);
const resolved = new Map();
function resolveLemma(raw, depth = 0) {
  if (lemmaInfo.has(raw)) return raw;
  if (depth > 4 || !pendingByRaw.has(raw)) return null;
  if (resolved.has(raw)) return resolved.get(raw);
  resolved.set(raw, null); // gegen Zyklen
  let r = null;
  for (const l of new Set(pendingByRaw.get(raw))) {
    r = resolveLemma(l, depth + 1);
    if (r) break;
  }
  resolved.set(raw, r);
  return r;
}
let dropped = 0;
for (const p of pending) {
  let lemma = null;
  for (const l of p.lemmas) { lemma = resolveLemma(l); if (lemma) break; }
  if (lemma) add(p.raw, lemma, p.desc);
  else { dropped++; if (process.env.DEBUG_DROPS && dropped % 2000 === 0) console.log('DROP', p.raw, '→', p.lemmas[0]); }
}
// Wörter ganz ohne Vokal sind fast immer Abkürzungen – außer echte Grundformen (HM, PST, BRR)
for (const w of words) {
  if (!/[AEIOUÄÖÜY]/.test(w) && !lemmas.has(w)) { words.delete(w); dropped++; }
}
console.log(`${dropped} Formen ohne gültige Grundform bzw. Abkürzungen verworfen`);

/** Herkunftszeile: Grundform␟Wortart␟Formen␟Markierungen␟Bedeutung␟Übersetzungen (max. 3 Grundformen) */
function originLine(w) {
  const m = origin.get(w);
  if (!m) return '';
  const parts = [];
  for (const [lemma, descs] of m) {
    const li = lemmaInfo.get(lemma);
    if (!li) continue;
    parts.push([lemma, li.pos, [...descs].join(', '), li.marks.join(', '), li.gloss, li.tr].join('\u001f'));
    if (parts.length >= 3) break;
  }
  return parts.join('\u001e');
}

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
const infoDir = path.join(outDir, 'info');
fs.mkdirSync(infoDir, { recursive: true });
for (const f of fs.readdirSync(infoDir)) {
  if (f.endsWith('.txt.gz')) fs.unlinkSync(path.join(infoDir, f));
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
  // Herkunft je Wort: „WORT\tQuelle1\u001eQuelle2…“, Quelle = Grundform␟Wortart␟Formen␟Markierungen␟Bedeutung␟Übersetzungen
  info: {},
};

let bytes = 0;
let infoBytes = 0;
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
  const infoText = list.map((w) => w + '\t' + originLine(w)).join('\n') + '\n';
  contentHash.update(infoText);
  const igz = zlib.gzipSync(infoText, { level: 9 });
  fs.writeFileSync(path.join(infoDir, file), igz);
  index.info[k] = { file: 'info/' + file, bytes: igz.length };
  infoBytes += igz.length;
}
index.bytes = bytes;
index.infoBytes = infoBytes;
// Version = Datum + Inhalts-Hash, damit Geräte eine geänderte Liste sicher neu laden
index.version += '-' + contentHash.digest('hex').slice(0, 8);
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');

console.log(`${entries} Einträge, ${words.size} Wörter, ${shards.size} Dateien, ${(bytes / 1048576).toFixed(1)} MB, Herkunft ${(infoBytes / 1048576).toFixed(1)} MB`);
