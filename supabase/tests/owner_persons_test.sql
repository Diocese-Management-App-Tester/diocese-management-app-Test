-- =====================================================================
-- Functional test for 20260923120000_owner_persons_management.sql
-- (إدارة الأفراد — owner page RPCs).
--   psql -d app -f supabase/tests/owner_persons_test.sql
-- Ends with «OWNER PERSONS TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000006');  -- class servant (فصل أ)
insert into public.churches (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'كنيسة أ'),
  ('10000000-0000-0000-0000-000000000002', 'كنيسة ب');
insert into public.services (id, church_id, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'اجتماع شباب');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل ب'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'مجموعة ١');

insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id, approved_at) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null, now()),
  ('00000000-0000-0000-0000-000000000006', 'خادم أ', 'cs-a', '0106', 'class_servant', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', now());

-- persons: 2 enrolled children, 1 with no enrollment, (+ 2 servant persons auto-created by 0037 trigger)
insert into public.persons (id, national_id, name, gender) values
  ('50000000-0000-0000-0000-000000000001', 'KID-1', 'مينا', 'male'),
  ('50000000-0000-0000-0000-000000000002', 'KID-2', 'مريم', 'female'),
  ('50000000-0000-0000-0000-000000000003', 'KID-3', 'يوسف بلا تسجيل', 'male');
insert into public.enrollments (person_id, church_id, service_id, class_id) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');

-- ---------- A. non-owner is refused ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
set local request.jwt.claim.role = 'authenticated';
do $$
begin
  begin
    perform * from public.owner_persons_page();
    raise exception 'class servant must not read the owner list';
  exception when others then
    if sqlerrm not like '%forbidden%' then raise; end if;
  end;
  begin
    perform public.owner_bulk_delete_persons(array['50000000-0000-0000-0000-000000000003'::uuid]);
    raise exception 'class servant must not bulk delete';
  exception when others then
    if sqlerrm not like '%forbidden%' then raise; end if;
  end;
  -- bulk enroll outside his class is refused
  begin
    perform public.owner_bulk_enroll(array['50000000-0000-0000-0000-000000000003'::uuid],
      '[{"church_id":"10000000-0000-0000-0000-000000000002","service_id":"20000000-0000-0000-0000-000000000002","class_id":"30000000-0000-0000-0000-000000000003"}]'::jsonb);
    raise exception 'class servant must not enroll outside his scope';
  exception when others then
    if sqlerrm not like '%no_access%' then raise; end if;
  end;
  if (public.owner_persons_counts()) is not null then raise exception 'counts must be null for non-owner'; end if;
end $$;

-- ---------- B. owner: list + filters ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$
declare n int; c jsonb; r record;
begin
  -- all persons (3 children + 2 servant persons from the auto trigger)
  select count(*) into n from public.owner_persons_page();
  if n <> 5 then raise exception 'expected 5 persons, got %', n; end if;
  select total_count into n from public.owner_persons_page(p_limit => 2) limit 1;
  if n <> 5 then raise exception 'total_count must be 5 regardless of the page, got %', n; end if;
  select count(*) into n from public.owner_persons_page(p_limit => 2);
  if n <> 2 then raise exception 'page size must be honoured'; end if;

  -- no enrollment at all → يوسف + the 2 servant persons (servants have no class → no mirror rows)
  select count(*) into n from public.owner_persons_page(p_scope_mode => 'none', p_kind => 'child');
  if n <> 1 then raise exception 'expected 1 unenrolled child, got %', n; end if;
  select name into r from public.owner_persons_page(p_scope_mode => 'none', p_kind => 'child');
  if r.name <> 'يوسف بلا تسجيل' then raise exception 'wrong unenrolled person'; end if;

  -- scope: church أ → 2 (mirror row of servant أ too? he has a class → yes, 0042 mirror) 
  select count(*) into n from public.owner_persons_page(p_scope_mode => 'scope', p_church => '10000000-0000-0000-0000-000000000001', p_kind => 'child');
  if n <> 2 then raise exception 'expected 2 children in church أ, got %', n; end if;
  select count(*) into n from public.owner_persons_page(p_scope_mode => 'scope', p_church => '10000000-0000-0000-0000-000000000001',
    p_service => '20000000-0000-0000-0000-000000000001', p_class => '30000000-0000-0000-0000-000000000002');
  if n <> 1 then raise exception 'expected 1 person in فصل ب, got %', n; end if;
  select count(*) into n from public.owner_persons_page(p_scope_mode => 'scope', p_church => '10000000-0000-0000-0000-000000000002');
  if n <> 0 then raise exception 'church ب must be empty'; end if;

  -- gender + search
  select count(*) into n from public.owner_persons_page(p_gender => 'female');
  if n <> 1 then raise exception 'expected 1 female'; end if;
  select count(*) into n from public.owner_persons_page(p_search => 'KID-');
  if n <> 3 then raise exception 'search by code must hit 3, got %', n; end if;
  select count(*) into n from public.owner_persons_page(p_kind => 'servant');
  if n <> 2 then raise exception 'expected 2 servant persons, got %', n; end if;

  -- enrollments payload
  select enrollments into c from public.owner_persons_page(p_search => 'KID-1');
  if jsonb_array_length(c) <> 1 or c->0->>'class_id' <> '30000000-0000-0000-0000-000000000001' then
    raise exception 'enrollments jsonb wrong: %', c;
  end if;
  select servant into c from public.owner_persons_page(p_search => 'cs-a');
  if c is null or c->>'role' <> 'class_servant' then raise exception 'servant jsonb wrong: %', c; end if;

  -- counts
  c := public.owner_persons_counts();
  if (c->>'total')::int <> 5 or (c->>'servants')::int <> 2 or (c->>'children')::int <> 3 then
    raise exception 'counts wrong: %', c;
  end if;

  -- bad args
  begin
    perform * from public.owner_persons_page(p_scope_mode => 'scope');
    raise exception 'scope without church must fail';
  exception when others then
    if sqlerrm not like '%church_required%' then raise; end if;
  end;
end $$;

-- ---------- C. owner: bulk enroll ----------
do $$
declare r jsonb; n int;
begin
  -- add مينا (already in فصل أ) + يوسف to فصل أ AND مجموعة ١ (other church)
  r := public.owner_bulk_enroll(
    array['50000000-0000-0000-0000-000000000001'::uuid, '50000000-0000-0000-0000-000000000003'::uuid],
    '[{"church_id":"10000000-0000-0000-0000-000000000001","service_id":"20000000-0000-0000-0000-000000000001","class_id":"30000000-0000-0000-0000-000000000001"},
      {"church_id":"10000000-0000-0000-0000-000000000002","service_id":"20000000-0000-0000-0000-000000000002","class_id":"30000000-0000-0000-0000-000000000003"}]'::jsonb);
  if (r->>'added')::int <> 3 or (r->>'skipped')::int <> 1 or (r->>'scopes')::int <> 2 then
    raise exception 'bulk enroll result wrong: %', r;
  end if;
  select count(*) into n from public.enrollments where person_id = '50000000-0000-0000-0000-000000000003';
  if n <> 2 then raise exception 'يوسف must now be in 2 classes'; end if;
  -- no longer unenrolled
  select count(*) into n from public.owner_persons_page(p_scope_mode => 'none', p_kind => 'child');
  if n <> 0 then raise exception 'nobody should be unenrolled now'; end if;

  -- class not under the given service → invalid_scope
  begin
    perform public.owner_bulk_enroll(array['50000000-0000-0000-0000-000000000001'::uuid],
      '[{"church_id":"10000000-0000-0000-0000-000000000001","service_id":"20000000-0000-0000-0000-000000000001","class_id":"30000000-0000-0000-0000-000000000003"}]'::jsonb);
    raise exception 'mismatched scope accepted';
  exception when others then
    if sqlerrm not like '%invalid_scope%' then raise; end if;
  end;
  -- missing class → class_required
  begin
    perform public.owner_bulk_enroll(array['50000000-0000-0000-0000-000000000001'::uuid],
      '[{"church_id":"10000000-0000-0000-0000-000000000001","service_id":"20000000-0000-0000-0000-000000000001","class_id":null}]'::jsonb);
    raise exception 'scope without class accepted';
  exception when others then
    if sqlerrm not like '%class_required%' then raise; end if;
  end;
end $$;

-- ---------- D. owner: bulk unenroll ----------
do $$
declare r jsonb; n int;
begin
  -- remove both from the whole church ب
  r := public.owner_bulk_unenroll(
    array['50000000-0000-0000-0000-000000000001'::uuid, '50000000-0000-0000-0000-000000000003'::uuid],
    '10000000-0000-0000-0000-000000000002');
  if (r->>'removed')::int <> 2 then raise exception 'unenroll from church ب must remove 2, got %', r; end if;
  select count(*) into n from public.enrollments where church_id = '10000000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'church ب still has enrollments'; end if;
  -- remove يوسف from فصل أ only
  r := public.owner_bulk_unenroll(array['50000000-0000-0000-0000-000000000003'::uuid],
    '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001');
  if (r->>'removed')::int <> 1 then raise exception 'unenroll from class must remove 1'; end if;
  -- مينا untouched in فصل أ
  select count(*) into n from public.enrollments where person_id = '50000000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'مينا must keep his enrollment'; end if;
end $$;

-- ---------- E. owner: bulk delete (servants skipped) ----------
do $$
declare r jsonb; n int; sp uuid;
begin
  select person_id into sp from public.servant_enrollments where id = '00000000-0000-0000-0000-000000000006';
  r := public.owner_bulk_delete_persons(array[
    '50000000-0000-0000-0000-000000000002'::uuid,  -- مريم (enrolled)
    '50000000-0000-0000-0000-000000000003'::uuid,  -- يوسف
    sp]);                                            -- servant person → skipped
  if (r->>'deleted')::int <> 2 or (r->>'skipped_servants')::int <> 1 then
    raise exception 'bulk delete result wrong: %', r;
  end if;
  select count(*) into n from public.persons where id in ('50000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000003');
  if n <> 0 then raise exception 'persons not deleted'; end if;
  select count(*) into n from public.enrollments where person_id = '50000000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'cascade did not remove enrollments'; end if;
  if not exists (select 1 from public.persons where id = sp) then raise exception 'servant person must survive'; end if;
  if (public.owner_persons_counts()->>'total')::int <> 3 then raise exception 'total must be 3 now'; end if;
end $$;

reset role;
rollback;
\echo OWNER PERSONS TESTS PASSED
