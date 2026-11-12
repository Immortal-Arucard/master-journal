(function () {
  // v4: registers the service worker and reloads once when a new version
  // takes over (assets/auto-update.js), so the Home Screen app updates itself.
  // It waits while you are typing or dictating.
  if (window.TWGIAutoUpdate) {
    window.TWGIAutoUpdate.start({ window: window, storage: window.sessionStorage, busySelector: '#pensieve-toggle[aria-pressed="true"]' });
  } else if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  }
  var pill = document.getElementById('offline-pill');
  function sync() { if (pill) pill.hidden = navigator.onLine !== false; }
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  sync();

  // v8: show which saved (offline) copy this phone is running, e.g. "master-journal-v8",
  // so a stale copy is easy to spot. Read only; nothing is changed.
  function showCache() {
    var slots = document.querySelectorAll('[data-sw-cache]');
    if (!slots.length) return;
    function put(t) { Array.prototype.forEach.call(slots, function (n) { n.textContent = t; }); }
    if (!window.caches || !caches.keys) { put('not available'); return; }
    caches.keys().then(function (keys) {
      var mine = keys.filter(function (k) { return k.indexOf('master-journal-') === 0; }).sort();
      put(mine.length ? mine.join(', ') : 'not saved yet');
    }).catch(function () { put('not available'); });
  }
  showCache();
  if (navigator.serviceWorker && navigator.serviceWorker.addEventListener) navigator.serviceWorker.addEventListener('controllerchange', showCache);
  window.addEventListener('pageshow', showCache);
})();
