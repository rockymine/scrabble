// Service Worker: App-Dateien vorab speichern, Wortliste beim ersten Abruf.
// VERSION wird beim Veröffentlichen automatisch aus dem Inhalt aller App-Dateien
// berechnet (tools/stamp-sw.mjs), damit Geräte Updates zuverlässig bekommen.
const VERSION = '1.0.0-20c84a32e0';
const SHELL_CACHE = `shell-${VERSION}`;
const WORDS_CACHE = 'words';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/game.js',
  './js/letters.js',
  './js/normalize.js',
  './js/stats.js',
  './js/ui.js',
  './js/words.js',
  './js/reconstruct.js',
  './js/movegen.js',
  './words/de/index.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('shell-') && key !== SHELL_CACHE) await caches.delete(key);
    }
    await cleanWordsCache();
    await self.clients.claim();
  })());
});

/** Alte Wortlisten-Versionen entfernen (Dateien tragen ?v=<version>). */
async function cleanWordsCache() {
  try {
    const index = await (await caches.match('./words/de/index.json', { ignoreSearch: true }))?.json();
    if (!index) return;
    const cache = await caches.open(WORDS_CACHE);
    for (const req of await cache.keys()) {
      const v = new URL(req.url).searchParams.get('v');
      if (v !== index.version) await cache.delete(req);
    }
  } catch { /* egal */ }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Wortlisten-Teile: einmal laden, dann immer aus dem Speicher
  if (url.pathname.includes('/words/de/') && url.pathname.endsWith('.txt.gz')) {
    event.respondWith((async () => {
      const cache = await caches.open(WORDS_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) await cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  // App-Dateien: zuerst aus dem Speicher (offline), Seitenaufrufe auf index.html
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const index = await cache.match('./index.html');
      if (index) return index;
    }
    return fetch(req);
  })());
});
