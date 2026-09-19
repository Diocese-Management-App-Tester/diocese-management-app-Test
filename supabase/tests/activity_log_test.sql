-- =====================================================================
-- Functional test for migration 0047 (سجل النشاط). Run on the local shim DB
-- after run_migrations.sh:  psql -d app -f supabase/tests/activity_log_test.sql
-- Every assert raises on failure; a clean run ends with «ACTIVITY TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
begin;

-- ---------- seed ----------
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000002'),  -- class servant A (no profile)
  ('00000000-0000-0000-0000-000000000003'),  -- class servant B (activity.view)
  ('00000000-0000-0000-0000-000000000004'),  -- service manager
  ('00000000-0000-0000-0000-000000000005');  -- church manager of church 2
insert into public.churches (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'كنيسة ١'),
  ('10000000-0000-0000-0000-000000000002', 'كنيسة ٢');
insert into public.services (id, church_id, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل ب');
insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null),
  ('00000000-0000-0000-0000-000000000002', 'خادم أ', 'servant_a', '0101', 'class_servant', 'approved',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000003', 'خادم ب', 'servant_b', '0102', 'class_servant', 'approved',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000004', 'مسؤول الخدمة', 'svc_mgr', '0103', 'service_manager', 'approved',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null),
  ('00000000-0000-0000-0000-000000000005', 'مدير كنيسة ٢', 'ch2_mgr', '0104', 'church_manager', 'approved',
     '10000000-0000-0000-0000-000000000002', null, null);
insert into public.persons (id, national_id, name) values
  ('40000000-0000-0000-0000-000000000001', '1001', 'John'),
  ('40000000-0000-0000-0000-000000000002', '1002', 'Peter');
insert into public.child_sessions (person_id, token_hash, expires_at)
select id, encode(digest(national_id, 'sha256'), 'hex'), now() + interval '1 day' from public.persons;
insert into public.enrollments (id, person_id, church_id, service_id, class_id) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');
insert into public.permission_profiles (id, name, permissions) values
  ('70000000-0000-0000-0000-000000000001', 'سجل النشاط', array['activity.view']);
insert into public.permissions (servant_id, permission_profile_id) values
  ('00000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000001');

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('role', 'anon', true);
end $$;
create or replace function pg_temp.as_super() returns void language plpgsql as $$
begin perform set_config('role', 'postgres', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $$;

-- seed rows were written as superuser → actor = system
do $$ begin
  -- 2 children + 5 servant mirror persons (0042 sync trigger)
  if (select count(*) from public.activity_log where table_name = 'persons' and op = 'INSERT' and target_name in ('John', 'Peter')) <> 2 then raise exception 'persons inserts not logged'; end if;
  if (select count(*) from public.activity_log where action = 'servant_mirror.add') < 2 then raise exception 'servant mirror enrollments'; end if;
  if (select count(*) from public.activity_log where table_name = 'enrollments' and op = 'INSERT' and action = 'enrollment.add') <> 2 then raise exception 'enrollment inserts not logged'; end if;
  if exists (select 1 from public.activity_log where actor_kind <> 'system' and op <> 'EVENT') then raise exception 'seed should be system actor'; end if;
  -- batch: the two persons were one statement
  if (select count(distinct batch_id) from public.activity_log where table_name = 'persons' and target_name in ('John', 'Peter')) <> 1 then raise exception 'batch id not shared'; end if;
  if (select max(batch_size) from public.activity_log where table_name = 'persons' and target_name in ('John', 'Peter')) <> 2 then raise exception 'batch size not 2'; end if;
  -- target resolution through the enrollment
  if (select target_name from public.activity_log where table_name = 'enrollments' and enrollment_id = '50000000-0000-0000-0000-000000000001') <> 'John' then raise exception 'target name not resolved'; end if;
  if (select church_id from public.activity_log where table_name = 'enrollments' and enrollment_id = '50000000-0000-0000-0000-000000000001') <> '10000000-0000-0000-0000-000000000001' then raise exception 'church not resolved'; end if;
  -- the child_sessions insert (token hash) itself is NOT audited as a table, but the login hook fires
  if (select count(*) from public.activity_log where action = 'auth.child_login' and actor_name in ('John', 'Peter')) <> 2 then raise exception 'child login hook'; end if;
  if exists (select 1 from public.activity_log where new_data::text like '%token_hash%') then raise exception 'secret leaked'; end if;
end $$;

-- ---------- 1. servant A records attendance → actor resolved ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');
insert into public.events (id, church_id, service_id, class_id, name) values
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null, 'اجتماع');
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
insert into public.attendance_log (enrollment_id, event_id, points_delta, recorded_by)
values ('50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 5, '00000000-0000-0000-0000-000000000002');
insert into public.points_log (enrollment_id, delta, recorded_by) values ('50000000-0000-0000-0000-000000000001', -3, '00000000-0000-0000-0000-000000000002');
select pg_temp.as_super();
do $$ declare r public.activity_log; begin
  select * into r from public.activity_log where action = 'attendance.add' order by created_at desc limit 1;
  if r.actor_kind <> 'servant' or r.actor_id <> '00000000-0000-0000-0000-000000000002' or r.actor_name <> 'خادم أ' or r.actor_role <> 'class_servant' then
    raise exception 'actor not resolved: % % %', r.actor_kind, r.actor_name, r.actor_role; end if;
  if r.target_name <> 'John' or r.target_person_id <> '40000000-0000-0000-0000-000000000001' then raise exception 'attendance target'; end if;
  if r.class_id <> '30000000-0000-0000-0000-000000000001' then raise exception 'attendance class scope'; end if;
  if not exists (select 1 from public.activity_log where action = 'points.deduct' and target_name = 'John') then raise exception 'points.deduct key'; end if;
  if not exists (select 1 from public.activity_log where action = 'event.add' and target_name = 'اجتماع' and actor_name = 'مسؤول الخدمة') then raise exception 'event.add'; end if;
end $$;

-- ---------- 2. UPDATE keeps only the changed columns ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
update public.persons set phone = '+201000000000', edited_at = now() where id = '40000000-0000-0000-0000-000000000001';
select pg_temp.as_super();
do $$ declare r public.activity_log; begin
  select * into r from public.activity_log where table_name = 'persons' and op = 'UPDATE' order by created_at desc limit 1;
  if r.action <> 'person.update' then raise exception 'person.update key: %', r.action; end if;
  if not ('phone' = any(r.changed)) then raise exception 'changed[] missing phone: %', r.changed; end if;
  if r.new_data->>'phone' <> '+201000000000' or r.old_data ? 'phone' = false then raise exception 'diff old/new'; end if;
  if r.new_data ? 'name' then raise exception 'unchanged column should not be in diff'; end if;
  if r.target_name <> 'John' then raise exception 'update target'; end if;
end $$;
-- bookkeeping-only update → nothing logged
do $$ declare before bigint; after bigint; begin
  select count(*) into before from public.activity_log;
  update public.persons set edited_at = now() where id = '40000000-0000-0000-0000-000000000002';
  select count(*) into after from public.activity_log;
  if after <> before then raise exception 'edited_at-only update was logged'; end if;
end $$;

-- ---------- 3. child portal actor ----------
select pg_temp.as_anon();
select public.child_portal_log_activity('1001', 'portal.open', '{"page":"home"}');
select pg_temp.as_super();
do $$ declare r public.activity_log; begin
  select * into r from public.activity_log where action = 'portal.open';
  if r.actor_kind <> 'child' or r.actor_name <> 'John' or r.actor_role <> 'child' then raise exception 'child actor: % %', r.actor_kind, r.actor_name; end if;
  if r.church_id is null or r.enrollment_id is null then raise exception 'child scope not resolved'; end if;
  if r.meta->>'page' <> 'home' then raise exception 'meta lost'; end if;
end $$;

-- child writes through a portal RPC are attributed to the child (child_portal_person stamps the tx)
do $$ declare p public.persons; begin
  perform set_config('request.jwt.claim.sub', '', true);
  p := public.child_portal_person('1002');
  insert into public.data_change_requests (person_id, kind, changes) values (p.id, 'data', '{"phone":"+201"}');
  perform set_config('app.child_actor', '', true);
end $$;
do $$ declare r public.activity_log; begin
  select * into r from public.activity_log where action = 'data_request.add';
  if r.actor_kind <> 'child' or r.actor_name <> 'Peter' then raise exception 'child trigger actor: % %', r.actor_kind, r.actor_name; end if;
  if r.target_name <> 'Peter' then raise exception 'data request target'; end if;
end $$;

-- ---------- 4. log_activity (app events) ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
select public.log_activity('auth.login', null, null, '{"ua":"test"}');
do $$ begin
  begin perform public.log_activity('bad key', null, null, '{}'); raise exception 'bad action accepted';
  exception when others then if sqlerrm <> 'bad_action' then raise; end if; end;
end $$;
select pg_temp.as_anon();
select public.log_activity('auth.login_failed', null, null, '{"code":"x"}');
do $$ begin
  begin perform public.log_activity('export.excel', null, null, '{}'); raise exception 'anon non-auth event accepted';
  exception when others then if sqlerrm <> 'not_allowed' then raise; end if; end;
end $$;
select pg_temp.as_super();
do $$ declare r public.activity_log; begin
  select * into r from public.activity_log where action = 'auth.login';
  if r.actor_name <> 'خادم أ' or r.church_id is null or r.source <> 'app' or r.op <> 'EVENT' then raise exception 'auth.login row'; end if;
  select * into r from public.activity_log where action = 'auth.login_failed';
  if r.actor_kind <> 'system' then raise exception 'anon login_failed actor'; end if;
end $$;

-- ---------- 5. semantic keys ----------
select pg_temp.as_super();
update public.servant_enrollments set status = 'suspended' where id = '00000000-0000-0000-0000-000000000003';
update public.servant_enrollments set status = 'approved' where id = '00000000-0000-0000-0000-000000000003';
update public.enrollments set attendance_count = attendance_count + 1 where id = '50000000-0000-0000-0000-000000000001';
do $$ begin
  if not exists (select 1 from public.activity_log where action = 'servant.suspend' and target_name = 'خادم ب') then raise exception 'servant.suspend'; end if;
  if not exists (select 1 from public.activity_log where action = 'servant.approve' and target_name = 'خادم ب') then raise exception 'servant.approve'; end if;
  if not exists (select 1 from public.activity_log where action = 'enrollment.counters') then raise exception 'enrollment.counters'; end if;
end $$;

-- ---------- 6. RLS — module not granted → nothing; then granted ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');
do $$ begin
  if (select count(*) from public.activity_log) <> 0 then raise exception 'visible without module grant'; end if;
  if (public.activity_permissions()->>'view')::boolean then raise exception 'view without grant'; end if;
end $$;
select pg_temp.as_super();
insert into public.module_access (module_key, church_id) values ('activity', null);

-- owner sees all
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
do $$ declare total bigint; begin
  select count(*) into total from public.activity_log;
  perform set_config('role', 'postgres', true);
  if total <> (select count(*) from public.activity_log) then raise exception 'owner does not see everything'; end if;
  perform set_config('role', 'authenticated', true);
  if not (public.activity_permissions()->>'manage')::boolean then raise exception 'owner manage'; end if;
end $$;

-- service manager: his church's rows (service scope), NOT rows of church 2
select pg_temp.as_super();
select pg_temp.as_user('00000000-0000-0000-0000-000000000005');
insert into public.services (id, church_id, name) values ('20000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', 'خدمة ٢');
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');
do $$ begin
  if not exists (select 1 from public.activity_log where action = 'attendance.add') then raise exception 'svc mgr cannot see attendance in his service'; end if;
  if exists (select 1 from public.activity_log where church_id = '10000000-0000-0000-0000-000000000002') then raise exception 'svc mgr sees church 2'; end if;
  if not (public.activity_permissions()->>'view')::boolean then raise exception 'svc mgr view'; end if;
  if (public.activity_permissions()->>'manage')::boolean then raise exception 'svc mgr manage'; end if;
end $$;

-- church manager of church 2: only church 2
select pg_temp.as_user('00000000-0000-0000-0000-000000000005');
do $$ begin
  if exists (select 1 from public.activity_log where church_id = '10000000-0000-0000-0000-000000000001') then raise exception 'ch2 mgr sees church 1'; end if;
  if not exists (select 1 from public.activity_log where action = 'service.add' and target_name = 'خدمة ٢') then raise exception 'ch2 mgr misses own row'; end if;
end $$;

-- class servant A: no permission → nothing
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ begin
  if (select count(*) from public.activity_log) <> 0 then raise exception 'class servant without permission sees rows'; end if;
end $$;
-- class servant B: activity.view → class B rows only
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
do $$ begin
  if exists (select 1 from public.activity_log where class_id = '30000000-0000-0000-0000-000000000001') then raise exception 'servant B sees class A'; end if;
  if not exists (select 1 from public.activity_log where enrollment_id = '50000000-0000-0000-0000-000000000002') then raise exception 'servant B misses class B'; end if;
end $$;

-- nobody may write directly
do $$ begin
  begin
    insert into public.activity_log (table_name, op, action) values ('x', 'EVENT', 'x.y');
    raise exception 'direct insert allowed';
  exception when insufficient_privilege then null; end;
end $$;

-- ---------- 7. feed / summary / actors / pagination ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
do $$ declare n int; last_at timestamptz; last_id uuid; page2 int; s jsonb; begin
  select count(*) into n from public.activity_feed('{}'::jsonb, 3);
  if n <> 3 then raise exception 'feed limit'; end if;
  select created_at, id into last_at, last_id from public.activity_feed('{}'::jsonb, 3) order by created_at, id limit 1;
  select count(*) into page2 from public.activity_feed('{}'::jsonb, 1000, last_at, last_id);
  perform set_config('role', 'postgres', true);
  if page2 <> (select count(*) from public.activity_log) - 3 then raise exception 'keyset page 2: %', page2; end if;
  perform set_config('role', 'authenticated', true);
  -- filters
  if (select count(*) from public.activity_feed('{"action":"attendance.add"}'::jsonb, 10)) <> 1 then raise exception 'filter action'; end if;
  if (select count(*) from public.activity_feed('{"actor_id":"00000000-0000-0000-0000-000000000002","actor_kind":"servant"}'::jsonb, 100)) < 4 then raise exception 'filter actor'; end if;
  if (select count(*) from public.activity_feed('{"target_person_id":"40000000-0000-0000-0000-000000000001"}'::jsonb, 100)) < 3 then raise exception 'filter target'; end if;
  if (select count(*) from public.activity_feed('{"q":"John"}'::jsonb, 100)) < 3 then raise exception 'filter q'; end if;
  if (select count(*) from public.activity_feed('{"action_prefix":"auth"}'::jsonb, 100))
     <> (select count(*) from public.activity_feed('{}'::jsonb, 1000) where action like 'auth.%') then raise exception 'filter prefix'; end if;
  if (select count(*) from public.activity_feed('{"op":"UPDATE"}'::jsonb, 100)) < 3 then raise exception 'filter op'; end if;
  -- injection attempt is just a literal
  if (select count(*) from public.activity_feed('{"q":"'' or 1=1 --"}'::jsonb, 100)) <> 0 then raise exception 'injection'; end if;
  s := public.activity_summary('{}'::jsonb);
  if (s->>'total')::int < 10 then raise exception 'summary total'; end if;
  if jsonb_array_length(s->'by_action') < 5 or jsonb_array_length(s->'by_actor') < 3 then raise exception 'summary groups'; end if;
  if (select count(*) from public.activity_actors('{}'::jsonb)) < 3 then raise exception 'actors'; end if;
  if (select count(*) from public.activity_person_history('40000000-0000-0000-0000-000000000001')) < 3 then raise exception 'person history'; end if;
end $$;

-- ---------- 8. settings + prune ----------
do $$ declare v jsonb; n int; begin
  v := public.activity_settings_set('{"keep_days": 3}'::jsonb);
  if (v->>'keep_days')::int <> 7 then raise exception 'keep_days floor'; end if;
  v := public.activity_settings_set('{"keep_days": 90}'::jsonb);
  if (public.activity_settings()->>'keep_days')::int <> 90 then raise exception 'settings read'; end if;
  n := public.activity_prune(30);
  if n <> 0 then raise exception 'prune deleted fresh rows'; end if;
  if not exists (select 1 from public.activity_log where action = 'activity.prune') then raise exception 'prune not logged'; end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');
do $$ begin
  begin perform public.activity_settings_set('{"keep_days": 30}'::jsonb); raise exception 'non-owner set settings';
  exception when others then if sqlerrm <> 'not_allowed' then raise; end if; end;
  begin perform public.activity_prune(30); raise exception 'non-owner prune';
  exception when others then if sqlerrm <> 'not_allowed' then raise; end if; end;
end $$;

-- ---------- 9. audit_off switch ----------
select pg_temp.as_super();
do $$ declare before bigint; after bigint; begin
  select count(*) into before from public.activity_log;
  perform set_config('app.audit_off', '1', true);
  insert into public.causes (church_id, name) values ('10000000-0000-0000-0000-000000000001', 'silent');
  perform set_config('app.audit_off', '', true);
  select count(*) into after from public.activity_log;
  if after <> before then raise exception 'audit_off ignored'; end if;
end $$;

-- ---------- 10. DELETE keeps the old row ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
delete from public.causes where name = 'silent';
select pg_temp.as_super();
do $$ declare r public.activity_log; begin
  select * into r from public.activity_log where action = 'cause.remove';
  if r.old_data->>'name' <> 'silent' or r.actor_name <> 'المالك' then raise exception 'delete row'; end if;
end $$;

-- ---------- 11. every audited table has its triggers ----------
do $$ declare t text; begin
  foreach t in array public.activity_audited_tables() loop
    if not exists (select 1 from pg_trigger tr join pg_class c on c.oid = tr.tgrelid where c.relname = t and tr.tgname = 'zza_audit_upd') then
      raise exception 'trigger missing on %', t;
    end if;
  end loop;
end $$;

rollback;
\echo ACTIVITY TESTS PASSED
