-- =====================================================================
-- 0042: CHILD ACCOUNTS (كلمة مرور المخدوم + طلبات انضمام المخدومين)
--       + SERVANTS AS ENROLLMENTS (الخدام كفصول في صفحة المخدومين)
--
-- A. enrollments.kind  ('child' | 'servant') + enrollments.servant_id
--    Every APPROVED (or suspended) servant whose scope is complete
--    (church → service → class) gets a MIRROR row in `enrollments`
--    (kind = 'servant', servant_id = his account). The children page can
--    therefore switch between «المخدومين» and «الخدام» and offer EVERY job
--    (attendance · points · calls · messages · data · cards · achievements)
--    on servants too, grouped by class exactly like children. A trigger on
--    servant_enrollments keeps the mirror in sync (scope / status / delete).
--    All statistics RPCs gain `p_kind` (default 'child') so the numbers of
--    the children keep meaning "children".
--
-- B. person_credentials — a PASSWORD for the child portal. The card QR
--    (national id) is no longer a bearer token by itself: the child logs in
--    with code + password (`child_login`) and receives a SESSION TOKEN
--    (`child_sessions`, sha-256 stored, 12 h or 90 days with «تذكرني»).
--    `child_portal_person(token)` — the resolver every child_portal_* RPC
--    already uses — now accepts ONLY a live session token, so all ~50 portal
--    RPCs are protected at once without touching them.
--
-- C. child_join_requests — «إنشاء حساب مخدوم» (/child/signup): code (typed
--    or scanned) + data + password + desired class → a PENDING request the
--    servants review in إدارة المخدومين → الطلبات (`review_child_join_request`
--    creates / binds the person, the enrollment and the credentials).
--
-- D. Password management: child_change_password (the child himself),
--    admin_set_child_password (a servant who can access the person — used by
--    the edit modal on the children page and by the add-child form).
--
-- pgcrypto: on Supabase it lives in the `extensions` schema, so every
-- function that hashes uses `search_path = public, extensions`.
-- Idempotent.
-- =====================================================================

begin;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pgcrypto') then
    begin
      create extension pgcrypto with schema extensions;
    exception when others then
      create extension if not exists pgcrypto;
    end;
  end if;
end $$;

-- =====================================================================
-- A. ENROLLMENTS.KIND + SERVANT MIRROR
-- =====================================================================
alter table public.enrollments
  add column if not exists kind text not null default 'child',
  add column if not exists servant_id uuid references public.servant_enrollments(id) on delete cascade;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'enrollments_kind_check') then
    alter table public.enrollments add constraint enrollments_kind_check check (kind in ('child', 'servant'));
  end if;
end $$;

create index if not exists idx_enrollments_kind on public.enrollments(kind);
create unique index if not exists uq_enrollments_servant on public.enrollments(servant_id) where servant_id is not null;

comment on column public.enrollments.kind is 'child = مخدوم · servant = خادم (صف مرآة لتسجيل الخادم — يُدار بالمشغّل sync_servant_mirror_enrollment)';
comment on column public.enrollments.servant_id is 'حساب الخادم الذي يعكسه هذا الصف (kind = servant)';

-- Keep the mirror in sync with the servant enrollment
create or replace function public.sync_servant_mirror_enrollment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m   public.enrollments%rowtype;
  cur public.servant_enrollments%rowtype;
begin
  if tg_op = 'DELETE' then
    delete from public.enrollments where servant_id = old.id;
    return old;
  end if;

  -- Re-read the live row: other AFTER triggers (auto_person_for_servant) may have
  -- already updated it (person_id) in a nested statement, leaving NEW stale.
  select * into cur from public.servant_enrollments where id = new.id;
  if not found then
    return new;
  end if;

  -- a mirror needs a person + a COMPLETE scope + a live account
  if cur.person_id is null or cur.church_id is null or cur.service_id is null or cur.class_id is null
     or cur.status not in ('approved', 'suspended') then
    delete from public.enrollments where servant_id = cur.id;
    return new;
  end if;

  select * into m from public.enrollments where servant_id = cur.id;
  if found then
    if m.person_id <> cur.person_id or m.church_id <> cur.church_id
       or m.service_id <> cur.service_id or m.class_id <> cur.class_id then
      begin
        update public.enrollments
           set person_id = cur.person_id, church_id = cur.church_id,
               service_id = cur.service_id, class_id = cur.class_id
         where id = m.id;
      exception when unique_violation then
        -- the person already has a row in the target class → adopt it
        delete from public.enrollments where id = m.id;
        update public.enrollments set kind = 'servant', servant_id = cur.id
         where person_id = cur.person_id and class_id = cur.class_id;
      end;
    end if;
  else
    insert into public.enrollments (person_id, church_id, service_id, class_id, kind, servant_id, created_by, edited_by)
    values (cur.person_id, cur.church_id, cur.service_id, cur.class_id, 'servant', cur.id,
            coalesce(cur.approved_by, cur.id), coalesce(cur.approved_by, cur.id))
    on conflict (person_id, class_id) do update set kind = 'servant', servant_id = excluded.servant_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_sync_servant_mirror_enrollment on public.servant_enrollments;
create trigger trg_sync_servant_mirror_enrollment
after insert or update of person_id, church_id, service_id, class_id, status or delete
on public.servant_enrollments
for each row execute function public.sync_servant_mirror_enrollment();

-- Backfill the existing servants
insert into public.enrollments (person_id, church_id, service_id, class_id, kind, servant_id, created_by, edited_by)
select s.person_id, s.church_id, s.service_id, s.class_id, 'servant', s.id,
       coalesce(s.approved_by, s.id), coalesce(s.approved_by, s.id)
  from public.servant_enrollments s
 where s.person_id is not null and s.church_id is not null and s.service_id is not null and s.class_id is not null
   and s.status in ('approved', 'suspended')
   and not exists (select 1 from public.enrollments e where e.servant_id = s.id)
on conflict (person_id, class_id) do update set kind = 'servant', servant_id = excluded.servant_id;

-- Home counters: children only
create or replace function public.dashboard_counts(p_today_start timestamptz)
returns table (
  persons bigint, enrollments bigint, today_attendance bigint,
  pending_servants bigint, churches bigint, services bigint, classes bigint)
language sql stable security invoker set search_path = public as $$
  select
    (select count(distinct person_id) from public.enrollments where kind = 'child'),
    (select count(*) from public.enrollments where kind = 'child'),
    (select count(*) from public.attendance_log where created_at >= p_today_start),
    (select count(*) from public.servant_enrollments where status = 'pending'),
    (select count(*) from public.churches),
    (select count(*) from public.services),
    (select count(*) from public.classes)
$$;

-- ---------------------------------------------------------------------
-- A2. STATISTICS RPCs — same bodies as 0020 + `p_kind` (child | servant | all)
-- ---------------------------------------------------------------------
-- ---------------------------------------------------------------------
-- 1. Headline KPIs of the scope (all time)
-- ---------------------------------------------------------------------
drop function if exists public.stats_scope_summary(uuid, uuid, uuid);
create or replace function public.stats_scope_summary(
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_kind text default 'child')
returns table (
  enrollments      bigint,   -- إجمالي التسجيلات
  persons          bigint,   -- إجمالي المخدومين (distinct persons)
  males            bigint,
  females          bigint,
  total_attendance bigint,   -- sum(enrollments.attendance_count)
  total_points     bigint,   -- sum(enrollments.points) — current balance
  attendance_points bigint,  -- points that came with attendance (all time)
  cause_points_added bigint, -- positive cause deltas (all time)
  cause_points_removed bigint, -- abs(negative cause deltas) (all time)
  events_count     bigint,   -- events applying to the scope
  causes_count     bigint,   -- causes applying to the scope
  classes_count    bigint,   -- distinct classes with enrollments in scope
  first_attendance date,     -- earliest attended_on in scope
  last_attendance  date      -- latest attended_on in scope
)
language sql stable security invoker set search_path = public as $$
  with sc as (
    select e.id, e.person_id, e.church_id, e.service_id, e.class_id,
           e.attendance_count, e.points
      from public.enrollments e
     where (p_church  is null or e.church_id  = p_church)
       and (p_service is null or e.service_id = p_service)
       and (p_class   is null or e.class_id   = p_class)
       and (p_kind is null or p_kind = 'all' or e.kind = p_kind)
  )
  select
    (select count(*) from sc),
    (select count(distinct person_id) from sc),
    (select count(distinct sc.person_id) from sc join public.persons p on p.id = sc.person_id where p.gender = 'male'),
    (select count(distinct sc.person_id) from sc join public.persons p on p.id = sc.person_id where p.gender = 'female'),
    (select coalesce(sum(attendance_count), 0) from sc),
    (select coalesce(sum(points), 0) from sc),
    (select coalesce(sum(a.points_delta), 0) from public.attendance_log a join sc on sc.id = a.enrollment_id),
    (select coalesce(sum(l.delta), 0) from public.points_log l join sc on sc.id = l.enrollment_id where l.delta > 0),
    (select coalesce(-sum(l.delta), 0) from public.points_log l join sc on sc.id = l.enrollment_id where l.delta < 0),
    (select count(*) from public.events ev
      where (p_church  is null or ev.church_id = p_church)
        and (p_service is null or ev.service_id is null or ev.service_id = p_service)
        and (p_class   is null or ev.class_id   is null or ev.class_id   = p_class)),
    (select count(*) from public.causes ca
      where (p_church  is null or ca.church_id = p_church)
        and (p_service is null or ca.service_id is null or ca.service_id = p_service)
        and (p_class   is null or ca.class_id   is null or ca.class_id   = p_class)),
    (select count(distinct class_id) from sc),
    (select min(a.attended_on) from public.attendance_log a join sc on sc.id = a.enrollment_id),
    (select max(a.attended_on) from public.attendance_log a join sc on sc.id = a.enrollment_id)
$$;

-- ---------------------------------------------------------------------
-- 2. KPIs of ONE selected day
-- ---------------------------------------------------------------------
drop function if exists public.stats_day_summary(date, uuid, uuid, uuid);
create or replace function public.stats_day_summary(
  p_day date,
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_kind text default 'child')
returns table (
  attendance        bigint,  -- attendance rows on the day
  attendees         bigint,  -- distinct persons who attended
  events_attended   bigint,  -- distinct events with ≥1 attendance
  attendance_points bigint,  -- points granted with attendance
  cause_points_added   bigint,
  cause_points_removed bigint,
  cause_entries     bigint,  -- points_log rows on the day
  causes_used       bigint,  -- distinct causes used
  scope_persons     bigint   -- persons in scope (denominator for %)
)
language sql stable security invoker set search_path = public as $$
  with sc as (
    select e.id, e.person_id
      from public.enrollments e
     where (p_church  is null or e.church_id  = p_church)
       and (p_service is null or e.service_id = p_service)
       and (p_class   is null or e.class_id   = p_class)
       and (p_kind is null or p_kind = 'all' or e.kind = p_kind)
  ),
  att as (
    select a.*, sc.person_id
      from public.attendance_log a join sc on sc.id = a.enrollment_id
     where a.attended_on = p_day
  ),
  pts as (
    select l.*
      from public.points_log l join sc on sc.id = l.enrollment_id
     where (l.created_at at time zone 'Africa/Cairo')::date = p_day
  )
  select
    (select count(*) from att),
    (select count(distinct person_id) from att),
    (select count(distinct event_id) from att where event_id is not null),
    (select coalesce(sum(points_delta), 0) from att),
    (select coalesce(sum(delta), 0) from pts where delta > 0),
    (select coalesce(-sum(delta), 0) from pts where delta < 0),
    (select count(*) from pts),
    (select count(distinct cause_id) from pts where cause_id is not null),
    (select count(distinct person_id) from sc)
$$;

-- ---------------------------------------------------------------------
-- 3. Attendance on a day, grouped by EVENT (sorted by event)
-- ---------------------------------------------------------------------
drop function if exists public.stats_attendance_by_event(date, uuid, uuid, uuid);
create or replace function public.stats_attendance_by_event(
  p_day date,
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_kind text default 'child')
returns table (
  event_id      uuid,
  event_name    text,
  church_id     uuid,     -- to disambiguate same-named events across churches
  event_scope   text,     -- 'church' | 'service' | 'class'
  attendance    bigint,   -- rows
  attendees     bigint,   -- distinct persons
  points        bigint,   -- sum(points_delta)
  eligible      bigint,   -- enrollments in scope the event applies to
  first_at      timestamptz,
  last_at       timestamptz
)
language sql stable security invoker set search_path = public as $$
  with sc as (
    select e.id, e.person_id, e.church_id, e.service_id, e.class_id
      from public.enrollments e
     where (p_church  is null or e.church_id  = p_church)
       and (p_service is null or e.service_id = p_service)
       and (p_class   is null or e.class_id   = p_class)
       and (p_kind is null or p_kind = 'all' or e.kind = p_kind)
  ),
  att as (
    select a.event_id, a.points_delta, a.created_at, sc.person_id
      from public.attendance_log a join sc on sc.id = a.enrollment_id
     where a.attended_on = p_day
  ),
  grp as (
    select event_id,
           count(*)::bigint as attendance,
           count(distinct person_id)::bigint as attendees,
           coalesce(sum(points_delta), 0)::bigint as points,
           min(created_at) as first_at,
           max(created_at) as last_at
      from att group by event_id
  )
  select g.event_id,
         coalesce(ev.name, 'بدون مناسبة') as event_name,
         ev.church_id,
         case when ev.id is null then 'church'
              when ev.class_id is not null then 'class'
              when ev.service_id is not null then 'service'
              else 'church' end as event_scope,
         g.attendance, g.attendees, g.points,
         (select count(*) from sc
           where ev.id is not null
             and sc.church_id = ev.church_id
             and (ev.service_id is null or sc.service_id = ev.service_id)
             and (ev.class_id   is null or sc.class_id   = ev.class_id))::bigint as eligible,
         g.first_at, g.last_at
    from grp g
    left join public.events ev on ev.id = g.event_id
   order by event_name, g.event_id
$$;

-- ---------------------------------------------------------------------
-- 4. Points granted on a day, grouped by CAUSE (sorted by cause)
-- ---------------------------------------------------------------------
drop function if exists public.stats_points_by_cause(date, uuid, uuid, uuid);
create or replace function public.stats_points_by_cause(
  p_day date,
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_kind text default 'child')
returns table (
  cause_id      uuid,
  cause_name    text,
  church_id     uuid,
  cause_scope   text,
  entries       bigint,   -- points_log rows
  recipients    bigint,   -- distinct persons
  added         bigint,   -- sum of positive deltas
  removed       bigint,   -- abs(sum of negative deltas)
  net           bigint,   -- added - removed
  first_at      timestamptz,
  last_at       timestamptz
)
language sql stable security invoker set search_path = public as $$
  with sc as (
    select e.id, e.person_id
      from public.enrollments e
     where (p_church  is null or e.church_id  = p_church)
       and (p_service is null or e.service_id = p_service)
       and (p_class   is null or e.class_id   = p_class)
       and (p_kind is null or p_kind = 'all' or e.kind = p_kind)
  ),
  pts as (
    select l.cause_id, l.delta, l.created_at, sc.person_id
      from public.points_log l join sc on sc.id = l.enrollment_id
     where (l.created_at at time zone 'Africa/Cairo')::date = p_day
  ),
  grp as (
    select cause_id,
           count(*)::bigint as entries,
           count(distinct person_id)::bigint as recipients,
           coalesce(sum(case when delta > 0 then delta else 0 end), 0)::bigint as added,
           coalesce(sum(case when delta < 0 then -delta else 0 end), 0)::bigint as removed,
           coalesce(sum(delta), 0)::bigint as net,
           min(created_at) as first_at,
           max(created_at) as last_at
      from pts group by cause_id
  )
  select g.cause_id,
         coalesce(ca.name, 'بدون سبب') as cause_name,
         ca.church_id,
         case when ca.id is null then 'church'
              when ca.class_id is not null then 'class'
              when ca.service_id is not null then 'service'
              else 'church' end as cause_scope,
         g.entries, g.recipients, g.added, g.removed, g.net, g.first_at, g.last_at
    from grp g
    left join public.causes ca on ca.id = g.cause_id
   order by cause_name, g.cause_id
$$;

-- ---------------------------------------------------------------------
-- 5. Attendance TIMELINE — per bucket × event over a period
--    p_bucket: 'day' | 'week' | 'month'. Buckets are Cairo calendar
--    days / ISO weeks (Monday start) / months, returned as the bucket's
--    first day. The client fills empty buckets with zero.
-- ---------------------------------------------------------------------
drop function if exists public.stats_attendance_timeline(date, date, text, uuid, uuid, uuid);
create or replace function public.stats_attendance_timeline(
  p_from date, p_to date, p_bucket text default 'day',
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_kind text default 'child')
returns table (
  bucket      date,
  event_id    uuid,
  event_name  text,
  church_id   uuid,
  attendance  bigint,
  attendees   bigint,
  points      bigint
)
language sql stable security invoker set search_path = public as $$
  with sc as (
    select e.id, e.person_id
      from public.enrollments e
     where (p_church  is null or e.church_id  = p_church)
       and (p_service is null or e.service_id = p_service)
       and (p_class   is null or e.class_id   = p_class)
       and (p_kind is null or p_kind = 'all' or e.kind = p_kind)
  ),
  att as (
    select case lower(coalesce(p_bucket, 'day'))
             when 'week'  then date_trunc('week',  a.attended_on::timestamp)::date
             when 'month' then date_trunc('month', a.attended_on::timestamp)::date
             else a.attended_on
           end as bucket,
           a.event_id, a.points_delta, sc.person_id
      from public.attendance_log a join sc on sc.id = a.enrollment_id
     where a.attended_on between p_from and p_to
  )
  select att.bucket, att.event_id,
         coalesce(ev.name, 'بدون مناسبة') as event_name,
         ev.church_id,
         count(*)::bigint,
         count(distinct att.person_id)::bigint,
         coalesce(sum(att.points_delta), 0)::bigint
    from att
    left join public.events ev on ev.id = att.event_id
   group by att.bucket, att.event_id, ev.name, ev.church_id
   order by att.bucket, event_name
$$;

-- ---------------------------------------------------------------------
-- 6. Points TIMELINE — per bucket × cause over a period
-- ---------------------------------------------------------------------
drop function if exists public.stats_points_timeline(date, date, text, uuid, uuid, uuid);
create or replace function public.stats_points_timeline(
  p_from date, p_to date, p_bucket text default 'day',
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_kind text default 'child')
returns table (
  bucket      date,
  cause_id    uuid,
  cause_name  text,
  church_id   uuid,
  entries     bigint,
  added       bigint,
  removed     bigint,
  net         bigint
)
language sql stable security invoker set search_path = public as $$
  with sc as (
    select e.id
      from public.enrollments e
     where (p_church  is null or e.church_id  = p_church)
       and (p_service is null or e.service_id = p_service)
       and (p_class   is null or e.class_id   = p_class)
       and (p_kind is null or p_kind = 'all' or e.kind = p_kind)
  ),
  pts as (
    select (l.created_at at time zone 'Africa/Cairo')::date as day, l.cause_id, l.delta
      from public.points_log l join sc on sc.id = l.enrollment_id
     where (l.created_at at time zone 'Africa/Cairo')::date between p_from and p_to
  ),
  b as (
    select case lower(coalesce(p_bucket, 'day'))
             when 'week'  then date_trunc('week',  day::timestamp)::date
             when 'month' then date_trunc('month', day::timestamp)::date
             else day
           end as bucket, cause_id, delta
      from pts
  )
  select b.bucket, b.cause_id,
         coalesce(ca.name, 'بدون سبب') as cause_name,
         ca.church_id,
         count(*)::bigint,
         coalesce(sum(case when b.delta > 0 then b.delta else 0 end), 0)::bigint,
         coalesce(sum(case when b.delta < 0 then -b.delta else 0 end), 0)::bigint,
         coalesce(sum(b.delta), 0)::bigint
    from b
    left join public.causes ca on ca.id = b.cause_id
   group by b.bucket, b.cause_id, ca.name, ca.church_id
   order by b.bucket, cause_name
$$;

-- ---------------------------------------------------------------------
-- 7. Attendance on a day per CLASS (with % of enrolled)
-- ---------------------------------------------------------------------
drop function if exists public.stats_attendance_by_class(date, uuid, uuid, uuid);
create or replace function public.stats_attendance_by_class(
  p_day date,
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_kind text default 'child')
returns table (
  class_id     uuid,
  class_name   text,
  service_name text,
  church_name  text,
  enrolled     bigint,
  attendees    bigint,   -- distinct persons attended (any event)
  attendance   bigint,   -- rows
  points       bigint
)
language sql stable security invoker set search_path = public as $$
  with sc as (
    select e.id, e.person_id, e.class_id
      from public.enrollments e
     where (p_church  is null or e.church_id  = p_church)
       and (p_service is null or e.service_id = p_service)
       and (p_class   is null or e.class_id   = p_class)
       and (p_kind is null or p_kind = 'all' or e.kind = p_kind)
  ),
  att as (
    select sc.class_id, sc.person_id, a.points_delta
      from public.attendance_log a join sc on sc.id = a.enrollment_id
     where a.attended_on = p_day
  )
  select c.id, c.name, s.name, ch.name,
         (select count(*) from sc where sc.class_id = c.id)::bigint,
         (select count(distinct person_id) from att where att.class_id = c.id)::bigint,
         (select count(*) from att where att.class_id = c.id)::bigint,
         (select coalesce(sum(points_delta), 0) from att where att.class_id = c.id)::bigint
    from public.classes c
    join public.services s on s.id = c.service_id
    join public.churches ch on ch.id = c.church_id
   where c.id in (select distinct class_id from sc)
   order by ch.name, s.name, c.name
$$;

-- ---------------------------------------------------------------------
-- 8. Leaderboard for the scope — by points or by attendance
-- ---------------------------------------------------------------------
drop function if exists public.stats_leaderboard_scoped(text, int, uuid, uuid, uuid);
create or replace function public.stats_leaderboard_scoped(
  p_by text default 'points', p_limit int default 10,
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_kind text default 'child')
returns table (
  enrollment_id uuid, person_id uuid, name text, image_url text,
  class_name text, points integer, attendance_count integer)
language sql stable security invoker set search_path = public as $$
  select e.id, e.person_id, p.name, p.image_url, c.name, e.points, e.attendance_count
    from public.enrollments e
    join public.persons p on p.id = e.person_id
    left join public.classes c on c.id = e.class_id
   where (p_church  is null or e.church_id  = p_church)
     and (p_service is null or e.service_id = p_service)
     and (p_class   is null or e.class_id   = p_class)
       and (p_kind is null or p_kind = 'all' or e.kind = p_kind)
   order by
     case when lower(coalesce(p_by, 'points')) = 'attendance' then e.attendance_count else e.points end desc,
     case when lower(coalesce(p_by, 'points')) = 'attendance' then e.points else e.attendance_count end desc,
     p.name
   limit greatest(1, least(coalesce(p_limit, 10), 100))
$$;

-- ---------------------------------------------------------------------
-- 9. Weekday profile — attendance by weekday (0=Sun..6=Sat) over a period
-- ---------------------------------------------------------------------
drop function if exists public.stats_weekday_profile(date, date, uuid, uuid, uuid);
create or replace function public.stats_weekday_profile(
  p_from date, p_to date,
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_kind text default 'child')
returns table (weekday int, attendance bigint, days_with_attendance bigint)
language sql stable security invoker set search_path = public as $$
  with sc as (
    select e.id from public.enrollments e
     where (p_church  is null or e.church_id  = p_church)
       and (p_service is null or e.service_id = p_service)
       and (p_class   is null or e.class_id   = p_class)
       and (p_kind is null or p_kind = 'all' or e.kind = p_kind)
  )
  select extract(dow from a.attended_on)::int,
         count(*)::bigint,
         count(distinct a.attended_on)::bigint
    from public.attendance_log a join sc on sc.id = a.enrollment_id
   where a.attended_on between p_from and p_to
   group by 1 order by 1
$$;

grant execute on function public.stats_scope_summary(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.stats_day_summary(date, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.stats_attendance_by_event(date, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.stats_points_by_cause(date, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.stats_attendance_timeline(date, date, text, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.stats_points_timeline(date, date, text, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.stats_attendance_by_class(date, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.stats_leaderboard_scoped(text, int, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.stats_weekday_profile(date, date, uuid, uuid, uuid, text) to authenticated;

-- =====================================================================
-- B. CHILD CREDENTIALS + SESSIONS (كلمة مرور المخدوم)
-- =====================================================================
create table if not exists public.person_credentials (
  person_id      uuid primary key references public.persons(id) on delete cascade,
  password_hash  text not null,
  set_by         uuid references public.servant_enrollments(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.person_credentials is 'كلمة مرور بوابة المخدوم (bcrypt) — شخص واحد = كلمة مرور واحدة';
alter table public.person_credentials enable row level security;
-- no direct table access: everything goes through the RPCs below
revoke all on public.person_credentials from anon, authenticated;

create table if not exists public.child_sessions (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references public.persons(id) on delete cascade,
  token_hash   text not null unique,
  remember     boolean not null default false,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_seen_at timestamptz not null default now(),
  user_agent   text
);
create index if not exists idx_child_sessions_person on public.child_sessions(person_id);
create index if not exists idx_child_sessions_expires on public.child_sessions(expires_at);
comment on table public.child_sessions is 'جلسات بوابة المخدوم — التوكن مخزَّن كـ sha256؛ 12 ساعة أو 90 يومًا مع «تذكرني»';
alter table public.child_sessions enable row level security;
revoke all on public.child_sessions from anon, authenticated;

-- Does this person have a portal password?
create or replace function public.person_has_password(p_person uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.person_credentials c where c.person_id = p_person)
$$;
grant execute on function public.person_has_password(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- The resolver every child_portal_* RPC uses. Accepts a SESSION TOKEN only.
-- STABLE (read-only) so the many STABLE portal RPCs can keep calling it;
-- the sliding «remember me» extension happens in child_session_touch().
-- ---------------------------------------------------------------------
create or replace function public.child_portal_person(p_national_id text)
returns public.persons language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v public.persons;
  s public.child_sessions;
begin
  if nullif(trim(coalesce(p_national_id, '')), '') is null then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;
  -- the parameter is now a SESSION TOKEN (issued by child_login); a raw code
  -- never matches a stored hash so it simply ends up as «session_expired»
  select * into s from public.child_sessions
   where token_hash = encode(digest(trim(p_national_id), 'sha256'), 'hex');
  if not found or s.expires_at < now() then
    raise exception 'session_expired' using errcode = 'P0002';
  end if;
  select * into v from public.persons where id = s.person_id;
  if not found then
    raise exception 'unknown_code' using errcode = 'P0002';
  end if;
  return v;
end $$;
revoke all on function public.child_portal_person(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- child_login(code, password, remember) → { token, expires_at, person_id }
-- ---------------------------------------------------------------------
create or replace function public.child_login(p_code text, p_password text, p_remember boolean default false, p_user_agent text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  p public.persons;
  c public.person_credentials;
  v_token text;
  v_exp timestamptz;
begin
  if nullif(trim(coalesce(p_code, '')), '') is null then raise exception 'invalid_code' using errcode = 'P0001'; end if;
  select * into p from public.persons where national_id = trim(p_code);
  if not found then raise exception 'unknown_code' using errcode = 'P0002'; end if;
  -- a person that is only a servant (no child enrollment) can't use the portal
  if not exists (select 1 from public.enrollments e where e.person_id = p.id and e.kind = 'child') then
    raise exception 'unknown_code' using errcode = 'P0002';
  end if;
  select * into c from public.person_credentials where person_id = p.id;
  if not found then raise exception 'no_password' using errcode = 'P0009'; end if;
  if coalesce(p_password, '') = '' or c.password_hash <> crypt(p_password, c.password_hash) then
    perform pg_sleep(0.25);   -- slow down brute force a little
    raise exception 'wrong_password' using errcode = 'P0010';
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_exp := case when coalesce(p_remember, false) then now() + interval '90 days' else now() + interval '12 hours' end;
  insert into public.child_sessions (person_id, token_hash, remember, expires_at, user_agent)
  values (p.id, encode(digest(v_token, 'sha256'), 'hex'), coalesce(p_remember, false), v_exp, left(p_user_agent, 300));
  -- housekeeping
  delete from public.child_sessions where expires_at < now() - interval '1 day';

  return jsonb_build_object('token', v_token, 'expires_at', v_exp, 'person_id', p.id, 'remember', coalesce(p_remember, false));
end $$;
grant execute on function public.child_login(text, text, boolean, text) to anon, authenticated;

create or replace function public.child_logout(p_token text)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
begin
  if nullif(trim(coalesce(p_token, '')), '') is null then return; end if;
  delete from public.child_sessions where token_hash = encode(digest(trim(p_token), 'sha256'), 'hex');
end $$;
grant execute on function public.child_logout(text) to anon, authenticated;

-- Called by the portal on boot / when the tab becomes visible: validates the
-- session, refreshes last_seen and extends a «remember me» session.
create or replace function public.child_session_touch(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare s public.child_sessions;
begin
  if p_token is null or length(trim(p_token)) < 20 then raise exception 'invalid_code' using errcode = 'P0001'; end if;
  select * into s from public.child_sessions where token_hash = encode(digest(trim(p_token), 'sha256'), 'hex');
  if not found then raise exception 'session_expired' using errcode = 'P0002'; end if;
  if s.expires_at < now() then
    delete from public.child_sessions where id = s.id;
    raise exception 'session_expired' using errcode = 'P0002';
  end if;
  update public.child_sessions
     set last_seen_at = now(),
         expires_at = case when remember then greatest(expires_at, now() + interval '90 days') else expires_at end
   where id = s.id
   returning * into s;
  return jsonb_build_object('person_id', s.person_id, 'expires_at', s.expires_at, 'remember', s.remember);
end $$;
grant execute on function public.child_session_touch(text) to anon, authenticated;

-- The child changes his own password (current one required)
create or replace function public.child_change_password(p_token text, p_current text, p_new text)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  p public.persons;
  c public.person_credentials;
begin
  p := public.child_portal_person(p_token);
  if length(coalesce(p_new, '')) < 6 then raise exception 'weak_password' using errcode = 'P0001'; end if;
  select * into c from public.person_credentials where person_id = p.id;
  if not found or c.password_hash <> crypt(coalesce(p_current, ''), c.password_hash) then
    raise exception 'wrong_password' using errcode = 'P0010';
  end if;
  update public.person_credentials
     set password_hash = crypt(p_new, gen_salt('bf', 10)), updated_at = now()
   where person_id = p.id;
  -- every OTHER session is closed
  delete from public.child_sessions
   where person_id = p.id
     and token_hash <> encode(digest(trim(p_token), 'sha256'), 'hex');
end $$;
grant execute on function public.child_change_password(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- D. A servant sets / resets the password of a person he can access
--    (children page → تعديل البيانات → «إعادة تعيين كلمة المرور», and the
--    add-child form). Servants' own accounts are handled by Supabase Auth.
-- ---------------------------------------------------------------------
create or replace function public.admin_set_child_password(p_person uuid, p_password text)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
begin
  if public.my_role() is null then raise exception 'not_approved' using errcode = '42501'; end if;
  if not (public.is_owner() or public.can_access_person(p_person)
          or exists (select 1 from public.persons x where x.id = p_person and x.created_by = auth.uid())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'weak_password' using errcode = '22023'; end if;
  insert into public.person_credentials (person_id, password_hash, set_by)
  values (p_person, crypt(p_password, gen_salt('bf', 10)), auth.uid())
  on conflict (person_id) do update
    set password_hash = excluded.password_hash, set_by = auth.uid(), updated_at = now();
  delete from public.child_sessions where person_id = p_person;   -- force re-login
end $$;
revoke all on function public.admin_set_child_password(uuid, text) from public, anon;
grant execute on function public.admin_set_child_password(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- The ADD-CHILD RPC learns an optional password (set right away)
-- ---------------------------------------------------------------------
create or replace function public.add_person_and_enroll(
  p_church uuid,
  p_service uuid,
  p_class uuid,
  p_name text,
  p_national_id text default null,
  p_gender text default null,
  p_birthdate date default null,
  p_phone text default null,
  p_address text default null,
  p_notes text default null,
  p_image_url text default null,
  p_points integer default 0,
  p_password text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_nid text;
  v_person public.persons%rowtype;
  v_person_created boolean := false;
  v_enrollment_id uuid;
  v_already boolean := false;
begin
  if public.my_role() is null then
    raise exception 'not_approved' using errcode = '42501';
  end if;
  if not public.can_access(p_church, p_service, p_class) then
    raise exception 'no_access' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'name_required';
  end if;
  if p_gender is not null and p_gender not in ('male', 'female') then
    raise exception 'invalid_gender';
  end if;
  if p_password is not null and length(p_password) < 6 then
    raise exception 'weak_password' using errcode = '22023';
  end if;

  v_nid := nullif(trim(p_national_id), '');
  if v_nid is null then
    v_nid := public.new_person_code(p_church, p_service, p_class);
  end if;

  select * into v_person from public.persons where national_id = v_nid;

  if not found then
    insert into public.persons (
      national_id, name, gender, birthdate, phone, address, notes,
      image_url, created_by, edited_by
    ) values (
      v_nid, trim(p_name), p_gender, p_birthdate,
      nullif(trim(coalesce(p_phone, '')), ''),
      nullif(trim(coalesce(p_address, '')), ''),
      nullif(trim(coalesce(p_notes, '')), ''),
      p_image_url, auth.uid(), auth.uid()
    ) returning * into v_person;
    v_person_created := true;
  else
    update public.persons set
      gender    = coalesce(gender, p_gender),
      birthdate = coalesce(birthdate, p_birthdate),
      phone     = coalesce(phone, nullif(trim(coalesce(p_phone, '')), '')),
      address   = coalesce(address, nullif(trim(coalesce(p_address, '')), '')),
      notes     = coalesce(notes, nullif(trim(coalesce(p_notes, '')), '')),
      image_url = coalesce(image_url, p_image_url),
      edited_by = auth.uid(),
      edited_at = now()
    where id = v_person.id;
  end if;

  insert into public.enrollments (person_id, church_id, service_id, class_id, points, created_by, edited_by)
  values (v_person.id, p_church, p_service, p_class, greatest(coalesce(p_points, 0), 0), auth.uid(), auth.uid())
  on conflict (person_id, class_id) do nothing
  returning id into v_enrollment_id;

  if v_enrollment_id is null then
    v_already := true;
    select id into v_enrollment_id from public.enrollments
     where person_id = v_person.id and class_id = p_class;
  end if;

  -- password: set on a NEW person, or when the person has none yet
  if p_password is not null and (v_person_created or not public.person_has_password(v_person.id)) then
    insert into public.person_credentials (person_id, password_hash, set_by)
    values (v_person.id, crypt(p_password, gen_salt('bf', 10)), auth.uid())
    on conflict (person_id) do nothing;
  end if;

  return jsonb_build_object(
    'person_id', v_person.id,
    'enrollment_id', v_enrollment_id,
    'national_id', v_nid,
    'person_created', v_person_created,
    'already_enrolled', v_already,
    'has_password', public.person_has_password(v_person.id)
  );
end $$;

-- =====================================================================
-- C. CHILD JOIN REQUESTS (طلبات انضمام المخدومين — /child/signup)
-- =====================================================================
create table if not exists public.child_join_requests (
  id             uuid primary key default gen_random_uuid(),
  code           text not null,                     -- the card code (typed / scanned / generated)
  name           text not null,
  gender         text check (gender in ('male', 'female')),
  birthdate      date,
  phone          text,
  address        text,
  notes          text,
  image_url      text,
  password_hash  text not null,
  church_id      uuid references public.churches(id) on delete cascade,
  service_id     uuid references public.services(id) on delete cascade,
  class_id       uuid references public.classes(id) on delete cascade,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decision_note  text,
  decided_by     uuid references public.servant_enrollments(id) on delete set null,
  decided_at     timestamptz,
  person_id      uuid references public.persons(id) on delete set null,   -- filled on approval
  enrollment_id  uuid references public.enrollments(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists idx_cjr_status_created on public.child_join_requests(status, created_at desc);
create index if not exists idx_cjr_scope on public.child_join_requests(church_id, service_id, class_id);
create unique index if not exists uq_cjr_pending_code on public.child_join_requests(code) where status = 'pending';
comment on table public.child_join_requests is 'طلبات انضمام المخدومين من صفحة «إنشاء حساب مخدوم» — يوافق عليها الخدام من إدارة المخدومين ← الطلبات';

alter table public.child_join_requests enable row level security;
alter table public.child_join_requests replica identity full;

-- Who sees a request? Whoever can access its desired scope (class servant of
-- that class, service manager, church manager, owner). Requests with no scope
-- at all are for the owner / church managers.
drop policy if exists cjr_select on public.child_join_requests;
create policy cjr_select on public.child_join_requests for select to authenticated using (
  (select public.is_owner())
  or (church_id is not null and public.can_access(church_id, service_id, class_id))
);
drop policy if exists cjr_delete on public.child_join_requests;
create policy cjr_delete on public.child_join_requests for delete to authenticated using (
  (select public.is_owner())
  or (church_id is not null and public.can_access(church_id, service_id, class_id))
);
-- the password hash never leaves the database
revoke all on public.child_join_requests from anon;
revoke all on public.child_join_requests from authenticated;
grant select (id, code, name, gender, birthdate, phone, address, notes, image_url, church_id, service_id, class_id,
              status, decision_note, decided_by, decided_at, person_id, enrollment_id, created_at),
      delete on public.child_join_requests to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.child_join_requests;
exception when duplicate_object then null;
end $$;

-- Step «الكود» of the child signup: is this code known? (same exposure as
-- signup_lookup_code for servants — whoever holds the card)
create or replace function public.child_signup_lookup_code(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when nullif(trim(p_code), '') is null then null
    else jsonb_build_object(
      'exists', exists (select 1 from public.persons p where p.national_id = trim(p_code)),
      'has_password', exists (select 1 from public.persons p join public.person_credentials c on c.person_id = p.id
                               where p.national_id = trim(p_code)),
      'pending', exists (select 1 from public.child_join_requests r where r.code = trim(p_code) and r.status = 'pending'),
      'name', (select p.name from public.persons p where p.national_id = trim(p_code) limit 1)
    )
  end
$$;
grant execute on function public.child_signup_lookup_code(text) to anon, authenticated;

-- The signup itself → a PENDING request
create or replace function public.child_signup(
  p_code text,
  p_name text,
  p_password text,
  p_gender text default null,
  p_birthdate date default null,
  p_phone text default null,
  p_address text default null,
  p_notes text default null,
  p_image_url text default null,
  p_church uuid default null,
  p_service uuid default null,
  p_class uuid default null
) returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_code text := nullif(trim(coalesce(p_code, '')), '');
  v_id uuid;
begin
  if v_code is null then raise exception 'code_required' using errcode = '22023'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required' using errcode = '22023'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'weak_password' using errcode = '22023'; end if;
  if p_gender is not null and p_gender not in ('male', 'female') then raise exception 'invalid_gender' using errcode = '22023'; end if;
  if p_church is null then raise exception 'church_required' using errcode = '22023'; end if;
  if p_service is not null and not exists (select 1 from public.services s where s.id = p_service and s.church_id = p_church) then
    raise exception 'service_not_in_church' using errcode = '22023';
  end if;
  if p_class is not null and (p_service is null
      or not exists (select 1 from public.classes c where c.id = p_class and c.service_id = p_service)) then
    raise exception 'class_not_in_service' using errcode = '22023';
  end if;
  -- a code that already has a portal password = an existing account
  if exists (select 1 from public.persons p join public.person_credentials c on c.person_id = p.id where p.national_id = v_code) then
    raise exception 'already_registered' using errcode = '23505';
  end if;
  if exists (select 1 from public.child_join_requests r where r.code = v_code and r.status = 'pending') then
    raise exception 'pending_exists' using errcode = '23505';
  end if;

  insert into public.child_join_requests
    (code, name, gender, birthdate, phone, address, notes, image_url, password_hash, church_id, service_id, class_id)
  values
    (v_code, trim(p_name), p_gender, p_birthdate,
     nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_address, '')), ''),
     nullif(trim(coalesce(p_notes, '')), ''), p_image_url,
     crypt(p_password, gen_salt('bf', 10)), p_church, p_service, p_class)
  returning id into v_id;

  return jsonb_build_object('request_id', v_id, 'code', v_code);
end $$;
grant execute on function public.child_signup(text, text, text, text, date, text, text, text, text, uuid, uuid, uuid) to anon, authenticated;

-- Polling from the signup success screen: pending / approved / rejected
create or replace function public.child_signup_status(p_request uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('status', r.status, 'decision_note', r.decision_note, 'code', r.code)
    from public.child_join_requests r where r.id = p_request
$$;
grant execute on function public.child_signup_status(uuid) to anon, authenticated;

-- Pending count for the badge (scoped by RLS)
create or replace function public.pending_child_join_requests_count()
returns integer language sql stable security invoker set search_path = public as $$
  select count(*)::int from public.child_join_requests where status = 'pending'
$$;
grant execute on function public.pending_child_join_requests_count() to authenticated;

-- Approve / reject. On approval the reviewer may fix the scope (the class
-- is REQUIRED); the person is upserted by code, the enrollment created and
-- the password moved into person_credentials.
create or replace function public.review_child_join_request(
  p_request uuid,
  p_approve boolean,
  p_note text default null,
  p_church uuid default null,
  p_service uuid default null,
  p_class uuid default null
) returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  r public.child_join_requests;
  v_church uuid; v_service uuid; v_class uuid;
  v_person public.persons%rowtype;
  v_created boolean := false;
  v_enr uuid;
begin
  if public.my_role() is null then raise exception 'not_approved' using errcode = '42501'; end if;
  select * into r from public.child_join_requests where id = p_request;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then raise exception 'not_pending' using errcode = 'P0001'; end if;
  if not (public.is_owner() or (r.church_id is not null and public.can_access(r.church_id, r.service_id, r.class_id))) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not p_approve then
    update public.child_join_requests
       set status = 'rejected', decision_note = nullif(trim(coalesce(p_note, '')), ''),
           decided_by = auth.uid(), decided_at = now()
     where id = r.id;
    return jsonb_build_object('status', 'rejected');
  end if;

  v_church := coalesce(p_church, r.church_id);
  v_service := coalesce(p_service, r.service_id);
  v_class := coalesce(p_class, r.class_id);
  if v_church is null or v_service is null or v_class is null then
    raise exception 'scope_required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.classes c where c.id = v_class and c.service_id = v_service and c.church_id = v_church) then
    raise exception 'class_not_in_service' using errcode = '22023';
  end if;
  if not public.can_access(v_church, v_service, v_class) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- person (upsert by code — typed data fills the blanks)
  select * into v_person from public.persons where national_id = r.code;
  if not found then
    insert into public.persons (national_id, name, gender, birthdate, phone, address, notes, image_url, created_by, edited_by)
    values (r.code, r.name, r.gender, r.birthdate, r.phone, r.address, r.notes, r.image_url, auth.uid(), auth.uid())
    returning * into v_person;
    v_created := true;
  else
    update public.persons set
      gender    = coalesce(gender, r.gender),
      birthdate = coalesce(birthdate, r.birthdate),
      phone     = coalesce(phone, r.phone),
      address   = coalesce(address, r.address),
      notes     = coalesce(notes, r.notes),
      image_url = coalesce(image_url, r.image_url),
      edited_by = auth.uid(), edited_at = now()
    where id = v_person.id
    returning * into v_person;
  end if;

  insert into public.enrollments (person_id, church_id, service_id, class_id, created_by, edited_by)
  values (v_person.id, v_church, v_service, v_class, auth.uid(), auth.uid())
  on conflict (person_id, class_id) do nothing
  returning id into v_enr;
  if v_enr is null then
    select id into v_enr from public.enrollments where person_id = v_person.id and class_id = v_class;
  end if;

  insert into public.person_credentials (person_id, password_hash, set_by)
  values (v_person.id, r.password_hash, auth.uid())
  on conflict (person_id) do update set password_hash = excluded.password_hash, set_by = auth.uid(), updated_at = now();

  update public.child_join_requests
     set status = 'approved', decision_note = nullif(trim(coalesce(p_note, '')), ''),
         decided_by = auth.uid(), decided_at = now(),
         church_id = v_church, service_id = v_service, class_id = v_class,
         person_id = v_person.id, enrollment_id = v_enr
   where id = r.id;

  return jsonb_build_object('status', 'approved', 'person_id', v_person.id, 'person_created', v_created, 'enrollment_id', v_enr);
end $$;
revoke all on function public.review_child_join_request(uuid, boolean, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.review_child_join_request(uuid, boolean, text, uuid, uuid, uuid) to authenticated;

-- =====================================================================
-- Audience / roster helpers that enumerate a scope: children ONLY.
-- Servant mirror rows must not be counted as recipients, exam candidates,
-- birthday children, leaderboard members, …
-- =====================================================================
-- stats_summary (from 0019) — children only
create or replace function public.stats_summary(
  p_church uuid default null, p_service uuid default null, p_class uuid default null)
returns table (enrollments bigint, persons bigint, total_attendance bigint, total_points bigint)
language sql stable security invoker set search_path = public as $$
  select count(*)::bigint,
         count(distinct person_id)::bigint,
         coalesce(sum(attendance_count), 0)::bigint,
         coalesce(sum(points), 0)::bigint
    from public.enrollments
   where kind = 'child'
     and (p_church  is null or church_id  = p_church)
     and (p_service is null or service_id = p_service)
     and (p_class   is null or class_id   = p_class)
$$;

-- stats_leaderboard (from 0019) — children only
create or replace function public.stats_leaderboard(
  p_limit int default 10,
  p_church uuid default null, p_service uuid default null, p_class uuid default null)
returns table (enrollment_id uuid, person_id uuid, name text, points integer, attendance_count integer)
language sql stable security invoker set search_path = public as $$
  select e.id, e.person_id, p.name, e.points, e.attendance_count
    from public.enrollments e
    join public.persons p on p.id = e.person_id
   where e.kind = 'child'
     and (p_church  is null or e.church_id  = p_church)
     and (p_service is null or e.service_id = p_service)
     and (p_class   is null or e.class_id   = p_class)
   order by e.points desc, p.name
   limit greatest(1, least(p_limit, 100))
$$;

-- chat_audience_count (from 0029) — children only
create or replace function public.chat_audience_count(p_target text, p_church uuid, p_service uuid, p_class uuid)
returns integer language sql stable security definer set search_path = public as $$
  select case
    when not public.module_visible('messages') or not public.scope_contains(p_church, p_service, p_class) then 0
    when p_target = 'staff' then (
      select count(*)::int from public.profiles t
       where t.status = 'approved' and t.id <> auth.uid() and t.role <> 'owner'
         and (p_church  is null or t.church_id  = p_church)
         and (p_service is null or t.service_id = p_service)
         and (p_class   is null or t.class_id   = p_class))
    else (
      select count(*)::int from public.enrollments e
       where e.kind = 'child'
         and (p_church  is null or e.church_id  = p_church)
         and (p_service is null or e.service_id = p_service)
         and (p_class   is null or e.class_id   = p_class))
  end
$$;

-- online_class_live_stats (from 0030) — children only
create or replace function public.online_class_live_stats(p_class uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c   public.online_classes;
  s   record;
  v_from timestamptz; v_to timestamptz; v_span integer;
  v_rows jsonb;
  v_checks integer;
begin
  if auth.uid() is null or not public.module_visible('online') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  select * into c from public.online_classes where id = p_class;
  if not found then
    raise exception 'class_not_found' using errcode = 'P0002';
  end if;
  if not public.scope_overlaps(c.church_id, c.service_id, c.class_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  select * into v_from, v_to, v_span from public.online_class_span(c);
  select count(*) into v_checks from public.online_class_checks where class_id = c.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'participant_id', pt.id,
           'enrollment_id', pt.enrollment_id,
           'person_id', pt.person_id,
           'name', p.name,
           'image_url', p.image_url,
           'national_id', p.national_id,
           'class_name', cl.name,
           'first_joined_at', pt.first_joined_at,
           'last_seen_at', pt.last_seen_at,
           'left_at', pt.left_at,
           'online', (pt.left_at is null and pt.last_seen_at >= now() - interval '90 seconds' and c.status = 'live'),
           'sessions_count', pt.sessions_count,
           'seconds', e.o_seconds,
           'percent', e.o_percent,
           'checks_ok', pt.checks_ok,
           'checks_late', pt.checks_late,
           'checks_total', e.o_checks_total,
           'answers_count', pt.answers_count,
           'correct_count', pt.correct_count,
           'messages_count', pt.messages_count,
           'rule_present', e.o_rule_present,
           'status', e.o_status,
           'override_status', pt.override_status,
           'final_status', pt.final_status,
           'attendance_log_id', pt.attendance_log_id
         ) order by p.name), '[]'::jsonb)
    into v_rows
    from public.online_class_participants pt
    join public.persons p on p.id = pt.person_id
    join public.classes cl on cl.id = pt.room_class_id
    cross join lateral public.online_evaluate(c, pt) e
   where pt.class_id = c.id;

  return jsonb_build_object(
    'class_id', c.id,
    'status', c.status,
    'span_from', v_from, 'span_to', v_to, 'span_seconds', v_span,
    'checks_sent', v_checks,
    'server_now', now(),
    'participants', v_rows,
    'totals', jsonb_build_object(
      'entered', jsonb_array_length(v_rows),
      'online', (select count(*) from jsonb_array_elements(v_rows) r where (r->>'online')::boolean),
      'present', (select count(*) from jsonb_array_elements(v_rows) r where r->>'status' = 'present'),
      'absent',  (select count(*) from jsonb_array_elements(v_rows) r where r->>'status' = 'absent'),
      'eligible', (select count(*) from public.enrollments en
                    where en.kind = 'child' and en.church_id = c.church_id
                      and (c.service_id is null or en.service_id = c.service_id)
                      and (c.class_id is null or en.class_id = c.class_id))
    )
  );
end $$;

-- notif_audience_count (from 0034) — children only
create or replace function public.notif_audience_count(p jsonb)
returns integer language plpgsql stable security definer set search_path = public as $$
declare
  v_kind     text := coalesce(p->>'target_kind', 'class');
  v_aud      text := coalesce(p->>'audience', 'children');
  v_church   uuid := nullif(p->>'church_id', '')::uuid;
  v_service  uuid := nullif(p->>'service_id', '')::uuid;
  v_class    uuid := nullif(p->>'class_id', '')::uuid;
  v_servant  uuid := coalesce(nullif(p->>'target_servant_id', '')::uuid, auth.uid());
  v_ids      uuid[];
  s record;
begin
  if not public.module_visible('notifications') then return 0; end if;
  select * into s from public.my_scope();
  if not found then return 0; end if;
  if p ? 'enrollment_ids' and jsonb_typeof(p->'enrollment_ids') = 'array' then
    select array_agg(distinct x::uuid) into v_ids from jsonb_array_elements_text(p->'enrollment_ids') x;
  end if;

  if v_aud = 'staff' then
    if v_kind = 'all' and s.role <> 'owner' then return 0; end if;
    if v_kind <> 'all' and not public.scope_contains(v_church, v_service, v_class) then return 0; end if;
    return (select count(*)::int from public.notif_staff_in_scope(v_church, v_service, v_class) t where t <> auth.uid());
  end if;

  return (
    select count(*)::int from public.enrollments e
     where e.kind = 'child' and case v_kind
             when 'person' then e.id = any(coalesce(v_ids, '{}'))
               and public.enrollment_visible(e.church_id, e.service_id, e.class_id, s.role, s.church_id, s.service_id, s.class_id)
             when 'group'  then exists (select 1 from public.shepherd_groups g where g.enrollment_id = e.id and g.servant_id = v_servant)
               and public.enrollment_visible(e.church_id, e.service_id, e.class_id, s.role, s.church_id, s.service_id, s.class_id)
             when 'all'    then s.role = 'owner'
             else public.scope_contains(v_church, v_service, v_class)
              and (v_church  is null or e.church_id  = v_church)
              and (v_service is null or e.service_id = v_service)
              and (v_class   is null or e.class_id   = v_class)
           end);
end $$;

-- notif_materialize (from 0034) — children only
create or replace function public.notif_materialize(p_id uuid)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare
  n public.notifications;
  cnt integer := 0;
begin
  select * into n from public.notifications where id = p_id for update;
  if not found then return 0; end if;
  delete from public.notification_recipients where notification_id = n.id;

  if n.audience = 'staff' then
    insert into public.notification_recipients (notification_id, profile_id, title, body, image_url, link_url)
    select n.id, t, n.title, n.body, n.image_url, n.link_url
      from public.notif_staff_in_scope(n.church_id, n.service_id, n.class_id) t
     where t is distinct from n.created_by;
    get diagnostics cnt = row_count;
  else
    insert into public.notification_recipients (notification_id, enrollment_id, person_id, title, body, image_url, link_url)
    select n.id, e.id, e.person_id, n.title, n.body, n.image_url, n.link_url
      from public.enrollments e
     where e.kind = 'child' and case n.target_kind
             when 'person' then e.id = any(coalesce(n.enrollment_ids, '{}'))
             when 'group'  then exists (select 1 from public.shepherd_groups g where g.enrollment_id = e.id and g.servant_id = n.target_servant_id)
             else (n.church_id  is null or e.church_id  = n.church_id)
              and (n.service_id is null or e.service_id = n.service_id)
              and (n.class_id   is null or e.class_id   = n.class_id)
           end;
    get diagnostics cnt = row_count;
  end if;

  update public.notifications
     set status = case when cnt > 0 then 'sent' else 'failed' end,
         error  = case when cnt > 0 then null else 'no_recipients' end,
         sent_at = now(), recipients_count = cnt
   where id = n.id;
  return cnt;
end $$;

-- notif_fire_scope (from 0034) — children only
create or replace function public.notif_fire_scope(
  p_trigger text, p_church uuid, p_service uuid, p_class uuid, p_vars jsonb default '{}'::jsonb,
  p_default_link text default null, p_ref text default null, p_enrollment_ids uuid[] default null)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare
  a public.notification_automations;
  vars jsonb;
  n_id uuid;
  fired integer := 0;
  v_title text; v_body text; v_link text;
  v_church uuid; v_service uuid; v_class uuid;
  cnt integer;
begin
  if p_church is null then return 0; end if;
  if not exists (select 1 from public.notification_automations where trigger_key = p_trigger and is_active) then return 0; end if;
  if not public.notif_module_covers(p_church, p_service, p_class) then return 0; end if;
  vars := jsonb_build_object(
            'الكنيسة', (select name from public.churches where id = p_church),
            'الخدمة',  (select name from public.services where id = p_service),
            'الفصل',   (select name from public.classes  where id = p_class),
            'التاريخ', to_char(now() at time zone 'Africa/Cairo', 'YYYY-MM-DD'),
            'الوقت',   to_char(now() at time zone 'Africa/Cairo', 'HH24:MI'))
          || coalesce(p_vars, '{}'::jsonb);

  for a in
    select * from public.notification_automations x
     where x.trigger_key = p_trigger and x.is_active
       and (x.church_id  is null or x.church_id  = p_church)
       and (x.service_id is null or p_service is null or x.service_id = p_service)
       and (x.class_id   is null or p_class   is null or x.class_id   = p_class)
  loop
    if p_ref is not null then
      begin
        insert into public.notification_automation_runs (automation_id, ref_key) values (a.id, p_ref);
      exception when unique_violation then continue; end;
    end if;
    -- effective scope = the narrower of the event's and the automation's
    v_church  := p_church;
    v_service := coalesce(p_service, a.service_id);
    v_class   := coalesce(p_class, a.class_id);
    if v_class is not null and v_service is null then
      select service_id into v_service from public.classes where id = v_class;
    end if;

    v_title := left(public.notif_render(a.title_template, vars), 120);
    v_body  := left(public.notif_render(a.body_template, vars), 1000);
    v_link  := coalesce(public.notif_clean_link(a.link_url), public.notif_clean_link(p_default_link));
    if length(trim(v_title)) = 0 then v_title := a.name; end if;

    insert into public.notifications (church_id, service_id, class_id, title, body, image_url, link_url, target_kind, audience,
                                      enrollment_ids, status, sent_at, source, automation_id, created_by)
    values (v_church, v_service, v_class, v_title, v_body, a.image_url, v_link,
            case when p_enrollment_ids is not null then 'person' when v_class is not null then 'class' when v_service is not null then 'service' else 'church' end,
            case when a.recipient = 'class_servants' then 'staff' else 'children' end,
            p_enrollment_ids, 'sent', now(), 'automation', a.id, null)
    returning id into n_id;

    if a.recipient = 'class_servants' then
      insert into public.notification_recipients (notification_id, profile_id, title, body, image_url, link_url)
      select n_id, t, v_title, v_body, a.image_url, v_link
        from public.notif_staff_in_scope(v_church, v_service, v_class) t;
    else
      insert into public.notification_recipients (notification_id, enrollment_id, person_id, title, body, image_url, link_url)
      select n_id, e.id, e.person_id, v_title, v_body, a.image_url, v_link
        from public.enrollments e
       where e.kind = 'child' and e.church_id = v_church
         and (v_service is null or e.service_id = v_service)
         and (v_class   is null or e.class_id   = v_class)
         and (p_enrollment_ids is null or e.id = any(p_enrollment_ids));
    end if;
    select count(*) into cnt from public.notification_recipients where notification_id = n_id;
    update public.notifications set recipients_count = cnt, status = case when cnt > 0 then 'sent' else 'failed' end,
           error = case when cnt > 0 then null else 'no_recipients' end
     where id = n_id;
    fired := fired + 1;
  end loop;
  return fired;
end $$;

-- result_summary_core (from 0038) — children only
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
     where e.kind = 'child' and e.church_id = x.church_id
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

-- birthdays_in_month (from 0028) — children only
create or replace function public.birthdays_in_month(
  p_year integer, p_month integer,
  p_church uuid default null, p_service uuid default null, p_class uuid default null
)
returns table (
  enrollment_id uuid, person_id uuid,
  church_id uuid, service_id uuid, class_id uuid,
  national_id text, name text, birthdate date, gender text, phone text, address text, image_url text,
  points integer, attendance_count integer,
  birth_day integer, birth_month integer,
  turns_age integer,                      -- age he turns in p_year
  greetings jsonb,                        -- [{id, kind, created_at, points, message, recorded_by_name}] of p_year
  gift_points integer,                    -- points gifted in p_year (null = not yet)
  enrollments_count integer               -- how many visible enrollments this person has (in scope)
)
language sql stable security invoker set search_path = public as $$
  with vis as (
    -- one row per person: his first visible enrollment (narrowed by the scope)
    select distinct on (e.person_id)
           e.id as enrollment_id, e.person_id, e.church_id, e.service_id, e.class_id,
           e.points, e.attendance_count,
           count(*) over (partition by e.person_id)::int as enrollments_count
      from public.enrollments e
      join public.persons p on p.id = e.person_id
     where e.kind = 'child' and p.birthdate is not null
       and extract(month from p.birthdate)::int = p_month
       and (p_church  is null or e.church_id  = p_church)
       and (p_service is null or e.service_id = p_service)
       and (p_class   is null or e.class_id   = p_class)
     order by e.person_id, e.created_at, e.id
  )
  select v.enrollment_id, v.person_id, v.church_id, v.service_id, v.class_id,
         p.national_id, p.name, p.birthdate, p.gender::text, p.phone, p.address, p.image_url,
         v.points, v.attendance_count,
         extract(day from p.birthdate)::int, extract(month from p.birthdate)::int,
         (p_year - extract(year from p.birthdate)::int),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', g.id, 'kind', g.kind, 'created_at', g.created_at,
                    'points', g.points, 'message', g.message,
                    'recorded_by', g.recorded_by, 'recorded_by_name', pr.full_name)
                  order by g.created_at desc)
             from public.birthday_greetings g
             left join public.profiles pr on pr.id = g.recorded_by
            where g.person_id = v.person_id and g.year = p_year
         ), '[]'::jsonb),
         (select g.points from public.birthday_greetings g
           where g.person_id = v.person_id and g.year = p_year and g.kind = 'gift' limit 1),
         v.enrollments_count
    from vis v
    join public.persons p on p.id = v.person_id
   order by extract(day from p.birthdate), p.name
$$;

-- birthdays_upcoming (from 0028) — children only
create or replace function public.birthdays_upcoming(p_days integer default 7, p_today date default null)
returns table (
  enrollment_id uuid, person_id uuid, church_id uuid, service_id uuid, class_id uuid,
  name text, phone text, image_url text, birthdate date, next_birthday date, days_left integer, turns_age integer
)
language sql stable security invoker set search_path = public as $$
  with t as (
    select coalesce(p_today, (now() at time zone 'Africa/Cairo')::date) as today
  ),
  vis as (
    select distinct on (e.person_id)
           e.id as enrollment_id, e.person_id, e.church_id, e.service_id, e.class_id
      from public.enrollments e
      join public.persons p on p.id = e.person_id
     where e.kind = 'child' and p.birthdate is not null
     order by e.person_id, e.created_at, e.id
  ),
  nb as (
    select v.*, p.name, p.phone, p.image_url, p.birthdate,
           public.next_birthday(p.birthdate, t.today) as next_birthday, t.today
      from vis v
      join public.persons p on p.id = v.person_id
      cross join t
  )
  select enrollment_id, person_id, church_id, service_id, class_id,
         name, phone, image_url, birthdate, next_birthday,
         (next_birthday - today)::int as days_left,
         (extract(year from next_birthday)::int - extract(year from birthdate)::int) as turns_age
    from nb
   where next_birthday - today between 0 and greatest(p_days, 0)
   order by next_birthday, name
$$;

notify pgrst, 'reload schema';

commit;
