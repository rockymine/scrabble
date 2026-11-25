#!/usr/bin/env node
// Experiment: Gibt es zu einem Punktezettel ein (anderes) komplettes Spiel?
//
// Gegeben sind NUR die Punkte je Zug, wer ausgemacht hat und der Wert der
// Reststeine – nicht das Brett. Gesucht wird irgendein regelkonformes Spiel mit
// der deutschen Steinverteilung, in dem jeder Zug genau die notierte Punktzahl
// bringt und das genau so endet (alle Steine verbraucht, Reststein-Werte stimmen).
//
// Vorgehen:
//  - Solange der Beutel nicht leer ist, darf ein Zug beliebige ≤ 7 Steine aus dem
//    Vorrat verwenden (die Ziehreihenfolge ist frei wählbar und bleibt
//    automatisch konsistent). Gesucht wird mit zufälligen 7er-Bänken.
//  - Sobald der Beutel leer ist, sind die Bankgrößen fest; der Rest wird
//    vollständig durchsucht, inkl. der Bedingungen am Spielende.
//  - Rücksetzen (Backtracking) + Neustarts mit Zeitlimit.
//
// Aufruf: node tools/alternative-game.mjs partie.json [--sekunden 300] [--seed 1]

import fs from 'node:fs';
import zlib from 'node:zlib';
import { SIZE, cellName, ROWS } from '../js/reconstruct.js';
import { generateMoves } from '../js/movegen.js';
import { LETTER_VALUES } from '../js/letters.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const game = JSON.parse(fs.readFileSync(file, 'utf8'));

// Zufall mit Startwert (reproduzierbar)
let seed = opt('seed', 1) >>> 0 || 1;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Deutsche Steinverteilung (wie auf dem Brett aufgedruckt)
const DIST = { A: 5, Ä: 1, B: 2, C: 2, D: 4, E: 15, F: 2, G: 3, H: 4, I: 6, J: 1, K: 2, L: 3, M: 4, N: 9, O: 3, Ö: 1, P: 1, Q: 1, R: 6, S: 7, T: 6, U: 6, Ü: 1, V: 1, W: 1, X: 1, Y: 1, Z: 1, '?': 2 };
const TOTAL = Object.values(DIST).reduce((a, b) => a + b, 0);
const value = (t) => (t === '?' ? 0 : LETTER_VALUES[t]);

// Wortliste + Präfixsuche (Binärsuche in sortierter Liste)
const dir = new URL('../words/de/', import.meta.url);
const index = JSON.parse(fs.readFileSync(new URL('index.json', dir), 'utf8'));
const list = [];
for (const s of Object.values(index.shards)) {
  for (const w of zlib.gunzipSync(fs.readFileSync(new URL(s.file, dir))).toString('utf8').split('\n')) if (w) list.push(w);
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
  if (prefixCache.size > 2e6) prefixCache.clear();
  prefixCache.set(p, r);
  return r;
};

// Zugreihenfolge und Endbedingungen
const players = game.players;
const turns = [];
const rounds = Math.max(...players.map((p) => game.scores[p].length));
for (let r = 0; r < rounds; r++) for (const p of players) if (r < game.scores[p].length) turns.push({ player: p, round: r + 1, score: game.scores[p][r] });
// Wert der Reststeine je Spieler (aus den Abzügen); wer 0 hat, hat ausgemacht
const leftValue = game.leftoverValues || Object.fromEntries(players.map((p) => [p, [...(game.leftovers?.[p] || '')].reduce((s, t) => s + value(t), 0)]));
const outPlayer = players.find((p) => !leftValue[p]);
const BAG_EMPTY_AT = TOTAL - players.length * 7;
// Beutel soll etwa nach diesem Zug leer werden (so dass danach jeder höchstens 7 Steine für seine übrigen Züge hat)
const PACE = opt('tempo', Math.round(turns.length * 0.58));
const HARD = new Set(['Q', 'Y', 'X', 'J', 'Ö', 'Ü', 'Ä', 'V', 'C', 'Z', 'P']);

const deadline = Date.now() + opt('sekunden', 300) * 1000;
let nodes = 0;
let maxDepth = 0;
let phase2Entries = 0;
const stat = { gen1: 0, gen2: 0, t1: 0, t2: 0 };

function poolArray(pool) {
  const a = [];
  for (const [t, n] of Object.entries(pool)) for (let i = 0; i < n; i++) a.push(t);
  return a;
}

/** Können die übrigen Steine so auf die Bänke verteilt werden, dass die Reststein-Werte stimmen? */
function endOk(pool, caps) {
  const tiles = poolArray(pool);
  const others = players.filter((p) => p !== outPlayer);
  if (caps[outPlayer] !== 0) return false;
  if (others.reduce((s, p) => s + caps[p], 0) !== tiles.length) return false;
  // kleine Suche: Steine auf die anderen Spieler verteilen
  const need = Object.fromEntries(others.map((p) => [p, { n: caps[p], v: leftValue[p] }]));
  const go = (i) => {
    if (i === tiles.length) return others.every((p) => need[p].n === 0 && need[p].v === 0);
    for (const p of others) {
      if (need[p].n > 0 && need[p].v >= value(tiles[i])) {
        need[p].n--; need[p].v -= value(tiles[i]);
        if (go(i + 1)) return true;
        need[p].n++; need[p].v += value(tiles[i]);
      }
    }
    return false;
  };
  return go(0);
}

function solve() {
  const grid = new Array(SIZE * SIZE).fill(null);
  const pool = { ...DIST };
  const path = [];
  let placed = 0;
  let caps = null; // Bankgrößen ab leerem Beutel

  const apply = (m, player) => {
    m.tiles.forEach((t, j) => {
      grid[t] = { ...m.letters[j] };
      pool[m.letters[j].blank ? '?' : m.letters[j].letter]--;
    });
    const before = placed;
    placed += m.tiles.length;
    let newCaps = null;
    if (!caps && placed >= BAG_EMPTY_AT) {
      const over = placed - BAG_EMPTY_AT;
      newCaps = Object.fromEntries(players.map((p) => [p, p === player ? 7 - over : 7]));
    } else if (caps) {
      newCaps = { ...caps, [player]: caps[player] - m.tiles.length };
    }
    return { before, oldCaps: caps, newCaps };
  };
  const undo = (m, u) => {
    m.tiles.forEach((t, j) => {
      grid[t] = null;
      pool[m.letters[j].blank ? '?' : m.letters[j].letter]++;
    });
    placed = u.before;
    caps = u.oldCaps;
  };
  const keyOf = (m) => m.tiles.join(',') + ':' + m.letters.map((l) => (l.blank ? l.letter.toLowerCase() : l.letter)).join('');

  const scoringLeft = turns.map((_, k) => turns.slice(k).filter((t) => t.score != null));

  const dfs = (k) => {
    if (Date.now() > deadline) return false;
    nodes++;
    if (k > maxDepth) maxDepth = k;
    if (k === turns.length) return !!caps && endOk(pool, caps);
    const t = turns[k];
    const remainingTiles = TOTAL - placed;
    // Schranken: übrige Züge müssen die Steine (bis auf Reste) unterbringen können
    if (scoringLeft[k].length * 7 + 4 < remainingTiles) return false;
    if (caps) {
      for (const p of players) {
        const need = scoringLeft[k].filter((x) => x.player === p).length;
        if (caps[p] < need) return false;
      }
    }
    if (t.score == null) {
      path.push(null);
      if (dfs(k + 1)) return true;
      path.pop();
      return false;
    }

    let candidates;
    if (caps) {
      // Beutel leer: vollständige Suche über den Restvorrat (max. Bankgröße)
      const rack = poolArray(pool);
      const seen = new Set();
      const t0 = Date.now(); stat.gen2++;
      candidates = generateMoves(grid, rack, isWord, { maxTiles: caps[t.player], isPrefix })
        .filter((m) => m.score === t.score && !seen.has(keyOf(m)) && seen.add(keyOf(m)));
      // wer ausmacht, muss beim letzten Zug genau leer werden
      stat.t2 += Date.now() - t0;
      if (k === turns.length - 1 && t.player === outPlayer) candidates = candidates.filter((m) => m.tiles.length === caps[t.player]);
      // letzter Zug eines Spielers, der nicht ausmacht: Rest muss zum Abzug passen
      // (jeder Stein außer Blanko ist mindestens 1 wert → höchstens Abzug + Blankos Steine)
      const isLast = scoringLeft[k].filter((x) => x.player === t.player).length === 1;
      if (isLast && t.player !== outPlayer) {
        candidates = candidates.filter((m) => {
          const rest = caps[t.player] - m.tiles.length;
          const blanks = pool['?'] - m.letters.filter((l) => l.blank).length;
          return leftValue[t.player] > 0 ? rest >= 1 && rest <= leftValue[t.player] + blanks : rest <= blanks;
        });
      }
      shuffle(candidates);
    } else {
      // Beutel voll: zufällige 7er-Bänke ausprobieren
      const seen = new Set();
      candidates = [];
      const all = poolArray(pool);
      const t0 = Date.now(); stat.gen1++;
      for (let a = 0; a < 30 && candidates.length < 12; a++) {
        const rack = shuffle(all.slice()).slice(0, 7);
        for (const m of generateMoves(grid, rack, isWord, { isPrefix })) {
          if (m.score !== t.score) continue;
          const key = keyOf(m);
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push(m);
        }
      }
      stat.t1 += Date.now() - t0;
      // Auswahl steuern: Tempo wie in einer normalen Partie (Beutel leer ≈ Zug PACE),
      // schwierige Steine früh verbauen, nicht mit Blanko ins Endspiel gehen.
      const target = Math.min(BAG_EMPTY_AT, Math.round(BAG_EMPTY_AT * (k + 1) / PACE));
      const rate = (m) => {
        const after = placed + m.tiles.length;
        let c = Math.abs(after - target);
        for (const l of m.letters) if (l.blank || HARD.has(l.letter)) c -= 1.5;
        if (after >= BAG_EMPTY_AT && pool['?'] - m.letters.filter((l) => l.blank).length > 0) c += 100;
        return c + rnd() * 2;
      };
      candidates = candidates.map((m) => [rate(m), m]).sort((x, y) => x[0] - y[0]).slice(0, 4).map((x) => x[1]);
    }
    for (const m of candidates) {
      const u = apply(m, t.player);
      if (!u.oldCaps && u.newCaps) phase2Entries++;
      caps = u.newCaps;
      path.push({ ...m, player: t.player, round: t.round });
      if (dfs(k + 1)) return true;
      path.pop();
      undo(m, u);
    }
    return false;
  };

  const ok = dfs(0);
  return ok ? { path, grid, pool, caps } : null;
}

let result = null;
let restarts = 0;
while (!result && Date.now() < deadline) {
  restarts++;
  result = solve();
}

console.log(`Neustarts: ${restarts}, Knoten: ${nodes}, max. Tiefe ${maxDepth}/${turns.length}, Beutel-leer erreicht: ${phase2Entries}×`);
console.log(`Zuggenerator: Phase 1 ${stat.gen1}× (${(stat.t1 / 1000).toFixed(0)} s), Phase 2 ${stat.gen2}× (${(stat.t2 / 1000).toFixed(0)} s)`);
if (!result) {
  console.log('Im Zeitlimit kein vollständiges Spiel gefunden.');
  process.exit(2);
}
console.log('\nGefundenes Spiel (gleiche Punkte je Zug):');
for (let k = 0; k < turns.length; k++) {
  const m = result.path[k];
  const t = turns[k];
  const head = `R${String(t.round).padStart(2)} ${t.player.padEnd(3)} ${String(t.score ?? '–').padStart(3)}`;
  if (!m) { console.log(`${head}  –`); continue; }
  const placedStr = m.letters.map((l) => (l.blank ? l.letter.toLowerCase() : l.letter)).join('');
  console.log(`${head}  ${m.words.map((w) => `${w.word} ${w.score}`).join(' + ')}  [${placedStr} @ ${m.tiles.map(cellName).join(' ')}]${m.bingo ? ' BINGO' : ''}`);
}
const rest = poolArray(result.pool);
console.log(`\nReststeine: ${rest.join(' ') || '–'} (verteilt auf ${players.filter((p) => p !== outPlayer).map((p) => `${p} Wert ${leftValue[p]}`).join(', ')})`);
console.log('\nEndbrett:');
console.log('    ' + Array.from({ length: SIZE }, (_, c) => String(c + 1).padStart(2)).join(''));
for (let r = 0; r < SIZE; r++) {
  let line = ROWS[r] + '   ';
  for (let c = 0; c < SIZE; c++) {
    const x = result.grid[r * SIZE + c];
    line += ' ' + (x ? (x.blank ? x.letter.toLowerCase() : x.letter) : '·');
  }
  console.log(line);
}
