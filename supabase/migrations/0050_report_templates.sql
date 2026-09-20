-- =====================================================================
-- 0050: REPORTS & TABLES MODULE (تقارير وجداول) — report templates
--
-- The module lets a servant pick a DATA SOURCE (المخدومون · الحضور ·
-- النقاط · نتائج الامتحانات · الخدام), narrow it (كنيسة → خدمة → فصل ·
-- فترة · مناسبة · …), choose EXACTLY the fields he wants (order · title ·
-- filter · sort), preview the rows, arrange a REPORT on pages (title ·
-- text · logo · table · chart · variables · header / footer / page
-- numbers) and export it as PDF / Excel or print it.
--
-- Everything the module reads already exists and is already protected by
-- RLS (enrollments / persons / attendance_log / points_log / exam_results
-- / servant_enrollments …) — the browser only ever gets the rows the
-- caller may see. The ONLY new table is `report_templates`: a saved
-- design (the whole report definition as JSONB) that can be re-run later
-- against a new church / service / class / period.
--
-- Scope: church → service → class (null = shared with everyone who can
-- see the module — owner-only to write). READ = every template whose
-- scope overlaps mine (`scope_overlaps`, 0045); WRITE = `can_access`
-- (my level or below). Same rules as `card_print_profiles` (0049).
--
-- Idempotent; run after 0049.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------
create table if not exists public.report_templates (
  id          uuid primary key default gen_random_uuid(),
  church_id   uuid references public.churches(id) on delete cascade,
  service_id  uuid references public.services(id) on delete cascade,
  class_id    uuid references public.classes(id) on delete cascade,
  name        text not null,
  description text,
  -- the data source key (app-code: 'enrollments' | 'attendance' | 'points' | 'exam_results' | 'servants' …)
  source      text not null,
  -- the whole report definition: { version, query: { filters, fields, sort }, design: { pages, header, footer, … } }
  definition  jsonb not null default '{}'::jsonb,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.servant_enrollments(id) on delete set null,
  edited_at   timestamptz not null default now(),
  edited_by   uuid references public.servant_enrollments(id) on delete set null,
  constraint report_templates_name_chk check (length(trim(name)) between 1 and 120),
  constraint report_templates_source_chk check (source ~ '^[a-z][a-z0-9_]{1,40}$'),
  -- a class-level row must name its service; a service-level row its church
  constraint report_templates_scope_chk check (
    (class_id is null or service_id is not null) and (service_id is null or church_id is not null)
  )
);

comment on table public.report_templates is
  'قوالب التقارير والجداول — saved report definitions (data query + page design) re-runnable against a new scope. church_id NULL = shared.';

create index if not exists idx_report_templates_church on public.report_templates(church_id);
create index if not exists idx_report_templates_source on public.report_templates(source);

drop trigger if exists trg_report_templates_touch on public.report_templates;
create trigger trg_report_templates_touch before update on public.report_templates
for each row execute function public.touch_edited();

-- ---------------------------------------------------------------------
-- 2. RLS — module `reports` + scope.
-- ---------------------------------------------------------------------
alter table public.report_templates enable row level security;

drop policy if exists report_templates_select on public.report_templates;
create policy report_templates_select on public.report_templates for select using (
  (select public.module_visible('reports'))
  and (church_id is null or (select public.scope_overlaps(church_id, service_id, class_id)))
);

drop policy if exists report_templates_insert on public.report_templates;
create policy report_templates_insert on public.report_templates for insert with check (
  (select public.module_visible('reports'))
  and (select public.can_access(church_id, service_id, class_id))
);

drop policy if exists report_templates_update on public.report_templates;
create policy report_templates_update on public.report_templates for update using (
  (select public.module_visible('reports'))
  and (select public.can_access(church_id, service_id, class_id))
) with check (
  (select public.module_visible('reports'))
  and (select public.can_access(church_id, service_id, class_id))
);

drop policy if exists report_templates_delete on public.report_templates;
create policy report_templates_delete on public.report_templates for delete using (
  (select public.module_visible('reports'))
  and (select public.can_access(church_id, service_id, class_id))
);

-- ---------------------------------------------------------------------
-- 3. Realtime (low-volume table) + activity log
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'report_templates') then
    alter publication supabase_realtime add table public.report_templates;
  end if;
exception when undefined_object then null;
end $$;

do $$ begin
  if to_regprocedure('public.activity_audit_attach(text)') is not null then
    perform public.activity_audit_attach('report_templates');
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
    'backup_runs', 'backup_schedules', 'report_templates'
  ]
$$;

-- ---------------------------------------------------------------------
-- 4. Aggregation helper for the report engine — attendance / points of a
--    set of enrollments INSIDE a period (the browser never downloads the
--    log rows for a whole scope; it asks for per-enrollment totals).
--    RLS on the log tables still applies (security invoker).
-- ---------------------------------------------------------------------
create or replace function public.report_enrollment_period_stats(
  p_enrollments uuid[],
  p_from date default null,
  p_to   date default null,
  p_event uuid default null
)
returns table (
  enrollment_id    uuid,
  attendance_count bigint,      -- attendance rows in the period (optionally one event)
  attendance_points bigint,     -- points that came with that attendance
  points_added     bigint,      -- positive cause deltas in the period
  points_removed   bigint,      -- abs(negative cause deltas) in the period
  first_attended   date,
  last_attended    date,
  calls_count      bigint,      -- follow-up calls in the period
  messages_count   bigint       -- whatsapp / sms / internal in the period
)
language sql stable security invoker set search_path = public as $$
  with ids as (select unnest(p_enrollments) as id),
  att as (
    select a.enrollment_id, count(*) c, coalesce(sum(a.points_delta), 0) p, min(a.attended_on) f, max(a.attended_on) l
      from public.attendance_log a join ids on ids.id = a.enrollment_id
     where (p_from is null or a.attended_on >= p_from)
       and (p_to   is null or a.attended_on <= p_to)
       and (p_event is null or a.event_id = p_event)
     group by a.enrollment_id
  ),
  pts as (
    select l.enrollment_id,
           coalesce(sum(case when l.delta > 0 then l.delta else 0 end), 0) added,
           coalesce(-sum(case when l.delta < 0 then l.delta else 0 end), 0) removed
      from public.points_log l join ids on ids.id = l.enrollment_id
     where (p_from is null or (l.created_at at time zone 'Africa/Cairo')::date >= p_from)
       and (p_to   is null or (l.created_at at time zone 'Africa/Cairo')::date <= p_to)
       and (p_event is null or l.event_id = p_event)
     group by l.enrollment_id
  ),
  con as (
    select c.enrollment_id,
           count(*) filter (where c.kind = 'call') calls,
           count(*) filter (where c.kind <> 'call') msgs
      from public.contact_log c join ids on ids.id = c.enrollment_id
     where (p_from is null or c.contacted_on >= p_from)
       and (p_to   is null or c.contacted_on <= p_to)
       and (p_event is null or c.event_id = p_event)
     group by c.enrollment_id
  )
  select ids.id,
         coalesce(att.c, 0), coalesce(att.p, 0),
         coalesce(pts.added, 0), coalesce(pts.removed, 0),
         att.f, att.l,
         coalesce(con.calls, 0), coalesce(con.msgs, 0)
    from ids
    left join att on att.enrollment_id = ids.id
    left join pts on pts.enrollment_id = ids.id
    left join con on con.enrollment_id = ids.id
$$;

grant execute on function public.report_enrollment_period_stats(uuid[], date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. No seed — like the other modules the OWNER grants the module from
--    وحدة المالك → صلاحيات الوحدات (owner always sees it).
-- ---------------------------------------------------------------------
