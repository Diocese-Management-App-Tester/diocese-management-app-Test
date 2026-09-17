-- =====================================================================
-- Functional test for migration 0044 (backup & restore).
--   psql -d app -f supabase/tests/backup_restore_test.sql
-- Ends with «BACKUP / RESTORE TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner@diocese.app'),
  ('00000000-0000-0000-0000-000000000006', 'cs-a@diocese.app');
insert into public.churches (id, name) values ('10000000-0000-0000-0000-000000000001', 'كنيسة أ');
insert into public.services (id, church_id, name) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ');
insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id, approved_at) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null, now()),
  ('00000000-0000-0000-0000-000000000006', 'خادم أ', 'cs-a', '0106', 'class_servant', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', now());
insert into public.causes (id, church_id, name, points) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'حفظ', 5);

-- ---------- A. a class servant may NOT use the system ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
set local request.jwt.claim.role = 'authenticated';
do $$
begin
  begin
    perform public.backup_tables();
    raise exception 'class servant must be refused';
  exception when others then
    if sqlerrm <> 'not_allowed' then raise; end if;
  end;
end $$;

-- ---------- B. owner: catalogue + dump ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$
declare cat jsonb; t jsonb; dump jsonb; users jsonb;
begin
  cat := public.backup_tables();
  if jsonb_typeof(cat) <> 'array' or jsonb_array_length(cat) < 60 then raise exception 'catalogue too small: %', jsonb_array_length(cat); end if;
  select e into t from jsonb_array_elements(cat) e where e->>'name' = 'classes';
  if (t->>'rows')::int <> 1 then raise exception 'classes rows expected 1'; end if;
  if not (t->'parents' ? 'churches' and t->'parents' ? 'services') then raise exception 'classes parents wrong: %', t->'parents'; end if;
  if t->'pk' <> '["id"]'::jsonb then raise exception 'classes pk wrong'; end if;
  if exists (select 1 from jsonb_array_elements(cat) e where e->>'name' like 'backup_restore_%') then raise exception 'staging tables must be hidden'; end if;
  -- generated column excluded
  select e into t from jsonb_array_elements(cat) e where e->>'name' = 'chat_messages';
  if t->'columns' ? 'staff_pair' then raise exception 'generated column must not be insertable'; end if;

  dump := public.backup_dump_table('servant_enrollments', 0, 100);
  if jsonb_array_length(dump) <> 2 then raise exception 'dump expected 2 rows'; end if;
  dump := public.backup_dump_table('servant_enrollments', 1, 1);
  if jsonb_array_length(dump) <> 1 then raise exception 'paging broken'; end if;

  users := public.backup_dump_auth_users();
  if jsonb_array_length(users) <> 2 then raise exception 'auth users expected 2, got %', jsonb_array_length(users); end if;
  if not (users->0 ? 'encrypted_password') then raise exception 'hash column missing'; end if;

  begin
    perform public.backup_dump_table('pg_class', 0, 1);
    raise exception 'unknown table must fail';
  exception when others then
    if sqlerrm <> 'unknown_table' then raise; end if;
  end;
end $$;

-- ---------- C. topo order ----------
do $$
declare o text[];
begin
  o := public.backup_topo_order(array['classes', 'enrollments', 'churches', 'persons', 'services']);
  if array_position(o, 'churches') > array_position(o, 'services') then raise exception 'churches before services'; end if;
  if array_position(o, 'services') > array_position(o, 'classes') then raise exception 'services before classes'; end if;
  if array_position(o, 'persons') > array_position(o, 'enrollments') then raise exception 'persons before enrollments'; end if;
  if array_position(o, 'classes') > array_position(o, 'enrollments') then raise exception 'classes before enrollments'; end if;
end $$;

-- ---------- D. restore MERGE: new church + updated cause, existing untouched ----------
do $$
declare jid uuid; ord jsonb; res jsonb; n int;
begin
  jid := public.backup_restore_begin('merge', array['causes', 'churches'],
           jsonb_build_object('columns', jsonb_build_object(
             'churches', '["id","name","created_at"]'::jsonb,
             'causes',   '["id","church_id","name","points","ghost_column"]'::jsonb)));
  -- children given first on purpose — the job re-orders
  n := public.backup_restore_stage(jid, 'causes', 0, jsonb_build_array(
         jsonb_build_object('id', '50000000-0000-0000-0000-000000000001', 'church_id', '10000000-0000-0000-0000-000000000001', 'name', 'حفظ آية', 'points', 7, 'ghost_column', 'x'),
         jsonb_build_object('id', '50000000-0000-0000-0000-000000000002', 'church_id', '10000000-0000-0000-0000-000000000002', 'name', 'سلوك', 'points', 2, 'ghost_column', 'y')));
  if n <> 2 then raise exception 'stage returned %', n; end if;
  n := public.backup_restore_stage(jid, 'churches', 0, jsonb_build_array(
         jsonb_build_object('id', '10000000-0000-0000-0000-000000000002', 'name', 'كنيسة ب', 'created_at', '2024-01-01T00:00:00Z')));
  ord := public.backup_restore_order(jid);
  if ord->0->>'table' <> 'churches' or ord->1->>'table' <> 'causes' then raise exception 'order wrong: %', ord; end if;
  if (ord->1->>'rows')::int <> 2 then raise exception 'rows count wrong'; end if;

  n := public.backup_restore_delete_missing(jid, 'causes');   -- merge → no-op
  if n <> 0 then raise exception 'merge must not delete'; end if;
  n := public.backup_restore_apply_chunk(jid, 'churches', 0);
  if n <> 1 then raise exception 'churches upsert %', n; end if;
  n := public.backup_restore_apply_chunk(jid, 'causes', 0);
  if n <> 2 then raise exception 'causes upsert %', n; end if;

  if (select count(*) from public.churches) <> 2 then raise exception 'church not merged'; end if;
  if (select name from public.causes where id = '50000000-0000-0000-0000-000000000001') <> 'حفظ آية' then raise exception 'cause not updated'; end if;
  if (select points from public.causes where id = '50000000-0000-0000-0000-000000000001') <> 7 then raise exception 'cause points not updated'; end if;
  if (select count(*) from public.causes) <> 2 then raise exception 'cause not inserted'; end if;

  res := public.backup_restore_finish(jid, 'done');
  if res->>'status' <> 'done' then raise exception 'finish status'; end if;
  if (res->'result'->'causes'->>'upserted')::int <> 2 then raise exception 'result counters: %', res; end if;
  if exists (select 1 from public.backup_restore_rows where job_id = jid) then raise exception 'staging not cleaned'; end if;
end $$;

-- ---------- E. restore REPLACE: rows missing from the backup are deleted ----------
do $$
declare jid uuid; n int; ord jsonb; i int;
begin
  jid := public.backup_restore_begin('replace', array['causes']);
  perform public.backup_restore_stage(jid, 'causes', 0, jsonb_build_array(
         jsonb_build_object('id', '50000000-0000-0000-0000-000000000002', 'church_id', '10000000-0000-0000-0000-000000000002', 'name', 'سلوك', 'points', 3)));
  ord := public.backup_restore_order(jid);
  n := public.backup_restore_delete_missing(jid, 'causes');
  if n <> 1 then raise exception 'replace should delete 1, got %', n; end if;
  n := public.backup_restore_apply_chunk(jid, 'causes', 0);
  if (select count(*) from public.causes) <> 1 then raise exception 'replace count'; end if;
  if (select points from public.causes where id = '50000000-0000-0000-0000-000000000002') <> 3 then raise exception 'replace update'; end if;
  perform public.backup_restore_finish(jid, 'done');
  -- triggers re-enabled?
  if exists (select 1 from pg_trigger where tgrelid = 'public.causes'::regclass and not tgisinternal and tgenabled = 'D') then
    raise exception 'user triggers left disabled';
  end if;
end $$;

-- ---------- F. schedules: next_run_at computed; due list ----------
do $$
declare s public.backup_schedules; nr timestamptz;
begin
  insert into public.backup_schedules (name, frequency, hour) values ('يومي', 'daily', 3) returning * into s;
  if s.next_run_at is null or s.next_run_at <= now() then raise exception 'next_run_at must be in the future'; end if;
  if s.next_run_at > now() + interval '1 day' then raise exception 'daily next run too far'; end if;
  nr := public.backup_next_run('weekly', 0, 1, 3, '2026-09-16 10:00+00');  -- Wednesday
  if extract(dow from (nr at time zone 'Africa/Cairo')) <> 0 then raise exception 'weekly must land on Sunday'; end if;
  nr := public.backup_next_run('monthly', 0, 15, 6, '2026-09-16 10:00+00');
  if (nr at time zone 'Africa/Cairo')::date <> date '2026-10-15' then raise exception 'monthly wrong: %', nr; end if;

  if exists (select 1 from public.backup_schedules_due()) then raise exception 'nothing should be due yet'; end if;
  update public.backup_schedules set next_run_at = now() - interval '1 minute' where id = s.id;
  if not exists (select 1 from public.backup_schedules_due()) then raise exception 'should be due'; end if;
  perform public.backup_schedule_ran(s.id, 'done');
  select * into s from public.backup_schedules where id = s.id;
  if s.last_status <> 'done' or s.next_run_at <= now() then raise exception 'schedule_ran did not advance'; end if;

  insert into public.backup_runs (kind, status, tables, created_by) values ('manual', 'done', array['churches'], auth.uid());
  if (select count(*) from public.backup_runs) <> 1 then raise exception 'runs insert'; end if;
end $$;

-- ---------- G. a class servant sees no schedules / runs ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
do $$
begin
  if (select count(*) from public.backup_schedules) <> 0 then raise exception 'rls schedules'; end if;
  if (select count(*) from public.backup_runs) <> 0 then raise exception 'rls runs'; end if;
end $$;

rollback;
\echo BACKUP / RESTORE TESTS PASSED
