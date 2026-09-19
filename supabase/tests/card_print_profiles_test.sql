-- =====================================================================
-- Functional test for migration 0049 (ملفات الطباعة + service / class logos).
--   psql -d app -f supabase/tests/card_print_profiles_test.sql
-- Ends with «CARD PRINT PROFILES TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000002'),  -- church manager (church A)
  ('00000000-0000-0000-0000-000000000003');  -- class servant (class A1)
insert into public.churches (id, name, logo_url) values
  ('10000000-0000-0000-0000-000000000001', 'كنيسة أ', 'https://x/church-a.png'),
  ('10000000-0000-0000-0000-000000000002', 'كنيسة ب', null);
insert into public.services (id, church_id, name, photo_url) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد', 'https://x/service.png');
insert into public.classes (id, church_id, service_id, name, photo_url) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ', 'https://x/class.png');

insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null),
  ('00000000-0000-0000-0000-000000000002', 'مدير أ', 'mgr', '0101', 'church_manager', 'approved', '10000000-0000-0000-0000-000000000001', null, null),
  ('00000000-0000-0000-0000-000000000003', 'خادم', 'srv', '0102', 'class_servant', 'approved', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001');

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('role', 'authenticated', true);
end $$;

-- 0024 seeds a global grant for `cards`; make sure it is there for the test
insert into public.module_access (module_key, church_id)
select 'cards', null where not exists (select 1 from public.module_access where module_key = 'cards');

-- ---------- A. owner: shared profile (church null) + church profile ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
insert into public.card_print_profiles (id, church_id, name, settings) values
  ('50000000-0000-0000-0000-000000000001', null, 'A4 قياسي — مشترك', '{"paper":"A4","orientation":"portrait","marginTop":10}'),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'A3 كنيسة ب', '{"paper":"A3"}');
do $$ begin
  if (select count(*) from public.card_print_profiles) <> 2 then raise exception 'A1: owner must see both profiles'; end if;
end $$;
reset role;

-- ---------- B. church manager: sees shared + own church, not other church; cannot write shared ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ begin
  if (select count(*) from public.card_print_profiles) <> 1 then
    raise exception 'B1: manager should see only the shared profile (got %)', (select count(*) from public.card_print_profiles);
  end if;
  if not exists (select 1 from public.card_print_profiles where id = '50000000-0000-0000-0000-000000000001') then
    raise exception 'B2: shared profile must be visible';
  end if;
end $$;
-- own church → allowed
insert into public.card_print_profiles (id, church_id, service_id, name, settings) values
  ('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'مدارس الأحد — عرضي', '{"orientation":"landscape"}');
do $$ begin
  -- shared → refused
  begin
    insert into public.card_print_profiles (church_id, name, settings) values (null, 'x', '{}');
    raise exception 'B3: manager must not create shared profiles';
  exception when insufficient_privilege then null; end;
  -- other church → refused
  begin
    insert into public.card_print_profiles (church_id, name, settings) values ('10000000-0000-0000-0000-000000000002', 'x', '{}');
    raise exception 'B4: manager must not create profiles for another church';
  exception when insufficient_privilege then null; end;
  -- update of the shared row is silently a no-op (RLS filters it out)
  update public.card_print_profiles set name = 'hacked' where id = '50000000-0000-0000-0000-000000000001';
  if (select name from public.card_print_profiles where id = '50000000-0000-0000-0000-000000000001') = 'hacked' then
    raise exception 'B5: manager updated a shared profile';
  end if;
end $$;
reset role;

-- ---------- C. class servant: sees shared + service-level of his service ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
do $$ begin
  if (select count(*) from public.card_print_profiles) <> 2 then
    raise exception 'C1: class servant should see shared + his service profile (got %)', (select count(*) from public.card_print_profiles);
  end if;
end $$;
-- his own class → allowed
insert into public.card_print_profiles (church_id, service_id, class_id, name, settings) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'فصل أ', '{}');
-- whole church → refused
do $$ begin
  begin
    insert into public.card_print_profiles (church_id, name, settings) values ('10000000-0000-0000-0000-000000000001', 'x', '{}');
    raise exception 'C2: class servant must not create church-level profiles';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ---------- D. constraints + touch trigger ----------
do $$ begin
  begin
    insert into public.card_print_profiles (church_id, name, settings) values (null, '   ', '{}');
    raise exception 'D1: blank name accepted';
  exception when check_violation then null; end;
  begin
    insert into public.card_print_profiles (church_id, service_id, class_id, name, settings)
    values ('10000000-0000-0000-0000-000000000001', null, '30000000-0000-0000-0000-000000000001', 'x', '{}');
    raise exception 'D2: class without service accepted';
  exception when check_violation then null; end;
end $$;

do $$ declare before_ts timestamptz; begin
  select edited_at into before_ts from public.card_print_profiles where id = '50000000-0000-0000-0000-000000000002';
  update public.card_print_profiles set name = 'A3 كنيسة ب (2)', edited_at = before_ts - interval '1 hour'
   where id = '50000000-0000-0000-0000-000000000002';
  -- the trigger overrides whatever edited_at the client sends with now()
  if (select edited_at from public.card_print_profiles where id = '50000000-0000-0000-0000-000000000002') < before_ts then
    raise exception 'D3: edited_at not touched by trigger';
  end if;
end $$;

-- ---------- E. activity log attached ----------
do $$ begin
  if (select count(*) from pg_trigger where tgrelid = 'public.card_print_profiles'::regclass and tgname like 'zza_audit_%') <> 3 then
    raise exception 'E1: audit triggers missing on card_print_profiles';
  end if;
  if not ('card_print_profiles' = any (public.activity_audited_tables())) then
    raise exception 'E2: card_print_profiles not in activity_audited_tables()';
  end if;
end $$;

-- ---------- F. child_portal_birthday returns service / class logos ----------
insert into public.persons (id, national_id, name, birthdate, gender) values
  ('40000000-0000-0000-0000-000000000001', '31501010000001', 'مينا', '2015-01-01', 'male');
insert into public.enrollments (person_id, church_id, service_id, class_id) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001');
-- 0042: the portal needs a session token; the raw code doubles as the token here
insert into public.child_sessions (person_id, token_hash, expires_at)
values ('40000000-0000-0000-0000-000000000001', encode(digest('31501010000001', 'sha256'), 'hex'), now() + interval '1 day');
do $$ declare c jsonb; begin
  c := public.child_portal_birthday('31501010000001')->'constants';
  if c->>'church_logo_url' <> 'https://x/church-a.png' then raise exception 'F1: church logo missing (%)', c; end if;
  if c->>'service_logo_url' <> 'https://x/service.png' then raise exception 'F2: service logo missing (%)', c; end if;
  if c->>'class_logo_url' <> 'https://x/class.png' then raise exception 'F3: class logo missing (%)', c; end if;
end $$;

rollback;
\echo CARD PRINT PROFILES TESTS PASSED
