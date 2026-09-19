-- =====================================================================
-- 0049: CARD PRINT PROFILES (ملفات الطباعة) + service / class logos on cards
--
-- 1. `card_print_profiles` — a NAMED, reusable set of print settings
--    (paper · orientation · margins · gaps · alignment · cut marks ·
--    center lines). Until now the print settings lived only INSIDE each
--    template (`card_templates.print_settings`) or in the browser's
--    localStorage on the bound-print page — so the same «A4 · 2×5 ·
--    هوامش 10» had to be typed again for every template and on every
--    device. A profile is saved once and applied to ANY template (the
--    designer's print tab, the birthday card print tab) or to the bound
--    print page. Applying COPIES the settings into the template — the
--    template keeps working even if the profile is deleted later.
--
--    Scope: church → service → class, exactly like the templates. A
--    servant READS every profile whose scope overlaps his (the church-wide
--    one, his service's, his class's) and WRITES only at his own level or
--    below. `church_id NULL` = shared with everyone who can see the cards
--    module (only the owner can write such rows — `can_access(null, …)` is
--    false for every other role).
--
-- 2. `child_portal_birthday()` now returns `service_logo_url` and
--    `class_logo_url` in `constants`, so birthday cards that use the new
--    «شعار الخدمة» / «شعار الفصل» elements render in the child portal too.
--    (The staff screens read `services.photo_url` / `classes.photo_url`
--    directly — no schema change was needed for the logos themselves.)
--
-- Idempotent; run after 0048.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------
create table if not exists public.card_print_profiles (
  id          uuid primary key default gen_random_uuid(),
  church_id   uuid references public.churches(id) on delete cascade,
  service_id  uuid references public.services(id) on delete cascade,
  class_id    uuid references public.classes(id) on delete cascade,
  name        text not null,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.servant_enrollments(id) on delete set null,
  edited_at   timestamptz not null default now(),
  edited_by   uuid references public.servant_enrollments(id) on delete set null,
  constraint card_print_profiles_name_chk check (length(trim(name)) between 1 and 80),
  -- a class-level row must name its service; a service-level row its church
  constraint card_print_profiles_scope_chk check (
    (class_id is null or service_id is not null) and (service_id is null or church_id is not null)
  )
);

comment on table public.card_print_profiles is
  'ملفات الطباعة — named reusable print settings (paper / margins / gaps / alignment) for the card designer. church_id NULL = shared.';

create index if not exists idx_card_print_profiles_church on public.card_print_profiles(church_id);

drop trigger if exists trg_card_print_profiles_touch on public.card_print_profiles;
create trigger trg_card_print_profiles_touch before update on public.card_print_profiles
for each row execute function public.touch_edited();

-- ---------------------------------------------------------------------
-- 2. RLS — module `cards` + scope.
--    READ : shared rows (church_id null) + every profile whose scope
--           OVERLAPS mine (`scope_overlaps`, 0045) — a class servant can
--           USE the profile his service manager saved for the whole
--           service (and the church-wide one), which is the point of
--           saving a profile once.
--    WRITE: `can_access` — I can only create / edit / delete profiles at
--           my own level or below (shared rows → owner only).
-- ---------------------------------------------------------------------
alter table public.card_print_profiles enable row level security;

drop policy if exists card_print_profiles_select on public.card_print_profiles;
create policy card_print_profiles_select on public.card_print_profiles for select using (
  (select public.module_visible('cards'))
  and (church_id is null or (select public.scope_overlaps(church_id, service_id, class_id)))
);

drop policy if exists card_print_profiles_insert on public.card_print_profiles;
create policy card_print_profiles_insert on public.card_print_profiles for insert with check (
  (select public.module_visible('cards'))
  and (select public.can_access(church_id, service_id, class_id))
);

drop policy if exists card_print_profiles_update on public.card_print_profiles;
create policy card_print_profiles_update on public.card_print_profiles for update using (
  (select public.module_visible('cards'))
  and (select public.can_access(church_id, service_id, class_id))
) with check (
  (select public.module_visible('cards'))
  and (select public.can_access(church_id, service_id, class_id))
);

drop policy if exists card_print_profiles_delete on public.card_print_profiles;
create policy card_print_profiles_delete on public.card_print_profiles for delete using (
  (select public.module_visible('cards'))
  and (select public.can_access(church_id, service_id, class_id))
);

-- ---------------------------------------------------------------------
-- 3. Realtime (classic postgres_changes — low-volume table) + activity log
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'card_print_profiles') then
    alter publication supabase_realtime add table public.card_print_profiles;
  end if;
exception when undefined_object then null;
end $$;

do $$ begin
  if to_regprocedure('public.activity_audit_attach(text)') is not null then
    perform public.activity_audit_attach('card_print_profiles');
  end if;
end $$;

-- register the table in the audited list (0047) so a re-run of 0047 keeps it
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
    'backup_runs', 'backup_schedules'
  ]
$$;

-- ---------------------------------------------------------------------
-- 4. child_portal_birthday — add service / class logos to `constants`
--    (guarded: the function declares row types of the birthdays module 0028)
-- ---------------------------------------------------------------------
do $outer$ begin
  if to_regclass('public.birthday_card_templates') is null then return; end if;
  execute $fn$
create or replace function public.child_portal_birthday(p_national_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  p public.persons;
  today date := (now() at time zone 'Africa/Cairo')::date;
  e public.enrollments;
  tpl public.birthday_card_templates;
  ch public.churches;
  sv public.services;
  cl public.classes;
  granted boolean := false;
  nb date;
begin
  p := public.child_portal_person(p_national_id);
  if p.birthdate is null then return jsonb_build_object('is_birthday', false, 'birthdate', null); end if;
  nb := public.next_birthday(p.birthdate, today);

  select * into e from public.enrollments where person_id = p.id order by created_at, id limit 1;
  if e.id is not null then
    granted := public.module_granted_for('birthdays', e.church_id, e.service_id, e.class_id);
    select * into ch from public.churches where id = e.church_id;
    select * into sv from public.services where id = e.service_id;
    select * into cl from public.classes  where id = e.class_id;
    if granted then
      select * into tpl from public.birthday_card_templates t
       where t.church_id = e.church_id
         and (t.service_id is null or t.service_id = e.service_id)
         and (t.class_id is null or t.class_id = e.class_id)
       -- most specific scope wins (class > service > church), then the default flag, then newest
       order by (t.class_id is not null) desc, (t.service_id is not null) desc, t.is_default desc, t.created_at desc
       limit 1;
    end if;
  end if;

  return jsonb_build_object(
    'is_birthday', nb = today,
    'birthdate', p.birthdate,
    'age', extract(year from age(today, p.birthdate))::int,
    'turns_age', extract(year from nb)::int - extract(year from p.birthdate)::int,
    'next_birthday', nb,
    'days_left', (nb - today),
    'module_granted', granted,
    'card', case when tpl.id is null then null else jsonb_build_object(
              'id', tpl.id, 'name', tpl.name, 'design', tpl.design) end,
    'constants', jsonb_build_object(
      'church_name', coalesce(ch.name, ''), 'service_name', coalesce(sv.name, ''),
      'class_name', coalesce(cl.name, ''), 'church_logo_url', ch.logo_url,
      'service_logo_url', sv.photo_url, 'class_logo_url', cl.photo_url),
    'gift', (select jsonb_build_object('points', g.points, 'created_at', g.created_at)
               from public.birthday_greetings g
              where g.person_id = p.id and g.kind = 'gift' and g.year = extract(year from today)::int
              limit 1)
  );
end $$;
  $fn$;
  grant execute on function public.child_portal_birthday(text) to anon, authenticated;
end $outer$;
