-- =====================================================================
-- WIPE TEST DATA — مسح كل البيانات التجريبية من جميع الجداول
-- =====================================================================
-- Empties EVERY data table of the app (schema, functions, triggers, RLS
-- policies and enums are all KEPT) and removes the seeded login accounts,
-- so the database goes back to a clean «fresh install» state.
--
-- HOW TO RUN
--   Supabase → SQL Editor → paste the whole file → Run.
--   Local:  psql -d app -v ON_ERROR_STOP=1 -f supabase/wipe_test_data.sql
--
-- WHAT IT DOES
--   1. TRUNCATE … CASCADE on all public data tables (fast, resets everything).
--   2. Deletes the seeded auth users (a0000000-0000-4000-8000-0000000000NN)
--      and, by default, EVERY other auth user that has no servant row left
--      (see the SEED_ONLY switch below to keep your real accounts).
--   3. Restores the one row the migrations seed on a fresh install:
--        · module_access('cards')  — 0024 grants the cards module globally
--      (written with the activity log switched off, so سجل النشاط stays
--      empty — 0047 audits module_access).
--   4. Prints the remaining row-count per table (should all be 0 except
--      module_access = 1).
--
-- Covers every table up to migration 0051 — servant_scopes · person_credentials
-- · child_sessions · child_join_requests · backup_* · activity_log · rt_gates ·
-- card_print_profiles · report_templates are all plain public tables, so the
-- catalogue-driven TRUNCATE below picks them (and any future table) up
-- automatically.
--
-- ⚠️  THIS DELETES ALL DATA — there is no undo. Take a backup first if the
--     project holds anything real (Supabase → Database → Backups).
--
-- AFTER WIPING
--   · run supabase/seed_test_data.sql again for a fresh demo set, OR
--   · create the real owner in Authentication → Users and run
--     supabase/scripts/bootstrap_owner.sql to start for real.
-- =====================================================================
begin;
set local search_path = public, extensions;
set local client_min_messages = warning;

-- 0047: keep the wipe itself out of سجل النشاط (the audit trigger honours
-- this transaction-local flag; harmless on schemas before 0047)
do $$ begin perform set_config('app.audit_off', '1', true); end $$;

-- ---------------------------------------------------------------------
-- 0. Switch: true  → only the 7 seeded demo accounts are removed from auth
--            false → every auth user without a servant_enrollments row is
--                    removed (full clean; default)
-- ---------------------------------------------------------------------
create temp table _wipe_opts on commit drop as select false as seed_only;

-- ---------------------------------------------------------------------
-- 1. Truncate every public data table (all in one statement so FKs are
--    resolved by CASCADE regardless of order). Views (profiles) are skipped.
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
-- 2. Auth users (Supabase: auth.users + auth.identities / sessions /
--    refresh_tokens cascade from auth.users). On the local shim only
--    auth.users exists — handled by the to_regclass checks.
-- ---------------------------------------------------------------------
do $$
declare v_seed_only boolean := (select seed_only from _wipe_opts);
begin
  -- the seeded demo accounts (fixed UUID prefix)
  if to_regclass('auth.identities') is not null then
    delete from auth.identities where user_id::text like 'a0000000-0000-4000-8000-%';
  end if;
  if to_regclass('auth.sessions') is not null then
    execute $q$delete from auth.sessions where user_id::text like 'a0000000-0000-4000-8000-%'$q$;
  end if;
  delete from auth.users where id::text like 'a0000000-0000-4000-8000-%';

  -- every other account (servant rows are gone after the truncate, so all
  -- remaining auth users are orphans of the app) — unless seed_only
  if not v_seed_only then
    if to_regclass('auth.identities') is not null then
      delete from auth.identities i where not exists (select 1 from public.servant_enrollments s where s.id = i.user_id);
    end if;
    if to_regclass('auth.sessions') is not null then
      execute $q$delete from auth.sessions x where not exists (select 1 from public.servant_enrollments s where s.id = x.user_id)$q$;
    end if;
    delete from auth.users u where not exists (select 1 from public.servant_enrollments s where s.id = u.id);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Storage objects uploaded by the app (photos · logos · card images ·
--    chat images · library covers). Buckets themselves are kept.
--    Supabase only — skipped on the local shim if the table is absent.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is not null then
    delete from storage.objects
     where bucket_id in (select id from storage.buckets);
  end if;
exception when others then
  raise notice 'storage.objects not cleared: % (delete the files from Storage in the dashboard)', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 4. Restore what a FRESH install has (seeded by the migrations)
-- ---------------------------------------------------------------------
insert into public.module_access (module_key, church_id, service_id, class_id)
select 'cards', null, null, null
 where not exists (select 1 from public.module_access where module_key = 'cards');

-- ---------------------------------------------------------------------
-- 5. Report
-- ---------------------------------------------------------------------
set local client_min_messages = notice;
-- ---------------------------------------------------------------------
do $$
declare r record; n bigint; msg text := E'\n=== WIPE COMPLETE — قاعدة البيانات نظيفة ===\n'; total bigint := 0;
begin
  for r in select tablename from pg_tables where schemaname = 'public' order by tablename loop
    execute format('select count(*) from public.%I', r.tablename) into n;
    total := total + n;
    if n > 0 then msg := msg || format('  %-32s %s', r.tablename, n) || E'\n'; end if;
  end loop;
  select count(*) into n from auth.users;
  msg := msg || format('  public rows left: %s (module_access.cards = 1 is expected) · auth.users left: %s', total, n) || E'\n';
  if to_regclass('public.child_sessions') is not null then
    msg := msg || '  child portal sessions / passwords / join requests · servant scopes · backups · activity log · print profiles · report templates: cleared' || E'\n';
  end if;
  raise notice '%', msg;
end $$;

commit;
