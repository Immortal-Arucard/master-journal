/* Original dictation copies: the audio recording plus the raw, unedited
   transcript. Stored on this device only, in IndexedDB (database
   twgi-journal-originals, store originals), keyed by user id + entry id.
   Nothing is uploaded anywhere. */
(function (global) {
  var DB = 'twgi-journal-originals';
  var STORE = 'originals';
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error('This browser cannot store recordings.')); return; }
      var req = global.indexedDB.open(DB, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var s = db.createObjectStore(STORE, { keyPath: ['userId', 'entryId'] });
          s.createIndex('byUser', 'userId', { unique: false });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('Could not open storage.')); };
    });
    return dbPromise;
  }

  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var store = t.objectStore(STORE);
        var out = fn(store);
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('Storage was full or blocked.')); };
      });
    });
  }

  global.TWGIJournalOriginals = {
    save: function (userId, entryId, original) {
      return tx('readwrite', function (s) {
        return s.put({
          userId: String(userId), entryId: String(entryId),
          audio: original.audio || null,
          mimeType: original.audio ? String(original.audio.type || original.mimeType || '') : '',
          rawTranscript: String(original.rawTranscript || '').slice(0, 50000),
          durationMs: Number(original.durationMs) || 0,
          recordedAt: original.recordedAt || new Date().toISOString()
        });
      }).then(function () { return true; });
    },
    get: function (userId, entryId) {
      return tx('readonly', function (s) { return s.get([String(userId), String(entryId)]); })
        .then(function (r) { return r || null; });
    },
    listIds: function (userId) {
      return tx('readonly', function (s) { return s.index('byUser').getAllKeys(String(userId)); })
        .then(function (keys) { return (keys || []).map(function (k) { return k[1]; }); });
    },
    remove: function (userId, entryId) {
      return tx('readwrite', function (s) { return s.delete([String(userId), String(entryId)]); })
        .then(function () { return true; });
    }
  };
})(window);
