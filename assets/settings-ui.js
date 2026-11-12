/* Settings panel: Original dictation copies (ask / always / never) and,
   v9, Dictation language (English (US) by default, Automatic, others). */
(function () {
  var form = document.getElementById('settings-form');
  if (!form || !window.TWGISettings) return;
  var status = document.getElementById('settings-status');
  var langSelect = document.getElementById('dictation-language');
  var userId = '';
  function paint() {
    var v = window.TWGISettings.get(userId, 'journal', 'dictationOriginals');
    Array.prototype.forEach.call(form.querySelectorAll('input[name=dictationOriginals]'), function (r) { r.checked = r.value === v; r.disabled = !userId; });
    if (langSelect) { langSelect.value = window.TWGISettings.get(userId, 'journal', 'dictationLanguage'); langSelect.disabled = !userId; }
  }
  form.addEventListener('change', function (e) {
    var name = e.target.name;
    if (!userId || (name !== 'dictationOriginals' && name !== 'dictationLanguage')) return;
    try { window.TWGISettings.set(userId, 'journal', name, e.target.value); status.textContent = window.TWGISettings.sync.enabled ? 'Setting saved. It syncs to your other devices.' : 'Setting saved on this device.'; }
    catch (err) { status.textContent = err.message; }
  });
  form.addEventListener('submit', function (e) { e.preventDefault(); });
  function show(state) { userId = state && state.user && state.user.id ? state.user.id : ''; paint(); }
  // v4: repaint when a synced copy arrives from another device.
  window.TWGISettings.onChange(function (id, group) { if (id === userId && group == null) paint(); });
  function wire() { window.TWGIAccount.subscribe(show); }
  if (window.TWGIAccount) wire(); else document.addEventListener('twgi-account-api', wire, { once: true });
})();
