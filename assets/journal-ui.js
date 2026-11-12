/* Journal screen. Needs TWGIJournal (journal.js) and TWGIAccount (auth.js).
   v6: optional reminder per note (assets/reminders.js). No note gets a
   reminder by itself: after a NEW note is saved the note asks "Add a
   reminder?" (Add reminder / No thanks). Each note can add, edit, switch
   off/on or delete its reminder later. A small bell tag shows on notes
   that have one. Opening /?note=<id> (tapping the notification) scrolls to
   and highlights that note. */
(function () {
  var root = document.getElementById('journal');
  var gate = document.getElementById('journal-signin');
  if (!root || !window.TWGIJournal) return;
  var J = window.TWGIJournal;
  var form = document.getElementById('journal-form');
  var idInput = document.getElementById('journal-id');
  var whenInput = document.getElementById('journal-when');
  var titleInput = document.getElementById('journal-title');
  var bodyInput = document.getElementById('journal-body');
  var saveBtn = document.getElementById('journal-save');
  var cancelBtn = document.getElementById('journal-cancel');
  var formHeading = document.getElementById('journal-form-heading');
  var searchInput = document.getElementById('journal-search');
  var listNode = document.getElementById('journal-list');
  var countNode = document.getElementById('journal-count');
  var status = document.getElementById('journal-status');
  var userId = '';

  titleInput.maxLength = J.limits.title;
  bodyInput.maxLength = J.limits.body;

  function say(text) { status.textContent = text || ''; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function localValue(iso) {
    var d = iso ? new Date(iso) : new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fromLocal(value) {
    var d = new Date(value);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  function pretty(iso) {
    try {
      return new Date(iso).toLocaleString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch (err) { return iso; }
  }

  function resetForm() {
    idInput.value = '';
    titleInput.value = '';
    bodyInput.value = '';
    whenInput.value = localValue();
    saveBtn.textContent = 'Save entry';
    formHeading.textContent = 'New entry';
    cancelBtn.hidden = true;
  }

  var R = window.TWGIReminders;
  var promptId = '';      // new note asking "Add a reminder?"
  var editorId = '';      // note whose reminder editor is open
  var draft = null;       // editor values, kept across repaints
  var targetId = '';      // note opened from a notification
  var deferredPaint = false;
  var seq = 0;

  function deviceTz() {
    var tz = window.TWGIPush && window.TWGIPush.timeZone ? window.TWGIPush.timeZone() : '';
    if (!tz) { try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (err) { tz = ''; } }
    return R && R.validTimeZone(tz) ? tz : 'America/New_York';
  }
  function editorChanged() { document.dispatchEvent(new CustomEvent('twgi-journal-editor')); }

  var originalIds = {};
  var originalDurations = {};
  var urls = [];

  function probeAudioMs(blob) {
    return new Promise(function (resolve) {
      if (!blob) { resolve(0); return; }
      var url, audio, done = false;
      var finish = function (ms) {
        if (done) return;
        done = true;
        try { if (url) URL.revokeObjectURL(url); } catch (err) {}
        resolve(ms || 0);
      };
      try {
        url = URL.createObjectURL(blob);
        audio = document.createElement('audio');
        audio.preload = 'metadata';
        audio.onloadedmetadata = function () {
          var d = audio.duration;
          finish(isFinite(d) && d > 0 ? Math.round(d * 1000) : 0);
        };
        audio.onerror = function () { finish(0); };
        setTimeout(function () { finish(0); }, 2000);
        audio.src = url;
      } catch (err) { finish(0); }
    });
  }

  function cardDictationMs(entry) {
    var n = window.TWGIJournal && window.TWGIJournal.durationMs
      ? window.TWGIJournal.durationMs(entry && entry.dictationMs)
      : (Number(entry && entry.dictationMs) || 0);
    if (n) return n;
    return Number(originalDurations[entry && entry.id]) || 0;
  }

  function dictationNode(entry) {
    var J = window.TWGIJournal;
    var fmt = J && J.formatDictation ? J.formatDictation(cardDictationMs(entry)) : null;
    if (!fmt) return null;
    var el = document.createElement('span');
    el.className = 'entry-dictation';
    el.textContent = fmt.short;
    el.setAttribute('title', fmt.label);
    el.setAttribute('aria-label', fmt.label);
    return el;
  }

  function originalNode(entry) {
    var box = document.createElement('details');
    box.className = 'original';
    var sum = document.createElement('summary');
    sum.textContent = 'Original copy (recording and unedited transcript)';
    box.appendChild(sum);
    var inner = document.createElement('div');
    box.appendChild(inner);
    box.addEventListener('toggle', function () {
      if (!box.open || inner.childNodes.length) return;
      window.TWGIJournalOriginals.get(userId, entry.id).then(function (rec) {
        if (!rec) { inner.textContent = 'The original copy is no longer on this device.'; return; }
        if (rec.audio) {
          var audio = document.createElement('audio');
          audio.controls = true;
          audio.preload = 'metadata';
          var url = URL.createObjectURL(rec.audio);
          urls.push(url);
          audio.src = url;
          inner.appendChild(audio);
        } else {
          var na = document.createElement('p');
          na.className = 'note';
          na.textContent = 'No audio was recorded for this dictation.';
          inner.appendChild(na);
        }
        var label = document.createElement('p');
        label.className = 'note';
        label.textContent = 'Raw transcript:';
        inner.appendChild(label);
        var raw = document.createElement('p');
        raw.className = 'entry-body raw';
        raw.textContent = rec.rawTranscript || '(no words were transcribed)';
        inner.appendChild(raw);
        var rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'mini danger';
        rm.textContent = 'Delete original';
        rm.addEventListener('click', function () {
          if (!window.confirm('Delete the original recording and raw transcript? The journal entry stays.')) return;
          window.TWGIJournalOriginals.remove(userId, entry.id).then(function () { say('Original copy deleted.'); refreshOriginals(); });
        });
        inner.appendChild(rm);
      }).catch(function () { inner.textContent = 'Could not open the original copy on this device.'; });
    });
    return box;
  }

  function refreshOriginals() {
    if (!window.TWGIJournalOriginals || !userId) { originalIds = {}; originalDurations = {}; render(); return; }
    var O = window.TWGIJournalOriginals;
    var listP = O.listMeta
      ? O.listMeta(userId)
      : O.listIds(userId).then(function (ids) { return (ids || []).map(function (id) { return { id: id, durationMs: 0, hasAudio: false }; }); });
    listP.then(function (rows) {
      originalIds = {};
      originalDurations = {};
      var missing = [];
      (rows || []).forEach(function (r) {
        var id = r && r.id;
        if (!id) return;
        originalIds[id] = true;
        if (r.durationMs > 0) originalDurations[id] = r.durationMs;
        else if (r.hasAudio) missing.push(id);
      });
      render();
      if (!missing.length || !O.get) return;
      Promise.all(missing.map(function (id) {
        return O.get(userId, id).then(function (rec) {
          if (!rec || !rec.audio) return;
          return probeAudioMs(rec.audio).then(function (ms) { if (ms) originalDurations[id] = ms; });
        });
      })).then(function () { if (missing.some(function (id) { return originalDurations[id]; })) render(); }).catch(function () {});
    }).catch(function () { originalIds = {}; originalDurations = {}; render(); });
  }
  document.addEventListener('twgi-journal-changed', function () { refreshOriginals(); });

  function readDraft() {
    var ed = listNode.querySelector('[data-reminder-editor]');
    if (!ed || !draft) return;
    draft.on = ed.querySelector('[data-r=on]').checked;
    draft.title = ed.querySelector('[data-r=title]').value;
    draft.at = ed.querySelector('[data-r=at]').value;
    draft.tz = ed.querySelector('[data-r=tz]').value;
    draft.repeat = ed.querySelector('[data-r=repeat]').value;
    draft.every = Number(ed.querySelector('[data-r=every]').value) || 1;
    draft.days = Array.prototype.filter.call(ed.querySelectorAll('[data-r=day]'), function (c) { return c.checked; }).map(function (c) { return Number(c.value); });
  }

  function render() {
    readDraft();
    deferredPaint = false;
    urls.forEach(function (u) { URL.revokeObjectURL(u); });
    urls = [];
    while (listNode.firstChild) listNode.removeChild(listNode.firstChild);
    var all = J.list(userId);
    var q = searchInput.value;
    var shown = J.search(userId, q);
    countNode.textContent = all.length
      ? (q.trim() ? shown.length + ' of ' + all.length + (all.length === 1 ? ' entry' : ' entries') + ' match.' : all.length + (all.length === 1 ? ' entry' : ' entries') + ', newest first.')
      : 'No entries yet. Your first entry will appear here.';
    shown.forEach(function (entry) {
      var li = document.createElement('li');
      li.className = 'entry';
      var art = document.createElement('article');
      var head = document.createElement('div');
      head.className = 'entry-head';
      var time = document.createElement('time');
      time.className = 'entry-when';
      time.dateTime = entry.entryAt;
      time.textContent = pretty(entry.entryAt);
      head.appendChild(time);
      var dur = dictationNode(entry);
      if (dur) head.appendChild(dur);
      art.appendChild(head);
      if (entry.title) {
        var h = document.createElement('h3');
        h.className = 'entry-title';
        h.textContent = entry.title;
        art.appendChild(h);
      }
      var body = document.createElement('p');
      body.className = 'entry-body';
      body.textContent = entry.body;
      art.appendChild(body);
      var actions = document.createElement('div');
      actions.className = 'entry-actions';
      var edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'mini';
      edit.textContent = 'Edit';
      edit.setAttribute('aria-label', 'Edit entry from ' + pretty(entry.entryAt));
      edit.addEventListener('click', function () {
        idInput.value = entry.id;
        titleInput.value = entry.title;
        bodyInput.value = entry.body;
        whenInput.value = localValue(entry.entryAt);
        saveBtn.textContent = 'Save changes';
        formHeading.textContent = 'Edit entry';
        cancelBtn.hidden = false;
        say('');
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        bodyInput.focus();
      });
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'mini danger';
      del.textContent = 'Delete';
      del.setAttribute('aria-label', 'Delete entry from ' + pretty(entry.entryAt));
      del.addEventListener('click', function () {
        if (!window.confirm(J.sync.enabled ? 'Delete this journal entry from all your devices? This cannot be undone.' : 'Delete this journal entry from this device? This cannot be undone.')) return;
        J.remove(userId, entry.id);
        if (window.TWGIJournalOriginals) window.TWGIJournalOriginals.remove(userId, entry.id).catch(function () {});
        if (idInput.value === entry.id) resetForm();
        say('Entry deleted.');
        render();
      });
      actions.appendChild(edit);
      actions.appendChild(del);
      if (R) {
        var rbtn = document.createElement('button');
        rbtn.type = 'button';
        rbtn.className = 'mini';
        rbtn.setAttribute('data-reminder-open', entry.id);
        rbtn.textContent = entry.reminder ? 'Edit reminder' : 'Add reminder';
        rbtn.addEventListener('click', function () { openEditor(entry); });
        actions.appendChild(rbtn);
      }
      if (R && entry.reminder) art.insertBefore(reminderTag(entry), body);
      art.appendChild(actions);
      if (R && promptId === entry.id) art.appendChild(promptNode(entry));
      if (R && editorId === entry.id) art.appendChild(editorNode(entry));
      if (targetId === entry.id) li.classList.add('is-target');
      li.setAttribute('data-entry-id', entry.id);
      if (originalIds[entry.id]) art.appendChild(originalNode(entry));
      li.appendChild(art);
      listNode.appendChild(li);
    });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!userId) return;
    try {
      var editing = !!idInput.value;
      var saved = J.save(userId, { id: idInput.value || null, title: titleInput.value, body: bodyInput.value, entryAt: fromLocal(whenInput.value) });
      resetForm();
      say(J.sync.enabled ? (editing ? 'Changes saved. They sync to your other devices.' : 'Entry saved. It syncs to your other devices.') : (editing ? 'Changes saved on this device.' : 'Entry saved on this device.'));
      if (!editing) askReminder(saved.id); else render();
    } catch (err) {
      say(err && err.message ? err.message : 'Could not save on this device.');
    }
  });
  cancelBtn.addEventListener('click', function () { resetForm(); say(''); });
  searchInput.addEventListener('input', render);

  function show(state) {
    var signedIn = !!(state && state.user && state.user.id);
    userId = signedIn ? state.user.id : '';
    root.hidden = !signedIn;
    if (gate) gate.hidden = signedIn;
    if (signedIn) {
      resetForm();
      refreshOriginals();
      if (pendingTarget) { var t = pendingTarget; if (J.list(userId).some(function (e) { return e.id === t; })) { pendingTarget = ''; openTarget(t); } }
    }
  }

  // v4: entries changed on another device (cloud sync) repaint the list.
  // v6: not while a reminder editor is open (it would interrupt typing); the
  // repaint happens when the editor closes.
  if (J.onChange) J.onChange(function (id) {
    if (!id || id !== userId) return;
    if (editorId) { deferredPaint = true; return; }
    render();
  });

  /* ---------- v6 reminders ---------- */
  function el(name, cls, text) {
    var n = document.createElement(name);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function reminderTag(entry) {
    var r = entry.reminder;
    var tag = el('button', 'reminder-tag' + (r.on ? '' : ' is-off'));
    tag.type = 'button';
    tag.setAttribute('data-reminder-tag', entry.id);
    var next = r.on ? R.next(r, Date.now()) : null;
    var tail = !r.on ? ' · off' : next ? ' · next ' + R.formatWhen(next, r.tz) : ' · done';
    tag.textContent = '\uD83D\uDD14 ' + (r.title ? r.title + ' — ' : '') + R.describe(r) + tail;
    tag.setAttribute('aria-label', 'Reminder: ' + tag.textContent.slice(3) + '. Tap to edit.');
    tag.addEventListener('click', function () { openEditor(entry); });
    return tag;
  }

  function askReminder(id) {
    promptId = id; editorId = ''; draft = null;
    render();
    var box = listNode.querySelector('[data-reminder-prompt]');
    if (box) {
      box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      var add = box.querySelector('[data-reminder-add]');
      if (add) add.focus();
    }
  }

  function promptNode(entry) {
    var box = el('div', 'flag reminder-prompt');
    box.setAttribute('data-reminder-prompt', entry.id);
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Add a reminder?');
    box.appendChild(el('p', '', 'Add a reminder for this note? You choose its name, time and how often it repeats.'));
    var row = el('div', 'actions');
    var add = el('button', 'take', 'Add reminder');
    add.type = 'button';
    add.setAttribute('data-reminder-add', entry.id);
    add.addEventListener('click', function () { openEditor(entry); });
    var no = el('button', 'take ghost', 'No thanks');
    no.type = 'button';
    no.setAttribute('data-reminder-skip', entry.id);
    no.addEventListener('click', function () { promptId = ''; say('Saved with no reminder. You can add one later from the note.'); render(); });
    row.appendChild(add); row.appendChild(no);
    box.appendChild(row);
    return box;
  }

  function freshDraft(entry) {
    var tz = deviceTz();
    var start = Math.ceil((Date.now() + 60000) / 3600000) * 3600000;
    var at = R.localAt(start, tz);
    var p = R.parseAt(at);
    return { on: true, title: R.defaultTitle(entry), at: at, tz: tz, repeat: 'once', every: 1,
      days: [new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()], daysAuto: true, isNew: true };
  }

  function openEditor(entry) {
    promptId = '';
    editorId = entry.id;
    var r = entry.reminder;
    draft = r ? { on: r.on, title: r.title || R.defaultTitle(entry), at: r.at, tz: r.tz, repeat: r.repeat, every: r.every || 1, days: (r.days || []).slice(), daysAuto: !(r.days && r.days.length), isNew: false } : freshDraft(entry);
    render();
    editorChanged();
    var ed = listNode.querySelector('[data-reminder-editor]');
    if (ed) {
      ed.scrollIntoView({ behavior: 'smooth', block: 'start' });
      var t = ed.querySelector('[data-r=title]');
      if (t) t.focus();
    }
  }

  function closeEditor(message) {
    editorId = ''; draft = null;
    if (message != null) say(message);
    render();
    editorChanged();
  }

  var TZ_CHOICES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'Europe/London', 'UTC'];
  var REPEAT_LABELS = { once: 'Does not repeat (once)', daily: 'Every day', weekly: 'Every week on chosen days', monthly: 'Every month on this date', hours: 'Every few hours', days: 'Every few days' };

  function field(labelText, input) {
    var id = 'rem-' + (++seq);
    input.id = id;
    var lab = el('label', '', labelText);
    lab.setAttribute('for', id);
    var wrap = el('div', 'rem-field');
    wrap.appendChild(lab); wrap.appendChild(input);
    return wrap;
  }

  function preview(d) {
    var r = R.clean({ on: d.on, title: d.title, at: d.at, tz: d.tz, repeat: d.repeat, every: d.every, days: d.days });
    if (!r) return 'Choose a date and time.';
    if (!r.on) return 'Reminder is off. It will not notify you until you turn it back on.';
    var n = R.next(r, Date.now());
    if (!n) return 'That time has already passed. Pick a later time or a repeat.';
    return R.describe(r) + '. Next: ' + R.formatWhen(n, r.tz) + ' (' + r.tz.replace(/_/g, ' ') + ').';
  }

  function editorNode(entry) {
    var d = draft;
    var form = el('form', 'reminder-editor jform');
    form.setAttribute('data-reminder-editor', entry.id);
    form.noValidate = true;
    form.appendChild(el('h3', 'reminder-h', d.isNew ? 'New reminder' : 'Edit reminder'));

    var onWrap = el('label', 'opt');
    var on = el('input'); on.type = 'checkbox'; on.checked = d.on !== false; on.setAttribute('data-r', 'on');
    onWrap.appendChild(on); onWrap.appendChild(document.createTextNode(' Reminder on'));
    form.appendChild(onWrap);

    var title = el('input'); title.type = 'text'; title.maxLength = R.MAX_TITLE; title.value = d.title || ''; title.autocomplete = 'off';
    title.setAttribute('data-r', 'title');
    form.appendChild(field('Notification name', title));

    var at = el('input'); at.type = 'datetime-local'; at.value = d.at || ''; at.setAttribute('data-r', 'at');
    form.appendChild(field('Date and time', at));

    var repeat = el('select'); repeat.setAttribute('data-r', 'repeat');
    R.REPEATS.forEach(function (k) { var o = el('option', '', REPEAT_LABELS[k]); o.value = k; if (k === d.repeat) o.selected = true; repeat.appendChild(o); });
    form.appendChild(field('Repeat', repeat));

    var every = el('input'); every.type = 'number'; every.min = '1'; every.step = '1'; every.inputMode = 'numeric';
    every.value = String(d.every || 1); every.setAttribute('data-r', 'every');
    var everyWrap = field(d.repeat === 'hours' ? 'Every how many hours?' : 'Every how many days?', every);
    everyWrap.setAttribute('data-r-wrap', 'every');
    everyWrap.hidden = d.repeat !== 'hours' && d.repeat !== 'days';
    form.appendChild(everyWrap);

    var days = el('fieldset', 'rem-days');
    days.setAttribute('data-r-wrap', 'days');
    days.appendChild(el('legend', '', 'On these days'));
    R.DAY_NAMES.forEach(function (name, i) {
      var lab = el('label', 'rem-day');
      var c = el('input'); c.type = 'checkbox'; c.value = String(i); c.setAttribute('data-r', 'day');
      c.checked = (d.days || []).indexOf(i) !== -1;
      lab.appendChild(c); lab.appendChild(document.createTextNode(' ' + name));
      days.appendChild(lab);
    });
    days.hidden = d.repeat !== 'weekly';
    form.appendChild(days);

    var tz = el('select'); tz.setAttribute('data-r', 'tz');
    var zones = [];
    [d.tz, deviceTz()].concat(TZ_CHOICES).forEach(function (z) { if (z && zones.indexOf(z) === -1 && R.validTimeZone(z)) zones.push(z); });
    zones.forEach(function (z) { var o = el('option', '', z.replace(/_/g, ' ')); o.value = z; if (z === d.tz) o.selected = true; tz.appendChild(o); });
    form.appendChild(field('Time zone', tz));

    var pv = el('p', 'note rem-preview'); pv.setAttribute('data-r', 'preview'); pv.setAttribute('aria-live', 'polite');
    pv.textContent = preview(d);
    form.appendChild(pv);

    var warn = el('p', 'note rem-warn'); warn.setAttribute('data-r', 'warn');
    var notes = [];
    if (window.TWGIPush && !window.TWGIPush.isOn('journal', userId)) notes.push('Notifications are off on this device. Turn them on under Settings, Daily journal reminder, on each device where you want reminders.');
    if (J.sync.reminders === 'off') notes.push('The reminder service is not switched on yet. Your reminder is saved and will start arriving once it is.');
    warn.textContent = notes.join(' ');
    warn.hidden = !notes.length;
    form.appendChild(warn);

    var row = el('div', 'actions');
    var save = el('button', 'take', 'Save reminder'); save.type = 'submit'; save.setAttribute('data-r', 'save');
    row.appendChild(save);
    if (entry.reminder) {
      var del = el('button', 'take ghost danger', 'Delete reminder'); del.type = 'button'; del.setAttribute('data-r', 'delete');
      del.addEventListener('click', function () {
        if (!window.confirm('Delete this reminder? The note stays.')) return;
        try { J.setReminder(userId, entry.id, null); closeEditor('Reminder deleted. The note stays.'); }
        catch (err) { say(err && err.message ? err.message : 'Could not delete the reminder.'); }
      });
      row.appendChild(del);
    }
    var cancel = el('button', 'take ghost', 'Cancel'); cancel.type = 'button'; cancel.setAttribute('data-r', 'cancel');
    cancel.addEventListener('click', function () { closeEditor(d.isNew ? 'No reminder added. You can add one later from the note.' : ''); });
    row.appendChild(cancel);
    form.appendChild(row);
    var err = el('p', 'note rem-error'); err.setAttribute('data-r', 'error'); err.setAttribute('role', 'alert');
    form.appendChild(err);

    function refresh(ev) {
      if (ev && ev.target && ev.target.getAttribute && ev.target.getAttribute('data-r') === 'day') draft.daysAuto = false;
      readDraft();
      if (draft.daysAuto) {
        // Until a day is ticked by hand, "weekly" follows the chosen date's weekday.
        var q = R.parseAt(draft.at);
        if (q) {
          var w = new Date(Date.UTC(q.year, q.month - 1, q.day)).getUTCDay();
          Array.prototype.forEach.call(days.querySelectorAll('[data-r=day]'), function (c, i) { c.checked = i === w; });
          readDraft();
        }
      }
      everyWrap.hidden = draft.repeat !== 'hours' && draft.repeat !== 'days';
      everyWrap.querySelector('label').textContent = draft.repeat === 'hours' ? 'Every how many hours?' : 'Every how many days?';
      days.hidden = draft.repeat !== 'weekly';
      if (draft.repeat === 'weekly' && !draft.days.length) {
        var p = R.parseAt(draft.at);
        if (p) { var wd = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); days.querySelectorAll('[data-r=day]')[wd].checked = true; readDraft(); }
      }
      pv.textContent = preview(draft);
      err.textContent = '';
    }
    form.addEventListener('input', refresh);
    form.addEventListener('change', refresh);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      readDraft();
      var value = R.clean({ on: draft.on, title: draft.title.trim() || R.defaultTitle(entry), at: draft.at, tz: draft.tz, repeat: draft.repeat, every: draft.every, days: draft.days });
      if (!value) { err.textContent = 'Choose a date and time for the reminder.'; return; }
      var next = R.next(value, Date.now());
      if (value.on && !next) { err.textContent = 'That time has already passed. Pick a later time or a repeat.'; return; }
      try { J.setReminder(userId, entry.id, value); }
      catch (e) { err.textContent = e && e.message ? e.message : 'Could not save the reminder.'; return; }
      var msg = value.on ? 'Reminder saved. ' + R.describe(value) + '. Next: ' + R.formatWhen(next, value.tz) + '.' : 'Reminder saved and switched off.';
      if (J.sync.enabled) msg += ' It syncs to your other devices.';
      if (window.TWGIPush && !window.TWGIPush.isOn('journal', userId)) msg += ' Turn on notifications under Settings to get it on this device.';
      closeEditor(msg);
    });
    return form;
  }

  // A note saved from the Pensieve also asks "Add a reminder?".
  document.addEventListener('twgi-journal-new-entry', function (ev) {
    var id = ev && ev.detail && ev.detail.id;
    if (id && userId) askReminder(id);
  });

  /* Tapping a reminder notification opens /?note=<id>: find and highlight it. */
  function openTarget(id) {
    if (!id) return;
    targetId = id;
    if (!userId) return;
    var found = J.list(userId).some(function (e) { return e.id === id; });
    if (!found) return; // not synced yet; tried again on the next repaint
    searchInput.value = '';
    render();
    var li = listNode.querySelector('.is-target');
    if (li) { li.scrollIntoView({ behavior: 'smooth', block: 'center' }); li.setAttribute('tabindex', '-1'); try { li.focus({ preventScroll: true }); } catch (e) { li.focus(); } }
    say('Opened from your reminder.');
    try { if (window.history && window.history.replaceState) window.history.replaceState(null, '', '/'); } catch (e) {}
  }
  function noteFromUrl(href) {
    try { var u = new URL(href, window.location.origin); return u.searchParams.get('note') || ''; } catch (e) { return ''; }
  }
  var pendingTarget = noteFromUrl(window.location.href);
  if (J.onChange) J.onChange(function (id) { if (pendingTarget && id === userId) { var t = pendingTarget; pendingTarget = ''; openTarget(t); } });
  if (navigator.serviceWorker && navigator.serviceWorker.addEventListener) {
    navigator.serviceWorker.addEventListener('message', function (ev) {
      var data = ev && ev.data;
      if (data && data.type === 'twgi-open') { var id = noteFromUrl(data.url); if (id) openTarget(id); }
    });
  }
  window.TWGIJournalUI = { openTarget: openTarget, askReminder: askReminder, editorOpen: function () { return !!editorId; } };

  function wire() { window.TWGIAccount.subscribe(show); }
  if (window.TWGIAccount) wire();
  else document.addEventListener('twgi-account-api', wire, { once: true });
})();
