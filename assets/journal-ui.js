/* Journal screen. Needs TWGIJournal (journal.js) and TWGIAccount (auth.js). */
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

  var originalIds = {};
  var urls = [];

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
    if (!window.TWGIJournalOriginals || !userId) { originalIds = {}; render(); return; }
    window.TWGIJournalOriginals.listIds(userId).then(function (ids) {
      originalIds = {};
      ids.forEach(function (id) { originalIds[id] = true; });
      render();
    }).catch(function () { originalIds = {}; render(); });
  }
  document.addEventListener('twgi-journal-changed', function () { refreshOriginals(); });

  function render() {
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
      var time = document.createElement('time');
      time.className = 'entry-when';
      time.dateTime = entry.entryAt;
      time.textContent = pretty(entry.entryAt);
      art.appendChild(time);
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
        if (!window.confirm('Delete this journal entry from this device? This cannot be undone.')) return;
        J.remove(userId, entry.id);
        if (window.TWGIJournalOriginals) window.TWGIJournalOriginals.remove(userId, entry.id).catch(function () {});
        if (idInput.value === entry.id) resetForm();
        say('Entry deleted.');
        render();
      });
      actions.appendChild(edit);
      actions.appendChild(del);
      art.appendChild(actions);
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
      J.save(userId, { id: idInput.value || null, title: titleInput.value, body: bodyInput.value, entryAt: fromLocal(whenInput.value) });
      resetForm();
      say(editing ? 'Changes saved on this device.' : 'Entry saved on this device.');
      render();
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
      J.sync.pull(userId).catch(function () {});
    }
  }

  function wire() { window.TWGIAccount.subscribe(show); }
  if (window.TWGIAccount) wire();
  else document.addEventListener('twgi-account-api', wire, { once: true });
})();
