-- =====================================================================
-- 0041: ADD SERVANTS DIRECTLY (إضافة خدام — فردي / جماعي)
--
-- Until now a servant could only join through the SIGNUP wizard (he
-- creates his own account, the manager approves). This migration lets an
-- owner / church manager / service manager ADD servants himself — one by
-- one or in bulk (Excel / paste) — exactly like adding children:
--
--   manager (browser) ──▶ POST /api/servants/create  (Next.js, server)
--                              │ 1. caller session → actor id
--                              │ 2. auth.admin.createUser (login = the code)
--                              ▼
--                         admin_add_servant(actor, account, …)   ◀── THIS FILE
--                              │ validates the ACTOR's rights (role + scope)
--                              │ person upserted by code, APPROVED servant
--                              │ enrollment, permission profiles granted
--                              ▼
--                         servant logs in with code + password right away
--
-- The RPC is SECURITY DEFINER and executable by service_role ONLY — the
-- browser never calls it. The actor is passed explicitly (the server has
-- already verified his session) and every rule a manager is bound to in
-- the approval flow is re-checked here:
--   owner            → any role but owner, any scope
--   church_manager   → service_manager / class_servant inside his church
--   service_manager  → class_servant inside his service (or his church
--                      when he has no service)
-- =====================================================================

begin;

create or replace function public.admin_add_servant(
  p_actor     uuid,
  p_account   uuid,                       -- the freshly created auth.users id
  p_code      text,
  p_full_name text,
  p_role      public.app_role default 'class_servant',
  p_church    uuid default null,
  p_service   uuid default null,
  p_class     uuid default null,
  p_gender    text default null,
  p_birthdate date default null,
  p_phone     text default null,
  p_address   text default null,
  p_notes     text default null,
  p_image_url text default null,
  p_profiles  uuid[] default '{}'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor  public.servant_enrollments%rowtype;
  v_code   text := nullif(trim(p_code), '');
  v_name   text := nullif(trim(coalesce(p_full_name, '')), '');
  v_phone  text := nullif(trim(coalesce(p_phone, '')), '');
  v_user_id text;
  v_person public.persons%rowtype;
  v_created boolean := false;
  v_granted integer := 0;
begin
  -- ---------- actor ----------
  if p_actor is null or p_account is null then
    raise exception 'actor_required' using errcode = '22023';
  end if;
  select * into v_actor from public.servant_enrollments where id = p_actor;
  if not found or v_actor.status <> 'approved'
     or v_actor.role not in ('owner', 'church_manager', 'service_manager') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  -- ---------- input ----------
  if v_code is null then raise exception 'code_required' using errcode = '22023'; end if;
  if v_name is null then raise exception 'name_required' using errcode = '22023'; end if;
  if p_gender is not null and p_gender not in ('male', 'female') then
    raise exception 'invalid_gender' using errcode = '22023';
  end if;
  if p_role = 'owner' then raise exception 'role_not_allowed' using errcode = '42501'; end if;
  if p_church is null then raise exception 'church_required' using errcode = '22023'; end if;

  -- scope chain must be consistent
  if not exists (select 1 from public.churches c where c.id = p_church) then
    raise exception 'church_not_found' using errcode = '22023';
  end if;
  if p_service is not null
     and not exists (select 1 from public.services s where s.id = p_service and s.church_id = p_church) then
    raise exception 'service_not_in_church' using errcode = '22023';
  end if;
  if p_class is not null and (p_service is null
      or not exists (select 1 from public.classes c where c.id = p_class and c.service_id = p_service)) then
    raise exception 'class_not_in_service' using errcode = '22023';
  end if;

  -- ---------- what may THIS actor grant? (mirror of the approval flow) ----------
  if v_actor.role = 'church_manager' then
    if p_role = 'church_manager' then raise exception 'role_not_allowed' using errcode = '42501'; end if;
    if p_church is distinct from v_actor.church_id then raise exception 'scope_not_allowed' using errcode = '42501'; end if;
  elsif v_actor.role = 'service_manager' then
    if p_role <> 'class_servant' then raise exception 'role_not_allowed' using errcode = '42501'; end if;
    if p_church is distinct from v_actor.church_id then raise exception 'scope_not_allowed' using errcode = '42501'; end if;
    if v_actor.service_id is not null and p_service is distinct from v_actor.service_id then
      raise exception 'scope_not_allowed' using errcode = '42501';
    end if;
  end if;

  -- ---------- the code = login name ----------
  v_user_id := public.code_to_user_id(v_code);
  if exists (select 1 from public.servant_enrollments s where s.user_id = v_user_id) then
    raise exception 'code_taken' using errcode = '23505';
  end if;
  if exists (select 1 from public.servant_enrollments s where s.id = p_account) then
    raise exception 'already_registered' using errcode = '23505';
  end if;
  -- the code may already belong to a PERSON (e.g. an older child / a card
  -- printed for him) — fine, we bind the account to that person — unless
  -- that person already has a servant account.
  select * into v_person from public.persons where national_id = v_code;
  if found and exists (select 1 from public.servant_enrollments s where s.person_id = v_person.id) then
    raise exception 'code_taken' using errcode = '23505';
  end if;

  -- ---------- 1) the APPROVED servant enrollment (placeholder first:
  --            persons.created_by references servant_enrollments) ----------
  perform set_config('app.in_servant_signup', '1', true);   -- bypass auto-person + guard triggers
  insert into public.servant_enrollments
    (id, full_name, user_id, phone, role, status, church_id, service_id, class_id,
     approved_by, approved_at)
  values
    (p_account, v_name, v_user_id, coalesce(v_phone, ''), p_role, 'approved',
     p_church, p_service, p_class, p_actor, now());

  -- ---------- 2) the person (upsert by code) ----------
  if v_person.id is null then
    insert into public.persons (national_id, name, gender, birthdate, phone, address, notes, image_url, created_by, edited_by)
    values (v_code, v_name, p_gender, p_birthdate, v_phone,
            nullif(trim(coalesce(p_address, '')), ''), nullif(trim(coalesce(p_notes, '')), ''),
            p_image_url, p_actor, p_actor)
    returning * into v_person;
    v_created := true;
  else
    -- the manager typed the data himself → what he provided wins, blanks keep the old value
    update public.persons set
      name      = v_name,
      gender    = coalesce(p_gender, gender),
      birthdate = coalesce(p_birthdate, birthdate),
      phone     = coalesce(v_phone, phone),
      address   = coalesce(nullif(trim(coalesce(p_address, '')), ''), address),
      notes     = coalesce(nullif(trim(coalesce(p_notes, '')), ''), notes),
      image_url = coalesce(p_image_url, image_url),
      edited_by = p_actor, edited_at = now()
    where id = v_person.id
    returning * into v_person;
  end if;

  -- ---------- 3) bind + mirrors ----------
  update public.servant_enrollments set
    person_id = v_person.id,
    full_name = v_person.name,
    phone     = coalesce(v_person.phone, ''),
    photo_url = v_person.image_url,
    updated_at = now()
  where id = p_account;
  perform set_config('app.in_servant_signup', '0', true);

  -- ---------- 4) permission profiles ----------
  if p_profiles is not null and cardinality(p_profiles) > 0 and p_role <> 'owner' then
    insert into public.permissions (servant_id, permission_profile_id, granted_by)
    select p_account, pp.id, p_actor
      from public.permission_profiles pp
     where pp.id = any (p_profiles)
    on conflict do nothing;
    get diagnostics v_granted = row_count;
  end if;

  return jsonb_build_object(
    'servant_id', p_account,
    'person_id', v_person.id,
    'person_created', v_created,
    'national_id', v_person.national_id,
    'user_id', v_user_id,
    'profiles_granted', v_granted
  );
end $$;

comment on function public.admin_add_servant is
  'إضافة خادم مباشرة (معتمد) من مسؤول — يُستدعى من الخادم فقط (service_role) بعد إنشاء حساب الدخول';

revoke all on function public.admin_add_servant(uuid, uuid, text, text, public.app_role, uuid, uuid, uuid, text, date, text, text, text, text, uuid[])
  from public, anon, authenticated;
grant execute on function public.admin_add_servant(uuid, uuid, text, text, public.app_role, uuid, uuid, uuid, text, date, text, text, text, text, uuid[])
  to service_role;

-- ---------------------------------------------------------------------
-- Pre-check for the ADD form (browser, authenticated managers): is this
-- code free? Same exposure as signup_lookup_code but tells the caller
-- whether the code already has an ACCOUNT (blocked) or only a PERSON
-- (data pre-filled) — used live while typing / scanning.
-- ---------------------------------------------------------------------
create or replace function public.admin_servant_code_lookup(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when nullif(trim(p_code), '') is null then null
    else jsonb_build_object(
      'user_id', public.code_to_user_id(trim(p_code)),
      'login_taken', exists (select 1 from public.servant_enrollments s
                              where s.user_id = public.code_to_user_id(trim(p_code))),
      'person', (
        select jsonb_build_object(
          'name', p.name, 'gender', p.gender, 'birthdate', p.birthdate,
          'phone', p.phone, 'address', p.address, 'notes', p.notes, 'image_url', p.image_url,
          'has_account', exists (select 1 from public.servant_enrollments s where s.person_id = p.id))
        from public.persons p where p.national_id = trim(p_code) limit 1)
    )
  end
$$;
revoke all on function public.admin_servant_code_lookup(text) from public, anon;
grant execute on function public.admin_servant_code_lookup(text) to authenticated;

notify pgrst, 'reload schema';

commit;
