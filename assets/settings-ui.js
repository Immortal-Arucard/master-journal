/* Settings panel: Original dictation copies (ask / always / never). */
(function () {
  var form = document.getElementById('settings-form');
  if (!form || !window.TWGISettings) return;
  var status = document.getElementById('settings-status');
  var userId = '';
  function paint() {
    var v = window.TWGISettings.get(userId, 'journal', 'dictationOriginals');
    Array.prototype.forEach.call(form.querySelectorAll('input[name=dictationOriginals]'), function (r) { r.checked = r.value === v; r.disabled = !userId; });
  }
  form.addEventListener('change', function (e) {
    if (!userId || e.target.name !== 'dictationOriginals') return;
    try { window.TWGISettings.set(userId, 'journal', 'dictationOriginals', e.target.value); status.textContent = 'Setting saved on this device.'; }
    catch (err) { status.textContent = err.message; }
  });
  function show(state) { userId = state && state.user && state.user.id ? state.user.id : ''; paint(); }
  function wire() { window.TWGIAccount.subscribe(show); }
  if (window.TWGIAccount) wire(); else document.addEventListener('twgi-account-api', wire, { once: true });
})();
