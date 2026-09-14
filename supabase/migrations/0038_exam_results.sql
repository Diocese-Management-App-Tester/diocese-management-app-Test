-- =====================================================================
-- 0038: EXAM RESULTS MODULE — نتائج الامتحانات
--
-- Servants create EXAMS (paper / oral exams — not the online MCQ exams of
-- migration 0027), define SUBJECTS with full / pass degrees, pick a
-- configurable GRADING SYSTEM, then enter every student's score per subject
-- (one by one, in bulk, or from Excel). Percentages, grades, totals, pass /
-- fail and rank are ALWAYS computed by the database — never typed.
--
--   grading_systems  — name · church (null = every church, owner-made)
--   grading_grades   — Grade 1..N: name · min % · max % · color · description
--   result_exams     — name · date · scope church → service? → class? ·
--                      academic year · status draft | open | completed |
--                      archived · grading system · grade_overall /
--                      grade_subject flags · pass rule · absent_as_zero ·
--                      min_required_subjects · locked (+ by / at) ·
--                      published_at (child portal) · audit
--   result_subjects  — per exam: name · code · full · pass · weight ·
--                      is_bonus (adds to the total, not to the full) · order
--   exam_results     — ONE row per (exam, subject, enrollment): score ·
--                      status draft | completed | absent | excused · note ·
--                      COMPUTED percent · grade_id · passed · audit
--
-- Computation lives in ONE place:
--   trg exam_results  → validates (score ≤ full, not locked, enrollment in
--                       scope) and fills percent / grade / passed.
--   result_summary_core(exam, enrollment?) → per-student totals: total /
--                       full / percent (weighted when every subject has a
--                       weight) / overall grade / pass-fail / status
--                       not_entered | incomplete | draft | absent | passed |
--                       failed. result_exam_summary adds competition
--                       ranking (1 2 2 4) by percent and by total score.
--   Changing a subject's degrees or the exam's grading re-computes rows.
--
-- Permissions (existing RBAC — module grant + role + permission keys of
-- migration 0037). result_can(key):
--   module_visible('results') AND (role in owner / church_manager /
--   service_manager  OR  key in (results.view, results.stats)  OR
--   has_permission(key))  — i.e. managers can do everything in their scope,
--   class servants view & see statistics by default and need a permission
--   profile for enter / edit / import / export / manage_* / lock.
--   Locked exam → only results.lock holders may write results / subjects.
--
-- Idempotent — safe to re-run. Depends on 0019 (my_scope / scope_* /
-- enrollment_visible), 0021 (child portal), 0024 (module_visible),
-- 0037 (has_permission). NO module grant is seeded — the owner enables it
-- per scope in وحدة المالك → صلاحيات الوحدات.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. PERMISSION HELPER
-- ---------------------------------------------------------------------
create or replace function public.result_can(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.module_visible('results')
     and (
       (select role from public.my_scope()) in ('owner', 'church_manager', 'service_manager')
       or p_key in ('results.view', 'results.stats')
       or public.has_permission(p_key)
     )
$$;
grant execute on function public.result_can(text) to authenticated;

create or replace function public.result_permissions()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'view',           public.result_can('results.view'),
    'enter',          public.result_can('results.enter'),
    'edit',           public.result_can('results.edit'),
    'import',         public.result_can('results.import'),
    'export',         public.result_can('results.export'),
    'manage_exams',   public.result_can('results.manage_exams'),
    'manage_subjects',public.result_can('results.manage_subjects'),
    'manage_grading', public.result_can('results.manage_grading'),
    'lock',           public.result_can('results.lock'),
    'stats',          public.result_can('results.stats')
  )
$$;
grant execute on function public.result_permissions() to authenticated;

-- ---------------------------------------------------------------------
-- 1. GRADING SYSTEMS + GRADES
-- ---------------------------------------------------------------------
create table if not exists public.grading_systems (
  id           uuid primary key default gen_random_uuid(),
  church_id    uuid references public.churches(id) on delete cascade,   -- null = every church (owner)
  name         text not null,
  description  text,
  is_default   boolean not null default false,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.servant_enrollments(id) on delete set null,
  edited_at    timestamptz not null default now(),
  edited_by    uuid references public.servant_enrollments(id) on delete set null,
  constraint grading_systems_name_not_blank check (length(trim(name)) > 0)
);
comment on table public.grading_systems is 'أنظمة التقدير — نظام قابل للتخصيص من درجات ونسب (Grade 1..N)';
create index if not exists idx_grading_systems_church on public.grading_systems(church_id);

create table if not exists public.grading_grades (
  id                 uuid primary key default gen_random_uuid(),
  grading_system_id  uuid not null references public.grading_systems(id) on delete cascade,
  name               text not null,
  min_percent        numeric(6,2) not null check (min_percent >= 0 and min_percent <= 100),
  max_percent        numeric(6,2) not null check (max_percent >= 0 and max_percent <= 100),
  description        text,
  color              text,                                  -- hex
  is_pass            boolean not null default true,         -- informational
  sort_order         integer not null default 0,
  constraint grading_grades_range check (min_percent <= max_percent),
  constraint grading_grades_name_not_blank check (length(trim(name)) > 0)
);
comment on table public.grading_grades is 'درجات التقدير — الاسم · من ٪ · إلى ٪ · لون · وصف';
create index if not exists idx_grading_grades_system on public.grading_grades(grading_system_id, min_percent desc);

drop trigger if exists trg_grading_systems_touch on public.grading_systems;
create trigger trg_grading_systems_touch before update on public.grading_systems
for each row execute function public.touch_edited();

create or replace function public.grading_system_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.name := trim(new.name);
  new.created_by := coalesce(new.created_by, auth.uid());
  new.edited_by  := coalesce(new.edited_by, auth.uid());
  return new;
end $$;
drop trigger if exists trg_grading_system_insert on public.grading_systems;
create trigger trg_grading_system_insert before insert on public.grading_systems
for each row execute function public.grading_system_before_insert();

-- The grade a percentage falls into (highest matching band). null = none.
create or replace function public.grade_for_percent(p_system uuid, p_pct numeric)
returns uuid language sql stable security definer set search_path = public as $$
  select g.id
    from public.grading_grades g
   where p_system is not null and p_pct is not null
     and g.grading_system_id = p_system
     and round(p_pct, 2) >= g.min_percent and round(p_pct, 2) <= g.max_percent
   order by g.min_percent desc, g.sort_order
   limit 1
$$;
grant execute on function public.grade_for_percent(uuid, numeric) to authenticated, anon;

-- ---------------------------------------------------------------------
-- 2. EXAMS
-- ---------------------------------------------------------------------
create table if not exists public.result_exams (
  id                     uuid primary key default gen_random_uuid(),
  church_id              uuid not null references public.churches(id) on delete cascade,
  service_id             uuid references public.services(id) on delete cascade,   -- null = all services
  class_id               uuid references public.classes(id)  on delete cascade,   -- null = all classes
  name                   text not null,
  exam_date              date,
  academic_year          text,
  description            text,
  status                 text not null default 'draft' check (status in ('draft', 'open', 'completed', 'archived')),
  grading_system_id      uuid references public.grading_systems(id) on delete set null,
  grade_overall          boolean not null default true,    -- option A: grade from the total percentage
  grade_subject          boolean not null default true,    -- option B: a grade per subject
  pass_rule              text not null default 'overall' check (pass_rule in ('overall', 'subjects', 'both')),
  pass_percent           numeric(6,2) not null default 50 check (pass_percent >= 0 and pass_percent <= 100),
  absent_as_zero         boolean not null default false,
  min_required_subjects  integer check (min_required_subjects is null or min_required_subjects >= 1),
  locked                 boolean not null default false,
  locked_at              timestamptz,
  locked_by              uuid references public.servant_enrollments(id) on delete set null,
  published_at           timestamptz,                       -- null = hidden from the child portal
  created_at             timestamptz not null default now(),
  created_by             uuid references public.servant_enrollments(id) on delete set null,
  edited_at              timestamptz not null default now(),
  edited_by              uuid references public.servant_enrollments(id) on delete set null,
  constraint result_exams_name_not_blank check (length(trim(name)) > 0),
  constraint result_exams_scope_chain    check (not (class_id is not null and service_id is null))
);
comment on table public.result_exams is 'امتحانات النتائج — اسم · تاريخ · نطاق · عام دراسي · حالة · نظام تقدير · قواعد النجاح · قفل';
create index if not exists idx_result_exams_church  on public.result_exams(church_id, exam_date desc);
create index if not exists idx_result_exams_service on public.result_exams(service_id);
create index if not exists idx_result_exams_class   on public.result_exams(class_id);
create index if not exists idx_result_exams_status  on public.result_exams(status);

drop trigger if exists trg_result_exams_touch on public.result_exams;
create trigger trg_result_exams_touch before update on public.result_exams
for each row execute function public.touch_edited();

create or replace function public.result_exam_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.name := trim(new.name);
  if new.service_id is not null and not exists (
    select 1 from public.services s where s.id = new.service_id and s.church_id = new.church_id) then
    raise exception 'service_not_in_church' using errcode = 'P0001';
  end if;
  if new.class_id is not null and not exists (
    select 1 from public.classes c where c.id = new.class_id and c.service_id = new.service_id and c.church_id = new.church_id) then
    raise exception 'class_not_in_service' using errcode = 'P0001';
  end if;
  if new.grading_system_id is not null and not exists (
    select 1 from public.grading_systems g where g.id = new.grading_system_id and (g.church_id is null or g.church_id = new.church_id)) then
    raise exception 'grading_system_out_of_scope' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.edited_by  := coalesce(new.edited_by, auth.uid());
  else
    -- lock / unlock only through result_exam_set_lock (needs results.lock)
    if new.locked <> old.locked and coalesce(current_setting('results.lock_rpc', true), '') <> '1' then
      raise exception 'use_lock_rpc' using errcode = 'P0001';
    end if;
    if old.locked and new.locked and coalesce(current_setting('results.lock_rpc', true), '') <> '1'
       and not public.result_can('results.lock')
       and (new.grading_system_id is distinct from old.grading_system_id
            or new.grade_overall <> old.grade_overall or new.grade_subject <> old.grade_subject
            or new.pass_rule <> old.pass_rule or new.pass_percent <> old.pass_percent
            or new.absent_as_zero <> old.absent_as_zero
            or new.min_required_subjects is distinct from old.min_required_subjects) then
      raise exception 'results_locked' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_result_exam_write on public.result_exams;
create trigger trg_result_exam_write before insert or update on public.result_exams
for each row execute function public.result_exam_before_write();

-- ---------------------------------------------------------------------
-- 3. SUBJECTS
-- ---------------------------------------------------------------------
create table if not exists public.result_subjects (
  id           uuid primary key default gen_random_uuid(),
  exam_id      uuid not null references public.result_exams(id) on delete cascade,
  name         text not null,
  code         text,
  full_degree  numeric(8,2) not null check (full_degree > 0),
  pass_degree  numeric(8,2) not null default 0 check (pass_degree >= 0),
  weight       numeric(8,2) check (weight is null or weight >= 0),     -- null = plain sum
  is_bonus     boolean not null default false,                         -- extra credit: adds to the total, not to the full
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  edited_at    timestamptz not null default now(),
  constraint result_subjects_name_not_blank check (length(trim(name)) > 0),
  constraint result_subjects_pass_le_full check (pass_degree <= full_degree)
);
comment on table public.result_subjects is 'مواد الامتحان — الاسم · الكود · الدرجة الكاملة · درجة النجاح · الوزن · إضافي · الترتيب';
create index if not exists idx_result_subjects_exam on public.result_subjects(exam_id, sort_order);

create or replace function public.result_subject_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare x public.result_exams;
begin
  select * into x from public.result_exams where id = new.exam_id;
  if x.id is null then raise exception 'exam_not_found' using errcode = 'P0001'; end if;
  if x.locked and not public.result_can('results.lock') then
    raise exception 'results_locked' using errcode = 'P0001';
  end if;
  new.name := trim(new.name);
  new.code := nullif(trim(coalesce(new.code, '')), '');
  new.edited_at := now();
  return new;
end $$;
drop trigger if exists trg_result_subject_write on public.result_subjects;
create trigger trg_result_subject_write before insert or update on public.result_subjects
for each row execute function public.result_subject_before_write();

create or replace function public.result_subject_before_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select locked from public.result_exams where id = old.exam_id) and not public.result_can('results.lock') then
    raise exception 'results_locked' using errcode = 'P0001';
  end if;
  return old;
end $$;
drop trigger if exists trg_result_subject_delete on public.result_subjects;
create trigger trg_result_subject_delete before delete on public.result_subjects
for each row execute function public.result_subject_before_delete();

-- ---------------------------------------------------------------------
-- 4. RESULTS (one row per exam × subject × enrollment)
-- ---------------------------------------------------------------------
create table if not exists public.exam_results (
  id             uuid primary key default gen_random_uuid(),
  exam_id        uuid not null references public.result_exams(id)    on delete cascade,
  subject_id     uuid not null references public.result_subjects(id) on delete cascade,
  enrollment_id  uuid not null references public.enrollments(id)     on delete cascade,
  person_id      uuid not null references public.persons(id)         on delete cascade,
  -- denormalized scope of the enrollment (cheap RLS + realtime filters)
  church_id      uuid not null references public.churches(id) on delete cascade,
  service_id     uuid not null references public.services(id) on delete cascade,
  class_id       uuid not null references public.classes(id)  on delete cascade,
  score          numeric(8,2),                                  -- null when absent / excused
  status         text not null default 'completed' check (status in ('draft', 'completed', 'absent', 'excused')),
  note           text,
  -- COMPUTED by the trigger — never written by the app
  percent        numeric(6,2),
  grade_id       uuid references public.grading_grades(id) on delete set null,
  passed         boolean,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.servant_enrollments(id) on delete set null,
  edited_at      timestamptz not null default now(),
  edited_by      uuid references public.servant_enrollments(id) on delete set null,
  constraint exam_results_unique unique (exam_id, subject_id, enrollment_id)
);
comment on table public.exam_results is 'نتائج الامتحانات — لكل (امتحان · مادة · تسجيل): الدرجة · الحالة · النسبة والتقدير والنجاح محسوبة تلقائياً';
create index if not exists idx_exam_results_exam       on public.exam_results(exam_id, enrollment_id);
create index if not exists idx_exam_results_subject    on public.exam_results(subject_id);
create index if not exists idx_exam_results_enrollment on public.exam_results(enrollment_id);
create index if not exists idx_exam_results_person     on public.exam_results(person_id);
create index if not exists idx_exam_results_church     on public.exam_results(church_id);
create index if not exists idx_exam_results_service    on public.exam_results(service_id);
create index if not exists idx_exam_results_class      on public.exam_results(class_id);

create or replace function public.exam_result_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  x public.result_exams;
  s public.result_subjects;
  e public.enrollments;
  recalc boolean := coalesce(current_setting('results.recalc', true), '') = '1';
begin
  select * into x from public.result_exams where id = new.exam_id;
  if x.id is null then raise exception 'exam_not_found' using errcode = 'P0001'; end if;
  select * into s from public.result_subjects where id = new.subject_id and exam_id = new.exam_id;
  if s.id is null then raise exception 'subject_not_in_exam' using errcode = 'P0001'; end if;
  select * into e from public.enrollments where id = new.enrollment_id;
  if e.id is null then raise exception 'enrollment_not_found' using errcode = 'P0001'; end if;
  if not (e.church_id = x.church_id
          and (x.service_id is null or e.service_id = x.service_id)
          and (x.class_id   is null or e.class_id   = x.class_id)) then
    raise exception 'enrollment_out_of_scope' using errcode = 'P0001';
  end if;
  if not recalc then
    if x.locked and not public.result_can('results.lock') then
      raise exception 'results_locked' using errcode = 'P0001';
    end if;
    if x.status = 'archived' then
      raise exception 'exam_archived' using errcode = 'P0001';
    end if;
  end if;

  new.person_id  := e.person_id;
  new.church_id  := e.church_id;
  new.service_id := e.service_id;
  new.class_id   := e.class_id;
  new.note       := nullif(trim(coalesce(new.note, '')), '');

  if new.status in ('absent', 'excused') then
    new.score := null;
    if x.absent_as_zero then
      new.percent := 0; new.passed := (s.pass_degree <= 0);
    else
      new.percent := null; new.passed := null;
    end if;
  else
    if new.score is null then raise exception 'score_required' using errcode = 'P0001'; end if;
    if new.score < 0 then raise exception 'score_negative' using errcode = 'P0001'; end if;
    if new.score > s.full_degree then raise exception 'score_over_full' using errcode = 'P0001'; end if;
    new.percent := round(new.score / s.full_degree * 100, 2);
    new.passed  := new.score >= s.pass_degree;
  end if;
  new.grade_id := case when x.grade_subject and new.percent is not null
                       then public.grade_for_percent(x.grading_system_id, new.percent) end;

  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce(new.created_by, auth.uid());
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  if not recalc then
    new.edited_at := now();
    new.edited_by := coalesce(auth.uid(), new.edited_by);
  else
    new.edited_at := old.edited_at; new.edited_by := old.edited_by;
  end if;
  return new;
end $$;
drop trigger if exists trg_exam_result_write on public.exam_results;
create trigger trg_exam_result_write before insert or update on public.exam_results
for each row execute function public.exam_result_before_write();

create or replace function public.exam_result_before_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare x public.result_exams;
begin
  select * into x from public.result_exams where id = old.exam_id;
  if x.locked and not public.result_can('results.lock') then
    raise exception 'results_locked' using errcode = 'P0001';
  end if;
  return old;
end $$;
drop trigger if exists trg_exam_result_delete on public.exam_results;
create trigger trg_exam_result_delete before delete on public.exam_results
for each row execute function public.exam_result_before_delete();

-- Re-compute every stored row of an exam (grading / degrees changed)
create or replace function public.result_recalc(p_exam uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform set_config('results.recalc', '1', true);
  update public.exam_results set score = score where exam_id = p_exam;
  get diagnostics n = row_count;
  perform set_config('results.recalc', '', true);
  return n;
end $$;
revoke all on function public.result_recalc(uuid) from public, anon, authenticated;

create or replace function public.result_subject_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.full_degree <> old.full_degree or new.pass_degree <> old.pass_degree then
    perform set_config('results.recalc', '1', true);
    update public.exam_results set score = least(score, new.full_degree) where subject_id = new.id;
    perform set_config('results.recalc', '', true);
  end if;
  return null;
end $$;
drop trigger if exists trg_result_subject_recalc on public.result_subjects;
create trigger trg_result_subject_recalc after update on public.result_subjects
for each row execute function public.result_subject_after_change();

create or replace function public.result_exam_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.grading_system_id is distinct from old.grading_system_id
     or new.grade_subject <> old.grade_subject or new.absent_as_zero <> old.absent_as_zero then
    perform public.result_recalc(new.id);
  end if;
  return null;
end $$;
drop trigger if exists trg_result_exam_recalc on public.result_exams;
create trigger trg_result_exam_recalc after update on public.result_exams
for each row execute function public.result_exam_after_change();

-- grades edited → recompute exams using that system
create or replace function public.grading_grade_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare sid uuid := coalesce(new.grading_system_id, old.grading_system_id); x uuid;
begin
  for x in select id from public.result_exams where grading_system_id = sid loop
    perform public.result_recalc(x);
  end loop;
  return null;
end $$;
drop trigger if exists trg_grading_grade_recalc on public.grading_grades;
create trigger trg_grading_grade_recalc after insert or update or delete on public.grading_grades
for each row execute function public.grading_grade_after_change();

-- ---------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------
alter table public.grading_systems enable row level security;
alter table public.grading_grades  enable row level security;
alter table public.result_exams    enable row level security;
alter table public.result_subjects enable row level security;
alter table public.exam_results    enable row level security;

-- grading systems: read = module + (global or my church); write = manage_grading
drop policy if exists grading_systems_select on public.grading_systems;
create policy grading_systems_select on public.grading_systems for select using (
  (select public.result_can('results.view'))
  and (church_id is null or (select public.scope_overlaps(church_id, null, null)))
);
drop policy if exists grading_systems_write on public.grading_systems;
create policy grading_systems_write on public.grading_systems for all using (
  (select public.result_can('results.manage_grading'))
  and (case when church_id is null then (select public.is_owner()) else (select public.scope_contains(church_id, null, null)) end)
) with check (
  (select public.result_can('results.manage_grading'))
  and (case when church_id is null then (select public.is_owner()) else (select public.scope_contains(church_id, null, null)) end)
);

drop policy if exists grading_grades_select on public.grading_grades;
create policy grading_grades_select on public.grading_grades for select using (
  exists (select 1 from public.grading_systems g where g.id = grading_system_id)
);
drop policy if exists grading_grades_write on public.grading_grades;
create policy grading_grades_write on public.grading_grades for all using (
  (select public.result_can('results.manage_grading'))
  and exists (select 1 from public.grading_systems g where g.id = grading_system_id
              and (case when g.church_id is null then (select public.is_owner()) else (select public.scope_contains(g.church_id, null, null)) end))
) with check (
  (select public.result_can('results.manage_grading'))
  and exists (select 1 from public.grading_systems g where g.id = grading_system_id
              and (case when g.church_id is null then (select public.is_owner()) else (select public.scope_contains(g.church_id, null, null)) end))
);

-- exams
drop policy if exists result_exams_select on public.result_exams;
create policy result_exams_select on public.result_exams for select using (
  (select public.result_can('results.view'))
  and (select public.scope_overlaps(church_id, service_id, class_id))
);
drop policy if exists result_exams_insert on public.result_exams;
create policy result_exams_insert on public.result_exams for insert with check (
  (select public.result_can('results.manage_exams'))
  and (select public.scope_contains(church_id, service_id, class_id))
);
drop policy if exists result_exams_update on public.result_exams;
create policy result_exams_update on public.result_exams for update using (
  (select public.result_can('results.manage_exams'))
  and (select public.scope_contains(church_id, service_id, class_id))
) with check (
  (select public.result_can('results.manage_exams'))
  and (select public.scope_contains(church_id, service_id, class_id))
);
drop policy if exists result_exams_delete on public.result_exams;
create policy result_exams_delete on public.result_exams for delete using (
  (select public.result_can('results.manage_exams'))
  and (select public.scope_contains(church_id, service_id, class_id))
  and not locked
);

-- subjects: visible with the exam; write = manage_subjects on an exam I contain
drop policy if exists result_subjects_select on public.result_subjects;
create policy result_subjects_select on public.result_subjects for select using (
  exists (select 1 from public.result_exams x where x.id = exam_id)
);
drop policy if exists result_subjects_write on public.result_subjects;
create policy result_subjects_write on public.result_subjects for all using (
  (select public.result_can('results.manage_subjects'))
  and exists (select 1 from public.result_exams x where x.id = exam_id
              and (select public.scope_contains(x.church_id, x.service_id, x.class_id)))
) with check (
  (select public.result_can('results.manage_subjects'))
  and exists (select 1 from public.result_exams x where x.id = exam_id
              and (select public.scope_contains(x.church_id, x.service_id, x.class_id)))
);

-- results: rows of enrollments I can see; enter = insert; edit = update /
-- delete (a plain "enter" holder may still update his DRAFT rows)
drop policy if exists exam_results_select on public.exam_results;
create policy exam_results_select on public.exam_results for select using (
  (select public.result_can('results.view'))
  and public.enrollment_visible(church_id, service_id, class_id,
    (select role from public.my_scope()), (select church_id from public.my_scope()),
    (select service_id from public.my_scope()), (select class_id from public.my_scope()))
);
drop policy if exists exam_results_insert on public.exam_results;
create policy exam_results_insert on public.exam_results for insert with check (
  (select public.result_can('results.enter'))
  and exists (select 1 from public.enrollments e where e.id = enrollment_id)   -- RLS of enrollments = my scope
);
drop policy if exists exam_results_update on public.exam_results;
create policy exam_results_update on public.exam_results for update using (
  ((select public.result_can('results.edit')) or ((select public.result_can('results.enter')) and status = 'draft'))
  and exists (select 1 from public.enrollments e where e.id = enrollment_id)
) with check (
  ((select public.result_can('results.edit')) or (select public.result_can('results.enter')))
  and exists (select 1 from public.enrollments e where e.id = enrollment_id)
);
drop policy if exists exam_results_delete on public.exam_results;
create policy exam_results_delete on public.exam_results for delete using (
  (select public.result_can('results.edit'))
  and exists (select 1 from public.enrollments e where e.id = enrollment_id)
);

-- ---------------------------------------------------------------------
-- 6. SUMMARY — per-student computed totals (the single source of truth)
-- ---------------------------------------------------------------------
create or replace function public.result_summary_core(p_exam uuid, p_enrollment uuid default null)
returns table (
  enrollment_id uuid, person_id uuid, church_id uuid, service_id uuid, class_id uuid,
  subjects_total integer, subjects_entered integer, subjects_absent integer, subjects_draft integer,
  total_score numeric, total_full numeric, percent numeric,
  grade_id uuid, passed boolean, status text
) language sql stable security definer set search_path = public as $$
  with x as (select * from public.result_exams where id = p_exam),
  subj as (select s.* from public.result_subjects s where s.exam_id = p_exam),
  tot as (
    select count(*) filter (where not is_bonus)::integer                         as n_subj,
           coalesce(sum(full_degree) filter (where not is_bonus), 0)             as full_sum,
           coalesce(bool_and(weight is not null) filter (where not is_bonus), false)
             and coalesce(sum(weight) filter (where not is_bonus), 0) > 0        as weighted
      from subj
  ),
  enr as (
    select e.id, e.person_id, e.church_id, e.service_id, e.class_id
      from public.enrollments e, x
     where e.church_id = x.church_id
       and (x.service_id is null or e.service_id = x.service_id)
       and (x.class_id   is null or e.class_id   = x.class_id)
       and (p_enrollment is null or e.id = p_enrollment)
  ),
  r as (
    select r.*, s.full_degree, s.weight, s.is_bonus,
           case when r.percent is null then null else coalesce(r.score, 0) end as eff_score
      from public.exam_results r join subj s on s.id = r.subject_id
     where r.exam_id = p_exam and (p_enrollment is null or r.enrollment_id = p_enrollment)
  ),
  agg as (
    select enr.id as enrollment_id, enr.person_id, enr.church_id, enr.service_id, enr.class_id,
           count(r.id) filter (where not r.is_bonus)::integer                                        as entered,
           count(r.id) filter (where r.status = 'draft')::integer                                    as n_draft,
           count(r.id) filter (where r.status in ('absent', 'excused') and not r.is_bonus)::integer  as n_absent,
           sum(r.eff_score)   filter (where not r.is_bonus)                                          as score_sum,
           sum(r.full_degree) filter (where r.eff_score is not null and not r.is_bonus)              as full_taken,
           coalesce(sum(r.eff_score) filter (where r.is_bonus), 0)                                   as bonus_sum,
           sum(r.percent * r.weight) filter (where r.eff_score is not null and not r.is_bonus)       as wpct_sum,
           sum(r.weight)            filter (where r.eff_score is not null and not r.is_bonus)        as w_taken,
           coalesce(sum(r.percent * coalesce(r.weight, 0) / 100) filter (where r.eff_score is not null and r.is_bonus), 0) as bonus_wpct,
           coalesce(bool_and(r.passed) filter (where r.eff_score is not null and not r.is_bonus), false) as all_passed
      from enr left join r on r.enrollment_id = enr.id
     group by 1, 2, 3, 4, 5
  ),
  calc as (
    select a.*, t.n_subj, t.full_sum,
           case
             when t.weighted and coalesce(a.w_taken, 0) > 0
               then least(100, round(a.wpct_sum / a.w_taken + a.bonus_wpct, 2))
             when coalesce(a.full_taken, 0) > 0
               then least(100, round((a.score_sum + a.bonus_sum) / a.full_taken * 100, 2))
             else null
           end as pct,
           coalesce(x.min_required_subjects, t.n_subj) as required
      from agg a cross join tot t cross join x
  )
  select c.enrollment_id, c.person_id, c.church_id, c.service_id, c.class_id,
         c.n_subj, c.entered, c.n_absent, c.n_draft,
         case when c.entered > 0 then coalesce(c.score_sum, 0) + c.bonus_sum end as total_score,
         c.full_sum as total_full,
         c.pct as percent,
         case when x.grade_overall then public.grade_for_percent(x.grading_system_id, c.pct) end as grade_id,
         case when c.entered = 0 or c.entered < least(c.required, c.n_subj) or c.n_draft > 0 then null
              when c.n_absent >= c.n_subj and c.n_subj > 0 and c.pct is null then false
              else (case x.pass_rule
                      when 'overall'  then c.pct is not null and c.pct >= x.pass_percent
                      when 'subjects' then c.all_passed and c.pct is not null
                      else c.pct is not null and c.pct >= x.pass_percent and c.all_passed
                    end)
         end as passed,
         case
           when c.n_subj = 0 or c.entered = 0                       then 'not_entered'
           when c.n_absent >= c.n_subj                              then 'absent'
           when c.entered < least(c.required, c.n_subj)             then 'incomplete'
           when c.n_draft > 0                                       then 'draft'
           when (case x.pass_rule
                   when 'overall'  then c.pct is not null and c.pct >= x.pass_percent
                   when 'subjects' then c.all_passed and c.pct is not null
                   else c.pct is not null and c.pct >= x.pass_percent and c.all_passed
                 end)                                               then 'passed'
           else 'failed'
         end as status
    from calc c cross join x
$$;
revoke all on function public.result_summary_core(uuid, uuid) from public, anon, authenticated;

-- Servant view: every student of the exam scope I can see, with rank.
create or replace function public.result_exam_summary(p_exam uuid)
returns table (
  enrollment_id uuid, person_id uuid, church_id uuid, service_id uuid, class_id uuid,
  name text, national_id text, image_url text,
  subjects_total integer, subjects_entered integer, subjects_absent integer, subjects_draft integer,
  total_score numeric, total_full numeric, percent numeric,
  grade_id uuid, grade_name text, grade_color text, passed boolean, status text,
  rank integer,          -- competition ranking by PERCENT (1 2 2 4) — final results only
  rank_score integer     -- competition ranking by TOTAL SCORE
) language sql stable security definer set search_path = public as $$
  select c.enrollment_id, c.person_id, c.church_id, c.service_id, c.class_id,
         p.name, p.national_id, p.image_url,
         c.subjects_total, c.subjects_entered, c.subjects_absent, c.subjects_draft,
         c.total_score, c.total_full, c.percent,
         c.grade_id, g.name, g.color, c.passed, c.status,
         case when c.status in ('passed', 'failed') then
           (rank() over (order by case when c.status in ('passed', 'failed') then c.percent end desc nulls last))::integer
         end as rank,
         case when c.status in ('passed', 'failed') then
           (rank() over (order by case when c.status in ('passed', 'failed') then c.total_score end desc nulls last))::integer
         end as rank_score
    from public.result_summary_core(p_exam) c
    join public.persons p on p.id = c.person_id
    left join public.grading_grades g on g.id = c.grade_id
   where public.result_can('results.view')
     and exists (select 1 from public.result_exams x where x.id = p_exam
                 and public.scope_overlaps(x.church_id, x.service_id, x.class_id))
     and public.enrollment_visible(c.church_id, c.service_id, c.class_id,
           (select role from public.my_scope()), (select church_id from public.my_scope()),
           (select service_id from public.my_scope()), (select class_id from public.my_scope()))
   order by p.name
$$;
grant execute on function public.result_exam_summary(uuid) to authenticated;

-- Exam history of one person (all his enrollments), newest first.
create or replace function public.result_student_history(p_person uuid)
returns table (
  exam_id uuid, exam_name text, exam_date date, academic_year text, exam_status text, locked boolean, published_at timestamptz,
  enrollment_id uuid, class_id uuid, class_name text, service_name text, church_name text,
  subjects_total integer, subjects_entered integer,
  total_score numeric, total_full numeric, percent numeric,
  grade_id uuid, grade_name text, grade_color text, passed boolean, status text
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare e record;
begin
  if not public.result_can('results.view') then return; end if;
  for e in
    select en.id, en.church_id, en.service_id, en.class_id
      from public.enrollments en
     where en.person_id = p_person
       and public.enrollment_visible(en.church_id, en.service_id, en.class_id,
             (select role from public.my_scope()), (select church_id from public.my_scope()),
             (select service_id from public.my_scope()), (select class_id from public.my_scope()))
  loop
    return query
      select x.id, x.name, x.exam_date, x.academic_year, x.status, x.locked, x.published_at,
             e.id, e.class_id, cl.name, sv.name, ch.name,
             c.subjects_total, c.subjects_entered, c.total_score, c.total_full, c.percent,
             c.grade_id, g.name, g.color, c.passed, c.status
        from public.result_exams x
        join public.classes  cl on cl.id = e.class_id
        join public.services sv on sv.id = e.service_id
        join public.churches ch on ch.id = e.church_id
        cross join lateral public.result_summary_core(x.id, e.id) c
        left join public.grading_grades g on g.id = c.grade_id
       where x.church_id = e.church_id
         and (x.service_id is null or x.service_id = e.service_id)
         and (x.class_id   is null or x.class_id   = e.class_id)
         and c.status <> 'not_entered'
       order by x.exam_date desc nulls last, x.created_at desc;
  end loop;
end $$;
grant execute on function public.result_student_history(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 7. WRITE RPCs
-- ---------------------------------------------------------------------
-- Bulk upsert (security INVOKER → RLS + triggers decide per row).
-- p_rows: [{subject_id, enrollment_id, score, status, note}]
-- Returns [{subject_id, enrollment_id, ok, error}] — the caller retries the failures.
create or replace function public.result_save_bulk(p_exam uuid, p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare r jsonb; out jsonb := '[]'::jsonb; v_status text; v_score numeric;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    begin
      v_status := coalesce(r->>'status', 'completed');
      v_score  := case when r->>'score' is null or r->>'score' = '' then null else (r->>'score')::numeric end;
      insert into public.exam_results (exam_id, subject_id, enrollment_id, score, status, note, person_id, church_id, service_id, class_id)
      select p_exam, (r->>'subject_id')::uuid, e.id, v_score, v_status, r->>'note', e.person_id, e.church_id, e.service_id, e.class_id
        from public.enrollments e where e.id = (r->>'enrollment_id')::uuid
      on conflict (exam_id, subject_id, enrollment_id) do update
        set score = excluded.score, status = excluded.status,
            note  = coalesce(excluded.note, public.exam_results.note);
      if not found then raise exception 'enrollment_not_found' using errcode = 'P0001'; end if;
      out := out || jsonb_build_object('subject_id', r->>'subject_id', 'enrollment_id', r->>'enrollment_id', 'ok', true);
    exception when others then
      out := out || jsonb_build_object('subject_id', r->>'subject_id', 'enrollment_id', r->>'enrollment_id', 'ok', false,
                                       'error', case when sqlstate = '42501' then 'forbidden' else sqlerrm end);
    end;
  end loop;
  return out;
end $$;
grant execute on function public.result_save_bulk(uuid, jsonb) to authenticated;

-- Copy results from another exam: subjects matched by code, then by name;
-- scores scaled when the full degrees differ. Existing rows are kept.
create or replace function public.result_copy_from_exam(p_from uuid, p_to uuid)
returns integer language plpgsql security invoker set search_path = public as $$
declare n integer;
begin
  insert into public.exam_results (exam_id, subject_id, enrollment_id, score, status, note, person_id, church_id, service_id, class_id)
  select distinct on (st.id, r.enrollment_id)
         p_to, st.id, r.enrollment_id,
         case when r.score is null then null else round(r.score * st.full_degree / sf.full_degree, 2) end,
         r.status, r.note, e.person_id, e.church_id, e.service_id, e.class_id
    from public.exam_results r
    join public.result_subjects sf on sf.id = r.subject_id
    join public.result_subjects st on st.exam_id = p_to
         and ((st.code is not null and sf.code is not null and lower(st.code) = lower(sf.code)) or lower(st.name) = lower(sf.name))
    join public.enrollments e on e.id = r.enrollment_id
    join public.result_exams x on x.id = p_to
   where r.exam_id = p_from
     and e.church_id = x.church_id
     and (x.service_id is null or e.service_id = x.service_id)
     and (x.class_id   is null or e.class_id   = x.class_id)
   order by st.id, r.enrollment_id, (st.code is not null and sf.code is not null and lower(st.code) = lower(sf.code)) desc
  on conflict (exam_id, subject_id, enrollment_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.result_copy_from_exam(uuid, uuid) to authenticated;

-- Clear results of an exam (one subject or all). RLS delete policy applies.
create or replace function public.result_clear(p_exam uuid, p_subject uuid default null, p_enrollments uuid[] default null)
returns integer language plpgsql security invoker set search_path = public as $$
declare n integer;
begin
  delete from public.exam_results
   where exam_id = p_exam
     and (p_subject is null or subject_id = p_subject)
     and (p_enrollments is null or enrollment_id = any (p_enrollments));
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.result_clear(uuid, uuid, uuid[]) to authenticated;

-- Lock / unlock (admins — results.lock)
create or replace function public.result_exam_set_lock(p_exam uuid, p_locked boolean)
returns public.result_exams language plpgsql security definer set search_path = public as $$
declare x public.result_exams;
begin
  select * into x from public.result_exams where id = p_exam;
  if x.id is null then raise exception 'exam_not_found' using errcode = 'P0001'; end if;
  if not (public.result_can('results.lock') and public.scope_contains(x.church_id, x.service_id, x.class_id)) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  perform set_config('results.lock_rpc', '1', true);
  update public.result_exams
     set locked = p_locked,
         locked_at = case when p_locked then now() else null end,
         locked_by = case when p_locked then auth.uid() else null end,
         status = case when p_locked and status in ('draft', 'open') then 'completed' else status end
   where id = p_exam returning * into x;
  perform set_config('results.lock_rpc', '', true);
  return x;
end $$;
grant execute on function public.result_exam_set_lock(uuid, boolean) to authenticated;

-- Duplicate an exam with its subjects (no results)
create or replace function public.result_exam_duplicate(p_exam uuid, p_name text default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare x public.result_exams; nid uuid;
begin
  select * into x from public.result_exams where id = p_exam;
  if x.id is null then raise exception 'exam_not_found' using errcode = 'P0001'; end if;
  insert into public.result_exams (church_id, service_id, class_id, name, exam_date, academic_year, description, status,
    grading_system_id, grade_overall, grade_subject, pass_rule, pass_percent, absent_as_zero, min_required_subjects)
  values (x.church_id, x.service_id, x.class_id, coalesce(nullif(trim(p_name), ''), x.name || ' (نسخة)'), null, x.academic_year, x.description, 'draft',
    x.grading_system_id, x.grade_overall, x.grade_subject, x.pass_rule, x.pass_percent, x.absent_as_zero, x.min_required_subjects)
  returning id into nid;
  insert into public.result_subjects (exam_id, name, code, full_degree, pass_degree, weight, is_bonus, sort_order)
  select nid, name, code, full_degree, pass_degree, weight, is_bonus, sort_order from public.result_subjects where exam_id = p_exam;
  return nid;
end $$;
grant execute on function public.result_exam_duplicate(uuid, text) to authenticated;

-- Duplicate a grading system (with its grades)
create or replace function public.grading_system_duplicate(p_system uuid, p_name text default null)
returns uuid language plpgsql security invoker set search_path = public as $$
declare g public.grading_systems; nid uuid;
begin
  select * into g from public.grading_systems where id = p_system;
  if g.id is null then raise exception 'grading_system_not_found' using errcode = 'P0001'; end if;
  insert into public.grading_systems (church_id, name, description)
  values (case when (select public.is_owner()) then g.church_id else coalesce(g.church_id, (select church_id from public.my_scope())) end,
          coalesce(nullif(trim(p_name), ''), g.name || ' (نسخة)'), g.description)
  returning id into nid;
  insert into public.grading_grades (grading_system_id, name, min_percent, max_percent, description, color, is_pass, sort_order)
  select nid, name, min_percent, max_percent, description, color, is_pass, sort_order from public.grading_grades where grading_system_id = p_system;
  return nid;
end $$;
grant execute on function public.grading_system_duplicate(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 8. CHILD PORTAL — published exams of the child (no auth; QR code)
-- ---------------------------------------------------------------------
create or replace function public.child_portal_results(p_national_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.persons; out jsonb;
begin
  p := public.child_portal_person(p_national_id);
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.exam_date desc nulls last), '[]'::jsonb) into out
    from (
      select x.id as exam_id, x.name as exam_name, x.exam_date, x.academic_year, x.published_at,
             e.id as enrollment_id, cl.name as class_name, sv.name as service_name, ch.name as church_name,
             c.subjects_total, c.subjects_entered, c.total_score, c.total_full, c.percent,
             g.name as grade_name, g.color as grade_color, c.passed, c.status,
             (select coalesce(jsonb_agg(jsonb_build_object(
                 'subject_id', s.id, 'subject', s.name, 'full_degree', s.full_degree, 'pass_degree', s.pass_degree, 'is_bonus', s.is_bonus,
                 'score', r.score, 'status', r.status, 'percent', r.percent, 'passed', r.passed,
                 'grade_name', gg.name, 'grade_color', gg.color) order by s.sort_order, s.name), '[]'::jsonb)
                from public.result_subjects s
                left join public.exam_results r on r.subject_id = s.id and r.enrollment_id = e.id
                left join public.grading_grades gg on gg.id = r.grade_id
               where s.exam_id = x.id) as subjects
        from public.enrollments e
        join public.classes  cl on cl.id = e.class_id
        join public.services sv on sv.id = e.service_id
        join public.churches ch on ch.id = e.church_id
        join public.result_exams x on x.church_id = e.church_id
             and (x.service_id is null or x.service_id = e.service_id)
             and (x.class_id   is null or x.class_id   = e.class_id)
        cross join lateral public.result_summary_core(x.id, e.id) c
        left join public.grading_grades g on g.id = c.grade_id
       where e.person_id = p.id
         and x.published_at is not null
         and c.status <> 'not_entered'
    ) t;
  return out;
end $$;
grant execute on function public.child_portal_results(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 9. REALTIME
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['grading_systems', 'grading_grades', 'result_exams', 'result_subjects', 'exam_results'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
alter table public.result_exams    replica identity full;
alter table public.result_subjects replica identity full;
alter table public.exam_results    replica identity full;
alter table public.grading_systems replica identity full;
alter table public.grading_grades  replica identity full;

commit;
