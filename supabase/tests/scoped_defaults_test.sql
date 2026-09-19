-- =====================================================================
-- Functional test for migration 0048 (الافتراضي لكل مستوى — scoped defaults).
--   psql -d app -f supabase/tests/scoped_defaults_test.sql
-- Ends with «SCOPED DEFAULTS TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;

insert into public.churches (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'كنيسة أ'),
  ('10000000-0000-0000-0000-000000000002', 'كنيسة ب');
insert into public.services (id, church_id, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'الشباب');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل ب');

-- ---------- A. one default PER EXACT SCOPE, other levels untouched ----------
insert into public.events (id, church_id, service_id, class_id, name, recurrence, weekdays, points, is_default) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', null, null, 'قداس الكنيسة', 'weekly', '{5}', 5, true),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null, 'مدارس الأحد', 'weekly', '{5}', 5, true),
  ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'درس فصل أ', 'weekly', '{2}', 3, true),
  ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', null, null, 'قداس كنيسة ب', 'weekly', '{5}', 5, true);

do $$ begin
  if (select count(*) from public.events where is_default) <> 4 then
    raise exception 'A1: defaults of different scopes must coexist (got %)', (select count(*) from public.events where is_default);
  end if;
end $$;

-- a second church-wide default in church A replaces ONLY the church-wide one
insert into public.events (id, church_id, service_id, class_id, name, recurrence, weekdays, points, is_default) values
  ('40000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', null, null, 'عشية', 'weekly', '{6}', 2, true);
do $$ begin
  if (select is_default from public.events where id = '40000000-0000-0000-0000-000000000001') then
    raise exception 'A2: old church default should be switched off';
  end if;
  if not (select is_default from public.events where id = '40000000-0000-0000-0000-000000000002') then
    raise exception 'A3: service default must NOT be touched by a church default';
  end if;
  if not (select is_default from public.events where id = '40000000-0000-0000-0000-000000000003') then
    raise exception 'A4: class default must NOT be touched by a church default';
  end if;
  if not (select is_default from public.events where id = '40000000-0000-0000-0000-000000000004') then
    raise exception 'A5: other church default must NOT be touched';
  end if;
end $$;

-- updating an existing row to default clears its scope-mate only
update public.events set is_default = true where id = '40000000-0000-0000-0000-000000000001';
do $$ begin
  if (select is_default from public.events where id = '40000000-0000-0000-0000-000000000005') then
    raise exception 'A6: update to default should switch off the same-scope default';
  end if;
  if (select count(*) from public.events where is_default and church_id = '10000000-0000-0000-0000-000000000001' and service_id is null) <> 1 then
    raise exception 'A7: exactly one church-wide default';
  end if;
end $$;

-- moving a default row to another scope re-evaluates uniqueness there
update public.events set service_id = '20000000-0000-0000-0000-000000000001', class_id = null
 where id = '40000000-0000-0000-0000-000000000001';
do $$ begin
  if (select is_default from public.events where id = '40000000-0000-0000-0000-000000000002') then
    raise exception 'A8: moving a default into a scope must switch off that scope''s previous default';
  end if;
  if not (select is_default from public.events where id = '40000000-0000-0000-0000-000000000001') then
    raise exception 'A9: the moved row stays default';
  end if;
end $$;
-- put it back so section B is readable
update public.events set service_id = null, class_id = null where id = '40000000-0000-0000-0000-000000000001';
update public.events set is_default = true where id = '40000000-0000-0000-0000-000000000002';

-- ---------- B. resolution: class → service → church ----------
do $$
declare r uuid;
begin
  -- class أ has its own default
  r := public.default_event_for('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001');
  if r <> '40000000-0000-0000-0000-000000000003' then raise exception 'B1: class default expected, got %', r; end if;

  -- class ب has none → falls back to the SERVICE default
  r := public.default_event_for('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');
  if r <> '40000000-0000-0000-0000-000000000002' then raise exception 'B2: service default expected, got %', r; end if;

  -- service selected, no class → SERVICE default
  r := public.default_event_for('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null);
  if r <> '40000000-0000-0000-0000-000000000002' then raise exception 'B3: service default expected, got %', r; end if;

  -- service الشباب has no default → falls back to the CHURCH default
  r := public.default_event_for('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', null);
  if r <> '40000000-0000-0000-0000-000000000001' then raise exception 'B4: church default expected, got %', r; end if;

  -- church only → CHURCH default
  r := public.default_event_for('10000000-0000-0000-0000-000000000001', null, null);
  if r <> '40000000-0000-0000-0000-000000000001' then raise exception 'B5: church default expected, got %', r; end if;

  -- service default removed → service selection falls back to church
  update public.events set is_default = false where id = '40000000-0000-0000-0000-000000000002';
  r := public.default_event_for('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');
  if r <> '40000000-0000-0000-0000-000000000001' then raise exception 'B6: church default expected after service default removed, got %', r; end if;

  -- church with no defaults at all → null
  update public.events set is_default = false where church_id = '10000000-0000-0000-0000-000000000002';
  r := public.default_event_for('10000000-0000-0000-0000-000000000002', null, null);
  if r is not null then raise exception 'B7: null expected, got %', r; end if;
end $$;

-- ---------- C. causes behave identically ----------
insert into public.causes (id, church_id, service_id, class_id, name, points, is_default) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', null, null, 'حفظ آية', 5, true),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null, 'مشاركة', 2, true),
  ('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', null, null, 'إحضار صديق', 10, true);
do $$
declare r uuid;
begin
  if (select is_default from public.causes where id = '50000000-0000-0000-0000-000000000001') then
    raise exception 'C1: second church-wide cause default must replace the first';
  end if;
  if not (select is_default from public.causes where id = '50000000-0000-0000-0000-000000000002') then
    raise exception 'C2: service cause default must stay';
  end if;
  r := public.default_cause_for('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001');
  if r <> '50000000-0000-0000-0000-000000000002' then raise exception 'C3: service cause expected, got %', r; end if;
  r := public.default_cause_for('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', null);
  if r <> '50000000-0000-0000-0000-000000000003' then raise exception 'C4: church cause expected, got %', r; end if;
end $$;

-- ---------- D. backfill: pre-existing duplicates are reduced to one per scope ----------
-- simulate legacy rows by disabling the trigger while inserting
alter table public.events disable trigger trg_events_default_scope;
insert into public.events (id, church_id, service_id, class_id, name, recurrence, weekdays, points, is_default, edited_at) values
  ('40000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000002', null, null, 'قديم', 'weekly', '{5}', 5, true, now() - interval '2 days'),
  ('40000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000002', null, null, 'أحدث', 'weekly', '{5}', 5, true, now() - interval '1 day');
alter table public.events enable trigger trg_events_default_scope;
-- re-run the migration's cleanup statement
with ranked as (
  select id, row_number() over (
           partition by church_id,
                        coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid),
                        coalesce(class_id,   '00000000-0000-0000-0000-000000000000'::uuid)
           order by edited_at desc, created_at desc, id) as rn
    from public.events where is_default)
update public.events e set is_default = false from ranked r where r.id = e.id and r.rn > 1;
do $$ begin
  if (select count(*) from public.events where is_default and church_id = '10000000-0000-0000-0000-000000000002') <> 1 then
    raise exception 'D1: backfill must leave one default per scope';
  end if;
  if not (select is_default from public.events where id = '40000000-0000-0000-0000-000000000012') then
    raise exception 'D2: the most recently edited default wins the backfill';
  end if;
end $$;

select 'SCOPED DEFAULTS TESTS PASSED' as result;
rollback;
