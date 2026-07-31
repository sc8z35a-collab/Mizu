const CACHE = 'mizune-v1.0.1-permission-fix';
const ASSETS = [
  './','./index.html','./manifest.webmanifest','./assets/icon.svg',
  './src/main.js','./src/styles/app.css','./src/core/event-bus.js','./src/core/audio-engine.js',
  './src/core/recorder.js','./src/core/storage.js','./src/core/capabilities.js','./src/core/offline-analyzer.js',
  './src/visuals/visual-engine.js','./src/ui/app-controller.js','./src/utils/format.js','./src/workers/analysis.worker.js'
];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); return response;
  }).catch(() => event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())));
});
