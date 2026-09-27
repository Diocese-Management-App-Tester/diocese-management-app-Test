-- =====================================================================
-- 20260927120000 — PRIEST PORTAL (بوابة الكاهن) + المعترفين + الافتقاد
-- =====================================================================
-- A THIRD portal next to the servants' app and the child portal.
--
-- IDENTITY
--   The priest is a PERSON (persons row — code = national_id = QR = login
--   name) bound to ONE church through `priests`. Signup (/priest/signup)
--   writes a `priest_requests` snapshot (like child_join_requests); ONLY THE
--   OWNER approves / rejects / edits / suspends priests (وحدة المالك →
--   الكهنة) — or adds a priest directly. Login (/login → دخول الكاهن) is
--   code + password → `priest_login` → a session token (sha256 in
--   `priest_sessions`, 12 h / 90 d with «تذكرني»). Every priest_* RPC
--   receives the token and resolves it with `priest_portal_self(token)`.
--
-- MODULES (more will follow)
--   المعترفين  priest_confessors — persons the priest is the confession
--              father of. Added by SCAN (card QR) · SEARCH (name / phone /
--              code among the persons of his church) · NEW PERSON (created
--              here). `confessions` — one row per confession (day + notes);
--              «آخر اعتراف» = max(confessed_on); a confessor with no
--              confession for more than `priests.reminder_days` (default 40)
--              is OVERDUE (reminder on the home page + red badge). Call /
--              WhatsApp / SMS are logged in `priest_contacts`.
--              `confession_appointments` — the appointment list by day: the
--              priest books one himself (approved right away) or the CHILD
--              asks for a date from his portal (pending) and the priest
--              approves (may move it) / rejects. When the confession
--              happens the priest marks it done → a `confessions` row.
--   الافتقاد   the same confessors ordered by the last contact / last
--              confession with call · WhatsApp · SMS buttons + history.
--
-- SECURITY
--   No direct table access for anon / authenticated except: owner SELECT on
--   priests / priest_requests (password_hash never granted). Everything else
--   goes through SECURITY DEFINER RPCs that validate the token / the owner.
--   Audit: actor kind `priest` (activity_log), tables attached to the audit
--   trigger; sessions are not audited (token hashes).
-- =====================================================================
begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------
create table if not exists public.priest_requests (
  id             uuid primary key default gen_random_uuid(),
  code           text not null,
  name           text not null,
  title          text,
  gender         text check (gender in ('male', 'female')),
  birthdate      date,
  phone          text,
  address        text,
  notes          text,
  image_url      text,
  password_hash  text not null,
  church_id      uuid references public.churches(id) on delete set null,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decision_note  text,
  decided_by     uuid references public.servant_enrollments(id) on delete set null,
  decided_at     timestamptz,
  priest_id      uuid,
  created_at     timestamptz not null default now()
);
create index if not exists idx_priest_requests_status on public.priest_requests(status, created_at desc);
create unique index if not exists uq_priest_requests_pending_code on public.priest_requests(code) where status = 'pending';
comment on table public.priest_requests is 'طلبات إنشاء حساب كاهن من صفحة «إنشاء حساب كاهن» — يوافق عليها المالك فقط';
alter table public.priest_requests enable row level security;
alter table public.priest_requests replica identity full;

create table if not exists public.priests (
  id             uuid primary key default gen_random_uuid(),
  person_id      uuid not null unique references public.persons(id) on delete cascade,
  church_id      uuid not null references public.churches(id) on delete restrict,
  title          text,
  status         text not null default 'approved' check (status in ('pending', 'approved', 'rejected', 'suspended')),
  password_hash  text not null,
  reminder_days  integer not null default 40 check (reminder_days between 1 and 365),
  notes          text,
  approved_by    uuid references public.servant_enrollments(id) on delete set null,
  approved_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_priests_church on public.priests(church_id);
comment on table public.priests is 'الكهنة — شخص (كود = اسم الدخول) مرتبط بكنيسة؛ الموافقة والتعديل للمالك فقط';
alter table public.priests enable row level security;
alter table public.priests replica identity full;

create table if not exists public.priest_sessions (
  id           uuid primary key default gen_random_uuid(),
  priest_id    uuid not null references public.priests(id) on delete cascade,
  token_hash   text not null unique,
  remember     boolean not null default false,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_seen_at timestamptz not null default now(),
  user_agent   text
);
create index if not exists idx_priest_sessions_priest on public.priest_sessions(priest_id);
comment on table public.priest_sessions is 'جلسات بوابة الكاهن — التوكن مخزَّن كـ sha256';
alter table public.priest_sessions enable row level security;
revoke all on public.priest_sessions from anon, authenticated;

create table if not exists public.priest_confessors (
  id          uuid primary key default gen_random_uuid(),
  priest_id   uuid not null references public.priests(id) on delete cascade,
  person_id   uuid not null references public.persons(id) on delete cascade,
  notes       text,
  created_at  timestamptz not null default now(),
  unique (priest_id, person_id)
);
create index if not exists idx_priest_confessors_person on public.priest_confessors(person_id);
comment on table public.priest_confessors is 'المعترفون — الأشخاص الذين يعترفون عند هذا الكاهن';
alter table public.priest_confessors enable row level security;
revoke all on public.priest_confessors from anon, authenticated;

create table if not exists public.confessions (
  id             uuid primary key default gen_random_uuid(),
  priest_id      uuid not null references public.priests(id) on delete cascade,
  person_id      uuid not null references public.persons(id) on delete cascade,
  confessed_on   date not null default ((now() at time zone 'Africa/Cairo')::date),
  notes          text,
  appointment_id uuid,
  created_at     timestamptz not null default now()
);
create index if not exists idx_confessions_pair on public.confessions(priest_id, person_id, confessed_on desc);
comment on table public.confessions is 'سجل الاعترافات — يوم الاعتراف لكل معترف (آخر اعتراف = الأحدث)';
alter table public.confessions enable row level security;
revoke all on public.confessions from anon, authenticated;

create table if not exists public.confession_appointments (
  id              uuid primary key default gen_random_uuid(),
  priest_id       uuid not null references public.priests(id) on delete cascade,
  person_id       uuid not null references public.persons(id) on delete cascade,
  requested_by    text not null default 'priest' check (requested_by in ('priest', 'child')),
  requested_on    date not null,
  requested_time  time,
  note            text,
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled', 'done')),
  scheduled_on    date,
  scheduled_time  time,
  decision_note   text,
  decided_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists idx_conf_appts_priest_day on public.confession_appointments(priest_id, status, requested_on);
create index if not exists idx_conf_appts_person on public.confession_appointments(person_id, created_at desc);
comment on table public.confession_appointments is 'مواعيد الاعتراف — يطلبها المخدوم من بوابته أو يحددها الكاهن؛ الكاهن يوافق / يرفض / يسجّلها كتمّت';
alter table public.confession_appointments enable row level security;
revoke all on public.confession_appointments from anon, authenticated;

create table if not exists public.priest_contacts (
  id          uuid primary key default gen_random_uuid(),
  priest_id   uuid not null references public.priests(id) on delete cascade,
  person_id   uuid not null references public.persons(id) on delete cascade,
  kind        text not null check (kind in ('call', 'whatsapp', 'sms', 'note')),
  message     text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_priest_contacts_pair on public.priest_contacts(priest_id, person_id, created_at desc);
comment on table public.priest_contacts is 'افتقاد الكاهن — مكالمات ورسائل للمعترفين';
alter table public.priest_contacts enable row level security;
revoke all on public.priest_contacts from anon, authenticated;

-- ---- owner read access (RLS) — the password hash is never granted
drop policy if exists priests_owner_select on public.priests;
create policy priests_owner_select on public.priests for select to authenticated using ((select public.is_owner()));
revoke all on public.priests from anon, authenticated;
grant select (id, person_id, church_id, title, status, reminder_days, notes, approved_by, approved_at, created_at, updated_at)
  on public.priests to authenticated;

drop policy if exists priest_requests_owner_select on public.priest_requests;
create policy priest_requests_owner_select on public.priest_requests for select to authenticated using ((select public.is_owner()));
drop policy if exists priest_requests_owner_delete on public.priest_requests;
create policy priest_requests_owner_delete on public.priest_requests for delete to authenticated using ((select public.is_owner()));
revoke all on public.priest_requests from anon, authenticated;
grant select (id, code, name, title, gender, birthdate, phone, address, notes, image_url, church_id, status,
              decision_note, decided_by, decided_at, priest_id, created_at),
      delete on public.priest_requests to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.priests;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.priest_requests;
exception when duplicate_object then null; end $$;

-- updated_at
create or replace function public.priests_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_priests_touch on public.priests;
create trigger trg_priests_touch before update on public.priests for each row execute function public.priests_touch();

-- ---------------------------------------------------------------------
-- 2. STORAGE — the anonymous priest portal / signup may upload under
--    photos/priests/ (priest photo at signup, photos of new confessors)
-- ---------------------------------------------------------------------
drop policy if exists "photos_priest_upload" on storage.objects;
create policy "photos_priest_upload" on storage.objects for insert to anon
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = 'priests');

-- ---------------------------------------------------------------------
-- 3. ACTIVITY LOG — actor kind `priest`
-- ---------------------------------------------------------------------
alter table public.activity_log drop constraint if exists activity_log_actor_kind_check;
alter table public.activity_log add constraint activity_log_actor_kind_check
  check (actor_kind in ('servant', 'child', 'priest', 'system'));

create or replace function public.activity_actor()
returns table (kind text, id uuid, name text, role text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_variable
declare
  uid uuid := auth.uid();
  cid text := current_setting('app.child_actor', true);
  prid text := current_setting('app.priest_actor', true);
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
  if nullif(prid, '') is not null then
    return query select 'priest'::text, pr.id, p.name, 'priest'::text
      from public.priests pr join public.persons p on p.id = pr.person_id where pr.id = prid::uuid;
    if found then return; end if;
  end if;
  if nullif(cid, '') is not null then
    return query select 'child'::text, p.id, p.name, 'child'::text from public.persons p where p.id = cid::uuid;
    if found then return; end if;
  end if;
  return query select 'system'::text, null::uuid, null::text,
    case when auth.role() = 'service_role' then 'service_role' else 'system' end;
end $$;
revoke all on function public.activity_actor() from public, anon, authenticated;

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
    'priests', 'priest_requests', 'priest_confessors', 'confessions', 'confession_appointments', 'priest_contacts'
  ]
$$;

do $$ begin
  if to_regprocedure('public.activity_audit_attach(text)') is not null then
    perform public.activity_audit_attach('priests');
    perform public.activity_audit_attach('priest_requests');
    perform public.activity_audit_attach('priest_confessors');
    perform public.activity_audit_attach('confessions');
    perform public.activity_audit_attach('confession_appointments');
    perform public.activity_audit_attach('priest_contacts');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. HELPERS
-- ---------------------------------------------------------------------
create or replace function public.cairo_today_date()
returns date language sql stable as $$ select (now() at time zone 'Africa/Cairo')::date $$;

-- person → compact json for the portal lists
create or replace function public.priest_person_json(p public.persons)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'id', p.id, 'national_id', p.national_id, 'name', p.name, 'gender', p.gender,
    'birthdate', p.birthdate, 'phone', p.phone, 'address', p.address, 'notes', p.notes,
    'image_url', p.image_url, 'created_at', p.created_at)
$$;

-- the places of a person (church → service → class names) — for the lists
create or replace function public.priest_person_places(p_person uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'enrollment_id', e.id, 'kind', e.kind, 'status', e.status,
           'church_name', ch.name, 'service_name', sv.name, 'class_name', cl.name) order by e.created_at), '[]'::jsonb)
    from public.enrollments e
    join public.churches ch on ch.id = e.church_id
    join public.services sv on sv.id = e.service_id
    join public.classes cl on cl.id = e.class_id
   where e.person_id = p_person
$$;

-- ---------------------------------------------------------------------
-- 5. SESSIONS — resolver · login · logout · touch · change password
-- ---------------------------------------------------------------------
create or replace function public.priest_portal_self(p_token text)
returns public.priests language plpgsql stable security definer set search_path = public, extensions as $$
declare
  s public.priest_sessions;
  pr public.priests;
begin
  if p_token is null or length(trim(p_token)) < 20 then
    raise exception 'invalid_code' using errcode = 'P0001';
  end if;
  select * into s from public.priest_sessions where token_hash = encode(digest(trim(p_token), 'sha256'), 'hex');
  if not found or s.expires_at < now() then
    raise exception 'session_expired' using errcode = 'P0002';
  end if;
  select * into pr from public.priests where id = s.priest_id;
  if not found then raise exception 'session_expired' using errcode = 'P0002'; end if;
  if pr.status <> 'approved' then raise exception 'account_stopped' using errcode = 'P0001'; end if;
  perform set_config('app.priest_actor', pr.id::text, true);
  return pr;
end $$;
revoke all on function public.priest_portal_self(text) from public, anon, authenticated;

create or replace function public.priest_login(p_code text, p_password text, p_remember boolean default false, p_user_agent text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  p public.persons;
  pr public.priests;
  v_token text;
  v_exp timestamptz;
begin
  if nullif(trim(coalesce(p_code, '')), '') is null then raise exception 'invalid_code' using errcode = 'P0001'; end if;
  if exists (select 1 from public.priest_requests r where r.code = trim(p_code) and r.status = 'pending') then
    raise exception 'pending_approval' using errcode = 'P0001';
  end if;
  select * into p from public.persons where national_id = trim(p_code);
  if not found then raise exception 'unknown_code' using errcode = 'P0002'; end if;
  select * into pr from public.priests where person_id = p.id;
  if not found then raise exception 'not_priest' using errcode = 'P0002'; end if;
  if coalesce(p_password, '') = '' or pr.password_hash <> crypt(p_password, pr.password_hash) then
    perform pg_sleep(0.25);
    raise exception 'wrong_password' using errcode = 'P0010';
  end if;
  if pr.status = 'pending' then raise exception 'pending_approval' using errcode = 'P0001'; end if;
  if pr.status = 'rejected' then raise exception 'account_rejected' using errcode = 'P0001'; end if;
  if pr.status = 'suspended' then raise exception 'account_stopped' using errcode = 'P0001'; end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_exp := case when coalesce(p_remember, false) then now() + interval '90 days' else now() + interval '12 hours' end;
  insert into public.priest_sessions (priest_id, token_hash, remember, expires_at, user_agent)
  values (pr.id, encode(digest(v_token, 'sha256'), 'hex'), coalesce(p_remember, false), v_exp, left(p_user_agent, 300));
  delete from public.priest_sessions where expires_at < now() - interval '1 day';
  perform set_config('app.priest_actor', pr.id::text, true);
  return jsonb_build_object('token', v_token, 'expires_at', v_exp, 'priest_id', pr.id, 'remember', coalesce(p_remember, false));
end $$;
grant execute on function public.priest_login(text, text, boolean, text) to anon, authenticated;

create or replace function public.priest_logout(p_token text)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
begin
  if nullif(trim(coalesce(p_token, '')), '') is null then return; end if;
  delete from public.priest_sessions where token_hash = encode(digest(trim(p_token), 'sha256'), 'hex');
end $$;
grant execute on function public.priest_logout(text) to anon, authenticated;

create or replace function public.priest_session_touch(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare s public.priest_sessions; pr public.priests;
begin
  if p_token is null or length(trim(p_token)) < 20 then raise exception 'invalid_code' using errcode = 'P0001'; end if;
  select * into s from public.priest_sessions where token_hash = encode(digest(trim(p_token), 'sha256'), 'hex');
  if not found then raise exception 'session_expired' using errcode = 'P0002'; end if;
  if s.expires_at < now() then
    delete from public.priest_sessions where id = s.id;
    raise exception 'session_expired' using errcode = 'P0002';
  end if;
  select * into pr from public.priests where id = s.priest_id;
  if not found or pr.status <> 'approved' then raise exception 'account_stopped' using errcode = 'P0001'; end if;
  update public.priest_sessions
     set last_seen_at = now(),
         expires_at = case when remember then greatest(expires_at, now() + interval '90 days') else expires_at end
   where id = s.id
   returning * into s;
  return jsonb_build_object('priest_id', s.priest_id, 'expires_at', s.expires_at, 'remember', s.remember);
end $$;
grant execute on function public.priest_session_touch(text) to anon, authenticated;

create or replace function public.priest_change_password(p_token text, p_current text, p_new text)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests;
begin
  pr := public.priest_portal_self(p_token);
  if length(coalesce(p_new, '')) < 6 then raise exception 'weak_password' using errcode = 'P0001'; end if;
  if pr.password_hash <> crypt(coalesce(p_current, ''), pr.password_hash) then
    raise exception 'wrong_password' using errcode = 'P0010';
  end if;
  update public.priests set password_hash = crypt(p_new, gen_salt('bf', 10)) where id = pr.id;
  delete from public.priest_sessions
   where priest_id = pr.id and token_hash <> encode(digest(trim(p_token), 'sha256'), 'hex');
end $$;
grant execute on function public.priest_change_password(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. SIGNUP (anonymous) → a pending request the OWNER reviews
-- ---------------------------------------------------------------------
create or replace function public.priest_signup_lookup_code(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when nullif(trim(p_code), '') is null then null
    else jsonb_build_object(
      'exists', exists (select 1 from public.persons p where p.national_id = trim(p_code)),
      'is_priest', exists (select 1 from public.persons p join public.priests pr on pr.person_id = p.id where p.national_id = trim(p_code)),
      'pending', exists (select 1 from public.priest_requests r where r.code = trim(p_code) and r.status = 'pending'),
      'name', (select p.name from public.persons p where p.national_id = trim(p_code) limit 1)
    )
  end
$$;
grant execute on function public.priest_signup_lookup_code(text) to anon, authenticated;

create or replace function public.priest_signup(
  p_code text, p_name text, p_password text, p_church uuid,
  p_title text default null, p_gender text default null, p_birthdate date default null,
  p_phone text default null, p_address text default null, p_notes text default null, p_image_url text default null
) returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_code text := nullif(trim(coalesce(p_code, '')), '');
  v_id uuid;
begin
  if v_code is null then raise exception 'code_required' using errcode = '22023'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required' using errcode = '22023'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'weak_password' using errcode = '22023'; end if;
  if p_gender is not null and p_gender not in ('male', 'female') then raise exception 'invalid_gender' using errcode = '22023'; end if;
  if p_church is null or not exists (select 1 from public.churches c where c.id = p_church) then
    raise exception 'church_required' using errcode = '22023';
  end if;
  if exists (select 1 from public.persons p join public.priests pr on pr.person_id = p.id where p.national_id = v_code) then
    raise exception 'already_registered' using errcode = '23505';
  end if;
  if exists (select 1 from public.priest_requests r where r.code = v_code and r.status = 'pending') then
    raise exception 'pending_exists' using errcode = '23505';
  end if;
  insert into public.priest_requests (code, name, title, gender, birthdate, phone, address, notes, image_url, password_hash, church_id)
  values (v_code, trim(p_name), nullif(trim(coalesce(p_title, '')), ''), p_gender, p_birthdate,
          nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_address, '')), ''),
          nullif(trim(coalesce(p_notes, '')), ''), p_image_url, crypt(p_password, gen_salt('bf', 10)), p_church)
  returning id into v_id;
  return jsonb_build_object('request_id', v_id, 'code', v_code);
end $$;
grant execute on function public.priest_signup(text, text, text, uuid, text, text, date, text, text, text, text) to anon, authenticated;

create or replace function public.priest_signup_status(p_request uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('status', r.status, 'decision_note', r.decision_note, 'code', r.code)
    from public.priest_requests r where r.id = p_request
$$;
grant execute on function public.priest_signup_status(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. OWNER — review · add · edit · password · delete · overview
-- ---------------------------------------------------------------------
create or replace function public.owner_review_priest_request(
  p_request uuid, p_approve boolean, p_note text default null, p_church uuid default null, p_title text default null
) returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  r public.priest_requests;
  v_person public.persons%rowtype;
  v_church uuid;
  v_priest uuid;
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into r from public.priest_requests where id = p_request;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then raise exception 'not_pending' using errcode = 'P0001'; end if;

  if not p_approve then
    update public.priest_requests
       set status = 'rejected', decision_note = nullif(trim(coalesce(p_note, '')), ''), decided_by = auth.uid(), decided_at = now()
     where id = r.id;
    return jsonb_build_object('status', 'rejected');
  end if;

  v_church := coalesce(p_church, r.church_id);
  if v_church is null or not exists (select 1 from public.churches c where c.id = v_church) then
    raise exception 'church_required' using errcode = '22023';
  end if;

  select * into v_person from public.persons where national_id = r.code;
  if not found then
    insert into public.persons (national_id, name, gender, birthdate, phone, address, notes, image_url, created_by, edited_by)
    values (r.code, r.name, r.gender, r.birthdate, r.phone, r.address, r.notes, r.image_url, auth.uid(), auth.uid())
    returning * into v_person;
  else
    update public.persons set
      gender = coalesce(gender, r.gender), birthdate = coalesce(birthdate, r.birthdate),
      phone = coalesce(phone, r.phone), address = coalesce(address, r.address),
      notes = coalesce(notes, r.notes), image_url = coalesce(image_url, r.image_url),
      edited_by = auth.uid(), edited_at = now()
    where id = v_person.id returning * into v_person;
  end if;
  if exists (select 1 from public.priests where person_id = v_person.id) then
    raise exception 'already_registered' using errcode = '23505';
  end if;

  insert into public.priests (person_id, church_id, title, status, password_hash, approved_by, approved_at)
  values (v_person.id, v_church, coalesce(nullif(trim(coalesce(p_title, '')), ''), r.title), 'approved', r.password_hash, auth.uid(), now())
  returning id into v_priest;

  update public.priest_requests
     set status = 'approved', decision_note = nullif(trim(coalesce(p_note, '')), ''), decided_by = auth.uid(), decided_at = now(),
         church_id = v_church, priest_id = v_priest
   where id = r.id;
  return jsonb_build_object('status', 'approved', 'priest_id', v_priest, 'person_id', v_person.id);
end $$;
revoke all on function public.owner_review_priest_request(uuid, boolean, text, uuid, text) from public, anon;
grant execute on function public.owner_review_priest_request(uuid, boolean, text, uuid, text) to authenticated;

create or replace function public.owner_add_priest(
  p_code text, p_name text, p_password text, p_church uuid,
  p_title text default null, p_gender text default null, p_birthdate date default null,
  p_phone text default null, p_address text default null, p_notes text default null, p_image_url text default null
) returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_code text := nullif(trim(coalesce(p_code, '')), '');
  v_person public.persons%rowtype;
  v_priest uuid;
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_code is null then raise exception 'code_required' using errcode = '22023'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required' using errcode = '22023'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'weak_password' using errcode = '22023'; end if;
  if p_gender is not null and p_gender not in ('male', 'female') then raise exception 'invalid_gender' using errcode = '22023'; end if;
  if p_church is null or not exists (select 1 from public.churches c where c.id = p_church) then
    raise exception 'church_required' using errcode = '22023';
  end if;
  select * into v_person from public.persons where national_id = v_code;
  if not found then
    insert into public.persons (national_id, name, gender, birthdate, phone, address, notes, image_url, created_by, edited_by)
    values (v_code, trim(p_name), p_gender, p_birthdate, nullif(trim(coalesce(p_phone, '')), ''),
            nullif(trim(coalesce(p_address, '')), ''), nullif(trim(coalesce(p_notes, '')), ''), p_image_url, auth.uid(), auth.uid())
    returning * into v_person;
  else
    update public.persons set
      name = coalesce(nullif(trim(p_name), ''), name),
      gender = coalesce(p_gender, gender), birthdate = coalesce(p_birthdate, birthdate),
      phone = coalesce(nullif(trim(coalesce(p_phone, '')), ''), phone),
      address = coalesce(nullif(trim(coalesce(p_address, '')), ''), address),
      notes = coalesce(nullif(trim(coalesce(p_notes, '')), ''), notes),
      image_url = coalesce(p_image_url, image_url),
      edited_by = auth.uid(), edited_at = now()
    where id = v_person.id returning * into v_person;
  end if;
  if exists (select 1 from public.priests where person_id = v_person.id) then
    raise exception 'already_registered' using errcode = '23505';
  end if;
  insert into public.priests (person_id, church_id, title, status, password_hash, approved_by, approved_at)
  values (v_person.id, p_church, nullif(trim(coalesce(p_title, '')), ''), 'approved', crypt(p_password, gen_salt('bf', 10)), auth.uid(), now())
  returning id into v_priest;
  -- a pending request for the same code is closed
  update public.priest_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(), priest_id = v_priest
   where code = v_code and status = 'pending';
  return jsonb_build_object('priest_id', v_priest, 'person_id', v_person.id, 'code', v_code);
end $$;
revoke all on function public.owner_add_priest(text, text, text, uuid, text, text, date, text, text, text, text) from public, anon;
grant execute on function public.owner_add_priest(text, text, text, uuid, text, text, date, text, text, text, text) to authenticated;

-- edit the priest row (church · title · status · notes · reminder) — the
-- person data is edited through `persons` (owner RLS)
create or replace function public.owner_update_priest(
  p_priest uuid, p_church uuid default null, p_title text default null, p_status text default null,
  p_notes text default null, p_reminder_days integer default null
) returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status is not null and p_status not in ('approved', 'suspended') then raise exception 'invalid_status' using errcode = '22023'; end if;
  if p_church is not null and not exists (select 1 from public.churches c where c.id = p_church) then
    raise exception 'church_required' using errcode = '22023';
  end if;
  update public.priests set
    church_id = coalesce(p_church, church_id),
    title = case when p_title is null then title else nullif(trim(p_title), '') end,
    status = coalesce(p_status, status),
    notes = case when p_notes is null then notes else nullif(trim(p_notes), '') end,
    reminder_days = coalesce(p_reminder_days, reminder_days)
  where id = p_priest;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_status = 'suspended' then delete from public.priest_sessions where priest_id = p_priest; end if;
end $$;
revoke all on function public.owner_update_priest(uuid, uuid, text, text, text, integer) from public, anon;
grant execute on function public.owner_update_priest(uuid, uuid, text, text, text, integer) to authenticated;

create or replace function public.owner_set_priest_password(p_priest uuid, p_password text)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'weak_password' using errcode = '22023'; end if;
  update public.priests set password_hash = crypt(p_password, gen_salt('bf', 10)) where id = p_priest;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  delete from public.priest_sessions where priest_id = p_priest;
end $$;
revoke all on function public.owner_set_priest_password(uuid, text) from public, anon;
grant execute on function public.owner_set_priest_password(uuid, text) to authenticated;

-- delete the priest account (the person row stays — he may be a servant / parent)
create or replace function public.owner_delete_priest(p_priest uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.priests where id = p_priest;
end $$;
revoke all on function public.owner_delete_priest(uuid) from public, anon;
grant execute on function public.owner_delete_priest(uuid) to authenticated;

-- the owner page: every priest with his person, church and counters
create or replace function public.owner_priests_overview()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_owner() then coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', pr.id, 'person_id', pr.person_id, 'church_id', pr.church_id, 'church_name', ch.name,
      'title', pr.title, 'status', pr.status, 'reminder_days', pr.reminder_days, 'notes', pr.notes,
      'approved_at', pr.approved_at, 'created_at', pr.created_at,
      'person', public.priest_person_json(p),
      'confessors_count', (select count(*) from public.priest_confessors c where c.priest_id = pr.id),
      'confessions_count', (select count(*) from public.confessions c where c.priest_id = pr.id),
      'pending_appointments', (select count(*) from public.confession_appointments a where a.priest_id = pr.id and a.status = 'pending'),
      'last_seen_at', (select max(s.last_seen_at) from public.priest_sessions s where s.priest_id = pr.id)
    ) order by p.name collate "C")
    from public.priests pr
    join public.persons p on p.id = pr.person_id
    join public.churches ch on ch.id = pr.church_id), '[]'::jsonb)
  else '[]'::jsonb end
$$;
revoke all on function public.owner_priests_overview() from public, anon;
grant execute on function public.owner_priests_overview() to authenticated;

create or replace function public.pending_priest_requests_count()
returns integer language sql stable security definer set search_path = public as $$
  select case when public.is_owner() then (select count(*)::int from public.priest_requests where status = 'pending') else 0 end
$$;
grant execute on function public.pending_priest_requests_count() to authenticated;

commit;
