-- =====================================================================
-- END-TO-END restore test — run AFTER supabase/seed_test_data.sql:
--   psql -d app -f supabase/seed_test_data.sql
--   psql -d app -f supabase/tests/backup_restore_e2e_test.sql
-- Dumps EVERY public table exactly like the browser does, wipes them
-- (login accounts stay — the client restores them first), restores the
-- whole file in the job's FK order and checks that every table has its
-- rows back with no unresolved / skipped references.
-- Ends with «BACKUP / RESTORE E2E PASSED». Everything is rolled back.
-- =====================================================================
\set ON_ERROR_STOP on
begin;
select set_config('app.audit_off', '1', true);   -- restored history must not be re-audited

set local role service_role;
set local request.jwt.claim.role = 'service_role';

create temp table dump on commit drop as
  select (e->>'name') as t, public.backup_dump_table(e->>'name', 0, 2000) as rows, e->'columns' as cols
    from jsonb_array_elements(public.backup_tables()) e;

do $$
declare total bigint;
begin
  select sum(jsonb_array_length(rows)) into total from dump;
  if total < 1000 then raise exception 'seed the database first (only % rows)', total; end if;
  raise notice 'dumped % tables / % rows', (select count(*) from dump), total;
end $$;

reset role;
-- wipe (like reset_system.sql) — auth.users are kept
do $$ declare r record; begin
  for r in select t from dump loop execute format('alter table public.%I disable trigger user', r.t); end loop;
  execute (select 'truncate ' || string_agg(format('public.%I', t), ', ') || ' cascade' from dump);
  for r in select t from dump loop execute format('alter table public.%I enable trigger user', r.t); end loop;
end $$;

set local role service_role;
do $$
declare jid uuid; ord jsonb; tn text; res jsonb; r record; bad jsonb; before int; after int;
begin
  jid := public.backup_restore_begin('merge', (select array_agg(d.t) from dump d),
           jsonb_build_object('columns', (select jsonb_object_agg(d.t, d.cols) from dump d)));
  for r in select * from dump loop
    perform public.backup_restore_stage(jid, r.t, 0, r.rows);
  end loop;
  ord := public.backup_restore_order(jid);
  if ord->0->>'table' not in ('activity_log', 'churches', 'rt_gates') then raise exception 'order starts with %', ord->0; end if;
  if (select array_position(array_agg(x->>'table' order by i), 'servant_enrollments') from jsonb_array_elements(ord) with ordinality e(x, i))
     > (select array_position(array_agg(x->>'table' order by i), 'app_settings') from jsonb_array_elements(ord) with ordinality e(x, i)) then
    raise exception 'servants must be applied before app_settings';
  end if;
  for tn in select x->>'table' from jsonb_array_elements(ord) x loop
    perform public.backup_restore_apply_chunk(jid, tn, 0);   -- must not raise (the production bug)
  end loop;
  perform public.backup_restore_fixup(jid);
  res := public.backup_restore_finish(jid, 'done');

  select jsonb_object_agg(e.key, e.value) into bad from jsonb_each(res->'result') e
   where coalesce((e.value->>'unresolved')::int, 0) > 0 or coalesce((e.value->>'skipped')::int, 0) > 0;
  if bad is not null then raise exception 'unresolved / skipped references: %', bad; end if;
  if coalesce((res->'result'->'servant_enrollments'->>'deferred')::int, 0) = 0 then
    raise exception 'expected servant_enrollments.person_id / approved_by to be deferred (cycle)';
  end if;
  if (res->'result'->'servant_enrollments'->>'deferred')::int <> (res->'result'->'servant_enrollments'->>'resolved')::int then
    raise exception 'deferred <> resolved: %', res->'result'->'servant_enrollments';
  end if;

end $$;

reset role;
-- verify as postgres (the local shim grants service_role nothing on the tables)
do $$
declare r record; before int; after int;
begin
  for r in select * from dump loop
    before := jsonb_array_length(r.rows);
    execute format('select count(*) from public.%I', r.t) into after;
    if before <> after then raise exception '% : % rows before, % after', r.t, before, after; end if;
  end loop;
  if exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and not t.tgisinternal and t.tgenabled = 'D') then
    raise exception 'user triggers left disabled';
  end if;
  -- a couple of spot checks on the cycle
  if exists (select 1 from public.servant_enrollments where person_id is null and role <> 'owner') then
    raise exception 'servant.person_id lost in restore';
  end if;
  if (select count(*) from public.persons where created_by is not null) = 0 then
    raise exception 'persons.created_by lost in restore';
  end if;
end $$;

rollback;
\echo BACKUP / RESTORE E2E PASSED
