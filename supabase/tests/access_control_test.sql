-- =====================================================================
-- Functional test for 20260925120000_access_control.sql (التحكم في الدخول).
--   psql -d app -f supabase/tests/access_control_test.sql
-- Ends with «ACCESS CONTROL TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000003'),  -- service manager (مدارس الأحد)
  ('00000000-0000-0000-0000-000000000006');  -- class servant (فصل أ)
insert into public.churches (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'كنيسة أ'),
  ('10000000-0000-0000-0000-000000000002', 'كنيسة ب');
insert into public.services (id, church_id, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'اجتماع شباب'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'خدمة ب');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'شباب ١'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', 'فصل ب');

insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id, approved_at) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null, now()),
  ('00000000-0000-0000-0000-000000000003', 'مسؤول الخدمة', 'sm', '0103', 'service_manager', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null, now()),
  ('00000000-0000-0000-0000-000000000006', 'خادم أ', 'cs-a', '0106', 'class_servant', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', now());

insert into public.persons (id, national_id, name, gender, birthdate) values
  ('50000000-0000-0000-0000-000000000001', 'KID-1', 'مينا', 'male', current_date - interval '10 years'),   -- فصل أ, 30(+10) pts, 3(+2) attendances
  ('50000000-0000-0000-0000-000000000002', 'KID-2', 'مريم', 'female', current_date - interval '9 years'), -- فصل أ, 5(+5) pts, 1(+1) attendance
  ('50000000-0000-0000-0000-000000000003', 'KID-3', 'يوسف', 'male', null),                                -- كنيسة ب only, 100 pts
  ('50000000-0000-0000-0000-000000000004', 'KID-4', 'سارة', 'female', current_date - interval '12 years'); -- شباب ١, 40 pts
insert into public.enrollments (id, person_id, church_id, service_id, class_id, points, attendance_count) values
  ('60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 30, 3),
  ('60000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 5, 1),
  ('60000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', 100, 0),
  ('60000000-0000-0000-0000-000000000005', '50000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 40, 2);
insert into public.events (id, church_id, name, recurrence, event_date, points) values
  ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'حضور الأحد', 'once', current_date, 5),
  ('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'اجتماع الصلاة', 'once', current_date, 5);
-- attendance history (triggers may bump counters — we compare with the log where it matters)
insert into public.attendance_log (enrollment_id, event_id, points_delta, attended_on) values
  ('60000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 5, current_date - 7),
  ('60000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', 5, current_date - 3),
  ('60000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000001', 5, current_date - 7);

-- ---------- A. service manager creates an access event with rules + allowed list ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
set local request.jwt.claim.role = 'authenticated';

do $$
declare ev uuid; g_or uuid; r jsonb; n int;
begin
  if not (public.access_permissions() ->> 'manage')::boolean then
    raise exception 'service manager must be able to manage access events';
  end if;

  insert into public.access_events (church_id, service_id, name)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'حفلة نهاية العام')
  returning id into ev;

  -- no allowed list, no rules → nobody passes (allowed list empty)
  r := public.access_check(ev, 'KID-1', null, false);
  if (r ->> 'granted')::boolean or r ->> 'reason' <> 'not_allowed' then raise exception 'empty allowed list must deny: %', r; end if;

  -- allow the whole class فصل أ
  insert into public.access_allowed (event_id, church_id, service_id, class_id)
  values (ev, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001');
  r := public.access_check(ev, 'KID-1', null, false);
  if not (r ->> 'granted')::boolean then raise exception 'class member with no rules must pass: %', r; end if;
  -- سارة is in شباب ١ → not covered
  r := public.access_check(ev, 'KID-4', null, false);
  if (r ->> 'granted')::boolean or r ->> 'reason' <> 'not_allowed' then raise exception 'other class must be denied: %', r; end if;
  -- add her as a specific person
  insert into public.access_allowed (event_id, person_id) values (ev, '50000000-0000-0000-0000-000000000004');
  r := public.access_check(ev, 'KID-4', null, false);
  if not (r ->> 'granted')::boolean then raise exception 'listed person must pass: %', r; end if;

  -- rule: points >= 20 (root AND)
  insert into public.access_rules (event_id, name, kind, params) values (ev, '٢٠ نقطة على الأقل', 'points', '{"op":"gte","value":20}');
  r := public.access_check(ev, 'KID-1', null, false);   -- 30 pts
  if not (r ->> 'granted')::boolean then raise exception 'mina (30 pts) must pass: %', r; end if;
  r := public.access_check(ev, 'KID-2', null, false);   -- 5 pts
  if (r ->> 'granted')::boolean or r ->> 'reason' <> 'rules' then raise exception 'mariam (5 pts) must fail on rules: %', r; end if;
  if (r -> 'rules' -> 'rules' -> 0 ->> 'fulfilled')::boolean then raise exception 'rule status must be not fulfilled: %', r; end if;
  -- 5 seeded + 5 from the attendance_log trigger
  if (r -> 'rules' -> 'rules' -> 0 ->> 'actual')::numeric <> 10 then raise exception 'actual points must be 10: %', r; end if;
  if (r ->> 'allowed')::boolean is not true then raise exception 'allowed flag must still be true'; end if;

  -- disable the rule → passes again
  update public.access_rules set enabled = false where event_id = ev;
  r := public.access_check(ev, 'KID-2', null, false);
  if not (r ->> 'granted')::boolean then raise exception 'disabled rule must be ignored: %', r; end if;
  if (r -> 'rules' -> 'rules' -> 0 ->> 'enabled')::boolean then raise exception 'rule must be reported disabled'; end if;
  update public.access_rules set enabled = true where event_id = ev;

  -- OR group: (attended اجتماع الصلاة) OR (gender = female)
  insert into public.access_rule_groups (event_id, name, op) values (ev, 'أحدهما', 'or') returning id into g_or;
  insert into public.access_rules (event_id, group_id, name, kind, params) values
    (ev, g_or, 'حضر اجتماع الصلاة', 'attended_events', '{"event_ids":["70000000-0000-0000-0000-000000000002"],"mode":"all"}'),
    (ev, g_or, 'بنت', 'gender', '{"value":"female"}');
  -- mina: 30 pts ✔ AND (attended prayer ✔ OR female ✘) → pass
  r := public.access_check(ev, 'KID-1', null, false);
  if not (r ->> 'granted')::boolean then raise exception 'mina must pass the OR group: %', r; end if;
  select count(*) into n from jsonb_array_elements(r -> 'rules' -> 'rules') x where (x ->> 'fulfilled')::boolean;
  if n <> 2 then raise exception 'mina must fulfil 2 of 3 rules, got %', n; end if;
  if jsonb_array_length(r -> 'rules' -> 'groups') <> 1 or not (r -> 'rules' -> 'groups' -> 0 ->> 'ok')::boolean then
    raise exception 'group must be reported ok: %', r -> 'rules' -> 'groups';
  end if;
  -- sara: 40 pts ✔ AND (attended ✘ OR female ✔) → pass
  r := public.access_check(ev, 'KID-4', null, false);
  if not (r ->> 'granted')::boolean then raise exception 'sara must pass: %', r; end if;
  -- switch group to AND → sara fails (never attended prayer)
  update public.access_rule_groups set op = 'and' where id = g_or;
  r := public.access_check(ev, 'KID-4', null, false);
  if (r ->> 'granted')::boolean then raise exception 'sara must fail the AND group: %', r; end if;
  update public.access_rule_groups set op = 'or' where id = g_or;

  -- root OR: 5-pt mariam passes because she is female
  update public.access_events set root_op = 'or' where id = ev;
  r := public.access_check(ev, 'KID-2', null, false);
  if not (r ->> 'granted')::boolean then raise exception 'root OR must let mariam in: %', r; end if;
  update public.access_events set root_op = 'and' where id = ev;

  -- age + attendance_count + person_field + enrolled_in + not_entered
  delete from public.access_rules where event_id = ev;
  delete from public.access_rule_groups where event_id = ev;
  insert into public.access_rules (event_id, name, kind, params) values
    (ev, 'العمر ٩–١١', 'age', '{"op":"between","value":9,"value2":11}'),
    (ev, 'حضر مرتين على الأقل', 'attendance_count', '{"op":"gte","value":2}'),
    (ev, 'مسجّل في مدارس الأحد', 'enrolled_in', '{"church_id":"10000000-0000-0000-0000-000000000001","service_id":"20000000-0000-0000-0000-000000000001"}'),
    (ev, 'لم يدخل اليوم', 'not_entered', '{"period":"day"}');
  r := public.access_check(ev, 'KID-1', null, true);   -- logged!
  if not (r ->> 'granted')::boolean then raise exception 'mina must pass the 4 rules: %', r; end if;
  if r ->> 'log_id' is null then raise exception 'a log row must be written'; end if;
  -- second scan the same day → not_entered fails
  r := public.access_check(ev, 'KID-1', null, false);
  if (r ->> 'granted')::boolean then raise exception 'second entry the same day must be refused: %', r; end if;
  if (r -> 'summary' ->> 'entered_today')::int <> 1 then raise exception 'entered_today must be 1: %', r -> 'summary'; end if;
  -- rule status list contains all 4 with fulfilled flags
  if jsonb_array_length(r -> 'rules' -> 'rules') <> 4 then raise exception 'must report 4 rules'; end if;

  -- attendance_count with a date window counts the log rows
  update public.access_rules set params = jsonb_build_object('op', 'gte', 'value', 1, 'from', (current_date - 4)::text) where kind = 'attendance_count' and event_id = ev;
  delete from public.access_rules where kind = 'not_entered' and event_id = ev;
  r := public.access_check(ev, 'KID-1', null, false);
  if not (r ->> 'granted')::boolean then raise exception 'window attendance must count the -3d row: %', r; end if;
  r := public.access_check(ev, 'KID-2', null, false);
  if exists (select 1 from jsonb_array_elements(r -> 'rules' -> 'rules') x where x ->> 'kind' = 'attendance_count' and (x ->> 'fulfilled')::boolean) then
    raise exception 'mariam attended only 7 days ago — window rule must fail';
  end if;

  -- unknown code
  r := public.access_check(ev, 'NOPE', null, false);
  if (r ->> 'matched')::boolean or r ->> 'reason' <> 'not_found' then raise exception 'unknown code: %', r; end if;

  -- inactive event → denied
  update public.access_events set is_active = false where id = ev;
  r := public.access_check(ev, 'KID-1', null, false);
  if (r ->> 'granted')::boolean or r ->> 'reason' <> 'inactive' then raise exception 'inactive must deny: %', r; end if;
  update public.access_events set is_active = true where id = ev;

  -- allow_all skips the list: يوسف (church ب) is measured on his own enrollments
  update public.access_events set allow_all = true where id = ev;
  delete from public.access_rules where event_id = ev;
  insert into public.access_rules (event_id, name, kind, params) values (ev, '٥٠ نقطة', 'points', '{"op":"gte","value":50}');
  r := public.access_check(ev, 'KID-3', null, false);
  if not (r ->> 'granted')::boolean then raise exception 'allow_all + 100 pts must pass: %', r; end if;
  if (r -> 'summary' ->> 'in_scope')::boolean then raise exception 'yousef is out of the event scope'; end if;

  -- search
  r := public.access_search_persons('مي');
  if jsonb_array_length(r) < 1 then raise exception 'search must find مينا'; end if;
  -- the service manager cannot see كنيسة ب persons
  r := public.access_search_persons('يوسف');
  if jsonb_array_length(r) <> 0 then raise exception 'search must be scoped'; end if;
end $$;

-- ---------- B. class servant: can check, cannot manage ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
do $$
declare ev uuid; r jsonb;
begin
  if (public.access_permissions() ->> 'manage')::boolean then raise exception 'class servant must not manage by default'; end if;
  if not (public.access_permissions() ->> 'check')::boolean then raise exception 'class servant must be able to check'; end if;
  select id into ev from public.access_events limit 1;
  if ev is null then raise exception 'class servant must see the service-level event'; end if;
  r := public.access_check(ev, 'KID-1', null, false);
  if not (r ->> 'matched')::boolean then raise exception 'class servant check failed: %', r; end if;
  begin
    insert into public.access_rules (event_id, name, kind, params) values (ev, 'x', 'points', '{}');
    raise exception 'class servant must not insert rules';
  exception when insufficient_privilege or check_violation then null;
  end;
  begin
    insert into public.access_events (church_id, name) values ('10000000-0000-0000-0000-000000000001', 'x');
    raise exception 'class servant must not create events';
  exception when insufficient_privilege or check_violation then null;
  end;
end $$;

-- ---------- C. group / rule must stay within one event ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$
declare ev1 uuid; ev2 uuid; g uuid;
begin
  select id into ev1 from public.access_events limit 1;
  insert into public.access_events (church_id, name) values ('10000000-0000-0000-0000-000000000002', 'بوابة ب') returning id into ev2;
  insert into public.access_rule_groups (event_id, op) values (ev1, 'and') returning id into g;
  begin
    insert into public.access_rules (event_id, group_id, name, kind) values (ev2, g, 'x', 'gender');
    raise exception 'rule in a group of another event must fail';
  exception when check_violation then null;
  end;
  -- owner sees the log rows
  if (select count(*) from public.access_log) < 1 then raise exception 'log must have rows'; end if;
end $$;
reset role;

rollback;
\echo ACCESS CONTROL TESTS PASSED
