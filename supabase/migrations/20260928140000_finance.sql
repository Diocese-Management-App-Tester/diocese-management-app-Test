-- =====================================================================
-- FINANCE MODULE (الخزينة — الإيرادات والمصروفات)
--
-- The simplest possible money book for a church / service / class:
--   * an ENTRY (finance_entries) = kind (income | expense) + amount + a
--     CAUSE + optional note, on a day, inside a scope.
--   * a CAUSE (finance_causes) is either
--       - a STATIC cause created once for the scope (e.g. عشور · تبرعات ·
--         رحلة · مطبوعات), reused from a list, or
--       - a FREE-TEXT cause typed for one entry («أخرى» in the form →
--         `cause_text` on the entry, `cause_id` = null).
--     Causes are typed per kind (income / expense / both).
--   * summaries: the balance we have now (Σ income − Σ expense), and how
--     much came in / went out per day / month / year, per cause — served
--     by ONE RPC `finance_summary(scope, from, to, bucket)`.
--
-- Access (RLS + RPCs)
--   module_visible('finance') gates everything.
--   finance_can('finance.view')   — every servant of a granted scope sees
--                                   the entries / causes of scopes that
--                                   overlap his.
--   finance_can('finance.add')    — add entries (class servants need the key;
--                                   managers hold it)
--   finance_can('finance.manage') — edit / delete entries, manage causes
--   A row is visible by scope_overlaps(); written by can_access().
--
-- Idempotent. Seeds ONE global module grant (like `family` / `access`).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Permission helpers
-- ---------------------------------------------------------------------
create or replace function public.finance_can(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.module_visible('finance')
     and (
       (select role from public.my_scope()) in ('owner', 'church_manager', 'service_manager')
       or p_key = 'finance.view'
       or public.has_permission(p_key)
     )
$$;
grant execute on function public.finance_can(text) to authenticated;

create or replace function public.finance_permissions()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'view',   public.finance_can('finance.view'),
    'add',    public.finance_can('finance.add'),
    'manage', public.finance_can('finance.manage')
  )
$$;
grant execute on function public.finance_permissions() to authenticated;

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table if not exists public.finance_causes (
  id          uuid primary key default gen_random_uuid(),
  church_id   uuid not null references public.churches(id) on delete cascade,
  service_id  uuid references public.services(id) on delete cascade,   -- null = whole church
  class_id    uuid references public.classes(id)  on delete cascade,   -- null = whole service
  name        text not null,
  kind        text not null default 'both' check (kind in ('income', 'expense', 'both')),
  color       text,
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.servant_enrollments(id) on delete set null,
  edited_at   timestamptz not null default now(),
  edited_by   uuid references public.servant_enrollments(id) on delete set null,
  constraint finance_causes_name_chk check (length(trim(name)) between 1 and 80),
  constraint finance_causes_class_needs_service check (class_id is null or service_id is not null)
);
comment on table public.finance_causes is
  'أسباب الخزينة الثابتة — سبب إيراد أو مصروف (أو كليهما) يُنشأ مرة ويُختار من قائمة عند التسجيل';
create unique index if not exists uq_finance_causes_scope_name on public.finance_causes(
  church_id,
  coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(class_id,   '00000000-0000-0000-0000-000000000000'::uuid),
  lower(trim(name))
);

create table if not exists public.finance_entries (
  id          uuid primary key default gen_random_uuid(),
  church_id   uuid not null references public.churches(id) on delete cascade,
  service_id  uuid references public.services(id) on delete cascade,
  class_id    uuid references public.classes(id)  on delete cascade,
  kind        text not null check (kind in ('income', 'expense')),
  amount      numeric(14, 2) not null check (amount > 0),
  cause_id    uuid references public.finance_causes(id) on delete set null,
  cause_text  text,                                                    -- free-text cause («أخرى»)
  note        text,
  entry_date  date not null default ((now() at time zone 'Africa/Cairo')::date),
  created_at  timestamptz not null default now(),
  created_by  uuid references public.servant_enrollments(id) on delete set null,
  edited_at   timestamptz not null default now(),
  edited_by   uuid references public.servant_enrollments(id) on delete set null,
  constraint finance_entries_cause_chk check (cause_id is not null or length(trim(coalesce(cause_text, ''))) between 1 and 160),
  constraint finance_entries_class_needs_service check (class_id is null or service_id is not null)
);
comment on table public.finance_entries is
  'قيود الخزينة — إيراد أو مصروف بمبلغ وسبب (ثابت cause_id أو مكتوب cause_text) في يوم داخل نطاق';

create index if not exists idx_finance_causes_scope  on public.finance_causes(church_id, service_id, class_id, kind, sort_order);
create index if not exists idx_finance_entries_scope on public.finance_entries(church_id, service_id, class_id, entry_date desc);
create index if not exists idx_finance_entries_date  on public.finance_entries(entry_date desc, created_at desc);
create index if not exists idx_finance_entries_cause on public.finance_entries(cause_id) where cause_id is not null;

-- audit
create or replace function public.finance_fill_audit()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.created_by is null then new.created_by := auth.uid(); end if;
    if new.edited_by is null then new.edited_by := auth.uid(); end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_finance_causes_audit on public.finance_causes;
create trigger trg_finance_causes_audit before insert on public.finance_causes
for each row execute function public.finance_fill_audit();
drop trigger if exists trg_finance_causes_touch on public.finance_causes;
create trigger trg_finance_causes_touch before update on public.finance_causes
for each row execute function public.touch_edited();
drop trigger if exists trg_finance_entries_audit on public.finance_entries;
create trigger trg_finance_entries_audit before insert on public.finance_entries
for each row execute function public.finance_fill_audit();
drop trigger if exists trg_finance_entries_touch on public.finance_entries;
create trigger trg_finance_entries_touch before update on public.finance_entries
for each row execute function public.touch_edited();

-- an entry's static cause must be usable in the entry's scope and kind:
-- the cause is at the same level or a level ABOVE (church cause → every
-- service / class of the church), and its kind covers the entry's kind.
create or replace function public.finance_check_entry_cause()
returns trigger language plpgsql set search_path = public as $$
declare c public.finance_causes;
begin
  if new.cause_id is null then
    new.cause_text := nullif(trim(coalesce(new.cause_text, '')), '');
    return new;
  end if;
  select * into c from public.finance_causes where id = new.cause_id;
  if not found then raise exception 'cause_not_found' using errcode = '23503'; end if;
  if c.church_id <> new.church_id
     or (c.service_id is not null and c.service_id is distinct from new.service_id)
     or (c.class_id is not null and c.class_id is distinct from new.class_id) then
    raise exception 'cause_out_of_scope' using errcode = '23514';
  end if;
  if c.kind <> 'both' and c.kind <> new.kind then
    raise exception 'cause_kind_mismatch' using errcode = '23514';
  end if;
  -- keep the cause's name on the row so the history survives a rename / delete
  new.cause_text := c.name;
  return new;
end $$;
drop trigger if exists trg_finance_entries_cause on public.finance_entries;
create trigger trg_finance_entries_cause before insert or update on public.finance_entries
for each row execute function public.finance_check_entry_cause();

-- ---------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------
alter table public.finance_causes  enable row level security;
alter table public.finance_entries enable row level security;

drop policy if exists finance_causes_select on public.finance_causes;
create policy finance_causes_select on public.finance_causes for select using (
  (select public.finance_can('finance.view')) and public.scope_overlaps(church_id, service_id, class_id)
);
drop policy if exists finance_causes_insert on public.finance_causes;
create policy finance_causes_insert on public.finance_causes for insert with check (
  (select public.finance_can('finance.manage')) and public.can_access(church_id, service_id, class_id)
);
drop policy if exists finance_causes_update on public.finance_causes;
create policy finance_causes_update on public.finance_causes for update using (
  (select public.finance_can('finance.manage')) and public.can_access(church_id, service_id, class_id)
) with check (
  (select public.finance_can('finance.manage')) and public.can_access(church_id, service_id, class_id)
);
drop policy if exists finance_causes_delete on public.finance_causes;
create policy finance_causes_delete on public.finance_causes for delete using (
  (select public.finance_can('finance.manage')) and public.can_access(church_id, service_id, class_id)
);

drop policy if exists finance_entries_select on public.finance_entries;
create policy finance_entries_select on public.finance_entries for select using (
  (select public.finance_can('finance.view')) and public.scope_overlaps(church_id, service_id, class_id)
);
drop policy if exists finance_entries_insert on public.finance_entries;
create policy finance_entries_insert on public.finance_entries for insert with check (
  (select public.finance_can('finance.add')) and public.can_access(church_id, service_id, class_id)
);
drop policy if exists finance_entries_update on public.finance_entries;
create policy finance_entries_update on public.finance_entries for update using (
  (select public.finance_can('finance.manage')) and public.can_access(church_id, service_id, class_id)
) with check (
  (select public.finance_can('finance.manage')) and public.can_access(church_id, service_id, class_id)
);
drop policy if exists finance_entries_delete on public.finance_entries;
create policy finance_entries_delete on public.finance_entries for delete using (
  (select public.finance_can('finance.manage')) and public.can_access(church_id, service_id, class_id)
);

-- ---------------------------------------------------------------------
-- 3. Summary RPC
--    finance_summary(church, service, class, from, to, bucket)
--    scope nulls = «الكل» at that level (church null = every church the
--    caller may see). Returns:
--    {
--      balance: { income, expense, net }                 -- ALL TIME, this scope
--      period:  { income, expense, net, count }          -- from..to
--      series:  [{ key: 'YYYY-MM-DD', income, expense }] -- per bucket (day|week|month|year)
--      by_cause:[{ kind, cause_id, cause, total, count }] -- from..to, sorted desc
--    }
-- ---------------------------------------------------------------------
create or replace function public.finance_summary(
  p_church  uuid default null,
  p_service uuid default null,
  p_class   uuid default null,
  p_from    date default null,
  p_to      date default null,
  p_bucket  text default 'month'
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_bucket text := case when p_bucket in ('day', 'week', 'month', 'year') then p_bucket else 'month' end;
  v_from   date := coalesce(p_from, (now() at time zone 'Africa/Cairo')::date - 29);
  v_to     date := coalesce(p_to,   (now() at time zone 'Africa/Cairo')::date);
  v_out    jsonb;
begin
  if not public.finance_can('finance.view') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  with scoped as (
    select e.*
      from public.finance_entries e
     where public.scope_overlaps(e.church_id, e.service_id, e.class_id)
       and (p_church  is null or e.church_id  = p_church)
       and (p_service is null or e.service_id = p_service)
       and (p_class   is null or e.class_id   = p_class)
  ),
  in_period as (
    select * from scoped where entry_date between v_from and v_to
  ),
  balance as (
    select coalesce(sum(amount) filter (where kind = 'income'),  0) as income,
           coalesce(sum(amount) filter (where kind = 'expense'), 0) as expense
      from scoped
  ),
  period as (
    select coalesce(sum(amount) filter (where kind = 'income'),  0) as income,
           coalesce(sum(amount) filter (where kind = 'expense'), 0) as expense,
           count(*) as cnt
      from in_period
  ),
  series as (
    select date_trunc(v_bucket, entry_date)::date as k,
           coalesce(sum(amount) filter (where kind = 'income'),  0) as income,
           coalesce(sum(amount) filter (where kind = 'expense'), 0) as expense
      from in_period
     group by 1 order by 1
  ),
  by_cause as (
    select kind, cause_id, coalesce(cause_text, '—') as cause, sum(amount) as total, count(*) as cnt
      from in_period
     group by kind, cause_id, coalesce(cause_text, '—')
     order by sum(amount) desc
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to, 'bucket', v_bucket,
    'balance', (select jsonb_build_object('income', income, 'expense', expense, 'net', income - expense) from balance),
    'period',  (select jsonb_build_object('income', income, 'expense', expense, 'net', income - expense, 'count', cnt) from period),
    'series',  coalesce((select jsonb_agg(jsonb_build_object('key', k, 'income', income, 'expense', expense) order by k) from series), '[]'::jsonb),
    'by_cause', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'cause_id', cause_id, 'cause', cause, 'total', total, 'count', cnt)) from by_cause), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.finance_summary(uuid, uuid, uuid, date, date, text) from public, anon;
grant execute on function public.finance_summary(uuid, uuid, uuid, date, date, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Module grant seed · realtime · activity log
-- ---------------------------------------------------------------------
insert into public.module_access (module_key, church_id, service_id, class_id)
select 'finance', null, null, null
where not exists (select 1 from public.module_access where module_key = 'finance');

do $$
declare t text;
begin
  foreach t in array array['finance_causes', 'finance_entries'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception when undefined_object then null;
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
    'access_events', 'access_rule_groups', 'access_rules', 'access_allowed', 'access_log',
    'priests', 'priest_requests', 'priest_confessors', 'confessions', 'confession_appointments', 'priest_contacts',
    'areas', 'area_priests', 'streets', 'buildings', 'family_visits',
    'finance_causes', 'finance_entries'
  ]
$$;
do $$ begin
  if to_regprocedure('public.activity_audit_attach(text)') is not null then
    perform public.activity_audit_attach('finance_causes');
    perform public.activity_audit_attach('finance_entries');
  end if;
end $$;

commit;
