-- =====================================================================
-- 0002 — Bootstrap the App Owner (مالك التطبيق)
--
-- Creates the first login so a brand-new database is usable right away:
--
--      login code : 000000
--      password   : 000000
--
-- ⚠  Log in, then IMMEDIATELY change both in the app:
--      الإعدادات → تعديل بياناتي  (code + password; the e-mail
--      000000@diocese.app follows the code automatically).
--
-- Applied automatically by `supabase db push` (CI) on a fresh project —
-- right after 0001. It can also be run by hand in the SQL editor on an
-- existing database: it detects the schema it is running on.
--
--   · 0001-era schema (fresh project, CI)   → auth.users + public.profiles
--   · 0037+ schema (existing project)       → auth.users + public.persons
--                                             + public.servant_enrollments
--
-- Idempotent: if 000000@diocese.app already exists nothing happens.
-- Needs the pgcrypto extension (present on Supabase) and write access to
-- auth.users (the SQL editor and `db push` both connect as postgres).
--
-- Existing databases that were set up by hand: mark this file as applied
-- without running it — supabase/scripts/baseline_migration_history.sql
-- already does that.
-- =====================================================================

do $$
declare
  -- ---------------- credentials (defaults; change them in the app) ----
  c_code     constant text := '000000';
  c_password constant text := '000000';
  c_name     constant text := 'مالك التطبيق';
  c_phone    constant text := '0000000000';
  -- --------------------------------------------------------------------
  v_id       uuid := gen_random_uuid();
  v_login    text;
  v_email    text;
  v_pid      uuid;
  has_auth_cols boolean;
  post_0037     boolean;
begin
  -- pgcrypto lives in `extensions` on Supabase, in `public` elsewhere
  perform set_config('search_path', 'public, extensions', true);

  -- login name: code_to_user_id(code) once 0037 exists, else the code itself
  if to_regprocedure('public.code_to_user_id(text)') is not null then
    execute 'select public.code_to_user_id($1)' into v_login using c_code;
  else
    v_login := lower(trim(c_code));
  end if;
  v_email := v_login || '@diocese.app';

  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise notice '0002: % already exists — nothing to do', v_email;
    return;
  end if;

  -- ---------------------------------------------------------------- auth
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'auth' and table_name = 'users' and column_name = 'encrypted_password'
  ) into has_auth_cols;

  if has_auth_cols then
    -- real Supabase project
    execute $q$
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change
      ) values (
        '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
        crypt($3, gen_salt('bf', 10)), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('code', $4, 'full_name', $5), now(), now(),
        '', '', '', ''
      )$q$ using v_id, v_email, c_password, c_code, c_name;

    if to_regclass('auth.identities') is not null then
      execute $q$
        insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        values (gen_random_uuid(), $1, $1::text,
                jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true),
                'email', now(), now(), now())$q$ using v_id, v_email;
    end if;
  else
    -- local shim (supabase/tests/local_shim.sql)
    insert into auth.users (id, email) values (v_id, v_email);
  end if;

  -- ---------------------------------------------------------------- app
  post_0037 := to_regclass('public.servant_enrollments') is not null;

  if post_0037 then
    -- existing project: the owner is a person (code = national_id) + a servant enrollment
    insert into public.persons (national_id, name, phone)
    values (c_code, c_name, c_phone)
    on conflict (national_id) do update set name = excluded.name, phone = excluded.phone
    returning id into v_pid;

    insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, approved_at, person_id)
    values (v_id, c_name, v_login, c_phone, 'owner', 'approved', now(), v_pid)
    on conflict (id) do update set role = 'owner', status = 'approved', approved_at = now();
  else
    -- fresh project, 0001 schema: profiles only — 0037 later renames it to
    -- servant_enrollments and creates the person row from user_id
    insert into public.profiles (id, full_name, user_id, phone, role, status, approved_at)
    values (v_id, c_name, v_login, c_phone, 'owner', 'approved', now())
    on conflict (id) do update set role = 'owner', status = 'approved', approved_at = now();
  end if;

  raise notice E'\n=== OWNER CREATED ===\n  login code : %\n  password   : %\n  e-mail     : %\n  uuid       : %\n  ⚠ change code + password after the first login (الإعدادات → تعديل بياناتي)',
    c_code, c_password, v_email, v_id;
end $$;
