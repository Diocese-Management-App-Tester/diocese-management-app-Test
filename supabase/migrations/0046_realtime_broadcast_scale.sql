-- =====================================================================
-- 0046: SCALE — realtime broadcast instead of postgres_changes on the
--       hot tables, search indexes, dispatcher gate
--
-- WHY. With ~60–80 servants online on a scan day the app became laggy and
-- then failed. Every open app held 8–18 `postgres_changes` subscriptions
-- (header bells · 3 contexts · the page · up to 10 home widgets), many of
-- them on the HOT tables (attendance_log · points_log · enrollments ·
-- persons · contact_log · notification_recipients · chat_messages …).
-- For `postgres_changes` the Realtime server re-evaluates the table's RLS
-- policy ONCE PER CHANGE × PER SUBSCRIBER. One scan = 1 attendance_log
-- insert + 1 enrollments update (+ notification rows) → with 80 devices ×
-- ~10 channels that is ~3 000 policy queries hitting Postgres per scan —
-- the database saturated, every request queued behind it, the app "hung".
--
-- FIX. The hot tables leave the `supabase_realtime` publication. Instead a
-- STATEMENT-level trigger sends ONE small broadcast message per statement
-- (`realtime.send`) on a per-church topic (`scope:church:<id>`), plus
-- `scope:all` for the owner and `user:<uid>` for personal rows. Broadcast
-- authorization happens ONCE when the client joins the channel (RLS on
-- `realtime.messages`), not per row per subscriber. The browser keeps ONE
-- channel per topic and fans the message out to every screen/widget that
-- asked for that table (src/lib/realtime.ts) — the 84 call sites in the
-- app keep their code unchanged. Cost per scan: 2 tiny inserts, whatever
-- the number of connected devices.
--
-- ALSO
--   • pg_trgm GIN indexes on persons(name / phone / national_id) — the
--     search box issues `ilike '%x%'` which was a sequential scan of the
--     whole persons table per keystroke per user.
--   • composite indexes for the exact filters of the list / badges.
--   • notif_dispatch_gate(): the push dispatcher was kicked by EVERY open
--     app every 2 minutes (80 users → 40 serverless runs a minute, each
--     running notif_tick() with the service role). The gate lets one run
--     through per interval and answers "skip" to the others.
--
-- Idempotent; safe on a plain Postgres without the realtime schema (the
-- broadcast helper degrades to a no-op there). Rollback: re-add the tables
-- to the publication (see the bottom comment).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Broadcast helper — no-op when realtime.send is unavailable
-- ---------------------------------------------------------------------
create or replace function public.rt_send(p_topic text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  begin
    perform realtime.send(p_payload, 'change', p_topic, true);
  exception
    when undefined_function or invalid_schema_name or undefined_table then
      null; -- local Postgres / realtime not installed → nothing to do
    when others then
      raise notice 'rt_send skipped: %', sqlerrm;
  end;
end $$;
revoke all on function public.rt_send(text, jsonb) from public, anon, authenticated;

-- Send one message about `p_table` to every church in `p_churches` (+ the
-- owner topic). ids: first 50 affected ids so screens can patch locally.
create or replace function public.rt_notify_scope(p_table text, p_op text, p_churches uuid[], p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  c uuid;
  payload jsonb := jsonb_build_object(
    't', p_table, 'op', p_op,
    'n', coalesce(array_length(p_ids, 1), 0),
    'ids', to_jsonb(coalesce(p_ids[1:50], '{}'::uuid[])));
begin
  perform public.rt_send('scope:all', payload);
  if p_churches is not null then
    foreach c in array p_churches loop
      if c is not null then perform public.rt_send('scope:church:' || c::text, payload); end if;
    end loop;
  end if;
end $$;
revoke all on function public.rt_notify_scope(text, text, uuid[], uuid[]) from public, anon, authenticated;

create or replace function public.rt_notify_users(p_table text, p_op text, p_users uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  u uuid;
  payload jsonb := jsonb_build_object('t', p_table, 'op', p_op);
begin
  if p_users is null then return; end if;
  foreach u in array p_users loop
    if u is not null then perform public.rt_send('user:' || u::text, payload); end if;
  end loop;
end $$;
revoke all on function public.rt_notify_users(text, text, uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Statement-level triggers (transition tables → ONE message per
--    statement, however many rows a bulk import / scan burst touched)
-- ---------------------------------------------------------------------

-- Tables carrying church_id directly (enrollments · store_orders …)
create or replace function public.rt_trg_scoped()
returns trigger language plpgsql security definer set search_path = public as $$
declare churches uuid[]; ids uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct church_id), array_agg(id) into churches, ids from new_rows;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct church_id), array_agg(id) into churches, ids from old_rows;
  else
    select array_agg(distinct church_id), array_agg(distinct id) into churches, ids
      from (select church_id, id from new_rows union all select church_id, id from old_rows) x;
  end if;
  if ids is not null then perform public.rt_notify_scope(tg_table_name, tg_op, churches, ids); end if;
  return null;
end $$;

-- Tables that reach the church through enrollment_id (attendance_log ·
-- points_log · contact_log · card_print_requests · user_achievements)
create or replace function public.rt_trg_by_enrollment()
returns trigger language plpgsql security definer set search_path = public as $$
declare churches uuid[]; ids uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct e.church_id), array_agg(n.enrollment_id) into churches, ids
      from new_rows n join public.enrollments e on e.id = n.enrollment_id;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct e.church_id), array_agg(o.enrollment_id) into churches, ids
      from old_rows o join public.enrollments e on e.id = o.enrollment_id;
  else
    select array_agg(distinct e.church_id), array_agg(distinct n.enrollment_id) into churches, ids
      from new_rows n join public.enrollments e on e.id = n.enrollment_id;
  end if;
  if churches is not null then perform public.rt_notify_scope(tg_table_name, tg_op, churches, ids); end if;
  return null;
end $$;

-- persons: church through the person's enrollments (a person with no
-- enrollment yet is only interesting to the one who is creating him)
create or replace function public.rt_trg_persons()
returns trigger language plpgsql security definer set search_path = public as $$
declare churches uuid[]; ids uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(id) into ids from new_rows;
  elsif tg_op = 'DELETE' then
    select array_agg(id) into ids from old_rows;
  else
    select array_agg(id) into ids from new_rows;
  end if;
  if ids is null then return null; end if;
  select array_agg(distinct e.church_id) into churches
    from public.enrollments e where e.person_id = any(ids);
  perform public.rt_notify_scope('persons', tg_op, churches, ids);
  return null;
end $$;

-- notification_recipients → the staff recipient's personal topic.
-- (Children have no auth session → the child portal polls, see the app.)
create or replace function public.rt_trg_notification_recipients()
returns trigger language plpgsql security definer set search_path = public as $$
declare users uuid[];
begin
  if tg_op = 'DELETE' then
    select array_agg(distinct profile_id) into users from old_rows where profile_id is not null;
  else
    select array_agg(distinct profile_id) into users from new_rows where profile_id is not null;
  end if;
  perform public.rt_notify_users('notification_recipients', tg_op, users);
  return null;
end $$;

-- chat_messages: staff ↔ staff → both parties; child conversations and
-- broadcasts → the church topic (null church = every church)
create or replace function public.rt_trg_chat_messages()
returns trigger language plpgsql security definer set search_path = public as $$
declare users uuid[]; churches uuid[]; ids uuid[]; any_all boolean;
begin
  if tg_op = 'DELETE' then return null; end if;
  select array_agg(distinct u) into users
    from (select to_profile_id u from new_rows where to_profile_id is not null
          union select sender_profile_id from new_rows where sender_profile_id is not null) x;
  select array_agg(distinct church_id), array_agg(id), bool_or(church_id is null)
    into churches, ids, any_all
    from new_rows where kind <> 'staff';
  if any_all then select array_agg(id) into churches from public.churches; end if;
  if users is not null then perform public.rt_notify_users('chat_messages', tg_op, users); end if;
  if ids is not null then perform public.rt_notify_scope('chat_messages', tg_op, churches, ids); end if;
  return null;
end $$;

create or replace function public.rt_trg_chat_read_state()
returns trigger language plpgsql security definer set search_path = public as $$
declare users uuid[];
begin
  if tg_op = 'DELETE' then
    select array_agg(distinct reader_profile_id) into users from old_rows where reader_profile_id is not null;
  else
    select array_agg(distinct reader_profile_id) into users from new_rows where reader_profile_id is not null;
  end if;
  perform public.rt_notify_users('chat_read_state', tg_op, users);
  return null;
end $$;

-- servant_enrollments / servant_scopes: the servant himself (approval,
-- role change, new place) + his church (managers' lists)
create or replace function public.rt_trg_servant_enrollments()
returns trigger language plpgsql security definer set search_path = public as $$
declare users uuid[]; churches uuid[]; ids uuid[];
begin
  if tg_op = 'DELETE' then
    select array_agg(id), array_agg(distinct church_id) into ids, churches from old_rows;
  elsif tg_op = 'INSERT' then
    select array_agg(id), array_agg(distinct church_id) into ids, churches from new_rows;
  else
    select array_agg(distinct id), array_agg(distinct church_id) into ids, churches
      from (select id, church_id from new_rows union all select id, church_id from old_rows) x;
  end if;
  users := ids;
  perform public.rt_notify_users('servant_enrollments', tg_op, users);
  perform public.rt_notify_scope('servant_enrollments', tg_op, churches, ids);
  return null;
end $$;

create or replace function public.rt_trg_servant_scopes()
returns trigger language plpgsql security definer set search_path = public as $$
declare users uuid[]; churches uuid[];
begin
  if tg_op = 'DELETE' then
    select array_agg(distinct servant_id), array_agg(distinct church_id) into users, churches from old_rows;
  else
    select array_agg(distinct servant_id), array_agg(distinct church_id) into users, churches from new_rows;
  end if;
  perform public.rt_notify_users('servant_scopes', tg_op, users);
  perform public.rt_notify_scope('servant_scopes', tg_op, churches, users);
  return null;
end $$;

-- Attach: for each (table, function) three statement triggers with the
-- right transition tables. Skips tables that don't exist (older DBs).
do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('enrollments',             'rt_trg_scoped'),
      ('store_orders',            'rt_trg_scoped'),
      ('attendance_log',          'rt_trg_by_enrollment'),
      ('points_log',              'rt_trg_by_enrollment'),
      ('contact_log',             'rt_trg_by_enrollment'),
      ('card_print_requests',     'rt_trg_by_enrollment'),
      ('user_achievements',       'rt_trg_by_enrollment'),
      ('persons',                 'rt_trg_persons'),
      ('notification_recipients', 'rt_trg_notification_recipients'),
      ('chat_messages',           'rt_trg_chat_messages'),
      ('chat_read_state',         'rt_trg_chat_read_state'),
      ('servant_enrollments',     'rt_trg_servant_enrollments'),
      ('servant_scopes',          'rt_trg_servant_scopes')
    ) as t(tbl, fn)
  loop
    if to_regclass('public.' || spec.tbl) is null then continue; end if;
    -- user_achievements may not carry enrollment_id in old schemas
    if spec.fn = 'rt_trg_by_enrollment' and not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = spec.tbl and column_name = 'enrollment_id') then
      continue;
    end if;
    execute format('drop trigger if exists zzz_rt_ins on public.%I', spec.tbl);
    execute format('drop trigger if exists zzz_rt_upd on public.%I', spec.tbl);
    execute format('drop trigger if exists zzz_rt_del on public.%I', spec.tbl);
    execute format(
      'create trigger zzz_rt_ins after insert on public.%I referencing new table as new_rows for each statement execute function public.%I()',
      spec.tbl, spec.fn);
    execute format(
      'create trigger zzz_rt_upd after update on public.%I referencing old table as old_rows new table as new_rows for each statement execute function public.%I()',
      spec.tbl, spec.fn);
    execute format(
      'create trigger zzz_rt_del after delete on public.%I referencing old table as old_rows for each statement execute function public.%I()',
      spec.tbl, spec.fn);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. Authorize the private broadcast topics (RLS on realtime.messages)
--      user:<uid>          — only that servant
--      scope:all           — the owner
--      scope:church:<id>   — anyone whose scopes include that church
-- ---------------------------------------------------------------------
create or replace function public.rt_topic_allowed(p_topic text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_topic = 'user:' || coalesce(auth.uid()::text, '') then true
    when p_topic = 'scope:all' then public.is_owner()
    when p_topic like 'scope:church:%' then
      public.is_owner()
      or exists (select 1 from public.my_scopes() s
                  where s.church_id is not null and s.church_id::text = split_part(p_topic, ':', 3))
    else false
  end
$$;
grant execute on function public.rt_topic_allowed(text) to authenticated;

do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists "rt scope topics read" on realtime.messages';
    execute $p$create policy "rt scope topics read" on realtime.messages
              for select to authenticated
              using (public.rt_topic_allowed(realtime.topic()))$p$;
  end if;
exception when others then
  raise notice 'realtime.messages policy skipped: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 4. Take the hot tables OUT of the postgres_changes publication
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'attendance_log', 'points_log', 'contact_log', 'enrollments', 'persons',
    'notification_recipients', 'chat_messages', 'chat_read_state', 'store_orders',
    'card_print_requests', 'user_achievements', 'servant_enrollments', 'servant_scopes'
  ] loop
    if exists (select 1 from pg_publication_tables
                where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. Search: trigram indexes for the `ilike '%x%'` filters
-- ---------------------------------------------------------------------
do $$
declare nsp text;
begin
  if exists (select 1 from pg_namespace where nspname = 'extensions') then
    create extension if not exists pg_trgm with schema extensions;
  else
    create extension if not exists pg_trgm;
  end if;
  select n.nspname into nsp from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  execute format('create index if not exists idx_persons_name_trgm on public.persons using gin (name %I.gin_trgm_ops)', nsp);
  execute format('create index if not exists idx_persons_phone_trgm on public.persons using gin (phone %I.gin_trgm_ops)', nsp);
  execute format('create index if not exists idx_persons_national_id_trgm on public.persons using gin (national_id %I.gin_trgm_ops)', nsp);
exception when others then
  raise notice 'pg_trgm indexes skipped: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 6. Composite indexes for the list / badge queries
-- ---------------------------------------------------------------------
create index if not exists idx_enrollments_kind_class   on public.enrollments(kind, class_id);
create index if not exists idx_enrollments_kind_service on public.enrollments(kind, service_id);
create index if not exists idx_enrollments_kind_church  on public.enrollments(kind, church_id);
create index if not exists idx_attendance_log_event_enrollment
  on public.attendance_log(event_id, enrollment_id, attended_on);
do $$
begin
  if to_regclass('public.notification_recipients') is not null then
    create index if not exists idx_notif_rcpt_profile_unread
      on public.notification_recipients(profile_id) where read_at is null;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. Dispatcher gate — at most ONE push-dispatch run per interval.
--    Own tiny table (NOT app_settings: that table is streamed to every
--    client through postgres_changes and a write there would make every
--    device reload its customization).
-- ---------------------------------------------------------------------
create table if not exists public.rt_gates (
  key        text primary key,
  fired_at   timestamptz not null default now()
);
alter table public.rt_gates enable row level security;
revoke all on public.rt_gates from public, anon, authenticated;

create or replace function public.notif_dispatch_gate(p_min_seconds integer default 45)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare ok boolean := false;
begin
  insert into public.rt_gates (key, fired_at) values ('notif_dispatch', now())
  on conflict (key) do update
    set fired_at = now()
    where public.rt_gates.fired_at <= now() - make_interval(secs => p_min_seconds)
  returning true into ok;
  return coalesce(ok, false);
end $$;
revoke all on function public.notif_dispatch_gate(integer) from public, anon, authenticated;
grant execute on function public.notif_dispatch_gate(integer) to service_role;

analyze public.persons;
analyze public.enrollments;
analyze public.attendance_log;

commit;

-- ---------------------------------------------------------------------
-- ROLLBACK (manual): drop the zzz_rt_* triggers and re-add the tables:
--   alter publication supabase_realtime add table public.attendance_log,
--     public.points_log, public.contact_log, public.enrollments, public.persons,
--     public.notification_recipients, public.chat_messages, public.chat_read_state,
--     public.store_orders, public.card_print_requests, public.user_achievements,
--     public.servant_enrollments, public.servant_scopes;
-- ---------------------------------------------------------------------
