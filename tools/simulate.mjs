#!/usr/bin/env node
// Experiment: Scrabble-Partien simulieren (deutsche Steinverteilung, Hausregel am Ende).
//
// Spielertypen:
//   profi        legt immer den Zug mit den meisten Punkten
//   gelegenheit  nimmt zufällig einen Zug aus dem besseren Fünftel (sieht nicht alles)
//
// Regeln: 7 Steine, Nachziehen, Tauschen wenn kein Zug möglich (und ≥ 7 im Beutel),
// sonst Aussetzen. Ende, wenn jemand alle Steine los ist und der Beutel leer ist,
// oder nach 6 Zügen ohne Punkte in Folge. Hausregel: Wer ausmacht, bekommt keine
// Pluspunkte; alle anderen verlieren den Wert ihrer Reststeine.
//
// Wortschatz: --wortschatz alle (ganze Wiktionary-Liste) oder geläufig (nur Wörter,
// deren Grundform nicht als selten/veraltet/regional markiert ist und im Wiktionary
// mindestens --min-uebersetzungen [10] Übersetzungen hat – Näherung für Alltagswörter).
//
// Aufruf: node tools/simulate.mjs [--partien 20] [--typ profi|gelegenheit|gemischt] [--seed 1]
//                                 [--wortschatz alle|geläufig] [--json datei.jsonl]

import fs from 'node:fs';
import zlib from 'node:zlib';
import { SIZE } from '../js/reconstruct.js';
import { generateMoves } from '../js/movegen.js';
import { LETTER_VALUES } from '../js/letters.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
const GAMES = Number(opt('partien', 20));
const TYPE = opt('typ', 'gemischt');
const JSON_OUT = opt('json', null);
let seed = Number(opt('seed', 1)) >>> 0 || 1;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const DIST = { A: 5, Ä: 1, B: 2, C: 2, D: 4, E: 15, F: 2, G: 3, H: 4, I: 6, J: 1, K: 2, L: 3, M: 4, N: 9, O: 3, Ö: 1, P: 1, Q: 1, R: 6, S: 7, T: 6, U: 6, Ü: 1, V: 1, W: 1, X: 1, Y: 1, Z: 1, '?': 2 };
const value = (t) => (t === '?' ? 0 : LETTER_VALUES[t]);

// Wortliste + Präfixsuche
const dir = new URL('../words/de/', import.meta.url);
const index = JSON.parse(fs.readFileSync(new URL('index.json', dir), 'utf8'));
const VOCAB = opt('wortschatz', 'alle');
const MIN_TR = Number(opt('min-uebersetzungen', 10));
const RARE = /veraltet|poetisch|selten|regional|mundartlich|süddeutsch|norddeutsch|schweizerisch|österreichisch|bairisch/;
const list = [];
if (VOCAB === 'alle') {
  for (const s of Object.values(index.shards)) {
    for (const w of zlib.gunzipSync(fs.readFileSync(new URL(s.file, dir))).toString('utf8').split('\n')) if (w) list.push(w);
  }
} else {
  for (const m of Object.values(index.info)) {
    for (const line of zlib.gunzipSync(fs.readFileSync(new URL(m.file, dir))).toString('utf8').split('\n')) {
      if (!line) continue;
      const [w, rest = ''] = line.split('\t');
      const ok = rest.split('\u001e').some((src) => {
        const f = src.split('\u001f');
        return f.length >= 6 && !RARE.test(f[3]) && Number(f[5]) >= MIN_TR;
      });
      if (ok) list.push(w);
    }
  }
}
list.sort();
const wordSet = new Set(list);
const isWord = (w) => wordSet.has(w);
const prefixCache = new Map();
const isPrefix = (p) => {
  let r = prefixCache.get(p);
  if (r !== undefined) return r;
  let lo = 0, hi = list.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (list[mid] < p) lo = mid + 1; else hi = mid; }
  r = lo < list.length && list[lo].startsWith(p);
  if (prefixCache.size > 3e6) prefixCache.clear();
  prefixCache.set(p, r);
  return r;
};

function chooseMove(moves, type) {
  if (!moves.length) return null;
  if (type === 'profi') return moves[0]; // bereits nach Punkten sortiert
  const top = Math.max(1, Math.ceil(moves.length * 0.2));
  return moves[Math.floor(rnd() * top)];
}

function playGame(types) {
  const n = types.length;
  const bag = shuffle(Object.entries(DIST).flatMap(([t, c]) => Array(c).fill(t)));
  const racks = types.map(() => bag.splice(0, 7));
  const grid = new Array(SIZE * SIZE).fill(null);
  const scores = types.map(() => 0);
  const log = [];
  let scoreless = 0;
  let turn = 0;
  let bagEmptyAt = null;
  let out = null;

  while (true) {
    const p = turn % n;
    const rackBefore = racks[p].join('');
    const moves = generateMoves(grid, racks[p], isWord, { isPrefix });
    const m = chooseMove(moves, types[p]);
    if (m) {
      for (let j = 0; j < m.tiles.length; j++) {
        const l = m.letters[j];
        grid[m.tiles[j]] = { ...l };
        racks[p].splice(racks[p].indexOf(l.blank ? '?' : l.letter), 1);
      }
      scores[p] += m.score;
      log.push({
        p, score: m.score, tiles: m.tiles.length, words: m.words.map((w) => w.word), bingo: m.bingo,
        rack: rackBefore,
        // gelegte Steine: [Feld 0–224, Buchstabe, Blanko?]
        placed: m.tiles.map((t, j) => [t, m.letters[j].letter, m.letters[j].blank ? 1 : 0]),
        best: moves[0].score, options: moves.length,
      });
      scoreless = 0;
      while (racks[p].length < 7 && bag.length) racks[p].push(bag.pop());
      if (!bag.length && bagEmptyAt === null) bagEmptyAt = log.length;
      if (!racks[p].length && !bag.length) { out = p; break; }
    } else {
      if (bag.length >= 7) {
        // Tauschen: alle Steine zurück, neue ziehen
        bag.push(...racks[p]);
        shuffle(bag);
        racks[p] = bag.splice(0, 7);
        log.push({ p, score: null, exchange: true, rack: rackBefore });
      } else {
        log.push({ p, score: null, pass: true, rack: rackBefore });
      }
      scoreless++;
      if (scoreless >= 2 * n) break;
    }
    turn++;
    if (turn > 400) break; // Sicherheitsnetz
  }

  // Hausregel
  const leftover = racks.map((r) => r.reduce((s, t) => s + value(t), 0));
  const final = scores.map((s, i) => (i === out ? s : s - leftover[i]));
  return { types, vocab: VOCAB, scores, final, leftover, out, log, bagEmptyAt, rackLeft: racks.map((r) => r.join('')) };
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

const results = [];
const t0 = Date.now();
for (let g = 0; g < GAMES; g++) {
  const types = TYPE === 'gemischt'
    ? ['profi', 'gelegenheit', 'gelegenheit']
    : [TYPE, TYPE, TYPE];
  const r = playGame(types);
  results.push(r);
  if (JSON_OUT) fs.appendFileSync(JSON_OUT, JSON.stringify(r) + '\n');
  process.stderr.write(`Partie ${g + 1}/${GAMES}: ${r.final.join(' / ')}  (${r.log.length} Züge, ${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
}

// Auswertung je Spielertyp
console.log(`\n${GAMES} Partien à ${results[0].types.length} Spieler, Typ: ${TYPE}, Wortschatz: ${VOCAB} (${list.length} Wörter)`);
for (const type of new Set(results.flatMap((r) => r.types))) {
  const finals = [];
  const turnScores = [];
  const tilesPer = [];
  let bingos = 0, passes = 0, exchanges = 0, players = 0, wins = 0;
  for (const r of results) {
    const best = Math.max(...r.final);
    r.types.forEach((t, i) => {
      if (t !== type) return;
      players++;
      finals.push(r.final[i]);
      if (r.final[i] === best) wins++;
      for (const m of r.log) {
        if (m.p !== i) continue;
        if (m.score != null) { turnScores.push(m.score); tilesPer.push(m.tiles); if (m.bingo) bingos++; }
        else if (m.exchange) exchanges++;
        else passes++;
      }
    });
  }
  console.log(`\n${type}:`);
  console.log(`  Endstand    Ø ${mean(finals).toFixed(0)}  (Spanne ${Math.min(...finals)}–${Math.max(...finals)}, Median ${pct(finals, 0.5)})`);
  console.log(`  Pro Zug     Ø ${mean(turnScores).toFixed(1)} Punkte, Ø ${mean(tilesPer).toFixed(1)} Steine, Median ${pct(turnScores, 0.5)}, 90 % ≤ ${pct(turnScores, 0.9)}`);
  console.log(`  Bingos      ${(bingos / players).toFixed(2)} je Spieler und Partie; Tauschen ${(exchanges / players).toFixed(2)}, Aussetzen ${(passes / players).toFixed(2)}`);
  if (TYPE === 'gemischt') console.log(`  Siege       ${wins} von ${GAMES}`);
}
const lens = results.map((r) => r.log.length);
const empties = results.map((r) => r.bagEmptyAt).filter((x) => x != null);
console.log(`\nPartielänge Ø ${mean(lens).toFixed(0)} Züge; Beutel leer im Ø nach Zug ${mean(empties).toFixed(0)}; ` +
  `ausgemacht in ${results.filter((r) => r.out != null).length} von ${GAMES} Partien`);
console.log(`Dauer ${((Date.now() - t0) / 1000).toFixed(0)} s`);
