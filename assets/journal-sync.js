/* Journal cloud sync (v4). Needs assets/cloud-sync.js, assets/journal.js,
   assets/settings.js and assets/auth.js (TWGIAccount).

   Signed in: every entry (title, text, date and time) syncs to the owner-only
   table public.master_journal_entries; deleted entries stay there as empty
   tombstones so an old copy on another device cannot bring them back. The
   app settings (twgi-settings-v1) sync to public.master_settings. Newest
   change wins. Original dictation copies (audio and raw transcript) stay on
   the device that recorded them; they are not uploaded.
   Uses only the public publishable key session from auth.js.

   v6: each entry's optional reminder rides in the column
   master_journal_entries.reminder (SQL supabase/master_journal_reminders.sql).
   Until that column exists the rows are sent exactly as in v4/v5 and
   reminders stay on the device; a one-time check (select reminder) switches
   them on, and entries that already have a reminder are re-sent once. */
(function (global) {
  var J = global.TWGIJournal;
  var S = global.TWGISettings;
  var Sync = global.TWGICloudSync;
  if (!J || !Sync) return;

  var COL_KEY = 'twgi-journal-reminder-col-v1:';
  var reminderCol = { uid: '', on: false, checked: false };
  function colCached(uid) { try { return global.localStorage.getItem(COL_KEY + uid) === '1'; } catch (err) { return false; } }

  var engine = Sync.create({
    app: 'journal',
    storage: global.localStorage,
    window: global,
    getClient: function () { return global.TWGIAccount && global.TWGIAccount.client ? global.TWGIAccount.client() : null; },
    records: {
      table: 'master_journal_entries',
      read: function (uid) { return J.list(uid); },
      write: function (uid, items) { J.applyRemote(uid, items); },
      toRow: function (e, uid, updatedAt) {
        var row = { user_id: uid, id: e.id, title: e.title || '', body: e.body || '', entry_at: e.entryAt, created_at: e.createdAt, deleted: false, updated_at: updatedAt };
        if (reminderCol.on) row.reminder = e.reminder || null;
        return row;
      },
      tombRow: function (id, uid, updatedAt) {
        // Same columns as a live row, so a mixed batch never sends NULLs.
        var tomb = { user_id: uid, id: id, title: '', body: '', entry_at: updatedAt, created_at: updatedAt, deleted: true, updated_at: updatedAt };
        if (reminderCol.on) tomb.reminder = null;
        return tomb;
      },
      fromRow: function (row) {
        if (!row || typeof row.id !== 'string') return null;
        if (row.deleted) return { id: row.id, updatedAt: row.updated_at, deleted: true };
        return { id: row.id, updatedAt: row.updated_at, deleted: false, item: {
          id: row.id, title: row.title || '', body: row.body || '', entryAt: row.entry_at, createdAt: row.created_at,
          reminder: 'reminder' in row ? row.reminder : undefined
        } };
      }
    },
    doc: S ? {
      table: 'master_settings',
      column: 'settings',
      initial: function (uid) {
        var raw = S.read(uid);
        var groups = Object.keys(raw).filter(function (k) { return k !== 'v'; });
        return groups.length ? raw : null;
      },
      apply: function (uid, value) { S.applyRemote(uid, value); }
    } : null
  });

  var note = document.getElementById('journal-sync');
  engine.onStatus(function (state) {
    if (!note) return;
    var text = engine.user() ? Sync.describe(state, 'entries') : '';
    note.textContent = text;
    note.hidden = !text;
  });

  J.sync.enabled = true;
  J.sync.stamp = function (uid, prev, next, info) {
    if (!uid || engine.user() !== uid) return next;
    return engine.recordChange(uid, prev, next, info);
  };
  J.sync.push = function (uid) {
    if (uid && engine.user() === uid) engine.soon(300);
    return Promise.resolve(true);
  };
  if (S) {
    S.sync.enabled = true;
    S.sync.push = function (uid, raw) {
      if (uid && engine.user() === uid) engine.setDoc(uid, raw);
      return Promise.resolve(true);
    };
  }

  global.TWGIJournalSync = { engine: engine };

  /* One-time check whether the reminder column exists (the v6 SQL is applied). */
  function checkReminderColumn(uid) {
    reminderCol = { uid: uid, on: colCached(uid), checked: false };
    J.sync.reminders = reminderCol.on ? 'on' : 'unknown';
    var c = global.TWGIAccount && global.TWGIAccount.client ? global.TWGIAccount.client() : null;
    if (!c || !c.from) return Promise.resolve(reminderCol.on);
    var q;
    try { q = c.from('master_journal_entries').select('id,reminder').eq('user_id', uid).limit(1); }
    catch (err) { return Promise.resolve(reminderCol.on); }
    return Promise.resolve(q).then(function (res) {
      if (reminderCol.uid !== uid) return false;
      reminderCol.checked = true;
      if (res && res.error) {
        var offline = global.navigator && global.navigator.onLine === false;
        if (!offline && !reminderCol.on) J.sync.reminders = 'off';
        return reminderCol.on;
      }
      var first = !reminderCol.on;
      reminderCol.on = true;
      J.sync.reminders = 'on';
      try { global.localStorage.setItem(COL_KEY + uid, '1'); } catch (err) {}
      if (first) {
        // Re-send entries whose reminder never reached the cloud.
        J.list(uid).forEach(function (e) { if (e.reminder) { try { J.setReminder(uid, e.id, e.reminder); } catch (err) {} } });
        engine.soon(100);
      }
      return true;
    }, function () { return reminderCol.on; }).then(function (v) {
      document.dispatchEvent(new CustomEvent('twgi-journal-reminders-status'));
      return v;
    });
  }
  J.sync.reminders = 'unknown';
  J.sync.checkReminders = function () { return reminderCol.uid ? checkReminderColumn(reminderCol.uid) : Promise.resolve(false); };

  function bind(state) {
    var uid = state && state.user ? state.user.id : null;
    if (uid) checkReminderColumn(uid); else reminderCol = { uid: '', on: false, checked: false };
    engine.start(uid);
  }
  if (global.TWGIAccount) global.TWGIAccount.subscribe(bind);
  else document.addEventListener('twgi-account-api', function () { global.TWGIAccount.subscribe(bind); }, { once: true });
})(window);
