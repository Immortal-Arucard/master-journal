# Journal (TWGI)

Private journal app for TWGI master accounts, served at
https://master-journal.theworldgovernmentincorporated.com/ from GitHub Pages (branch `main`, root).

- Static PWA: `index.html`, `login/`, `manifest.webmanifest`, `sw.js` (cache `master-journal-v3`).
- Daily reminder (`assets/push-core.js`, `assets/push-ui.js`): optional "Time to journal" push at a chosen time, from the push service at `https://push.theworldgovernmentincorporated.com`. Permission only after a tap. Only the reminder time, on/off and time zone are sent, never entries. `sw.js` handles `push` and `notificationclick`.
- Sign-in: same Supabase project as the main site, public publishable key only, email link + Google.
- Entries are saved on this device only, in localStorage `twgi-journal-v1:<user id>`.
  `TWGIJournal.sync.pull/push` are placeholders for a later cloud sync.
- Pensieve: voice dictation (Web Speech API + MediaRecorder). Original copies (audio + raw transcript) are kept in IndexedDB `twgi-journal-originals`, per the setting in localStorage `twgi-settings-v1:<user id>` (journal.dictationOriginals: ask | always | never).
- `supabase/master_journal.sql` is a PROPOSED owner-only design (entries, originals, settings, private audio bucket). It has NOT been applied.
