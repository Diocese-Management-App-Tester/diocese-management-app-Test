-- =====================================================================
-- Functional test for 20260928120000 (priest areas · families · visits).
--   psql -d app -f supabase/tests/priest_areas_families_visits_test.sql
-- Ends with «PRIEST AREAS / FAMILIES / VISITS TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;

insert into auth.users (id) values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000006');
insert into public.churches (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'كنيسة أ'),
  ('10000000-0000-0000-0000-000000000002', 'كنيسة ب');
insert into public.services (id, church_id, name) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ');
insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id, approved_at) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null, now()),
  ('00000000-0000-0000-0000-000000000006', 'خادم', 'cs', '0106', 'class_servant', 'approved',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', now());

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
set local request.jwt.claim.role = 'authenticated';
select public.add_person_and_enroll('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000001', 'مينا', 'KID-1', 'male', null, '+201000000001', null, null, null, 0, 'secret1');
select public.add_person_and_enroll('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000001', 'مريم', 'KID-2', 'female', null, '+201000000002', null, null, null, 0, null);
reset role;

-- two priests in church أ, one in church ب
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set local request.jwt.claim.role = 'authenticated';
select public.owner_add_priest('PR-1', 'أبونا يوحنا', 'pass123', '10000000-0000-0000-0000-000000000001', 'القمص', 'male', null, '+201000000009');
select public.owner_add_priest('PR-2', 'أبونا بولس', 'pass456', '10000000-0000-0000-0000-000000000001', 'القس', 'male', null, '+201000000008');
select public.owner_add_priest('PR-3', 'أبونا مرقس', 'pass789', '10000000-0000-0000-0000-000000000002', 'القس', 'male', null, '+201000000007');
reset role;

set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.role = 'anon';

-- ---------- A. areas → streets → buildings ----------
do $$
declare tok text; tok2 text; tok3 text; r jsonb; t jsonb; area uuid; street uuid; bld uuid; pr2 uuid; ok boolean := false;
begin
  tok := public.priest_login('PR-1', 'pass123', true, 'test')->>'token';
  tok2 := public.priest_login('PR-2', 'pass456', true, 'test')->>'token';
  tok3 := public.priest_login('PR-3', 'pass789', true, 'test')->>'token';

  r := public.priest_area_save(tok, null, 'منطقة الكرنك', 'وصف', 25.7188, 32.6573, null, null, null);
  area := (r->>'id')::uuid;
  t := public.priest_areas_tree(tok);
  if jsonb_array_length(t->'areas') <> 1 then raise exception 'tree must have 1 area'; end if;
  if not (t->'areas'->0->>'is_mine')::boolean then raise exception 'creator must be connected to his area'; end if;
  if jsonb_array_length(t->'church_priests') <> 2 then raise exception 'church priests must be 2'; end if;
  if (t->'areas'->0->'location'->>'source') <> 'area' then raise exception 'area location json wrong'; end if;

  -- connect priest 2 too (same church) — a priest of another church is refused
  pr2 := (t->'church_priests'->1->>'id')::uuid;
  if pr2 = (t->'areas'->0->'priest_ids'->>0)::uuid then pr2 := (t->'church_priests'->0->>'id')::uuid; end if;
  r := public.priest_area_set_priests(tok, area, array[(t->'areas'->0->'priest_ids'->>0)::uuid, pr2]);
  if jsonb_array_length(r) <> 2 then raise exception 'area must have 2 priests'; end if;
  begin
    perform public.priest_area_set_priests(tok, area, array[(public.priest_portal_profile(tok3)->'priest'->>'id')::uuid]);
  exception when others then ok := sqlerrm like '%priest_other_church%'; end;
  if not ok then raise exception 'priest of another church must be refused'; end if;

  -- priest 3 (church ب) sees nothing of church أ
  t := public.priest_areas_tree(tok3);
  if jsonb_array_length(t->'areas') <> 0 then raise exception 'other church must not see the area'; end if;
  ok := false;
  begin
    perform public.priest_street_save(tok3, null, area, 'شارع مزور');
  exception when others then ok := sqlerrm like '%area_not_found%'; end;
  if not ok then raise exception 'other church must not add streets'; end if;

  r := public.priest_street_save(tok2, null, area, 'شارع التلفزيون', null, null, 'https://maps.app.goo.gl/x', 'بجوار الصيدلية');
  street := (r->>'id')::uuid;
  r := public.priest_building_save(tok, null, street, 'عمارة النور', '12', 5);
  bld := (r->>'id')::uuid;
  t := public.priest_areas_tree(tok);
  if jsonb_array_length(t->'areas'->0->'streets') <> 1 then raise exception 'street missing'; end if;
  if jsonb_array_length(t->'areas'->0->'streets'->0->'buildings') <> 1 then raise exception 'building missing'; end if;
  if (t->'areas'->0->'streets'->0->'location'->>'source') <> 'street' then raise exception 'street location (url only) must count'; end if;

  -- lat without lng refused
  ok := false;
  begin
    perform public.priest_area_save(tok, null, 'x', null, 25.0, null);
  exception when others then ok := sqlerrm like '%invalid_location%'; end;
  if not ok then raise exception 'lat without lng must fail'; end if;
end $$;

-- ---------- B. families bound to the place · members · effective location ----------
do $$
declare tok text; tok3 text; r jsonb; f jsonb; fam uuid; area uuid; street uuid; bld uuid; kid1 uuid; kid2 uuid; ok boolean := false; lst jsonb; s jsonb;
begin
  tok := public.priest_login('PR-1', 'pass123', true, 'test')->>'token';
  tok3 := public.priest_login('PR-3', 'pass789', true, 'test')->>'token';
  r := public.priest_areas_tree(tok);
  area := (r->'areas'->0->>'id')::uuid;
  street := (r->'areas'->0->'streets'->0->>'id')::uuid;
  bld := (r->'areas'->0->'streets'->0->'buildings'->0->>'id')::uuid;

  -- family with only the building → street / area / church are derived; code checked
  f := public.priest_family_save(tok, null, 'عائلة جرجس', 'FAM-1', '+201000000005', null, null, null, null, bld, '3', '7');
  fam := (f->>'id')::uuid;
  if (f->>'street_id')::uuid <> street or (f->>'area_id')::uuid <> area then raise exception 'place chain not derived'; end if;
  if (f->>'church_id')::uuid <> '10000000-0000-0000-0000-000000000001' then raise exception 'church not derived from area'; end if;
  if (f->'location'->>'source') <> 'street' then raise exception 'effective location must fall back to the street (%)', f->'location'; end if;
  if jsonb_array_length(f->'area_priests') <> 2 then raise exception 'area priests must be 2'; end if;
  if (f->>'visits_count')::int <> 0 or f->>'last_visit' is not null then raise exception 'no visits yet'; end if;

  -- a person code may not become a family code; a duplicate family code neither
  ok := false;
  begin perform public.priest_family_save(tok, null, 'x', 'KID-1'); exception when others then ok := sqlerrm like '%code_is_person%'; end;
  if not ok then raise exception 'person code must be refused'; end if;
  ok := false;
  begin perform public.priest_family_save(tok, null, 'x', 'FAM-1'); exception when others then ok := sqlerrm like '%code_taken%'; end;
  if not ok then raise exception 'duplicate family code must be refused'; end if;

  -- own location on the family wins
  f := public.priest_family_save(tok, fam, 'عائلة جرجس', 'FAM-1', '+201000000005', null, null, null, null, bld, '3', '7', 25.70, 32.64, null, 'الدور الثالث');
  if (f->'location'->>'source') <> 'family' then raise exception 'family own location must win'; end if;

  -- members: by code · search · new person · move
  r := public.priest_family_add_member_by_code(tok, fam, 'KID-1', 'son');
  kid1 := (r->>'person_id')::uuid;
  ok := false;
  begin perform public.priest_family_add_member_by_code(tok, fam, 'KID-1', 'son'); exception when others then ok := sqlerrm like '%already_member%'; end;
  if not ok then raise exception 'duplicate member must fail'; end if;
  s := public.priest_family_search_persons(tok, 'مري', 30);
  if jsonb_array_length(s) <> 1 or s->0->'person'->>'name' <> 'مريم' then raise exception 'search failed'; end if;
  if s->0->'family' is not null and s->0->'family' <> 'null'::jsonb then raise exception 'مريم has no family yet'; end if;
  kid2 := (s->0->'person'->>'id')::uuid;
  r := public.priest_family_add_member(tok, fam, kid2, 'daughter');
  r := public.priest_family_add_new_member(tok, fam, 'جرجس الأب', 'DAD-1', 'male', null, '+201000000011', null, null, null, 'father');
  if not (r->>'person_created')::boolean then raise exception 'new person must be created'; end if;
  r := public.priest_family_add_new_member(tok, fam, 'ماما', null, 'female', null, null, null, null, null, 'mother');
  if not (r->>'person_created')::boolean then raise exception 'new person without code must be created'; end if;
  f := public.priest_family_detail(tok, fam);
  if (f->>'members_count')::int <> 4 then raise exception 'members must be 4, got %', f->>'members_count'; end if;

  -- second family: moving a member asks first
  r := public.priest_family_save(tok, null, 'عائلة ثانية', null, null, null, null, area);
  ok := false;
  begin perform public.priest_family_add_member(tok, (r->>'id')::uuid, kid1, 'son', false); exception when others then ok := sqlerrm like '%in_other_family%'; end;
  if not ok then raise exception 'in_other_family must be raised'; end if;
  r := public.priest_family_add_member(tok, (r->>'id')::uuid, kid1, 'son', true);
  if r->'moved_from'->>'name' <> 'عائلة جرجس' then raise exception 'moved_from wrong'; end if;
  r := public.priest_family_add_member(tok, fam, kid1, 'son', true);   -- back

  -- lookup by code: person → his family; family code → family
  r := public.priest_family_lookup_code(tok, 'KID-1');
  if r->>'found' <> 'person' or (r->'family'->>'id')::uuid <> fam then raise exception 'lookup person → family failed'; end if;
  r := public.priest_family_lookup_code(tok, 'FAM-1');
  if r->>'found' <> 'family' then raise exception 'lookup family code failed'; end if;

  -- list: 2 families for church أ, none for church ب
  lst := public.priest_families_list(tok);
  if jsonb_array_length(lst) <> 2 then raise exception 'list must have 2 families'; end if;
  lst := public.priest_families_list(tok3);
  if jsonb_array_length(lst) <> 0 then raise exception 'other church must see 0 families'; end if;
  ok := false;
  begin perform public.priest_family_detail(tok3, fam); exception when others then ok := sqlerrm like '%no_access%'; end;
  if not ok then raise exception 'other church must not open the family'; end if;

  -- relation + remove (fresh detail — kid1's member row was recreated by the move)
  f := public.priest_family_detail(tok, fam);
  perform public.priest_family_set_relation(tok, (f->'members'->0->>'id')::uuid, 'brother');
  perform public.priest_family_remove_member(tok, (select (e->>'id')::uuid from jsonb_array_elements(f->'members') e where e->'person'->>'name' = 'ماما'));
  f := public.priest_family_detail(tok, fam);
  if (f->>'members_count')::int <> 3 then raise exception 'members must be 3 after remove'; end if;
  if f->>'area_id' is null then raise exception 'area lost at end of B: %', f; end if;
end $$;

-- ---------- C. visits: record · schedule · family request → approve → done ----------
do $$
declare tok text; tok2 text; ctok text; r jsonb; f jsonb; fam uuid; v uuid; lst jsonb; cf jsonb; ok boolean := false; prid uuid;
begin
  tok := public.priest_login('PR-1', 'pass123', true, 'test')->>'token';
  tok2 := public.priest_login('PR-2', 'pass456', true, 'test')->>'token';
  fam := (public.priest_family_lookup_code(tok, 'FAM-1')->'family'->>'id')::uuid;

  f := public.priest_family_detail(tok, fam);
  if f->>'area_id' is null then raise exception 'area lost before visits: %', f; end if;
  -- a visit that happened 20 days ago
  r := public.priest_visit_create(tok, fam, public.cairo_today_date() - 20, null, null, true, 'زيارة طيبة');
  if r->>'status' <> 'done' or (r->>'visited_on')::date <> public.cairo_today_date() - 20 then raise exception 'done visit wrong'; end if;
  ok := false;
  begin perform public.priest_visit_create(tok, fam, public.cairo_today_date() + 1, null, null, true); exception when others then ok := sqlerrm like '%future_date%'; end;
  if not ok then raise exception 'done visit in the future must fail'; end if;

  -- a scheduled visit in 3 days
  r := public.priest_visit_create(tok, fam, public.cairo_today_date() + 3, '18:00', 'بعد القداس', false);
  v := (r->>'id')::uuid;
  if r->>'status' <> 'approved' then raise exception 'scheduled visit must be approved'; end if;
  f := public.priest_family_detail(tok, fam);
  if (f->>'visits_count')::int <> 1 or (f->>'days_since_visit')::int <> 20 then raise exception 'family counters wrong: %', f; end if;
  if (f->'next_visit'->>'id')::uuid <> v then raise exception 'next_visit wrong'; end if;
  if jsonb_array_length(f->'visits') <> 2 then raise exception 'detail must list 2 visits'; end if;

  -- move it, then mark done
  r := public.priest_visit_decide(tok, v, 'approve', public.cairo_today_date() + 4, '19:30', 'تأجيل يوم');
  if (r->>'on')::date <> public.cairo_today_date() + 4 or r->>'time' <> '19:30:00' then raise exception 'move failed'; end if;
  r := public.priest_visit_decide(tok, v, 'done', public.cairo_today_date(), null, 'تمت');
  if r->>'status' <> 'done' or (r->>'visited_on')::date <> public.cairo_today_date() then raise exception 'done failed'; end if;
  f := public.priest_family_detail(tok, fam);
  if (f->>'visits_count')::int <> 2 or (f->>'days_since_visit')::int <> 0 then raise exception 'counters after done wrong'; end if;

  -- priest 2 may not touch priest 1's visit
  ok := false;
  begin perform public.priest_visit_decide(tok2, v, 'cancel'); exception when others then ok := sqlerrm like '%not_found%'; end;
  if not ok then raise exception 'other priest must not decide'; end if;

  -- child (KID-1, member of the family) → عائلتي: sees the 2 area priests, requests a visit
  ctok := public.child_login('KID-1', 'secret1', false)->>'token';
  cf := public.child_portal_family(ctok);
  if (cf->'family'->>'id')::uuid <> fam then raise exception 'child must see his family'; end if;
  if jsonb_array_length(cf->'priests') <> 2 or (cf->>'priests_fallback')::boolean then raise exception 'child must see the 2 area priests: % / fam %', cf->'priests', cf->'family'->'area_id'; end if;
  if cf->'priests'->0->>'phone' is null then raise exception 'priest phone must be exposed to call him'; end if;
  if jsonb_array_length(cf->'visits') <> 2 then raise exception 'child must see the family visits'; end if;
  prid := (cf->'priests'->0->>'id')::uuid;
  ok := false;
  begin perform public.child_request_visit(ctok, prid, public.cairo_today_date() - 1); exception when others then ok := sqlerrm like '%past_date%'; end;
  if not ok then raise exception 'past request must fail'; end if;
  r := public.child_request_visit(ctok, prid, public.cairo_today_date() + 7, '17:00', 'نرجو زيارة');
  if r->>'status' <> 'pending' or r->>'requested_by' <> 'family' or r->'requested_by_person'->>'name' <> 'مينا' then raise exception 'request wrong: %', r; end if;
  ok := false;
  begin perform public.child_request_visit(ctok, prid, public.cairo_today_date() + 8); exception when others then ok := sqlerrm like '%pending_exists%'; end;
  if not ok then raise exception 'second pending must fail'; end if;

  -- the requested priest sees it pending in his list + profile counter; approves; done
  tok := case when (public.priest_portal_profile(tok)->'priest'->>'id')::uuid = prid then tok else tok2 end;
  lst := public.priest_visits_list(tok);
  if not exists (select 1 from jsonb_array_elements(lst) e where e->>'status' = 'pending') then raise exception 'pending request must be listed'; end if;
  if (public.priest_portal_profile(tok)->'counts'->>'pending_visits')::int <> 1 then raise exception 'pending_visits counter wrong'; end if;
  if (public.priest_portal_profile(tok)->'counts'->>'families')::int <> 2 then raise exception 'families counter wrong'; end if;
  if (public.priest_portal_profile(tok)->'counts'->>'never_visited')::int <> 1 then raise exception 'never_visited counter wrong'; end if;
  v := (r->>'id')::uuid;
  r := public.priest_visit_decide(tok, v, 'approve');
  if r->>'status' <> 'approved' or (r->>'on')::date <> public.cairo_today_date() + 7 then raise exception 'approve request failed'; end if;
  cf := public.child_portal_family(ctok);
  if not exists (select 1 from jsonb_array_elements(cf->'visits') e where e->>'status' = 'approved') then raise exception 'child must see the approval'; end if;
  perform public.child_cancel_visit(ctok, v);
  cf := public.child_portal_family(ctok);
  if not exists (select 1 from jsonb_array_elements(cf->'visits') e where e->>'status' = 'cancelled') then raise exception 'child cancel failed'; end if;

  -- delete a visit
  perform public.priest_visit_delete(tok, v);
  perform public.priest_family_detail(tok, fam);
end $$;

-- ---------- D. a child with no family: fallback priests of his church, no request ----------
do $$
declare ctok text; cf jsonb; ok boolean := false;
begin
  -- move مريم out of the family first
  declare tok text := (public.priest_login('PR-1', 'pass123', true, 'test'))->>'token'; f jsonb; mid uuid;
  begin
    f := public.priest_family_lookup_code(tok, 'FAM-1')->'family';
    select (e->>'id')::uuid into mid from jsonb_array_elements(f->'members') e where e->'person'->>'national_id' = 'KID-2';
    perform public.priest_family_remove_member(tok, mid);
  end;
  -- she has no password → default 000000
  ctok := public.child_login('KID-2', '000000', false)->>'token';
  cf := public.child_portal_family(ctok);
  if cf->'family' is not null and cf->'family' <> 'null'::jsonb then raise exception 'no family expected'; end if;
  if not (cf->>'priests_fallback')::boolean or jsonb_array_length(cf->'priests') <> 2 then raise exception 'fallback priests of the church expected'; end if;
  begin perform public.child_request_visit(ctok, (cf->'priests'->0->>'id')::uuid, public.cairo_today_date() + 1); exception when others then ok := sqlerrm like '%no_family%'; end;
  if not ok then raise exception 'no_family must be raised'; end if;
end $$;

-- ---------- E. deleting the tree cascades cleanly; servant keeps read on geo tables ----------
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
set local request.jwt.claim.role = 'authenticated';
do $$
declare n int;
begin
  select count(*) into n from public.areas;      if n <> 1 then raise exception 'servant must read areas of his church'; end if;
  select count(*) into n from public.buildings;  if n <> 1 then raise exception 'servant must read buildings'; end if;
  begin
    insert into public.areas (church_id, name) values ('10000000-0000-0000-0000-000000000001', 'x');
    raise exception 'servant must not insert areas';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
set local request.jwt.claim.role = 'anon';
do $$
declare tok text; f jsonb; fam uuid; t jsonb;
begin
  tok := public.priest_login('PR-1', 'pass123', true, 'test')->>'token';
  fam := (public.priest_family_lookup_code(tok, 'FAM-1')->'family'->>'id')::uuid;
  t := public.priest_areas_tree(tok);
  perform public.priest_building_delete(tok, (t->'areas'->0->'streets'->0->'buildings'->0->>'id')::uuid);
  f := public.priest_family_detail(tok, fam);
  if f->>'building_id' is not null then raise exception 'building must be nulled on the family'; end if;
  if (f->>'street_id')::uuid is null then raise exception 'street must stay'; end if;
  perform public.priest_area_delete(tok, (t->'areas'->0->>'id')::uuid);
  f := public.priest_family_detail(tok, fam);
  if f->>'area_id' is not null or f->>'street_id' is not null then raise exception 'area / street must be nulled'; end if;
  if (f->>'church_id')::uuid <> '10000000-0000-0000-0000-000000000001' then raise exception 'church must stay'; end if;
  if (f->>'visits_count')::int <> 2 then raise exception 'visits must survive'; end if;
  perform public.priest_family_delete(tok, fam);
  if jsonb_array_length(public.priest_families_list(tok)) <> 1 then raise exception 'one family must remain'; end if;
end $$;

rollback;
\echo PRIEST AREAS / FAMILIES / VISITS TESTS PASSED
