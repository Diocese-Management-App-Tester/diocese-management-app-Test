-- =====================================================================
-- Functional test for 20260928140000_finance.sql (الخزينة).
--   psql -d app -f supabase/tests/finance_test.sql
-- Ends with «FINANCE TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000003'),  -- service manager (مدارس الأحد)
  ('00000000-0000-0000-0000-000000000006'),  -- class servant (فصل أ)
  ('00000000-0000-0000-0000-000000000009');  -- church manager of كنيسة ب
insert into public.churches (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'كنيسة أ'),
  ('10000000-0000-0000-0000-000000000002', 'كنيسة ب');
insert into public.services (id, church_id, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'اجتماع شباب');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ');

insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id, approved_at) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null, now()),
  ('00000000-0000-0000-0000-000000000003', 'مسؤول الخدمة', 'sm', '0103', 'service_manager', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null, now()),
  ('00000000-0000-0000-0000-000000000006', 'خادم أ', 'cs-a', '0106', 'class_servant', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', now()),
  ('00000000-0000-0000-0000-000000000009', 'مدير ب', 'cm-b', '0109', 'church_manager', 'approved',
   '10000000-0000-0000-0000-000000000002', null, null, now());

-- ---------- A. service manager: causes + entries ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
set local request.jwt.claim.role = 'authenticated';

do $$
declare p jsonb; c_income uuid; c_exp uuid; s jsonb;
begin
  p := public.finance_permissions();
  if not ((p ->> 'view')::boolean and (p ->> 'add')::boolean and (p ->> 'manage')::boolean) then
    raise exception 'service manager must view/add/manage: %', p;
  end if;

  insert into public.finance_causes (church_id, service_id, name, kind)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'تبرعات', 'income')
  returning id into c_income;
  insert into public.finance_causes (church_id, service_id, name, kind)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'مطبوعات', 'expense')
  returning id into c_exp;

  -- static cause entries
  insert into public.finance_entries (church_id, service_id, kind, amount, cause_id, entry_date)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'income', 500, c_income, current_date - 40);
  insert into public.finance_entries (church_id, service_id, kind, amount, cause_id, entry_date)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'income', 300, c_income, current_date - 2);
  insert into public.finance_entries (church_id, service_id, kind, amount, cause_id, entry_date)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'expense', 120.5, c_exp, current_date - 1);
  -- free-text cause («أخرى»)
  insert into public.finance_entries (church_id, service_id, kind, amount, cause_text, entry_date)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'expense', 80, 'شراء بالونات', current_date);

  -- the cause name is copied onto the row
  if (select cause_text from public.finance_entries where cause_id = c_income limit 1) <> 'تبرعات' then
    raise exception 'cause_text must mirror the static cause name';
  end if;

  -- kind mismatch refused
  begin
    insert into public.finance_entries (church_id, service_id, kind, amount, cause_id)
    values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'expense', 10, c_income);
    raise exception 'income cause on an expense must be refused';
  exception when check_violation then null; end;

  -- entry without any cause refused
  begin
    insert into public.finance_entries (church_id, service_id, kind, amount)
    values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'expense', 10);
    raise exception 'entry without cause must be refused';
  exception when check_violation then null; end;

  -- a cause of another service is out of scope for an entry in اجتماع شباب
  begin
    insert into public.finance_entries (church_id, service_id, kind, amount, cause_id)
    values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'income', 10, c_income);
    raise exception 'cause of another service must be refused';
  exception when check_violation or insufficient_privilege then null; end;

  -- summary: balance = all time, period = last 30 days
  s := public.finance_summary('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null, current_date - 29, current_date, 'day');
  if (s -> 'balance' ->> 'income')::numeric <> 800 then raise exception 'balance.income expected 800: %', s -> 'balance'; end if;
  if (s -> 'balance' ->> 'expense')::numeric <> 200.5 then raise exception 'balance.expense expected 200.5: %', s -> 'balance'; end if;
  if (s -> 'balance' ->> 'net')::numeric <> 599.5 then raise exception 'balance.net expected 599.5: %', s -> 'balance'; end if;
  if (s -> 'period' ->> 'income')::numeric <> 300 then raise exception 'period.income expected 300: %', s -> 'period'; end if;
  if (s -> 'period' ->> 'count')::int <> 3 then raise exception 'period.count expected 3: %', s -> 'period'; end if;
  if jsonb_array_length(s -> 'series') <> 3 then raise exception 'series expected 3 days: %', s -> 'series'; end if;
  if jsonb_array_length(s -> 'by_cause') <> 3 then raise exception 'by_cause expected 3 rows: %', s -> 'by_cause'; end if;

  -- yearly bucket
  s := public.finance_summary('10000000-0000-0000-0000-000000000001', null, null, current_date - 400, current_date, 'year');
  if (s -> 'period' ->> 'income')::numeric <> 800 then raise exception 'year period.income expected 800: %', s -> 'period'; end if;
end $$;

-- ---------- B. class servant: view yes, add / manage only with the key ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
do $$
declare p jsonb; n int;
begin
  p := public.finance_permissions();
  if not (p ->> 'view')::boolean then raise exception 'class servant must view'; end if;
  if (p ->> 'add')::boolean or (p ->> 'manage')::boolean then raise exception 'class servant must not add/manage without a key: %', p; end if;
  -- he sees the service-level entries (scope overlaps)
  select count(*) into n from public.finance_entries;
  if n <> 4 then raise exception 'class servant should see 4 entries, saw %', n; end if;
  -- cannot insert
  begin
    insert into public.finance_entries (church_id, service_id, class_id, kind, amount, cause_text)
    values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'income', 10, 'x');
    raise exception 'class servant insert must be refused';
  exception when insufficient_privilege then null; end;
end $$;

-- give him finance.add through a profile
reset role;
insert into public.permission_profiles (id, name, permissions) values ('80000000-0000-0000-0000-000000000001', 'خزينة الفصل', array['finance.add']);
insert into public.permissions (servant_id, permission_profile_id) values ('00000000-0000-0000-0000-000000000006', '80000000-0000-0000-0000-000000000001');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
do $$
declare p jsonb;
begin
  p := public.finance_permissions();
  if not (p ->> 'add')::boolean then raise exception 'class servant with the key must add'; end if;
  insert into public.finance_entries (church_id, service_id, class_id, kind, amount, cause_text)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'income', 25, 'اشتراك رحلة');
  -- still cannot delete
  delete from public.finance_entries where cause_text = 'اشتراك رحلة';
  if not exists (select 1 from public.finance_entries where cause_text = 'اشتراك رحلة') then
    raise exception 'class servant without manage must not delete';
  end if;
end $$;

-- ---------- C. church manager of كنيسة ب sees nothing of كنيسة أ ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000009';
do $$
declare n int; s jsonb;
begin
  select count(*) into n from public.finance_entries;
  if n <> 0 then raise exception 'church b manager must see 0 entries, saw %', n; end if;
  s := public.finance_summary(null, null, null, current_date - 400, current_date, 'month');
  if (s -> 'balance' ->> 'net')::numeric <> 0 then raise exception 'church b balance must be 0: %', s; end if;
end $$;

-- ---------- D. hide the module → everything closes ----------
reset role;
delete from public.module_access where module_key = 'finance';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
do $$
declare n int;
begin
  if (public.finance_permissions() ->> 'view')::boolean then raise exception 'module hidden → no view'; end if;
  select count(*) into n from public.finance_entries;
  if n <> 0 then raise exception 'module hidden → 0 rows, saw %', n; end if;
end $$;

reset role;
select 'FINANCE TESTS PASSED' as result;
rollback;
