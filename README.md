# Journal (TWGI)

Private journal app for TWGI master accounts, served at
https://master-journal.theworldgovernmentincorporated.com/ from GitHub Pages (branch `main`, root).

- Static PWA: `index.html`, `login/`, `manifest.webmanifest`, `sw.js` (cache `master-journal-v4`).
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
- Pensieve: voice dictation (Web Speech API + MediaRecorder). Original copies (audio + raw transcript) are kept in IndexedDB `twgi-journal-originals`, per the setting in localStorage `twgi-settings-v1:<user id>` (journal.dictationOriginals: ask | always | never).
- `supabase/master_journal.sql` was the first PROPOSED design. It is superseded by `supabase/master_journal_sync.sql`; do NOT apply the old file.
