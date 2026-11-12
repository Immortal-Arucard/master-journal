/* Journal daily reminder: "Time to journal" at the hour you choose.
   Mounts into #journal-reminder. The permission prompt only appears after a
   tap on Enable notifications. v6: this switch also lets note reminders
   (set on each note) reach this device; the push service reads only a
   reminder's name, time and repeat, never the note's text. Nothing else
   from your entries is ever sent; the
   push service only knows your reminder time and time zone. */
(function (global) {
  var APP = 'journal';
  var Push = global.TWGIPush;
  var box = document.getElementById('journal-reminder');
  if (!box || !Push) return;
  var userId = '';
  var settings = null;

  function el(name, cls, text) {
    var node = document.createElement(name);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function status(text) { var s = box.querySelector('[data-push-status]'); if (s) s.textContent = text || ''; }

  function build() {
    while (box.firstChild) box.removeChild(box.firstChild);
    box.appendChild(el('legend', '', 'Daily journal reminder'));
    var support = Push.currentSupport();
    if (support.reason === 'ios-install') {
      var hint = el('p', 'flag push-ios-hint', support.note);
      hint.setAttribute('data-ios-hint', 'true');
      box.appendChild(hint);
    }
    if (!userId) { box.appendChild(el('p', 'note', 'Sign in to set a reminder.')); return; }
    var on = Push.isOn(APP, userId);
    var master = el('button', 'take', on ? 'Turn off notifications on this device' : 'Enable notifications');
    master.type = 'button';
    master.setAttribute('data-push-master', on ? 'off' : 'on');
    master.disabled = !support.ok && support.reason !== 'denied';
    master.addEventListener('click', function () {
      if (Push.isOn(APP, userId)) { Push.disable(APP, userId).then(function (r) { build(); status(r.note); }); return; }
      Push.enable(APP, userId).then(function (r) {
        if (r.ok) return save().then(function () { build(); status(r.note); });
        build(); status(r.note);
      }).catch(function (err) { status(err && err.message ? err.message : 'Notifications were not turned on.'); });
    });
    box.appendChild(master);
    if (!support.ok && support.reason !== 'ios-install') box.appendChild(el('p', 'note', support.note));
    var st = el('p', 'note'); st.setAttribute('data-push-status', 'true'); st.setAttribute('role', 'status'); st.setAttribute('aria-live', 'polite');
    box.appendChild(st);
    if (!on) { box.appendChild(el('p', 'note', 'Nothing is asked or sent until you tap Enable notifications.')); return; }
    var prefs = (settings && settings.prefs) || {};
    var lab = el('label', 'opt');
    var toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.name = 'journalOn';
    toggle.checked = !prefs.kinds || prefs.kinds.journal !== false;
    lab.appendChild(toggle); lab.appendChild(document.createTextNode(' Remind me every day'));
    box.appendChild(lab);
    var time = document.createElement('input'); time.type = 'time'; time.name = 'journalTime'; time.value = prefs.journalTime || '21:00';
    var tw = el('label', 'task-field'); tw.appendChild(el('span', '', 'Reminder time')); tw.appendChild(time);
    box.appendChild(tw);
    box.appendChild(el('p', 'note', 'Time zone: ' + ((settings && settings.tz) || Push.timeZone()) + '.'));
    box.appendChild(el('p', 'note', 'Note reminders (set on each note) also arrive on this device while notifications are on. The notification service sees only a reminder\u2019s name, time and repeat, never your note\u2019s text.'));
    toggle.addEventListener('change', save);
    time.addEventListener('change', save);
    var test = el('button', 'take ghost', 'Send a test notification'); test.type = 'button'; test.setAttribute('data-push-test', 'true');
    test.addEventListener('click', function () { Push.test(APP).then(function () { status('Test sent.'); }).catch(function (e) { status(e.message); }); });
    box.appendChild(test);
  }

  function save() {
    var toggle = box.querySelector('[name=journalOn]');
    var time = box.querySelector('[name=journalTime]');
    var prefs = {
      kinds: { journal: toggle ? toggle.checked : true },
      journalTime: time && time.value ? time.value : ((settings && settings.prefs && settings.prefs.journalTime) || '21:00')
    };
    return Push.saveSettings(APP, { tz: (settings && settings.tz) || Push.timeZone(), prefs: prefs }).then(function (r) {
      settings = r && r.settings ? r.settings : settings;
      status('Reminder saved.');
    }).catch(function (err) { status(err.message); });
  }

  function bind(state) {
    var next = state && state.user ? state.user.id : '';
    if (next === userId && box.firstChild) return;
    userId = next; settings = null;
    build();
    if (userId && Push.isOn(APP, userId)) {
      Push.settings(APP).then(function (r) { settings = r && r.settings ? r.settings : null; build(); }).catch(function () {});
    }
  }
  build();
  if (global.TWGIAccount) global.TWGIAccount.subscribe(bind);
  else document.addEventListener('twgi-account-api', function () { global.TWGIAccount.subscribe(bind); });
  global.TWGIJournalPush = { save: save };
})(window);
