import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, addTurn, undoLastTurn, updateTurn, currentPlayerId, turnTotals,
  computeFinal, finishGame, turnsByRound, parseTurnList, buildPaperGame, parsePoints, reopenGame,
} from '../js/game.js';
import { computeStats } from '../js/stats.js';
import { normalizeWord, shardKey, isPlayableWord } from '../js/normalize.js';

const H = 'spieler-a', G = 'spieler-b', M = 'spieler-c';

test('Reihenfolge und automatischer Spielerwechsel', () => {
  const g = createGame({ playerIds: [G, H, M] });
  assert.equal(currentPlayerId(g), G);
  addTurn(g, { points: 10, word: 'HAUS' });
  assert.equal(currentPlayerId(g), H);
  addTurn(g, { pass: true });
  assert.equal(currentPlayerId(g), M);
  addTurn(g, { points: 7 });
  assert.equal(currentPlayerId(g), G);
  assert.deepEqual(turnTotals(g), { [G]: 10, [H]: 0, [M]: 7 });
  assert.equal(g.turns[1].pass, true);
  assert.equal(g.turns[1].points, 0);
});

test('Rückgängig und Korrektur', () => {
  const g = createGame({ playerIds: [H, G] });
  addTurn(g, { points: 10 });
  addTurn(g, { points: 20 });
  undoLastTurn(g);
  assert.equal(currentPlayerId(g), G);
  updateTurn(g, g.turns[0].id, { points: 15, word: 'BAUM' });
  assert.deepEqual(turnTotals(g), { [H]: 15, [G]: 0 });
  assert.equal(g.turns[0].word, 'BAUM');
  updateTurn(g, g.turns[0].id, { pass: true });
  assert.equal(g.turns[0].points, 0);
  assert.equal(g.turns[0].word, '');
});

test('Spieleranzahl wird geprüft', () => {
  assert.throws(() => createGame({ playerIds: [H] }));
  assert.throws(() => createGame({ playerIds: [H, G, M, 'a', 'b'] }));
  assert.throws(() => createGame({ playerIds: [H, H] }));
});

test('Hausregel: Ausmacher bekommt keine Pluspunkte, andere verlieren Reststeine', () => {
  const g = createGame({ playerIds: [H, G, M] });
  addTurn(g, { points: 30 }); addTurn(g, { points: 25 }); addTurn(g, { points: 28 });
  const r = computeFinal(g, { outPlayerId: H, remaining: { [G]: 5, [M]: 12, [H]: 99 } });
  assert.deepEqual(r.finalScores, { [H]: 30, [G]: 20, [M]: 16 });
  assert.equal(r.end.remaining[H], 0);
  assert.deepEqual(r.winnerIds, [H]);
});

test('Niemand hat ausgemacht: alle verlieren Reststeine; Gleichstand = mehrere Gewinner', () => {
  const g = createGame({ playerIds: [H, G] });
  addTurn(g, { points: 30 }); addTurn(g, { points: 28 });
  finishGame(g, { outPlayerId: null, remaining: { [H]: 4, [G]: 2 } });
  assert.deepEqual(g.finalScores, { [H]: 26, [G]: 26 });
  assert.deepEqual(g.winnerIds, [H, G]);
  assert.equal(g.status, 'finished');
});

test('Korrektur nach Spielende berechnet Endstand neu', () => {
  const g = createGame({ playerIds: [H, G] });
  addTurn(g, { points: 10 }); addTurn(g, { points: 20 });
  finishGame(g, { outPlayerId: G, remaining: { [H]: 3 } });
  assert.deepEqual(g.winnerIds, [G]);
  updateTurn(g, g.turns[0].id, { points: 40 });
  assert.deepEqual(g.finalScores, { [H]: 37, [G]: 20 });
  assert.deepEqual(g.winnerIds, [H]);
  reopenGame(g);
  assert.equal(g.status, 'running');
});

test('Punkteingabe', () => {
  assert.equal(parsePoints('24'), 24);
  assert.equal(parsePoints(' 0 '), 0);
  assert.equal(parsePoints(''), null);
  assert.equal(parsePoints('-3'), null);
  assert.equal(parsePoints('2.5'), null);
});

test('Zahlenliste für Papierpartien', () => {
  const r = parseTurnList('12 24, 8;0 - 15 HAUS 7:BAUM ?');
  assert.deepEqual(r.turns.map((t) => t.points), [12, 24, 8, 0, 0, 15, 7]);
  assert.deepEqual(r.turns.map((t) => t.pass), [false, false, false, true, true, false, false]);
  assert.equal(r.turns[5].word, 'HAUS');
  assert.equal(r.turns[6].word, 'BAUM');
  assert.deepEqual(r.errors, ['?']);
});

test('Papierpartie wird Runde für Runde verzahnt', () => {
  const g = buildPaperGame({
    date: '2019-03-02',
    playerIds: [H, G],
    lists: { [H]: parseTurnList('10 20 30').turns, [G]: parseTurnList('5 5').turns },
    end: { outPlayerId: H, remaining: { [G]: 6 } },
  });
  assert.equal(g.source, 'paper');
  assert.equal(g.date, '2019-03-02');
  assert.deepEqual(g.turns.map((t) => t.playerId), [H, G, H, G, H]);
  assert.deepEqual(g.finalScores, { [H]: 60, [G]: 4 });
  const rounds = turnsByRound(g);
  assert.equal(rounds.length, 3);
  assert.equal(rounds[2][1], null);
});

test('Statistik: Siege, Durchschnitt, Rekorde, Duelle', () => {
  const g1 = createGame({ playerIds: [H, G] });
  addTurn(g1, { points: 50, word: 'QUARZ' }); addTurn(g1, { points: 20 });
  finishGame(g1, { outPlayerId: H, remaining: { [G]: 0 } });
  const g2 = createGame({ playerIds: [H, G, M] });
  addTurn(g2, { points: 10 }); addTurn(g2, { points: 30 }); addTurn(g2, { points: 30 });
  finishGame(g2, { outPlayerId: G, remaining: { [H]: 0, [M]: 0 } });
  const running = createGame({ playerIds: [H, M] });
  addTurn(running, { points: 999 });

  const s = computeStats([g1, g2, running]);
  assert.equal(s.gameCount, 2);
  assert.equal(s.players[H].wins, 1);
  assert.equal(s.players[G].sharedWins, 1);
  assert.equal(s.players[M].sharedWins, 1);
  assert.equal(s.players[H].avgScore, 30);
  assert.equal(s.players[H].bestTurn.points, 50);
  assert.equal(s.records.bestTurn.word, 'QUARZ');
  assert.equal(s.records.bestGame.score, 50);
  const hg = s.duels.find((d) => [d.a, d.b].sort().join() === [G, H].sort().join());
  assert.equal(hg.games, 2);
  const hWins = hg.a === H ? hg.aWins : hg.bWins;
  const gWins = hg.a === G ? hg.aWins : hg.bWins;
  assert.equal(hWins, 1);
  assert.equal(gWins, 1);
  const gm = s.duels.find((d) => [d.a, d.b].sort().join() === [G, M].sort().join());
  assert.equal(gm.draws, 1);
});

test('Wort-Normalisierung', () => {
  assert.equal(normalizeWord(' straße '), 'STRASSE');
  assert.equal(normalizeWord('Ärger'), 'ÄRGER');
  assert.equal(shardKey('ÄRGER'), 'AE');
  assert.equal(shardKey('ÜBER'), 'UE');
  assert.equal(isPlayableWord('HAUS'), true);
  assert.equal(isPlayableWord('HAUS-TÜR'), false);
});
