-- PROPOSED, NOT APPLIED. Cloud sync for the TWGI Journal.
-- Owner-only: each signed-in master account can read and write only its own
-- entries. No public access. Review before applying in a NEW migration.
create table if not exists public.master_journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null default '' check (char_length(title) <= 160),
  body text not null default '' check (char_length(body) <= 20000),
  entry_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(title) > 0 or char_length(body) > 0)
);

create index if not exists master_journal_entries_user_entry_at
  on public.master_journal_entries (user_id, entry_at desc);

alter table public.master_journal_entries enable row level security;
alter table public.master_journal_entries force row level security;

revoke all on public.master_journal_entries from anon;
grant select, insert, update, delete on public.master_journal_entries to authenticated;

create policy master_journal_entries_select_own on public.master_journal_entries
  for select to authenticated using (user_id = (select auth.uid()));
create policy master_journal_entries_insert_own on public.master_journal_entries
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy master_journal_entries_update_own on public.master_journal_entries
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy master_journal_entries_delete_own on public.master_journal_entries
  for delete to authenticated using (user_id = (select auth.uid()));

create or replace function public.master_journal_touch() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists master_journal_entries_touch on public.master_journal_entries;
create trigger master_journal_entries_touch before update on public.master_journal_entries
  for each row execute function public.master_journal_touch();

-- ---------------------------------------------------------------------------
-- Pensieve original dictation copies (PROPOSED, NOT APPLIED).
-- Audio stays in a PRIVATE Storage bucket, one folder per user:
--   journal-originals/<user id>/<entry id>.<ext>
-- The raw transcript and metadata live in this owner-only table.
create table if not exists public.master_journal_originals (
  entry_id uuid primary key references public.master_journal_entries(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  raw_transcript text not null default '' check (char_length(raw_transcript) <= 50000),
  audio_path text check (audio_path is null or audio_path like (user_id::text || '/%')),
  mime_type text not null default '' check (char_length(mime_type) <= 80),
  duration_ms integer not null default 0 check (duration_ms between 0 and 14400000),
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.master_journal_originals enable row level security;
alter table public.master_journal_originals force row level security;
revoke all on public.master_journal_originals from anon;
grant select, insert, update, delete on public.master_journal_originals to authenticated;

create policy master_journal_originals_own on public.master_journal_originals
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.master_journal_entries e
                where e.id = entry_id and e.user_id = (select auth.uid()))
  );

-- Per-user master profile settings (mirrors localStorage twgi-settings-v1:<user id>).
create table if not exists public.master_settings (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  settings jsonb not null default '{"v":1}'::jsonb check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 16384),
  updated_at timestamptz not null default now()
);
alter table public.master_settings enable row level security;
alter table public.master_settings force row level security;
revoke all on public.master_settings from anon;
grant select, insert, update on public.master_settings to authenticated;
create policy master_settings_own on public.master_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Private bucket for original audio (25 MB per file, audio only).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('journal-originals', 'journal-originals', false, 26214400,
        array['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/aac'])
on conflict (id) do nothing;

create policy journal_originals_owner_read on storage.objects
  for select to authenticated
  using (bucket_id = 'journal-originals' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy journal_originals_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'journal-originals' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy journal_originals_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'journal-originals' and (storage.foldername(name))[1] = (select auth.uid())::text);
