-- Journal cloud sync across devices (Journal v4).
-- NEW FILE. NOT APPLIED. Apply ONCE, by the database owner, in the Supabase
-- SQL editor. Never apply it twice. It does not touch any existing table.
--
-- This REPLACES the old proposal supabase/master_journal.sql for now: do not
-- apply that file. Changes from it: entry ids are text (the app makes them),
-- deletions are tombstones, a newest-wins trigger, synced_at for "what
-- changed since", Realtime, no DELETE grant. The Pensieve original copies
-- table and the journal-originals Storage bucket are left out: recordings
-- stay on the device that made them.
--
-- Model
--   master_journal_entries  one row per entry per account (title, text,
--                           entry date and time). A deleted entry stays as an
--                           empty tombstone (deleted = true, title = body = '')
--                           so an older copy elsewhere cannot bring it back.
--   master_settings         one row per account: the app settings object
--                           (same format as localStorage twgi-settings-v1).
--
-- Rules
--   Owner only ((select auth.uid()) policies), row level security forced, no
--   access for anon, no DELETE grant. The trigger ignores a write whose
--   updated_at is older than the stored row and stamps synced_at = now().
--   Both tables join the supabase_realtime publication (same RLS applies).

begin;

create table public.master_journal_entries (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 80),
  title text not null default '' check (char_length(title) <= 160),
  body text not null default '' check (char_length(body) <= 20000),
  entry_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  primary key (user_id, id),
  check (
    (deleted and title = '' and body = '')
    or (not deleted and (char_length(title) > 0 or char_length(body) > 0))
  )
);
create index master_journal_entries_user_synced on public.master_journal_entries (user_id, synced_at);

create table public.master_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  settings jsonb not null default '{"v":1}'::jsonb check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 16384),
  updated_at timestamptz not null default now(),
  synced_at timestamptz not null default now()
);

create function public.master_sync_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.updated_at < old.updated_at then
      return null; -- an older copy: keep the newer row that is already stored
    end if;
    new.user_id := old.user_id;
  end if;
  new.synced_at := now();
  return new;
end;
$$;

create trigger master_journal_entries_stamp before insert or update on public.master_journal_entries
  for each row execute function public.master_sync_stamp();
create trigger master_settings_stamp before insert or update on public.master_settings
  for each row execute function public.master_sync_stamp();

alter table public.master_journal_entries enable row level security;
alter table public.master_journal_entries force row level security;
alter table public.master_settings enable row level security;
alter table public.master_settings force row level security;

revoke all on public.master_journal_entries, public.master_settings from public, anon, authenticated;
grant select, insert, update on public.master_journal_entries, public.master_settings to authenticated;

create policy master_journal_entries_select_own on public.master_journal_entries
  for select to authenticated using (user_id = (select auth.uid()));
create policy master_journal_entries_insert_own on public.master_journal_entries
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy master_journal_entries_update_own on public.master_journal_entries
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy master_settings_select_own on public.master_settings
  for select to authenticated using (user_id = (select auth.uid()));
create policy master_settings_insert_own on public.master_settings
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy master_settings_update_own on public.master_settings
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on function public.master_sync_stamp() from public, anon, authenticated;

alter publication supabase_realtime add table public.master_journal_entries, public.master_settings;

commit;
