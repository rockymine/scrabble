#!/usr/bin/env node
// Züge einer Partie aus Endbrett + Punkteliste rekonstruieren und bewerten.
//
// Aufruf: node tools/reconstruct.mjs partie.json [--max 500] [--unknown 6] [--baenke] [--bewerten]
//
// partie.json:
// {
//   "board": ["EGELS.ANPOCHENS", …15 Zeilen…],   // '.' leer, Kleinbuchstabe = Blanko
//   "players": ["A", "B", "C"],                   // Reihenfolge am Tisch
//   "scores": { "A": [14, 23, null, …], … },       // null = ausgesetzt/getauscht
//   "leftovers": { "A": "K", "B": "D" }            // Reststeine am Ende (optional)
// }

import fs from 'node:fs';
import zlib from 'node:zlib';
import {
  parseBoard, reconstruct, describeMove, analyzeRacks, boardBefore, cellName, rackBounds,
} from '../js/reconstruct.js';
import { generateMoves } from '../js/movegen.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const flag = (name) => args.includes('--' + name);
if (!file) {
  console.error('Aufruf: node tools/reconstruct.mjs partie.json [--max 500] [--unknown 6] [--bewerten]');
  process.exit(1);
}

const game = JSON.parse(fs.readFileSync(file, 'utf8'));
const cells = parseBoard(game.board);
const leftovers = game.leftovers || {};

// Wortliste laden
const dir = new URL('../words/de/', import.meta.url);
const index = JSON.parse(fs.readFileSync(new URL('index.json', dir), 'utf8'));
const words = new Set();
for (const s of Object.values(index.shards)) {
  for (const w of zlib.gunzipSync(fs.readFileSync(new URL(s.file, dir))).toString('utf8').split('\n')) if (w) words.add(w);
}
const isWord = (w) => words.has(w);

// Zugreihenfolge: Runde für Runde in Sitzreihenfolge
const turns = [];
const rounds = Math.max(...game.players.map((p) => game.scores[p].length));
for (let r = 0; r < rounds; r++) {
  for (const p of game.players) {
    if (r < game.scores[p].length) turns.push({ player: p, round: r + 1, score: game.scores[p][r] });
  }
}

const t0 = Date.now();
const res = reconstruct({ cells, turns, isWord, maxUnknown: opt('unknown', 6), maxSolutions: opt('max', 500), maxNodes: opt('nodes', 2e7) });
const secs = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`Steine auf dem Brett: ${cells.filter(Boolean).length}, Züge: ${turns.length}`);
console.log(`Suche: ${res.nodes} Knoten, ${secs} s, ${res.complete ? 'vollständig' : 'abgebrochen/gekappt'}`);
if (!res.solutions.length) {
  console.log('Keine passende Reihenfolge gefunden.');
  process.exit(2);
}
console.log(`${res.solutions.length} Lösung(en) mit höchstens ${res.unknownBudget} unbekannten Wörtern.`);

// Bank-Prüfung (leerer Beutel)
const analyzed = res.solutions.map((sol) => ({ sol, racks: analyzeRacks(cells, sol, game.players, leftovers) }));
const good = analyzed.filter((a) => a.racks.ok);
console.log(`Davon passen ${good.length} zur Bank-Prüfung (Beutel leer → Reststeine + spätere Züge = Bank).\n`);
const list = good.length ? good : analyzed;

const tileStr = (m) => m.tiles.map((t) => (cells[t].blank ? cells[t].letter.toLowerCase() : cells[t].letter)).join('');
const variants = turns.map(() => new Map());
for (const { sol } of list) {
  sol.forEach((m, k) => {
    const d = describeMove(cells, m);
    const key = typeof d === 'string' ? d : `${d.words.join(' + ')}  [${tileStr(m)} @ ${d.placedAt.join(' ')}]${m.unknown?.length ? '  (nicht in Wortliste: ' + m.unknown.join(', ') + ')' : ''}${m.bingo ? '  BINGO' : ''}`;
    variants[k].set(key, (variants[k].get(key) || 0) + 1);
  });
}
turns.forEach((t, k) => {
  const v = [...variants[k].entries()];
  const head = `R${String(t.round).padStart(2)} ${t.player.padEnd(3)} ${String(t.score ?? '–').padStart(3)}`;
  if (v.length === 1) console.log(`${head}  ${v[0][0]}`);
  else {
    console.log(`${head}  ${v.length} Möglichkeiten:`);
    for (const [k2, n] of v) console.log(`${' '.repeat(head.length)}    ${k2}  (${n}×)`);
  }
});

const { racks, emptyAfter } = list[0].racks;
if (emptyAfter !== null) {
  const t = turns[emptyAfter];
  console.log(`\nBeutel leer nach R${t.round} ${t.player}. Bänke in diesem Moment:`);
  const all = new Map();
  for (const { racks: r } of list) {
    for (const p of game.players) {
      const s = [...r.racks[p].tiles].sort().join(' ');
      if (!all.has(p)) all.set(p, new Set());
      all.get(p).add(s);
    }
  }
  for (const p of game.players) console.log(`  ${p}: ${[...all.get(p)].join('  |  ')}`);
}
void racks;

// ---------- Bänke je Zug ----------
if (flag('baenke')) {
  const sol = list[0].sol;
  const b = rackBounds(cells, sol, game.players, leftovers);
  console.log('\nBänke vor jedem Zug (Lösung 1): sicher drauf + unbekannter Rest');
  sol.forEach((m, k) => {
    const x = b[k];
    const d = describeMove(cells, m);
    const word = typeof d === 'string' ? '–' : d.main;
    const rest = x.size - x.sure.length;
    console.log(`R${String(turns[k].round).padStart(2)} ${m.player.padEnd(3)} ${word.padEnd(10)} ${x.sure.join('') || '–'}${x.exact ? '  (komplett bekannt)' : `  + ${rest} aus {${x.possible.join('')}}`}`);
  });
}

// ---------- Bewertung ----------
if (flag('bewerten')) {
  const sol = list[0].sol;
  const { emptyAfter: ea, racks: rk } = list[0].racks;
  console.log(`\nBewertung (Lösung 1, Wörter nur aus der Wortliste):`);
  const rackNow = Object.fromEntries(game.players.map((p) => [p, [...(rk[p]?.tiles || [])]]));
  sol.forEach((m, k) => {
    const t = turns[k];
    if (m.score == null) {
      if (ea !== null && k > ea) {
        const grid = boardBefore(cells, sol, k);
        const best = generateMoves(grid, rackNow[t.player], isWord)[0];
        console.log(`R${t.round} ${t.player} –  Bank ${rackNow[t.player].join('')}: ${best ? `möglich wäre ${best.words.map((w) => w.word).join('+')} ${best.score}` : 'kein Zug möglich'}`);
      }
      return;
    }
    const grid = boardBefore(cells, sol, k);
    const own = m.tiles.map((i) => (cells[i].blank ? '?' : cells[i].letter));
    const sameTiles = generateMoves(grid, own, isWord, { useAll: true });
    const bestSame = sameTiles[0];
    let line = `R${t.round} ${t.player} ${String(m.score).padStart(3)} ${describeMove(cells, m).main.padEnd(10)}`;
    if (bestSame && bestSame.score > m.score) {
      line += `  gleiche Steine besser: ${bestSame.words.map((w) => w.word).join('+')} ${bestSame.score} @ ${bestSame.tiles.map(cellName).join(' ')} (+${bestSame.score - m.score})`;
    }
    if (ea !== null && k > ea) {
      const full = generateMoves(grid, rackNow[t.player], isWord)[0];
      if (full && full.score > m.score) line += `  | mit ganzer Bank ${rackNow[t.player].join('')}: ${full.words.map((w) => w.word).join('+')} ${full.score}`;
      for (const x of own) rackNow[t.player].splice(rackNow[t.player].indexOf(x), 1);
    }
    console.log(line);
  });
}
