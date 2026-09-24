-- =====================================================================
-- FAMILY MODULE (العائلات) — families + family_members
--
-- A FAMILY groups several persons (children and/or servants — everyone is
-- a `persons` row whose `national_id` is his code / QR). It lets a servant:
--   * build a family from the individual QR codes of its members
--     (العائلات → QR → إضافة أفراد: scan card after card)
--   * scan ONE member's code on the scanner and see EVERY code / person of
--     the family, pick the person the operation is meant for, and — when
--     that person is enrolled in 2+ services / classes — pick the service
--     too. The RPC also tells which service each member already attended
--     on the working day («تم التعرف على الخدمة»).
--   * every family also gets its OWN code (`families.code`, F-XXXXXX) so a
--     family card can be printed and scanned directly.
--
-- Tables
--   families        id · code (unique, auto) · name · phone · address · notes
--                   · created/edited audit
--   family_members  family_id → families · person_id → persons (UNIQUE — a
--                   person belongs to ONE family) · relation (أب · أم · ابن …)
--
-- Access (RLS + RPCs)
--   module_visible('family') gates everything.
--   family_can('family.view')   — every servant of a granted scope
--   family_can('family.manage') — owner / church manager / service manager,
--                                 or a class servant with the permission key
--   family_visible(id)          — owner · creator · or ≥ 1 member enrolled in
--                                 a scope the caller can access
--
-- RPCs
--   family_lookup(code, day)                 — scanner: person code OR family code →
--                                              family + members + their enrollments
--                                              (filtered by can_access) + attended_today
--   family_add_member_by_code(family, code, relation, move)
--   family_remove_member(member_id)
--   family_set_relation(member_id, relation)
--
-- Idempotent. Seeds ONE global module grant (like `cards`) so the module is
-- usable right away; the owner narrows it from وحدة المالك → صلاحيات الوحدات.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Permission helper
-- ---------------------------------------------------------------------
create or replace function public.family_can(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.module_visible('family')
     and (
       (select role from public.my_scope()) in ('owner', 'church_manager', 'service_manager')
       or p_key = 'family.view'
       or public.has_permission(p_key)
     )
$$;
grant execute on function public.family_can(text) to authenticated;

create or replace function public.family_permissions()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'view',   public.family_can('family.view'),
    'manage', public.family_can('family.manage')
  )
$$;
grant execute on function public.family_permissions() to authenticated;

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
-- A short, readable, unique family code: F-XXXXXX (no 0/O/1/I ambiguity)
create or replace function public.family_new_code()
returns text language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  i int;
begin
  loop
    v_code := 'F-';
    for i in 1..6 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.families f where f.code = v_code)
          and not exists (select 1 from public.persons p where p.national_id = v_code);
  end loop;
  return v_code;
end $$;

create table if not exists public.families (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  phone       text,
  address     text,
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.servant_enrollments(id) on delete set null,
  edited_at   timestamptz not null default now(),
  edited_by   uuid references public.servant_enrollments(id) on delete set null,
  constraint families_name_chk check (length(trim(name)) between 1 and 120)
);
comment on table public.families is
  'العائلات — a group of persons (children / servants). code = the family QR (F-XXXXXX).';

-- fill the code automatically when the client does not send one
create or replace function public.families_fill_code()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.code is null or length(trim(new.code)) = 0 then
    new.code := public.family_new_code();
  else
    new.code := trim(new.code);
  end if;
  new.name := trim(new.name);
  -- the creator always sees his family (even before the first member) —
  -- family_visible() relies on created_by
  if tg_op = 'INSERT' and new.created_by is null then
    new.created_by := auth.uid();
  end if;
  if tg_op = 'INSERT' and new.edited_by is null then
    new.edited_by := auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists trg_families_fill_code on public.families;
create trigger trg_families_fill_code before insert or update on public.families
for each row execute function public.families_fill_code();

drop trigger if exists trg_families_touch on public.families;
create trigger trg_families_touch before update on public.families
for each row execute function public.touch_edited();

create table if not exists public.family_members (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  person_id   uuid not null references public.persons(id) on delete cascade,
  relation    text,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.servant_enrollments(id) on delete set null,
  constraint family_members_person_uq unique (person_id),
  constraint family_members_relation_chk check (
    relation is null or relation in (
      'father', 'mother', 'son', 'daughter', 'brother', 'sister',
      'grandfather', 'grandmother', 'husband', 'wife', 'other'
    )
  )
);
comment on table public.family_members is
  'أفراد العائلة — person ↔ family (a person belongs to ONE family). relation = صلة القرابة.';

create index if not exists idx_family_members_family on public.family_members(family_id);
create index if not exists idx_families_created_by on public.families(created_by);

-- ---------------------------------------------------------------------
-- 2. Visibility helper + RLS
-- ---------------------------------------------------------------------
create or replace function public.family_visible(p_family uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner()
      or exists (select 1 from public.families f where f.id = p_family and f.created_by = auth.uid())
      or exists (
        select 1
          from public.family_members m
          join public.enrollments e on e.person_id = m.person_id
         where m.family_id = p_family
           and public.can_access(e.church_id, e.service_id, e.class_id)
      )
$$;
grant execute on function public.family_visible(uuid) to authenticated;

alter table public.families enable row level security;
alter table public.family_members enable row level security;

drop policy if exists families_select on public.families;
create policy families_select on public.families for select using (
  (select public.family_can('family.view'))
  -- `created_by` checked on the row itself: an INSERT … RETURNING evaluates
  -- the select policy before the row is written, so a sub-select can't see it
  and (created_by = auth.uid() or public.family_visible(id))
);
drop policy if exists families_insert on public.families;
create policy families_insert on public.families for insert with check (
  (select public.family_can('family.manage'))
);
drop policy if exists families_update on public.families;
create policy families_update on public.families for update using (
  (select public.family_can('family.manage')) and (created_by = auth.uid() or public.family_visible(id))
) with check (
  (select public.family_can('family.manage'))
);
drop policy if exists families_delete on public.families;
create policy families_delete on public.families for delete using (
  (select public.family_can('family.manage')) and (created_by = auth.uid() or public.family_visible(id))
);

drop policy if exists family_members_select on public.family_members;
create policy family_members_select on public.family_members for select using (
  (select public.family_can('family.view')) and public.family_visible(family_id)
);
drop policy if exists family_members_insert on public.family_members;
create policy family_members_insert on public.family_members for insert with check (
  (select public.family_can('family.manage')) and public.family_visible(family_id)
);
drop policy if exists family_members_update on public.family_members;
create policy family_members_update on public.family_members for update using (
  (select public.family_can('family.manage')) and public.family_visible(family_id)
);
drop policy if exists family_members_delete on public.family_members;
create policy family_members_delete on public.family_members for delete using (
  (select public.family_can('family.manage')) and public.family_visible(family_id)
);

-- ---------------------------------------------------------------------
-- 3. RPC — family_lookup(code, day)
--    Scanner entry point. `p_code` may be a PERSON code (national_id) or a
--    FAMILY code. Returns:
--    {
--      matched: 'person' | 'family' | null,
--      person:  {…} | null,             -- the scanned person (person code)
--      family:  {id, code, name, …} | null,
--      members: [ { member_id, relation, person: {…},
--                   enrollments: [ {id, church_id, service_id, class_id, kind,
--                                   status, points, attendance_count,
--                                   attended_today, today_event_ids} ] } ]
--    }
--    A person with no family is returned as the single member of a null
--    family (so the caller works with one shape). Enrollments are limited
--    to the caller's scopes (`can_access`) — members with none are still
--    listed (name + code) so the family is complete, but nothing can be
--    done on them here.
-- ---------------------------------------------------------------------
create or replace function public.family_lookup(p_code text, p_day date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_code   text := trim(coalesce(p_code, ''));
  v_day    date := coalesce(p_day, current_date);
  v_person public.persons%rowtype;
  v_family public.families%rowtype;
  v_found_person boolean := false;
  v_found_family boolean := false;
  v_members jsonb;
begin
  if not public.family_can('family.view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_code = '' then
    return jsonb_build_object('matched', null, 'person', null, 'family', null, 'members', '[]'::jsonb);
  end if;

  select * into v_person from public.persons p where p.national_id = v_code;
  v_found_person := found;
  if v_found_person then
    select f.* into v_family
      from public.family_members m join public.families f on f.id = m.family_id
     where m.person_id = v_person.id;
    v_found_family := found;
  else
    select * into v_family from public.families f where f.code = v_code;
    v_found_family := found;
  end if;

  if not v_found_person and not v_found_family then
    return jsonb_build_object('matched', null, 'person', null, 'family', null, 'members', '[]'::jsonb);
  end if;

  -- members = the family's members, or the lone scanned person
  with mem as (
    select m.id as member_id, m.relation, m.person_id, m.created_at
      from public.family_members m
     where v_found_family and m.family_id = v_family.id
    union all
    select null::uuid, null::text, v_person.id, now()
     where v_found_person and not v_found_family
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'member_id', mem.member_id,
           'relation',  mem.relation,
           'person',    to_jsonb(p),
           'enrollments', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', e.id, 'person_id', e.person_id,
                      'church_id', e.church_id, 'service_id', e.service_id, 'class_id', e.class_id,
                      'kind', e.kind, 'servant_id', e.servant_id, 'status', e.status,
                      'points', e.points, 'attendance_count', e.attendance_count, 'created_at', e.created_at,
                      'attended_today', exists (
                        select 1 from public.attendance_log a
                         where a.enrollment_id = e.id and a.attended_on = v_day),
                      'today_event_ids', coalesce((
                        select jsonb_agg(distinct a.event_id)
                          from public.attendance_log a
                         where a.enrollment_id = e.id and a.attended_on = v_day and a.event_id is not null), '[]'::jsonb),
                      'person', to_jsonb(p))
                    order by e.created_at)
               from public.enrollments e
              where e.person_id = p.id
                and public.can_access(e.church_id, e.service_id, e.class_id)
           ), '[]'::jsonb)
         ) order by mem.created_at, p.name), '[]'::jsonb)
    into v_members
    from mem join public.persons p on p.id = mem.person_id;

  return jsonb_build_object(
    'matched', case when v_found_person then 'person' else 'family' end,
    'person',  case when v_found_person then to_jsonb(v_person) else null end,
    'family',  case when v_found_family then to_jsonb(v_family) else null end,
    'members', v_members
  );
end $$;
revoke all on function public.family_lookup(text, date) from public, anon;
grant execute on function public.family_lookup(text, date) to authenticated;
comment on function public.family_lookup(text, date) is
  'الماسح: كود شخص أو كود عائلة → العائلة وكل أفرادها وتسجيلاتهم (في نطاق المستخدم) مع «حضر اليوم» لكل تسجيل';

-- ---------------------------------------------------------------------
-- 4. RPC — family_add_member_by_code(family, code, relation, move)
--    Adds the person whose code is `p_code` to the family. Errors:
--      family_not_found · no_access · person_not_found · already_member
--      in_other_family (DETAIL = the other family's name, HINT = its id)
--    `p_move = true` moves him from his current family instead of failing.
--    Returns { member_id, person, moved_from: {id, name} | null }.
-- ---------------------------------------------------------------------
create or replace function public.family_add_member_by_code(
  p_family   uuid,
  p_code     text,
  p_relation text default null,
  p_move     boolean default false
) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_code    text := trim(coalesce(p_code, ''));
  v_person  public.persons%rowtype;
  v_other   public.families%rowtype;
  v_member  public.family_members%rowtype;
  v_moved   jsonb := null;
begin
  if not public.family_can('family.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.families f where f.id = p_family) then
    raise exception 'family_not_found' using errcode = 'P0001';
  end if;
  if not public.family_visible(p_family) then
    raise exception 'no_access' using errcode = '42501';
  end if;
  if p_relation is not null and p_relation not in (
    'father', 'mother', 'son', 'daughter', 'brother', 'sister',
    'grandfather', 'grandmother', 'husband', 'wife', 'other') then
    raise exception 'invalid_relation' using errcode = '22023';
  end if;

  select * into v_person from public.persons p where p.national_id = v_code;
  if not found then
    raise exception 'person_not_found' using errcode = 'P0002';
  end if;

  select * into v_member from public.family_members m where m.person_id = v_person.id;
  if found then
    if v_member.family_id = p_family then
      raise exception 'already_member' using errcode = 'P0001';
    end if;
    select * into v_other from public.families f where f.id = v_member.family_id;
    if not p_move then
      raise exception 'in_other_family' using errcode = 'P0001',
        detail = coalesce(v_other.name, ''), hint = v_member.family_id::text;
    end if;
    delete from public.family_members where id = v_member.id;
    v_moved := jsonb_build_object('id', v_other.id, 'name', v_other.name);
  end if;

  insert into public.family_members (family_id, person_id, relation, created_by)
  values (p_family, v_person.id, p_relation, auth.uid())
  returning * into v_member;

  update public.families set edited_at = now(), edited_by = auth.uid() where id = p_family;

  return jsonb_build_object(
    'member_id', v_member.id,
    'relation',  v_member.relation,
    'person',    to_jsonb(v_person),
    'moved_from', v_moved
  );
end $$;
revoke all on function public.family_add_member_by_code(uuid, text, text, boolean) from public, anon;
grant execute on function public.family_add_member_by_code(uuid, text, text, boolean) to authenticated;
comment on function public.family_add_member_by_code(uuid, text, text, boolean) is
  'إضافة فرد إلى عائلة بكوده (QR) — in_other_family عندما يكون في عائلة أخرى (DETAIL = اسمها)، p_move = نقله';

-- ---------------------------------------------------------------------
-- 5. RPC — family_remove_member / family_set_relation
-- ---------------------------------------------------------------------
create or replace function public.family_remove_member(p_member uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_family uuid;
begin
  if not public.family_can('family.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select family_id into v_family from public.family_members where id = p_member;
  if not found then raise exception 'member_not_found' using errcode = 'P0002'; end if;
  if not public.family_visible(v_family) then raise exception 'no_access' using errcode = '42501'; end if;
  delete from public.family_members where id = p_member;
  update public.families set edited_at = now(), edited_by = auth.uid() where id = v_family;
end $$;
revoke all on function public.family_remove_member(uuid) from public, anon;
grant execute on function public.family_remove_member(uuid) to authenticated;

create or replace function public.family_set_relation(p_member uuid, p_relation text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_family uuid;
begin
  if not public.family_can('family.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select family_id into v_family from public.family_members where id = p_member;
  if not found then raise exception 'member_not_found' using errcode = 'P0002'; end if;
  if not public.family_visible(v_family) then raise exception 'no_access' using errcode = '42501'; end if;
  update public.family_members set relation = nullif(trim(coalesce(p_relation, '')), '') where id = p_member;
end $$;
revoke all on function public.family_set_relation(uuid, text) from public, anon;
grant execute on function public.family_set_relation(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Module grant seed · realtime · activity log
-- ---------------------------------------------------------------------
insert into public.module_access (module_key, church_id, service_id, class_id)
select 'family', null, null, null
where not exists (select 1 from public.module_access where module_key = 'family');

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'families') then
    alter publication supabase_realtime add table public.families;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'family_members') then
    alter publication supabase_realtime add table public.family_members;
  end if;
exception when undefined_object then null;
end $$;

do $$ begin
  if to_regprocedure('public.activity_audit_attach(text)') is not null then
    perform public.activity_audit_attach('families');
    perform public.activity_audit_attach('family_members');
  end if;
end $$;

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
    'backup_runs', 'backup_schedules', 'report_templates', 'families', 'family_members'
  ]
$$;

commit;
