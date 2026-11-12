/* Journal cloud sync (v4). Needs assets/cloud-sync.js, assets/journal.js,
   assets/settings.js and assets/auth.js (TWGIAccount).

   Signed in: every entry (title, text, date and time) syncs to the owner-only
   table public.master_journal_entries; deleted entries stay there as empty
   tombstones so an old copy on another device cannot bring them back. The
   app settings (twgi-settings-v1) sync to public.master_settings. Newest
   change wins. Original dictation copies (audio and raw transcript) stay on
   the device that recorded them; they are not uploaded.
   Uses only the public publishable key session from auth.js. */
(function (global) {
  var J = global.TWGIJournal;
  var S = global.TWGISettings;
  var Sync = global.TWGICloudSync;
  if (!J || !Sync) return;

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
        return { user_id: uid, id: e.id, title: e.title || '', body: e.body || '', entry_at: e.entryAt, created_at: e.createdAt, deleted: false, updated_at: updatedAt };
      },
      tombRow: function (id, uid, updatedAt) {
        // Same columns as a live row, so a mixed batch never sends NULLs.
        return { user_id: uid, id: id, title: '', body: '', entry_at: updatedAt, created_at: updatedAt, deleted: true, updated_at: updatedAt };
      },
      fromRow: function (row) {
        if (!row || typeof row.id !== 'string') return null;
        if (row.deleted) return { id: row.id, updatedAt: row.updated_at, deleted: true };
        return { id: row.id, updatedAt: row.updated_at, deleted: false, item: {
          id: row.id, title: row.title || '', body: row.body || '', entryAt: row.entry_at, createdAt: row.created_at
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

  function bind(state) { engine.start(state && state.user ? state.user.id : null); }
  if (global.TWGIAccount) global.TWGIAccount.subscribe(bind);
  else document.addEventListener('twgi-account-api', function () { global.TWGIAccount.subscribe(bind); }, { once: true });
})(window);
