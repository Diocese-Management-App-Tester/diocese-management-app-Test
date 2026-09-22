-- =====================================================================
-- 20260922120000: BACKUP RESTORE — FK cycles, deferred references,
--                 login accounts first
--
-- BUG (production): restoring a backup failed with
--   insert or update on table "app_settings" violates foreign key
--   constraint "app_settings_updated_by_fkey"
--
-- WHY: the schema has an FK CYCLE
--   persons.created_by / edited_by  → servant_enrollments
--   servant_enrollments.person_id   → persons
--   servant_enrollments.approved_by → servant_enrollments (self)
-- backup_topo_order() (0044) stopped at the first cycle and appended the
-- WHOLE remainder alphabetically, so app_settings (and ~55 other tables
-- that point at servant_enrollments) were applied BEFORE the servants.
-- Two more holes: servant_enrollments.id → auth.users, but the client
-- restored the login accounts LAST; and an audit column (updated_by …)
-- pointing at a servant that no longer exists (e.g. the owner got a new
-- id after a reset) aborted the whole restore.
--
-- FIX:
--   * backup_fk_edges(t)         — every FK of a table: column, parent
--                                  (schema-qualified), parent column,
--                                  nullable, on-delete rule
--   * backup_topo_order(tables)  — cycle-aware Kahn: when stuck, take the
--                                  table whose NOT NULL parents are all
--                                  ordered (its nullable refs are deferred)
--   * backup_restore_apply_chunk — TWO-PHASE: a nullable FK value whose
--                                  parent row does not exist yet is
--                                  inserted as NULL and remembered in
--                                  backup_restore_fixups; a row whose
--                                  NOT NULL parent lives outside public
--                                  (auth.users) and is missing is SKIPPED
--                                  and reported instead of aborting
--   * backup_restore_fixup(job)  — after every chunk: re-attach the
--                                  deferred references whose parent now
--                                  exists; the rest is reported as
--                                  «unresolved» (value stays NULL)
--   * backup_restore_delete_missing — replace mode: nullable references
--                                  (NO ACTION / RESTRICT) to the rows
--                                  about to be deleted are detached first
--                                  so a cycle cannot block the delete
--   * result per table: upserted · deleted · deferred · resolved ·
--                       unresolved (+ samples) · skipped (+ samples)
-- Client (src/lib/backup.ts) now restores the login accounts FIRST and
-- calls backup_restore_fixup before backup_restore_finish.
-- Idempotent. Depends on 0044.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Staging table for deferred references
-- ---------------------------------------------------------------------
create table if not exists public.backup_restore_fixups (
  job_id      uuid  not null references public.backup_restore_jobs(id) on delete cascade,
  table_name  text  not null,
  column_name text  not null,
  pk          jsonb not null,           -- {pkcol: value, …} of the child row
  value       jsonb not null,           -- the original FK value
  primary key (job_id, table_name, column_name, pk)
);
alter table public.backup_restore_fixups enable row level security;
comment on table public.backup_restore_fixups is
  'مرحلة الاسترجاع — مراجع (FK) اختيارية أُدخلت NULL لأن الصف الأب لم يكن موجودًا بعد؛ تُعاد بعد تطبيق كل الجداول';

-- ---------------------------------------------------------------------
-- 2. FK catalogue
-- ---------------------------------------------------------------------
-- Every single-column FK of a public table (multi-column FKs are rare and
-- returned with column = null so callers can ignore them).
create or replace function public.backup_fk_edges(t text)
returns table (
  column_name   text,
  column_type   text,
  nullable      boolean,
  parent_schema text,
  parent_table  text,
  parent_column text,
  on_delete     "char",
  constraint_name text
) language sql stable as $$
  select case when array_length(f.conkey, 1) = 1 then a.attname::text end,
         format_type(a.atttypid, a.atttypmod),
         not a.attnotnull,
         pn.nspname::text,
         p.relname::text,
         case when array_length(f.confkey, 1) = 1 then pa.attname::text end,
         f.confdeltype,
         f.conname::text
    from pg_constraint f
    join pg_class c on c.oid = f.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_class p on p.oid = f.confrelid
    join pg_namespace pn on pn.oid = p.relnamespace
    left join pg_attribute a  on a.attrelid  = c.oid and a.attnum  = f.conkey[1]  and array_length(f.conkey, 1) = 1
    left join pg_attribute pa on pa.attrelid = p.oid and pa.attnum = f.confkey[1] and array_length(f.confkey, 1) = 1
   where f.contype = 'f' and n.nspname = 'public' and c.relname = t
$$;

-- parents reached through at least one NOT NULL column (these cannot be
-- deferred — the parent MUST be applied first)
create or replace function public.backup_parents_required(t text)
returns text[] language sql stable as $$
  select coalesce(array_agg(distinct p.relname::text), '{}')
    from pg_constraint f
    join pg_class c on c.oid = f.conrelid
    join pg_class p on p.oid = f.confrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_namespace pn on pn.oid = p.relnamespace
   where f.contype = 'f' and n.nspname = 'public' and pn.nspname = 'public'
     and c.relname = t and p.relname <> t
     and exists (select 1 from unnest(f.conkey) k
                 join pg_attribute a on a.attrelid = c.oid and a.attnum = k
                 where a.attnotnull)
$$;

-- Cycle-aware Kahn order (parents first). When no table is free, the one
-- whose REQUIRED parents are all ordered is taken (fewest pending
-- nullable parents first, then by name) — its nullable references are
-- deferred by backup_restore_apply_chunk. Only a NOT NULL cycle (which
-- could never be inserted anyway) falls back to «the rest as-is».
create or replace function public.backup_topo_order(p_tables text[])
returns text[] language plpgsql stable as $$
declare
  remaining text[] := (select coalesce(array_agg(distinct x order by x), '{}') from unnest(p_tables) x);
  ordered   text[] := '{}';
  t text; progressed boolean; pick text;
begin
  while cardinality(remaining) > 0 loop
    progressed := false;
    foreach t in array remaining loop
      if not exists (
        select 1 from unnest(public.backup_parents(t)) p
         where p = any(remaining) and not (p = any(ordered))
      ) then
        ordered := ordered || t;
        remaining := array_remove(remaining, t);
        progressed := true;
      end if;
    end loop;
    if not progressed then
      select r into pick
        from unnest(remaining) r
       where not exists (select 1 from unnest(public.backup_parents_required(r)) p
                          where p = any(remaining) and not (p = any(ordered)))
       order by (select count(*) from unnest(public.backup_parents(r)) p
                  where p = any(remaining) and not (p = any(ordered))),          -- fewest deferred refs
                (select count(*) from unnest(remaining) c
                  where c <> r and r = any(public.backup_parents(c))) desc,      -- unblocks the most tables
                r
       limit 1;
      if pick is null then           -- NOT NULL cycle: append the rest as-is
        ordered := ordered || remaining;
        exit;
      end if;
      ordered := ordered || pick;
      remaining := array_remove(remaining, pick);
    end if;
  end loop;
  return ordered;
end $$;

-- ---------------------------------------------------------------------
-- 3. Apply one chunk — two-phase
-- ---------------------------------------------------------------------
create or replace function public.backup_restore_apply_chunk(p_job uuid, p_table text, p_seq integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  j public.backup_restore_jobs; chunk jsonb; pk text[]; cols text[]; backup_cols text[];
  col_list text; sel_exprs text[]; sel_list text; set_list text; pk_list text; pk_json text; n integer; pos integer;
  e record; where_skip text := ''; deferred integer := 0; skipped integer := 0; skip_samples jsonb := '[]'::jsonb;
  tbl_result jsonb;
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
  select coalesce(array_agg(x), '{}') into backup_cols
    from jsonb_array_elements_text(coalesce(j.meta->'columns'->p_table, (select jsonb_agg(k) from jsonb_object_keys(chunk->0) k))) x;
  cols := (select coalesce(array_agg(c order by ord), '{}') from unnest(cols) with ordinality as cc(c, ord) where c = any(backup_cols));
  if cardinality(cols) = 0 then raise exception 'no_columns' using errcode = 'P0001'; end if;

  select string_agg(format('%I', c), ', ') into col_list from unnest(cols) c;
  select coalesce(array_agg(format('r.%I', c) order by ord), '{}') into sel_exprs from unnest(cols) with ordinality as cc(c, ord);
  select string_agg(format('%I', c), ', ') into pk_list  from unnest(pk) c;
  select string_agg(format('%L, r.%I', c, c), ', ') into pk_json from unnest(pk) c;
  select string_agg(format('%1$I = excluded.%1$I', c), ', ') into set_list
    from unnest(cols) c where not (c = any(pk));

  -- FK handling, column by column
  for e in select * from public.backup_fk_edges(p_table)
            where column_name is not null and parent_column is not null and column_name = any(cols)
  loop
    if e.nullable and pk_list is not null and not (e.column_name = any(pk)) then
      -- DEFER: value → NULL when the parent row is not there yet; remember it
      execute format(
        'insert into public.backup_restore_fixups (job_id, table_name, column_name, pk, value)
           select $1, $2, %1$L, jsonb_build_object(%2$s), to_jsonb(r.%3$I)
             from jsonb_populate_recordset(null::public.%4$I, $3) r
            where r.%3$I is not null
              and not exists (select 1 from %5$I.%6$I p where p.%7$I = r.%3$I)
         on conflict do nothing',
        e.column_name, pk_json, e.column_name, p_table, e.parent_schema, e.parent_table, e.parent_column)
        using p_job, p_table, chunk;
      get diagnostics n = row_count;
      deferred := deferred + n;
      pos := array_position(cols, e.column_name);
      sel_exprs[pos] := format('(case when exists (select 1 from %I.%I p where p.%I = r.%I) then r.%I else null end)',
                               e.parent_schema, e.parent_table, e.parent_column, e.column_name, e.column_name);
    elsif not e.nullable and e.parent_schema <> 'public' then
      -- e.g. servant_enrollments.id → auth.users: the account must exist.
      -- Rows without it are skipped (reported), never abort the restore.
      execute format(
        'select count(*), coalesce(jsonb_agg(to_jsonb(r.%1$I)) filter (where rn <= 5), ''[]''::jsonb)
           from (select r.*, row_number() over () rn
                   from jsonb_populate_recordset(null::public.%2$I, $1) r
                  where not exists (select 1 from %3$I.%4$I p where p.%5$I = r.%1$I)) r',
        e.column_name, p_table, e.parent_schema, e.parent_table, e.parent_column)
        into n, skip_samples using chunk;
      if n > 0 then
        skipped := skipped + n;
        where_skip := where_skip || format(' and exists (select 1 from %I.%I p where p.%I = r.%I)',
                                           e.parent_schema, e.parent_table, e.parent_column, e.column_name);
      end if;
    end if;
  end loop;

  sel_list := array_to_string(sel_exprs, ', ');
  execute format('alter table public.%I disable trigger user', p_table);
  if pk_list is null then
    execute format('insert into public.%1$I (%2$s) select %3$s from jsonb_populate_recordset(null::public.%1$I, $1) r where true %4$s',
                   p_table, col_list, sel_list, where_skip) using chunk;
  elsif set_list is null then
    execute format('insert into public.%1$I (%2$s) select %3$s from jsonb_populate_recordset(null::public.%1$I, $1) r where true %5$s on conflict (%4$s) do nothing',
                   p_table, col_list, sel_list, pk_list, where_skip) using chunk;
  else
    execute format('insert into public.%1$I (%2$s) select %3$s from jsonb_populate_recordset(null::public.%1$I, $1) r where true %6$s on conflict (%4$s) do update set %5$s',
                   p_table, col_list, sel_list, pk_list, set_list, where_skip) using chunk;
  end if;
  get diagnostics n = row_count;
  execute format('alter table public.%I enable trigger user', p_table);

  update public.backup_restore_rows set applied = true
   where job_id = p_job and table_name = p_table and seq = p_seq;

  select coalesce(result->p_table, '{}'::jsonb) into tbl_result from public.backup_restore_jobs where id = p_job;
  tbl_result := tbl_result
    || jsonb_build_object('upserted', coalesce((tbl_result->>'upserted')::int, 0) + n)
    || jsonb_build_object('deferred', coalesce((tbl_result->>'deferred')::int, 0) + deferred)
    || jsonb_build_object('skipped',  coalesce((tbl_result->>'skipped')::int, 0) + skipped);
  if skipped > 0 then
    tbl_result := tbl_result || jsonb_build_object('skipped_samples',
      (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
         select x from jsonb_array_elements(coalesce(tbl_result->'skipped_samples', '[]'::jsonb) || skip_samples) x limit 5) s));
  end if;
  update public.backup_restore_jobs set result = jsonb_set(result, array[p_table], tbl_result, true) where id = p_job;
  return n;
end $$;
revoke all on function public.backup_restore_apply_chunk(uuid, text, integer) from public;
grant execute on function public.backup_restore_apply_chunk(uuid, text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Re-attach the deferred references (call once after every chunk)
-- ---------------------------------------------------------------------
create or replace function public.backup_restore_fixup(p_job uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  j public.backup_restore_jobs; r record; e record; pk text[]; pk_match text; n integer;
  out jsonb := '{}'::jsonb; tbl_result jsonb; resolved integer; unresolved integer; samples jsonb;
begin
  if not public.backup_allowed() then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  select * into j from public.backup_restore_jobs where id = p_job;
  if j.id is null then raise exception 'job_not_found' using errcode = 'P0001'; end if;
  if j.status not in ('staging', 'applying') then raise exception 'job_closed' using errcode = 'P0001'; end if;

  for r in select distinct table_name from public.backup_restore_fixups where job_id = p_job order by 1 loop
    pk := public.backup_pk_columns(r.table_name);
    select string_agg(format('%L, x.%I', c, c), ', ') into pk_match from unnest(pk) c;
    resolved := 0;
    execute format('alter table public.%I disable trigger user', r.table_name);
    for e in select f.column_name, f.column_type, f.parent_schema, f.parent_table, f.parent_column
               from public.backup_fk_edges(r.table_name) f
              where f.column_name in (select distinct column_name from public.backup_restore_fixups
                                       where job_id = p_job and table_name = r.table_name)
    loop
      execute format(
        'update public.%1$I x set %2$I = (f.value #>> ''{}'')::%3$s
           from public.backup_restore_fixups f
          where f.job_id = $1 and f.table_name = $2 and f.column_name = %2$L
            and jsonb_build_object(%4$s) = f.pk
            and exists (select 1 from %5$I.%6$I p where p.%7$I = (f.value #>> ''{}'')::%3$s)',
        r.table_name, e.column_name, e.column_type, pk_match, e.parent_schema, e.parent_table, e.parent_column)
        using p_job, r.table_name;
      get diagnostics n = row_count;
      resolved := resolved + n;
      execute format(
        'delete from public.backup_restore_fixups f
          where f.job_id = $1 and f.table_name = $2 and f.column_name = %1$L
            and exists (select 1 from %2$I.%3$I p where p.%4$I = (f.value #>> ''{}'')::%5$s)',
        e.column_name, e.parent_schema, e.parent_table, e.parent_column, e.column_type)
        using p_job, r.table_name;
    end loop;
    execute format('alter table public.%I enable trigger user', r.table_name);

    select count(*), coalesce(jsonb_agg(jsonb_build_object('pk', s.pk, 'column', s.column_name, 'value', s.value)) filter (where s.rn <= 5), '[]'::jsonb)
      into unresolved, samples
      from (select f.pk, f.column_name, f.value, row_number() over (order by f.column_name, f.pk) rn
              from public.backup_restore_fixups f where f.job_id = p_job and f.table_name = r.table_name) s;

    select coalesce(result->r.table_name, '{}'::jsonb) into tbl_result from public.backup_restore_jobs where id = p_job;
    tbl_result := tbl_result
      || jsonb_build_object('resolved', coalesce((tbl_result->>'resolved')::int, 0) + resolved,
                            'unresolved', unresolved, 'unresolved_samples', samples);
    update public.backup_restore_jobs set result = jsonb_set(result, array[r.table_name], tbl_result, true) where id = p_job;
    out := out || jsonb_build_object(r.table_name, jsonb_build_object('resolved', resolved, 'unresolved', unresolved));
  end loop;
  return out;
end $$;
revoke all on function public.backup_restore_fixup(uuid) from public;
grant execute on function public.backup_restore_fixup(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Replace mode — detach nullable references before deleting
-- ---------------------------------------------------------------------
create or replace function public.backup_restore_delete_missing(p_job uuid, p_table text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  j public.backup_restore_jobs; pk text[]; keyexpr text; n integer; e record; detached integer := 0; m integer;
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

  -- children that point at the doomed rows through a NULLABLE column with
  -- NO ACTION / RESTRICT: set the reference to NULL (otherwise the delete
  -- is refused — this is how the persons ⇄ servants cycle is broken)
  for e in
    select c.relname::text as child, a.attname::text as col, pa.attname::text as pcol
      from pg_constraint f
      join pg_class c on c.oid = f.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_class p on p.oid = f.confrelid
      join pg_namespace pn on pn.oid = p.relnamespace
      join pg_attribute a  on a.attrelid  = c.oid and a.attnum  = f.conkey[1]
      join pg_attribute pa on pa.attrelid = p.oid and pa.attnum = f.confkey[1]
     where f.contype = 'f' and n.nspname = 'public' and pn.nspname = 'public'
       and p.relname = p_table and array_length(f.conkey, 1) = 1
       and not a.attnotnull and f.confdeltype in ('a', 'r')
  loop
    execute format('alter table public.%I disable trigger user', e.child);
    execute format(
      'update public.%1$I c set %2$I = null
        where c.%2$I in (select t.%3$I from public.%4$I t
                          where not exists (select 1 from public.backup_restore_keys k
                                             where k.job_id = $1 and k.table_name = $2 and k.key = %5$s))',
      e.child, e.col, e.pcol, p_table, keyexpr) using p_job, p_table;
    get diagnostics m = row_count;
    detached := detached + m;
    execute format('alter table public.%I enable trigger user', e.child);
  end loop;

  execute format('alter table public.%I disable trigger user', p_table);
  execute format(
    'delete from public.%I t where not exists (select 1 from public.backup_restore_keys k where k.job_id = $1 and k.table_name = $2 and k.key = %s)',
    p_table, keyexpr) using p_job, p_table;
  get diagnostics n = row_count;
  execute format('alter table public.%I enable trigger user', p_table);

  update public.backup_restore_jobs
     set result = jsonb_set(jsonb_set(result, array[p_table, 'deleted'], to_jsonb(n), true),
                            array[p_table, 'detached'], to_jsonb(detached), true)
   where id = p_job;
  return n;
end $$;
revoke all on function public.backup_restore_delete_missing(uuid, text) from public;
grant execute on function public.backup_restore_delete_missing(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. finish — also drop the fixups; stale-job cleanup covers them via FK
-- ---------------------------------------------------------------------
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
  delete from public.backup_restore_rows   where job_id = p_job;
  delete from public.backup_restore_keys   where job_id = p_job;
  delete from public.backup_restore_fixups where job_id = p_job;
  return jsonb_build_object('id', j.id, 'status', j.status, 'result', j.result, 'tables', to_jsonb(j.tables));
end $$;
revoke all on function public.backup_restore_finish(uuid, text, text) from public;
grant execute on function public.backup_restore_finish(uuid, text, text) to authenticated, service_role;

commit;
