-- =====================================================================
-- Functional test for migration 0039 (المكتبة). Run on the local shim DB
-- after run_migrations.sh:  psql -d app -f supabase/tests/library_module_test.sql
-- Every assert raises on failure; a clean run ends with «LIBRARY TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
begin;

-- ---------- seed ----------
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000002'),  -- class servant (class A) — no profiles
  ('00000000-0000-0000-0000-000000000003'),  -- class servant (class B) — with "manage" profile
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
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000004', 'مسؤول الخدمة', 'svc_mgr', '0103', 'service_manager', 'approved',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null);
insert into public.persons (id, national_id, name) values
  ('40000000-0000-0000-0000-000000000001', '1001', 'John'),    -- class A
  ('40000000-0000-0000-0000-000000000002', '1002', 'Peter');   -- class B
insert into public.enrollments (id, person_id, church_id, service_id, class_id) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');
insert into public.permission_profiles (id, name, permissions) values ('70000000-0000-0000-0000-000000000001', 'إدارة المكتبة', array['library.manage']);
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
  if (public.library_permissions()->>'view')::boolean then raise exception 'view without grant'; end if;
  begin
    insert into public.library_subjects (name) values ('x');
    raise exception 'insert allowed without grant';
  exception when insufficient_privilege then null; end;
end $$;

-- grant the module to the church (owner)
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
insert into public.module_access (module_key, church_id) values ('library', '10000000-0000-0000-0000-000000000001');

-- ---------- 2. permissions ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');   -- class servant A, no profile
do $$ begin
  if not (public.library_permissions()->>'view')::boolean then raise exception 'servant should view'; end if;
  if (public.library_permissions()->>'manage')::boolean then raise exception 'servant should NOT manage'; end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');   -- class servant B with manage profile
do $$ begin
  if not (public.library_permissions()->>'manage')::boolean then raise exception 'profile should grant manage'; end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');   -- service manager
do $$ begin
  if not (public.library_permissions()->>'manage')::boolean then raise exception 'manager should manage'; end if;
end $$;

-- ---------- 3. owner creates subjects with different audiences ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
insert into public.library_subjects (id, name, audience) values
  ('80000000-0000-0000-0000-000000000001', 'الكتاب المقدس', 'everyone'),
  ('80000000-0000-0000-0000-000000000002', 'الخدام', 'servants');
insert into public.library_subjects (id, name, audience, church_id, service_id, class_id) values
  ('80000000-0000-0000-0000-000000000003', 'فصل أ فقط', 'class',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001');
-- invalid audience / scope combos rejected
do $$ begin
  begin
    insert into public.library_subjects (name, audience, church_id) values ('bad', 'everyone', '10000000-0000-0000-0000-000000000001');
    raise exception 'everyone with church accepted';
  exception when check_violation then null; end;
  begin
    insert into public.library_subjects (name, audience, church_id) values ('bad', 'service', '10000000-0000-0000-0000-000000000001');
    raise exception 'service without service_id accepted';
  exception when check_violation then null; end;
end $$;

insert into public.library_books (id, subject_id, title, author, pdf_url) values
  ('81000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 'مقدمة الكتاب المقدس', 'أ. مؤلف', 'https://example.com/a.pdf');
insert into public.library_books (id, subject_id, title, pdf_url, audience) values
  ('81000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000001', 'كتاب للخدام', 'https://example.com/b.pdf', 'servants');
insert into public.library_lectures (id, subject_id, title, speaker, kind, media_url) values
  ('82000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 'مقدمة', 'أبونا', 'video', 'https://youtu.be/x'),
  ('82000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000003', 'محاضرة فصل أ', 'أبونا', 'voice', 'https://example.com/a.mp3');
do $$ begin
  begin
    insert into public.library_books (subject_id, title, pdf_url) values ('80000000-0000-0000-0000-000000000001', 'x', '  ');
    raise exception 'blank url accepted';
  exception when check_violation then null; end;
end $$;

-- ---------- 4. visibility for servants ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');   -- class B servant
do $$ begin
  -- sees everyone + servants, NOT class A subject
  if (select count(*) from public.library_subjects) <> 2 then raise exception 'class B servant subject count'; end if;
  if exists (select 1 from public.library_subjects where id = '80000000-0000-0000-0000-000000000003') then raise exception 'class A subject leaked'; end if;
  if (select count(*) from public.library_books) <> 2 then raise exception 'books count for servant'; end if;
  if (select count(*) from public.library_lectures) <> 1 then raise exception 'lectures: class A lecture leaked'; end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');   -- class A servant
do $$ begin
  if (select count(*) from public.library_subjects) <> 3 then raise exception 'class A servant should see 3'; end if;
  if (select count(*) from public.library_lectures) <> 2 then raise exception 'class A servant should see 2 lectures'; end if;
  -- no manage permission → insert rejected
  begin
    insert into public.library_books (subject_id, title, pdf_url) values ('80000000-0000-0000-0000-000000000001', 'x', 'https://x');
    raise exception 'insert allowed without manage';
  exception when insufficient_privilege then null; end;
end $$;

-- class B servant with manage profile: may write global content and his class, not class A
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
insert into public.library_books (subject_id, title, pdf_url) values ('80000000-0000-0000-0000-000000000001', 'من خادم ب', 'https://x/b.pdf');
insert into public.library_lectures (subject_id, title, kind, media_url, audience, church_id, service_id, class_id) values
  ('80000000-0000-0000-0000-000000000001', 'لفصل ب', 'voice', 'https://x/b.mp3', 'class',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');
do $$ begin
  begin
    insert into public.library_lectures (subject_id, title, kind, media_url, audience, church_id, service_id, class_id) values
      ('80000000-0000-0000-0000-000000000001', 'لفصل أ', 'voice', 'https://x/a.mp3', 'class',
       '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001');
    raise exception 'class B servant wrote class A content';
  exception when insufficient_privilege then null; end;
end $$;

-- ---------- 5. favorites (servant) ----------
insert into public.library_favorites (user_id, book_id) values ('00000000-0000-0000-0000-000000000003', '81000000-0000-0000-0000-000000000001');
do $$ begin
  if (select count(*) from public.library_favorites) <> 1 then raise exception 'fav count'; end if;
  begin
    insert into public.library_favorites (user_id, book_id) values ('00000000-0000-0000-0000-000000000002', '81000000-0000-0000-0000-000000000001');
    raise exception 'fav for another user accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.library_favorites (user_id, book_id) values ('00000000-0000-0000-0000-000000000003', '81000000-0000-0000-0000-000000000001');
    raise exception 'duplicate fav accepted';
  exception when unique_violation then null; end;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ begin
  if (select count(*) from public.library_favorites) <> 0 then raise exception 'favorites of others leaked'; end if;
end $$;

-- ---------- 6. child portal ----------
select pg_temp.as_anon();
do $$
declare r jsonb;
begin
  r := public.child_portal_library('1001');                       -- John, class A
  if jsonb_array_length(r->'subjects') <> 2 then raise exception 'child A subjects: % (expected everyone + class A)', jsonb_array_length(r->'subjects'); end if;
  if exists (select 1 from jsonb_array_elements(r->'subjects') s where s->>'name' = 'الخدام') then raise exception 'servants subject leaked to child'; end if;
  if jsonb_array_length(r->'books') <> 2 then raise exception 'child A books: % (servants-only book must be hidden)', jsonb_array_length(r->'books'); end if;
  if jsonb_array_length(r->'lectures') <> 2 then raise exception 'child A lectures: %', jsonb_array_length(r->'lectures'); end if;

  r := public.child_portal_library('1002');                       -- Peter, class B
  if jsonb_array_length(r->'subjects') <> 1 then raise exception 'child B subjects: %', jsonb_array_length(r->'subjects'); end if;
  if jsonb_array_length(r->'lectures') <> 2 then raise exception 'child B lectures: % (intro + class B)', jsonb_array_length(r->'lectures'); end if;

  -- favorite toggle
  perform public.child_portal_library_favorite('1001', '81000000-0000-0000-0000-000000000001', null, true);
  r := public.child_portal_library('1001');
  if jsonb_array_length(r->'favorites') <> 1 then raise exception 'child fav not saved'; end if;
  perform public.child_portal_library_favorite('1001', '81000000-0000-0000-0000-000000000001', null, false);
  r := public.child_portal_library('1001');
  if jsonb_array_length(r->'favorites') <> 0 then raise exception 'child fav not removed'; end if;
  -- cannot favorite hidden content
  begin
    perform public.child_portal_library_favorite('1001', '81000000-0000-0000-0000-000000000002', null, true);
    raise exception 'child favorited servants-only book';
  exception when sqlstate 'P0002' then null; end;
end $$;

-- module not granted for the child's scope → empty
select pg_temp.as_super();
delete from public.module_access where module_key = 'library';
select pg_temp.as_anon();
do $$
declare r jsonb;
begin
  r := public.child_portal_library('1001');
  if jsonb_array_length(r->'subjects') <> 0 then raise exception 'child sees library without grant'; end if;
end $$;

-- ---------- 7. cascade delete ----------
select pg_temp.as_super();
delete from public.library_subjects where id = '80000000-0000-0000-0000-000000000001';
do $$ begin
  if exists (select 1 from public.library_books where subject_id = '80000000-0000-0000-0000-000000000001') then raise exception 'books not cascaded'; end if;
  if exists (select 1 from public.library_favorites) then raise exception 'favorites not cascaded'; end if;
end $$;

rollback;
\echo LIBRARY TESTS PASSED
