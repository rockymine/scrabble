// Zuggenerator: alle legalen Züge mit gegebenen Steinen auf einem Brett.
// Wird für die Bewertung rekonstruierter Züge genutzt („hätte man besser legen können?“).

import { SIZE, CENTER, scorePlacement } from './reconstruct.js';

export const ALPHABET = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ'];

/**
 * @param {Array<{letter, blank}|null>} grid  aktuelles Brett (225 Felder)
 * @param {string[]} rack   Steine, '?' = Blanko
 * @param {(w: string) => boolean} isWord
 * @param {object} [opt]
 * @param {boolean} [opt.useAll=false]  nur Züge, die alle Steine verwenden
 * @param {number}  [opt.maxTiles=7]    höchstens so viele Steine legen
 * @param {(s: string) => boolean} [opt.isPrefix]  Präfix-Prüfung (beschleunigt stark)
 * @returns {Array<{tiles: number[], letters: object[], score: number, words: object[]}>}
 */
export function generateMoves(grid, rack, isWord, { useAll = false, maxTiles = 7, isPrefix = null } = {}) {
  const limit = Math.min(rack.length, maxTiles);
  const placed = new Uint8Array(SIZE * SIZE);
  let any = false;
  for (let i = 0; i < grid.length; i++) if (grid[i]) { placed[i] = 1; any = true; }
  const first = !any;
  const cells = grid.slice();
  const moves = [];

  const neighbors = (i) => {
    const r = Math.floor(i / SIZE);
    const c = i % SIZE;
    return [c > 0 ? i - 1 : -1, c < SIZE - 1 ? i + 1 : -1, r > 0 ? i - SIZE : -1, r < SIZE - 1 ? i + SIZE : -1].filter((j) => j >= 0);
  };
  const touches = (i) => neighbors(i).some((j) => placed[j]);

  // Kreuzwort (senkrecht zur Legerichtung) durch Feld i lesen
  function crossWord(i, horizontal) {
    const step = horizontal ? SIZE : 1;
    const sameLine = (a, b) => (horizontal ? true : Math.floor(a / SIZE) === Math.floor(b / SIZE));
    let s = i;
    while (s - step >= 0 && sameLine(s, s - step) && cells[s - step]) s -= step;
    let e = i;
    while (e + step < SIZE * SIZE && sameLine(e, e + step) && cells[e + step]) e += step;
    if (s === e) return '';
    let w = '';
    for (let j = s; j <= e; j += step) w += cells[j].letter;
    return w;
  }

  function mainWord(i, horizontal) {
    return crossWord(i, !horizontal);
  }

  for (const horizontal of [true, false]) {
    const step = horizontal ? 1 : SIZE;
    for (let line = 0; line < SIZE; line++) {
      const at = (k) => (horizontal ? line * SIZE + k : k * SIZE + line);
      for (let k0 = 0; k0 < SIZE; k0++) {
        if (placed[at(k0)]) continue;
        const tiles = [];
        const counts = new Map();
        for (const t of rack) counts.set(t, (counts.get(t) || 0) + 1);

        const recurse = (k, connected) => {
          if (k >= SIZE) return;
          const i = at(k);
          for (const [t, n] of counts) {
            if (!n) continue;
            const options = t === '?' ? ALPHABET.map((l) => ({ letter: l, blank: true })) : [{ letter: t, blank: false }];
            counts.set(t, n - 1);
            for (const tile of options) {
              cells[i] = tile;
              const cw = crossWord(i, horizontal);
              if (!cw || isWord(cw)) {
                tiles.push(i);
                const conn = connected || touches(i) || (first && i === CENTER);
                const enough = !useAll || tiles.length === limit;
                if (conn && enough && (tiles.length > 1 || horizontal)) {
                  const mw = mainWord(i, horizontal);
                  const valid = tiles.length === 1
                    ? (mw.length >= 2 || cw.length >= 2) && (!mw || mw.length < 2 || isWord(mw))
                    : mw.length >= 2 && isWord(mw);
                  if (valid && (!first || tiles.length >= 2)) {
                    const res = scorePlacement(cells, placed, tiles.slice());
                    moves.push({
                      tiles: tiles.slice(),
                      letters: tiles.map((j) => ({ ...cells[j] })),
                      score: res.score,
                      words: res.words,
                      bingo: res.bingo,
                    });
                  }
                }
                // nächstes freies Feld (dazwischen liegende Steine gehören zum Wort)
                let k2 = k + 1;
                while (k2 < SIZE && placed[at(k2)]) k2++;
                // Präfix-Prüfung: Wortanfang bis vor das nächste freie Feld muss Anfang eines Wortes sein
                let prefixOk = true;
                if (isPrefix && k2 < SIZE && tiles.length < limit) {
                  let ks = k0;
                  while (ks > 0 && placed[at(ks - 1)]) ks--;
                  let pre = '';
                  for (let q = ks; q < k2; q++) pre += cells[at(q)].letter;
                  prefixOk = isPrefix(pre);
                }
                if (prefixOk && k2 < SIZE && tiles.length < limit) recurse(k2, conn);
                tiles.pop();
              }
              cells[i] = null;
            }
            counts.set(t, n);
          }
        };
        recurse(k0, false);
        void step;
      }
    }
  }
  moves.sort((a, b) => b.score - a.score);
  return moves;
}
