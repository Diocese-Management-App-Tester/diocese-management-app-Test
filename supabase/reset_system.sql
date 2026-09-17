-- =====================================================================
-- RESET SYSTEM — إعادة النظام إلى حالته الافتراضية النظيفة
-- =====================================================================
-- Wipes EVERY piece of data in the app and leaves a brand-new install:
--   · all public tables emptied (persons, enrollments, servants, attendance,
--     points, messages, notifications, all modules, customization, backups…)
--   · every login account removed (auth.users + identities + sessions)
--   · every uploaded file removed (photos, logos, card images, stored
--     backups) — buckets themselves stay
--   · the rows a fresh install seeds are put back (module_access 'cards')
--   · OPTIONAL: the owner account is re-created in the same run so you can
--     log in right away (see OWNER SETTINGS below)
--
-- Schema, functions, triggers, RLS policies, enums and buckets are KEPT —
-- nothing needs to be re-migrated afterwards.
--
-- ⚠️  IRREVERSIBLE. Take a backup first:
--     الإعدادات → النشاط → النسخ الاحتياطي والاسترجاع → «نسخة احتياطية» → الكل
--
-- HOW TO RUN
--   Supabase → SQL Editor → paste the whole file → Run.
--   Local:  psql -d app -v ON_ERROR_STOP=1 -f supabase/reset_system.sql
--
-- OWNER SETTINGS (edit before running)
--   owner_code      login code of the owner (login name; e-mail becomes
--                   <code>@diocese.app). Leave '' to NOT create an owner —
--                   then add the user in Authentication → Users and run
--                   supabase/migrations/0002_bootstrap_owner.sql.
--   owner_password  plain password (≥ 6 chars). Hashed with bcrypt here.
--   owner_name / owner_phone
--
--   NOTE: creating the owner inside SQL needs the `pgcrypto` extension
--   (present on Supabase) and write access to auth.users (SQL Editor runs
--   as postgres → fine). If your project refuses, leave owner_code = ''
--   and use the dashboard instead.
-- =====================================================================
begin;
set local search_path = public, extensions;
set local client_min_messages = warning;

-- ---------------------------------------------------------------------
-- 0. OWNER SETTINGS
-- ---------------------------------------------------------------------
create temp table _reset_opts on commit drop as
select
  'owner'::text          as owner_code,      -- '' = do not create an owner
  '000000'::text         as owner_password,  -- change after first login!
  'مالك التطبيق'::text   as owner_name,
  '0000000000'::text     as owner_phone;

-- ---------------------------------------------------------------------
-- 1. Truncate every public data table (one statement → CASCADE resolves
--    every FK regardless of order; identities restart from 1)
-- ---------------------------------------------------------------------
do $$
declare tabs text;
begin
  select string_agg(format('%I.%I', schemaname, tablename), ', ' order by tablename)
    into tabs
    from pg_tables
   where schemaname = 'public';
  if tabs is not null then
    execute 'truncate table ' || tabs || ' restart identity cascade';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Remove EVERY login account (servants' and anything else). On Supabase
--    identities / sessions / refresh_tokens / mfa cascade from auth.users,
--    but we clear the visible ones explicitly in case cascades were changed.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['auth.mfa_factors', 'auth.sessions', 'auth.refresh_tokens', 'auth.identities', 'auth.one_time_tokens'] loop
    if to_regclass(t) is not null then
      begin
        execute format('delete from %s', t);
      exception when others then
        raise notice '% not cleared: %', t, sqlerrm;
      end;
    end if;
  end loop;
  delete from auth.users;
end $$;

-- ---------------------------------------------------------------------
-- 3. Remove every uploaded file (photos · church-logos · backups …).
--    Buckets stay. Supabase only — silently skipped on a local shim.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is not null then
    delete from storage.objects where bucket_id in (select id from storage.buckets);
  end if;
exception when others then
  raise notice 'storage.objects not cleared: % — delete the files from Storage in the dashboard', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 4. Restore what a FRESH install has (seeded by the migrations)
-- ---------------------------------------------------------------------
-- 0024: the cards module is granted to everyone by default
insert into public.module_access (module_key, church_id, service_id, class_id)
select 'cards', null, null, null
 where not exists (select 1 from public.module_access where module_key = 'cards');

-- ---------------------------------------------------------------------
-- 5. Re-create the owner (optional)
-- ---------------------------------------------------------------------
do $$
declare
  o record;
  v_id uuid := gen_random_uuid();
  v_email text;
  v_login text;
  has_cols boolean;
begin
  select * into o from _reset_opts;
  if coalesce(o.owner_code, '') = '' then
    raise notice 'owner_code is empty → no owner created. Add the user in Authentication → Users and run 0002_bootstrap_owner.sql';
    return;
  end if;
  if length(coalesce(o.owner_password, '')) < 6 then
    raise exception 'owner_password must be at least 6 characters';
  end if;

  -- login name = code_to_user_id(code) when the helper exists (0040/0041), else the code lower-cased
  if to_regprocedure('public.code_to_user_id(text)') is not null then
    execute 'select public.code_to_user_id($1)' into v_login using o.owner_code;
  else
    v_login := lower(trim(o.owner_code));
  end if;
  v_email := v_login || '@diocese.app';

  -- auth.users — full Supabase layout when the columns exist (real project),
  -- minimal insert on the local shim
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'auth' and table_name = 'users' and column_name = 'encrypted_password'
  ) into has_cols;

  if has_cols then
    execute $q$
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change
      ) values (
        '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
        crypt($3, gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('code', $4, 'full_name', $5), now(), now(),
        '', '', '', ''
      )$q$ using v_id, v_email, o.owner_password, o.owner_code, o.owner_name;

    if to_regclass('auth.identities') is not null then
      execute $q$
        insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        values (gen_random_uuid(), $1, $1::text,
                jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true),
                'email', now(), now(), now())$q$ using v_id, v_email;
    end if;
  else
    insert into auth.users (id, email) values (v_id, v_email);
  end if;

  -- the person row (the owner is a person too — his code is the national_id)
  insert into public.persons (national_id, name, phone)
  values (o.owner_code, o.owner_name, o.owner_phone)
  on conflict (national_id) do update set name = excluded.name, phone = excluded.phone;

  -- the servant enrollment = the login profile
  insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, approved_at, person_id)
  values (v_id, o.owner_name, v_login, o.owner_phone, 'owner', 'approved', now(),
          (select id from public.persons where national_id = o.owner_code))
  on conflict (id) do update set role = 'owner', status = 'approved', approved_at = now();

  raise notice E'\n=== OWNER CREATED ===\n  login code : %\n  password   : %\n  e-mail     : %\n  uuid       : %\n  ⚠ change the password after the first login (الإعدادات → تعديل بياناتي)',
    o.owner_code, o.owner_password, v_email, v_id;
end $$;

-- ---------------------------------------------------------------------
-- 6. Report
-- ---------------------------------------------------------------------
set local client_min_messages = notice;
do $$
declare r record; n bigint; msg text := E'\n=== RESET COMPLETE — النظام في حالته الافتراضية ===\n'; total bigint := 0;
begin
  for r in select tablename from pg_tables where schemaname = 'public' order by tablename loop
    execute format('select count(*) from public.%I', r.tablename) into n;
    total := total + n;
    if n > 0 then msg := msg || format('  %-32s %s', r.tablename, n) || E'\n'; end if;
  end loop;
  select count(*) into n from auth.users;
  msg := msg || format('  public rows left: %s (module_access.cards, and persons / servant_enrollments = 1 each if an owner was created) · auth.users: %s', total, n) || E'\n';
  raise notice '%', msg;
end $$;

commit;
