// Kleine Promise-Hülle um IndexedDB. Alle Daten bleiben auf dem Gerät.

const DB_NAME = 'familien-scrabble';
const DB_VERSION = 1;
const STORES = ['players', 'games', 'meta'];

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('Dieser Browser kann keine Daten speichern (IndexedDB fehlt).'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('players')) db.createObjectStore('players', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('games')) db.createObjectStore('games', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Datenbank ist blockiert – bitte andere Tabs der App schließen.'));
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    Promise.resolve(fn(t)).then((r) => (result = r), reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Speichern abgebrochen.'));
  });
}

const clone = (x) => JSON.parse(JSON.stringify(x));

export const db = {
  async all(store) {
    return tx([store], 'readonly', (t) => wrap(t.objectStore(store).getAll()));
  },
  async get(store, key) {
    return tx([store], 'readonly', (t) => wrap(t.objectStore(store).get(key)));
  },
  async put(store, value, key) {
    const v = clone(value);
    return tx([store], 'readwrite', (t) =>
      wrap(key === undefined ? t.objectStore(store).put(v) : t.objectStore(store).put(v, key)),
    );
  },
  async delete(store, key) {
    return tx([store], 'readwrite', (t) => wrap(t.objectStore(store).delete(key)));
  },

  // --- Meta ---
  getMeta(key) { return this.get('meta', key); },
  setMeta(key, value) { return this.put('meta', value, key); },

  // --- Spieler ---
  async players() {
    const list = await this.all('players');
    return list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'de'));
  },
  savePlayer(p) { return this.put('players', p); },
  deletePlayer(id) { return this.delete('players', id); },

  // --- Partien ---
  async games() {
    const list = await this.all('games');
    return list.sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
  },
  game(id) { return this.get('games', id); },
  saveGame(g) { return this.put('games', g); },
  deleteGame(id) { return this.delete('games', id); },
  async runningGame() {
    const list = await this.all('games');
    return list.filter((g) => g.status === 'running').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
  },

  // --- Backup ---
  async exportAll() {
    const [players, games] = await Promise.all([this.all('players'), this.all('games')]);
    return {
      app: 'familien-scrabble',
      format: 1,
      exportedAt: new Date().toISOString(),
      players,
      games,
    };
  },
  /** Ersetzt ALLE Spieler und Partien durch den Inhalt der Sicherung. */
  async importAll(data) {
    validateBackup(data);
    await tx(['players', 'games'], 'readwrite', (t) => {
      const ps = t.objectStore('players');
      const gs = t.objectStore('games');
      ps.clear();
      gs.clear();
      for (const p of data.players) ps.put(p);
      for (const g of data.games) gs.put(g);
    });
  },
};

export function validateBackup(data) {
  if (!data || typeof data !== 'object') throw new Error('Datei ist keine gültige Sicherung.');
  if (data.app !== 'familien-scrabble') throw new Error('Datei stammt nicht aus dieser App.');
  if (!Array.isArray(data.players) || !Array.isArray(data.games)) throw new Error('Sicherung ist unvollständig.');
  for (const p of data.players) {
    if (!p || typeof p.id !== 'string' || typeof p.name !== 'string') throw new Error('Sicherung enthält ungültige Spieler.');
  }
  for (const g of data.games) {
    if (!g || typeof g.id !== 'string' || !Array.isArray(g.playerIds) || !Array.isArray(g.turns)) {
      throw new Error('Sicherung enthält ungültige Partien.');
    }
  }
  return true;
}
