/* Pensieve: dictate journal notes by voice.
   - Microphone is requested only when the user taps Start dictation.
   - Transcription uses the browser's built-in Web Speech API. When the
     browser can transcribe on the device, that is used. TWGI never sends
     audio or text to any server, and no third-party service is used.
   - MediaRecorder keeps the audio so the user can keep an "original copy"
     (audio + raw transcript) with the entry, per the master profile setting
     journal.dictationOriginals (ask / always / never). */
(function (global) {
  var PENSIEVE_NAME = 'Pensieve'; /* rename here only */
  global.TWGIPensieve = { NAME: PENSIEVE_NAME };

  var root = document.getElementById('pensieve');
  if (!root || !global.TWGIJournal) return;
  Array.prototype.forEach.call(document.querySelectorAll('[data-pensieve-name]'), function (n) { n.textContent = PENSIEVE_NAME; });

  var J = global.TWGIJournal;
  var O = global.TWGIJournalOriginals;
  var S = global.TWGISettings;
  var toggle = document.getElementById('pensieve-toggle');
  var support = document.getElementById('pensieve-support');
  var statusNode = document.getElementById('pensieve-status');
  var text = document.getElementById('pensieve-text');
  var interim = document.getElementById('pensieve-interim');
  var titleInput = document.getElementById('pensieve-title');
  var saveBtn = document.getElementById('pensieve-save');
  var discardBtn = document.getElementById('pensieve-discard');
  var choice = document.getElementById('pensieve-choice');
  var keepBtn = document.getElementById('pensieve-keep');
  var skipBtn = document.getElementById('pensieve-skip');
  var timer = document.getElementById('pensieve-timer');

  var Recognition = global.SpeechRecognition || global.webkitSpeechRecognition || null;
  var canRecord = !!(global.navigator.mediaDevices && global.navigator.mediaDevices.getUserMedia && global.MediaRecorder);
  var userId = '';
  var recording = false;
  var stream = null, recorder = null, chunks = [], recognizer = null;
  var rawTranscript = '', startedAt = 0, durationMs = 0, audioBlob = null, tick = null;
  var pendingEntryId = '';

  function say(t) { statusNode.textContent = t || ''; }
  function fmt(ms) { var s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }

  function describeSupport() {
    var bits = [];
    if (!Recognition) bits.push('This browser cannot turn speech into text. You can still record audio and type your note.');
    if (!canRecord) bits.push('This browser cannot record audio here. ' + (Recognition ? 'Speech-to-text may still work.' : 'You can type your note.'));
    if (Recognition) bits.push('Speech-to-text uses your browser’s built-in recognition. TWGI never sends your audio or words anywhere; on some browsers, the browser’s own speech service may process audio.');
    support.textContent = bits.join(' ');
    if (!Recognition && !canRecord) toggle.disabled = true;
  }

  function setRecordingUI(on) {
    recording = on;
    toggle.textContent = on ? 'Stop dictation' : 'Start dictation';
    toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    root.classList.toggle('is-recording', on);
    saveBtn.disabled = on;
    discardBtn.disabled = on;
  }

  function appendFinal(piece) {
    piece = String(piece || '').trim();
    if (!piece) return;
    rawTranscript = rawTranscript ? rawTranscript + ' ' + piece : piece;
    var cur = text.value;
    text.value = cur && !/\s$/.test(cur) ? cur + ' ' + piece : cur + piece;
  }

  function startRecognition() {
    if (!Recognition) return;
    try {
      recognizer = new Recognition();
      recognizer.lang = navigator.language || 'en-US';
      recognizer.continuous = true;
      recognizer.interimResults = true;
      if ('processLocally' in recognizer) recognizer.processLocally = true;
      recognizer.onresult = function (ev) {
        var live = '';
        for (var i = ev.resultIndex; i < ev.results.length; i++) {
          var r = ev.results[i];
          if (r.isFinal) appendFinal(r[0].transcript); else live += r[0].transcript;
        }
        interim.textContent = live;
      };
      recognizer.onerror = function (ev) {
        var code = ev && ev.error;
        if (code === 'not-allowed' || code === 'service-not-allowed') say('Speech-to-text was blocked. Audio is still recording; type your note when you stop.');
        else if (code === 'language-not-supported') say('Speech-to-text is not available for this language here. Audio is still recording.');
        else if (code === 'network') say('This browser’s speech-to-text needs a connection. Audio is still recording.');
        else if (code && code !== 'no-speech' && code !== 'aborted') say('Speech-to-text stopped (' + code + '). Audio is still recording.');
        if (code !== 'no-speech' && code !== 'aborted') recognizer = null;
      };
      recognizer.onend = function () {
        interim.textContent = '';
        if (recording && recognizer) { try { recognizer.start(); } catch (err) {} }
      };
      recognizer.start();
    } catch (err) { recognizer = null; }
  }

  async function start() {
    say('');
    audioBlob = null; chunks = []; rawTranscript = ''; durationMs = 0;
    if (canRecord) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        stream = null;
        say(err && err.name === 'NotAllowedError'
          ? 'Microphone access was not allowed. Allow the microphone for this site to dictate, or type your note.'
          : 'No microphone was found. You can type your note.');
        return;
      }
      try {
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        recorder.start(1000);
      } catch (err) { recorder = null; }
    }
    startedAt = Date.now();
    timer.textContent = '0:00';
    tick = setInterval(function () { timer.textContent = fmt(Date.now() - startedAt); }, 500);
    setRecordingUI(true);
    startRecognition();
    say(Recognition ? 'Listening… speak your note. Tap Stop when you are done.' : 'Recording audio… type your note, then tap Stop.');
  }

  function stop() {
    return new Promise(function (resolve) {
      clearInterval(tick);
      durationMs = Date.now() - startedAt;
      var r = recognizer; recognizer = null;
      setRecordingUI(false);
      if (r) { try { r.stop(); } catch (err) {} }
      interim.textContent = '';
      function done() {
        if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
        stream = null;
        audioBlob = chunks.length ? new Blob(chunks, { type: (recorder && recorder.mimeType) || chunks[0].type || 'audio/webm' }) : null;
        recorder = null;
        say('Dictation stopped (' + fmt(durationMs) + '). Edit the text if you like, then save it as a journal entry.');
        resolve();
      }
      if (recorder && recorder.state !== 'inactive') { recorder.onstop = done; recorder.stop(); }
      else done();
    });
  }

  function reset() {
    text.value = ''; titleInput.value = ''; interim.textContent = '';
    audioBlob = null; chunks = []; rawTranscript = ''; durationMs = 0; pendingEntryId = '';
    timer.textContent = '';
    choice.hidden = true;
  }

  function hasOriginal() { return !!audioBlob || !!rawTranscript; }

  function keepOriginal(entryId) {
    if (!O) return Promise.resolve(false);
    return O.save(userId, entryId, { audio: audioBlob, rawTranscript: rawTranscript, durationMs: durationMs, recordedAt: new Date(startedAt).toISOString() });
  }

  function finished(msg) {
    reset();
    say(msg);
    document.dispatchEvent(new CustomEvent('twgi-journal-changed'));
  }

  toggle.addEventListener('click', function () {
    if (!userId) return;
    if (recording) stop(); else start();
  });

  saveBtn.addEventListener('click', async function () {
    if (!userId || recording) return;
    var entry;
    try {
      entry = J.save(userId, { title: titleInput.value, body: text.value, entryAt: new Date(startedAt || Date.now()).toISOString() });
    } catch (err) { say(err && err.message ? err.message : 'Could not save.'); return; }
    if (!hasOriginal()) { finished('Entry saved on this device.'); return; }
    var pref = S ? S.get(userId, 'journal', 'dictationOriginals') : 'ask';
    if (pref === 'never') { finished('Entry saved on this device. The original recording was not kept (your setting).'); return; }
    if (pref === 'always') {
      try { await keepOriginal(entry.id); finished('Entry and original copy saved on this device.'); }
      catch (err) { finished('Entry saved, but the original copy could not be stored on this device.'); }
      return;
    }
    pendingEntryId = entry.id;
    choice.hidden = false;
    saveBtn.disabled = true; discardBtn.disabled = true; toggle.disabled = true;
    say('Entry saved. Keep the original copy (audio and unedited transcript) with it?');
    keepBtn.focus();
    document.dispatchEvent(new CustomEvent('twgi-journal-changed'));
  });

  function closeChoice() { saveBtn.disabled = false; discardBtn.disabled = false; toggle.disabled = false; }
  keepBtn.addEventListener('click', async function () {
    var id = pendingEntryId; closeChoice();
    try { await keepOriginal(id); finished('Original copy saved with the entry on this device.'); }
    catch (err) { finished('The original copy could not be stored on this device.'); }
  });
  skipBtn.addEventListener('click', function () { closeChoice(); finished('Entry saved without the original copy.'); });

  discardBtn.addEventListener('click', function () {
    if ((text.value.trim() || audioBlob) && !global.confirm('Discard this dictation?')) return;
    reset(); say('Dictation discarded.');
  });

  function show(state) {
    var signedIn = !!(state && state.user && state.user.id);
    if (!signedIn && recording) stop();
    userId = signedIn ? state.user.id : '';
  }
  describeSupport();
  setRecordingUI(false);
  function wire() { global.TWGIAccount.subscribe(show); }
  if (global.TWGIAccount) wire(); else document.addEventListener('twgi-account-api', wire, { once: true });
})(window);
