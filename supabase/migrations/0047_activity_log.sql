-- =====================================================================
-- 0047: ACTIVITY LOG MODULE — سجل النشاط (كل ما يحدث في التطبيق)
--
-- ONE table — `activity_log` — receives EVERY operation that happens in the
-- app, wherever it comes from (a screen, an RPC, a server route, a trigger,
-- the child portal):
--
--   WHO    actor_kind (servant | child | system) · actor_id · actor_name ·
--          actor_role
--   WHAT   table_name · op (INSERT | UPDATE | DELETE | EVENT) · action
--          (a stable app key, e.g. attendance.add · points.add ·
--          person.update · auth.login …) · changed (columns that changed)
--   ON     row_id · target_kind · target_person_id · target_name ·
--          enrollment_id
--   WHERE  church_id · service_id · class_id (best effort resolution)
--   DIFF   old_data · new_data (UPDATE keeps ONLY the changed columns; row
--          snapshots are trimmed to the interesting columns)
--   BATCH  batch_id — every row written by ONE statement shares an id
--          (bulk import = 300 rows, one batch) · batch_size
--
-- HOW IT IS FILLED
--   1. A GENERIC statement-level trigger (`activity_audit`) on every
--      business table (list in §4 — one call to `activity_audit_attach()`
--      per table, idempotent). Uses transition tables → one function call
--      per statement, however many rows. The trigger resolves the actor from
--      auth.uid() (servant), from the child-portal session set by
--      `child_portal_person()` (child), or marks it `system` (cron / service
--      role / triggers without a caller).
--   2. `log_activity(action, target, meta)` — RPC for app-level EVENTS that
--      are not table writes: login · logout · export · print · scan …
--   3. Skips: `activity_log` itself, the backup staging tables, realtime
--      gates, push subscriptions, child_sessions (token hashes) and every
--      column that holds a secret (password_hash …).
--      `set_config('app.audit_off', '1')` inside a transaction disables the
--      trigger — backup restore uses it (0044 `disable trigger user` already
--      covers it, this is a belt on top).
--
-- WHO MAY READ (RLS)
--   module_visible('activity') AND
--     owner              → everything
--     church_manager     → rows of his church (+ rows without a church made
--                          by servants of his church)
--     service_manager    → his service · with `activity.view_all` he sees
--                          the whole church
--     class_servant      → nothing unless he holds `activity.view`
--                          (then: his class only)
--   `activity.view`      — read the log in scope
--   `activity.view_all`  — read the whole church (managers)
--   `activity.manage`    — settings (retention) + prune (owner only anyway)
--
-- READ API
--   activity_feed(p_filters jsonb, p_limit int, p_before timestamptz,
--                 p_before_id uuid)                 → keyset page (10…1000)
--   activity_summary(p_filters jsonb)               → counts by action /
--                                                     actor / table / day
--   activity_actors(p_filters jsonb)                → who did anything
--   activity_prune(p_keep_days int)                 → owner housekeeping
--   activity_settings() / activity_settings_set()   → retention in
--                                                     app_settings.activity
--
-- REALTIME: the table joins the 0046 broadcast bus (one message per
-- statement on scope:all + scope:church:<id>) so the log screen is live.
--
-- Idempotent — safe to re-run. Depends on 0019 (my_scope), 0024
-- (module_visible), 0037 (has_permission), 0042 (child_portal_person),
-- 0045 (scope_overlaps), 0046 (rt_notify_scope). NO module grant is
-- seeded — the owner enables it per scope in وحدة المالك.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. TABLE
-- ---------------------------------------------------------------------
create table if not exists public.activity_log (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  -- who
  actor_kind       text not null default 'system' check (actor_kind in ('servant', 'child', 'system')),
  actor_id         uuid,                       -- servant_enrollments.id | persons.id (child) | null
  actor_name       text,
  actor_role       text,                       -- owner | church_manager | … | child | system
  -- what
  table_name       text not null,
  op               text not null check (op in ('INSERT', 'UPDATE', 'DELETE', 'EVENT')),
  action           text not null,              -- stable key: attendance.add · person.update · auth.login …
  changed          text[],                     -- UPDATE: columns that changed
  -- on
  row_id           uuid,
  target_kind      text,                       -- person | servant | church | service | class | event | … | null
  target_person_id uuid,
  target_name      text,
  enrollment_id    uuid,
  -- where
  church_id        uuid,
  service_id       uuid,
  class_id         uuid,
  -- diff
  old_data         jsonb,
  new_data         jsonb,
  meta             jsonb,                      -- free extra (EVENT rows · trigger notes)
  -- batch
  batch_id         uuid,
  batch_size       integer not null default 1,
  source           text not null default 'db'  -- db | app | system
);

comment on table public.activity_log is 'سجل النشاط — كل عملية تحدث في التطبيق: مَن فعل ماذا على مَن وأين ومتى، مع الفرق قبل/بعد';

-- feed order + keyset pagination
create index if not exists idx_activity_log_created on public.activity_log (created_at desc, id desc);
create index if not exists idx_activity_log_actor    on public.activity_log (actor_kind, actor_id, created_at desc);
create index if not exists idx_activity_log_action   on public.activity_log (action, created_at desc);
create index if not exists idx_activity_log_table    on public.activity_log (table_name, created_at desc);
create index if not exists idx_activity_log_target   on public.activity_log (target_person_id, created_at desc) where target_person_id is not null;
create index if not exists idx_activity_log_row      on public.activity_log (row_id) where row_id is not null;
create index if not exists idx_activity_log_church   on public.activity_log (church_id, created_at desc);
create index if not exists idx_activity_log_batch    on public.activity_log (batch_id) where batch_id is not null;

alter table public.activity_log enable row level security;

-- nobody writes through the API — only the trigger / RPCs (security definer)
revoke insert, update, delete on public.activity_log from anon, authenticated;
grant select on public.activity_log to authenticated;

-- ---------------------------------------------------------------------
-- 2. PERMISSIONS
-- ---------------------------------------------------------------------
create or replace function public.activity_can(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.module_visible('activity')
     and (
       (select role from public.my_scope()) in ('owner', 'church_manager')
       or (p_key in ('activity.view') and (select role from public.my_scope()) = 'service_manager')
       or public.has_permission(p_key)
     )
$$;
grant execute on function public.activity_can(text) to authenticated;

create or replace function public.activity_permissions()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'view',     public.activity_can('activity.view'),
    'view_all', public.activity_can('activity.view_all'),
    'manage',   public.is_owner() and public.module_visible('activity')
  )
$$;
grant execute on function public.activity_permissions() to authenticated;

-- Row visibility for the policy. Owner: all. Church manager / view_all:
-- his church (or rows made by servants of his church that carry no church).
-- Service manager / class servant with activity.view: his scope.
create or replace function public.activity_row_visible(
  p_church uuid, p_service uuid, p_class uuid, p_actor_kind text, p_actor_id uuid
) returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_owner() then true
    when not public.activity_can('activity.view') then false
    when p_church is not null then
      case
        when (select role from public.my_scope()) = 'church_manager' or public.has_permission('activity.view_all')
          then exists (select 1 from public.my_scopes() s where s.church_id = p_church)
        else public.scope_overlaps(p_church, p_service, p_class)
      end
    -- no church on the row: a manager sees what servants of HIS church did
    when p_actor_kind = 'servant' and p_actor_id is not null then
      exists (select 1 from public.servant_enrollments se
               join public.my_scopes() s on s.church_id = se.church_id
              where se.id = p_actor_id)
      and ((select role from public.my_scope()) = 'church_manager' or public.has_permission('activity.view_all'))
    else false
  end
$$;
grant execute on function public.activity_row_visible(uuid, uuid, uuid, text, uuid) to authenticated;

drop policy if exists activity_log_select on public.activity_log;
create policy activity_log_select on public.activity_log for select using (
  public.activity_row_visible(church_id, service_id, class_id, actor_kind, actor_id)
);

-- ---------------------------------------------------------------------
-- 3. ACTOR RESOLUTION
-- ---------------------------------------------------------------------
-- The child portal never has an auth session: every child_portal_* RPC
-- calls child_portal_person(token). We stamp the resolved person on the
-- transaction (set_config local) so the audit trigger can name the actor.
create or replace function public.child_portal_person(p_national_id text)
returns public.persons language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v public.persons;
  s public.child_sessions;
begin
  if nullif(trim(coalesce(p_national_id, '')), '') is null then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;
  select * into s from public.child_sessions
   where token_hash = encode(digest(trim(p_national_id), 'sha256'), 'hex');
  if not found or s.expires_at < now() then
    raise exception 'session_expired' using errcode = 'P0002';
  end if;
  select * into v from public.persons where id = s.person_id;
  if not found then
    raise exception 'unknown_code' using errcode = 'P0002';
  end if;
  -- 0047: remember the child for the audit trigger (transaction-local)
  perform set_config('app.child_actor', v.id::text, true);
  return v;
end $$;
revoke all on function public.child_portal_person(text) from public, anon, authenticated;

-- Also stamp the child on login (child_login does not go through child_portal_person)
create or replace function public.activity_stamp_child(p_person uuid)
returns void language sql volatile security definer set search_path = public as $$
  select set_config('app.child_actor', coalesce(p_person::text, ''), true)
$$;
revoke all on function public.activity_stamp_child(uuid) from public, anon, authenticated;

-- (kind, id, name, role) of whoever is acting in this transaction
create or replace function public.activity_actor()
returns table (kind text, id uuid, name text, role text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_variable
declare
  uid uuid := auth.uid();
  cid text := current_setting('app.child_actor', true);
  se  public.servant_enrollments;
begin
  if uid is not null then
    select * into se from public.servant_enrollments x where x.id = uid;
    if found then
      return query select 'servant'::text, se.id, se.full_name, se.role::text;
      return;
    end if;
    return query select 'servant'::text, uid, null::text, 'unknown'::text;
    return;
  end if;
  if nullif(cid, '') is not null then
    return query select 'child'::text, p.id, p.name, 'child'::text from public.persons p where p.id = cid::uuid;
    if found then return; end if;
  end if;
  return query select 'system'::text, null::uuid, null::text,
    case when auth.role() = 'service_role' then 'service_role' else 'system' end;
end $$;
revoke all on function public.activity_actor() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. GENERIC AUDIT TRIGGER
-- ---------------------------------------------------------------------
-- Columns never written to the log
create or replace function public.activity_secret_columns()
returns text[] language sql immutable as $$
  select array['password_hash', 'token_hash', 'auth', 'p256dh', 'endpoint', 'design', 'value_large']
$$;

-- Strip secrets + oversized values from a row snapshot
create or replace function public.activity_trim(p_row jsonb)
returns jsonb language sql immutable as $$
  select coalesce((
    select jsonb_object_agg(k,
             case when jsonb_typeof(v) = 'string' and length(v #>> '{}') > 600
                  then to_jsonb(left(v #>> '{}', 600) || '…')
                  when jsonb_typeof(v) in ('object', 'array') and length(v::text) > 2000
                  then to_jsonb('{…' || length(v::text) || '}')
                  else v end)
      from jsonb_each(p_row) as e(k, v)
     where not (k = any (public.activity_secret_columns()))
  ), '{}'::jsonb)
$$;

-- Human "target" of a row: which person / entity does it concern?
-- Returns (target_kind, target_person_id, target_name, enrollment_id,
-- church_id, service_id, class_id) — best effort, never raises.
create or replace function public.activity_resolve_target(p_table text, r jsonb)
returns table (target_kind text, target_person_id uuid, target_name text, enrollment_id uuid,
               church_id uuid, service_id uuid, class_id uuid)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_variable
declare
  eid uuid; pid uuid; sid uuid;
  e public.enrollments; p public.persons; se public.servant_enrollments;
  tk text := null; tn text := null;
  ch uuid := nullif(r->>'church_id', '')::uuid;
  sv uuid := nullif(r->>'service_id', '')::uuid;
  cl uuid := nullif(r->>'class_id', '')::uuid;
begin
  eid := nullif(r->>'enrollment_id', '')::uuid;
  pid := nullif(r->>'person_id', '')::uuid;
  sid := nullif(r->>'servant_id', '')::uuid;

  if p_table = 'persons' then
    pid := nullif(r->>'id', '')::uuid; tk := 'person'; tn := r->>'name';
  elsif p_table = 'enrollments' then
    eid := nullif(r->>'id', '')::uuid; tk := case when r->>'kind' = 'servant' then 'servant' else 'person' end;
  elsif p_table = 'servant_enrollments' then
    sid := nullif(r->>'id', '')::uuid; tk := 'servant'; tn := r->>'full_name';
  elsif p_table in ('servant_scopes', 'permissions', 'shepherd_groups') then
    tk := 'servant';
  elsif p_table = 'churches' then tk := 'church'; tn := r->>'name'; ch := nullif(r->>'id', '')::uuid;
  elsif p_table = 'services' then tk := 'service'; tn := r->>'name'; sv := nullif(r->>'id', '')::uuid;
  elsif p_table = 'classes'  then tk := 'class';   tn := r->>'name'; cl := nullif(r->>'id', '')::uuid;
  elsif p_table = 'events' then tk := 'event'; tn := r->>'name';
  elsif p_table = 'causes' then tk := 'cause'; tn := r->>'name';
  elsif p_table = 'call_feedbacks' then tk := 'feedback'; tn := r->>'name';
  elsif p_table = 'child_join_requests' then tk := 'person'; tn := r->>'name';
  elsif p_table = 'store_items' then tk := 'item'; tn := r->>'name';
  elsif p_table in ('exams', 'occasions', 'online_classes', 'library_books', 'library_lectures') then tk := 'content'; tn := r->>'title';
  elsif p_table in ('achievements', 'result_exams', 'library_subjects', 'permission_profiles', 'card_templates',
                    'birthday_card_templates', 'notification_automations', 'grading_systems', 'backup_schedules') then tk := 'content'; tn := r->>'name';
  elsif p_table = 'notifications' then tk := 'content'; tn := r->>'title';
  elsif p_table = 'module_access' then tk := 'module'; tn := r->>'module_key';
  elsif p_table = 'app_settings' then tk := 'setting'; tn := r->>'key';
  elsif p_table = 'chat_messages' then tk := 'message';
  end if;

  -- resolve person / scope through the enrollment
  if eid is not null then
    select * into e from public.enrollments x where x.id = eid;
    if found then
      pid := coalesce(pid, e.person_id);
      ch := coalesce(ch, e.church_id); sv := coalesce(sv, e.service_id); cl := coalesce(cl, e.class_id);
      if tk is null then tk := case when e.kind = 'servant' then 'servant' else 'person' end; end if;
    end if;
  end if;
  if sid is not null and (tn is null or tk = 'servant') then
    select * into se from public.servant_enrollments x where x.id = sid;
    if found then
      tn := coalesce(tn, se.full_name); tk := coalesce(tk, 'servant');
      ch := coalesce(ch, se.church_id); sv := coalesce(sv, se.service_id); cl := coalesce(cl, se.class_id);
    end if;
  end if;
  if pid is not null and tn is null then
    select * into p from public.persons x where x.id = pid;
    if found then tn := p.name; tk := coalesce(tk, 'person'); end if;
  end if;
  -- scope through the hierarchy when only a class / service is known
  if ch is null and cl is not null then
    select c.church_id, c.service_id into ch, sv from public.classes c where c.id = cl;
  end if;
  if ch is null and sv is not null then
    select s.church_id into ch from public.services s where s.id = sv;
  end if;

  return query select tk, pid, tn, eid, ch, sv, cl;
exception when others then
  return query select tk, pid, tn, eid, ch, sv, cl;
end $$;
revoke all on function public.activity_resolve_target(text, jsonb) from public, anon, authenticated;

-- Stable app-level action key for a table + op (the UI translates it)
create or replace function public.activity_action_key(p_table text, p_op text, p_old jsonb, p_new jsonb)
returns text language plpgsql immutable as $$
declare base text; verb text;
begin
  verb := case p_op when 'INSERT' then 'add' when 'DELETE' then 'remove' else 'update' end;
  base := case p_table
    when 'attendance_log' then 'attendance'
    when 'points_log' then 'points'
    when 'contact_log' then case coalesce(p_new->>'kind', p_old->>'kind') when 'call' then 'call' else 'message' end
    when 'persons' then 'person'
    when 'enrollments' then case when coalesce(p_new->>'kind', p_old->>'kind') = 'servant' then 'servant_mirror' else 'enrollment' end
    when 'servant_enrollments' then 'servant'
    when 'servant_scopes' then 'servant_scope'
    when 'permissions' then 'permission'
    when 'permission_profiles' then 'permission_profile'
    when 'module_access' then 'module_access'
    when 'churches' then 'church'
    when 'services' then 'service'
    when 'classes' then 'class'
    when 'events' then 'event'
    when 'causes' then 'cause'
    when 'call_feedbacks' then 'feedback'
    when 'card_print_requests' then 'print_request'
    when 'card_templates' then 'card_template'
    when 'data_change_requests' then 'data_request'
    when 'child_join_requests' then 'join_request'
    when 'person_credentials' then 'password'
    when 'shepherd_groups' then 'shepherd'
    when 'store_items' then 'store_item'
    when 'store_orders' then 'store_order'
    when 'exams' then 'exam'
    when 'exam_questions' then 'exam_question'
    when 'exam_attempts' then 'exam_attempt'
    when 'birthday_greetings' then 'birthday'
    when 'birthday_settings' then 'birthday_setting'
    when 'birthday_card_templates' then 'birthday_card'
    when 'chat_messages' then 'chat'
    when 'online_classes' then 'online_class'
    when 'online_class_participants' then 'online_participant'
    when 'achievements' then 'achievement'
    when 'user_achievements' then 'achievement_award'
    when 'occasions' then 'occasion'
    when 'occasion_registrations' then 'occasion_registration'
    when 'occasion_checklist_items' then 'occasion_checklist'
    when 'occasion_checklist_marks' then 'occasion_mark'
    when 'notifications' then 'notification'
    when 'notification_automations' then 'notification_automation'
    when 'app_settings' then 'setting'
    when 'result_exams' then 'result_exam'
    when 'result_subjects' then 'result_subject'
    when 'exam_results' then 'result'
    when 'grading_systems' then 'grading'
    when 'grading_grades' then 'grading_grade'
    when 'library_subjects' then 'library_subject'
    when 'library_books' then 'library_book'
    when 'library_lectures' then 'library_lecture'
    when 'library_favorites' then 'library_favorite'
    when 'backup_runs' then 'backup'
    when 'backup_schedules' then 'backup_schedule'
    else p_table end;

  -- a few semantic refinements
  if p_table = 'servant_enrollments' and p_op = 'UPDATE' then
    if p_old->>'status' is distinct from p_new->>'status' then
      verb := case p_new->>'status' when 'approved' then 'approve' when 'rejected' then 'reject'
                   when 'suspended' then 'suspend' else 'status' end;
    elsif p_old->>'role' is distinct from p_new->>'role' then verb := 'role';
    end if;
  elsif p_table = 'enrollments' and p_op = 'UPDATE' then
    if p_old->>'status' is distinct from p_new->>'status' then verb := case p_new->>'status' when 'stopped' then 'stop' else 'resume' end;
    elsif p_old->>'class_id' is distinct from p_new->>'class_id' then verb := 'move';
    elsif (p_old - 'attendance_count' - 'points' - 'edited_at' - 'edited_by') = (p_new - 'attendance_count' - 'points' - 'edited_at' - 'edited_by') then
      verb := 'counters';
    end if;
  elsif p_table = 'points_log' and p_op = 'INSERT' then
    verb := case when coalesce((p_new->>'delta')::int, 0) < 0 then 'deduct' else 'add' end;
  elsif p_table in ('store_orders', 'exam_attempts', 'occasion_registrations') and p_op = 'UPDATE'
        and p_old->>'status' is distinct from p_new->>'status' then
    verb := coalesce(p_new->>'status', 'status');
  elsif p_table in ('data_change_requests', 'child_join_requests') and p_op = 'UPDATE'
        and p_old->>'status' is distinct from p_new->>'status' then
    verb := coalesce(p_new->>'status', 'status');
  elsif p_table = 'result_exams' and p_op = 'UPDATE' and p_old->>'locked' is distinct from p_new->>'locked' then
    verb := case when (p_new->>'locked')::boolean then 'lock' else 'unlock' end;
  elsif p_table = 'online_classes' and p_op = 'UPDATE' and p_old->>'status' is distinct from p_new->>'status' then
    verb := coalesce(p_new->>'status', 'status');
  elsif p_table = 'exams' and p_op = 'UPDATE' and p_old->>'status' is distinct from p_new->>'status' then
    verb := coalesce(p_new->>'status', 'status');
  end if;
  return base || '.' || verb;
end $$;

-- Is auditing switched off for this transaction? (backup restore …)
create or replace function public.activity_off()
returns boolean language sql stable as $$
  select coalesce(current_setting('app.audit_off', true), '') = '1'
$$;

-- THE trigger. Statement level, transition tables. Writes one activity_log
-- row per affected row, all sharing a batch_id.
create or replace function public.activity_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a record;
  bid uuid := gen_random_uuid();
  n integer := 0;
  pk text := 'id';
begin
  if public.activity_off() then return null; end if;
  select * into a from public.activity_actor();

  if tg_op = 'INSERT' then
    execute format($q$
      insert into public.activity_log
        (actor_kind, actor_id, actor_name, actor_role, table_name, op, action, row_id,
         target_kind, target_person_id, target_name, enrollment_id, church_id, service_id, class_id,
         new_data, batch_id, source)
      select $1, $2, $3, $4, %1$L, 'INSERT', public.activity_action_key(%1$L, 'INSERT', null, j),
             nullif(j->>%2$L, '')::uuid,
             t.target_kind, t.target_person_id, t.target_name, t.enrollment_id, t.church_id, t.service_id, t.class_id,
             public.activity_trim(j), $5, 'db'
        from (select to_jsonb(x) j from new_rows x) r
        cross join lateral public.activity_resolve_target(%1$L, r.j) t
    $q$, tg_table_name, pk) using a.kind, a.id, a.name, a.role, bid;
  elsif tg_op = 'DELETE' then
    execute format($q$
      insert into public.activity_log
        (actor_kind, actor_id, actor_name, actor_role, table_name, op, action, row_id,
         target_kind, target_person_id, target_name, enrollment_id, church_id, service_id, class_id,
         old_data, batch_id, source)
      select $1, $2, $3, $4, %1$L, 'DELETE', public.activity_action_key(%1$L, 'DELETE', j, null),
             nullif(j->>%2$L, '')::uuid,
             t.target_kind, t.target_person_id, t.target_name, t.enrollment_id, t.church_id, t.service_id, t.class_id,
             public.activity_trim(j), $5, 'db'
        from (select to_jsonb(x) j from old_rows x) r
        cross join lateral public.activity_resolve_target(%1$L, r.j) t
    $q$, tg_table_name, pk) using a.kind, a.id, a.name, a.role, bid;
  else
    -- UPDATE: pair old/new on the primary key (row_number fallback for tables
    -- without an `id` column); keep only the columns that changed and skip
    -- rows where nothing but bookkeeping (edited_at / updated_at) moved.
    execute format($q$
      with o as (select to_jsonb(x) j, row_number() over () rn from old_rows x),
           nn as (select to_jsonb(x) j, row_number() over () rn from new_rows x),
           pairs as (
             select o.j oj, nn.j nj from o join nn
               on case when o.j ? %2$L then o.j->>%2$L = nn.j->>%2$L else o.rn = nn.rn end
           ),
           diff as (
             select oj, nj,
               (select coalesce(array_agg(k order by k), '{}') from (
                  select k from jsonb_each(nj) e(k, v) where oj->k is distinct from v
                  union select k from jsonb_object_keys(oj) k where not (nj ? k)) z) chg
             from pairs
           )
      insert into public.activity_log
        (actor_kind, actor_id, actor_name, actor_role, table_name, op, action, changed, row_id,
         target_kind, target_person_id, target_name, enrollment_id, church_id, service_id, class_id,
         old_data, new_data, batch_id, source)
      select $1, $2, $3, $4, %1$L, 'UPDATE', public.activity_action_key(%1$L, 'UPDATE', oj, nj), chg,
             nullif(nj->>%2$L, '')::uuid,
             t.target_kind, t.target_person_id, t.target_name, t.enrollment_id, t.church_id, t.service_id, t.class_id,
             public.activity_trim((select coalesce(jsonb_object_agg(k, oj->k), '{}') from unnest(chg) k)),
             public.activity_trim((select coalesce(jsonb_object_agg(k, nj->k), '{}') from unnest(chg) k)),
             $5, 'db'
        from diff
        cross join lateral public.activity_resolve_target(%1$L, nj) t
       where exists (select 1 from unnest(chg) k
                      where k not in ('edited_at', 'updated_at', 'last_seen_at', 'last_read_at', 'updated_by', 'edited_by'))
    $q$, tg_table_name, pk) using a.kind, a.id, a.name, a.role, bid;
  end if;

  get diagnostics n = row_count;
  if n > 1 then update public.activity_log set batch_size = n where batch_id = bid; end if;
  return null;
end $$;
revoke all on function public.activity_audit() from public, anon, authenticated;

-- Attach the three statement triggers to one table (idempotent)
create or replace function public.activity_audit_attach(p_table text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = p_table and c.relkind = 'r') then
    return;
  end if;
  execute format('drop trigger if exists zza_audit_ins on public.%I', p_table);
  execute format('drop trigger if exists zza_audit_upd on public.%I', p_table);
  execute format('drop trigger if exists zza_audit_del on public.%I', p_table);
  execute format('create trigger zza_audit_ins after insert on public.%I referencing new table as new_rows for each statement execute function public.activity_audit()', p_table);
  execute format('create trigger zza_audit_upd after update on public.%I referencing old table as old_rows new table as new_rows for each statement execute function public.activity_audit()', p_table);
  execute format('create trigger zza_audit_del after delete on public.%I referencing old table as old_rows for each statement execute function public.activity_audit()', p_table);
end $$;
revoke all on function public.activity_audit_attach(text) from public, anon, authenticated;

create or replace function public.activity_audit_detach(p_table text)
returns void language plpgsql security definer set search_path = public as $$
begin
  execute format('drop trigger if exists zza_audit_ins on public.%I', p_table);
  execute format('drop trigger if exists zza_audit_upd on public.%I', p_table);
  execute format('drop trigger if exists zza_audit_del on public.%I', p_table);
exception when undefined_table then null;
end $$;
revoke all on function public.activity_audit_detach(text) from public, anon, authenticated;

-- The audited tables = every business table. Excluded on purpose:
--   activity_log (itself) · backup_restore_* (staging) · rt_gates ·
--   push_subscriptions (device keys) · child_sessions (token hashes) ·
--   online_class_sessions / chat_read_state / notification_recipients /
--   notification_automation_runs / online_class_check_responses (high-volume
--   heartbeat / delivery rows — noise, not operations).
create or replace function public.activity_audited_tables()
returns text[] language sql immutable as $$
  select array[
    'persons', 'enrollments', 'servant_enrollments', 'servant_scopes', 'permissions', 'permission_profiles',
    'module_access', 'churches', 'services', 'classes', 'events', 'causes', 'call_feedbacks',
    'attendance_log', 'points_log', 'contact_log', 'card_print_requests', 'card_templates',
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

do $$ declare t text; begin
  foreach t in array public.activity_audited_tables() loop
    perform public.activity_audit_attach(t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. APP-LEVEL EVENTS — log_activity()
-- ---------------------------------------------------------------------
-- action: 'auth.login' · 'auth.logout' · 'auth.login_failed' · 'export.excel'
--         · 'print.cards' · 'scan.qr' · 'backup.download' · anything the app
--         wants (namespace.verb). Target is optional.
create or replace function public.log_activity(
  p_action text,
  p_target_person uuid default null,
  p_enrollment uuid default null,
  p_meta jsonb default '{}'::jsonb,
  p_church uuid default null, p_service uuid default null, p_class uuid default null
) returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  a record; tn text; ch uuid := p_church; sv uuid := p_service; cl uuid := p_class; lid uuid;
  e public.enrollments;
begin
  if p_action is null or p_action !~ '^[a-z_]+\.[a-z_]+$' then
    raise exception 'bad_action' using errcode = 'P0001';
  end if;
  select * into a from public.activity_actor();
  if a.kind = 'system' and auth.role() not in ('service_role') then
    -- an anonymous browser may only log auth events (failed logins)
    if p_action not like 'auth.%' then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  end if;
  if p_enrollment is not null then
    select * into e from public.enrollments where id = p_enrollment;
    if found then
      ch := coalesce(ch, e.church_id); sv := coalesce(sv, e.service_id); cl := coalesce(cl, e.class_id);
    end if;
  end if;
  if p_target_person is not null then
    select name into tn from public.persons where id = p_target_person;
  end if;
  -- no scope given → the actor's primary scope
  if ch is null and a.kind = 'servant' then
    select church_id, service_id, class_id into ch, sv, cl from public.servant_enrollments where id = a.id;
  end if;
  insert into public.activity_log
    (actor_kind, actor_id, actor_name, actor_role, table_name, op, action,
     target_kind, target_person_id, target_name, enrollment_id, church_id, service_id, class_id, meta, source)
  values
    (a.kind, a.id, a.name, a.role, split_part(p_action, '.', 1), 'EVENT', p_action,
     case when p_target_person is not null then 'person' end, p_target_person, tn, p_enrollment,
     ch, sv, cl, coalesce(public.activity_trim(p_meta), '{}'::jsonb), 'app')
  returning id into lid;
  return lid;
end $$;
grant execute on function public.log_activity(text, uuid, uuid, jsonb, uuid, uuid, uuid) to authenticated, anon, service_role;

-- Child-portal variant (token instead of auth session)
create or replace function public.child_portal_log_activity(p_token text, p_action text, p_meta jsonb default '{}'::jsonb)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare p public.persons; e public.enrollments;
begin
  p := public.child_portal_person(p_token);   -- stamps app.child_actor
  select * into e from public.enrollments where person_id = p.id and kind = 'child' order by created_at limit 1;
  return public.log_activity(p_action, p.id, e.id, p_meta, e.church_id, e.service_id, e.class_id);
end $$;
grant execute on function public.child_portal_log_activity(text, text, jsonb) to anon, authenticated;

-- child_login / child_logout also leave a trace
create or replace function public.activity_child_login_hook()
returns trigger language plpgsql security definer set search_path = public as $$
declare p public.persons; e public.enrollments;
begin
  if public.activity_off() then return null; end if;
  select * into p from public.persons where id = new.person_id;
  select * into e from public.enrollments where person_id = new.person_id and kind = 'child' order by created_at limit 1;
  insert into public.activity_log
    (actor_kind, actor_id, actor_name, actor_role, table_name, op, action,
     target_kind, target_person_id, target_name, enrollment_id, church_id, service_id, class_id, meta, source)
  values ('child', p.id, p.name, 'child', 'auth', 'EVENT', 'auth.child_login', 'person', p.id, p.name, e.id,
          e.church_id, e.service_id, e.class_id,
          jsonb_build_object('remember', new.remember, 'user_agent', left(new.user_agent, 200)), 'app');
  return null;
end $$;
drop trigger if exists zza_child_login on public.child_sessions;
create trigger zza_child_login after insert on public.child_sessions for each row execute function public.activity_child_login_hook();

-- ---------------------------------------------------------------------
-- 6. READ API
-- ---------------------------------------------------------------------
-- Filters (all optional):
--   actor_kind · actor_id · action (exact) · actions (array) · table_name ·
--   op · target_person_id · enrollment_id · church_id · service_id ·
--   class_id · from · to (timestamptz) · q (text: actor / target / action)
--   · batch_id · row_id
create or replace function public.activity_where(f jsonb)
returns text language sql immutable as $$
  select concat_ws(' and ', 'true',
    case when f->>'actor_kind' is not null then format('actor_kind = %L', f->>'actor_kind') end,
    case when f->>'actor_id' is not null then format('actor_id = %L::uuid', f->>'actor_id') end,
    case when f->>'action' is not null then format('action = %L', f->>'action') end,
    case when f->'actions' is not null and jsonb_typeof(f->'actions') = 'array' and jsonb_array_length(f->'actions') > 0
         then format('action = any(%L::text[])', (select array_agg(x) from jsonb_array_elements_text(f->'actions') x)) end,
    case when f->>'action_prefix' is not null then format('action like %L', (f->>'action_prefix') || '.%') end,
    case when f->>'table_name' is not null then format('table_name = %L', f->>'table_name') end,
    case when f->>'op' is not null then format('op = %L', f->>'op') end,
    case when f->>'target_person_id' is not null then format('target_person_id = %L::uuid', f->>'target_person_id') end,
    case when f->>'enrollment_id' is not null then format('enrollment_id = %L::uuid', f->>'enrollment_id') end,
    case when f->>'row_id' is not null then format('(row_id = %1$L::uuid or target_person_id = %1$L::uuid)', f->>'row_id') end,
    case when f->>'batch_id' is not null then format('batch_id = %L::uuid', f->>'batch_id') end,
    case when f->>'church_id' is not null then format('church_id = %L::uuid', f->>'church_id') end,
    case when f->>'service_id' is not null then format('service_id = %L::uuid', f->>'service_id') end,
    case when f->>'class_id' is not null then format('class_id = %L::uuid', f->>'class_id') end,
    case when f->>'from' is not null then format('created_at >= %L::timestamptz', f->>'from') end,
    case when f->>'to' is not null then format('created_at < %L::timestamptz', f->>'to') end,
    case when nullif(trim(f->>'q'), '') is not null then
      format('(actor_name ilike %1$L or target_name ilike %1$L or action ilike %1$L or table_name ilike %1$L)',
             '%' || trim(f->>'q') || '%') end
  )
$$;

-- Keyset page: newest first. Pass the last row's (created_at, id) to dig further.
create or replace function public.activity_feed(
  p_filters jsonb default '{}'::jsonb,
  p_limit integer default 100,
  p_before timestamptz default null,
  p_before_id uuid default null
) returns setof public.activity_log
language plpgsql stable security invoker set search_path = public as $$
declare lim integer := greatest(1, least(coalesce(p_limit, 100), 1000));
begin
  return query execute format(
    'select * from public.activity_log where %s %s order by created_at desc, id desc limit %s',
    public.activity_where(coalesce(p_filters, '{}'::jsonb)),
    case when p_before is not null then
      format('and (created_at, id) < (%L::timestamptz, %L::uuid)', p_before, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid))
    else '' end,
    lim);
end $$;
grant execute on function public.activity_feed(jsonb, integer, timestamptz, uuid) to authenticated;

-- Counts for the dashboard / the «by operation» and «by user» tabs.
create or replace function public.activity_summary(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare w text := public.activity_where(coalesce(p_filters, '{}'::jsonb)); out jsonb;
begin
  execute format($q$
    with base as (select * from public.activity_log where %s)
    select jsonb_build_object(
      'total', (select count(*) from base),
      'today', (select count(*) from base where created_at >= date_trunc('day', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo'),
      'first_at', (select min(created_at) from base),
      'last_at', (select max(created_at) from base),
      'by_action', (select coalesce(jsonb_agg(jsonb_build_object('action', action, 'n', n, 'last_at', last_at) order by n desc), '[]')
                      from (select action, count(*) n, max(created_at) last_at from base group by action) x),
      'by_table', (select coalesce(jsonb_agg(jsonb_build_object('table_name', table_name, 'n', n) order by n desc), '[]')
                     from (select table_name, count(*) n from base group by table_name) x),
      'by_op', (select coalesce(jsonb_agg(jsonb_build_object('op', op, 'n', n) order by n desc), '[]')
                  from (select op, count(*) n from base group by op) x),
      'by_actor', (select coalesce(jsonb_agg(jsonb_build_object('actor_kind', actor_kind, 'actor_id', actor_id, 'actor_name', actor_name,
                                                                'actor_role', actor_role, 'n', n, 'last_at', last_at) order by n desc), '[]')
                     from (select actor_kind, actor_id, max(actor_name) actor_name, max(actor_role) actor_role, count(*) n, max(created_at) last_at
                             from base group by actor_kind, actor_id) x),
      'by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'n', n) order by d desc), '[]')
                   from (select (created_at at time zone 'Africa/Cairo')::date as d, count(*) as n
                           from base where created_at > now() - interval '30 days' group by 1) x),
      'by_hour', (select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'n', n) order by h), '[]')
                    from (select extract(hour from created_at at time zone 'Africa/Cairo')::int as h, count(*) as n
                            from base where created_at > now() - interval '7 days' group by 1) x)
    )$q$, w) into out;
  return out;
end $$;
grant execute on function public.activity_summary(jsonb) to authenticated;

-- Every distinct actor (for the «by user» picker) with counts
create or replace function public.activity_actors(p_filters jsonb default '{}'::jsonb)
returns table (actor_kind text, actor_id uuid, actor_name text, actor_role text, n bigint, last_at timestamptz, first_at timestamptz)
language plpgsql stable security invoker set search_path = public as $$
begin
  return query execute format(
    'select actor_kind, actor_id, max(actor_name), max(actor_role), count(*), max(created_at), min(created_at)
       from public.activity_log where %s group by actor_kind, actor_id order by 5 desc',
    public.activity_where(coalesce(p_filters, '{}'::jsonb)));
end $$;
grant execute on function public.activity_actors(jsonb) to authenticated;

-- Everything about ONE person (target OR actor) — the «person history» view
create or replace function public.activity_person_history(p_person uuid, p_limit integer default 200, p_before timestamptz default null)
returns setof public.activity_log language sql stable security invoker set search_path = public as $$
  select * from public.activity_log
   where (target_person_id = p_person or (actor_kind = 'child' and actor_id = p_person))
     and (p_before is null or created_at < p_before)
   order by created_at desc, id desc
   limit greatest(1, least(coalesce(p_limit, 200), 1000))
$$;
grant execute on function public.activity_person_history(uuid, integer, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- 7. SETTINGS + HOUSEKEEPING (owner)
-- ---------------------------------------------------------------------
-- app_settings.key = 'activity' → { keep_days: 365, enabled: true }
create or replace function public.activity_settings()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.app_settings where key = 'activity'), '{}'::jsonb)
         || jsonb_build_object('rows', (select count(*) from public.activity_log),
                               'oldest', (select min(created_at) from public.activity_log))
$$;
grant execute on function public.activity_settings() to authenticated;

create or replace function public.activity_settings_set(p_value jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_owner() then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  v := jsonb_build_object(
    'keep_days', greatest(7, least(coalesce((p_value->>'keep_days')::int, 365), 3650)),
    'enabled', coalesce((p_value->>'enabled')::boolean, true));
  insert into public.app_settings (key, value, updated_by) values ('activity', v, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
  return v;
end $$;
grant execute on function public.activity_settings_set(jsonb) to authenticated;

-- Delete rows older than keep_days (or the given number). Owner or cron.
create or replace function public.activity_prune(p_keep_days integer default null)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare days integer; n integer;
begin
  if not (public.is_owner() or auth.role() = 'service_role') then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  days := coalesce(p_keep_days, (select (value->>'keep_days')::int from public.app_settings where key = 'activity'), 365);
  days := greatest(7, days);
  delete from public.activity_log where created_at < now() - make_interval(days => days);
  get diagnostics n = row_count;
  perform public.log_activity('activity.prune', null, null, jsonb_build_object('keep_days', days, 'deleted', n));
  return n;
end $$;
grant execute on function public.activity_prune(integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 8. REALTIME (0046 bus) — one message per statement
-- ---------------------------------------------------------------------
-- THROTTLED: a scan burst writes several audit statements (attendance_log
-- insert → enrollments counter update → notification rows …). Each would
-- add a broadcast on top of the ones 0046 already sends, doubling the
-- realtime traffic that migration fought to cut. The log screen is a feed,
-- not a counter, so we send at most ONE `activity_log` message per
-- 3 seconds (gate row in rt_gates) — the screen refetches and catches
-- every row written meanwhile.
create or replace function public.rt_trg_activity_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare churches uuid[]; ids uuid[]; ok boolean := false;
begin
  if tg_op <> 'INSERT' then return null; end if;
  insert into public.rt_gates (key, fired_at) values ('activity_log', now())
  on conflict (key) do update set fired_at = now()
    where public.rt_gates.fired_at <= now() - interval '3 seconds'
  returning true into ok;
  if not coalesce(ok, false) then return null; end if;
  select array_agg(distinct church_id) filter (where church_id is not null), array_agg(id) into churches, ids from new_rows;
  if ids is not null then perform public.rt_notify_scope('activity_log', tg_op, churches, ids); end if;
  return null;
end $$;
drop trigger if exists zzz_rt_ins on public.activity_log;
create trigger zzz_rt_ins after insert on public.activity_log referencing new table as new_rows
  for each statement execute function public.rt_trg_activity_log();

-- ---------------------------------------------------------------------
-- 9. Backup restore leaves a trace (0044 disables user triggers on the
--    restored tables, so the log stays quiet during the apply — only the
--    job itself is logged: begin / done / failed)
-- ---------------------------------------------------------------------
do $$ begin
  perform public.activity_audit_attach('backup_restore_jobs');
end $$;

commit;
