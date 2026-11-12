# Journal (TWGI)

Private journal app for TWGI master accounts, served at
https://master-journal.theworldgovernmentincorporated.com/ from GitHub Pages (branch `main`, root).

- Static PWA: `index.html`, `login/`, `manifest.webmanifest`, `sw.js` (cache `master-journal-v6`).
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
