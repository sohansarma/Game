// Offline support: cache the app shell, serve it cache-first, and never
// cache API calls (leaderboards must be live).
const VERSION = 'tidepop-v19';
const SHELL = [
  './', 'index.html', 'config.js', 'manifest.webmanifest', 'css/style.css',
  'js/main.js', 'js/engine.js', 'js/rng.js', 'js/blocks.js', 'js/levels.js', 'js/level-tuning.js', 'js/modes.js',
  'js/storage.js', 'js/audio.js', 'js/api.js', 'js/ui.js', 'js/creatures.js', 'js/matchview.js', 'js/blocksview.js',
  'js/achievements.js', 'js/arcade/index.js', 'js/arcade/miner.js', 'js/arcade/miner-view.js', 'js/arcade/puffer.js', 'js/arcade/puffer-view.js', 'js/arcade/serpent.js', 'js/arcade/serpent-view.js', 'js/arcade/merge.js', 'js/arcade/merge-view.js', 'js/arcade/stack.js', 'js/arcade/stack-view.js', 'js/arcade/sort.js', 'js/arcade/sort-view.js', 'js/arcade/breaker.js', 'js/arcade/breaker-view.js', 'js/arcade/catch.js', 'js/arcade/catch-view.js', 'js/arcade/chess.js', 'js/arcade/chess-view.js', 'js/arcade/chess-pieces.js', 'js/arcade/table.js', 'js/arcade/ludo.js', 'js/arcade/ludo-view.js', 'js/arcade/cube.js', 'js/arcade/cube-view.js', 'js/cozy.js', 'js/cloud.js', 'js/pool.js', 'js/arcade/tide.js', 'js/arcade/tide-view.js', 'js/versus.js', 'js/maker/engine.js', 'js/maker/view.js', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.includes('/api/') || url.origin !== location.origin) return;
  // stale-while-revalidate for the app shell
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const network = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => cached || (e.request.mode === 'navigate' ? cache.match('index.html') : undefined));
      return cached || network;
    }),
  );
});
