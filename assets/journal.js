/* TWGI Journal: a private journal for the signed-in master account.
   The device copy lives in localStorage under twgi-journal-v1:<user id>.
   v4: assets/journal-sync.js fills TWGIJournal.sync and the entries sync to
   the owner-only table public.master_journal_entries (newest edit wins per
   entry; deleted entries stay as tombstones so they cannot come back).
     sync.stamp(userId, prev, next, info) runs inside every save/delete and
       returns the list to store (info.deleted lists removed ids).
     TWGIJournal.applyRemote(userId, entries) stores a merged list from the
       cloud and tells onChange listeners (the screen repaints).
   v6: an entry may carry an optional reminder (entry.reminder, rules in
   assets/reminders.js). It is part of the entry, so it syncs with it.
     save(userId, { ..., reminder }) sets it (null removes it; leaving the
       key out keeps the current one).
     setReminder(userId, id, reminder|null) changes only the reminder.
   v15: an entry may carry dictationMs (total milliseconds the mic was
   recording for that note, not including the title-field mic). It is stored
   on the entry and, in assets/journal-sync.js, packed into the existing
   reminder JSON column so it syncs without a new SQL column. A duration-only
   payload is not a reminder.
     save(userId, { ..., dictationMs }) sets it (leaving the key out keeps
       the current one; 0 or a missing value stores nothing — no "0:00").
   Journal entries are never shown on public profiles. */
(function (global) {
  var PREFIX = 'twgi-journal-v1:';
  var MAX_TITLE = 160;
  var MAX_BODY = 20000;
  var MAX_ENTRIES = 2000;
  var ID_RE = /^[A-Za-z0-9-]{1,64}$/;

  function storageKey(userId) {
    return ID_RE.test(String(userId || '')) ? PREFIX + userId : '';
  }

  function strip(text, max) {
    return String(text == null ? '' : text)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .slice(0, max);
  }

  function validDate(value) {
    var d = new Date(value);
    return isNaN(d.getTime()) ? '' : d.toISOString();
  }

  /* Positive finite duration only. Nothing is stored for typed notes. */
  function durationMs(value) {
    var n = Math.round(Number(value));
    if (!isFinite(n) || n <= 0) return 0;
    if (n > 7 * 24 * 3600000) n = 7 * 24 * 3600000;
    return n;
  }

  /* short: "1:42" or "1:02:03"; label: "Dictated for 1 min 42 s". null if none. */
  function formatDictation(ms) {
    ms = durationMs(ms);
    if (!ms) return null;
    var s = Math.round(ms / 1000);
    if (s < 1) s = 1;
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var short = h ? (h + ':' + pad(m) + ':' + pad(sec)) : (m + ':' + pad(sec));
    var parts = [];
    if (h) parts.push(h + (h === 1 ? ' hr' : ' hr'));
    if (m) parts.push(m + ' min');
    if (sec || !parts.length) parts.push(sec + ' s');
    return { short: short, label: 'Dictated for ' + parts.join(' ') };
  }

  function pickDuration(entry) {
    var n = durationMs(entry && entry.dictationMs);
    if (n) return n;
    return durationMs(entry && entry.reminder && entry.reminder.dictationMs);
  }

  function reminderWithoutDuration(raw) {
    if (!raw || typeof raw !== 'object') return raw || null;
    if (!('dictationMs' in raw)) return raw;
    var rest = {};
    Object.keys(raw).forEach(function (k) { if (k !== 'dictationMs') rest[k] = raw[k]; });
    return Object.keys(rest).length ? rest : null;
  }

  function newId() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function clean(entry) {
    if (!entry || typeof entry.id !== 'string' || !entry.id || entry.id.length > 80) return null;
    var body = strip(entry.body, MAX_BODY);
    var title = strip(entry.title, MAX_TITLE).trim();
    if (!body.trim() && !title) return null;
    var now = new Date().toISOString();
    var out = {
      id: entry.id,
      title: title,
      body: body,
      entryAt: validDate(entry.entryAt) || validDate(entry.createdAt) || now,
      createdAt: validDate(entry.createdAt) || now,
      updatedAt: validDate(entry.updatedAt) || now
    };
    var R = global.TWGIReminders;
    var reminder = reminderWithoutDuration(entry.reminder) && R ? R.clean(reminderWithoutDuration(entry.reminder)) : null;
    if (reminder) out.reminder = reminder;
    var ms = pickDuration(entry);
    if (ms) out.dictationMs = ms;
    return out;
  }

  function sortNewest(list) {
    return list.slice().sort(function (a, b) {
      if (a.entryAt !== b.entryAt) return a.entryAt < b.entryAt ? 1 : -1;
      return a.updatedAt < b.updatedAt ? 1 : -1;
    });
  }

  function read(userId) {
    var key = storageKey(userId);
    if (!key) return [];
    try {
      var raw = JSON.parse(global.localStorage.getItem(key) || '[]');
      if (!Array.isArray(raw)) return [];
      return sortNewest(raw.map(clean).filter(Boolean));
    } catch (err) { return []; }
  }

  function write(userId, list, keepAll) {
    var key = storageKey(userId);
    if (!key) throw new Error('Sign in to use the Journal.');
    var sorted = sortNewest(list);
    global.localStorage.setItem(key, JSON.stringify(keepAll ? sorted : sorted.slice(0, MAX_ENTRIES)));
  }

  var listeners = [];
  function stamped(userId, prev, next, info) {
    try {
      var out = api.sync.stamp ? api.sync.stamp(userId, prev, next, info || {}) : next;
      return Array.isArray(out) ? out : next;
    } catch (err) { return next; }
  }

  var api = {
    storageKey: storageKey,
    limits: { title: MAX_TITLE, body: MAX_BODY, entries: MAX_ENTRIES },
    durationMs: durationMs,
    formatDictation: formatDictation,
    list: function (userId) { return read(userId); },
    save: function (userId, input) {
      var list = read(userId);
      var now = new Date().toISOString();
      var existing = input && input.id ? list.filter(function (e) { return e.id === input.id; })[0] : null;
      var entry = clean({
        id: existing ? existing.id : newId(),
        title: input && input.title,
        body: input && input.body,
        entryAt: (input && input.entryAt) || (existing && existing.entryAt) || now,
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now,
        reminder: input && 'reminder' in input ? input.reminder : (existing && existing.reminder) || null,
        dictationMs: input && 'dictationMs' in input ? input.dictationMs : (existing && existing.dictationMs)
      });
      if (!entry) throw new Error('Write something before saving.');
      if (!existing && list.length >= MAX_ENTRIES) throw new Error('This device has reached the ' + MAX_ENTRIES + '-entry limit.');
      var next = list.filter(function (e) { return e.id !== entry.id; });
      next.push(entry);
      write(userId, stamped(userId, list, next), true);
      api.sync.push(userId, read(userId));
      return entry;
    },
    remove: function (userId, id) {
      var list = read(userId);
      var next = list.filter(function (e) { return e.id !== id; });
      write(userId, stamped(userId, list, next, { deleted: [id] }), true);
      api.sync.push(userId, next);
      return list.length !== next.length;
    },
    setReminder: function (userId, id, reminder) {
      var existing = read(userId).filter(function (e) { return e.id === id; })[0];
      if (!existing) throw new Error('That note is no longer on this device.');
      var R = global.TWGIReminders;
      var value = reminder == null ? null : (R ? R.clean(reminder) : null);
      if (reminder != null && !value) throw new Error('Choose a date and time for the reminder.');
      return api.save(userId, { id: id, title: existing.title, body: existing.body, entryAt: existing.entryAt, reminder: value });
    },
    applyRemote: function (userId, entries) {
      if (!storageKey(userId) || !Array.isArray(entries)) return false;
      // v6/v15: a cloud copy without the reminder field or without
      // dictationMs (column not switched on yet, or an older app) keeps
      // this device's reminder and duration.
      var local = {};
      read(userId).forEach(function (e) { local[e.id] = e; });
      entries = entries.map(function (e) {
        if (!e || !local[e.id]) return e;
        var keepRem = e.reminder === undefined && local[e.id].reminder;
        var keepDur = e.dictationMs === undefined && local[e.id].dictationMs;
        if (!keepRem && !keepDur) return e;
        var copy = {}; Object.keys(e).forEach(function (k) { copy[k] = e[k]; });
        if (keepRem) copy.reminder = local[e.id].reminder;
        if (keepDur) copy.dictationMs = local[e.id].dictationMs;
        return copy;
      });
      write(userId, entries.map(clean).filter(Boolean), true);
      listeners.forEach(function (fn) { try { fn(userId); } catch (err) {} });
      return true;
    },
    onChange: function (fn) { listeners.push(fn); },
    search: function (userId, query) {
      var q = String(query || '').trim().toLowerCase();
      var list = read(userId);
      if (!q) return list;
      var words = q.split(/\s+/);
      return list.filter(function (e) {
        var hay = (e.title + '\n' + e.body).toLowerCase();
        return words.every(function (w) { return hay.indexOf(w) !== -1; });
      });
    },
    /* Cloud sync hooks. Device-only unless assets/journal-sync.js replaces
       them (signed in). */
    sync: {
      enabled: false,
      stamp: function (userId, prev, next) { return next; },
      push: function (userId, entries) { return Promise.resolve(false); }
    }
  };

  global.TWGIJournal = api;
})(window);
