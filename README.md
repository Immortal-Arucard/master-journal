# Journal (TWGI)

Private journal app for TWGI master accounts, served at
https://master-journal.theworldgovernmentincorporated.com/ from GitHub Pages (branch `main`, root).

- Static PWA: `index.html`, `login/`, `manifest.webmanifest`, `sw.js` (cache `master-journal-v13`).
- Daily reminder (`assets/push-core.js`, `assets/push-ui.js`): optional "Time to journal" push at a chosen time, from the push service at `https://push.theworldgovernmentincorporated.com`. Permission only after a tap. Only the reminder time, on/off and time zone are sent, never entries. `sw.js` handles `push` and `notificationclick`.
- Sign-in: same Supabase project as the main site, public publishable key only, email link + Google.
- Entries are kept on the device in localStorage `twgi-journal-v1:<user id>` and, since v4, sync
  across devices (`assets/cloud-sync.js` + `assets/journal-sync.js`, SQL `supabase/master_journal_sync.sql`,
  NOT applied yet): owner-only table `master_journal_entries` (newest edit wins per entry; deleted
  entries become empty tombstones) and settings in `master_settings`. Offline changes queue and sync
  on open, focus, back online or a Supabase Realtime nudge. Before the SQL is applied the app keeps
  working and says sync is not switched on yet. Original dictation copies stay on the recording device.
- Auto-update (v4, `assets/auto-update.js`): checks for a new version on open / return to screen and
  reloads once when it takes over (no loops; waits while typing or dictating).
- Pensieve: voice dictation (Web Speech API + MediaRecorder).
  v5 iPhone fix: on iPhone/iPad (all iOS browsers, incl. the Home Screen app) the mic does ONE job per
  dictation — live text (default) or audio recording only — because iOS cannot run speech recognition
  and a recording at once (v4 opened the recording first, so recognition heard silence: empty box, no
  error). Recognition starts inside the tap, interim words go straight into the Transcript box and are
  kept on Stop, a fresh recogniser per session, and every failure (blocked, Dictation off, no mic, no
  words after 8 s) shows a plain message plus the keyboard-microphone fallback. The Start/Stop button is
  a full-width bar fixed to the bottom of the home screen (safe-area aware, hidden while editing an
  entry or typing, always shown while recording). Original copies (audio + raw transcript) are kept in IndexedDB `twgi-journal-originals`, per the setting in localStorage `twgi-settings-v1:<user id>` (journal.dictationOriginals: ask | always | never).
- Note reminders (v6, `assets/reminders.js`, same file as the Worker's `reminders-core.cjs`): any note
  can have one optional reminder (name, first date/time, IANA time zone, repeat: once, daily, weekly on
  chosen days, monthly, every N hours, every N days; on/off; edit; delete). Notes never get one by
  themselves: after a NEW note is saved (form or Pensieve) it asks "Add a reminder?" (Add reminder /
  No thanks). A bell tag shows on notes with a reminder. It syncs with the note in the column
  `master_journal_entries.reminder` (NEW SQL `supabase/master_journal_reminders.sql`, NOT applied);
  until that column exists notes sync as before and reminders stay on the device. The push Worker
  sends them (see backend `DEPLOY-v6-note-reminders.md`); tapping one opens `/?note=<id>`.
- `supabase/master_journal.sql` was the first PROPOSED design. It is superseded by `supabase/master_journal_sync.sql`; do NOT apply the old file.

## v7 — Start dictation bar taps
- Bug: on iPhone (Home Screen app) tapping the bottom "Start dictation" bar hit the page behind it.
- Cause: the v5 viewport `viewport-fit=cover` makes iOS installed web apps draw the page to the full
  screen while touches still use a shorter viewport (WebKit bug 254868), so the bar's drawn spot and its
  tap spot did not match. iOS can also leave the visible viewport short after the keyboard closes (WebKit 297779).
- Fix: removed `viewport-fit=cover`; the bar uses `bottom: var(--bar-lift, 0px)` and `pensieve.js` lifts it
  into the visible area whenever `visualViewport` is shorter than the layout viewport (not while typing,
  not when zoomed). `pointer-events:auto`, z-index 900. Save-entry tap fix from v6 unchanged.
- Publishing: replace `index.html`, `sw.js`, `assets/app.css`, `assets/pensieve.js`. No SQL, no Worker change.

## v8 — Start dictation bar: "it doesn't react, and the Pensieve card behind it flashes red once"
- What the red flash is: the Pensieve card's red "recording" border (`.pensieve.is-recording`). It only
  appears when dictation has STARTED, so the tap did reach the bar. Dictation then stopped again at once
  (most likely iPhone speech-to-text refusing or ending immediately in the Home Screen app) and the
  explanation was written only inside the Pensieve card, not where the finger was. So it looked like
  "nothing happened" and "the card behind reacted".
- Fixes:
  - The bar now lives in its own dock, a direct child of `<body>` (`#dictation-dock`), outside every card,
    with `isolation:isolate`, z-index 900, `pointer-events:auto`, no tap highlight. When the bar is hidden
    (typing / editing) the button goes back to its place in the card.
  - One tap = one Start/Stop: a finished touch on the bar is handled on `touchend` (with `preventDefault`, so
    iOS sends no second click); a swipe is ignored; the click handler still works everywhere else.
  - If dictation fails, the reason shows right above the bar, with "Use keyboard microphone" and "OK".
    The last problem (code + time) is shown in Settings so it can be reported.
  - Red recording colour is on the bar itself (`#pensieve-toggle[aria-pressed="true"]`); more bottom space
    (120px) so the last card can scroll clear of the bar and its message.
  - Version label "Journal v8" in the footer and in Settings, plus the saved offline copy name
    (`master-journal-v8`) read from the phone's caches.
  - Service worker precaches every file with `?v=8` and `cache: 'reload'` (stored under the normal path),
    so the CDN or the phone's HTTP cache cannot hand an older file to the new version.
- Publishing: replace `index.html`, `sw.js`, `assets/app.css`, `assets/app.js`, `assets/pensieve.js`,
  `README.md`. No SQL, no Worker change.

## v9 — Android Chrome: "Speech-to-text is not available for your language here"
- The phone is Android (Chrome, installed app), not iPhone. The tap reached the bar; Chrome's speech
  recogniser then fired `language-not-supported`.
- Cause: since v5, `pensieve.js` switched `processLocally` on for every non-Apple browser. In Chrome
  139+ that means "on-device recognition only", which refuses any language whose offline speech pack is
  not downloaded on the phone. `lang` was also passed straight from `navigator.language` (could be a
  bare `en`).
- Fixes:
  - `processLocally` is never switched on (set to `false` where it exists), so Chrome uses its normal
    (cloud) speech service.
  - Language is always a well-formed BCP-47 tag. New setting **Settings > Dictation language**
    (`journal.dictationLanguage`, synced with the other settings; default English (US); Automatic =
    the phone's language, with bare tags like `en` mapped to `en-US`, unknown → `en-US`).
  - On `language-not-supported` (before any words) the Journal retries once with `en-US`, then once with
    no language set, before showing the message.
  - Messages are platform-neutral (Android/Gboard mic mentioned); "Use keyboard microphone" is offered at
    the bar on every phone and focuses the Transcript box. "Last dictation problem" now shows the
    language(s) tried and the platform.
  - Android gets the one-mic-job rule like iPhone (live text OR audio only), because Chrome's recogniser
    and a MediaRecorder cannot reliably share the microphone on Android.
  - Version label "Journal v9", cache `master-journal-v9`, precache with `?v=9`.
- Publishing: replace `index.html`, `sw.js`, `assets/app.css`, `assets/pensieve.js`, `assets/settings.js`,
  `assets/settings-ui.js`, `README.md`. No SQL (the setting lives in the existing settings JSON), no Worker change.

## v10 — Live transcript panel above the Stop bar
- Request: see the words while dictating without scrolling down to the Pensieve card.
- While dictation runs, a live transcript panel sits directly above the bottom Start/Stop bar, inside the
  same body-level dock (order: panel, problem message, bar; normal flow, so it can never sit over the bar
  or the message, and the bar keeps the v8 touch handling).
- Shows this dictation's words as they are recognised: final words in white, words still being recognised
  lighter and italic. Follows the newest words; if you scroll up inside it to read, it stops following until
  you scroll back to the bottom. Max height about 38% of the visible screen (`--live-max`, from the visual
  viewport, so it shrinks with the keyboard / short viewport), scrolls inside. It moves with `--bar-lift`.
- The card's Transcript box is still the one source of truth (Save uses only the box, nothing is saved twice).
- Audio-only mode: "Recording audio…" with the timer and a note that there is no live text.
- On Stop: "Finishing…" while the last words arrive, then "Saved to transcript" with **Review & edit**
  (scrolls to the Transcript box, no keyboard) and **OK**; it fades after about 2.6 s unless touched.
  Saving, Discard or a new Start close or refresh it.
- A problem (blocked, no words, mic) closes the panel and shows the message in its place, as before.
- "Update ready" notice is lifted by the dock's real height (`--dock-h`).
- Version label "Journal v10", cache `master-journal-v10`, precache with `?v=10`.
- Publishing: replace `index.html`, `sw.js`, `assets/app.css`, `assets/pensieve.js`, `README.md`.
  No SQL, no Worker change.

## v11 — Sync card moved to the bottom of the home page
- The "Syncs across your devices." explanation card (dashed border) and the "Synced across your devices."
  status line sat just under the Journal heading and intro, above the Pensieve, taking the best space
  on the phone screen for fine print.
- Both now sit at the bottom of the home page: after the Pensieve, entries and notes, and Settings,
  just above the footer. The card's text and behaviour are unchanged.
- The status line has a little space under the card (it previously hugged the bottom edge).
- Version label "Journal v11", cache `master-journal-v11`, precache with `?v=11`.
- Publishing: replace `index.html`, `sw.js`, `assets/app.css`, `README.md`. No SQL, no Worker change.

## v12 — Pensieve first screen: no cut-off mode radios
- On a phone, the first screen showed the long "Speech-to-text uses your device's built-in
  recognition…" paragraph and the two mode radios (Live text / Audio recording only). The
  second radio was cut off behind the fixed Start dictation bar.
- The long explanation is now a closed "How dictation works" disclosure (same text).
- The radios are replaced on first view by a compact "Mode: Live text · Change" line, placed
  below the Title and Transcript fields. Tapping Change reveals the same two radio options.
  Choosing a mode still works exactly as before (one-mic-job rule, saving, and settings are
  unchanged).
- Version label "Journal v12", cache `master-journal-v12`, precache with `?v=12`.
- Publishing: replace `index.html`, `sw.js`, `assets/app.css`, `assets/pensieve.js`, `README.md`.
  No SQL, no Worker change.

## v13 — Dictate the title with a mic in the Title field
- A small microphone button sits inside the right edge of the Pensieve "Title (optional)"
  field (icon button, aria-label "Dictate title", 40px tap target, vertically centred;
  the field is padded so typed text never runs under it).
- One tap starts speech recognition for the title only, always as live text (the Mode
  setting is ignored). It uses the same setup as v9/v10: processLocally off, a full
  language tag from Settings > Dictation language, retries (en-US, then unset), default
  English (US).
- The first utterance is trimmed, a trailing period is dropped, and it either replaces an
  empty title or is appended with a space. Recognition stops after that utterance, after
  about 8 seconds of silence, or on a second tap. While listening, the icon is red and
  pulses, and interim words show in the field in lighter italic (or as a placeholder).
- Main dictation (or audio recording) and the title mic cannot run at the same time: the
  other control is disabled. Errors use the existing message above the bar and the
  "Last dictation problem" line. If speech recognition is not available, the button
  focuses the Title field so the keyboard microphone can be used. The existing
  "Use keyboard microphone" fallback is unchanged.
- Version label "Journal v13", cache `master-journal-v13`, precache with `?v=13`.
- Publishing: replace `index.html`, `sw.js`, `assets/app.css`, `assets/pensieve.js`, `README.md`.
  No SQL, no Worker change.
