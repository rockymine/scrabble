// Züge aus Endbrett + Punkteliste rekonstruieren.
//
// Idee: Ausgehend vom leeren Brett werden Schritt für Schritt Steine des
// Endbretts gelegt. Jeder Zug muss nach den Scrabble-Regeln legal sein
// (eine Reihe/Spalte, lückenlos, angelegt bzw. durch die Mitte) und genau die
// notierte Punktzahl ergeben. Gesucht werden alle Reihenfolgen, die passen.
// Unbekannte Wörter (nicht in der Wortliste) sind erlaubt, kosten aber
// „Strafpunkte“; bevorzugt werden Lösungen mit möglichst wenigen davon.
//
// Reine Logik, läuft im Browser und in Node.

import { LETTER_VALUES } from './letters.js';
import { normalizeWord } from './normalize.js';

export const SIZE = 15;
export const ROWS = 'ABCDEFGHIJKLMNO';

// Prämienfelder (Standardbrett), Zeilen A–O, Spalten 1–15
const PREMIUM_MAP = [
  'W..d...W...d..W',
  '.w...t...t...w.',
  '..w...d.d...w..',
  'd..w...d...w..d',
  '....w.....w....',
  '.t...t...t...t.',
  '..d...d.d...d..',
  'W..d...w...d..W',
  '..d...d.d...d..',
  '.t...t...t...t.',
  '....w.....w....',
  'd..w...d...w..d',
  '..w...d.d...w..',
  '.w...t...t...w.',
  'W..d...W...d..W',
];
// W = dreifacher Wortwert, w = doppelter Wortwert, t = dreifacher, d = doppelter Buchstabenwert
export const PREMIUM = PREMIUM_MAP.join('');
export const CENTER = 7 * SIZE + 7;
export const BINGO_BONUS = 50;
export const RACK_SIZE = 7;

export function cellName(i) {
  return ROWS[Math.floor(i / SIZE)] + ((i % SIZE) + 1);
}

/**
 * Brett einlesen: 15 Zeilen à 15 Zeichen, '.' = leer, Großbuchstabe = Stein,
 * Kleinbuchstabe = Blanko, der diesen Buchstaben darstellt.
 */
export function parseBoard(lines) {
  const rows = (Array.isArray(lines) ? lines : String(lines).split(/\r?\n/))
    .map((l) => l.trim())
    .filter(Boolean);
  if (rows.length !== SIZE) throw new Error(`Brett braucht ${SIZE} Zeilen, gefunden: ${rows.length}`);
  const cells = new Array(SIZE * SIZE).fill(null);
  rows.forEach((row, r) => {
    const chars = [...row];
    if (chars.length !== SIZE) throw new Error(`Zeile ${ROWS[r]} hat ${chars.length} statt ${SIZE} Zeichen`);
    chars.forEach((ch, c) => {
      if (ch === '.' || ch === '_' || ch === ' ') return;
      const upper = ch.toUpperCase();
      if (!/^[A-ZÄÖÜ]$/.test(upper)) throw new Error(`Unbekanntes Zeichen „${ch}“ in ${ROWS[r]}${c + 1}`);
      cells[r * SIZE + c] = { letter: upper, blank: ch !== upper };
    });
  });
  return cells;
}

const tileValue = (cell) => (cell.blank ? 0 : LETTER_VALUES[cell.letter] ?? 0);

/**
 * Wort entlang einer Richtung bewerten.
 * @param cells   Endbrett
 * @param has     (i) => true, wenn Feld i (nach dem Zug) belegt ist
 * @param isNew   (i) => true, wenn Stein i in diesem Zug gelegt wurde
 * @returns {{word, start, len, score}} oder null bei Länge < 2
 */
function wordAt(cells, has, isNew, i, horizontal) {
  const r = Math.floor(i / SIZE);
  const c = i % SIZE;
  const step = horizontal ? 1 : SIZE;
  const inLine = (j) => (horizontal ? Math.floor(j / SIZE) === r : j >= 0 && j < SIZE * SIZE);
  let s = i;
  while (inLine(s - step) && s - step >= 0 && has(s - step)) s -= step;
  let e = i;
  while (inLine(e + step) && e + step < SIZE * SIZE && has(e + step)) e += step;
  if (s === e) return null;
  let sum = 0;
  let mult = 1;
  let word = '';
  for (let j = s; j <= e; j += step) {
    const cell = cells[j];
    word += cell.letter;
    let v = tileValue(cell);
    if (isNew(j)) {
      const p = PREMIUM[j];
      if (p === 'd') v *= 2;
      else if (p === 't') v *= 3;
      else if (p === 'w') mult *= 2;
      else if (p === 'W') mult *= 3;
    }
    sum += v;
  }
  void c;
  return { word, start: s, horizontal, len: (e - s) / step + 1, score: sum * mult };
}

/** Punkte und gebildete Wörter für das Legen der Steine `tiles` (Indizes). */
export function scorePlacement(cells, placed, tiles) {
  const newSet = new Set(tiles);
  const has = (j) => placed[j] || newSet.has(j);
  const isNew = (j) => newSet.has(j);
  const words = [];
  if (tiles.length === 1) {
    for (const hz of [true, false]) {
      const w = wordAt(cells, has, isNew, tiles[0], hz);
      if (w) words.push(w);
    }
  } else {
    const horizontal = Math.floor(tiles[0] / SIZE) === Math.floor(tiles[1] / SIZE);
    const main = wordAt(cells, has, isNew, tiles[0], horizontal);
    if (main) words.push(main);
    for (const t of tiles) {
      const w = wordAt(cells, has, isNew, t, !horizontal);
      if (w) words.push(w);
    }
  }
  let score = words.reduce((s, w) => s + w.score, 0);
  const bingo = tiles.length === RACK_SIZE;
  if (bingo) score += BINGO_BONUS;
  return { score, words, bingo };
}

/** Alle legalen Züge im aktuellen Zustand (ohne Punkteprüfung). */
export function legalMoves(cells, placed, first) {
  const moves = [];
  const seen = new Set();
  const adjacentPlaced = (i) => {
    const r = Math.floor(i / SIZE);
    const c = i % SIZE;
    return (c > 0 && placed[i - 1]) || (c < SIZE - 1 && placed[i + 1]) ||
      (r > 0 && placed[i - SIZE]) || (r < SIZE - 1 && placed[i + SIZE]);
  };
  for (const horizontal of [true, false]) {
    for (let line = 0; line < SIZE; line++) {
      const idx = (k) => (horizontal ? line * SIZE + k : k * SIZE + line);
      for (let a = 0; a < SIZE; a++) {
        if (!cells[idx(a)] || placed[idx(a)]) continue;
        const tiles = [];
        for (let b = a; b < SIZE; b++) {
          const j = idx(b);
          if (!cells[j]) break; // Lücke im Endbrett → Spanne endet
          if (placed[j]) continue;
          tiles.push(j);
          if (tiles.length > RACK_SIZE) break;
          // Einzelsteine nur einmal (unabhängig von der Richtung) erzeugen
          if (tiles.length === 1 && !horizontal) continue;
          const key = tiles.join(',');
          if (seen.has(key)) continue;
          seen.add(key);
          const ok = first
            ? tiles.length >= 2 && tiles.includes(CENTER)
            : tiles.some(adjacentPlaced);
          if (ok) moves.push([...tiles]);
        }
      }
    }
  }
  return moves;
}

/**
 * Rekonstruktion.
 * @param {object} opts
 * @param {Array}  opts.cells    parseBoard(...)
 * @param {Array<{player: string, score: number|null, word?: string}>} opts.turns
 *        Züge in Spielreihenfolge; score null = Aussetzen/Tauschen (keine Steine);
 *        word (optional) = eingetragenes Wort – muss unter den gebildeten Wörtern sein
 * @param {(word: string) => boolean} [opts.isWord]  Wortliste (optional)
 * @param {number} [opts.maxUnknown=6]   max. unbekannte Wörter pro Lösung
 * @param {number} [opts.maxSolutions=200]
 * @param {number} [opts.maxNodes=5e6]   Abbruch, falls die Suche explodiert
 * @returns {{solutions: Array, unknownBudget: number|null, nodes: number, complete: boolean}}
 */
export function reconstruct({ cells, turns, isWord = () => true, maxUnknown = 6, maxSolutions = 200, maxNodes = 5e6 }) {
  const total = cells.filter(Boolean).length;
  const scoring = turns.map((t) => t.score != null);
  const wanted = turns.map((t) => (t.word ? normalizeWord(t.word) : null));
  // Verbleibende Züge mit Steinen ab Position k (für Schranken)
  const movesLeft = new Array(turns.length + 1).fill(0);
  for (let k = turns.length - 1; k >= 0; k--) movesLeft[k] = movesLeft[k + 1] + (scoring[k] ? 1 : 0);

  const wordCache = new Map();
  const known = (w) => {
    if (!wordCache.has(w)) wordCache.set(w, isWord(w));
    return wordCache.get(w);
  };

  let nodes = 0;
  let aborted = false;

  for (let budget = 0; budget <= maxUnknown; budget++) {
    const failed = new Map(); // key -> größtes Budget, mit dem es scheiterte
    const solutions = [];
    const placed = new Uint8Array(SIZE * SIZE);
    const path = [];
    let count = 0;

    const keyOf = (k) => k + ':' + placed.join('');

    const dfs = (k, left, unknownLeft) => {
      if (aborted || solutions.length >= maxSolutions) return true;
      if (++nodes > maxNodes) { aborted = true; return true; }
      if (k === turns.length) {
        if (count === total) {
          solutions.push(path.map((m) => ({ ...m })));
          return true;
        }
        return false;
      }
      const remaining = total - count;
      if (remaining > movesLeft[k] * RACK_SIZE || remaining < movesLeft[k]) return false;
      const key = keyOf(k);
      if ((failed.get(key) ?? -1) >= unknownLeft) return false;

      let found = false;
      if (!scoring[k]) {
        path.push({ turn: k, player: turns[k].player, score: null, tiles: [], words: [] });
        found = dfs(k + 1, left, unknownLeft);
        path.pop();
      } else {
        const first = count === 0;
        for (const tiles of legalMoves(cells, placed, first)) {
          const res = scorePlacement(cells, placed, tiles);
          if (res.score !== turns[k].score) continue;
          if (wanted[k] && !res.words.some((w) => w.word === wanted[k])) continue;
          const unknown = res.words.filter((w) => !known(w.word)).map((w) => w.word);
          if (unknown.length > unknownLeft) continue;
          for (const t of tiles) placed[t] = 1;
          count += tiles.length;
          path.push({ turn: k, player: turns[k].player, score: res.score, tiles, words: res.words, unknown, bingo: res.bingo });
          if (dfs(k + 1, left, unknownLeft - unknown.length)) found = true;
          path.pop();
          count -= tiles.length;
          for (const t of tiles) placed[t] = 0;
          if (aborted || solutions.length >= maxSolutions) break;
        }
      }
      if (!found) failed.set(key, Math.max(failed.get(key) ?? -1, unknownLeft));
      return found;
    };

    dfs(0, total, budget);
    if (solutions.length || aborted) {
      return { solutions, unknownBudget: solutions.length ? budget : null, nodes, complete: !aborted && solutions.length < maxSolutions };
    }
  }
  return { solutions: [], unknownBudget: null, nodes, complete: !aborted };
}

/** Lesbare Beschreibung eines Zugs, z. B. „WEIL (H5→)“. */
export function describeMove(cells, move) {
  if (move.score == null) return '– (ausgesetzt/getauscht)';
  const tiles = move.tiles;
  const main = move.words.find((w) => tiles.length === 1 || w.horizontal === (Math.floor(tiles[0] / SIZE) === Math.floor(tiles.at(-1) / SIZE))) || move.words[0];
  const placedLetters = tiles.map((t) => (cells[t].blank ? cells[t].letter.toLowerCase() : cells[t].letter)).join('');
  return {
    main: main.word,
    at: cellName(main.start) + (main.horizontal ? ' →' : ' ↓'),
    placed: placedLetters,
    placedAt: tiles.map(cellName),
    words: move.words.map((w) => `${w.word} ${w.score}`),
  };
}

/**
 * Bänke rekonstruieren über den „leerer Beutel“-Schluss:
 * Ab dem Zug, nach dem der Beutel leer ist, zieht niemand mehr nach. Was ein
 * Spieler danach legt, plus seine Reststeine, war genau seine Bank in diesem Moment.
 *
 * @param cells     Endbrett
 * @param solution  Züge (aus reconstruct)
 * @param players   Spieler in Sitzreihenfolge
 * @param leftovers { [player]: 'DK' } Reststeine am Ende (Buchstaben, '?' = Blanko)
 * @returns {{ ok, emptyAfter, racks: {[player]: {size, tiles: string[]}}, problems: string[] }}
 */
export function analyzeRacks(cells, solution, players, leftovers = {}) {
  const leftCount = Object.values(leftovers).reduce((s, x) => s + [...x].length, 0);
  const totalTiles = cells.filter(Boolean).length + leftCount;
  let bag = totalTiles - players.length * RACK_SIZE;
  const size = Object.fromEntries(players.map((p) => [p, RACK_SIZE]));
  let emptyAfter = bag <= 0 ? -1 : null;
  const problems = [];

  solution.forEach((m, k) => {
    if (emptyAfter !== null) return;
    const n = m.tiles.length;
    size[m.player] -= n;
    const drawn = Math.min(n, bag);
    bag -= drawn;
    size[m.player] += drawn;
    if (bag === 0 && n > 0) emptyAfter = k;
  });

  const racks = {};
  for (const p of players) {
    const tiles = [];
    if (emptyAfter !== null) {
      for (const m of solution.slice(emptyAfter + 1)) {
        if (m.player !== p) continue;
        for (const t of m.tiles) tiles.push(cells[t].blank ? '?' : cells[t].letter);
      }
    }
    tiles.push(...[...(leftovers[p] || '')]);
    racks[p] = { size: size[p], tiles };
    if (emptyAfter !== null && tiles.length !== size[p]) {
      problems.push(`${p}: ${tiles.length} Steine nach leerem Beutel, Bank hatte aber ${size[p]}`);
    }
  }
  return { ok: problems.length === 0, emptyAfter, racks, problems };
}

/** Brett vor Zug k einer Lösung (nur die bis dahin gelegten Steine). */
export function boardBefore(cells, solution, k) {
  const grid = new Array(SIZE * SIZE).fill(null);
  for (const m of solution.slice(0, k)) for (const t of m.tiles) grid[t] = { ...cells[t] };
  return grid;
}

/**
 * Was lässt sich über die Bank VOR jedem Zug sicher sagen?
 *
 * Grundidee: Steine verlassen die Bank nur durch Legen (Tauschen ausgenommen).
 * Die Bank vor Zug k besteht also nur aus Steinen, die der Spieler ab Zug k noch
 * legt oder am Ende übrig behält („Vorrat“). Unbekannt ist nur, WANN er welchen
 * davon gezogen hat. Daraus folgen Mindestmengen:
 *   - was er in Zug k legt, ist sicher drauf;
 *   - hat er bis zu einem späteren Zug u insgesamt nur D Steine nachgezogen,
 *     legt aber bis dahin n Steine eines Buchstabens, waren mindestens n − D davon
 *     schon da (gilt auch für „bis zum Ende“ inkl. Reststeine).
 *
 * @returns Array je Zug: { player, size, sure: string[], possible: string[], exact }
 */
export function rackBounds(cells, solution, players, leftovers = {}) {
  const letterOf = (t) => (cells[t].blank ? '?' : cells[t].letter);
  const leftCount = Object.values(leftovers).reduce((s, x) => s + [...x].length, 0);
  let bag = cells.filter(Boolean).length + leftCount - players.length * RACK_SIZE;
  const size = Object.fromEntries(players.map((p) => [p, RACK_SIZE]));
  const sizeBefore = [];
  const drawn = [];
  solution.forEach((m) => {
    sizeBefore.push(size[m.player]);
    const n = m.tiles.length;
    const d = Math.min(n, Math.max(bag, 0));
    bag -= d;
    size[m.player] += d - n;
    drawn.push(d);
  });

  const count = (arr) => arr.reduce((acc, x) => acc.set(x, (acc.get(x) || 0) + 1), new Map());

  return solution.map((m, k) => {
    const p = m.player;
    const mine = solution.map((x, i) => i).filter((i) => i >= k && solution[i].player === p);
    const pool = [...mine.flatMap((i) => solution[i].tiles.map(letterOf)), ...[...(leftovers[p] || '')]];
    const poolCount = count(pool);
    const min = new Map();
    const bump = (L, v) => { if (v > (min.get(L) || 0)) min.set(L, v); };
    // Fenster bis zu jedem späteren eigenen Zug u
    let played = [];
    let draws = 0;
    for (const u of mine) {
      played = played.concat(solution[u].tiles.map(letterOf));
      for (const [L, c] of count(played)) bump(L, c - draws);
      draws += drawn[u];
    }
    // Fenster bis zum Ende (inkl. Reststeine)
    for (const [L, c] of poolCount) bump(L, c - draws);
    const sure = [];
    for (const [L, c] of min) for (let i = 0; i < c; i++) sure.push(L);
    const possible = [];
    for (const [L, c] of poolCount) if (c > (min.get(L) || 0)) possible.push(L);
    const sz = sizeBefore[k];
    return { player: p, size: sz, sure: sure.sort(), possible: possible.sort(), exact: sure.length >= sz };
  });
}
