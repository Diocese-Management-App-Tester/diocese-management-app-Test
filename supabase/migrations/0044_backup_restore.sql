-- =====================================================================
-- 0044: BACKUP & RESTORE — النسخ الاحتياطي والاسترجاع
--
-- Settings → النشاط → «النسخ الاحتياطي والاسترجاع» (/settings/backup).
-- OWNER ONLY (or the service role from the scheduler route).
--
-- Everything is done through security-definer RPCs so the browser needs
-- no service key and RLS / statement limits never get in the way:
--
--   backup_tables()                       catalogue of every public table:
--                                         rows · pk · columns · FK parents
--   backup_dump_table(t, offset, limit)   one page of rows as jsonb (pk order)
--   backup_dump_auth_users()              login accounts of the servants
--                                         (id · email · password HASH · meta)
--
--   backup_restore_begin(mode, tables, meta)         → job id
--   backup_restore_stage(job, table, seq, rows)      stage one chunk
--   backup_restore_order(job)                        tables in FK order
--   backup_restore_delete_missing(job, table)        replace mode: rows not
--                                                    in the backup are removed
--   backup_restore_apply_chunk(job, table, seq)      upsert one chunk with the
--                                                    user triggers disabled
--   backup_restore_finish(job, status, error)        close the job
--
-- The restore is driven chunk by chunk from the client (progress bar,
-- every call well under the 8 s limit). Parents are always applied before
-- children (FK order from pg_constraint — no hard-coded list, new tables
-- are picked up automatically). Merge mode = upsert by primary key;
-- replace mode additionally deletes the rows the backup does not contain
-- (cascades follow the FK rules of the schema).
--
-- backup_schedules — النسخ المجدولة (daily / weekly / monthly at an hour,
--   Africa/Cairo), executed by /api/backup/cron (Vercel Cron) which stores
--   the file in the private `backups` bucket and prunes to keep_last.
-- backup_runs      — history (manual · scheduled · restore) with the file
--   path so scheduled files can be downloaded to the device later.
-- Idempotent.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Who may use the backup system
-- ---------------------------------------------------------------------
create or replace function public.backup_allowed()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.is_owner(), false)
      or coalesce(auth.role(), '') = 'service_role'
$$;
revoke all on function public.backup_allowed() from public;
grant execute on function public.backup_allowed() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table if not exists public.backup_schedules (
  id            uuid primary key default gen_random_uuid(),
  name          text not null default 'نسخة مجدولة',
  enabled       boolean not null default true,
  frequency     text not null default 'weekly' check (frequency in ('daily', 'weekly', 'monthly')),
  weekday       smallint not null default 0 check (weekday between 0 and 6),        -- 0 = Sunday (weekly)
  day_of_month  smallint not null default 1 check (day_of_month between 1 and 28),  -- monthly
  hour          smallint not null default 3 check (hour between 0 and 23),          -- Africa/Cairo
  tables        text[],                      -- null = every table
  include_auth  boolean not null default true,
  keep_last     integer not null default 10 check (keep_last between 1 and 100),
  last_run_at   timestamptz,
  last_status   text,
  next_run_at   timestamptz,
  created_by    uuid references public.servant_enrollments(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.backup_runs (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('manual', 'scheduled', 'restore')),
  schedule_id   uuid references public.backup_schedules(id) on delete set null,
  status        text not null default 'running' check (status in ('running', 'done', 'failed', 'partial')),
  mode          text check (mode in ('merge', 'replace')),           -- restore only
  tables        text[] not null default '{}',
  include_auth  boolean not null default false,
  row_counts    jsonb not null default '{}'::jsonb,                  -- {table: n}
  size_bytes    bigint,
  file_name     text,
  storage_path  text,                                                -- in bucket `backups` (null = downloaded only)
  error         text,
  created_by    uuid references public.servant_enrollments(id) on delete set null,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index if not exists idx_backup_runs_created on public.backup_runs (created_at desc);
create index if not exists idx_backup_runs_schedule on public.backup_runs (schedule_id, created_at desc);

-- staging for restores
create table if not exists public.backup_restore_jobs (
  id          uuid primary key default gen_random_uuid(),
  mode        text not null check (mode in ('merge', 'replace')),
  tables      text[] not null,
  meta        jsonb not null default '{}'::jsonb,   -- {columns: {table: [..]}, file: {...}}
  status      text not null default 'staging' check (status in ('staging', 'applying', 'done', 'failed')),
  result      jsonb not null default '{}'::jsonb,
  error       text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create table if not exists public.backup_restore_rows (
  job_id     uuid not null references public.backup_restore_jobs(id) on delete cascade,
  table_name text not null,
  seq        integer not null,
  rows       jsonb not null,
  applied    boolean not null default false,
  primary key (job_id, table_name, seq)
);
create table if not exists public.backup_restore_keys (
  job_id     uuid not null references public.backup_restore_jobs(id) on delete cascade,
  table_name text not null,
  key        text not null,
  primary key (job_id, table_name, key)
);

comment on table public.backup_schedules is 'النسخ الاحتياطية المجدولة — تُنفَّذ من /api/backup/cron وتُحفظ في bucket backups';
comment on table public.backup_runs is 'سجل النسخ الاحتياطية والاسترجاعات';
comment on table public.backup_restore_jobs is 'مرحلة الاسترجاع — الملف يُرفع على أجزاء ثم يُطبَّق جدولاً جدولاً';

-- RLS — owner only (the RPCs are security definer anyway)
alter table public.backup_schedules    enable row level security;
alter table public.backup_runs         enable row level security;
alter table public.backup_restore_jobs enable row level security;
alter table public.backup_restore_rows enable row level security;
alter table public.backup_restore_keys enable row level security;

drop policy if exists backup_schedules_owner on public.backup_schedules;
create policy backup_schedules_owner on public.backup_schedules for all
  using ((select public.is_owner())) with check ((select public.is_owner()));
drop policy if exists backup_runs_owner on public.backup_runs;
create policy backup_runs_owner on public.backup_runs for all
  using ((select public.is_owner())) with check ((select public.is_owner()));
drop policy if exists backup_restore_jobs_owner on public.backup_restore_jobs;
create policy backup_restore_jobs_owner on public.backup_restore_jobs for select
  using ((select public.is_owner()));
-- staging rows / keys: no direct access at all (RPC only)

-- touch updated_at + next_run_at
create or replace function public.backup_next_run(
  p_frequency text, p_weekday int, p_day_of_month int, p_hour int, p_from timestamptz default now()
) returns timestamptz language plpgsql stable as $$
declare
  tz constant text := 'Africa/Cairo';
  local_now timestamp := p_from at time zone tz;
  d date := local_now::date;
  candidate timestamp;
  i int;
begin
  if p_frequency = 'daily' then
    candidate := d + make_interval(hours => p_hour);
    if candidate <= local_now then candidate := candidate + interval '1 day'; end if;
  elsif p_frequency = 'weekly' then
    -- next date with extract(dow) = p_weekday (0 = Sunday) at p_hour
    for i in 0..7 loop
      candidate := (d + i) + make_interval(hours => p_hour);
      exit when extract(dow from (d + i))::int = p_weekday and candidate > local_now;
    end loop;
  else -- monthly
    candidate := make_timestamp(extract(year from d)::int, extract(month from d)::int, p_day_of_month, p_hour, 0, 0);
    if candidate <= local_now then
      candidate := (date_trunc('month', d) + interval '1 month')::date + (p_day_of_month - 1) + make_interval(hours => p_hour);
    end if;
  end if;
  return candidate at time zone tz;
end $$;

create or replace function public.touch_backup_schedule()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT'
     or new.next_run_at is null
     or new.frequency is distinct from old.frequency
     or new.weekday is distinct from old.weekday
     or new.day_of_month is distinct from old.day_of_month
     or new.hour is distinct from old.hour
     or (new.enabled and not old.enabled) then
    new.next_run_at := public.backup_next_run(new.frequency, new.weekday, new.day_of_month, new.hour, now());
  end if;
  return new;
end $$;
drop trigger if exists trg_touch_backup_schedule on public.backup_schedules;
create trigger trg_touch_backup_schedule before insert or update on public.backup_schedules
for each row execute function public.touch_backup_schedule();

-- realtime (history refreshes while a scheduled run finishes)
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'backup_runs') then
    alter publication supabase_realtime add table public.backup_runs;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'backup_schedules') then
    alter publication supabase_realtime add table public.backup_schedules;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Storage bucket (private) — scheduled files + optional manual copies
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('backups', 'backups', false)
on conflict (id) do nothing;

drop policy if exists "backups_owner_read"   on storage.objects;
drop policy if exists "backups_owner_write"  on storage.objects;
drop policy if exists "backups_owner_update" on storage.objects;
drop policy if exists "backups_owner_delete" on storage.objects;
create policy "backups_owner_read"   on storage.objects for select using (bucket_id = 'backups' and (select public.is_owner()));
create policy "backups_owner_write"  on storage.objects for insert with check (bucket_id = 'backups' and (select public.is_owner()));
create policy "backups_owner_update" on storage.objects for update using (bucket_id = 'backups' and (select public.is_owner()));
create policy "backups_owner_delete" on storage.objects for delete using (bucket_id = 'backups' and (select public.is_owner()));

-- ---------------------------------------------------------------------
-- 3. Catalogue helpers
-- ---------------------------------------------------------------------
-- Is `t` a public base table that may be backed up? (internal staging
-- tables and the profiles VIEW are excluded)
create or replace function public.backup_is_table(t text)
returns boolean language sql stable as $$
  select exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname = t
       and c.relname not like 'backup\_restore\_%'
  )
$$;

-- primary-key columns in order
create or replace function public.backup_pk_columns(t text)
returns text[] language sql stable as $$
  select coalesce(array_agg(a.attname::text order by k.ord), '{}')
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral unnest(i.indkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
   where n.nspname = 'public' and c.relname = t and i.indisprimary
$$;

-- insertable (non-generated, non-dropped) columns in order
create or replace function public.backup_columns(t text)
returns text[] language sql stable as $$
  select coalesce(array_agg(a.attname::text order by a.attnum), '{}')
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = t
     and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
$$;

-- FK parents inside public (self references ignored)
create or replace function public.backup_parents(t text)
returns text[] language sql stable as $$
  select coalesce(array_agg(distinct p.relname::text), '{}')
    from pg_constraint f
    join pg_class c on c.oid = f.conrelid
    join pg_class p on p.oid = f.confrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_namespace pn on pn.oid = p.relnamespace
   where f.contype = 'f' and n.nspname = 'public' and pn.nspname = 'public'
     and c.relname = t and p.relname <> t
$$;

-- Kahn order for a set of tables (parents first). Tables outside the set
-- are ignored (they must already exist in the database).
create or replace function public.backup_topo_order(p_tables text[])
returns text[] language plpgsql stable as $$
declare
  remaining text[] := (select coalesce(array_agg(distinct x order by x), '{}') from unnest(p_tables) x);
  ordered   text[] := '{}';
  t text; progressed boolean;
begin
  while cardinality(remaining) > 0 loop
    progressed := false;
    foreach t in array remaining loop
      -- every parent that is in the set must already be ordered
      if not exists (
        select 1 from unnest(public.backup_parents(t)) p
         where p = any(remaining) and not (p = any(ordered))
      ) then
        ordered := ordered || t;
        remaining := array_remove(remaining, t);
        progressed := true;
      end if;
    end loop;
    if not progressed then          -- cycle: append the rest as-is
      ordered := ordered || remaining;
      exit;
    end if;
  end loop;
  return ordered;
end $$;

-- ---------------------------------------------------------------------
-- 4. Catalogue + dump
-- ---------------------------------------------------------------------
create or replace function public.backup_tables()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  out jsonb := '[]'::jsonb;
  r record; n bigint;
begin
  if not public.backup_allowed() then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  for r in
    select c.relname::text as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and c.relname not like 'backup\_restore\_%'
     order by c.relname
  loop
    execute format('select count(*) from public.%I', r.name) into n;
    out := out || jsonb_build_object(
      'name', r.name,
      'rows', n,
      'pk', to_jsonb(public.backup_pk_columns(r.name)),
      'columns', to_jsonb(public.backup_columns(r.name)),
      'parents', to_jsonb(public.backup_parents(r.name))
    );
  end loop;
  return out;
end $$;
revoke all on function public.backup_tables() from public;
grant execute on function public.backup_tables() to authenticated, service_role;

create or replace function public.backup_dump_table(p_table text, p_offset integer default 0, p_limit integer default 1000)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  pk text[]; ord text; out jsonb;
begin
  if not public.backup_allowed() then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  if not public.backup_is_table(p_table) then raise exception 'unknown_table' using errcode = 'P0001'; end if;
  pk := public.backup_pk_columns(p_table);
  select string_agg(format('%I', c), ', ') into ord from unnest(pk) c;
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (select * from public.%I order by %s offset %s limit %s) t',
    p_table, coalesce(ord, '1'), greatest(p_offset, 0), least(greatest(p_limit, 1), 2000)
  ) into out;
  return out;
end $$;
revoke all on function public.backup_dump_table(text, integer, integer) from public;
grant execute on function public.backup_dump_table(text, integer, integer) to authenticated, service_role;

-- Servant login accounts. Only the columns the Admin API can re-create:
-- id · email · phone · encrypted_password (bcrypt hash) · metadata ·
-- email_confirmed_at · created_at. Only accounts that ARE servants.
create or replace function public.backup_dump_auth_users()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if not public.backup_allowed() then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', u.id,
             'email', j->>'email',
             'phone', j->>'phone',
             'encrypted_password', j->>'encrypted_password',
             'email_confirmed_at', j->>'email_confirmed_at',
             'raw_user_meta_data', coalesce(j->'raw_user_meta_data', '{}'::jsonb),
             'raw_app_meta_data', coalesce(j->'raw_app_meta_data', '{}'::jsonb),
             'created_at', j->>'created_at'
           ) order by j->>'created_at'), '[]'::jsonb)
    into out
    from auth.users u
    cross join lateral to_jsonb(u) j
   where exists (select 1 from public.servant_enrollments s where s.id = u.id);
  return out;
end $$;
revoke all on function public.backup_dump_auth_users() from public;
grant execute on function public.backup_dump_auth_users() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Restore — staged, chunked, FK ordered
-- ---------------------------------------------------------------------
create or replace function public.backup_restore_begin(p_mode text, p_tables text[], p_meta jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare jid uuid; t text; bad text[] := '{}';
begin
  if not public.backup_allowed() then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  if p_mode not in ('merge', 'replace') then raise exception 'bad_mode' using errcode = 'P0001'; end if;
  if p_tables is null or cardinality(p_tables) = 0 then raise exception 'no_tables' using errcode = 'P0001'; end if;
  foreach t in array p_tables loop
    if not public.backup_is_table(t) then bad := bad || t; end if;
  end loop;
  if cardinality(bad) > 0 then
    raise exception 'unknown_table:%', array_to_string(bad, ',') using errcode = 'P0001';
  end if;
  -- forget stale jobs of the same caller (abandoned uploads)
  delete from public.backup_restore_jobs
   where status = 'staging' and created_at < now() - interval '6 hours';
  insert into public.backup_restore_jobs (mode, tables, meta, created_by)
  values (p_mode, public.backup_topo_order(p_tables), coalesce(p_meta, '{}'::jsonb), auth.uid())
  returning id into jid;
  return jid;
end $$;
revoke all on function public.backup_restore_begin(text, text[], jsonb) from public;
grant execute on function public.backup_restore_begin(text, text[], jsonb) to authenticated, service_role;

create or replace function public.backup_restore_stage(p_job uuid, p_table text, p_seq integer, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare j public.backup_restore_jobs; pk text[]; n integer;
begin
  if not public.backup_allowed() then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  select * into j from public.backup_restore_jobs where id = p_job for update;
  if j.id is null then raise exception 'job_not_found' using errcode = 'P0001'; end if;
  if j.status <> 'staging' then raise exception 'job_not_staging' using errcode = 'P0001'; end if;
  if not (p_table = any(j.tables)) then raise exception 'table_not_in_job' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows_not_array' using errcode = 'P0001'; end if;

  insert into public.backup_restore_rows (job_id, table_name, seq, rows)
  values (p_job, p_table, p_seq, p_rows)
  on conflict (job_id, table_name, seq) do update set rows = excluded.rows, applied = false;

  -- pk keys (for replace mode's delete-missing)
  pk := public.backup_pk_columns(p_table);
  insert into public.backup_restore_keys (job_id, table_name, key)
  select p_job, p_table, k
    from (
      select string_agg(coalesce(r->>c, ''), '|' order by ord) as k
        from jsonb_array_elements(p_rows) with ordinality as e(r, i)
        cross join lateral unnest(pk) with ordinality as pc(c, ord)
       group by i
    ) s
  on conflict do nothing;

  n := jsonb_array_length(p_rows);
  return n;
end $$;
revoke all on function public.backup_restore_stage(uuid, text, integer, jsonb) from public;
grant execute on function public.backup_restore_stage(uuid, text, integer, jsonb) to authenticated, service_role;

-- tables of the job in FK order (parents first) + chunk counts
create or replace function public.backup_restore_order(p_job uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j public.backup_restore_jobs; out jsonb := '[]'::jsonb; t text; c integer; n bigint;
begin
  if not public.backup_allowed() then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  select * into j from public.backup_restore_jobs where id = p_job;
  if j.id is null then raise exception 'job_not_found' using errcode = 'P0001'; end if;
  update public.backup_restore_jobs set status = 'applying' where id = p_job and status = 'staging';
  foreach t in array j.tables loop
    select count(*), coalesce(sum(jsonb_array_length(rows)), 0) into c, n
      from public.backup_restore_rows where job_id = p_job and table_name = t;
    out := out || jsonb_build_object('table', t, 'chunks', c, 'rows', n,
                                     'seqs', (select coalesce(jsonb_agg(seq order by seq), '[]'::jsonb)
                                                from public.backup_restore_rows where job_id = p_job and table_name = t));
  end loop;
  return out;
end $$;
revoke all on function public.backup_restore_order(uuid) from public;
grant execute on function public.backup_restore_order(uuid) to authenticated, service_role;

-- REPLACE mode: remove the rows the backup does not contain. Call in
-- REVERSE FK order (children first) before applying any chunk.
create or replace function public.backup_restore_delete_missing(p_job uuid, p_table text)
returns integer language plpgsql security definer set search_path = public as $$
declare j public.backup_restore_jobs; pk text[]; keyexpr text; n integer;
begin
  if not public.backup_allowed() then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  select * into j from public.backup_restore_jobs where id = p_job;
  if j.id is null then raise exception 'job_not_found' using errcode = 'P0001'; end if;
  if j.mode <> 'replace' then return 0; end if;
  if not (p_table = any(j.tables)) then raise exception 'table_not_in_job' using errcode = 'P0001'; end if;
  pk := public.backup_pk_columns(p_table);
  if cardinality(pk) = 0 then return 0; end if;
  select string_agg(format('coalesce(t.%I::text, '''')', c), ' || ''|'' || ' order by ord)
    into keyexpr from unnest(pk) with ordinality as pc(c, ord);

  execute format('alter table public.%I disable trigger user', p_table);
  execute format(
    'delete from public.%I t where not exists (select 1 from public.backup_restore_keys k where k.job_id = $1 and k.table_name = $2 and k.key = %s)',
    p_table, keyexpr) using p_job, p_table;
  get diagnostics n = row_count;
  execute format('alter table public.%I enable trigger user', p_table);

  update public.backup_restore_jobs
     set result = jsonb_set(result, array[p_table, 'deleted'], to_jsonb(n), true)
   where id = p_job;
  return n;
end $$;
revoke all on function public.backup_restore_delete_missing(uuid, text) from public;
grant execute on function public.backup_restore_delete_missing(uuid, text) to authenticated, service_role;

-- Upsert one staged chunk. Columns = (columns in the backup) ∩ (current
-- insertable columns) — a column added by a later migration keeps its
-- default, a column removed since is ignored.
create or replace function public.backup_restore_apply_chunk(p_job uuid, p_table text, p_seq integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  j public.backup_restore_jobs; chunk jsonb; pk text[]; cols text[]; backup_cols text[];
  col_list text; set_list text; pk_list text; n integer;
begin
  if not public.backup_allowed() then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  select * into j from public.backup_restore_jobs where id = p_job;
  if j.id is null then raise exception 'job_not_found' using errcode = 'P0001'; end if;
  if j.status not in ('staging', 'applying') then raise exception 'job_closed' using errcode = 'P0001'; end if;
  if not (p_table = any(j.tables)) then raise exception 'table_not_in_job' using errcode = 'P0001'; end if;

  select rows into chunk from public.backup_restore_rows
   where job_id = p_job and table_name = p_table and seq = p_seq for update;
  if chunk is null then raise exception 'chunk_not_found' using errcode = 'P0001'; end if;
  if jsonb_array_length(chunk) = 0 then return 0; end if;

  pk := public.backup_pk_columns(p_table);
  cols := public.backup_columns(p_table);
  -- columns known to the backup file (fallback: keys of the first row)
  select coalesce(array_agg(x), '{}') into backup_cols
    from jsonb_array_elements_text(coalesce(j.meta->'columns'->p_table, (select jsonb_agg(k) from jsonb_object_keys(chunk->0) k))) x;
  cols := (select coalesce(array_agg(c order by ord), '{}') from unnest(cols) with ordinality as cc(c, ord) where c = any(backup_cols));
  if cardinality(cols) = 0 then raise exception 'no_columns' using errcode = 'P0001'; end if;

  select string_agg(format('%I', c), ', ') into col_list from unnest(cols) c;
  select string_agg(format('%I', c), ', ') into pk_list  from unnest(pk) c;
  select string_agg(format('%1$I = excluded.%1$I', c), ', ') into set_list
    from unnest(cols) c where not (c = any(pk));

  execute format('alter table public.%I disable trigger user', p_table);
  if pk_list is null then
    execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, $1)',
                   p_table, col_list) using chunk;
  elsif set_list is null then
    execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, $1) on conflict (%3$s) do nothing',
                   p_table, col_list, pk_list) using chunk;
  else
    execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, $1) on conflict (%3$s) do update set %4$s',
                   p_table, col_list, pk_list, set_list) using chunk;
  end if;
  get diagnostics n = row_count;
  execute format('alter table public.%I enable trigger user', p_table);

  update public.backup_restore_rows set applied = true
   where job_id = p_job and table_name = p_table and seq = p_seq;
  update public.backup_restore_jobs
     set result = jsonb_set(result, array[p_table, 'upserted'],
                            to_jsonb(coalesce((result->p_table->>'upserted')::int, 0) + n), true)
   where id = p_job;
  return n;
end $$;
revoke all on function public.backup_restore_apply_chunk(uuid, text, integer) from public;
grant execute on function public.backup_restore_apply_chunk(uuid, text, integer) to authenticated, service_role;

create or replace function public.backup_restore_finish(p_job uuid, p_status text, p_error text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j public.backup_restore_jobs;
begin
  if not public.backup_allowed() then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  if p_status not in ('done', 'failed') then raise exception 'bad_status' using errcode = 'P0001'; end if;
  update public.backup_restore_jobs
     set status = p_status, error = p_error, finished_at = now()
   where id = p_job
  returning * into j;
  if j.id is null then raise exception 'job_not_found' using errcode = 'P0001'; end if;
  -- staged data is no longer needed
  delete from public.backup_restore_rows where job_id = p_job;
  delete from public.backup_restore_keys where job_id = p_job;
  return jsonb_build_object('id', j.id, 'status', j.status, 'result', j.result, 'tables', to_jsonb(j.tables));
end $$;
revoke all on function public.backup_restore_finish(uuid, text, text) from public;
grant execute on function public.backup_restore_finish(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. Schedules due for the cron route (service role)
-- ---------------------------------------------------------------------
create or replace function public.backup_schedules_due()
returns setof public.backup_schedules language sql stable security definer set search_path = public as $$
  select * from public.backup_schedules
   where public.backup_allowed() and enabled and next_run_at is not null and next_run_at <= now()
   order by next_run_at
$$;
revoke all on function public.backup_schedules_due() from public;
grant execute on function public.backup_schedules_due() to authenticated, service_role;

-- after a scheduled run: stamp + move on
create or replace function public.backup_schedule_ran(p_schedule uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare s public.backup_schedules;
begin
  if not public.backup_allowed() then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  select * into s from public.backup_schedules where id = p_schedule;
  if s.id is null then return; end if;
  update public.backup_schedules
     set last_run_at = now(), last_status = p_status,
         next_run_at = public.backup_next_run(s.frequency, s.weekday, s.day_of_month, s.hour, now())
   where id = p_schedule;
end $$;
revoke all on function public.backup_schedule_ran(uuid, text) from public;
grant execute on function public.backup_schedule_ran(uuid, text) to authenticated, service_role;

-- grants on the tables (RLS still applies for authenticated)
grant select, insert, update, delete on public.backup_schedules, public.backup_runs to authenticated, service_role;
grant select on public.backup_restore_jobs to authenticated, service_role;

commit;
