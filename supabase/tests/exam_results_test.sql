-- =====================================================================
-- Functional test for migration 0038 (نتائج الامتحانات). Run on the local
-- shim DB after run_migrations.sh:  psql -d app -f supabase/tests/exam_results_test.sql
-- Every assert raises on failure; a clean run ends with «EXAM RESULTS TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
begin;

-- ---------- seed ----------
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000002'),  -- class servant (class A) — no permission profiles
  ('00000000-0000-0000-0000-000000000003'),  -- class servant (class A) — with "enter" profile
  ('00000000-0000-0000-0000-000000000004');  -- service manager
insert into public.churches (id, name) values ('10000000-0000-0000-0000-000000000001', 'كنيسة');
insert into public.services (id, church_id, name) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل ب');
insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null),
  ('00000000-0000-0000-0000-000000000002', 'خادم أ', 'servant_a', '0101', 'class_servant', 'approved',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000003', 'خادم ب', 'servant_b', '0102', 'class_servant', 'approved',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000004', 'مسؤول الخدمة', 'svc_mgr', '0103', 'service_manager', 'approved',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null);
insert into public.persons (id, national_id, name) values
  ('40000000-0000-0000-0000-000000000001', '1001', 'John'),
  ('40000000-0000-0000-0000-000000000002', '1002', 'Peter'),
  ('40000000-0000-0000-0000-000000000003', '1003', 'Mary'),
  ('40000000-0000-0000-0000-000000000004', '1004', 'Mark');
insert into public.enrollments (id, person_id, church_id, service_id, class_id) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');
-- permission profile "enter results" for servant B
insert into public.permission_profiles (id, name, permissions) values ('70000000-0000-0000-0000-000000000001', 'إدخال نتائج', array['results.enter']);
insert into public.permissions (servant_id, permission_profile_id) values ('00000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000001');

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
begin perform set_config('role', 'postgres', true); end $$;

-- ---------- 1. module NOT granted → nothing ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');
do $$ begin
  if (public.result_permissions()->>'view')::boolean then raise exception 'view without grant'; end if;
  begin
    insert into public.result_exams (church_id, name) values ('10000000-0000-0000-0000-000000000001', 'x');
    raise exception 'insert allowed without grant';
  exception when insufficient_privilege then null; end;
end $$;

-- grant the module to the church (owner)
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
insert into public.module_access (module_key, church_id) values ('results', '10000000-0000-0000-0000-000000000001');

-- ---------- 2. grading system (owner, global) ----------
insert into public.grading_systems (id, church_id, name) values ('80000000-0000-0000-0000-000000000001', null, 'التقدير العام');
insert into public.grading_grades (grading_system_id, name, min_percent, max_percent, sort_order) values
  ('80000000-0000-0000-0000-000000000001', 'Grade 1', 90, 100, 1),
  ('80000000-0000-0000-0000-000000000001', 'Grade 2', 80, 89.99, 2),
  ('80000000-0000-0000-0000-000000000001', 'Grade 3', 70, 79.99, 3),
  ('80000000-0000-0000-0000-000000000001', 'Grade 4', 60, 69.99, 4),
  ('80000000-0000-0000-0000-000000000001', 'Grade 5', 0, 59.99, 5);
do $$ begin
  if (select name from public.grading_grades where id = public.grade_for_percent('80000000-0000-0000-0000-000000000001', 88.8)) <> 'Grade 2' then raise exception 'grade lookup 88.8'; end if;
  if (select name from public.grading_grades where id = public.grade_for_percent('80000000-0000-0000-0000-000000000001', 90)) <> 'Grade 1' then raise exception 'grade lookup 90'; end if;
  if (select name from public.grading_grades where id = public.grade_for_percent('80000000-0000-0000-0000-000000000001', 59.995)) <> 'Grade 4' then raise exception 'grade lookup rounding'; end if;
  if (select created_by from public.grading_systems where id = '80000000-0000-0000-0000-000000000001') <> '00000000-0000-0000-0000-000000000001' then raise exception 'grading created_by'; end if;
end $$;

-- ---------- 3. service manager creates exam + subjects ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');
do $$ begin
  if not (public.result_permissions()->>'manage_exams')::boolean then raise exception 'manager should manage exams'; end if;
  if not (public.result_permissions()->>'lock')::boolean then raise exception 'manager should lock'; end if;
end $$;
insert into public.result_exams (id, church_id, service_id, class_id, name, exam_date, grading_system_id, pass_percent, status)
values ('90000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
        'Final Exam 2026', '2026-06-20', '80000000-0000-0000-0000-000000000001', 60, 'open');
insert into public.result_subjects (id, exam_id, name, code, full_degree, pass_degree, sort_order) values
  ('a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'Bible', 'BIB', 100, 60, 1),
  ('a0000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001', 'Hymns', 'HYM', 50, 30, 2),
  ('a0000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000001', 'Theology', 'THE', 100, 60, 3);
do $$ begin
  if (select created_by from public.result_exams where id = '90000000-0000-0000-0000-000000000001') <> '00000000-0000-0000-0000-000000000004' then raise exception 'created_by not stamped'; end if;
end $$;
-- pass > full rejected
do $$ begin
  insert into public.result_subjects (exam_id, name, full_degree, pass_degree) values ('90000000-0000-0000-0000-000000000001', 'bad', 10, 20);
  raise exception 'pass > full accepted';
exception when check_violation then null; end $$;

-- ---------- 4. class servant WITHOUT profile: view only ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ declare p jsonb := public.result_permissions(); begin
  if not (p->>'view')::boolean then raise exception 'servant should view'; end if;
  if (p->>'enter')::boolean then raise exception 'servant without profile should not enter'; end if;
  if (p->>'lock')::boolean then raise exception 'servant should not lock'; end if;
  if (select count(*) from public.result_exams) <> 1 then raise exception 'servant should see the exam'; end if;
  begin
    insert into public.exam_results (exam_id, subject_id, enrollment_id, score, person_id, church_id, service_id, class_id)
    values ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 50,
            '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001');
    raise exception 'insert allowed without enter permission';
  exception when insufficient_privilege then null; end;
end $$;

-- ---------- 5. class servant WITH "enter" profile: bulk entry ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
create temp table _r (k text primary key, v jsonb);
insert into _r values ('bulk', public.result_save_bulk('90000000-0000-0000-0000-000000000001', jsonb_build_array(
  jsonb_build_object('subject_id', 'a0000000-0000-0000-0000-000000000001', 'enrollment_id', '50000000-0000-0000-0000-000000000001', 'score', 85),
  jsonb_build_object('subject_id', 'a0000000-0000-0000-0000-000000000002', 'enrollment_id', '50000000-0000-0000-0000-000000000001', 'score', 42),
  jsonb_build_object('subject_id', 'a0000000-0000-0000-0000-000000000003', 'enrollment_id', '50000000-0000-0000-0000-000000000001', 'score', 95),
  jsonb_build_object('subject_id', 'a0000000-0000-0000-0000-000000000001', 'enrollment_id', '50000000-0000-0000-0000-000000000002', 'score', 120),  -- over full
  jsonb_build_object('subject_id', 'a0000000-0000-0000-0000-000000000001', 'enrollment_id', '50000000-0000-0000-0000-000000000004', 'score', 50),   -- class B → invisible
  jsonb_build_object('subject_id', 'a0000000-0000-0000-0000-000000000001', 'enrollment_id', '50000000-0000-0000-0000-000000000003', 'status', 'absent')
)));
do $$ declare v jsonb := (select v from _r where k = 'bulk'); begin
  if jsonb_array_length(v) <> 6 then raise exception 'bulk should report 6 rows'; end if;
  if not (v->0->>'ok')::boolean or not (v->1->>'ok')::boolean or not (v->2->>'ok')::boolean then raise exception 'valid rows failed: %', v; end if;
  if (v->3->>'ok')::boolean or (v->3->>'error') <> 'score_over_full' then raise exception 'over-full should fail: %', v->3; end if;
  if (v->4->>'ok')::boolean then raise exception 'out-of-scope enrollment should fail: %', v->4; end if;
  if not (v->5->>'ok')::boolean then raise exception 'absent row failed: %', v->5; end if;
end $$;

-- computed per-subject values
do $$ declare r public.exam_results; begin
  select * into r from public.exam_results where subject_id = 'a0000000-0000-0000-0000-000000000002' and enrollment_id = '50000000-0000-0000-0000-000000000001';
  if r.percent <> 84 then raise exception 'hymns percent % <> 84', r.percent; end if;
  if (select name from public.grading_grades where id = r.grade_id) <> 'Grade 2' then raise exception 'hymns grade'; end if;
  if not r.passed then raise exception 'hymns should pass'; end if;
  if r.created_by <> '00000000-0000-0000-0000-000000000003' then raise exception 'created_by missing'; end if;
  select * into r from public.exam_results where subject_id = 'a0000000-0000-0000-0000-000000000001' and enrollment_id = '50000000-0000-0000-0000-000000000003';
  if r.score is not null or r.percent is not null or r.passed is not null then raise exception 'absent must not be zero by default'; end if;
end $$;

-- overall summary for John: 222/250 = 88.8% → Grade 2 → passed, rank 1
do $$ declare s record; begin
  select * into s from public.result_exam_summary('90000000-0000-0000-0000-000000000001') where name = 'John';
  if s.total_score <> 222 or s.total_full <> 250 then raise exception 'john totals % / %', s.total_score, s.total_full; end if;
  if s.percent <> 88.8 then raise exception 'john percent %', s.percent; end if;
  if s.grade_name <> 'Grade 2' then raise exception 'john grade %', s.grade_name; end if;
  if s.status <> 'passed' or not s.passed then raise exception 'john status %', s.status; end if;
  if s.rank <> 1 then raise exception 'john rank %', s.rank; end if;
  select * into s from public.result_exam_summary('90000000-0000-0000-0000-000000000001') where name = 'Peter';
  if s.status <> 'not_entered' or s.rank is not null then raise exception 'peter status %', s.status; end if;
  select * into s from public.result_exam_summary('90000000-0000-0000-0000-000000000001') where name = 'Mary';
  if s.status <> 'incomplete' then raise exception 'mary status % (1 absent of 3)', s.status; end if;
  -- class-A servant sees only his 3 students
  if (select count(*) from public.result_exam_summary('90000000-0000-0000-0000-000000000001')) <> 3 then raise exception 'summary scope'; end if;
end $$;

-- "enter" holder can't edit a completed row
do $$ begin
  update public.exam_results set score = 80 where subject_id = 'a0000000-0000-0000-0000-000000000001' and enrollment_id = '50000000-0000-0000-0000-000000000001';
  if found then raise exception 'enter-only servant edited a completed row'; end if;
end $$;

-- ---------- 6. ranking with ties (manager fills the rest) ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');
select public.result_save_bulk('90000000-0000-0000-0000-000000000001', jsonb_build_array(
  jsonb_build_object('subject_id', 'a0000000-0000-0000-0000-000000000001', 'enrollment_id', '50000000-0000-0000-0000-000000000002', 'score', 92),
  jsonb_build_object('subject_id', 'a0000000-0000-0000-0000-000000000002', 'enrollment_id', '50000000-0000-0000-0000-000000000002', 'score', 46),
  jsonb_build_object('subject_id', 'a0000000-0000-0000-0000-000000000003', 'enrollment_id', '50000000-0000-0000-0000-000000000003', 'score', 92),
  jsonb_build_object('subject_id', 'a0000000-0000-0000-0000-000000000003', 'enrollment_id', '50000000-0000-0000-0000-000000000002', 'score', 92),
  jsonb_build_object('subject_id', 'a0000000-0000-0000-0000-000000000002', 'enrollment_id', '50000000-0000-0000-0000-000000000003', 'score', 46)
)) \g /dev/null
-- Mary: absent Bible (not zero) → 138/150 = 92% ; Peter 230/250 = 92% → tie at rank 1, John rank 3
do $$ declare s record; begin
  select * into s from public.result_exam_summary('90000000-0000-0000-0000-000000000001') where name = 'Mary';
  if s.percent <> 92 or s.rank <> 1 or s.status <> 'passed' then raise exception 'mary % rank % status %', s.percent, s.rank, s.status; end if;
  select * into s from public.result_exam_summary('90000000-0000-0000-0000-000000000001') where name = 'Peter';
  if s.percent <> 92 or s.rank <> 1 then raise exception 'peter tie rank %', s.rank; end if;
  if s.rank_score <> 1 then raise exception 'peter rank by score %', s.rank_score; end if;
  select * into s from public.result_exam_summary('90000000-0000-0000-0000-000000000001') where name = 'John';
  if s.rank <> 3 then raise exception 'john rank after tie % (expected 3)', s.rank; end if;
  if s.rank_score <> 2 then raise exception 'john rank by score % (expected 2)', s.rank_score; end if;
end $$;

-- absent_as_zero → Mary drops
update public.result_exams set absent_as_zero = true where id = '90000000-0000-0000-0000-000000000001';
do $$ declare s record; begin
  select * into s from public.result_exam_summary('90000000-0000-0000-0000-000000000001') where name = 'Mary';
  if s.total_full <> 250 or s.percent <> 55.2 then raise exception 'mary absent-as-zero % / %', s.percent, s.total_full; end if;
  if s.status <> 'failed' then raise exception 'mary should fail at 55.2%%'; end if;
end $$;
update public.result_exams set absent_as_zero = false where id = '90000000-0000-0000-0000-000000000001';

-- changing a subject's full degree recomputes
update public.result_subjects set full_degree = 200, pass_degree = 120 where id = 'a0000000-0000-0000-0000-000000000001';
do $$ declare r public.exam_results; begin
  select * into r from public.exam_results where subject_id = 'a0000000-0000-0000-0000-000000000001' and enrollment_id = '50000000-0000-0000-0000-000000000001';
  if r.percent <> 42.5 or r.passed then raise exception 'recalc after full change % %', r.percent, r.passed; end if;
end $$;
update public.result_subjects set full_degree = 100, pass_degree = 60 where id = 'a0000000-0000-0000-0000-000000000001';

-- ---------- 7. lock ----------
do $$ begin
  update public.result_exams set locked = true where id = '90000000-0000-0000-0000-000000000001';
  raise exception 'direct lock update accepted';
exception when others then if sqlerrm <> 'use_lock_rpc' then raise; end if; end $$;
select public.result_exam_set_lock('90000000-0000-0000-0000-000000000001', true) \g /dev/null
do $$ begin
  if not (select locked from public.result_exams where id = '90000000-0000-0000-0000-000000000001') then raise exception 'not locked'; end if;
  if (select status from public.result_exams where id = '90000000-0000-0000-0000-000000000001') <> 'completed' then raise exception 'lock should complete'; end if;
  if (select locked_by from public.result_exams where id = '90000000-0000-0000-0000-000000000001') <> '00000000-0000-0000-0000-000000000004' then raise exception 'locked_by'; end if;
end $$;
-- servant with enter profile is blocked while locked
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
do $$ declare v jsonb; begin
  v := public.result_save_bulk('90000000-0000-0000-0000-000000000001', jsonb_build_array(
    jsonb_build_object('subject_id', 'a0000000-0000-0000-0000-000000000002', 'enrollment_id', '50000000-0000-0000-0000-000000000004', 'score', 1)));
  if (v->0->>'ok')::boolean then raise exception 'write on locked exam accepted'; end if;
  begin
    perform public.result_exam_set_lock('90000000-0000-0000-0000-000000000001', false);
    raise exception 'servant unlocked';
  exception when others then if sqlerrm <> 'forbidden' then raise; end if; end;
end $$;
-- manager can unlock
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');
select public.result_exam_set_lock('90000000-0000-0000-0000-000000000001', false) \g /dev/null
do $$ begin
  if (select locked from public.result_exams where id = '90000000-0000-0000-0000-000000000001') then raise exception 'still locked'; end if;
end $$;

-- ---------- 8. duplicate + copy + history + child portal ----------
create temp table _ids (k text primary key, v uuid);
insert into _ids values ('dup', public.result_exam_duplicate('90000000-0000-0000-0000-000000000001', 'Midterm 2026'));
update public.result_exams set status = 'open', exam_date = '2026-03-15' where id = (select v from _ids where k = 'dup');
do $$ declare n integer; begin
  if (select count(*) from public.result_subjects where exam_id = (select v from _ids where k = 'dup')) <> 3 then raise exception 'dup subjects'; end if;
  n := public.result_copy_from_exam('90000000-0000-0000-0000-000000000001', (select v from _ids where k = 'dup'));
  if n <> 9 then raise exception 'copied % rows (expected 9)', n; end if;
end $$;
do $$ declare n integer; begin
  select count(*) into n from public.result_student_history('40000000-0000-0000-0000-000000000001');
  if n <> 2 then raise exception 'john history % exams', n; end if;
end $$;
-- child portal: nothing until published
select pg_temp.as_anon();
do $$ begin
  if jsonb_array_length(public.child_portal_results('1001')) <> 0 then raise exception 'unpublished visible to child'; end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');
update public.result_exams set published_at = now() where id = '90000000-0000-0000-0000-000000000001';
select pg_temp.as_anon();
do $$ declare v jsonb := public.child_portal_results('1001'); begin
  if jsonb_array_length(v) <> 1 then raise exception 'child should see 1 exam'; end if;
  if (v->0->>'percent')::numeric <> 88.8 or (v->0->>'grade_name') <> 'Grade 2' then raise exception 'child payload %', v->0; end if;
  if jsonb_array_length(v->0->'subjects') <> 3 then raise exception 'child subjects'; end if;
end $$;

-- ---------- 9. clear ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');
do $$ declare n integer; begin
  n := public.result_clear((select v from _ids where k = 'dup'), 'a0000000-0000-0000-0000-000000000001', null);
  if n <> 0 then raise exception 'subject id of another exam cleared %', n; end if;
  n := public.result_clear((select v from _ids where k = 'dup'));
  if n <> 9 then raise exception 'clear all % (expected 9)', n; end if;
end $$;

select pg_temp.as_super();
rollback;
\echo EXAM RESULTS TESTS PASSED
