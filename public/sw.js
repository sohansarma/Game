// Offline support: cache the app shell, serve it cache-first, and never
// cache API calls (leaderboards must be live).
const VERSION = 'tidepop-v1';
const SHELL = [
  './', 'index.html', 'config.js', 'manifest.webmanifest', 'css/style.css',
  'js/main.js', 'js/engine.js', 'js/rng.js', 'js/blocks.js', 'js/levels.js', 'js/level-tuning.js', 'js/modes.js',
  'js/storage.js', 'js/audio.js', 'js/api.js', 'js/ui.js', 'js/creatures.js', 'js/matchview.js', 'js/blocksview.js',
  'js/achievements.js', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
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
