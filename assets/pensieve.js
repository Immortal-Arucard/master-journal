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
   the home screen.

   v9 (Android Chrome fix). Christopher's phone is Android, not iPhone. The
   tap reached the bar, but Chrome answered "language-not-supported" because
   v5-v8 switched processLocally on (true) for every non-Apple browser.
   That asks Chrome's newer ON-DEVICE recogniser only, which rejects any
   language whose offline pack is not downloaded. v9 never asks for on-device
   only (cloud recognition is allowed), always sets a well-formed language tag
   (Settings > Dictation language, default English (US)), and on
   "language-not-supported" retries once with en-US and once with no language
   before showing a message. Android also gets the one-mic-job rule (Chrome's
   recogniser and a recording cannot reliably share the microphone there). */
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
  /* v8: body-level dock for the bottom bar, and a message line right above it */
  var dock = document.getElementById('dictation-dock');
  var homeRow = toggle.parentNode, homeNext = toggle.nextSibling;
  var dockNote = document.getElementById('dictation-note');
  var dockNoteText = document.getElementById('dictation-note-text');
  var dockNoteKeyboard = document.getElementById('dictation-note-keyboard');
  var dockNoteClose = document.getElementById('dictation-note-close');
  var lastIssue = document.getElementById('dictation-last');

  var Recognition = global.SpeechRecognition || global.webkitSpeechRecognition || null;
  var canRecord = !!(nav.mediaDevices && nav.mediaDevices.getUserMedia && global.MediaRecorder);
  var ua = String(nav.userAgent || '');
  /* Every browser on iPhone/iPad is Safari's engine; iPadOS reports "Macintosh" with touch. */
  var isApple = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1);
  var standalone = nav.standalone === true || !!(global.matchMedia && global.matchMedia('(display-mode: standalone)').matches);
  var isAndroid = /Android/i.test(ua);
  /* iOS cannot run speech recognition and a recording at the same time; on
     Android, Chrome's recogniser (Google speech service) also needs the mic to
     itself, otherwise it hears nothing or fails with audio-capture. */
  var oneMicJob = isApple || isAndroid;
  var cfg = global.TWGIPensieveConfig || {}; /* tests only */
  var NO_WORDS_MS = cfg.noWordsMs || 8000;
  var STOP_WAIT_MS = cfg.stopWaitMs || 1500;
  var KEYBOARD_TIP = 'Tap the Transcript box, then tap the microphone key on your keyboard (on Android, the mic on Gboard) and speak. That works even when live speech-to-text does not.';

  /* ----- v9: dictation language ----- */
  var LANG_RE = /^([A-Za-z]{2,3})(?:-([A-Za-z]{4}))?(?:-([A-Za-z]{2}|[0-9]{3}))?$/;
  var REGION_FOR = { en: 'en-US', es: 'es-US', fr: 'fr-FR', de: 'de-DE', pt: 'pt-BR', it: 'it-IT', hi: 'hi-IN', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', ar: 'ar-SA', ru: 'ru-RU', nl: 'nl-NL' };
  /* Returns a full BCP-47 tag like "en-US", or '' if v is not usable. */
  function fullTag(v) {
    var m = LANG_RE.exec(String(v || '').trim().replace(/_/g, '-'));
    if (!m) return '';
    var lang = m[1].toLowerCase();
    if (lang === 'und' || lang === 'mul' || lang === 'zxx') return '';
    if (!m[3]) return REGION_FOR[lang] || '';
    return lang + (m[2] ? '-' + m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase() : '') + '-' + m[3].toUpperCase();
  }
  function deviceLang() {
    var list = [].concat(nav.languages || [], nav.language || []);
    for (var i = 0; i < list.length; i++) { var t = fullTag(list[i]); if (t) return t; }
    return 'en-US';
  }
  /* The language chain for one dictation: the chosen one, then en-US, then
     no language at all (the browser's own default). '' means "not set". */
  function langChain() {
    var pick = S && userId ? S.get(userId, 'journal', 'dictationLanguage') : 'en-US';
    var first = pick === 'auto' ? deviceLang() : (fullTag(pick) || 'en-US');
    var chain = [first];
    if (first !== 'en-US') chain.push('en-US');
    chain.push('');
    return chain;
  }
  function langName(l) { return l ? l : 'browser default'; }
  var langs = ['en-US'], langStep = 0;
  function langsTried() { return langs.slice(0, langStep + 1).map(langName).join(', then '); }

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
        : !Recognition && isAndroid
        ? 'This browser cannot turn speech into text. Open the Journal in Chrome for live text, or ' + KEYBOARD_TIP.charAt(0).toLowerCase() + KEYBOARD_TIP.slice(1)
        : 'This browser cannot turn speech into text. You can still record audio and type your note, or use your keyboard’s microphone key.');
    }
    if (!canRecord) bits.push('This browser cannot record audio here. ' + (Recognition ? 'Speech-to-text may still work.' : 'You can type your note.'));
    if (Recognition) bits.push('Speech-to-text uses your device’s built-in recognition. TWGI never sends your audio or words anywhere; ' + (isApple ? 'on iPhone, Apple’s Siri & Dictation service turns your speech into text.' : isAndroid ? 'on Android, Chrome uses Google’s speech service to turn your speech into text.' : 'on some browsers, the browser’s own speech service may process audio.'));
    if (oneMicJob && Recognition && canRecord) bits.push('On this phone the microphone can either show live text or record audio, not both at once.');
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
    placeToggle(show);
    if (show && typeof liftBar === 'function' && vv !== undefined) liftBar();
  }
  /* v8: while the bar is shown the button lives in the body-level dock, so no
     card, wrapper or stacking layer can ever be above it; otherwise it goes
     back to its place in the Pensieve card. */
  function placeToggle(show) {
    if (!dock) return;
    if (show) {
      if (toggle.parentNode !== dock) dock.appendChild(toggle);
      dock.hidden = false;
    } else {
      if (toggle.parentNode !== homeRow) homeRow.insertBefore(toggle, homeNext && homeNext.parentNode === homeRow ? homeNext : null);
      dock.hidden = true;
      hideDockNote();
    }
  }
  /* v8: problems are shown right above the bar (the card may be off screen). */
  function showDockNote(msg, code) {
    remember(code || 'message');
    if (!dockNote || !dockNoteText) return;
    dockNoteText.textContent = msg;
    if (dockNoteKeyboard) dockNoteKeyboard.hidden = false; /* v9: every phone, Android included */
    dockNote.hidden = false;
  }
  function hideDockNote() { if (dockNote) dockNote.hidden = true; }
  function remember(code) {
    var line = 'Last dictation problem: ' + code + (code !== 'microphone' && code !== 'message' && Recognition ? ' (language tried: ' + langsTried() + ')' : '') + ' at ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + (standalone ? ' (installed app)' : '') + (isAndroid ? ' · Android' : isApple ? ' · iPhone/iPad' : '') + '.';
    try { global.localStorage.setItem('twgi-journal-dictation-last', line); } catch (err) {}
    showLast(line);
  }
  function showLast(line) {
    if (!lastIssue || !line) return;
    lastIssue.textContent = ' · ' + line;
    lastIssue.hidden = false;
  }
  try { showLast(global.localStorage.getItem('twgi-journal-dictation-last')); } catch (err) {}
  if (dockNoteClose) dockNoteClose.addEventListener('click', hideDockNote);
  if (dockNoteKeyboard) dockNoteKeyboard.addEventListener('click', function () {
    hideDockNote();
    if (recording) return;
    text.readOnly = false;
    try { text.scrollIntoView({ block: 'center' }); } catch (err) {}
    text.focus(); /* inside the tap, so the phone keyboard (iPhone mic key, Gboard mic) opens */
    say('Tap the microphone key on your keyboard and speak, or type your note.');
  });

  /* v7: if iOS leaves the visible area shorter than the layout viewport
     (keyboard just closed, or the Home Screen app's short viewport), lift the
     bar by that much so what you see is what you can tap. Never while typing. */
  var vv = global.visualViewport || null;
  function liftBar() {
    var lift = 0;
    if (vv && global.innerHeight && !typingElsewhere() && Math.abs((vv.scale || 1) - 1) < 0.01) {
      var covered = global.innerHeight - ((vv.height || 0) + (vv.offsetTop || 0));
      if (covered > 1 && covered < global.innerHeight / 3) lift = Math.round(covered);
    }
    document.documentElement.style.setProperty('--bar-lift', lift + 'px');
    return lift;
  }
  if (vv && vv.addEventListener) { vv.addEventListener('resize', liftBar); vv.addEventListener('scroll', liftBar); }
  global.addEventListener('resize', liftBar);
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
    if (code === 'not-allowed') return 'Speech-to-text was not allowed. When the Journal asks, allow the microphone' + (isAndroid ? ' (or in Chrome: the lock icon / site settings, Microphone, Allow). ' : ' and speech recognition. ') + KEYBOARD_TIP;
    if (code === 'service-not-allowed') return isApple
      ? 'Your iPhone did not let the Journal use speech-to-text. Check that Dictation is on (Settings, General, Keyboard, Enable Dictation). ' + KEYBOARD_TIP
      : isAndroid
        ? 'Your phone did not let the Journal use speech-to-text. Check that Chrome may use the microphone and that the Google app’s speech service is on. ' + KEYBOARD_TIP
        : 'This browser did not allow speech-to-text here. ' + KEYBOARD_TIP;
    if (code === 'audio-capture') return 'Speech-to-text could not get the microphone (another app may be using it). ' + KEYBOARD_TIP;
    if (code === 'language-not-supported') return 'Speech-to-text on this device would not accept the language (tried ' + langsTried() + '). You can pick another language under Settings, Dictation language. ' + KEYBOARD_TIP;
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
    var lang = langs[langStep] || '';
    if (lang) r.lang = lang; /* '' = leave it unset: the browser's own default */
    r.continuous = true;
    r.interimResults = true;
    /* v9: never ask for on-device-only recognition. Chrome with processLocally on
       rejects languages whose offline pack is not downloaded
       ("language-not-supported"); false lets it use its normal (cloud) service. */
    try { if ('processLocally' in r) r.processLocally = false; } catch (err) {}
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
      /* v9: the language was refused before any words came: retry once with
         en-US, then once with no language set, before giving up. */
      if (code === 'language-not-supported' && !gotWords && !endWaiter && recording && liveOn && langStep < langs.length - 1) {
        langStep++;
        gen++; /* the refused recogniser's own end/error events are ignored */
        try { r.abort(); } catch (err) {}
        try { sessionStart = Date.now(); recognizer = newRecognizer(); recognizer.start(); return; }
        catch (err) { recognizer = null; }
      }
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
    stop({ silent: true }).then(function () { say(msg); showHelp(msg); showDockNote(msg, code); });
  }

  /* Must run synchronously inside the tap (iOS needs the tap to allow it). */
  function startRecognition() {
    if (!Recognition) return false;
    base = text.value; committed = ''; curFinal = ''; curInterim = '';
    gotWords = false; heardAudio = false; warned = false; fatal = ''; quickEnds = 0;
    langs = langChain(); langStep = 0;
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
    hideDockNote();
    audioBlob = null; chunks = []; rawTranscript = ''; durationMs = 0; liveOn = false;
    if (!isApple) hideHelp();
    var m = mode();
    var wantLive = !!Recognition && m === 'live';
    var wantAudio = canRecord && (!oneMicJob || !wantLive);
    startedAt = Date.now();
    var live = wantLive && startRecognition();
    if (wantLive && !live && !wantAudio && canRecord) wantAudio = true; /* fall back to a recording */
    if (!live && !wantAudio) { say(errorMessage('start-failed')); showHelp(errorMessage('start-failed')); showDockNote(errorMessage('start-failed'), 'start-failed'); return; }
    timer.textContent = '0:00';
    tick = setInterval(function () { timer.textContent = fmt(Date.now() - startedAt); labelToggle(); }, 500);
    setRecordingUI(true);
    if (live) say('Listening… speak your note. Your words appear in the Transcript box. Tap Stop when you are done.');
    else say((wantLive ? errorMessage('start-failed') + ' ' : '') + 'Recording audio only… tap Stop when you are done, then type your note' + (isApple ? ' or use the keyboard’s microphone key.' : '.'));
    if (wantAudio) {
      startRecorder(function (msg) {
        if (liveOn) return; /* live text still works without the recording */
        stop({ silent: true }).then(function () { say(msg); showDockNote(msg, 'microphone'); });
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
            say(msg); showHelp(msg); showDockNote(msg, fatal || 'no-words');
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

  /* v8: one tap = one Start or Stop. A real <button> click works on iPhone;
     on the bottom bar a finished touch also counts (and cancels iOS's own
     follow-up click), so a tap is never lost and never runs twice. */
  var touchAt = null, touchedAt = 0;
  function activate() {
    if (!userId || toggle.disabled) return;
    if (recording) stop(); else start();
  }
  toggle.addEventListener('click', function () {
    if (touchedAt && Date.now() - touchedAt < 800) { touchedAt = 0; return; } /* already handled on touchend */
    activate();
  });
  toggle.addEventListener('touchstart', function (ev) {
    var t = ev.changedTouches && ev.changedTouches[0];
    touchAt = toggle.classList.contains('dictation-bar') && t ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
  }, { passive: true });
  toggle.addEventListener('touchcancel', function () { touchAt = null; });
  toggle.addEventListener('touchend', function (ev) {
    var s0 = touchAt; touchAt = null;
    var t = ev.changedTouches && ev.changedTouches[0];
    if (!s0 || !t || Math.abs(t.clientX - s0.x) > 12 || Math.abs(t.clientY - s0.y) > 12 || Date.now() - s0.at > 1000) return;
    if (ev.cancelable) ev.preventDefault();
    touchedAt = Date.now();
    activate();
  });

  if (keyboardBtn) keyboardBtn.addEventListener('click', function () {
    if (recording) return;
    text.readOnly = false;
    try { text.scrollIntoView({ block: 'center' }); } catch (err) {}
    text.focus(); /* inside the tap, so the phone keyboard (iPhone mic key, Gboard mic) opens */
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

  global.TWGIPensieve._debug = { isApple: isApple, isAndroid: isAndroid, fullTag: fullTag, deviceLang: deviceLang, langChain: langChain, langsTried: function () { return langsTried(); }, standalone: standalone, oneMicJob: oneMicJob, joinPieces: joinPieces, updateBar: updateBar, liftBar: liftBar, dock: dock, NO_WORDS_MS: NO_WORDS_MS };
  describeSupport();
  setRecordingUI(false);
  function wire() { global.TWGIAccount.subscribe(show); }
  if (global.TWGIAccount) wire(); else document.addEventListener('twgi-account-api', wire, { once: true });
})(window);
