import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {
  parseBoard, scorePlacement, reconstruct, analyzeRacks, rackBounds, boardBefore, cellName, SIZE,
} from '../js/reconstruct.js';
import { generateMoves } from '../js/movegen.js';

const game = JSON.parse(fs.readFileSync(new URL('./fixtures/partie-beispiel.json', import.meta.url), 'utf8'));
const cells = parseBoard(game.board);

const dir = new URL('../words/de/', import.meta.url);
const index = JSON.parse(fs.readFileSync(new URL('index.json', dir), 'utf8'));
const words = new Set();
for (const s of Object.values(index.shards)) {
  for (const w of zlib.gunzipSync(fs.readFileSync(new URL(s.file, dir))).toString('utf8').split('\n')) if (w) words.add(w);
}
const isWord = (w) => words.has(w);

const turnsOf = (g) => {
  const turns = [];
  for (let r = 0; r < 14; r++) for (const p of g.players) if (r < g.scores[p].length) turns.push({ player: p, round: r + 1, score: g.scores[p][r] });
  return turns;
};
const idx = (name) => (name.charCodeAt(0) - 65) * SIZE + Number(name.slice(1)) - 1;

test('Brett einlesen: 100 Steine, zwei Blanko', () => {
  assert.equal(cells.filter(Boolean).length, 100);
  assert.deepEqual(cells.map((c, i) => (c?.blank ? cellName(i) + c.letter : null)).filter(Boolean), ['F6B', 'I10E']);
});

test('Wertung: Prämienfelder, Kreuzwörter, Blanko = 0', () => {
  const empty = new Uint8Array(SIZE * SIZE);
  // WEIL durch die Mitte (doppelter Wortwert): (3+1+1+2)×2
  assert.equal(scorePlacement(cells, empty, ['H5', 'H6', 'H7', 'H8'].map(idx)).score, 14);
  // QI mit Q auf dreifachem Wortwert + Kreuzwort IM
  const placed = new Uint8Array(SIZE * SIZE);
  placed[idx('I2')] = 1;
  const r = scorePlacement(cells, placed, ['H1', 'H2'].map(idx));
  assert.deepEqual(r.words.map((w) => [w.word, w.score]), [['QI', 33], ['IM', 4]]);
});

test('Rekonstruktion: notierte 35 ist unmöglich, mit 37 eindeutig bis auf Vertauschungen', () => {
  const wrong = structuredClone(game);
  wrong.scores.C[5] = 35;
  assert.equal(reconstruct({ cells, turns: turnsOf(wrong), isWord, maxUnknown: 4 }).solutions.length, 0);

  const res = reconstruct({ cells, turns: turnsOf(game), isWord, maxUnknown: 4, maxSolutions: 500 });
  assert.ok(res.complete);
  const ok = res.solutions.filter((s) => analyzeRacks(cells, s, game.players, game.leftovers).ok);
  assert.equal(ok.length, 4);
  // Erster Zug WEIL, ANPOCHENS durch das S auf dem dreifachen Wortwert
  assert.equal(ok[0][0].words[0].word, 'WEIL');
  assert.equal(ok[0][8].words[0].word, 'ANPOCHENS');
  assert.deepEqual(ok[0][8].tiles.map(cellName), ['A7', 'A8']);

  // Bänke beim leeren Beutel: A behält das K, B nur Konsonanten, C nur Vokale
  const { racks } = analyzeRacks(cells, ok[0], game.players, game.leftovers);
  assert.ok(racks.A.tiles.includes('K') && racks.A.tiles.includes('V'));
  assert.ok(racks.B.tiles.every((t) => !/[AEIOUÄÖÜ]/.test(t)));
  assert.ok(racks.C.tiles.every((t) => /[AEIOUÄÖÜ]/.test(t)));
});

test('Zugbewertung: GÖR hätte mit R auf dem Doppelwort 22 gebracht', () => {
  const res = reconstruct({ cells, turns: turnsOf(game), isWord, maxUnknown: 4, maxSolutions: 50 });
  const sol = res.solutions.find((s) => analyzeRacks(cells, s, game.players, game.leftovers).ok);
  const k = sol.findIndex((m) => m.words[0]?.word === 'GÖR');
  assert.equal(sol[k].score, 11);
  const grid = boardBefore(cells, sol, k);
  const better = generateMoves(grid, ['G', 'Ö', 'R'], isWord).find((m) => m.words[0].word === 'GÖR' && m.score === 22);
  assert.ok(better);
  assert.deepEqual(better.tiles.map(cellName), ['M3', 'N3']);
});

test('Bänke je Zug: sicher / möglich, ab leerem Beutel komplett', () => {
  const res = reconstruct({ cells, turns: turnsOf(game), isWord, maxUnknown: 4, maxSolutions: 50 });
  const sol = res.solutions.find((s) => analyzeRacks(cells, s, game.players, game.leftovers).ok);
  const b = rackBounds(cells, sol, game.players, game.leftovers);
  const k = sol.findIndex((m) => m.words[0]?.word === 'GÖR');
  // Vor GÖR: G und Ö sicher, die anderen 5 aus dem späteren Vorrat (R möglich, nicht sicher)
  assert.deepEqual(b[k].sure, ['G', 'Ö']);
  assert.ok(b[k].possible.includes('R'));
  assert.equal(b[k].exact, false);
  // Nach leerem Beutel ist jede Bank exakt bekannt; das K bleibt bis zum Schluss
  assert.ok(b.at(-1).exact);
  const last = b.map((x, i) => [x, sol[i]]).filter(([, m]) => m.player === 'A').at(-1)[0];
  assert.deepEqual(last.sure, ['K']);
});

test('Rekonstruktion: eingetragenes Wort als Bedingung', () => {
  const turns = turnsOf(game);
  turns[0].word = 'Weil';
  assert.ok(reconstruct({ cells, turns, isWord, maxUnknown: 4, maxSolutions: 5 }).solutions.length > 0);
  turns[0].word = 'NULLT'; // falsches Wort für den ersten Zug → keine Lösung
  assert.equal(reconstruct({ cells, turns, isWord, maxUnknown: 4, maxSolutions: 5 }).solutions.length, 0);
});
