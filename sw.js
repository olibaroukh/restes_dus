/* Restes dus — service worker : mises à jour sans vider le cache du navigateur.
 * Fichiers de l'appli : réseau d'abord (revalidé à chaque ouverture, sans attendre le cache GitHub de 10 min),
 * copie locale en secours. Les données passent par l'API (autre adresse) : jamais mises en cache ici.
 * Changer CACHE n'est pas nécessaire à chaque version : version.json + bandeau « Mettre à jour » suffisent. */
const CACHE = 'restes-dus-v2';
const FICHIERS = ['./', './index.html', './app.js', './app.css'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FICHIERS)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('restes-dus-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // API Cloudflare : jamais interceptée
  if (u.pathname.endsWith('/version.json')) return;                          // toujours lu en direct
  const cle = new Request(u.origin + u.pathname);                            // ?v=… ignoré pour la copie locale
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(cle, c)); }
    return r;
  }).catch(() => caches.match(cle).then(r => r || caches.match('./index.html'))));
});
