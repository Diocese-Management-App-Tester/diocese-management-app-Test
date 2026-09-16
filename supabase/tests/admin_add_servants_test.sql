-- =====================================================================
-- Functional test for migration 0041 (إضافة خدام مباشرة — فردي / جماعي).
-- Run on the local shim DB after all migrations:
--   psql -d app -f supabase/tests/admin_add_servants_test.sql
-- Every assert raises on failure; a clean run ends with «ADMIN ADD SERVANTS TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000004'),  -- church manager
  ('00000000-0000-0000-0000-000000000005'),  -- service manager
  ('00000000-0000-0000-0000-000000000006'),  -- class servant (may NOT add)
  ('00000000-0000-0000-0000-000000000011'),  -- account A (added by owner)
  ('00000000-0000-0000-0000-000000000012'),  -- account B (added by church manager, existing person)
  ('00000000-0000-0000-0000-000000000013'),  -- account C (added by service manager)
  ('00000000-0000-0000-0000-000000000014'),  -- account D (should fail cases)
  ('00000000-0000-0000-0000-000000000015');  -- account E (bulk-ish)
insert into public.churches (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'كنيسة أ'),
  ('10000000-0000-0000-0000-000000000002', 'كنيسة ب');
insert into public.services (id, church_id, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'شباب'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'مدارس الأحد ب');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'فصل شباب');

insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, approved_at) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, now()),
  ('00000000-0000-0000-0000-000000000004', 'مدير', 'manager', '0104', 'church_manager', 'approved', '10000000-0000-0000-0000-000000000001', null, now()),
  ('00000000-0000-0000-0000-000000000005', 'مسؤول', 'svc', '0105', 'service_manager', 'approved', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', now()),
  ('00000000-0000-0000-0000-000000000006', 'خادم', 'cs', '0106', 'class_servant', 'approved', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', now());

insert into public.permission_profiles (id, name, permissions) values
  ('40000000-0000-0000-0000-000000000001', 'حضور', '{children.attendance}'),
  ('40000000-0000-0000-0000-000000000002', 'نقاط', '{children.points}');

-- an existing PERSON (a child card printed earlier) who becomes a servant
insert into public.persons (id, national_id, name, gender, phone) values
  ('50000000-0000-0000-0000-000000000001', 'CARD-777', 'مينا (قديم)', 'male', '+201000000777');

-- ---------- the RPC is for the SERVER only ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$ begin
  perform public.admin_add_servant('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000014', 'X1', 'x',
    'class_servant', '10000000-0000-0000-0000-000000000001');
  raise exception 'authenticated must not execute admin_add_servant';
exception when insufficient_privilege then null; end $$;

-- the code pre-check IS for authenticated managers
do $$
declare j jsonb;
begin
  j := public.admin_servant_code_lookup('CARD-777');
  if (j->>'login_taken')::boolean then raise exception 'CARD-777 login should be free'; end if;
  if j->'person'->>'name' <> 'مينا (قديم)' then raise exception 'lookup must return the person'; end if;
  if (j->'person'->>'has_account')::boolean then raise exception 'person has no account yet'; end if;
  j := public.admin_servant_code_lookup('manager');
  if not (j->>'login_taken')::boolean then raise exception 'manager login must be taken'; end if;
  if public.admin_servant_code_lookup('   ') is not null then raise exception 'blank → null'; end if;
end $$;
reset role;

-- ---------- 1. owner adds a service manager with 2 profiles ----------
do $$
declare r jsonb; s public.servant_enrollments%rowtype; p public.persons%rowtype;
begin
  r := public.admin_add_servant(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011',
    'SRV-001', 'جرجس فهمي', 'service_manager',
    '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', null,
    'male', '1990-05-01', '+201000000011', 'الأقصر', 'ملاحظة', 'https://x/img.webp',
    array['40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002']::uuid[]);
  if (r->>'user_id') <> 'srv-001' then raise exception 'login name should be normalized code, got %', r->>'user_id'; end if;
  if not (r->>'person_created')::boolean then raise exception 'person should be created'; end if;
  if (r->>'profiles_granted')::int <> 2 then raise exception 'expected 2 profiles granted, got %', r->>'profiles_granted'; end if;

  select * into s from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000011';
  if s.status <> 'approved' then raise exception 'must be approved immediately'; end if;
  if s.role <> 'service_manager' then raise exception 'role not applied'; end if;
  if s.approved_by <> '00000000-0000-0000-0000-000000000001' then raise exception 'approved_by should be the actor'; end if;
  if s.person_id is null then raise exception 'person not bound'; end if;
  if s.full_name <> 'جرجس فهمي' or s.phone <> '+201000000011' or s.photo_url <> 'https://x/img.webp' then
    raise exception 'mirrors not synced';
  end if;
  select * into p from public.persons where id = s.person_id;
  if p.national_id <> 'SRV-001' or p.gender <> 'male' or p.birthdate <> '1990-05-01' or p.address <> 'الأقصر' then
    raise exception 'person data wrong';
  end if;
  if p.created_by <> '00000000-0000-0000-0000-000000000001' then raise exception 'person.created_by should be the actor'; end if;
  if (select count(*) from public.permissions where servant_id = s.id) <> 2 then raise exception 'permission rows missing'; end if;
  if (select bool_and(granted_by = '00000000-0000-0000-0000-000000000001') from public.permissions where servant_id = s.id) is not true then
    raise exception 'granted_by should be the actor';
  end if;
end $$;

-- the same code again → code_taken
do $$ begin
  perform public.admin_add_servant('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000014',
    'srv-001', 'آخر', 'class_servant', '10000000-0000-0000-0000-000000000001');
  raise exception 'duplicate code must fail';
exception when unique_violation then null; end $$;
-- the same account again → already_registered
do $$ begin
  perform public.admin_add_servant('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011',
    'OTHER', 'آخر', 'class_servant', '10000000-0000-0000-0000-000000000001');
  raise exception 'duplicate account must fail';
exception when unique_violation then null; end $$;

-- ---------- 2. church manager adds a class servant using an EXISTING person's code ----------
do $$
declare r jsonb; s public.servant_enrollments%rowtype; p public.persons%rowtype;
begin
  r := public.admin_add_servant(
    '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000012',
    'CARD-777', 'مينا صموئيل', 'class_servant',
    '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
    null, '1995-01-01', null, null, null, null, '{}');
  if (r->>'person_created')::boolean then raise exception 'existing person must be reused'; end if;
  if (r->>'person_id') <> '50000000-0000-0000-0000-000000000001' then raise exception 'wrong person bound'; end if;
  select * into p from public.persons where id = '50000000-0000-0000-0000-000000000001';
  if p.name <> 'مينا صموئيل' then raise exception 'typed name should win'; end if;
  if p.gender <> 'male' or p.phone <> '+201000000777' then raise exception 'blanks must keep old values'; end if;
  if p.birthdate <> '1995-01-01' then raise exception 'birthdate should be filled'; end if;
  select * into s from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000012';
  if s.class_id <> '30000000-0000-0000-0000-000000000001' then raise exception 'class not applied'; end if;
  if s.phone <> '+201000000777' then raise exception 'phone mirror should come from the person'; end if;
end $$;

-- the person now HAS an account → adding him again with a fresh account fails
do $$ begin
  perform public.admin_add_servant('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000014',
    'CARD-777', 'مينا', 'class_servant', '10000000-0000-0000-0000-000000000001');
  raise exception 'person with account must be rejected';
exception when unique_violation then null; end $$;

-- ---------- 3. scope / role enforcement ----------
-- church manager → other church
do $$ begin
  perform public.admin_add_servant('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000014',
    'D1', 'د', 'class_servant', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003');
  raise exception 'church manager must stay in his church';
exception when insufficient_privilege then null; end $$;
-- church manager → church_manager role
do $$ begin
  perform public.admin_add_servant('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000014',
    'D2', 'د', 'church_manager', '10000000-0000-0000-0000-000000000001');
  raise exception 'church manager cannot grant church_manager';
exception when insufficient_privilege then null; end $$;
-- service manager → other service
do $$ begin
  perform public.admin_add_servant('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000014',
    'D3', 'د', 'class_servant', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002');
  raise exception 'service manager must stay in his service';
exception when insufficient_privilege then null; end $$;
-- service manager → service_manager role
do $$ begin
  perform public.admin_add_servant('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000014',
    'D4', 'د', 'service_manager', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');
  raise exception 'service manager cannot grant service_manager';
exception when insufficient_privilege then null; end $$;
-- class servant → nothing
do $$ begin
  perform public.admin_add_servant('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000014',
    'D5', 'د', 'class_servant', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');
  raise exception 'class servant cannot add servants';
exception when insufficient_privilege then null; end $$;
-- nobody grants owner
do $$ begin
  perform public.admin_add_servant('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000014',
    'D6', 'د', 'owner', '10000000-0000-0000-0000-000000000001');
  raise exception 'owner role must be refused';
exception when insufficient_privilege then null; end $$;
-- inconsistent chain
do $$ begin
  perform public.admin_add_servant('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000014',
    'D7', 'د', 'class_servant', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001');
  raise exception 'service outside church must fail';
exception when invalid_parameter_value then null; end $$;
-- missing church
do $$ begin
  perform public.admin_add_servant('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000014',
    'D8', 'د', 'class_servant', null);
  raise exception 'church is required';
exception when invalid_parameter_value then null; end $$;
-- nothing leaked from the failed attempts
do $$ begin
  if exists (select 1 from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000014') then
    raise exception 'failed attempts must not leave an enrollment';
  end if;
  if exists (select 1 from public.persons where national_id like 'D%') then
    raise exception 'failed attempts must not leave persons';
  end if;
end $$;

-- ---------- 4. service manager adds inside his service; minimal data ----------
do $$
declare r jsonb; s public.servant_enrollments%rowtype;
begin
  r := public.admin_add_servant('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000013',
    'S-13', 'كيرلس', 'class_servant', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');
  select * into s from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000013';
  if s.status <> 'approved' or s.service_id <> '20000000-0000-0000-0000-000000000001' then raise exception 'service manager add failed'; end if;
  if s.phone <> '' then raise exception 'phone mirror should be empty string when unknown'; end if;
  -- the new servant can log in and sees himself (RLS)
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000013', true);
  if (select count(*) from public.servant_enrollments where id = auth.uid()) <> 1 then raise exception 'new servant cannot see himself'; end if;
  if (select role from public.my_scope()) <> 'class_servant' then raise exception 'my_scope wrong for new servant'; end if;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- ---------- 5. profiles: unknown ids are ignored, no duplicates ----------
do $$
declare r jsonb;
begin
  r := public.admin_add_servant('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000015',
    'S-15', 'بولا', 'class_servant', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null,
    null, null, null, null, null, null,
    array['40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000dead']::uuid[]);
  if (r->>'profiles_granted')::int <> 1 then raise exception 'expected 1 profile granted, got %', r->>'profiles_granted'; end if;
end $$;

rollback;
\echo ADMIN ADD SERVANTS TESTS PASSED
