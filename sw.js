/* Journal service worker. Own cache, separate from the main TWGI site.
   Precaches the app shell so the Journal opens offline. Never caches
   Supabase or other cross-origin requests. */
var CACHE = 'master-journal-v3';
var APP_TITLE = 'Journal';
var PRECACHE = [
  '/',
  '/index.html',
  '/login/',
  '/404.html',
  '/manifest.webmanifest',
  '/assets/app.css',
  '/assets/app.js',
  '/assets/auth.js',
  '/assets/login.js',
  '/assets/journal.js',
  '/assets/journal-ui.js',
  '/assets/settings.js',
  '/assets/settings-ui.js',
  '/assets/originals.js',
  '/assets/pensieve.js',
  '/assets/push-core.js',
  '/assets/push-ui.js',
  '/vendor/supabase.js',
  '/icons/favicon-48.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    return cache.addAll(PRECACHE.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('master-journal-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    var hasAuth = /[?&#](code|error|error_description|access_token|token_hash)=/.test(url.search + url.hash);
    event.respondWith(fetch(req).then(function (res) {
      if (res && res.ok && !hasAuth) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(url.pathname, copy); });
      }
      return res;
    }).catch(function () {
      var path = url.pathname.replace(/index\.html$/, '');
      return caches.match(path, { ignoreSearch: true }).then(function (hit) {
        return hit || caches.match('/', { ignoreSearch: true });
      });
    }));
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) {
    var net = fetch(req).then(function (res) {
      if (res && res.ok && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    });
    return hit || net;
  }));
});

/* Push notifications (v3). The push service sends JSON:
   { title, body, url, tag, kind }. Only same-origin paths are opened. */
function safePath(value) {
  return typeof value === 'string' && value.charAt(0) === '/' && value.charAt(1) !== '/' && value.charAt(1) !== '\\' ? value : '/';
}

self.addEventListener('push', function (event) {
  var payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch (err) { payload = { body: event.data ? event.data.text() : '' }; }
  var title = String(payload.title || APP_TITLE).slice(0, 120);
  var options = {
    body: String(payload.body || '').slice(0, 240),
    icon: '/icons/icon-192.png',
    badge: '/icons/favicon-48.png',
    tag: typeof payload.tag === 'string' ? payload.tag.slice(0, 64) : undefined,
    renotify: !!payload.tag,
    data: { url: safePath(payload.url), kind: String(payload.kind || '') }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var path = safePath(event.notification.data && event.notification.data.url);
  var target = new URL(path, self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windows) {
    var same = windows.filter(function (c) { return c.url && c.url.indexOf(self.location.origin) === 0; });
    var exact = same.find(function (c) { return c.url === target; });
    var client = exact || same[0];
    if (client) {
      if (!exact && client.postMessage) client.postMessage({ type: 'twgi-open', url: path });
      return client.focus ? client.focus() : client;
    }
    return self.clients.openWindow ? self.clients.openWindow(target) : null;
  }));
});
