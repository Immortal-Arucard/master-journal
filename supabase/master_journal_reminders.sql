-- Journal v6: per-note reminders.
-- NEW FILE. NOT APPLIED. Apply ONCE, by the database owner, in the Supabase
-- SQL editor, AFTER master_journal_sync.sql (already applied) and
-- twgi_push.sql (already applied). Never apply it twice. It does not change
-- or re-run master_journal_sync.sql, and it does not touch the twgi_push tables.
--
-- 1. Adds an optional column `reminder` (small JSON) to each journal entry,
--    so a note's reminder syncs across the owner's devices exactly like the
--    note itself (same owner-only row level security, newest edit wins).
-- 2. Adds public.master_journal_reminders(uuid[]): the push Worker (role
--    twgi_push_server) reads ONLY each switched-on reminder's entry id,
--    reminder JSON and edit time. Never the note's title or text. Browsers
--    (anon, authenticated) cannot call it.

begin;

-- The reader function runs as its owner and the entries table forces row
-- level security, so the owner must bypass RLS (Supabase's postgres role does).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = current_user and (rolbypassrls or rolsuper)) then
    raise exception 'Apply this file as the postgres role (it needs BYPASSRLS).';
  end if;
end $$;

alter table public.master_journal_entries
  add column reminder jsonb
  check (reminder is null or (jsonb_typeof(reminder) = 'object' and pg_column_size(reminder) <= 2000));

create index master_journal_entries_reminders on public.master_journal_entries (user_id)
  where reminder is not null and not deleted;

create function public.master_journal_reminders(p_users uuid[])
returns table (user_id uuid, id text, reminder jsonb, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select e.user_id, e.id, e.reminder, e.updated_at
  from public.master_journal_entries e
  where e.user_id = any (p_users)
    and e.reminder is not null
    and not e.deleted
    and e.reminder -> 'on' = 'true'::jsonb
  order by e.user_id, e.id
  limit 5000;
$$;

revoke all on function public.master_journal_reminders(uuid[]) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'twgi_push_server') then
    grant execute on function public.master_journal_reminders(uuid[]) to twgi_push_server;
  end if;
end $$;

-- Let the Data API see the new column right away.
notify pgrst, 'reload schema';

commit;
