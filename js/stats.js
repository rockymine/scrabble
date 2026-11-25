// Statistik über abgeschlossene Partien – reine Funktionen.

/**
 * @param {Array} games  alle Partien (nur status 'finished' wird gezählt)
 * @returns {{ players: Object, duels: Array, records: Object, gameCount: number }}
 */
export function computeStats(games) {
  const finished = games.filter((g) => g.status === 'finished' && g.finalScores);
  const players = {};
  const P = (id) =>
    (players[id] ??= {
      id,
      games: 0,
      wins: 0,
      sharedWins: 0,
      scoreSum: 0,
      turns: 0,
      turnPointsSum: 0,
      passes: 0,
      bestGame: null, // { score, gameId, date }
      bestTurn: null, // { points, word, gameId, date }
    });

  const duelMap = new Map();
  const records = { bestGame: null, bestTurn: null };

  for (const g of finished) {
    const solo = g.winnerIds.length === 1;
    for (const id of g.playerIds) {
      const p = P(id);
      const score = g.finalScores[id];
      p.games++;
      p.scoreSum += score;
      if (g.winnerIds.includes(id)) solo ? p.wins++ : p.sharedWins++;
      if (!p.bestGame || score > p.bestGame.score) p.bestGame = { score, gameId: g.id, date: g.date };
      if (!records.bestGame || score > records.bestGame.score) {
        records.bestGame = { score, playerId: id, gameId: g.id, date: g.date };
      }
    }
    for (const t of g.turns) {
      if (!g.playerIds.includes(t.playerId)) continue;
      const p = P(t.playerId);
      p.turns++;
      p.turnPointsSum += t.points;
      if (t.pass) p.passes++;
      if (!p.bestTurn || t.points > p.bestTurn.points) {
        p.bestTurn = { points: t.points, word: t.word, gameId: g.id, date: g.date };
      }
      if (!records.bestTurn || t.points > records.bestTurn.points) {
        records.bestTurn = { points: t.points, word: t.word, playerId: t.playerId, gameId: g.id, date: g.date };
      }
    }
    // Duell-Bilanz: jedes Paar, das gemeinsam gespielt hat, nach Endstand verglichen
    const ids = g.playerIds;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = [ids[i], ids[j]].sort();
        const key = a + '|' + b;
        const d = duelMap.get(key) ?? { a, b, games: 0, aWins: 0, bWins: 0, draws: 0, twoPlayerGames: 0 };
        d.games++;
        if (ids.length === 2) d.twoPlayerGames++;
        const sa = g.finalScores[a];
        const sb = g.finalScores[b];
        if (sa > sb) d.aWins++;
        else if (sb > sa) d.bWins++;
        else d.draws++;
        duelMap.set(key, d);
      }
    }
  }

  for (const p of Object.values(players)) {
    p.avgScore = p.games ? p.scoreSum / p.games : 0;
    p.avgTurn = p.turns ? p.turnPointsSum / p.turns : 0;
    p.winRate = p.games ? (p.wins + p.sharedWins) / p.games : 0;
  }

  return { players, duels: [...duelMap.values()], records, gameCount: finished.length };
}
