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
})();
