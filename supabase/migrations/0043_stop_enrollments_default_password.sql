-- =====================================================================
-- 0043: STOP (إيقاف) FOR CHILDREN + DEFAULT PASSWORD 000000
--
-- A. enrollments.status ('active' | 'stopped')
--    A STOPPED child keeps his data, his enrollments and his history, but:
--      * no attendance / points can be logged for him (trigger guard on
--        attendance_log + points_log → exception `enrollment_stopped`),
--      * he cannot log in to the portal while every child enrollment of his
--        is stopped (`account_stopped`), live sessions are refused too,
--      * the children page shows him greyed out with a «موقوف» badge.
--    Servants already have `suspended`; their MIRROR enrollment now carries
--    status = 'stopped' while the account is suspended (sync trigger).
--
--    set_enrollments_status(status, ids | church → service → class, kind)
--    stops / re-activates ONE child, a list of children, or a WHOLE class /
--    service / church at once (children, servants or both) — scope-checked
--    with can_access / can_manage_servant. Used by إدارة المخدومين → المخدومين.
--
-- B. DEFAULT PASSWORD = 000000 (`default_password()`)
--    A child who never had a password set logs in with 000000; changing it
--    from the portal requires the old one (000000 counts as the old one).
--    Servant accounts are created with 000000 by default in the add flows
--    (client side); the reset section offers the default with one tap.
--
-- C. lookup_enrollments_by_national_id gains `kind` + `servant_id` + `status`.
-- Idempotent.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- A. enrollments.status
-- ---------------------------------------------------------------------
alter table public.enrollments
  add column if not exists status text not null default 'active';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'enrollments_status_check') then
    alter table public.enrollments add constraint enrollments_status_check check (status in ('active', 'stopped'));
  end if;
end $$;

create index if not exists idx_enrollments_status on public.enrollments(status) where status = 'stopped';

comment on column public.enrollments.status is
  'active = يعمل · stopped = موقوف (لا حضور ولا نقاط ولا دخول للبوابة) — يُدار من إدارة المخدومين ← المخدومين';

-- Default portal / login password
create or replace function public.default_password()
returns text language sql immutable as $$ select '000000'::text $$;
grant execute on function public.default_password() to anon, authenticated;

-- Guard: nothing can be logged against a stopped enrollment
create or replace function public.guard_stopped_enrollment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.enrollments e where e.id = new.enrollment_id and e.status = 'stopped') then
    raise exception 'enrollment_stopped' using errcode = 'P0020';
  end if;
  return new;
end $$;

drop trigger if exists trg_attendance_log_guard_stopped on public.attendance_log;
create trigger trg_attendance_log_guard_stopped
before insert on public.attendance_log
for each row execute function public.guard_stopped_enrollment();

drop trigger if exists trg_points_log_guard_stopped on public.points_log;
create trigger trg_points_log_guard_stopped
before insert on public.points_log
for each row execute function public.guard_stopped_enrollment();

-- The servant mirror follows the account: suspended ⇢ stopped
create or replace function public.sync_servant_mirror_enrollment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m   public.enrollments%rowtype;
  cur public.servant_enrollments%rowtype;
  v_status text;
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

  v_status := case when cur.status = 'suspended' then 'stopped' else 'active' end;

  select * into m from public.enrollments where servant_id = cur.id;
  if found then
    if m.person_id <> cur.person_id or m.church_id <> cur.church_id
       or m.service_id <> cur.service_id or m.class_id <> cur.class_id then
      begin
        update public.enrollments
           set person_id = cur.person_id, church_id = cur.church_id,
               service_id = cur.service_id, class_id = cur.class_id, status = v_status
         where id = m.id;
      exception when unique_violation then
        -- the person already has a row in the target class → adopt it
        delete from public.enrollments where id = m.id;
        update public.enrollments set kind = 'servant', servant_id = cur.id, status = v_status
         where person_id = cur.person_id and class_id = cur.class_id;
      end;
    elsif m.status <> v_status then
      update public.enrollments set status = v_status where id = m.id;
    end if;
  else
    insert into public.enrollments (person_id, church_id, service_id, class_id, kind, servant_id, status, created_by, edited_by)
    values (cur.person_id, cur.church_id, cur.service_id, cur.class_id, 'servant', cur.id, v_status,
            coalesce(cur.approved_by, cur.id), coalesce(cur.approved_by, cur.id))
    on conflict (person_id, class_id) do update
      set kind = 'servant', servant_id = excluded.servant_id, status = excluded.status;
  end if;
  return new;
end $$;

-- backfill mirrors of currently suspended servants
update public.enrollments e
   set status = 'stopped'
  from public.servant_enrollments s
 where e.servant_id = s.id and s.status = 'suspended' and e.status <> 'stopped';

-- ---------------------------------------------------------------------
-- set_enrollments_status — stop / activate one, many, or a whole scope
--   p_enrollment_ids  → exactly these CHILD rows (scope-checked per row)
--   p_church [→ p_service [→ p_class]] → the whole scope
--   p_kind: 'child' | 'servant' | 'all' (scope mode only)
-- Servants are stopped through their ACCOUNT (status suspended / approved);
-- the mirror row follows automatically.
-- ---------------------------------------------------------------------
create or replace function public.set_enrollments_status(
  p_status text,
  p_enrollment_ids uuid[] default null,
  p_church uuid default null,
  p_service uuid default null,
  p_class uuid default null,
  p_kind text default 'child'
) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_children int := 0;
  v_servants int := 0;
  v_srv_status public.approval_status;
begin
  if public.my_role() is null then raise exception 'not_approved' using errcode = '42501'; end if;
  if p_status not in ('active', 'stopped') then raise exception 'invalid_status' using errcode = '22023'; end if;
  if coalesce(p_kind, 'child') not in ('child', 'servant', 'all') then raise exception 'invalid_kind' using errcode = '22023'; end if;

  -- 1) explicit rows
  if p_enrollment_ids is not null then
    with upd as (
      update public.enrollments e
         set status = p_status, edited_by = auth.uid(), edited_at = now()
       where e.id = any (p_enrollment_ids)
         and e.kind = 'child'
         and e.status <> p_status
         and public.can_access(e.church_id, e.service_id, e.class_id)
      returning 1)
    select count(*) into v_children from upd;
    return jsonb_build_object('children', v_children, 'servants', 0);
  end if;

  -- 2) a whole scope
  if p_church is null then raise exception 'scope_required' using errcode = '22023'; end if;
  if not public.can_access(p_church, p_service, p_class) then raise exception 'forbidden' using errcode = '42501'; end if;

  if coalesce(p_kind, 'child') in ('child', 'all') then
    with upd as (
      update public.enrollments e
         set status = p_status, edited_by = auth.uid(), edited_at = now()
       where e.kind = 'child'
         and e.church_id = p_church
         and (p_service is null or e.service_id = p_service)
         and (p_class   is null or e.class_id   = p_class)
         and e.status <> p_status
      returning 1)
    select count(*) into v_children from upd;
  end if;

  if coalesce(p_kind, 'child') in ('servant', 'all') then
    v_srv_status := case when p_status = 'stopped' then 'suspended'::public.approval_status else 'approved'::public.approval_status end;
    with upd as (
      update public.servant_enrollments s
         set status = v_srv_status
       where s.church_id = p_church
         and (p_service is null or s.service_id = p_service)
         and (p_class   is null or s.class_id   = p_class)
         and s.status in ('approved', 'suspended')
         and s.status <> v_srv_status
         and public.can_manage_servant(s.id)
      returning 1)
    select count(*) into v_servants from upd;
  end if;

  return jsonb_build_object('children', v_children, 'servants', v_servants);
end $$;
revoke all on function public.set_enrollments_status(text, uuid[], uuid, uuid, uuid, text) from public, anon;
grant execute on function public.set_enrollments_status(text, uuid[], uuid, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- B. Portal login / password change with the DEFAULT password
-- ---------------------------------------------------------------------
create or replace function public.child_login(p_code text, p_password text, p_remember boolean default false, p_user_agent text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  p public.persons;
  c public.person_credentials;
  v_token text;
  v_exp timestamptz;
  v_default boolean := false;
begin
  if nullif(trim(coalesce(p_code, '')), '') is null then raise exception 'invalid_code' using errcode = 'P0001'; end if;
  select * into p from public.persons where national_id = trim(p_code);
  if not found then raise exception 'unknown_code' using errcode = 'P0002'; end if;
  -- a person that is only a servant (no child enrollment) can't use the portal
  if not exists (select 1 from public.enrollments e where e.person_id = p.id and e.kind = 'child') then
    raise exception 'unknown_code' using errcode = 'P0002';
  end if;
  -- stopped everywhere → no portal
  if not exists (select 1 from public.enrollments e where e.person_id = p.id and e.kind = 'child' and e.status = 'active') then
    raise exception 'account_stopped' using errcode = 'P0011';
  end if;

  select * into c from public.person_credentials where person_id = p.id;
  if not found then
    -- never set → the DEFAULT password applies
    v_default := true;
    if coalesce(p_password, '') <> public.default_password() then
      perform pg_sleep(0.25);
      raise exception 'wrong_password' using errcode = 'P0010';
    end if;
  elsif coalesce(p_password, '') = '' or c.password_hash <> crypt(p_password, c.password_hash) then
    perform pg_sleep(0.25);   -- slow down brute force a little
    raise exception 'wrong_password' using errcode = 'P0010';
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_exp := case when coalesce(p_remember, false) then now() + interval '90 days' else now() + interval '12 hours' end;
  insert into public.child_sessions (person_id, token_hash, remember, expires_at, user_agent)
  values (p.id, encode(digest(v_token, 'sha256'), 'hex'), coalesce(p_remember, false), v_exp, left(p_user_agent, 300));
  -- housekeeping
  delete from public.child_sessions where expires_at < now() - interval '1 day';

  return jsonb_build_object('token', v_token, 'expires_at', v_exp, 'person_id', p.id, 'remember', coalesce(p_remember, false),
                            'default_password', v_default);
end $$;
grant execute on function public.child_login(text, text, boolean, text) to anon, authenticated;

-- a stopped child loses his live sessions too
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
  if not exists (select 1 from public.enrollments e where e.person_id = s.person_id and e.kind = 'child' and e.status = 'active') then
    delete from public.child_sessions where person_id = s.person_id;
    raise exception 'account_stopped' using errcode = 'P0011';
  end if;
  update public.child_sessions
     set last_seen_at = now(),
         expires_at = case when remember then greatest(expires_at, now() + interval '90 days') else expires_at end
   where id = s.id
   returning * into s;
  return jsonb_build_object('person_id', s.person_id, 'expires_at', s.expires_at, 'remember', s.remember);
end $$;
grant execute on function public.child_session_touch(text) to anon, authenticated;

-- The child changes his own password — the old one is required (000000 when never set)
create or replace function public.child_change_password(p_token text, p_current text, p_new text)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  p public.persons;
  c public.person_credentials;
begin
  p := public.child_portal_person(p_token);
  if length(coalesce(p_new, '')) < 6 then raise exception 'weak_password' using errcode = 'P0001'; end if;
  select * into c from public.person_credentials where person_id = p.id;
  if not found then
    if coalesce(p_current, '') <> public.default_password() then
      raise exception 'wrong_password' using errcode = 'P0010';
    end if;
  elsif c.password_hash <> crypt(coalesce(p_current, ''), c.password_hash) then
    raise exception 'wrong_password' using errcode = 'P0010';
  end if;
  insert into public.person_credentials (person_id, password_hash, set_by)
  values (p.id, crypt(p_new, gen_salt('bf', 10)), null)
  on conflict (person_id) do update
    set password_hash = excluded.password_hash, updated_at = now();
  -- every OTHER session is closed
  delete from public.child_sessions
   where person_id = p.id
     and token_hash <> encode(digest(trim(p_token), 'sha256'), 'hex');
end $$;
grant execute on function public.child_change_password(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- C. Scanner lookup: expose kind + servant_id + status
-- ---------------------------------------------------------------------
drop function if exists public.lookup_enrollments_by_national_id(text);
create or replace function public.lookup_enrollments_by_national_id(p_national_id text)
returns table (
  id uuid, person_id uuid, church_id uuid, service_id uuid, class_id uuid,
  attendance_count integer, points integer, created_at timestamptz,
  kind text, servant_id uuid, status text,
  person jsonb)
language sql stable security invoker set search_path = public as $$
  select e.id, e.person_id, e.church_id, e.service_id, e.class_id,
         e.attendance_count, e.points, e.created_at,
         e.kind, e.servant_id, e.status,
         to_jsonb(p) as person
    from public.persons p
    join public.enrollments e on e.person_id = p.id
   where p.national_id = p_national_id
   order by e.created_at
$$;
grant execute on function public.lookup_enrollments_by_national_id(text) to authenticated;

commit;
