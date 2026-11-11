# Journal (TWGI)

Private journal app for TWGI master accounts, served at
https://master-journal.theworldgovernmentincorporated.com/ from GitHub Pages (branch `main`, root).

- Static PWA: `index.html`, `login/`, `manifest.webmanifest`, `sw.js` (cache `master-journal-v*`).
- Sign-in: same Supabase project as the main site, public publishable key only, email link + Google.
- Entries are saved on this device only, in localStorage `twgi-journal-v1:<user id>`.
  `TWGIJournal.sync.pull/push` are placeholders for a later cloud sync.
- Pensieve: voice dictation (Web Speech API + MediaRecorder). Original copies (audio + raw transcript) are kept in IndexedDB `twgi-journal-originals`, per the setting in localStorage `twgi-settings-v1:<user id>` (journal.dictationOriginals: ask | always | never).
- `supabase/master_journal.sql` is a PROPOSED owner-only design (entries, originals, settings, private audio bucket). It has NOT been applied.
