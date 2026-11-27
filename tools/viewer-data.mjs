#!/usr/bin/env node
// Daten für den Spiel-Betrachter (tools/viewer/index.html) zusammenstellen.
//
// Aufruf:
//   node tools/viewer-data.mjs --ausgabe games.json
//        [--partie partie.json]          echte Partie (Endbrett + Zettel) → Rekonstruktion
//        [--sim datei.jsonl[:anzahl]]…   simulierte Partien (tools/simulate.mjs --json)
//        [--alternativ ausgabe.txt]      Ergebnis von tools/alternative-game.mjs
//        [--zettel partie.json]          Punktezettel zum alternativen Spiel

import fs from 'node:fs';
import zlib from 'node:zlib';
import { parseBoard, reconstruct, analyzeRacks, rackBounds, SIZE, ROWS } from '../js/reconstruct.js';

const args = process.argv.slice(2);
const all = (name) => args.flatMap((a, i) => (a === '--' + name ? [args[i + 1]] : []));
const one = (name) => all(name)[0];

const dir = new URL('../words/de/', import.meta.url);
const index = JSON.parse(fs.readFileSync(new URL('index.json', dir), 'utf8'));
const words = new Set();
for (const s of Object.values(index.shards)) {
  for (const w of zlib.gunzipSync(fs.readFileSync(new URL(s.file, dir))).toString('utf8').split('\n')) if (w) words.add(w);
}

// Herkunft je Wort (words/de/info) für die Anzeige
const RARE = /veraltet|poetisch|selten|regional|mundartlich|süddeutsch|norddeutsch|schweizerisch|österreichisch|bairisch/;
const infoMap = new Map();
for (const m of Object.values(index.info || {})) {
  for (const line of zlib.gunzipSync(fs.readFileSync(new URL(m.file, dir))).toString('utf8').split('\n')) {
    const t = line.indexOf('\t');
    if (t > 0) infoMap.set(line.slice(0, t), line.slice(t + 1));
  }
}
function infoOf(w) {
  const raw = infoMap.get(w);
  if (!raw) return null;
  const src = raw.split('\u001e').map((x) => x.split('\u001f')).filter((f) => f.length >= 6)
    .map(([lemma, pos, forms, marks, gloss, tr]) => ({ lemma, pos, forms, marks, gloss, tr: Number(tr) || 0 }));
  const common = src.some((x) => !RARE.test(x.marks) && x.tr >= 10);
  const rare = src.length > 0 && src.every((x) => RARE.test(x.marks));
  return { common, rare, src: src.slice(0, 2) };
}

/** Alle Wörter (≥ 2 Buchstaben) auf einem Brett, mit Prüfung gegen die Wortliste. */
function boardWords(grid) {
  const out = [];
  for (const horizontal of [true, false]) {
    for (let line = 0; line < SIZE; line++) {
      let w = '';
      let start = null;
      for (let k = 0; k <= SIZE; k++) {
        const i = horizontal ? line * SIZE + k : k * SIZE + line;
        const cell = k < SIZE ? grid[i] : null;
        if (cell) { if (!w) start = i; w += cell.letter; }
        else {
          if (w.length >= 2) out.push({ w, at: ROWS[Math.floor(start / SIZE)] + ((start % SIZE) + 1), dir: horizontal ? '→' : '↓', ok: words.has(w), info: infoOf(w) });
          w = '';
        }
      }
    }
  }
  return out;
}

function finalGrid(moves) {
  const grid = new Array(SIZE * SIZE).fill(null);
  for (const m of moves) for (const [i, letter, blank] of m.placed || []) grid[i] = { letter, blank: !!blank };
  return grid;
}

const games = [];

// ---------- echte Partie ----------
for (const partie of all('partie')) {
  const g = JSON.parse(fs.readFileSync(partie, 'utf8'));
  const cells = parseBoard(g.board);
  const turns = [];
  const rounds = Math.max(...g.players.map((p) => g.scores[p].length));
  for (let r = 0; r < rounds; r++) for (const p of g.players) if (r < g.scores[p].length) turns.push({ player: p, round: r + 1, score: g.scores[p][r], word: g.words?.[p]?.[r] || null });
  const res = reconstruct({ cells, turns, isWord: (w) => words.has(w), maxUnknown: 4, maxSolutions: 100 });
  const ok = res.solutions.filter((s) => analyzeRacks(cells, s, g.players, g.leftovers).ok);
  const sol = ok[0];
  const bounds = rackBounds(cells, sol, g.players, g.leftovers);
  const pIndex = Object.fromEntries(g.players.map((p, i) => [p, i]));
  // Züge, die je nach Lösung variieren
  const varies = sol.map((m, k) => new Set(ok.map((s) => s[k].tiles.join(','))).size > 1);
  const moves = sol.map((m, k) => ({
    p: pIndex[m.player],
    round: turns[k].round,
    score: m.score,
    placed: m.tiles.map((t) => [t, cells[t].letter, cells[t].blank ? 1 : 0]),
    words: m.words.map((w) => [w.word, w.score]),
    rackSure: bounds[k].sure.join(''),
    rackSize: bounds[k].size,
    rackExact: bounds[k].exact,
    pass: m.score == null,
    unsure: varies[k],
    bingo: !!m.bingo,
  }));
  const sums = g.players.map((p) => g.scores[p].reduce((s, x) => s + (x || 0), 0));
  const LV = { E: 1, N: 1, S: 1, I: 1, R: 1, T: 1, U: 1, A: 1, D: 1, H: 2, G: 2, L: 2, O: 2, M: 3, B: 3, W: 3, Z: 3, C: 4, F: 4, K: 4, P: 4, Ä: 6, J: 6, Ü: 6, V: 6, Ö: 8, X: 8, Q: 10, Y: 10 };
  const left = g.players.map((p) => [...(g.leftovers?.[p] || '')].reduce((s, t) => s + (LV[t] ?? 0), 0));
  const out = g.players.findIndex((p) => !g.leftovers?.[p]);
  games.push({
    id: 'echt-' + (g.title || '').replace(/\D/g, '').slice(-8),
    kind: 'echt',
    title: g.title || 'Eure Partie',
    note: g.note || '',
    players: g.labels || g.players,
    moves,
    final: sums.map((s, i) => (i === out ? s : s - left[i])),
    leftover: g.players.map((p) => g.leftovers?.[p] || ''),
    out,
    solutions: ok.length,
    boardWords: boardWords(finalGrid(moves)),
  });
}

// ---------- alternatives Spiel ----------
const alt = one('alternativ');
if (alt && fs.existsSync(alt)) {
  const text = fs.readFileSync(alt, 'utf8');
  const zettel = JSON.parse(fs.readFileSync(one('zettel'), 'utf8'));
  const moves = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^R\s*(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const [, round, player, score, rest] = m;
    const p = zettel.players.indexOf(player);
    if (p < 0) continue;
    if (score === '–') { moves.push({ p, round: +round, score: null, placed: [], words: [], pass: true }); continue; }
    const pm = rest.match(/\[(\S+) @ ([^\]]+)\]/);
    const letters = [...pm[1]];
    const cellsAt = pm[2].trim().split(/\s+/);
    const placed = cellsAt.map((c, j) => [ROWS.indexOf(c[0]) * SIZE + Number(c.slice(1)) - 1, letters[j].toUpperCase(), letters[j] !== letters[j].toUpperCase() ? 1 : 0]);
    const ws = rest.split('[')[0].trim().split(' + ').map((x) => { const [w, s] = x.trim().split(' '); return [w, Number(s)]; });
    moves.push({ p, round: +round, score: Number(score), placed, words: ws, bingo: rest.includes('BINGO') });
  }
  if (moves.length) {
    const sums = zettel.players.map((_, i) => moves.filter((x) => x.p === i).reduce((s, x) => s + (x.score || 0), 0));
    games.push({
      id: 'alternativ',
      kind: 'alternativ',
      title: 'Gleicher Zettel, anderes Brett',
      note: 'Nur aus euren Punkten je Zug berechnet – das echte Brett kannte die Suche nicht.',
      players: zettel.labels || zettel.players,
      moves,
      final: sums,
      boardWords: boardWords(finalGrid(moves)),
    });
  }
}

// ---------- Simulationen ----------
for (const spec of all('sim')) {
  const [file, n] = spec.split(':');
  if (!fs.existsSync(file)) continue;
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(0, n ? Number(n) : undefined);
  lines.forEach((l, gi) => {
    const r = JSON.parse(l);
    if (!r.log?.[0] || !('placed' in r.log.find((m) => m.score != null))) return;
    const label = { profi: 'Profi', gelegenheit: 'Gelegenheit' };
    let round = 0;
    const moves = r.log.map((m, k) => {
      if (k % r.types.length === 0) round++;
      return {
        p: m.p, round, score: m.score,
        placed: m.placed || [],
        words: m.words ? m.words.map((w) => [w, null]) : [],
        rack: m.rack || '',
        best: m.best ?? null, options: m.options ?? null,
        pass: !!m.pass, exchange: !!m.exchange, bingo: !!m.bingo,
      };
    });
    const base = r.types.every((t) => t === 'profi') ? 'profi' : r.types.every((t) => t === 'gelegenheit') ? 'gelegenheit' : 'gemischt';
    const kind = r.vocab === 'geläufig' ? base + '-g' : base;
    games.push({
      id: `${kind}-${gi + 1}`,
      kind,
      title: `${{ profi: 'Profis', gelegenheit: 'Gelegenheitsspieler', gemischt: 'Profi gegen zwei' }[base]} #${gi + 1}`,
      players: r.types.map((t, i) => `${label[t]} ${String.fromCharCode(65 + i)}`),
      moves,
      final: r.final,
      leftover: r.rackLeft,
      out: r.out,
      boardWords: boardWords(finalGrid(moves)),
    });
  });
}

fs.writeFileSync(one('ausgabe') || 'games.json', JSON.stringify(games));
console.log(`${games.length} Partien geschrieben (${(fs.statSync(one('ausgabe') || 'games.json').size / 1024).toFixed(0)} KB)`);
for (const g of games) {
  const bad = g.boardWords.filter((w) => !w.ok).map((w) => w.w);
  const unusual = g.boardWords.filter((w) => w.ok && !w.info?.common).map((w) => w.w);
  console.log(`  [${g.kind}] ${g.title}: ${g.final.join(' / ')}  Wörter: ${g.boardWords.length}, nicht in Liste: ${bad.join(', ') || '–'}, ungewöhnlich: ${unusual.length}`);
}
