-- =====================================================================
-- Functional test for migration 0044 (backup & restore).
--   psql -d app -f supabase/tests/backup_restore_test.sql
-- Ends with «BACKUP / RESTORE TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner@diocese.app'),
  ('00000000-0000-0000-0000-000000000006', 'cs-a@diocese.app'),
  ('00000000-0000-0000-0000-000000000007', 'sm-b@diocese.app');   -- login account restored FIRST (section H)
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

-- ---------- H. FK cycle (persons ⇄ servant_enrollments) + audit columns ----------
-- Reproduces the production failure: «insert or update on table
-- "app_settings" violates foreign key constraint app_settings_updated_by_fkey».
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$
declare o text[]; jid uuid; ord jsonb; res jsonb; fx jsonb; n int; t text;
begin
  -- 1. order: servants before app_settings, persons after servants (nullable cycle is deferred)
  o := public.backup_topo_order(array['app_settings', 'servant_enrollments', 'persons', 'churches', 'enrollments', 'classes', 'services']);
  if array_position(o, 'servant_enrollments') > array_position(o, 'app_settings') then raise exception 'servants must precede app_settings: %', o; end if;
  if array_position(o, 'persons') > array_position(o, 'enrollments') then raise exception 'persons must precede enrollments: %', o; end if;
  if array_position(o, 'churches') > array_position(o, 'servant_enrollments') then raise exception 'churches must precede servants: %', o; end if;

  -- 2. a new servant (with a login account), a person created by him, a setting he touched,
  --    a person created by a servant whose account does NOT exist (unresolved),
  --    and a servant whose auth.users row is missing (skipped, not fatal).
  jid := public.backup_restore_begin('merge', array['app_settings', 'servant_enrollments', 'persons'],
           jsonb_build_object('columns', jsonb_build_object(
             'app_settings', '["key","value","updated_at","updated_by"]'::jsonb,
             'servant_enrollments', '["id","full_name","user_id","phone","role","status","church_id","approved_by","approved_at","person_id"]'::jsonb,
             'persons', '["id","national_id","name","created_by","edited_by"]'::jsonb)));
  perform public.backup_restore_stage(jid, 'app_settings', 0, jsonb_build_array(
    jsonb_build_object('key', 'taskbar', 'value', '{"items":[]}'::jsonb, 'updated_at', now(), 'updated_by', '00000000-0000-0000-0000-000000000007'),
    jsonb_build_object('key', 'names', 'value', '{}'::jsonb, 'updated_at', now(), 'updated_by', '00000000-0000-0000-0000-000000000099')));
  perform public.backup_restore_stage(jid, 'servant_enrollments', 0, jsonb_build_array(
    jsonb_build_object('id', '00000000-0000-0000-0000-000000000007', 'full_name', 'مسؤول ب', 'user_id', 'sm-b', 'phone', '0107',
                       'role', 'service_manager', 'status', 'approved', 'church_id', '10000000-0000-0000-0000-000000000001',
                       'approved_by', '00000000-0000-0000-0000-000000000001', 'approved_at', now(),
                       'person_id', '40000000-0000-0000-0000-000000000007'),
    jsonb_build_object('id', '00000000-0000-0000-0000-000000000008', 'full_name', 'بلا حساب', 'user_id', 'ghost', 'phone', '0108',
                       'role', 'class_servant', 'status', 'approved', 'church_id', null, 'approved_by', null, 'approved_at', null, 'person_id', null)));
  perform public.backup_restore_stage(jid, 'persons', 0, jsonb_build_array(
    jsonb_build_object('id', '40000000-0000-0000-0000-000000000007', 'national_id', 'P7', 'name', 'شخص الخادم', 'created_by', '00000000-0000-0000-0000-000000000007', 'edited_by', '00000000-0000-0000-0000-000000000007'),
    jsonb_build_object('id', '40000000-0000-0000-0000-000000000001', 'national_id', 'P1', 'name', 'طفل', 'created_by', '00000000-0000-0000-0000-000000000099', 'edited_by', null)));
  ord := public.backup_restore_order(jid);
  if ord->0->>'table' <> 'servant_enrollments' then raise exception 'job order wrong: %', ord; end if;

  -- apply in the job's order — must NOT raise
  for t in select x->>'table' from jsonb_array_elements(ord) x loop
    perform public.backup_restore_apply_chunk(jid, t, 0);
  end loop;
  fx := public.backup_restore_fixup(jid);
  res := public.backup_restore_finish(jid, 'done');

  -- servant 7 in, ghost servant skipped & reported
  if (select count(*) from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000007') <> 1 then raise exception 'servant 7 missing'; end if;
  if exists (select 1 from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000008') then raise exception 'ghost servant must be skipped'; end if;
  if (res->'result'->'servant_enrollments'->>'skipped')::int <> 1 then raise exception 'skipped counter: %', res->'result'->'servant_enrollments'; end if;
  -- servant.person_id was deferred (persons applied later) then re-attached
  if (select person_id from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000007') <> '40000000-0000-0000-0000-000000000007' then
    raise exception 'servant.person_id not re-attached: %', res->'result'->'servant_enrollments';
  end if;
  if (res->'result'->'servant_enrollments'->>'deferred')::int <> 1 or (res->'result'->'servant_enrollments'->>'resolved')::int <> 1 then
    raise exception 'servant deferred/resolved counters: %', res->'result'->'servant_enrollments';
  end if;
  -- app_settings: valid reference kept, dangling reference → null and reported
  if (select updated_by from public.app_settings where key = 'taskbar') <> '00000000-0000-0000-0000-000000000007' then raise exception 'taskbar.updated_by lost'; end if;
  if (select updated_by from public.app_settings where key = 'names') is not null then raise exception 'names.updated_by must be null'; end if;
  if (res->'result'->'app_settings'->>'unresolved')::int <> 1 then raise exception 'app_settings unresolved: %', res->'result'->'app_settings'; end if;
  -- persons: created_by by servant 7 kept, by 99 → null
  if (select created_by from public.persons where national_id = 'P7') <> '00000000-0000-0000-0000-000000000007' then raise exception 'P7.created_by lost'; end if;
  if (select created_by from public.persons where national_id = 'P1') is not null then raise exception 'P1.created_by must be null'; end if;
  if exists (select 1 from public.backup_restore_fixups where job_id = jid) then raise exception 'fixups not cleaned'; end if;
  if exists (select 1 from pg_trigger where tgrelid = 'public.servant_enrollments'::regclass and not tgisinternal and tgenabled = 'D') then
    raise exception 'user triggers left disabled';
  end if;
end $$;

-- ---------- I. REPLACE across the cycle: deleting a servant referenced by persons.created_by ----------
do $$
declare jid uuid; n int; ord jsonb; t text;
begin
  -- backup contains the owner only → servant 7 must go although persons.created_by points at him
  jid := public.backup_restore_begin('replace', array['servant_enrollments']);
  perform public.backup_restore_stage(jid, 'servant_enrollments', 0, jsonb_build_array(
    jsonb_build_object('id', '00000000-0000-0000-0000-000000000001', 'full_name', 'المالك', 'user_id', 'owner', 'phone', '0100', 'role', 'owner', 'status', 'approved'),
    jsonb_build_object('id', '00000000-0000-0000-0000-000000000006', 'full_name', 'خادم أ', 'user_id', 'cs-a', 'phone', '0106', 'role', 'class_servant', 'status', 'approved')));
  ord := public.backup_restore_order(jid);
  n := public.backup_restore_delete_missing(jid, 'servant_enrollments');
  if n <> 1 then raise exception 'replace should delete servant 7, got %', n; end if;
  if (select created_by from public.persons where national_id = 'P7') is not null then raise exception 'reference must be detached'; end if;
  perform public.backup_restore_apply_chunk(jid, 'servant_enrollments', 0);
  perform public.backup_restore_fixup(jid);
  perform public.backup_restore_finish(jid, 'done');
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
