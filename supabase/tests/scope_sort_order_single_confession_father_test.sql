-- =====================================================================
-- Functional test for 20260928130000
--   (A) manual order of churches / services / classes
--   (B) one confession father per person
--   psql -d app -f supabase/tests/scope_sort_order_single_confession_father_test.sql
-- Ends with «SCOPE ORDER + SINGLE CONFESSION FATHER TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000002'),  -- church manager of كنيسة أ
  ('00000000-0000-0000-0000-000000000006');  -- class servant
insert into public.churches (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'كنيسة ب'),
  ('10000000-0000-0000-0000-000000000002', 'كنيسة أ');
insert into public.services (id, church_id, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'اجتماع الشباب'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'خدمة أخرى');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل ج'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل ب');
insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id, approved_at) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null, now()),
  ('00000000-0000-0000-0000-000000000002', 'مدير', 'cm', '0102', 'church_manager', 'approved', '10000000-0000-0000-0000-000000000001', null, null, now()),
  ('00000000-0000-0000-0000-000000000006', 'خادم', 'cs', '0106', 'class_servant', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', now());

-- ---------- A1. new rows are numbered at the end of their siblings ----------
do $$
declare o1 int; o2 int; o3 int;
begin
  -- inserted without sort_order → 1, 2 (insert order, the trigger appends)
  select sort_order into o1 from public.churches where id = '10000000-0000-0000-0000-000000000001';
  select sort_order into o2 from public.churches where id = '10000000-0000-0000-0000-000000000002';
  if o1 <> 1 or o2 <> 2 then raise exception 'churches must be appended 1,2 (got %, %)', o1, o2; end if;
  select sort_order into o1 from public.services where id = '20000000-0000-0000-0000-000000000001';
  select sort_order into o2 from public.services where id = '20000000-0000-0000-0000-000000000002';
  select sort_order into o3 from public.services where id = '20000000-0000-0000-0000-000000000003';
  if o1 <> 1 or o2 <> 2 or o3 <> 1 then raise exception 'services must be numbered per church (got %, %, %)', o1, o2, o3; end if;
  select sort_order into o3 from public.classes where id = '30000000-0000-0000-0000-000000000003';
  if o3 <> 3 then raise exception 'third class must be 3 (got %)', o3; end if;
end $$;

-- ---------- A2. the owner reorders churches; a church manager his classes; a servant may not ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set local request.jwt.claim.role = 'authenticated';
select public.reorder_scope_items('churches', array['10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001']::uuid[]);
do $$
declare o1 int; o2 int;
begin
  select sort_order into o1 from public.churches where id = '10000000-0000-0000-0000-000000000001';
  select sort_order into o2 from public.churches where id = '10000000-0000-0000-0000-000000000002';
  if o2 <> 1 or o1 <> 2 then raise exception 'owner reorder failed (%, %)', o1, o2; end if;
end $$;

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
-- classes of his church: أ · ب · ج
select public.reorder_scope_items('classes', array[
  '30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001']::uuid[]);
do $$
declare names text;
begin
  select string_agg(name, ' · ' order by sort_order) into names from public.classes where service_id = '20000000-0000-0000-0000-000000000001';
  if names <> 'فصل أ · فصل ب · فصل ج' then raise exception 'church manager reorder failed: %', names; end if;
end $$;
-- a church manager may NOT reorder churches (RLS: no update)
do $$
declare ok boolean := false;
begin
  begin
    perform public.reorder_scope_items('churches', array['10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002']::uuid[]);
  exception when others then ok := sqlerrm like '%forbidden%'; end;
  if not ok then raise exception 'church manager must not reorder churches'; end if;
end $$;
-- a class servant may not reorder classes
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
do $$
declare ok boolean := false;
begin
  begin
    perform public.reorder_scope_items('classes', array['30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002']::uuid[]);
  exception when others then ok := sqlerrm like '%forbidden%'; end;
  if not ok then raise exception 'class servant must not reorder classes'; end if;
end $$;
-- an unknown table is refused
do $$
declare ok boolean := false;
begin
  begin
    perform public.reorder_scope_items('persons', array['30000000-0000-0000-0000-000000000001']::uuid[]);
  exception when others then ok := sqlerrm like '%invalid_table%'; end;
  if not ok then raise exception 'unknown table must be refused'; end if;
end $$;
reset role;

-- ---------- B. one confession father per person ----------
-- a child + two approved priests (owner adds them directly)
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
set local request.jwt.claim.role = 'authenticated';
select public.add_person_and_enroll('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000001', 'مينا', 'KID-1', 'male', null, '+201000000001', null, null, null, 0, null);
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select public.owner_add_priest('PR-1', 'أبونا يوحنا', 'pass123', '10000000-0000-0000-0000-000000000001', 'القمص');
select public.owner_add_priest('PR-2', 'أبونا بولس', 'pass456', '10000000-0000-0000-0000-000000000001', 'القس');
reset role;

set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.role = 'anon';
do $$
declare t1 text; t2 text; r jsonb; kid uuid; n int; l jsonb;
begin
  t1 := (public.priest_login('PR-1', 'pass123', true, null))->>'token';
  t2 := (public.priest_login('PR-2', 'pass456', true, null))->>'token';
  select id into kid from public.persons where national_id = 'KID-1';

  -- priest 1 takes him
  r := public.priest_add_confessor(t1, kid, null, null);
  if r->>'moved_from' is not null then raise exception 'first add must not report a move'; end if;

  -- priest 2 sees «يعترف عند أبونا يوحنا» in the code lookup
  l := public.priest_lookup_code(t2, 'KID-1');
  if l->>'other_priest' <> 'أبونا يوحنا' then raise exception 'lookup must name the other priest (got %)', l->>'other_priest'; end if;

  -- priest 2 takes him → moved, priest 1 loses him
  r := public.priest_add_confessor(t2, kid, null, null);
  if r->>'moved_from' <> 'أبونا يوحنا' then raise exception 'move must report the previous priest'; end if;
  select count(*) into n from public.priest_confessors where person_id = kid;
  if n <> 1 then raise exception 'exactly one confession father expected, got %', n; end if;
  if jsonb_array_length(public.priest_confessors_list(t1)) <> 0 then raise exception 'priest 1 must have lost him'; end if;
  if jsonb_array_length(public.priest_confessors_list(t2)) <> 1 then raise exception 'priest 2 must have him'; end if;

  -- recording a confession at priest 1 moves him back (the binding follows the last action)
  perform public.priest_record_confession(t1, kid, null, null, null);
  select count(*) into n from public.priest_confessors where person_id = kid;
  if n <> 1 then raise exception 'still one father expected, got %', n; end if;
  if jsonb_array_length(public.priest_confessors_list(t2)) <> 0 then raise exception 'priest 2 must have lost him after the confession at priest 1'; end if;

end $$;
reset role;

-- direct insert of a second father is impossible (unique index) — the trigger removes the old one first,
-- so the insert succeeds and the old row is gone
do $$
declare kid uuid; p1 uuid; p2 uuid; n int;
begin
  select id into kid from public.persons where national_id = 'KID-1';
  select p.id into p1 from public.priests p join public.persons x on x.id = p.person_id where x.national_id = 'PR-1';
  select p.id into p2 from public.priests p join public.persons x on x.id = p.person_id where x.national_id = 'PR-2';
  insert into public.priest_confessors (priest_id, person_id) values (p2, kid);
  select count(*) into n from public.priest_confessors where person_id = kid;
  if n <> 1 then raise exception 'trigger must keep one father, got %', n; end if;
  if not exists (select 1 from public.priest_confessors where person_id = kid and priest_id = p2) then raise exception 'new father must win'; end if;
end $$;

select 'SCOPE ORDER + SINGLE CONFESSION FATHER TESTS PASSED' as result;
rollback;
