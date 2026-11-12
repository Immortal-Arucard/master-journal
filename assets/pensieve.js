/* Pensieve: dictate journal notes by voice.
   - Microphone is requested only when the user taps Start dictation.
   - Live text uses the browser's built-in Web Speech API
     (SpeechRecognition / webkitSpeechRecognition). TWGI never sends audio or
     text to any server, and no third-party service is used. On iPhone the
     words are recognised by Apple's own speech service (Siri & Dictation).
   - MediaRecorder keeps the audio so the user can keep an "original copy"
     (audio + raw transcript) with the entry, per the master profile setting
     journal.dictationOriginals (ask / always / never).

   v5 (iPhone fix). Why v4 showed an empty box on iPhone:
     1. It opened the microphone for MediaRecorder (getUserMedia) FIRST and
        then started speech recognition on top. iOS cannot share the mic:
        once recording holds it, the recogniser hears silence and fires no
        result and no error, so the box stayed empty with no message.
     2. recognition.start() ran after an await (outside the tap), which iOS
        may refuse.
     3. Words only reached the box when iOS marked them "final"; iOS often
        leaves the last words "interim" and v4 wiped them on Stop.
   v5: on iPhone/iPad the mic does ONE job per dictation (live text, or
   audio only), recognition starts inside the tap, every word (interim too)
   is written straight into the Transcript box and kept on Stop, a fresh
   recogniser is used for each session, and every failure shows a clear
   message plus the keyboard-microphone fallback (works in the Home Screen
   app). The Start/Stop button is a full-width bar fixed to the bottom of
   the home screen. */
(function (global) {
  var PENSIEVE_NAME = 'Pensieve'; /* rename here only */
  global.TWGIPensieve = { NAME: PENSIEVE_NAME };

  var root = document.getElementById('pensieve');
  if (!root || !global.TWGIJournal) return;
  Array.prototype.forEach.call(document.querySelectorAll('[data-pensieve-name]'), function (n) { n.textContent = PENSIEVE_NAME; });

  var J = global.TWGIJournal;
  var O = global.TWGIJournalOriginals;
  var S = global.TWGISettings;
  var nav = global.navigator || {};
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
  var modeBox = document.getElementById('pensieve-mode');
  var help = document.getElementById('pensieve-help');
  var helpText = document.getElementById('pensieve-help-text');
  var keyboardBtn = document.getElementById('pensieve-keyboard');
  var journalRoot = document.getElementById('journal');
  var journalForm = document.getElementById('journal-form');
  var journalCancel = document.getElementById('journal-cancel');

  var Recognition = global.SpeechRecognition || global.webkitSpeechRecognition || null;
  var canRecord = !!(nav.mediaDevices && nav.mediaDevices.getUserMedia && global.MediaRecorder);
  var ua = String(nav.userAgent || '');
  /* Every browser on iPhone/iPad is Safari's engine; iPadOS reports "Macintosh" with touch. */
  var isApple = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1);
  var standalone = nav.standalone === true || !!(global.matchMedia && global.matchMedia('(display-mode: standalone)').matches);
  /* iOS cannot run speech recognition and a recording at the same time. */
  var oneMicJob = isApple;
  var cfg = global.TWGIPensieveConfig || {}; /* tests only */
  var NO_WORDS_MS = cfg.noWordsMs || 8000;
  var STOP_WAIT_MS = cfg.stopWaitMs || 1500;
  var KEYBOARD_TIP = 'Tap the Transcript box, then tap the microphone key on your keyboard and speak. That always works, including in the Home Screen app.';

  var userId = '';
  var recording = false;
  var stream = null, recorder = null, chunks = [], recognizer = null;
  var rawTranscript = '', startedAt = 0, durationMs = 0, audioBlob = null, tick = null;
  var pendingEntryId = '';
  var savedEntryId = ''; /* v6: asks "Add a reminder?" after saving */
  /* live text state */
  var liveOn = false, base = '', committed = '', curFinal = '', curInterim = '';
  var gotWords = false, heardAudio = false, warned = false, fatal = '', watchdog = null;
  var gen = 0, quickEnds = 0, sessionStart = 0, endWaiter = null;

  function say(t) { statusNode.textContent = t || ''; }
  function fmt(ms) { var s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function showHelp(msg) { if (!help) return; if (helpText) helpText.textContent = msg || ('If no words appear: ' + KEYBOARD_TIP); help.hidden = false; }
  function hideHelp() { if (help) help.hidden = true; }

  function mode() {
    if (!oneMicJob || !Recognition) return Recognition ? 'live' : 'audio';
    var picked = document.querySelector('input[name="pensieve-mode"]:checked');
    return picked && picked.value === 'audio' && canRecord ? 'audio' : 'live';
  }

  /* Joins speech pieces; tolerates iOS repeating the whole text in each result. */
  function joinPieces(list) {
    var acc = '';
    for (var i = 0; i < list.length; i++) {
      var p = String(list[i] || '').replace(/\s+/g, ' ').trim();
      if (!p) continue;
      var a = acc.toLowerCase(), b = p.toLowerCase();
      if (!acc) acc = p;
      else if (b.indexOf(a) === 0) acc = p;
      else if (a.slice(-b.length) === b) continue;
      else acc += ' ' + p;
    }
    return acc;
  }
  function glue(a, b) { a = a || ''; b = b || ''; if (!a) return b; if (!b) return a; return /\s$/.test(a) ? a + b : a + ' ' + b; }
  function spoken() { return joinPieces([committed, curFinal, curInterim]); }
  function paint() {
    text.value = glue(base, spoken());
    interim.textContent = curInterim ? 'Hearing: ' + curInterim : '';
  }
  function commitSession() {
    committed = joinPieces([committed, curFinal, curInterim]);
    curFinal = ''; curInterim = '';
    rawTranscript = committed;
    paint();
    interim.textContent = '';
  }

  function describeSupport() {
    var bits = [];
    if (!Recognition) {
      bits.push(isApple && standalone
        ? 'Live speech-to-text is not available in the Home Screen app on this iPhone. ' + KEYBOARD_TIP + ' You can also record audio, or open the Journal in Safari for live text.'
        : 'This browser cannot turn speech into text. You can still record audio and type your note, or use your keyboard’s microphone key.');
    }
    if (!canRecord) bits.push('This browser cannot record audio here. ' + (Recognition ? 'Speech-to-text may still work.' : 'You can type your note.'));
    if (Recognition) bits.push('Speech-to-text uses your device’s built-in recognition. TWGI never sends your audio or words anywhere; ' + (isApple ? 'on iPhone, Apple’s Siri & Dictation service turns your speech into text.' : 'on some browsers, the browser’s own speech service may process audio.'));
    if (oneMicJob && Recognition && canRecord) bits.push('On iPhone the microphone can either show live text or record audio, not both at once.');
    support.textContent = bits.join(' ');
    if (modeBox) modeBox.hidden = !(oneMicJob && Recognition && canRecord);
    if (isApple || !Recognition) showHelp('Tip: ' + KEYBOARD_TIP);
    if (!Recognition && !canRecord) toggle.disabled = true;
  }

  /* ----- full-width Start/Stop bar fixed to the bottom of the home screen ----- */
  function typingElsewhere() {
    var a = document.activeElement;
    if (!a || a === document.body) return false;
    return !!(a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName || '')) && a.type !== 'radio' && a.type !== 'checkbox';
  }
  function editingEntry() { return !!(journalCancel && !journalCancel.hidden) || !!document.querySelector('[data-reminder-editor]'); }
  /* v6: the page keeps its bottom space whenever the bar can appear, so
     showing/hiding the bar never moves the page; and the bar only comes back
     after the finger is lifted, so a tap can never land on it by surprise. */
  var pointerDown = false;
  function updateBar() {
    if (!document || !document.body) return;
    var onHome = !!userId && !(journalRoot && journalRoot.hidden);
    var show = recording || (onHome && !editingEntry() && !typingElsewhere());
    var shown = toggle.classList.contains('dictation-bar');
    document.body.classList.toggle('has-dictation-space', recording || onHome);
    if (show && !shown && pointerDown) return; /* wait for the finger to lift */
    document.body.classList.toggle('has-dictation-bar', show);
    toggle.classList.toggle('dictation-bar', show);
  }
  var BAR_RETURN_MS = 350;
  function laterBar() { setTimeout(updateBar, BAR_RETURN_MS); }
  document.addEventListener('pointerdown', function () { pointerDown = true; }, true);
  document.addEventListener('pointerup', function () { pointerDown = false; laterBar(); }, true);
  document.addEventListener('pointercancel', function () { pointerDown = false; laterBar(); }, true);
  function labelToggle() {
    toggle.textContent = recording ? 'Stop dictation' + (startedAt ? ' · ' + fmt(Date.now() - startedAt) : '') : 'Start dictation';
  }

  function setRecordingUI(on) {
    recording = on;
    labelToggle();
    toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    root.classList.toggle('is-recording', on);
    saveBtn.disabled = on;
    discardBtn.disabled = on;
    if (modeBox) Array.prototype.forEach.call(modeBox.querySelectorAll('input'), function (i) { i.disabled = on; });
    text.readOnly = on && liveOn;
    updateBar();
  }

  function errorMessage(code) {
    if (code === 'not-allowed') return 'Speech-to-text was not allowed. When the Journal asks, tap Allow for the microphone and speech recognition. ' + KEYBOARD_TIP;
    if (code === 'service-not-allowed') return isApple
      ? 'Your iPhone did not let the Journal use speech-to-text. Check that Dictation is on (Settings, General, Keyboard, Enable Dictation). ' + KEYBOARD_TIP
      : 'This browser did not allow speech-to-text here. ' + KEYBOARD_TIP;
    if (code === 'audio-capture') return 'Speech-to-text could not get the microphone (another app may be using it). ' + KEYBOARD_TIP;
    if (code === 'language-not-supported') return 'Speech-to-text is not available for your language here. ' + KEYBOARD_TIP;
    if (code === 'network') return 'Speech-to-text needs an internet connection right now. ' + KEYBOARD_TIP;
    if (code === 'start-failed') return 'Speech-to-text would not start. ' + KEYBOARD_TIP;
    return 'Speech-to-text stopped (' + code + '). ' + KEYBOARD_TIP;
  }

  function onWatchdog() {
    watchdog = null;
    if (!recording || !liveOn || gotWords) return;
    warned = true;
    var msg = heardAudio
      ? 'No words yet. Keep speaking, or if they still don’t appear, tap Stop. '
      : 'The Journal is not hearing you. Tap Stop. ';
    msg += KEYBOARD_TIP + (isApple ? ' If this keeps happening, close the Journal app fully and open it again.' : '');
    say(msg);
    showHelp(msg);
  }

  function newRecognizer() {
    var my = ++gen;
    var r = new Recognition();
    r.lang = nav.language || 'en-US';
    r.continuous = true;
    r.interimResults = true;
    if (!isApple && 'processLocally' in r) r.processLocally = true;
    r.onaudiostart = function () { if (my === gen) heardAudio = true; };
    r.onsoundstart = r.onspeechstart = function () { if (my === gen) heardAudio = true; };
    r.onresult = function (ev) {
      if (my !== gen) return;
      var finals = [], live = [];
      /* Rebuild from the whole result list each time (safe if iOS re-sends results). */
      for (var i = 0; i < ev.results.length; i++) {
        var res = ev.results[i];
        var t = res && res[0] ? res[0].transcript : '';
        if (res.isFinal) finals.push(t); else live.push(t);
      }
      curFinal = joinPieces(finals);
      curInterim = joinPieces(live);
      if (curFinal || curInterim) {
        gotWords = true; heardAudio = true; quickEnds = 0;
        if (warned) { warned = false; say('Listening… your words appear in the Transcript box.'); if (!isApple) hideHelp(); }
      }
      rawTranscript = spoken();
      paint();
    };
    r.onerror = function (ev) {
      if (my !== gen) return;
      var code = (ev && ev.error) || 'unknown';
      if (code === 'no-speech' || code === 'aborted') return;
      fatal = code;
      if (endWaiter) return; /* already stopping; stop() reports it */
      try { r.abort(); } catch (err) {}
      if (recording && liveOn) liveFailed(code);
    };
    r.onend = function () {
      if (my !== gen) return;
      commitSession();
      if (endWaiter) { var w = endWaiter; endWaiter = null; w(); return; }
      if (!recording || !liveOn) return;
      if (fatal) { liveFailed(fatal); return; }
      if (Date.now() - sessionStart < 1000 && !curFinal) quickEnds++; else quickEnds = 0;
      if (quickEnds >= 3) { liveFailed('start-failed'); return; }
      /* iOS / Chrome end sessions on their own; continue with a fresh recogniser. */
      try { sessionStart = Date.now(); recognizer = newRecognizer(); recognizer.start(); }
      catch (err) { recognizer = null; liveFailed('start-failed'); }
    };
    return r;
  }

  function liveFailed(code) {
    commitSession(); /* keep any words that did arrive */
    base = text.value; committed = '';
    liveOn = false; recognizer = null; gen++;
    clearTimeout(watchdog); watchdog = null;
    var msg = errorMessage(code);
    if (recorder && recorder.state !== 'inactive') {
      say(msg.replace(KEYBOARD_TIP, '') + 'Audio is still recording; type your note when you stop.');
      text.readOnly = false;
      showHelp('Tip: ' + KEYBOARD_TIP);
      return;
    }
    stop({ silent: true }).then(function () { say(msg); showHelp(msg); });
  }

  /* Must run synchronously inside the tap (iOS needs the tap to allow it). */
  function startRecognition() {
    if (!Recognition) return false;
    base = text.value; committed = ''; curFinal = ''; curInterim = '';
    gotWords = false; heardAudio = false; warned = false; fatal = ''; quickEnds = 0;
    try {
      sessionStart = Date.now();
      recognizer = newRecognizer();
      recognizer.start();
      liveOn = true;
      clearTimeout(watchdog);
      watchdog = setTimeout(onWatchdog, NO_WORDS_MS);
      return true;
    } catch (err) {
      recognizer = null; liveOn = false; gen++;
      return false;
    }
  }

  function startRecorder(onFail) {
    return nav.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
      if (!recording) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
      stream = s;
      try {
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        recorder.start(1000);
      } catch (err) { recorder = null; }
    }, function (err) {
      stream = null;
      onFail(err && err.name === 'NotAllowedError'
        ? 'Microphone access was not allowed. Allow the microphone for this site to dictate, or type your note.'
        : 'No microphone was found. You can type your note.');
    });
  }

  function start() {
    say('');
    audioBlob = null; chunks = []; rawTranscript = ''; durationMs = 0; liveOn = false;
    if (!isApple) hideHelp();
    var m = mode();
    var wantLive = !!Recognition && m === 'live';
    var wantAudio = canRecord && (!oneMicJob || !wantLive);
    startedAt = Date.now();
    var live = wantLive && startRecognition();
    if (wantLive && !live && !wantAudio && canRecord) wantAudio = true; /* fall back to a recording */
    if (!live && !wantAudio) { say(errorMessage('start-failed')); showHelp(errorMessage('start-failed')); return; }
    timer.textContent = '0:00';
    tick = setInterval(function () { timer.textContent = fmt(Date.now() - startedAt); labelToggle(); }, 500);
    setRecordingUI(true);
    if (live) say('Listening… speak your note. Your words appear in the Transcript box. Tap Stop when you are done.');
    else say((wantLive ? errorMessage('start-failed') + ' ' : '') + 'Recording audio only… tap Stop when you are done, then type your note' + (isApple ? ' or use the keyboard’s microphone key.' : '.'));
    if (wantAudio) {
      startRecorder(function (msg) {
        if (liveOn) return; /* live text still works without the recording */
        stop({ silent: true }).then(function () { say(msg); });
      });
    }
  }

  function stop(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      clearInterval(tick);
      clearTimeout(watchdog); watchdog = null;
      durationMs = Date.now() - startedAt;
      var r = recognizer; recognizer = null;
      var usedLive = liveOn;
      liveOn = false;
      setRecordingUI(false);
      function finish() {
        gen++;
        if (usedLive) commitSession();
        if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
        stream = null;
        audioBlob = chunks.length ? new Blob(chunks, { type: (recorder && recorder.mimeType) || chunks[0].type || 'audio/webm' }) : null;
        recorder = null;
        if (!opts.silent) {
          if (usedLive && !rawTranscript) {
            var msg = fatal ? errorMessage(fatal) : 'No words came through from speech-to-text. ' + KEYBOARD_TIP + (isApple ? ' If this keeps happening, close the Journal app fully and open it again.' : '');
            say(msg); showHelp(msg);
          } else {
            say('Dictation stopped (' + fmt(durationMs) + '). Edit the text if you like, then save it as a journal entry.');
          }
        }
        resolve();
      }
      function afterRecognizer() {
        if (recorder && recorder.state !== 'inactive') { recorder.onstop = finish; recorder.stop(); }
        else finish();
      }
      if (r) {
        /* Wait briefly for the last words iOS delivers after stop(). */
        var done = false;
        var go = function () { if (done) return; done = true; endWaiter = null; afterRecognizer(); };
        endWaiter = go;
        setTimeout(go, STOP_WAIT_MS);
        try { r.stop(); } catch (err) { go(); }
      } else afterRecognizer();
    });
  }

  function reset() {
    text.value = ''; titleInput.value = ''; interim.textContent = '';
    audioBlob = null; chunks = []; rawTranscript = ''; durationMs = 0; pendingEntryId = '';
    base = ''; committed = ''; curFinal = ''; curInterim = '';
    timer.textContent = '';
    choice.hidden = true;
  }

  function hasOriginal() { return !!audioBlob || !!rawTranscript; }

  function keepOriginal(entryId) {
    if (!O) return Promise.resolve(false);
    return O.save(userId, entryId, { audio: audioBlob, rawTranscript: rawTranscript, durationMs: durationMs, recordedAt: new Date(startedAt).toISOString() });
  }

  function finished(msg) {
    var id = savedEntryId; savedEntryId = '';
    reset();
    say(msg);
    document.dispatchEvent(new CustomEvent('twgi-journal-changed'));
    if (id) document.dispatchEvent(new CustomEvent('twgi-journal-new-entry', { detail: { id: id } }));
  }

  toggle.addEventListener('click', function () {
    if (!userId) return;
    if (recording) stop(); else start();
  });

  if (keyboardBtn) keyboardBtn.addEventListener('click', function () {
    if (recording) return;
    text.readOnly = false;
    text.focus(); /* inside the tap, so the iPhone keyboard opens */
    say('Tap the microphone key on your keyboard and speak, or type your note.');
  });

  saveBtn.addEventListener('click', async function () {
    if (!userId || recording) return;
    var entry;
    try {
      entry = J.save(userId, { title: titleInput.value, body: text.value, entryAt: new Date(startedAt || Date.now()).toISOString() });
    } catch (err) { say(err && err.message ? err.message : 'Could not save.'); return; }
    savedEntryId = entry.id;
    if (!hasOriginal()) { finished(J.sync && J.sync.enabled ? 'Entry saved. It syncs to your other devices.' : 'Entry saved on this device.'); return; }
    var pref = S ? S.get(userId, 'journal', 'dictationOriginals') : 'ask';
    if (pref === 'never') { finished('Entry saved. The original recording was not kept (your setting).'); return; }
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
    updateBar();
  }

  document.addEventListener('focusin', function () { updateBar(); });
  document.addEventListener('twgi-journal-editor', function () { updateBar(); });
  document.addEventListener('focusout', laterBar);
  if (journalCancel && global.MutationObserver) new MutationObserver(updateBar).observe(journalCancel, { attributes: true, attributeFilter: ['hidden'] });
  if (journalRoot && global.MutationObserver) new MutationObserver(updateBar).observe(journalRoot, { attributes: true, attributeFilter: ['hidden'] });

  global.TWGIPensieve._debug = { isApple: isApple, standalone: standalone, oneMicJob: oneMicJob, joinPieces: joinPieces, updateBar: updateBar, NO_WORDS_MS: NO_WORDS_MS };
  describeSupport();
  setRecordingUI(false);
  function wire() { global.TWGIAccount.subscribe(show); }
  if (global.TWGIAccount) wire(); else document.addEventListener('twgi-account-api', wire, { once: true });
})(window);
