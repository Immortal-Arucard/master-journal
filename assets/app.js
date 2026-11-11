(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  }
  var pill = document.getElementById('offline-pill');
  function sync() { if (pill) pill.hidden = navigator.onLine !== false; }
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  sync();
})();
