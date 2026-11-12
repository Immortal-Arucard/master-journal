# Journal (TWGI)

Private journal app for TWGI master accounts, served at
https://master-journal.theworldgovernmentincorporated.com/ from GitHub Pages (branch `main`, root).

- Static PWA: `index.html`, `login/`, `manifest.webmanifest`, `sw.js` (cache `master-journal-v8`).
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
