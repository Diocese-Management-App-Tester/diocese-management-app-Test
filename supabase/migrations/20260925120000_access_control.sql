-- =====================================================================
-- ACCESS MODULE (التحكم في الدخول) — access events · rules · allowed list · log
--
-- An ACCESS EVENT (بوابة دخول) is something a person is let INTO (a party,
-- a trip bus, a hall, a meal…). At the door the servant scans the person's
-- QR (or searches him) and the app answers **مسموح / مرفوض** with the
-- person's name, photo, points, attendance history — and EVERY rule with
-- its own fulfilled / not-fulfilled status.
--
-- Decision = ALLOWED-LIST  AND  RULE-TREE
--   * allowed list (المسموح لهم): specific persons · a class · a service ·
--     a whole church · any combination (`access_allowed`). A person who is
--     NOT covered is denied even when every rule passes. `allow_all` on the
--     event skips the list («الجميع»).
--   * rule tree: rules (`access_rules`) sit in groups (`access_rule_groups`)
--     nested under each other; every group combines its children with
--     AND / OR; the event's `root_op` combines the top level. Disabled rules
--     are ignored; a group with nothing enabled is vacuously true.
--
-- Rule kinds (params jsonb)
--   points            {op, value, value2}                          sum of points of the person's enrollments in the event's scope
--   attendance_count  {op, value, value2, from, to, event_id}      attendances (counter, or attendance_log rows when filtered)
--   attended_events   {event_ids[], mode: all|any, from, to}       attended these specific events
--   gender            {value: male|female}
--   age               {op, value, value2}                          years from birthdate
--   enrolled_in       {church_id, service_id, class_id}            has an active enrollment there
--   person_field      {field, op: present|absent|contains|equals, value}
--   exam_passed       {exam_id}                                    passed a quiz (exam_attempts.passed)
--   achievement       {achievement_id}                             earned it (user_achievements)
--   occasion          {occasion_id, statuses[]}                    registered in an occasion (default confirmed / checked_in)
--   not_entered       {period: day|ever}                           was not already granted entry to THIS access event
--   op ∈ gte · lte · eq · neq · between
--
-- Scope of the metrics: the person's ACTIVE enrollments inside the event's
-- church → service → class; when he has none there, all his active
-- enrollments (so a guest listed by person can still be measured).
--
-- Access (RLS + RPCs)
--   module_visible('access') gates everything.
--   access_can('access.check')  — every servant of a granted scope (the door)
--   access_can('access.manage') — owner / church manager / service manager,
--                                 or a class servant with the permission key
--   events are visible by scope_overlaps(); managed by can_access().
--
-- RPCs
--   access_check(event, code | person, log)  — the door: full decision payload
--   access_search_persons(q, limit)          — name / phone / code search (scoped)
--   access_permissions()                     — {check, manage}
--
-- Idempotent. Seeds ONE global module grant (like `family`).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Permission helpers
-- ---------------------------------------------------------------------
create or replace function public.access_can(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.module_visible('access')
     and (
       (select role from public.my_scope()) in ('owner', 'church_manager', 'service_manager')
       or p_key = 'access.check'
       or public.has_permission(p_key)
     )
$$;
grant execute on function public.access_can(text) to authenticated;

create or replace function public.access_permissions()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'check',  public.access_can('access.check'),
    'manage', public.access_can('access.manage')
  )
$$;
grant execute on function public.access_permissions() to authenticated;

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table if not exists public.access_events (
  id          uuid primary key default gen_random_uuid(),
  church_id   uuid not null references public.churches(id) on delete cascade,
  service_id  uuid references public.services(id) on delete cascade,   -- null = whole church
  class_id    uuid references public.classes(id)  on delete cascade,   -- null = whole service
  name        text not null,
  description text,
  is_active   boolean not null default true,
  allow_all   boolean not null default false,                          -- true = skip the allowed list
  root_op     text not null default 'and' check (root_op in ('and', 'or')),
  starts_at   timestamptz,
  ends_at     timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.servant_enrollments(id) on delete set null,
  edited_at   timestamptz not null default now(),
  edited_by   uuid references public.servant_enrollments(id) on delete set null,
  constraint access_events_name_chk check (length(trim(name)) between 1 and 120),
  constraint access_events_class_needs_service check (class_id is null or service_id is not null)
);
comment on table public.access_events is
  'بوابات الدخول — مناسبة يُتحكم في الدخول إليها بقواعد وقائمة مسموح لهم. root_op = ربط قواعد المستوى الأعلى (and/or)';

create table if not exists public.access_rule_groups (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.access_events(id) on delete cascade,
  parent_id   uuid references public.access_rule_groups(id) on delete cascade,  -- null = under the root
  name        text,
  op          text not null default 'and' check (op in ('and', 'or')),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);
comment on table public.access_rule_groups is
  'مجموعات القواعد — تجمع قواعد (ومجموعات فرعية) بـ AND أو OR داخل بوابة الدخول';

create table if not exists public.access_rules (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.access_events(id) on delete cascade,
  group_id    uuid references public.access_rule_groups(id) on delete cascade,  -- null = root level
  name        text not null,
  kind        text not null check (kind in (
                'points', 'attendance_count', 'attended_events', 'gender', 'age', 'enrolled_in',
                'person_field', 'exam_passed', 'achievement', 'occasion', 'not_entered')),
  params      jsonb not null default '{}'::jsonb,
  enabled     boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.servant_enrollments(id) on delete set null,
  edited_at   timestamptz not null default now(),
  edited_by   uuid references public.servant_enrollments(id) on delete set null,
  constraint access_rules_name_chk check (length(trim(name)) between 1 and 160),
  constraint access_rules_params_obj check (jsonb_typeof(params) = 'object')
);
comment on table public.access_rules is
  'قواعد الدخول — شرط واحد (نقاط · حضور · مناسبات · نوع · عمر · تسجيل · بيانات · امتحان · إنجاز · فعالية · لم يدخل بعد) بمعاملاته';

create table if not exists public.access_allowed (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.access_events(id) on delete cascade,
  person_id   uuid references public.persons(id) on delete cascade,
  church_id   uuid references public.churches(id) on delete cascade,
  service_id  uuid references public.services(id) on delete cascade,
  class_id    uuid references public.classes(id)  on delete cascade,
  note        text,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.servant_enrollments(id) on delete set null,
  constraint access_allowed_target check (
    (person_id is not null and church_id is null and service_id is null and class_id is null)
    or (person_id is null and church_id is not null)
  ),
  constraint access_allowed_class_needs_service check (class_id is null or service_id is not null)
);
comment on table public.access_allowed is
  'المسموح لهم — شخص محدد، أو فصل / خدمة / كنيسة كاملة (service/class فارغة = المستوى كله)';
create unique index if not exists uq_access_allowed_person on public.access_allowed(event_id, person_id) where person_id is not null;
create unique index if not exists uq_access_allowed_scope on public.access_allowed(
  event_id, church_id, coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(class_id, '00000000-0000-0000-0000-000000000000'::uuid)
) where person_id is null;

create table if not exists public.access_log (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.access_events(id) on delete cascade,
  person_id   uuid references public.persons(id) on delete set null,
  code        text,
  granted     boolean not null,
  allowed     boolean not null,
  rules_ok    boolean not null,
  reason      text,
  details     jsonb,
  checked_by  uuid references public.servant_enrollments(id) on delete set null,
  checked_on  date not null default ((now() at time zone 'Africa/Cairo')::date),
  created_at  timestamptz not null default now()
);
comment on table public.access_log is 'سجل الدخول — كل عملية تحقق عند البوابة بنتيجتها وتفاصيل القواعد';

create index if not exists idx_access_events_scope   on public.access_events(church_id, service_id, class_id);
create index if not exists idx_access_groups_event   on public.access_rule_groups(event_id, parent_id, sort_order);
create index if not exists idx_access_rules_event    on public.access_rules(event_id, group_id, sort_order);
create index if not exists idx_access_allowed_event  on public.access_allowed(event_id);
create index if not exists idx_access_allowed_person on public.access_allowed(person_id) where person_id is not null;
create index if not exists idx_access_log_event      on public.access_log(event_id, created_at desc);
create index if not exists idx_access_log_person     on public.access_log(person_id, event_id, checked_on);

-- audit triggers
create or replace function public.access_fill_audit()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.created_by is null then new.created_by := auth.uid(); end if;
    if new.edited_by is null then new.edited_by := auth.uid(); end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_access_events_audit on public.access_events;
create trigger trg_access_events_audit before insert on public.access_events
for each row execute function public.access_fill_audit();
drop trigger if exists trg_access_events_touch on public.access_events;
create trigger trg_access_events_touch before update on public.access_events
for each row execute function public.touch_edited();
drop trigger if exists trg_access_rules_audit on public.access_rules;
create trigger trg_access_rules_audit before insert on public.access_rules
for each row execute function public.access_fill_audit();
drop trigger if exists trg_access_rules_touch on public.access_rules;
create trigger trg_access_rules_touch before update on public.access_rules
for each row execute function public.touch_edited();

-- a group / rule must belong to the same event as its parent group
create or replace function public.access_check_group_parent()
returns trigger language plpgsql set search_path = public as $$
declare v_event uuid;
begin
  if tg_table_name = 'access_rule_groups' then
    if new.parent_id is not null then
      if new.parent_id = new.id then raise exception 'group_self_parent' using errcode = '23514'; end if;
      select event_id into v_event from public.access_rule_groups where id = new.parent_id;
      if v_event is distinct from new.event_id then raise exception 'group_parent_other_event' using errcode = '23514'; end if;
    end if;
  else
    if new.group_id is not null then
      select event_id into v_event from public.access_rule_groups where id = new.group_id;
      if v_event is distinct from new.event_id then raise exception 'rule_group_other_event' using errcode = '23514'; end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_access_groups_parent on public.access_rule_groups;
create trigger trg_access_groups_parent before insert or update on public.access_rule_groups
for each row execute function public.access_check_group_parent();
drop trigger if exists trg_access_rules_group on public.access_rules;
create trigger trg_access_rules_group before insert or update on public.access_rules
for each row execute function public.access_check_group_parent();

-- ---------------------------------------------------------------------
-- 2. Visibility helpers + RLS
-- ---------------------------------------------------------------------
create or replace function public.access_event_visible(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.access_events e
     where e.id = p_event and public.scope_overlaps(e.church_id, e.service_id, e.class_id)
  )
$$;
grant execute on function public.access_event_visible(uuid) to authenticated;

create or replace function public.access_event_manageable(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.access_can('access.manage') and exists (
    select 1 from public.access_events e
     where e.id = p_event and public.can_access(e.church_id, e.service_id, e.class_id)
  )
$$;
grant execute on function public.access_event_manageable(uuid) to authenticated;

alter table public.access_events      enable row level security;
alter table public.access_rule_groups enable row level security;
alter table public.access_rules       enable row level security;
alter table public.access_allowed     enable row level security;
alter table public.access_log         enable row level security;

drop policy if exists access_events_select on public.access_events;
create policy access_events_select on public.access_events for select using (
  (select public.access_can('access.check')) and public.scope_overlaps(church_id, service_id, class_id)
);
drop policy if exists access_events_insert on public.access_events;
create policy access_events_insert on public.access_events for insert with check (
  (select public.access_can('access.manage')) and public.can_access(church_id, service_id, class_id)
);
drop policy if exists access_events_update on public.access_events;
create policy access_events_update on public.access_events for update using (
  (select public.access_can('access.manage')) and public.can_access(church_id, service_id, class_id)
) with check (
  (select public.access_can('access.manage')) and public.can_access(church_id, service_id, class_id)
);
drop policy if exists access_events_delete on public.access_events;
create policy access_events_delete on public.access_events for delete using (
  (select public.access_can('access.manage')) and public.can_access(church_id, service_id, class_id)
);

-- child tables: readable when the event is visible, writable when manageable
do $$
declare t text;
begin
  foreach t in array array['access_rule_groups', 'access_rules', 'access_allowed'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select using ((select public.access_can(''access.check'')) and public.access_event_visible(event_id))', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('create policy %1$s_insert on public.%1$s for insert with check (public.access_event_manageable(event_id))', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('create policy %1$s_update on public.%1$s for update using (public.access_event_manageable(event_id)) with check (public.access_event_manageable(event_id))', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format('create policy %1$s_delete on public.%1$s for delete using (public.access_event_manageable(event_id))', t);
  end loop;
end $$;

drop policy if exists access_log_select on public.access_log;
create policy access_log_select on public.access_log for select using (
  (select public.access_can('access.check')) and public.access_event_visible(event_id)
);
drop policy if exists access_log_delete on public.access_log;
create policy access_log_delete on public.access_log for delete using (
  public.access_event_manageable(event_id)
);
-- inserts happen only through access_check() (security definer)

-- ---------------------------------------------------------------------
-- 3. Rule engine
-- ---------------------------------------------------------------------
create or replace function public.access_cmp(p_actual numeric, p_op text, p_v1 numeric, p_v2 numeric)
returns boolean language sql immutable as $$
  select case
    when p_actual is null then false
    when p_op = 'gte' then p_actual >= coalesce(p_v1, 0)
    when p_op = 'lte' then p_actual <= coalesce(p_v1, 0)
    when p_op = 'eq'  then p_actual =  coalesce(p_v1, 0)
    when p_op = 'neq' then p_actual <> coalesce(p_v1, 0)
    when p_op = 'between' then p_actual >= coalesce(p_v1, 0) and p_actual <= coalesce(p_v2, p_v1, 0)
    else p_actual >= coalesce(p_v1, 0)
  end
$$;

-- forgiving parsers (bad input = null, never an exception)
create or replace function public.access_num(p text)
returns numeric language plpgsql immutable as $$
begin
  return nullif(trim(coalesce(p, '')), '')::numeric;
exception when others then return null;
end $$;
create or replace function public.access_date(p text)
returns date language plpgsql immutable as $$
begin
  return nullif(trim(coalesce(p, '')), '')::date;
exception when others then return null;
end $$;

-- Evaluate ONE rule for a person. Returns {fulfilled, actual}.
create or replace function public.access_eval_rule(
  p_rule   public.access_rules,
  p_person public.persons,
  p_enr    uuid[],
  p_event  public.access_events
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  pr      jsonb := coalesce(p_rule.params, '{}'::jsonb);
  v_op    text := coalesce(pr ->> 'op', 'gte');
  v_v1    numeric;
  v_v2    numeric;
  v_from  date;
  v_to    date;
  v_num   numeric;
  v_ok    boolean := false;
  v_actual jsonb := 'null'::jsonb;
  v_ids   uuid[];
  v_hit   int;
  v_txt   text;
begin
  -- numeric / date params are parsed only for the kinds that use them
  -- (`value` is a text for gender / person_field)
  if p_rule.kind in ('points', 'attendance_count', 'age') then
    v_v1 := public.access_num(pr ->> 'value');
    v_v2 := public.access_num(pr ->> 'value2');
  end if;
  if p_rule.kind in ('attendance_count', 'attended_events') then
    v_from := public.access_date(pr ->> 'from');
    v_to   := public.access_date(pr ->> 'to');
  end if;

  case p_rule.kind
    when 'points' then
      select coalesce(sum(e.points), 0) into v_num from public.enrollments e where e.id = any(p_enr);
      v_ok := public.access_cmp(v_num, v_op, v_v1, v_v2);
      v_actual := to_jsonb(v_num);

    when 'attendance_count' then
      if v_from is null and v_to is null and nullif(pr ->> 'event_id', '') is null then
        select coalesce(sum(e.attendance_count), 0) into v_num from public.enrollments e where e.id = any(p_enr);
      else
        select count(*) into v_num
          from public.attendance_log a
         where a.enrollment_id = any(p_enr)
           and (v_from is null or a.attended_on >= v_from)
           and (v_to is null or a.attended_on <= v_to)
           and (nullif(pr ->> 'event_id', '') is null or a.event_id = (pr ->> 'event_id')::uuid);
      end if;
      v_ok := public.access_cmp(v_num, v_op, v_v1, v_v2);
      v_actual := to_jsonb(v_num);

    when 'attended_events' then
      select coalesce(array_agg(x::uuid), '{}') into v_ids from jsonb_array_elements_text(coalesce(pr -> 'event_ids', '[]'::jsonb)) x;
      select count(distinct a.event_id) into v_hit
        from public.attendance_log a
       where a.enrollment_id = any(p_enr)
         and a.event_id = any(v_ids)
         and (v_from is null or a.attended_on >= v_from)
         and (v_to is null or a.attended_on <= v_to);
      v_ok := case when coalesce(array_length(v_ids, 1), 0) = 0 then true
                   when coalesce(pr ->> 'mode', 'all') = 'any' then v_hit >= 1
                   else v_hit >= array_length(v_ids, 1) end;
      v_actual := jsonb_build_object('hit', v_hit, 'of', coalesce(array_length(v_ids, 1), 0), 'event_ids', coalesce((
        select jsonb_agg(distinct a.event_id) from public.attendance_log a
         where a.enrollment_id = any(p_enr) and a.event_id = any(v_ids)
           and (v_from is null or a.attended_on >= v_from) and (v_to is null or a.attended_on <= v_to)), '[]'::jsonb));

    when 'gender' then
      v_ok := p_person.gender is not null and p_person.gender::text = (pr ->> 'value');
      v_actual := to_jsonb(p_person.gender::text);

    when 'age' then
      if p_person.birthdate is null then
        v_ok := false; v_actual := 'null'::jsonb;
      else
        v_num := extract(year from age(current_date, p_person.birthdate));
        v_ok := public.access_cmp(v_num, v_op, v_v1, v_v2);
        v_actual := to_jsonb(v_num);
      end if;

    when 'enrolled_in' then
      select count(*) into v_hit
        from public.enrollments e
       where e.person_id = p_person.id
         and coalesce(e.status::text, 'active') = 'active'
         and (nullif(pr ->> 'church_id', '') is null or e.church_id = (pr ->> 'church_id')::uuid)
         and (nullif(pr ->> 'service_id', '') is null or e.service_id = (pr ->> 'service_id')::uuid)
         and (nullif(pr ->> 'class_id', '') is null or e.class_id = (pr ->> 'class_id')::uuid);
      v_ok := v_hit > 0;
      v_actual := to_jsonb(v_hit > 0);

    when 'person_field' then
      v_txt := case pr ->> 'field'
        when 'phone' then p_person.phone
        when 'address' then p_person.address
        when 'notes' then p_person.notes
        when 'image_url' then p_person.image_url
        when 'birthdate' then p_person.birthdate::text
        when 'name' then p_person.name
        when 'national_id' then p_person.national_id
        else null end;
      v_ok := case coalesce(pr ->> 'op', 'present')
        when 'present'  then nullif(trim(coalesce(v_txt, '')), '') is not null
        when 'absent'   then nullif(trim(coalesce(v_txt, '')), '') is null
        when 'contains' then coalesce(v_txt, '') ilike '%' || coalesce(pr ->> 'value', '') || '%'
        when 'equals'   then trim(coalesce(v_txt, '')) = trim(coalesce(pr ->> 'value', ''))
        else false end;
      v_actual := to_jsonb(case when pr ->> 'field' in ('image_url') then (case when v_txt is null then null else 'موجودة' end) else v_txt end);

    when 'exam_passed' then
      v_ok := nullif(pr ->> 'exam_id', '') is not null and exists (
        select 1 from public.exam_attempts a
         where a.person_id = p_person.id and a.exam_id = (pr ->> 'exam_id')::uuid
           and a.status = 'submitted' and a.passed = true);
      v_actual := to_jsonb(v_ok);

    when 'achievement' then
      v_ok := nullif(pr ->> 'achievement_id', '') is not null and exists (
        select 1 from public.user_achievements u
         where u.person_id = p_person.id and u.achievement_id = (pr ->> 'achievement_id')::uuid);
      v_actual := to_jsonb(v_ok);

    when 'occasion' then
      v_ok := nullif(pr ->> 'occasion_id', '') is not null and exists (
        select 1 from public.occasion_registrations r
         where r.person_id = p_person.id and r.occasion_id = (pr ->> 'occasion_id')::uuid
           and r.status = any (coalesce(
             (select array_agg(x) from jsonb_array_elements_text(pr -> 'statuses') x),
             array['confirmed', 'checked_in'])));
      v_actual := to_jsonb(v_ok);

    when 'not_entered' then
      select count(*) into v_hit
        from public.access_log l
       where l.event_id = p_event.id and l.person_id = p_person.id and l.granted
         and (coalesce(pr ->> 'period', 'day') <> 'day' or l.checked_on = (now() at time zone 'Africa/Cairo')::date);
      v_ok := v_hit = 0;
      v_actual := to_jsonb(v_hit);

    else
      v_ok := false;
      v_actual := 'null'::jsonb;
  end case;

  return jsonb_build_object('fulfilled', v_ok, 'actual', v_actual);
exception when others then
  return jsonb_build_object('fulfilled', false, 'actual', 'null'::jsonb, 'error', sqlerrm);
end $$;
revoke all on function public.access_eval_rule(public.access_rules, public.persons, uuid[], public.access_events) from public, anon, authenticated;

-- Evaluate a GROUP (null = root) recursively.
-- Returns {ok, empty, rules: [...], groups: [...]} — rules / groups are FLAT
-- lists of every descendant so the UI can render the tree from parent ids.
create or replace function public.access_eval_group(
  p_event  public.access_events,
  p_group  uuid,
  p_op     text,
  p_person public.persons,
  p_enr    uuid[]
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r       public.access_rules;
  g       public.access_rule_groups;
  res     jsonb;
  sub     jsonb;
  rules   jsonb := '[]'::jsonb;
  groups  jsonb := '[]'::jsonb;
  n_children int := 0;
  n_true  int := 0;
  v_ok    boolean;
begin
  for r in
    select * from public.access_rules x
     where x.event_id = p_event.id and x.group_id is not distinct from p_group
     order by x.sort_order, x.created_at
  loop
    if r.enabled then
      res := public.access_eval_rule(r, p_person, p_enr, p_event);
      n_children := n_children + 1;
      if (res ->> 'fulfilled')::boolean then n_true := n_true + 1; end if;
      rules := rules || jsonb_build_object(
        'id', r.id, 'group_id', r.group_id, 'name', r.name, 'kind', r.kind, 'params', r.params,
        'enabled', true, 'sort_order', r.sort_order,
        'fulfilled', (res ->> 'fulfilled')::boolean, 'actual', res -> 'actual', 'error', res ->> 'error');
    else
      rules := rules || jsonb_build_object(
        'id', r.id, 'group_id', r.group_id, 'name', r.name, 'kind', r.kind, 'params', r.params,
        'enabled', false, 'sort_order', r.sort_order, 'fulfilled', null, 'actual', null);
    end if;
  end loop;

  for g in
    select * from public.access_rule_groups x
     where x.event_id = p_event.id and x.parent_id is not distinct from p_group
     order by x.sort_order, x.created_at
  loop
    sub := public.access_eval_group(p_event, g.id, g.op, p_person, p_enr);
    if not (sub ->> 'empty')::boolean then
      n_children := n_children + 1;
      if (sub ->> 'ok')::boolean then n_true := n_true + 1; end if;
    end if;
    groups := groups || jsonb_build_object(
      'id', g.id, 'parent_id', g.parent_id, 'name', g.name, 'op', g.op, 'sort_order', g.sort_order,
      'ok', (sub ->> 'ok')::boolean, 'empty', (sub ->> 'empty')::boolean);
    groups := groups || (sub -> 'groups');
    rules := rules || (sub -> 'rules');
  end loop;

  v_ok := case when n_children = 0 then true
               when p_op = 'or' then n_true > 0
               else n_true = n_children end;
  return jsonb_build_object('ok', v_ok, 'empty', n_children = 0, 'rules', rules, 'groups', groups);
end $$;
revoke all on function public.access_eval_group(public.access_events, uuid, text, public.persons, uuid[]) from public, anon, authenticated;

-- Which allowed entries cover this person? → jsonb array (empty = none)
create or replace function public.access_allowed_matches(p_event uuid, p_person uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'person_id', a.person_id, 'church_id', a.church_id, 'service_id', a.service_id, 'class_id', a.class_id)), '[]'::jsonb)
    from public.access_allowed a
   where a.event_id = p_event
     and (
       a.person_id = p_person
       or (a.person_id is null and exists (
         select 1 from public.enrollments e
          where e.person_id = p_person
            and coalesce(e.status::text, 'active') = 'active'
            and e.church_id = a.church_id
            and (a.service_id is null or e.service_id = a.service_id)
            and (a.class_id is null or e.class_id = a.class_id)))
     )
$$;
revoke all on function public.access_allowed_matches(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. RPC — access_check(event, code | person, log)
-- ---------------------------------------------------------------------
create or replace function public.access_check(
  p_event  uuid,
  p_code   text default null,
  p_person uuid default null,
  p_log    boolean default true
) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  ev        public.access_events%rowtype;
  p         public.persons%rowtype;
  v_code    text := nullif(trim(coalesce(p_code, '')), '');
  v_found   boolean := false;
  v_enr     uuid[];
  v_in_scope boolean := true;
  v_allowed_by jsonb;
  v_allowed boolean;
  v_tree    jsonb;
  v_rules_ok boolean;
  v_granted boolean;
  v_reason  text;
  v_log_id  uuid;
  v_enrollments jsonb;
  v_history jsonb;
  v_visits  jsonb;
  v_summary jsonb;
  v_today   date := (now() at time zone 'Africa/Cairo')::date;
begin
  if not public.access_can('access.check') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into ev from public.access_events e where e.id = p_event;
  if not found or not public.scope_overlaps(ev.church_id, ev.service_id, ev.class_id) then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;

  if p_person is not null then
    select * into p from public.persons x where x.id = p_person;
    v_found := found;
  elsif v_code is not null then
    select * into p from public.persons x where x.national_id = v_code;
    v_found := found;
  end if;

  if not v_found then
    if p_log and v_code is not null then
      insert into public.access_log (event_id, person_id, code, granted, allowed, rules_ok, reason, checked_by)
      values (ev.id, null, v_code, false, false, false, 'not_found', auth.uid())
      returning id into v_log_id;
    end if;
    return jsonb_build_object(
      'event', to_jsonb(ev), 'matched', false, 'person', null, 'code', v_code,
      'granted', false, 'allowed', false, 'reason', 'not_found', 'log_id', v_log_id);
  end if;

  -- metrics scope: active enrollments inside the event's scope, else all active
  select coalesce(array_agg(e.id), '{}') into v_enr
    from public.enrollments e
   where e.person_id = p.id and coalesce(e.status::text, 'active') = 'active'
     and e.church_id = ev.church_id
     and (ev.service_id is null or e.service_id = ev.service_id)
     and (ev.class_id is null or e.class_id = ev.class_id);
  if coalesce(array_length(v_enr, 1), 0) = 0 then
    v_in_scope := false;
    select coalesce(array_agg(e.id), '{}') into v_enr
      from public.enrollments e
     where e.person_id = p.id and coalesce(e.status::text, 'active') = 'active';
  end if;

  -- allowed list
  if ev.allow_all then
    v_allowed := true; v_allowed_by := '[]'::jsonb;
  else
    v_allowed_by := public.access_allowed_matches(ev.id, p.id);
    v_allowed := jsonb_array_length(v_allowed_by) > 0;
  end if;

  -- rules
  v_tree := public.access_eval_group(ev, null, ev.root_op, p, v_enr);
  v_rules_ok := (v_tree ->> 'ok')::boolean;

  v_granted := ev.is_active and v_allowed and v_rules_ok;
  v_reason := case
    when not ev.is_active then 'inactive'
    when not v_allowed then 'not_allowed'
    when not v_rules_ok then 'rules'
    else null end;

  -- person context for the door screen
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'church_id', e.church_id, 'service_id', e.service_id, 'class_id', e.class_id,
           'church_name', c.name, 'service_name', s.name, 'class_name', k.name,
           'points', e.points, 'attendance_count', e.attendance_count, 'status', coalesce(e.status::text, 'active'),
           'kind', coalesce(e.kind::text, 'child'), 'in_scope', e.id = any(v_enr))
           order by (e.id = any(v_enr)) desc, e.created_at), '[]'::jsonb)
    into v_enrollments
    from public.enrollments e
    left join public.churches c on c.id = e.church_id
    left join public.services s on s.id = e.service_id
    left join public.classes  k on k.id = e.class_id
   where e.person_id = p.id;

  select coalesce(jsonb_agg(x order by x -> 'created_at' desc), '[]'::jsonb) into v_history
    from (
      select jsonb_build_object(
               'id', a.id, 'attended_on', a.attended_on, 'created_at', a.created_at,
               'event_id', a.event_id, 'event_name', evn.name, 'points_delta', a.points_delta,
               'service_name', s.name, 'class_name', k.name) as x
        from public.attendance_log a
        join public.enrollments e on e.id = a.enrollment_id
        left join public.events evn on evn.id = a.event_id
        left join public.services s on s.id = e.service_id
        left join public.classes  k on k.id = e.class_id
       where e.person_id = p.id
       order by a.created_at desc
       limit 12
    ) h;

  select coalesce(jsonb_agg(x order by x -> 'created_at' desc), '[]'::jsonb) into v_visits
    from (
      select jsonb_build_object('id', l.id, 'created_at', l.created_at, 'granted', l.granted, 'reason', l.reason,
                                'checked_by_name', se.full_name) as x
        from public.access_log l
        left join public.servant_enrollments se on se.id = l.checked_by
       where l.event_id = ev.id and l.person_id = p.id
       order by l.created_at desc
       limit 6
    ) v;

  select jsonb_build_object(
           'points', coalesce((select sum(e.points) from public.enrollments e where e.id = any(v_enr)), 0),
           'attendance_count', coalesce((select sum(e.attendance_count) from public.enrollments e where e.id = any(v_enr)), 0),
           'last_attended_on', (select max(a.attended_on) from public.attendance_log a where a.enrollment_id = any(v_enr)),
           'attended_today', exists (select 1 from public.attendance_log a where a.enrollment_id = any(v_enr) and a.attended_on = v_today),
           'entered_today', (select count(*) from public.access_log l where l.event_id = ev.id and l.person_id = p.id and l.granted and l.checked_on = v_today),
           'entered_total', (select count(*) from public.access_log l where l.event_id = ev.id and l.person_id = p.id and l.granted),
           'in_scope', v_in_scope,
           'scope_enrollments', coalesce(array_length(v_enr, 1), 0))
    into v_summary;

  if p_log then
    insert into public.access_log (event_id, person_id, code, granted, allowed, rules_ok, reason, details, checked_by)
    values (ev.id, p.id, coalesce(v_code, p.national_id), v_granted, v_allowed, v_rules_ok, v_reason,
            jsonb_build_object('rules', v_tree -> 'rules', 'groups', v_tree -> 'groups', 'allowed_by', v_allowed_by), auth.uid())
    returning id into v_log_id;
  end if;

  return jsonb_build_object(
    'event', to_jsonb(ev),
    'matched', true,
    'person', to_jsonb(p),
    'code', coalesce(v_code, p.national_id),
    'enrollments', v_enrollments,
    'summary', v_summary,
    'history', v_history,
    'visits', v_visits,
    'allowed', v_allowed,
    'allowed_by', v_allowed_by,
    'rules', jsonb_build_object('ok', v_rules_ok, 'empty', (v_tree ->> 'empty')::boolean, 'root_op', ev.root_op,
                                'rules', v_tree -> 'rules', 'groups', v_tree -> 'groups'),
    'granted', v_granted,
    'reason', v_reason,
    'log_id', v_log_id
  );
end $$;
revoke all on function public.access_check(uuid, text, uuid, boolean) from public, anon;
grant execute on function public.access_check(uuid, text, uuid, boolean) to authenticated;
comment on function public.access_check(uuid, text, uuid, boolean) is
  'البوابة: كود شخص (أو معرّفه) + بوابة دخول → مسموح / مرفوض مع كل قاعدة وحالتها، وبيانات الشخص وحضوره؛ p_log = تسجيل المحاولة';

-- ---------------------------------------------------------------------
-- 5. RPC — access_search_persons(q, limit)
-- ---------------------------------------------------------------------
create or replace function public.access_search_persons(p_query text, p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_q     text := nullif(trim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_out   jsonb;
begin
  if not public.access_can('access.check') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_q is null or length(v_q) < 2 then
    return '[]'::jsonb;
  end if;
  with hits as (
    select p.*
      from public.persons p
     where (p.name ilike '%' || v_q || '%' or p.phone ilike '%' || v_q || '%' or p.national_id ilike '%' || v_q || '%')
       and (
         public.is_owner()
         or exists (select 1 from public.enrollments e
                     where e.person_id = p.id and public.can_access(e.church_id, e.service_id, e.class_id))
       )
     order by (p.national_id = v_q) desc, p.name collate "C"
     limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'person', to_jsonb(h),
           'places', coalesce((
             select jsonb_agg(jsonb_build_object('church_id', e.church_id, 'service_id', e.service_id, 'class_id', e.class_id,
                                                 'points', e.points, 'attendance_count', e.attendance_count) order by e.created_at)
               from public.enrollments e
              where e.person_id = h.id and public.can_access(e.church_id, e.service_id, e.class_id)), '[]'::jsonb)
         ) order by (h.national_id = v_q) desc, h.name collate "C"), '[]'::jsonb)
    into v_out
    from hits h;
  return v_out;
end $$;
revoke all on function public.access_search_persons(text, integer) from public, anon;
grant execute on function public.access_search_persons(text, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Module grant seed · realtime · activity log
-- ---------------------------------------------------------------------
insert into public.module_access (module_key, church_id, service_id, class_id)
select 'access', null, null, null
where not exists (select 1 from public.module_access where module_key = 'access');

do $$
declare t text;
begin
  foreach t in array array['access_events', 'access_rule_groups', 'access_rules', 'access_allowed', 'access_log'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception when undefined_object then null;
end $$;

do $$ begin
  if to_regprocedure('public.activity_audit_attach(text)') is not null then
    perform public.activity_audit_attach('access_events');
    perform public.activity_audit_attach('access_rule_groups');
    perform public.activity_audit_attach('access_rules');
    perform public.activity_audit_attach('access_allowed');
    perform public.activity_audit_attach('access_log');
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
    'backup_runs', 'backup_schedules', 'report_templates', 'families', 'family_members',
    'access_events', 'access_rule_groups', 'access_rules', 'access_allowed', 'access_log'
  ]
$$;

commit;
