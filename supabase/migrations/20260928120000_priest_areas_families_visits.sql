-- =====================================================================
-- 20260928120000 — PRIEST PORTAL part 3: الافتقاد الأسري
--   المناطق → الشوارع → العمارات → العائلات → الأفراد  +  الزيارات
-- Requires 20260927120000 + 20260927130000 (priest portal) and
--          20260924120000 + 20260924130000 (family module).
-- =====================================================================
-- WHAT
--   * The FAMILY MODULE moves from the servants' app to the PRIEST PORTAL.
--     Servants keep READ access (list + the scanner family picker); the
--     priest creates / edits families and their members.
--   * A geographic hierarchy under the church:
--       areas (المناطق)        church_id · connected to ONE OR MORE priests
--                              (area_priests) · optional location
--       streets (الشوارع)      area_id · optional location
--       buildings (العمارات)   street_id · number · floors · optional location
--     A family is bound to church → area → street → building (+ floor /
--     apartment). Every level may carry a LOCATION (lat / lng · maps_url ·
--     note); the family's effective location = family → building → street
--     → area (first one set) — used for «الاتجاهات» (navigation).
--   * VISITS (family_visits): the priest RECORDS a visit he made (done +
--     visited_on), SCHEDULES one (approved + scheduled_on) or the FAMILY
--     REQUESTS one from the child portal (pending → the priest approves /
--     moves / rejects, then marks it done). «آخر زيارة» = max(visited_on).
--   * Child portal → عائلتي: my family, its members, the PRIESTS OF MY AREA
--     (call / WhatsApp), request a visit, my family's visits.
-- SECURITY — same model as the rest of the priest portal: SECURITY DEFINER
--   RPCs resolve the priest token (`priest_portal_self`) or the child token
--   (`child_portal_person`). No direct table access for anon.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------
create table if not exists public.areas (
  id             uuid primary key default gen_random_uuid(),
  church_id      uuid not null references public.churches(id) on delete cascade,
  name           text not null check (length(trim(name)) between 1 and 120),
  description    text,
  lat            double precision check (lat is null or lat between -90 and 90),
  lng            double precision check (lng is null or lng between -180 and 180),
  maps_url       text,
  location_note  text,
  created_by_priest uuid references public.priests(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_areas_church on public.areas(church_id);
comment on table public.areas is 'المناطق — تقسيم جغرافي داخل الكنيسة يخدمه كاهن أو أكثر (area_priests)';
alter table public.areas enable row level security;
revoke all on public.areas from anon, authenticated;

create table if not exists public.area_priests (
  area_id    uuid not null references public.areas(id) on delete cascade,
  priest_id  uuid not null references public.priests(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (area_id, priest_id)
);
create index if not exists idx_area_priests_priest on public.area_priests(priest_id);
comment on table public.area_priests is 'الكهنة المرتبطون بكل منطقة';
alter table public.area_priests enable row level security;
revoke all on public.area_priests from anon, authenticated;

create table if not exists public.streets (
  id             uuid primary key default gen_random_uuid(),
  area_id        uuid not null references public.areas(id) on delete cascade,
  name           text not null check (length(trim(name)) between 1 and 120),
  lat            double precision check (lat is null or lat between -90 and 90),
  lng            double precision check (lng is null or lng between -180 and 180),
  maps_url       text,
  location_note  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_streets_area on public.streets(area_id);
comment on table public.streets is 'الشوارع داخل المنطقة';
alter table public.streets enable row level security;
revoke all on public.streets from anon, authenticated;

create table if not exists public.buildings (
  id             uuid primary key default gen_random_uuid(),
  street_id      uuid not null references public.streets(id) on delete cascade,
  name           text not null check (length(trim(name)) between 1 and 120),
  number         text,
  floors_count   integer check (floors_count is null or floors_count between 0 and 200),
  lat            double precision check (lat is null or lat between -90 and 90),
  lng            double precision check (lng is null or lng between -180 and 180),
  maps_url       text,
  location_note  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_buildings_street on public.buildings(street_id);
comment on table public.buildings is 'العمارات داخل الشارع — العائلات تسكن فيها';
alter table public.buildings enable row level security;
revoke all on public.buildings from anon, authenticated;

-- families: church → area → street → building + floor / apartment + location
alter table public.families add column if not exists church_id     uuid references public.churches(id) on delete set null;
alter table public.families add column if not exists area_id       uuid references public.areas(id) on delete set null;
alter table public.families add column if not exists street_id     uuid references public.streets(id) on delete set null;
alter table public.families add column if not exists building_id   uuid references public.buildings(id) on delete set null;
alter table public.families add column if not exists floor         text;
alter table public.families add column if not exists apartment     text;
alter table public.families add column if not exists lat           double precision;
alter table public.families add column if not exists lng           double precision;
alter table public.families add column if not exists maps_url      text;
alter table public.families add column if not exists location_note text;
alter table public.families add column if not exists created_by_priest uuid references public.priests(id) on delete set null;
create index if not exists idx_families_church on public.families(church_id);
create index if not exists idx_families_area on public.families(area_id);
create index if not exists idx_families_street on public.families(street_id);
create index if not exists idx_families_building on public.families(building_id);

create table if not exists public.family_visits (
  id                   uuid primary key default gen_random_uuid(),
  family_id            uuid not null references public.families(id) on delete cascade,
  priest_id            uuid not null references public.priests(id) on delete cascade,
  requested_by         text not null default 'priest' check (requested_by in ('priest', 'family')),
  requested_by_person  uuid references public.persons(id) on delete set null,
  requested_on         date,
  requested_time       time,
  note                 text,
  status               text not null default 'approved' check (status in ('pending', 'approved', 'rejected', 'cancelled', 'done')),
  scheduled_on         date,
  scheduled_time       time,
  visited_on           date,
  decision_note        text,
  visit_note           text,
  decided_at           timestamptz,
  created_at           timestamptz not null default now()
);
create index if not exists idx_family_visits_family on public.family_visits(family_id, status, visited_on desc);
create index if not exists idx_family_visits_priest on public.family_visits(priest_id, status, scheduled_on);
comment on table public.family_visits is 'زيارات الكاهن للعائلات — مسجَّلة (done + visited_on) أو مرتَّبة (approved) أو مطلوبة من العائلة (pending)';
alter table public.family_visits enable row level security;
revoke all on public.family_visits from anon, authenticated;

-- updated_at
create or replace function public.geo_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_areas_touch on public.areas;
create trigger trg_areas_touch before update on public.areas for each row execute function public.geo_touch();
drop trigger if exists trg_streets_touch on public.streets;
create trigger trg_streets_touch before update on public.streets for each row execute function public.geo_touch();
drop trigger if exists trg_buildings_touch on public.buildings;
create trigger trg_buildings_touch before update on public.buildings for each row execute function public.geo_touch();

-- keep the family's place chain consistent: building → street → area → church
create or replace function public.families_fill_place()
returns trigger language plpgsql set search_path = public as $$
declare v_street uuid; v_area uuid; v_church uuid;
begin
  -- on UPDATE a parent that vanished (FK cascade in progress) simply drops out;
  -- on INSERT an unknown parent is an error
  if new.building_id is not null then
    select b.street_id into v_street from public.buildings b where b.id = new.building_id;
    if v_street is null then
      if tg_op = 'INSERT' then raise exception 'building_not_found' using errcode = 'P0002'; end if;
      new.building_id := null;
    else
      new.street_id := v_street;
    end if;
  end if;
  if new.street_id is not null then
    select s.area_id into v_area from public.streets s where s.id = new.street_id;
    if v_area is null then
      if tg_op = 'INSERT' then raise exception 'street_not_found' using errcode = 'P0002'; end if;
      new.street_id := null;
    else
      new.area_id := v_area;
    end if;
  end if;
  if new.area_id is not null then
    select a.church_id into v_church from public.areas a where a.id = new.area_id;
    if v_church is null then
      if tg_op = 'INSERT' then raise exception 'area_not_found' using errcode = 'P0002'; end if;
      new.area_id := null;
    else
      if new.church_id is not null and new.church_id <> v_church then raise exception 'area_church_mismatch' using errcode = '22023'; end if;
      new.church_id := v_church;
    end if;
  end if;
  if new.lat is not null and (new.lat < -90 or new.lat > 90) then raise exception 'invalid_location' using errcode = '22023'; end if;
  if new.lng is not null and (new.lng < -180 or new.lng > 180) then raise exception 'invalid_location' using errcode = '22023'; end if;
  return new;
end $$;
drop trigger if exists trg_families_fill_place on public.families;
create trigger trg_families_fill_place before insert or update on public.families
for each row execute function public.families_fill_place();

-- backfill: a legacy family whose members are all enrolled in ONE church → that church
update public.families f set church_id = x.church_id
  from (select m.family_id, min(e.church_id::text)::uuid as church_id
          from public.family_members m join public.enrollments e on e.person_id = m.person_id
         group by m.family_id having count(distinct e.church_id) = 1) x
 where f.id = x.family_id and f.church_id is null;

-- ---------------------------------------------------------------------
-- 2. AUDIT
-- ---------------------------------------------------------------------
create or replace function public.activity_audited_tables()
returns text[] language sql immutable as $$
  select array[
    'persons', 'enrollments', 'servant_enrollments', 'servant_scopes', 'permissions', 'permission_profiles',
    'module_access', 'churches', 'services', 'classes', 'events', 'causes', 'call_feedbacks',
    'attendance_log', 'points_log', 'contact_log', 'card_print_requests', 'card_templates', 'card_print_profiles',
    'data_change_requests', 'child_join_requests', 'person_credentials', 'shepherd_groups',
    'store_items', 'store_orders', 'exams', 'exam_questions', 'exam_attempts',
    'birthday_greetings', 'birthday_settings', 'birthday_card_templates', 'chat_messages',
    'online_classes', 'online_class_participants', 'online_class_checks', 'online_class_questions', 'online_class_answers',
    'achievements', 'user_achievements', 'occasions', 'occasion_registrations',
    'occasion_checklist_items', 'occasion_checklist_marks', 'occasion_notifications',
    'notifications', 'notification_automations', 'app_settings',
    'result_exams', 'result_subjects', 'exam_results', 'grading_systems', 'grading_grades',
    'library_subjects', 'library_books', 'library_lectures', 'library_favorites',
    'backup_runs', 'backup_schedules', 'report_templates', 'families', 'family_members',
    'access_events', 'access_rule_groups', 'access_rules', 'access_allowed', 'access_log',
    'priests', 'priest_requests', 'priest_confessors', 'confessions', 'confession_appointments', 'priest_contacts',
    'areas', 'area_priests', 'streets', 'buildings', 'family_visits'
  ]
$$;
do $$ begin
  if to_regprocedure('public.activity_audit_attach(text)') is not null then
    perform public.activity_audit_attach('areas');
    perform public.activity_audit_attach('area_priests');
    perform public.activity_audit_attach('streets');
    perform public.activity_audit_attach('buildings');
    perform public.activity_audit_attach('family_visits');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. JSON BUILDERS
-- ---------------------------------------------------------------------
create or replace function public.geo_location_json(p_lat double precision, p_lng double precision, p_url text, p_note text, p_source text)
returns jsonb language sql immutable as $$
  select case when p_lat is null and nullif(trim(coalesce(p_url, '')), '') is null then null
         else jsonb_build_object('lat', p_lat, 'lng', p_lng, 'maps_url', nullif(trim(coalesce(p_url, '')), ''), 'note', p_note, 'source', p_source) end
$$;

-- the family's EFFECTIVE location: family → building → street → area
create or replace function public.family_location_json(f public.families)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    public.geo_location_json(f.lat, f.lng, f.maps_url, f.location_note, 'family'),
    (select public.geo_location_json(b.lat, b.lng, b.maps_url, b.location_note, 'building') from public.buildings b where b.id = f.building_id),
    (select public.geo_location_json(s.lat, s.lng, s.maps_url, s.location_note, 'street') from public.streets s where s.id = f.street_id),
    (select public.geo_location_json(a.lat, a.lng, a.maps_url, a.location_note, 'area') from public.areas a where a.id = f.area_id)
  )
$$;

create or replace function public.family_member_json(m public.family_members)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'family_id', m.family_id, 'person_id', m.person_id, 'relation', m.relation, 'created_at', m.created_at,
    'person', public.priest_person_json(p), 'places', public.priest_person_places(p.id))
    from public.persons p where p.id = m.person_id
$$;

create or replace function public.priest_short_json(pr public.priests)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', pr.id, 'name', p.name, 'title', pr.title, 'phone', p.phone, 'image_url', p.image_url,
                            'church_id', pr.church_id, 'status', pr.status)
    from public.persons p where p.id = pr.person_id
$$;

create or replace function public.family_visit_json(v public.family_visits)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', v.id, 'family_id', v.family_id, 'priest_id', v.priest_id,
    'priest', (select public.priest_short_json(pr) from public.priests pr where pr.id = v.priest_id),
    'requested_by', v.requested_by,
    'requested_by_person', (select jsonb_build_object('id', p.id, 'name', p.name) from public.persons p where p.id = v.requested_by_person),
    'requested_on', v.requested_on, 'requested_time', v.requested_time, 'note', v.note,
    'status', v.status, 'scheduled_on', v.scheduled_on, 'scheduled_time', v.scheduled_time, 'visited_on', v.visited_on,
    'on', coalesce(v.visited_on, v.scheduled_on, v.requested_on), 'time', coalesce(v.scheduled_time, v.requested_time),
    'decision_note', v.decision_note, 'visit_note', v.visit_note, 'decided_at', v.decided_at, 'created_at', v.created_at,
    'family', (select jsonb_build_object('id', f.id, 'code', f.code, 'name', f.name, 'phone', f.phone, 'address', f.address,
                        'area_id', f.area_id, 'street_id', f.street_id, 'building_id', f.building_id, 'floor', f.floor, 'apartment', f.apartment,
                        'area_name', (select a.name from public.areas a where a.id = f.area_id),
                        'street_name', (select s.name from public.streets s where s.id = f.street_id),
                        'building_name', (select concat_ws(' ', b.name, nullif(b.number, '')) from public.buildings b where b.id = f.building_id),
                        'location', public.family_location_json(f),
                        'members_count', (select count(*) from public.family_members m where m.family_id = f.id))
                 from public.families f where f.id = v.family_id)
  )
$$;

create or replace function public.priest_family_json(f public.families)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', f.id, 'code', f.code, 'name', f.name, 'phone', f.phone, 'address', f.address, 'notes', f.notes,
    'church_id', f.church_id, 'area_id', f.area_id, 'street_id', f.street_id, 'building_id', f.building_id,
    'floor', f.floor, 'apartment', f.apartment,
    'lat', f.lat, 'lng', f.lng, 'maps_url', f.maps_url, 'location_note', f.location_note,
    'created_at', f.created_at, 'edited_at', f.edited_at, 'created_by_priest', f.created_by_priest,
    'area_name', (select a.name from public.areas a where a.id = f.area_id),
    'street_name', (select s.name from public.streets s where s.id = f.street_id),
    'building_name', (select concat_ws(' ', b.name, nullif(b.number, '')) from public.buildings b where b.id = f.building_id),
    'location', public.family_location_json(f),
    'members', coalesce((select jsonb_agg(public.family_member_json(m) order by m.created_at) from public.family_members m where m.family_id = f.id), '[]'::jsonb),
    'members_count', (select count(*) from public.family_members m where m.family_id = f.id),
    'last_visit', (select max(v.visited_on) from public.family_visits v where v.family_id = f.id and v.status = 'done'),
    'visits_count', (select count(*) from public.family_visits v where v.family_id = f.id and v.status = 'done'),
    'days_since_visit', public.cairo_today_date() - (select max(v.visited_on) from public.family_visits v where v.family_id = f.id and v.status = 'done'),
    'next_visit', (select jsonb_build_object('id', v.id, 'status', v.status, 'on', coalesce(v.scheduled_on, v.requested_on),
                                             'time', coalesce(v.scheduled_time, v.requested_time), 'requested_by', v.requested_by, 'priest_id', v.priest_id)
                     from public.family_visits v
                    where v.family_id = f.id and v.status in ('pending', 'approved')
                      and coalesce(v.scheduled_on, v.requested_on) >= public.cairo_today_date()
                    order by coalesce(v.scheduled_on, v.requested_on), coalesce(v.scheduled_time, v.requested_time) nulls last limit 1),
    'pending_requests', (select count(*) from public.family_visits v where v.family_id = f.id and v.status = 'pending'),
    'area_priests', coalesce((select jsonb_agg(public.priest_short_json(pr) order by pr.created_at)
                                from public.area_priests ap join public.priests pr on pr.id = ap.priest_id
                               where ap.area_id = f.area_id and pr.status = 'approved'), '[]'::jsonb)
  )
$$;

-- ---------------------------------------------------------------------
-- 4. VISIBILITY HELPERS (priest side)
-- ---------------------------------------------------------------------
-- a family the priest may see / manage: bound to his church, or (legacy,
-- no church yet) with ≥ 1 member enrolled in his church, or created by him
create or replace function public.priest_family_visible(pr public.priests, f public.families)
returns boolean language sql stable security definer set search_path = public as $$
  select f.church_id = pr.church_id
      or f.created_by_priest = pr.id
      or (f.church_id is null and exists (
            select 1 from public.family_members m join public.enrollments e on e.person_id = m.person_id
             where m.family_id = f.id and e.church_id = pr.church_id))
$$;

create or replace function public.priest_family_get(pr public.priests, p_family uuid)
returns public.families language plpgsql stable security definer set search_path = public as $$
declare f public.families;
begin
  select * into f from public.families where id = p_family;
  if not found then raise exception 'family_not_found' using errcode = 'P0002'; end if;
  if not public.priest_family_visible(pr, f) then raise exception 'no_access' using errcode = '42501'; end if;
  return f;
end $$;

-- ---------------------------------------------------------------------
-- 5. PROFILE (counters extended)
-- ---------------------------------------------------------------------
create or replace function public.priest_portal_profile(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare pr public.priests; p public.persons; ch public.churches;
begin
  pr := public.priest_portal_self(p_token);
  select * into p from public.persons where id = pr.person_id;
  select * into ch from public.churches where id = pr.church_id;
  return jsonb_build_object(
    'priest', jsonb_build_object('id', pr.id, 'title', pr.title, 'status', pr.status, 'reminder_days', pr.reminder_days,
                                 'church_id', pr.church_id, 'created_at', pr.created_at),
    'person', public.priest_person_json(p),
    'church', jsonb_build_object('id', ch.id, 'name', ch.name, 'logo_url', ch.logo_url),
    'counts', jsonb_build_object(
      'confessors', (select count(*) from public.priest_confessors c where c.priest_id = pr.id),
      'overdue', (select count(*) from public.priest_confessors c where c.priest_id = pr.id
                    and coalesce((select max(x.confessed_on) from public.confessions x where x.priest_id = pr.id and x.person_id = c.person_id), c.created_at::date)
                        < public.cairo_today_date() - pr.reminder_days),
      'pending_appointments', (select count(*) from public.confession_appointments a where a.priest_id = pr.id and a.status = 'pending'),
      'today_appointments', (select count(*) from public.confession_appointments a where a.priest_id = pr.id and a.status = 'approved'
                               and coalesce(a.scheduled_on, a.requested_on) = public.cairo_today_date()),
      'areas', (select count(*) from public.areas a where a.church_id = pr.church_id),
      'my_areas', (select count(*) from public.area_priests ap where ap.priest_id = pr.id),
      'families', (select count(*) from public.families f where public.priest_family_visible(pr, f)),
      'never_visited', (select count(*) from public.families f where public.priest_family_visible(pr, f)
                          and not exists (select 1 from public.family_visits v where v.family_id = f.id and v.status = 'done')),
      'pending_visits', (select count(*) from public.family_visits v where v.priest_id = pr.id and v.status = 'pending'),
      'today_visits', (select count(*) from public.family_visits v where v.priest_id = pr.id and v.status = 'approved'
                         and coalesce(v.scheduled_on, v.requested_on) = public.cairo_today_date())
    ),
    'server_today', public.cairo_today_date()
  );
end $$;
grant execute on function public.priest_portal_profile(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 6. AREAS · STREETS · BUILDINGS
-- ---------------------------------------------------------------------
-- the whole tree of his church: areas (with their priests, streets and
-- buildings, family counters) + the priests of the church (for the picker)
create or replace function public.priest_areas_tree(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare pr public.priests;
begin
  pr := public.priest_portal_self(p_token);
  return jsonb_build_object(
    'areas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'church_id', a.church_id, 'name', a.name, 'description', a.description,
        'lat', a.lat, 'lng', a.lng, 'maps_url', a.maps_url, 'location_note', a.location_note,
        'location', public.geo_location_json(a.lat, a.lng, a.maps_url, a.location_note, 'area'),
        'created_by_priest', a.created_by_priest, 'created_at', a.created_at,
        'is_mine', exists (select 1 from public.area_priests ap where ap.area_id = a.id and ap.priest_id = pr.id),
        'priest_ids', coalesce((select jsonb_agg(ap.priest_id) from public.area_priests ap where ap.area_id = a.id), '[]'::jsonb),
        'priests', coalesce((select jsonb_agg(public.priest_short_json(x) order by x.created_at)
                               from public.area_priests ap join public.priests x on x.id = ap.priest_id where ap.area_id = a.id), '[]'::jsonb),
        'families_count', (select count(*) from public.families f where f.area_id = a.id),
        'streets', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', s.id, 'area_id', s.area_id, 'name', s.name,
            'lat', s.lat, 'lng', s.lng, 'maps_url', s.maps_url, 'location_note', s.location_note,
            'location', public.geo_location_json(s.lat, s.lng, s.maps_url, s.location_note, 'street'),
            'created_at', s.created_at,
            'families_count', (select count(*) from public.families f where f.street_id = s.id),
            'buildings', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', b.id, 'street_id', b.street_id, 'name', b.name, 'number', b.number, 'floors_count', b.floors_count,
                'lat', b.lat, 'lng', b.lng, 'maps_url', b.maps_url, 'location_note', b.location_note,
                'location', public.geo_location_json(b.lat, b.lng, b.maps_url, b.location_note, 'building'),
                'created_at', b.created_at,
                'families_count', (select count(*) from public.families f where f.building_id = b.id)
              ) order by b.name collate "C", b.number collate "C")
                from public.buildings b where b.street_id = s.id), '[]'::jsonb)
          ) order by s.name collate "C") from public.streets s where s.area_id = a.id), '[]'::jsonb)
      ) order by a.name collate "C")
        from public.areas a where a.church_id = pr.church_id), '[]'::jsonb),
    'church_priests', coalesce((select jsonb_agg(public.priest_short_json(x) order by x.created_at)
                                  from public.priests x where x.church_id = pr.church_id and x.status = 'approved'), '[]'::jsonb),
    'server_today', public.cairo_today_date()
  );
end $$;
grant execute on function public.priest_areas_tree(text) to anon, authenticated;

-- connect the priests of the SAME church to the area (replaces the list)
create or replace function public.priest_area_set_priests(p_token text, p_area uuid, p_priest_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests; a public.areas;
begin
  pr := public.priest_portal_self(p_token);
  select * into a from public.areas where id = p_area and church_id = pr.church_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if exists (select 1 from unnest(coalesce(p_priest_ids, '{}'::uuid[])) u(id)
              where not exists (select 1 from public.priests x where x.id = u.id and x.church_id = pr.church_id)) then
    raise exception 'priest_other_church' using errcode = '22023';
  end if;
  delete from public.area_priests where area_id = a.id and not (priest_id = any (coalesce(p_priest_ids, '{}'::uuid[])));
  insert into public.area_priests (area_id, priest_id)
  select a.id, u.id from unnest(coalesce(p_priest_ids, '{}'::uuid[])) u(id) on conflict do nothing;
  return coalesce((select jsonb_agg(ap.priest_id) from public.area_priests ap where ap.area_id = a.id), '[]'::jsonb);
end $$;
grant execute on function public.priest_area_set_priests(text, uuid, uuid[]) to anon, authenticated;

create or replace function public.priest_area_save(
  p_token text, p_id uuid, p_name text, p_description text default null,
  p_lat double precision default null, p_lng double precision default null, p_maps_url text default null, p_location_note text default null,
  p_priest_ids uuid[] default null
) returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests; a public.areas; v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  pr := public.priest_portal_self(p_token);
  if v_name is null then raise exception 'name_required' using errcode = '22023'; end if;
  if (p_lat is null) <> (p_lng is null) then raise exception 'invalid_location' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.areas (church_id, name, description, lat, lng, maps_url, location_note, created_by_priest)
    values (pr.church_id, v_name, nullif(trim(coalesce(p_description, '')), ''), p_lat, p_lng, nullif(trim(coalesce(p_maps_url, '')), ''),
            nullif(trim(coalesce(p_location_note, '')), ''), pr.id)
    returning * into a;
    -- the creator is connected to his area (unless an explicit list was sent)
    if p_priest_ids is null then
      insert into public.area_priests (area_id, priest_id) values (a.id, pr.id) on conflict do nothing;
    end if;
  else
    select * into a from public.areas where id = p_id and church_id = pr.church_id;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    update public.areas set name = v_name, description = nullif(trim(coalesce(p_description, '')), ''),
           lat = p_lat, lng = p_lng, maps_url = nullif(trim(coalesce(p_maps_url, '')), ''), location_note = nullif(trim(coalesce(p_location_note, '')), '')
     where id = a.id returning * into a;
  end if;
  if p_priest_ids is not null then perform public.priest_area_set_priests(p_token, a.id, p_priest_ids); end if;
  return jsonb_build_object('id', a.id, 'name', a.name);
end $$;
grant execute on function public.priest_area_save(text, uuid, text, text, double precision, double precision, text, text, uuid[]) to anon, authenticated;

create or replace function public.priest_area_delete(p_token text, p_id uuid)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests;
begin
  pr := public.priest_portal_self(p_token);
  delete from public.areas where id = p_id and church_id = pr.church_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;
grant execute on function public.priest_area_delete(text, uuid) to anon, authenticated;

create or replace function public.priest_street_save(
  p_token text, p_id uuid, p_area uuid, p_name text,
  p_lat double precision default null, p_lng double precision default null, p_maps_url text default null, p_location_note text default null
) returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests; s public.streets; v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  pr := public.priest_portal_self(p_token);
  if v_name is null then raise exception 'name_required' using errcode = '22023'; end if;
  if (p_lat is null) <> (p_lng is null) then raise exception 'invalid_location' using errcode = '22023'; end if;
  if p_id is null then
    if not exists (select 1 from public.areas a where a.id = p_area and a.church_id = pr.church_id) then raise exception 'area_not_found' using errcode = 'P0002'; end if;
    insert into public.streets (area_id, name, lat, lng, maps_url, location_note)
    values (p_area, v_name, p_lat, p_lng, nullif(trim(coalesce(p_maps_url, '')), ''), nullif(trim(coalesce(p_location_note, '')), ''))
    returning * into s;
  else
    select s0.* into s from public.streets s0 join public.areas a on a.id = s0.area_id where s0.id = p_id and a.church_id = pr.church_id;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    if p_area is not null and p_area <> s.area_id then
      if not exists (select 1 from public.areas a where a.id = p_area and a.church_id = pr.church_id) then raise exception 'area_not_found' using errcode = 'P0002'; end if;
    end if;
    update public.streets set area_id = coalesce(p_area, area_id), name = v_name, lat = p_lat, lng = p_lng,
           maps_url = nullif(trim(coalesce(p_maps_url, '')), ''), location_note = nullif(trim(coalesce(p_location_note, '')), '')
     where id = s.id returning * into s;
    -- families follow the street when it moves to another area
    update public.families set area_id = s.area_id where street_id = s.id and area_id is distinct from s.area_id;
  end if;
  return jsonb_build_object('id', s.id, 'name', s.name, 'area_id', s.area_id);
end $$;
grant execute on function public.priest_street_save(text, uuid, uuid, text, double precision, double precision, text, text) to anon, authenticated;

create or replace function public.priest_street_delete(p_token text, p_id uuid)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests;
begin
  pr := public.priest_portal_self(p_token);
  delete from public.streets s using public.areas a where a.id = s.area_id and s.id = p_id and a.church_id = pr.church_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;
grant execute on function public.priest_street_delete(text, uuid) to anon, authenticated;

create or replace function public.priest_building_save(
  p_token text, p_id uuid, p_street uuid, p_name text, p_number text default null, p_floors integer default null,
  p_lat double precision default null, p_lng double precision default null, p_maps_url text default null, p_location_note text default null
) returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests; b public.buildings; v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  pr := public.priest_portal_self(p_token);
  if v_name is null then raise exception 'name_required' using errcode = '22023'; end if;
  if (p_lat is null) <> (p_lng is null) then raise exception 'invalid_location' using errcode = '22023'; end if;
  if p_id is null then
    if not exists (select 1 from public.streets s join public.areas a on a.id = s.area_id where s.id = p_street and a.church_id = pr.church_id) then
      raise exception 'street_not_found' using errcode = 'P0002';
    end if;
    insert into public.buildings (street_id, name, number, floors_count, lat, lng, maps_url, location_note)
    values (p_street, v_name, nullif(trim(coalesce(p_number, '')), ''), p_floors, p_lat, p_lng,
            nullif(trim(coalesce(p_maps_url, '')), ''), nullif(trim(coalesce(p_location_note, '')), ''))
    returning * into b;
  else
    select b0.* into b from public.buildings b0 join public.streets s on s.id = b0.street_id join public.areas a on a.id = s.area_id
     where b0.id = p_id and a.church_id = pr.church_id;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    if p_street is not null and p_street <> b.street_id then
      if not exists (select 1 from public.streets s join public.areas a on a.id = s.area_id where s.id = p_street and a.church_id = pr.church_id) then
        raise exception 'street_not_found' using errcode = 'P0002';
      end if;
    end if;
    update public.buildings set street_id = coalesce(p_street, street_id), name = v_name, number = nullif(trim(coalesce(p_number, '')), ''),
           floors_count = p_floors, lat = p_lat, lng = p_lng,
           maps_url = nullif(trim(coalesce(p_maps_url, '')), ''), location_note = nullif(trim(coalesce(p_location_note, '')), '')
     where id = b.id returning * into b;
    -- families follow the building when it moves to another street (trigger fixes area / church)
    update public.families set street_id = b.street_id where building_id = b.id and street_id is distinct from b.street_id;
  end if;
  return jsonb_build_object('id', b.id, 'name', b.name, 'street_id', b.street_id);
end $$;
grant execute on function public.priest_building_save(text, uuid, uuid, text, text, integer, double precision, double precision, text, text) to anon, authenticated;

create or replace function public.priest_building_delete(p_token text, p_id uuid)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests;
begin
  pr := public.priest_portal_self(p_token);
  delete from public.buildings b using public.streets s, public.areas a
   where s.id = b.street_id and a.id = s.area_id and b.id = p_id and a.church_id = pr.church_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;
grant execute on function public.priest_building_delete(text, uuid) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 7. FAMILIES — list · detail · save · delete · code lookup
-- ---------------------------------------------------------------------
create or replace function public.priest_families_list(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare pr public.priests;
begin
  pr := public.priest_portal_self(p_token);
  return coalesce((select jsonb_agg(public.priest_family_json(f) order by f.name collate "C")
                     from public.families f where public.priest_family_visible(pr, f)), '[]'::jsonb);
end $$;
grant execute on function public.priest_families_list(text) to anon, authenticated;

create or replace function public.priest_family_detail(p_token text, p_family uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare pr public.priests; f public.families;
begin
  pr := public.priest_portal_self(p_token);
  f := public.priest_family_get(pr, p_family);
  return public.priest_family_json(f) || jsonb_build_object(
    'visits', coalesce((select jsonb_agg(public.family_visit_json(v) order by coalesce(v.visited_on, v.scheduled_on, v.requested_on) desc, v.created_at desc)
                          from public.family_visits v where v.family_id = f.id), '[]'::jsonb));
end $$;
grant execute on function public.priest_family_detail(text, uuid) to anon, authenticated;

-- live check for the family code (typed / scanned / generated)
create or replace function public.priest_family_code_lookup(p_token text, p_code text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v_code text := trim(coalesce(p_code, '')); v_fam record; v_per record;
begin
  perform public.priest_portal_self(p_token);
  if v_code = '' then return jsonb_build_object('code', '', 'free', false, 'family', null, 'person', null); end if;
  select id, name into v_fam from public.families where code = v_code;
  select id, name into v_per from public.persons where national_id = v_code;
  return jsonb_build_object('code', v_code, 'free', (v_fam.id is null and v_per.id is null),
    'family', case when v_fam.id is null then null else jsonb_build_object('id', v_fam.id, 'name', v_fam.name) end,
    'person', case when v_per.id is null then null else jsonb_build_object('id', v_per.id, 'name', v_per.name) end);
end $$;
grant execute on function public.priest_family_code_lookup(text, text) to anon, authenticated;

create or replace function public.priest_family_save(
  p_token text, p_id uuid, p_name text, p_code text default null, p_phone text default null, p_address text default null, p_notes text default null,
  p_area uuid default null, p_street uuid default null, p_building uuid default null, p_floor text default null, p_apartment text default null,
  p_lat double precision default null, p_lng double precision default null, p_maps_url text default null, p_location_note text default null
) returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  pr public.priests; f public.families;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_code text := nullif(trim(coalesce(p_code, '')), '');
begin
  pr := public.priest_portal_self(p_token);
  if v_name is null then raise exception 'name_required' using errcode = '22023'; end if;
  if (p_lat is null) <> (p_lng is null) then raise exception 'invalid_location' using errcode = '22023'; end if;
  if p_area is not null and not exists (select 1 from public.areas a where a.id = p_area and a.church_id = pr.church_id) then
    raise exception 'area_not_found' using errcode = 'P0002';
  end if;
  if v_code is not null and exists (select 1 from public.persons p where p.national_id = v_code) then
    raise exception 'code_is_person' using errcode = '23505';
  end if;
  if p_id is null then
    if v_code is not null and exists (select 1 from public.families x where x.code = v_code) then raise exception 'code_taken' using errcode = '23505'; end if;
    insert into public.families (code, name, phone, address, notes, church_id, area_id, street_id, building_id, floor, apartment,
                                 lat, lng, maps_url, location_note, created_by_priest)
    values (v_code, v_name, nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_address, '')), ''), nullif(trim(coalesce(p_notes, '')), ''),
            pr.church_id, p_area, p_street, p_building, nullif(trim(coalesce(p_floor, '')), ''), nullif(trim(coalesce(p_apartment, '')), ''),
            p_lat, p_lng, nullif(trim(coalesce(p_maps_url, '')), ''), nullif(trim(coalesce(p_location_note, '')), ''), pr.id)
    returning * into f;
  else
    f := public.priest_family_get(pr, p_id);
    if v_code is not null and v_code <> f.code and exists (select 1 from public.families x where x.code = v_code) then
      raise exception 'code_taken' using errcode = '23505';
    end if;
    update public.families set
      code = coalesce(v_code, code), name = v_name,
      phone = nullif(trim(coalesce(p_phone, '')), ''), address = nullif(trim(coalesce(p_address, '')), ''), notes = nullif(trim(coalesce(p_notes, '')), ''),
      church_id = coalesce(church_id, pr.church_id),
      area_id = p_area, street_id = p_street, building_id = p_building,
      floor = nullif(trim(coalesce(p_floor, '')), ''), apartment = nullif(trim(coalesce(p_apartment, '')), ''),
      lat = p_lat, lng = p_lng, maps_url = nullif(trim(coalesce(p_maps_url, '')), ''), location_note = nullif(trim(coalesce(p_location_note, '')), ''),
      edited_at = now()
    where id = f.id returning * into f;
  end if;
  return public.priest_family_json(f);
end $$;
grant execute on function public.priest_family_save(text, uuid, text, text, text, text, text, uuid, uuid, uuid, text, text, double precision, double precision, text, text) to anon, authenticated;

create or replace function public.priest_family_delete(p_token text, p_family uuid)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests; f public.families;
begin
  pr := public.priest_portal_self(p_token);
  f := public.priest_family_get(pr, p_family);
  delete from public.families where id = f.id;
end $$;
grant execute on function public.priest_family_delete(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. FAMILY MEMBERS — search · add (id / code / new person) · relation · remove
-- ---------------------------------------------------------------------
create or replace function public.priest_family_add_member(p_token text, p_family uuid, p_person uuid, p_relation text default null, p_move boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests; f public.families; v_person public.persons; v_member public.family_members; v_other public.families; v_moved jsonb;
begin
  pr := public.priest_portal_self(p_token);
  f := public.priest_family_get(pr, p_family);
  if p_relation is not null and p_relation not in ('father', 'mother', 'son', 'daughter', 'brother', 'sister', 'grandfather', 'grandmother', 'husband', 'wife', 'other') then
    raise exception 'invalid_relation' using errcode = '22023';
  end if;
  select * into v_person from public.persons where id = p_person;
  if not found then raise exception 'person_not_found' using errcode = 'P0002'; end if;
  select * into v_member from public.family_members where person_id = v_person.id;
  if found then
    if v_member.family_id = f.id then raise exception 'already_member' using errcode = 'P0001'; end if;
    select * into v_other from public.families where id = v_member.family_id;
    if not p_move then
      raise exception 'in_other_family' using errcode = 'P0001', detail = coalesce(v_other.name, ''), hint = v_member.family_id::text;
    end if;
    delete from public.family_members where id = v_member.id;
    v_moved := jsonb_build_object('id', v_other.id, 'name', v_other.name);
  end if;
  insert into public.family_members (family_id, person_id, relation) values (f.id, v_person.id, p_relation) returning * into v_member;
  update public.families set edited_at = now() where id = f.id;
  return public.family_member_json(v_member) || jsonb_build_object('moved_from', v_moved);
end $$;
grant execute on function public.priest_family_add_member(text, uuid, uuid, text, boolean) to anon, authenticated;

create or replace function public.priest_family_add_member_by_code(p_token text, p_family uuid, p_code text, p_relation text default null, p_move boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_person uuid;
begin
  perform public.priest_portal_self(p_token);
  select id into v_person from public.persons where national_id = trim(coalesce(p_code, ''));
  if v_person is null then raise exception 'person_not_found' using errcode = 'P0002'; end if;
  return public.priest_family_add_member(p_token, p_family, v_person, p_relation, p_move);
end $$;
grant execute on function public.priest_family_add_member_by_code(text, uuid, text, text, boolean) to anon, authenticated;

-- create the person here (code optional → auto) and add him to the family
create or replace function public.priest_family_add_new_member(
  p_token text, p_family uuid, p_name text, p_code text default null, p_gender text default null, p_birthdate date default null,
  p_phone text default null, p_address text default null, p_notes text default null, p_image_url text default null,
  p_relation text default null, p_move boolean default false
) returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests; v_code text := nullif(trim(coalesce(p_code, '')), ''); v_person public.persons; v_created boolean := false;
begin
  pr := public.priest_portal_self(p_token);
  perform public.priest_family_get(pr, p_family);
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required' using errcode = '22023'; end if;
  if p_gender is not null and p_gender not in ('male', 'female') then raise exception 'invalid_gender' using errcode = '22023'; end if;
  if v_code is not null then
    if exists (select 1 from public.families x where x.code = v_code) then raise exception 'code_taken' using errcode = '23505'; end if;
    select * into v_person from public.persons where national_id = v_code;
    if found then
      update public.persons set
        gender = coalesce(gender, p_gender), birthdate = coalesce(birthdate, p_birthdate),
        phone = coalesce(phone, nullif(trim(coalesce(p_phone, '')), '')), address = coalesce(address, nullif(trim(coalesce(p_address, '')), '')),
        notes = coalesce(notes, nullif(trim(coalesce(p_notes, '')), '')), image_url = coalesce(image_url, p_image_url), edited_at = now()
      where id = v_person.id returning * into v_person;
    end if;
  end if;
  if v_person.id is null then
    if v_code is null then
      insert into public.persons (name, gender, birthdate, phone, address, notes, image_url)
      values (trim(p_name), p_gender, p_birthdate, nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_address, '')), ''),
              nullif(trim(coalesce(p_notes, '')), ''), p_image_url) returning * into v_person;
    else
      insert into public.persons (national_id, name, gender, birthdate, phone, address, notes, image_url)
      values (v_code, trim(p_name), p_gender, p_birthdate, nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_address, '')), ''),
              nullif(trim(coalesce(p_notes, '')), ''), p_image_url) returning * into v_person;
    end if;
    v_created := true;
  end if;
  return public.priest_family_add_member(p_token, p_family, v_person.id, p_relation, p_move) || jsonb_build_object('person_created', v_created);
end $$;
grant execute on function public.priest_family_add_new_member(text, uuid, text, text, text, date, text, text, text, text, text, boolean) to anon, authenticated;

create or replace function public.priest_family_set_relation(p_token text, p_member uuid, p_relation text)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests; m public.family_members;
begin
  pr := public.priest_portal_self(p_token);
  select * into m from public.family_members where id = p_member;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.priest_family_get(pr, m.family_id);
  if p_relation is not null and p_relation not in ('father', 'mother', 'son', 'daughter', 'brother', 'sister', 'grandfather', 'grandmother', 'husband', 'wife', 'other') then
    raise exception 'invalid_relation' using errcode = '22023';
  end if;
  update public.family_members set relation = nullif(trim(coalesce(p_relation, '')), '') where id = m.id;
end $$;
grant execute on function public.priest_family_set_relation(text, uuid, text) to anon, authenticated;

create or replace function public.priest_family_remove_member(p_token text, p_member uuid)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests; m public.family_members;
begin
  pr := public.priest_portal_self(p_token);
  select * into m from public.family_members where id = p_member;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform public.priest_family_get(pr, m.family_id);
  delete from public.family_members where id = m.id;
  update public.families set edited_at = now() where id = m.family_id;
end $$;
grant execute on function public.priest_family_remove_member(text, uuid) to anon, authenticated;

-- person search for the family (his church · his confessors · members of his
-- families · persons with no enrollment) — each hit carries the CURRENT family
create or replace function public.priest_family_search_persons(p_token text, p_query text, p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare pr public.priests; v_q text := nullif(trim(coalesce(p_query, '')), ''); v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  pr := public.priest_portal_self(p_token);
  if v_q is null or length(v_q) < 2 then return '[]'::jsonb; end if;
  return coalesce((
    with hits as (
      select p.* from public.persons p
       where (p.name ilike '%' || v_q || '%' or p.phone ilike '%' || v_q || '%' or p.national_id ilike '%' || v_q || '%')
         and (exists (select 1 from public.enrollments e where e.person_id = p.id and e.church_id = pr.church_id)
              or exists (select 1 from public.priest_confessors c where c.person_id = p.id and c.priest_id = pr.id)
              or exists (select 1 from public.family_members m join public.families f on f.id = m.family_id where m.person_id = p.id and public.priest_family_visible(pr, f))
              or not exists (select 1 from public.enrollments e where e.person_id = p.id))
       order by (p.national_id = v_q) desc, p.name collate "C" limit v_limit)
    select jsonb_agg(jsonb_build_object(
             'person', public.priest_person_json(h), 'places', public.priest_person_places(h.id),
             'family', (select jsonb_build_object('id', f.id, 'name', f.name) from public.family_members m join public.families f on f.id = m.family_id where m.person_id = h.id)
           ) order by (h.national_id = v_q) desc, h.name collate "C") from hits h), '[]'::jsonb);
end $$;
grant execute on function public.priest_family_search_persons(text, text, integer) to anon, authenticated;

-- a scanned / typed code → the person (+ his family) OR a family
create or replace function public.priest_family_lookup_code(p_token text, p_code text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare pr public.priests; p public.persons; f public.families;
begin
  pr := public.priest_portal_self(p_token);
  select * into p from public.persons where national_id = trim(coalesce(p_code, ''));
  if found then
    select x.* into f from public.family_members m join public.families x on x.id = m.family_id where m.person_id = p.id;
    return jsonb_build_object('found', 'person', 'person', public.priest_person_json(p), 'places', public.priest_person_places(p.id),
                              'family', case when f.id is null then null else jsonb_build_object('id', f.id, 'name', f.name, 'visible', public.priest_family_visible(pr, f)) end);
  end if;
  select * into f from public.families where code = trim(coalesce(p_code, ''));
  if found and public.priest_family_visible(pr, f) then
    return jsonb_build_object('found', 'family', 'family', public.priest_family_json(f));
  end if;
  return jsonb_build_object('found', null, 'code', trim(coalesce(p_code, '')));
end $$;
grant execute on function public.priest_family_lookup_code(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 9. VISITS — priest side
-- ---------------------------------------------------------------------
create or replace function public.priest_visits_list(p_token text, p_from date default null, p_to date default null, p_include_past boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare pr public.priests;
begin
  pr := public.priest_portal_self(p_token);
  return coalesce((
    select jsonb_agg(public.family_visit_json(v) order by coalesce(v.visited_on, v.scheduled_on, v.requested_on), coalesce(v.scheduled_time, v.requested_time) nulls last, v.created_at)
      from public.family_visits v
     where v.priest_id = pr.id
       and (p_from is null or coalesce(v.visited_on, v.scheduled_on, v.requested_on) >= p_from)
       and (p_to is null or coalesce(v.visited_on, v.scheduled_on, v.requested_on) <= p_to)
       and (p_include_past or v.status = 'pending' or (v.status = 'approved' and coalesce(v.scheduled_on, v.requested_on) >= public.cairo_today_date() - 1))
  ), '[]'::jsonb);
end $$;
grant execute on function public.priest_visits_list(text, date, date, boolean) to anon, authenticated;

-- record a visit that HAPPENED (p_done → status done, visited_on = p_on ≤ today)
-- or schedule one (approved, scheduled_on = p_on)
create or replace function public.priest_visit_create(p_token text, p_family uuid, p_on date, p_time time default null, p_note text default null, p_done boolean default false, p_visit_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests; f public.families; v public.family_visits;
begin
  pr := public.priest_portal_self(p_token);
  f := public.priest_family_get(pr, p_family);
  if p_on is null then raise exception 'date_required' using errcode = '22023'; end if;
  if coalesce(p_done, false) then
    if p_on > public.cairo_today_date() then raise exception 'future_date' using errcode = '22023'; end if;
    insert into public.family_visits (family_id, priest_id, requested_by, requested_on, requested_time, note, status, scheduled_on, scheduled_time, visited_on, visit_note, decided_at)
    values (f.id, pr.id, 'priest', p_on, p_time, nullif(trim(coalesce(p_note, '')), ''), 'done', p_on, p_time, p_on, nullif(trim(coalesce(p_visit_note, '')), ''), now())
    returning * into v;
  else
    insert into public.family_visits (family_id, priest_id, requested_by, requested_on, requested_time, note, status, scheduled_on, scheduled_time, decided_at)
    values (f.id, pr.id, 'priest', p_on, p_time, nullif(trim(coalesce(p_note, '')), ''), 'approved', p_on, p_time, now())
    returning * into v;
  end if;
  return public.family_visit_json(v);
end $$;
grant execute on function public.priest_visit_create(text, uuid, date, time, text, boolean, text) to anon, authenticated;

-- approve (optionally moving) · reject · cancel · done (p_on = the day it happened)
create or replace function public.priest_visit_decide(p_token text, p_visit uuid, p_action text, p_on date default null, p_time time default null, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests; v public.family_visits;
begin
  pr := public.priest_portal_self(p_token);
  select * into v from public.family_visits where id = p_visit and priest_id = pr.id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_action = 'approve' then
    if v.status not in ('pending', 'approved') then raise exception 'not_pending' using errcode = 'P0001'; end if;
    update public.family_visits
       set status = 'approved', scheduled_on = coalesce(p_on, v.scheduled_on, v.requested_on),
           scheduled_time = case when p_on is not null or p_time is not null then p_time else coalesce(v.scheduled_time, v.requested_time) end,
           decision_note = nullif(trim(coalesce(p_note, '')), ''), decided_at = now()
     where id = v.id returning * into v;
  elsif p_action = 'reject' then
    if v.status <> 'pending' then raise exception 'not_pending' using errcode = 'P0001'; end if;
    update public.family_visits set status = 'rejected', decision_note = nullif(trim(coalesce(p_note, '')), ''), decided_at = now() where id = v.id returning * into v;
  elsif p_action = 'cancel' then
    if v.status not in ('pending', 'approved') then raise exception 'not_pending' using errcode = 'P0001'; end if;
    update public.family_visits set status = 'cancelled', decision_note = nullif(trim(coalesce(p_note, '')), ''), decided_at = now() where id = v.id returning * into v;
  elsif p_action = 'done' then
    if v.status not in ('pending', 'approved') then raise exception 'not_pending' using errcode = 'P0001'; end if;
    if p_on is not null and p_on > public.cairo_today_date() then raise exception 'future_date' using errcode = '22023'; end if;
    update public.family_visits
       set status = 'done', visited_on = coalesce(p_on, least(coalesce(v.scheduled_on, v.requested_on), public.cairo_today_date())),
           visit_note = nullif(trim(coalesce(p_note, '')), ''), decided_at = now()
     where id = v.id returning * into v;
  else
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  return public.family_visit_json(v);
end $$;
grant execute on function public.priest_visit_decide(text, uuid, text, date, time, text) to anon, authenticated;

create or replace function public.priest_visit_delete(p_token text, p_visit uuid)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests;
begin
  pr := public.priest_portal_self(p_token);
  delete from public.family_visits where id = p_visit and priest_id = pr.id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;
grant execute on function public.priest_visit_delete(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 10. CHILD PORTAL — عائلتي: my family · the priests of my area · visits
-- ---------------------------------------------------------------------
create or replace function public.child_portal_family(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare p public.persons; f public.families; v_area_priests jsonb; v_fallback boolean := false;
begin
  p := public.child_portal_person(p_token);
  select x.* into f from public.family_members m join public.families x on x.id = m.family_id where m.person_id = p.id;
  -- priests of the family's area; otherwise (no area / no priest there) the priests of the family's church / my churches
  v_area_priests := coalesce((select jsonb_agg(public.priest_short_json(pr) order by pr.created_at)
                                from public.area_priests ap join public.priests pr on pr.id = ap.priest_id
                               where f.id is not null and ap.area_id = f.area_id and pr.status = 'approved'), '[]'::jsonb);
  if jsonb_array_length(v_area_priests) = 0 then
    v_fallback := true;
    v_area_priests := coalesce((select jsonb_agg(public.priest_short_json(pr) order by pr.created_at)
                                  from public.priests pr
                                 where pr.status = 'approved'
                                   and (pr.church_id = f.church_id
                                        or exists (select 1 from public.enrollments e where e.person_id = p.id and e.church_id = pr.church_id))), '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'family', case when f.id is null then null else public.priest_family_json(f) end,
    'me', jsonb_build_object('id', p.id, 'name', p.name),
    'priests', v_area_priests,
    'priests_fallback', v_fallback,
    'visits', coalesce((select jsonb_agg(public.family_visit_json(v) order by coalesce(v.visited_on, v.scheduled_on, v.requested_on) desc, v.created_at desc)
                          from public.family_visits v where f.id is not null and v.family_id = f.id), '[]'::jsonb),
    'server_today', public.cairo_today_date()
  );
end $$;
grant execute on function public.child_portal_family(text) to anon, authenticated;

create or replace function public.child_request_visit(p_token text, p_priest uuid, p_on date, p_time time default null, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare p public.persons; f public.families; pr public.priests; v public.family_visits;
begin
  p := public.child_portal_person(p_token);
  select x.* into f from public.family_members m join public.families x on x.id = m.family_id where m.person_id = p.id;
  if not found then raise exception 'no_family' using errcode = 'P0002'; end if;
  select * into pr from public.priests where id = p_priest and status = 'approved';
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not (exists (select 1 from public.area_priests ap where ap.area_id = f.area_id and ap.priest_id = pr.id)
          or pr.church_id = f.church_id
          or exists (select 1 from public.enrollments e where e.person_id = p.id and e.church_id = pr.church_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_on is null or p_on < public.cairo_today_date() then raise exception 'past_date' using errcode = '22023'; end if;
  if exists (select 1 from public.family_visits x where x.family_id = f.id and x.priest_id = pr.id and x.status = 'pending') then
    raise exception 'pending_exists' using errcode = '23505';
  end if;
  insert into public.family_visits (family_id, priest_id, requested_by, requested_by_person, requested_on, requested_time, note, status)
  values (f.id, pr.id, 'family', p.id, p_on, p_time, nullif(trim(coalesce(p_note, '')), ''), 'pending') returning * into v;
  return public.family_visit_json(v);
end $$;
grant execute on function public.child_request_visit(text, uuid, date, time, text) to anon, authenticated;

create or replace function public.child_cancel_visit(p_token text, p_visit uuid)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare p public.persons; f public.families;
begin
  p := public.child_portal_person(p_token);
  select x.* into f from public.family_members m join public.families x on x.id = m.family_id where m.person_id = p.id;
  if not found then raise exception 'no_family' using errcode = 'P0002'; end if;
  update public.family_visits set status = 'cancelled', decided_at = now()
   where id = p_visit and family_id = f.id and status in ('pending', 'approved');
  if not found then raise exception 'not_pending' using errcode = 'P0001'; end if;
end $$;
grant execute on function public.child_cancel_visit(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 11. SERVANTS keep READ access to the geo tables (reports / scanner).
--     The servant-side family RPCs remain for the owner; the servants' app
--     no longer exposes the manage UI (the priest does it).
-- ---------------------------------------------------------------------
-- any servant whose scope is inside the church may READ the geo tree
create or replace function public.geo_church_readable(p_church uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner() or exists (select 1 from public.my_scopes() s where s.church_id = p_church or s.role = 'owner')
$$;
grant execute on function public.geo_church_readable(uuid) to authenticated;

drop policy if exists areas_read on public.areas;
create policy areas_read on public.areas for select to authenticated using (public.geo_church_readable(church_id));
grant select on public.areas to authenticated;
drop policy if exists streets_read on public.streets;
create policy streets_read on public.streets for select to authenticated using (exists (select 1 from public.areas a where a.id = area_id and public.geo_church_readable(a.church_id)));
grant select on public.streets to authenticated;
drop policy if exists buildings_read on public.buildings;
create policy buildings_read on public.buildings for select to authenticated
  using (exists (select 1 from public.streets s join public.areas a on a.id = s.area_id where s.id = street_id and public.geo_church_readable(a.church_id)));
grant select on public.buildings to authenticated;
drop policy if exists area_priests_read on public.area_priests;
create policy area_priests_read on public.area_priests for select to authenticated using (exists (select 1 from public.areas a where a.id = area_id and public.geo_church_readable(a.church_id)));
grant select on public.area_priests to authenticated;

commit;
