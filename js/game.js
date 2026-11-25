// Reine Spiellogik – keine DOM- oder Datenbankzugriffe, damit sie testbar bleibt.
//
// Partie:
// {
//   id, date: 'YYYY-MM-DD', createdAt, finishedAt,
//   source: 'live' | 'paper',
//   status: 'running' | 'finished',
//   playerIds: [id, …]            // Reihenfolge am Tisch
//   turns: [{ id, playerId, points, word, pass }],
//   end: { outPlayerId: id | null, remaining: { [playerId]: number } },
//   finalScores: { [playerId]: number },
//   winnerIds: [id, …]
// }

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function todayISO(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function createGame({ playerIds, date = todayISO(), source = 'live' }) {
  if (!Array.isArray(playerIds) || playerIds.length < 2 || playerIds.length > 4) {
    throw new Error('Eine Partie braucht 2 bis 4 Spieler.');
  }
  if (new Set(playerIds).size !== playerIds.length) throw new Error('Spieler doppelt ausgewählt.');
  return {
    id: uid(),
    date,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    source,
    status: 'running',
    playerIds: [...playerIds],
    turns: [],
    end: null,
    finalScores: null,
    winnerIds: [],
  };
}

/** Wer ist als Nächstes dran? (Index in playerIds) */
export function currentPlayerIndex(game) {
  return game.turns.length % game.playerIds.length;
}

export function currentPlayerId(game) {
  return game.playerIds[currentPlayerIndex(game)];
}

/** Rundennummer (1-basiert) des Zugs mit Index i. */
export function roundOf(game, i) {
  return Math.floor(i / game.playerIds.length) + 1;
}

export function parsePoints(value) {
  const s = String(value ?? '').trim();
  if (!/^\d{1,4}$/.test(s)) return null;
  return Number(s);
}

export function makeTurn(playerId, { points = 0, word = '', pass = false } = {}) {
  return {
    id: uid(),
    playerId,
    points: pass ? 0 : points,
    word: pass ? '' : String(word || '').trim(),
    pass: !!pass,
  };
}

/** Zug für den aktuellen Spieler anhängen. Gibt die Partie (verändert) zurück. */
export function addTurn(game, { points, word = '', pass = false }) {
  if (game.status !== 'running') throw new Error('Partie ist bereits beendet.');
  if (!pass && (!Number.isInteger(points) || points < 0)) throw new Error('Ungültige Punktzahl.');
  game.turns.push(makeTurn(currentPlayerId(game), { points, word, pass }));
  return game;
}

export function undoLastTurn(game) {
  if (game.status !== 'running') throw new Error('Partie ist bereits beendet.');
  return game.turns.pop() || null;
}

/** Einzelnen Zug korrigieren (Spieler bleibt gleich). */
export function updateTurn(game, turnId, { points, word = '', pass = false }) {
  const t = game.turns.find((x) => x.id === turnId);
  if (!t) throw new Error('Zug nicht gefunden.');
  if (!pass && (!Number.isInteger(points) || points < 0)) throw new Error('Ungültige Punktzahl.');
  t.pass = !!pass;
  t.points = pass ? 0 : points;
  t.word = pass ? '' : String(word || '').trim();
  if (game.status === 'finished') applyEnd(game, game.end);
  return game;
}

/** Summe der Zugpunkte je Spieler (ohne Reststeine). */
export function turnTotals(game) {
  const totals = Object.fromEntries(game.playerIds.map((id) => [id, 0]));
  for (const t of game.turns) {
    if (t.playerId in totals) totals[t.playerId] += t.points;
  }
  return totals;
}

export function turnCounts(game) {
  const c = Object.fromEntries(game.playerIds.map((id) => [id, 0]));
  for (const t of game.turns) if (t.playerId in c) c[t.playerId]++;
  return c;
}

/**
 * Endstand nach Hausregel:
 *  - Wer ausgemacht hat, bekommt KEINE Pluspunkte.
 *  - Alle anderen: Wert der Reststeine wird abgezogen.
 *  - Hat niemand ausgemacht (outPlayerId = null), wird bei allen abgezogen.
 */
export function computeFinal(game, end) {
  const totals = turnTotals(game);
  const remaining = {};
  const finalScores = {};
  for (const id of game.playerIds) {
    const r = id === end.outPlayerId ? 0 : Number(end.remaining?.[id] ?? 0);
    if (!Number.isInteger(r) || r < 0) throw new Error('Ungültiger Wert der Reststeine.');
    remaining[id] = r;
    finalScores[id] = totals[id] - r;
  }
  const best = Math.max(...Object.values(finalScores));
  const winnerIds = game.playerIds.filter((id) => finalScores[id] === best);
  return { end: { outPlayerId: end.outPlayerId ?? null, remaining }, totals, finalScores, winnerIds };
}

function applyEnd(game, end) {
  const r = computeFinal(game, end);
  game.end = r.end;
  game.finalScores = r.finalScores;
  game.winnerIds = r.winnerIds;
  return game;
}

export function finishGame(game, end) {
  if (end.outPlayerId != null && !game.playerIds.includes(end.outPlayerId)) {
    throw new Error('Unbekannter Spieler.');
  }
  applyEnd(game, end);
  game.status = 'finished';
  game.finishedAt = game.finishedAt || new Date().toISOString();
  return game;
}

/** Ende einer abgeschlossenen Partie nachträglich ändern. */
export function updateEnd(game, end) {
  return finishGame(game, end);
}

/** Partie wieder öffnen (z. B. versehentlich beendet). */
export function reopenGame(game) {
  game.status = 'running';
  game.end = null;
  game.finalScores = null;
  game.winnerIds = [];
  game.finishedAt = null;
  return game;
}

/** Züge nach Runden gruppieren: [[turn|null, …je Spieler], …] */
export function turnsByRound(game) {
  const n = game.playerIds.length;
  const col = Object.fromEntries(game.playerIds.map((id, i) => [id, i]));
  const rounds = [];
  const perPlayer = Object.fromEntries(game.playerIds.map((id) => [id, 0]));
  for (const t of game.turns) {
    const r = perPlayer[t.playerId]++;
    while (rounds.length <= r) rounds.push(new Array(n).fill(null));
    rounds[r][col[t.playerId]] = t;
  }
  return rounds;
}

// ---------- Papierpartien ----------

/**
 * Zahlenliste eines Spielers einlesen: "12 24, 8; 0 - x 15"
 * 0, '-', 'x', 'a' (Aussetzen) oder 't' (Tauschen) = Zug ohne Punkte (markiert).
 * Ein Wort darf direkt hinter der Zahl stehen: "24 HAUS 12" oder "24:HAUS".
 */
export function parseTurnList(text) {
  const tokens = String(text || '')
    .split(/[\s,;]+/)
    .flatMap((tk) => tk.split(':'))
    .map((tk) => tk.trim())
    .filter(Boolean);
  const turns = [];
  const errors = [];
  for (const tk of tokens) {
    if (/^\d{1,4}$/.test(tk)) {
      const p = Number(tk);
      turns.push({ points: p, word: '', pass: p === 0 });
    } else if (/^[-–x×at]$/i.test(tk)) {
      turns.push({ points: 0, word: '', pass: true });
    } else if (/^\p{L}+$/u.test(tk) && turns.length && !turns.at(-1).pass && !turns.at(-1).word) {
      turns.at(-1).word = tk.toUpperCase();
    } else {
      errors.push(tk);
    }
  }
  return { turns, errors };
}

/** Papierpartie aus Zuglisten je Spieler erzeugen (Runde für Runde verzahnt). */
export function buildPaperGame({ date, playerIds, lists, end }) {
  const game = createGame({ playerIds, date, source: 'paper' });
  const maxLen = Math.max(0, ...playerIds.map((id) => lists[id]?.length || 0));
  for (let r = 0; r < maxLen; r++) {
    for (const id of playerIds) {
      const t = lists[id]?.[r];
      if (t) game.turns.push(makeTurn(id, t));
    }
  }
  return finishGame(game, end);
}
