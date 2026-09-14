-- =====================================================================
-- 0037: SERVANTS ARCHITECTURE REDESIGN
--
--   profiles  ──renamed──▶  servant_enrollments  (تسجيلات الخدام)
--
-- The servant is now a PERSON first (same identity table as the children:
-- `persons`, national_id = the code / QR) and is then registered as a
-- *servant enrollment* bound to church → service → class — exactly the
-- same architecture as a child's `enrollments` row.
--
--   persons (الأشخاص)                servant_enrollments (تسجيلات الخدام)
--     id · national_id (code/QR)  ◀──  person_id
--     name · gender · birthdate        id = auth.users.id (login account)
--     phone · address · notes          user_id (= the code, login name)
--     image_url                        role · status · church/service/class
--                                      full_name · phone · photo_url (mirrors)
--
-- Signup flow (RPC `servant_signup`):
--   1. church / service / class (chosen or pre-filled from the invite link)
--   2. code (typed or scanned QR)        → persons.national_id
--   3. name · gender · phone · birthdate · address · notes
--      (same rules as adding a child)   → persons
--   4. password + confirmation           → auth.users
--   → person upserted by code, then a PENDING servant enrollment is created.
--
-- PERMISSIONS
--   permission_profiles (ملفات الصلاحيات) — made by the OWNER in the owner
--     module: a named set of permission keys (app-code registry).
--   permissions (الصلاحيات) — connects a servant enrollment to a permission
--     profile.  `my_permissions()` / `has_permission(key)` resolve them.
--
-- BACKWARD COMPATIBILITY
--   A `public.profiles` VIEW (security_invoker) over servant_enrollments
--   keeps every existing function / query working unchanged.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. RENAME profiles → servant_enrollments (idempotent)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname = 'profiles' and c.relkind = 'r')
     and not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname = 'servant_enrollments') then
    alter table public.profiles rename to servant_enrollments;
  end if;
end $$;

comment on table public.servant_enrollments is
  'تسجيلات الخدام — حساب الخادم (id = auth.users.id) مربوط بشخص في persons وبنطاق كنيسة → خدمة → فصل';

alter index if exists idx_profiles_church  rename to idx_servant_enrollments_church;
alter index if exists idx_profiles_status  rename to idx_servant_enrollments_status;
alter index if exists idx_profiles_service rename to idx_servant_enrollments_service;
alter index if exists idx_profiles_class   rename to idx_servant_enrollments_class;

do $$
begin
  if exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
              where c.relname = 'servant_enrollments' and t.tgname = 'trg_guard_profile') then
    alter trigger trg_guard_profile on public.servant_enrollments rename to trg_guard_servant_enrollment;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. person_id — the servant IS a person
-- ---------------------------------------------------------------------
alter table public.servant_enrollments
  add column if not exists person_id uuid references public.persons(id) on delete set null;
create index if not exists idx_servant_enrollments_person on public.servant_enrollments(person_id);

comment on column public.servant_enrollments.person_id is 'الشخص (persons) — الخادم شخص أولاً، الكود = national_id';
comment on column public.servant_enrollments.user_id   is 'اسم الدخول = الكود (national_id) بعد التطبيع';

-- Backfill: every existing servant without a person gets one (code = his user_id
-- unless that code is already taken by someone else).
do $$
declare
  r record;
  v_nid text;
  v_pid uuid;
begin
  for r in select * from public.servant_enrollments where person_id is null loop
    v_nid := r.user_id;
    if exists (select 1 from public.persons p where p.national_id = v_nid) then
      v_nid := 'S-' || upper(encode(gen_random_bytes(5), 'hex'));
    end if;
    insert into public.persons (national_id, name, phone, image_url, created_by, edited_by, created_at)
    values (v_nid, r.full_name, nullif(r.phone, ''), r.photo_url, r.id, r.id, r.created_at)
    returning id into v_pid;
    update public.servant_enrollments set person_id = v_pid where id = r.id;
  end loop;
end $$;

-- Any servant enrollment inserted WITHOUT a person (e.g. the bootstrap owner
-- script 0002, or old code) gets one automatically. `servant_signup` sets
-- app.in_servant_signup because it creates the person itself.
create or replace function public.auto_person_for_servant()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_nid text;
  v_pid uuid;
begin
  if new.person_id is not null or current_setting('app.in_servant_signup', true) = '1' then
    return new;
  end if;
  v_nid := new.user_id;
  if exists (select 1 from public.persons p where p.national_id = v_nid) then
    v_nid := 'S-' || upper(encode(gen_random_bytes(5), 'hex'));
  end if;
  insert into public.persons (national_id, name, phone, image_url, created_by, edited_by)
  values (v_nid, new.full_name, nullif(new.phone, ''), new.photo_url, new.id, new.id)
  returning id into v_pid;
  update public.servant_enrollments set person_id = v_pid where id = new.id;
  return new;
end $$;
drop trigger if exists trg_auto_person_for_servant on public.servant_enrollments;
create trigger trg_auto_person_for_servant after insert on public.servant_enrollments
for each row execute function public.auto_person_for_servant();

-- ---------------------------------------------------------------------
-- 3. Keep the mirrored columns (full_name / phone / photo_url) in sync
--    with the person — both directions, loop-safe.
-- ---------------------------------------------------------------------
create or replace function public.sync_servant_to_person()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 or new.person_id is null then return new; end if;
  update public.persons p
     set name      = new.full_name,
         phone     = nullif(new.phone, ''),
         image_url = new.photo_url,
         edited_at = now(),
         edited_by = coalesce(auth.uid(), p.edited_by)
   where p.id = new.person_id
     and (p.name is distinct from new.full_name
       or p.phone is distinct from nullif(new.phone, '')
       or p.image_url is distinct from new.photo_url);
  return new;
end $$;

drop trigger if exists trg_sync_servant_to_person on public.servant_enrollments;
create trigger trg_sync_servant_to_person
after insert or update of full_name, phone, photo_url, person_id on public.servant_enrollments
for each row execute function public.sync_servant_to_person();

create or replace function public.sync_person_to_servant()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  update public.servant_enrollments s
     set full_name = new.name,
         phone     = coalesce(new.phone, ''),
         photo_url = new.image_url,
         updated_at = now()
   where s.person_id = new.id
     and (s.full_name is distinct from new.name
       or s.phone is distinct from coalesce(new.phone, '')
       or s.photo_url is distinct from new.image_url);
  return new;
end $$;

drop trigger if exists trg_sync_person_to_servant on public.persons;
create trigger trg_sync_person_to_servant
after update of name, phone, image_url on public.persons
for each row execute function public.sync_person_to_servant();

-- ---------------------------------------------------------------------
-- 4. POLICIES — same semantics as 0019, new names
-- ---------------------------------------------------------------------
drop policy if exists profiles_select      on public.servant_enrollments;
drop policy if exists profiles_insert_self on public.servant_enrollments;
drop policy if exists profiles_update_self on public.servant_enrollments;
drop policy if exists profiles_update_mgmt on public.servant_enrollments;
drop policy if exists profiles_delete      on public.servant_enrollments;

drop policy if exists servant_enrollments_select on public.servant_enrollments;
create policy servant_enrollments_select on public.servant_enrollments for select using (
  id = auth.uid()
  or (select public.is_owner())
  or ((select public.my_role()) = 'church_manager' and church_id = (select public.my_church()))
  or ((select public.my_role()) = 'service_manager' and (
       service_id = (select public.my_service())
       or ((select public.my_service()) is null and church_id = (select public.my_church()))
  ))
);
drop policy if exists servant_enrollments_insert_self on public.servant_enrollments;
create policy servant_enrollments_insert_self on public.servant_enrollments for insert with check (
  id = auth.uid() and status = 'pending'
);
drop policy if exists servant_enrollments_update_self on public.servant_enrollments;
create policy servant_enrollments_update_self on public.servant_enrollments for update using (id = auth.uid());
drop policy if exists servant_enrollments_update_mgmt on public.servant_enrollments;
create policy servant_enrollments_update_mgmt on public.servant_enrollments for update using (
  (select public.is_owner())
  or ((select public.my_role()) = 'church_manager' and church_id = (select public.my_church()))
  or ((select public.my_role()) = 'service_manager' and (
       service_id = (select public.my_service())
       or ((select public.my_service()) is null and church_id = (select public.my_church()))
  ))
);
drop policy if exists servant_enrollments_delete on public.servant_enrollments;
create policy servant_enrollments_delete on public.servant_enrollments for delete using (
  (select public.is_owner())
  or ((select public.my_role()) = 'church_manager' and church_id = (select public.my_church()))
  or ((select public.my_role()) = 'service_manager' and (
       service_id = (select public.my_service())
       or ((select public.my_service()) is null and church_id = (select public.my_church()))
  ))
);

-- The guard trigger must also freeze person_id for a self-update by a non-manager
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_role public.app_role;
begin
  -- servant_signup (security definer RPC) may attach the person / refresh
  -- the pending request — it flags itself through app.in_servant_signup.
  if current_setting('app.in_servant_signup', true) = '1' then
    new.updated_at := now();
    return new;
  end if;
  v_role := public.my_role();
  if auth.uid() = new.id and (v_role is null or v_role = 'class_servant') then
    new.role := old.role;
    new.status := old.status;
    new.church_id := old.church_id;
    new.service_id := old.service_id;
    new.class_id := old.class_id;
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
    new.person_id := old.person_id;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- PERSONS: a servant sees / edits his own person row; managers see the
-- persons of the servant enrollments they manage (pending ones included).
drop policy if exists persons_select_self on public.persons;
create policy persons_select_self on public.persons for select using (
  id = (select s.person_id from public.servant_enrollments s where s.id = auth.uid())
);
drop policy if exists persons_update_self on public.persons;
create policy persons_update_self on public.persons for update using (
  id = (select s.person_id from public.servant_enrollments s where s.id = auth.uid())
);
drop policy if exists persons_select_servants on public.persons;
create policy persons_select_servants on public.persons for select using (
  exists (
    select 1 from public.servant_enrollments s
     where s.person_id = persons.id
       and (
         (select public.is_owner())
         or ((select public.my_role()) = 'church_manager' and s.church_id = (select public.my_church()))
         or ((select public.my_role()) = 'service_manager' and (
              s.service_id = (select public.my_service())
              or ((select public.my_service()) is null and s.church_id = (select public.my_church()))
         ))
       )
  )
);
drop policy if exists persons_update_servants on public.persons;
create policy persons_update_servants on public.persons for update using (
  exists (
    select 1 from public.servant_enrollments s
     where s.person_id = persons.id
       and (
         (select public.is_owner())
         or ((select public.my_role()) = 'church_manager' and s.church_id = (select public.my_church()))
         or ((select public.my_role()) = 'service_manager' and (
              s.service_id = (select public.my_service())
              or ((select public.my_service()) is null and s.church_id = (select public.my_church()))
         ))
       )
  )
);

-- ---------------------------------------------------------------------
-- 4b. Deleting a servant must never be blocked by his audit trail.
--     Every nullable `created_by / edited_by / recorded_by …` column that
--     references servant_enrollments with the default NO ACTION becomes
--     ON DELETE SET NULL (the row stays, the author becomes «unknown»).
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as tbl,
           (select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
              from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) as cols,
           (select bool_and(not a.attnotnull)
              from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) as nullable
      from pg_constraint c
     where c.contype = 'f'
       and c.confrelid = 'public.servant_enrollments'::regclass
       and c.confdeltype = 'a'
  loop
    if r.nullable then
      execute format('alter table %s drop constraint %I', r.tbl, r.conname);
      execute format('alter table %s add constraint %I foreign key (%s) references public.servant_enrollments(id) on delete set null',
                     r.tbl, r.conname, r.cols);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. COMPATIBILITY VIEW  public.profiles  → servant_enrollments
--    security_invoker ⇒ the caller's RLS on the base table applies.
--    Simple single-table view ⇒ insert / update / delete pass through.
-- ---------------------------------------------------------------------
drop view if exists public.profiles;
create view public.profiles with (security_invoker = true) as
  select * from public.servant_enrollments;
comment on view public.profiles is 'توافق قديم — اسم الجدول أصبح servant_enrollments (تسجيلات الخدام)';
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles to service_role;

-- ---------------------------------------------------------------------
-- 6. SIGNUP RPCs
-- ---------------------------------------------------------------------

-- Login name derived from the code (must be a valid e-mail local part)
create or replace function public.code_to_user_id(p_code text)
returns text language sql immutable as $$
  select lower(regexp_replace(trim(p_code), '[^a-zA-Z0-9._-]', '-', 'g'))
$$;

-- Step 2 of the signup: is this code already a known person? Returns the
-- (limited) person data to pre-fill the form. Same exposure level as the
-- child portal (`child_portal_profile`): whoever holds the code / card.
create or replace function public.signup_lookup_code(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when nullif(trim(p_code), '') is null then null
    else (
      select jsonb_build_object(
        'name', p.name, 'gender', p.gender, 'birthdate', p.birthdate,
        'phone', p.phone, 'address', p.address, 'image_url', p.image_url,
        'has_account', exists (select 1 from public.servant_enrollments s where s.person_id = p.id))
      from public.persons p where p.national_id = trim(p_code) limit 1)
  end
$$;
grant execute on function public.signup_lookup_code(text) to anon, authenticated;

-- The signup itself (called right after auth.signUp, so auth.uid() is set):
--   1. person upserted by code (fill blanks only — never overwrite)
--   2. PENDING servant enrollment created for this account
create or replace function public.servant_signup(
  p_code text,
  p_full_name text,
  p_gender text default null,
  p_birthdate date default null,
  p_phone text default null,
  p_address text default null,
  p_notes text default null,
  p_church uuid default null,
  p_service uuid default null,
  p_class uuid default null,
  p_image_url text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_code text := nullif(trim(p_code), '');
  v_user_id text;
  v_person public.persons%rowtype;
  v_created boolean := false;
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if v_code is null then raise exception 'code_required' using errcode = '22023'; end if;
  if coalesce(trim(p_full_name), '') = '' then raise exception 'name_required' using errcode = '22023'; end if;
  if p_gender is not null and p_gender not in ('male', 'female') then raise exception 'invalid_gender' using errcode = '22023'; end if;
  if v_phone is null then raise exception 'phone_required' using errcode = '22023'; end if;

  -- scope chain must be consistent (all optional — the approver may set it)
  if p_service is not null and (p_church is null
      or not exists (select 1 from public.services s where s.id = p_service and s.church_id = p_church)) then
    raise exception 'service_not_in_church' using errcode = '22023';
  end if;
  if p_class is not null and (p_service is null
      or not exists (select 1 from public.classes c where c.id = p_class and c.service_id = p_service)) then
    raise exception 'class_not_in_service' using errcode = '22023';
  end if;

  v_user_id := public.code_to_user_id(v_code);
  if exists (select 1 from public.servant_enrollments s where s.user_id = v_user_id and s.id <> v_uid) then
    raise exception 'code_taken' using errcode = '23505';
  end if;

  -- 0) the servant enrollment row must exist BEFORE the person because
  --    persons.created_by references servant_enrollments(id). Insert it as a
  --    placeholder (pending), the person is attached right after.
  perform set_config('app.in_servant_signup', '1', true);
  insert into public.servant_enrollments (id, full_name, user_id, phone, role, status,
                                          church_id, service_id, class_id)
  values (v_uid, trim(p_full_name), v_user_id, v_phone, 'class_servant', 'pending',
          p_church, p_service, p_class)
  on conflict (id) do nothing;
  if not exists (select 1 from public.servant_enrollments s where s.id = v_uid and s.status = 'pending') then
    raise exception 'already_registered' using errcode = '23505';
  end if;

  -- 1) the person
  select * into v_person from public.persons where national_id = v_code;
  if not found then
    insert into public.persons (national_id, name, gender, birthdate, phone, address, notes, image_url, created_by, edited_by)
    values (v_code, trim(p_full_name), p_gender, p_birthdate, v_phone,
            nullif(trim(coalesce(p_address, '')), ''), nullif(trim(coalesce(p_notes, '')), ''),
            p_image_url, v_uid, v_uid)
    returning * into v_person;
    v_created := true;
  else
    update public.persons set
      gender    = coalesce(gender, p_gender),
      birthdate = coalesce(birthdate, p_birthdate),
      phone     = coalesce(phone, v_phone),
      address   = coalesce(address, nullif(trim(coalesce(p_address, '')), '')),
      notes     = coalesce(notes, nullif(trim(coalesce(p_notes, '')), '')),
      image_url = coalesce(image_url, p_image_url),
      edited_by = v_uid, edited_at = now()
    where id = v_person.id
    returning * into v_person;
  end if;

  -- 2) attach the person to the (pending) servant enrollment. Re-running for
  --    the same account while still pending simply refreshes the request.
  update public.servant_enrollments set
    person_id  = v_person.id,
    full_name  = v_person.name,
    user_id    = v_user_id,
    phone      = coalesce(v_person.phone, v_phone),
    church_id  = p_church,
    service_id = p_service,
    class_id   = p_class,
    photo_url  = v_person.image_url,
    updated_at = now()
  where id = v_uid and status = 'pending';

  perform set_config('app.in_servant_signup', '0', true);
  return jsonb_build_object('person_id', v_person.id, 'person_created', v_created,
                            'national_id', v_person.national_id, 'user_id', v_user_id);
end $$;
grant execute on function public.servant_signup(text, text, text, date, text, text, text, uuid, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. PERMISSION PROFILES (ملفات الصلاحيات) — owner-made named key sets
-- ---------------------------------------------------------------------
create table if not exists public.permission_profiles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  permissions text[] not null default '{}',   -- keys from src/lib/permissions.ts
  color       text not null default '#1e3a8a',
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.servant_enrollments(id) on delete set null,
  edited_at   timestamptz not null default now(),
  edited_by   uuid references public.servant_enrollments(id) on delete set null,
  constraint permission_profiles_name_len check (length(trim(name)) between 1 and 80)
);
create unique index if not exists uq_permission_profiles_name on public.permission_profiles(lower(name));
comment on table public.permission_profiles is 'ملفات الصلاحيات — مجموعة مفاتيح صلاحيات باسم، يصنعها المالك من وحدة المالك';

-- ---------------------------------------------------------------------
-- 8. PERMISSIONS (الصلاحيات) — servant enrollment ↔ permission profile
-- ---------------------------------------------------------------------
create table if not exists public.permissions (
  id                    uuid primary key default gen_random_uuid(),
  servant_id            uuid not null references public.servant_enrollments(id) on delete cascade,
  permission_profile_id uuid not null references public.permission_profiles(id) on delete cascade,
  granted_by            uuid references public.servant_enrollments(id) on delete set null,
  created_at            timestamptz not null default now(),
  unique (servant_id, permission_profile_id)
);
create index if not exists idx_permissions_servant on public.permissions(servant_id);
create index if not exists idx_permissions_profile on public.permissions(permission_profile_id);
comment on table public.permissions is 'الصلاحيات — ربط تسجيل الخادم بملف صلاحيات';

alter table public.permission_profiles enable row level security;
alter table public.permissions enable row level security;

-- helpers --------------------------------------------------------------
-- Can the caller MANAGE (assign / revoke) permissions of this servant?
-- owner: anyone; church / service manager: servants inside his scope,
-- never himself, never an owner.
create or replace function public.can_manage_servant(p_servant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when p_servant = auth.uid() then false
      when s.role = 'owner' then true
      when s.role = 'church_manager' then t.role <> 'owner' and t.church_id = s.church_id
      when s.role = 'service_manager' then t.role in ('class_servant')
           and (t.service_id = s.service_id or (s.service_id is null and t.church_id = s.church_id))
      else false
    end
    from public.my_scope() s, public.servant_enrollments t
    where t.id = p_servant
  ), false)
$$;

-- All permission keys of the caller. Owner ⇒ {'*'} (everything).
create or replace function public.my_permissions()
returns text[] language sql stable security definer set search_path = public as $$
  select case
    when (select role from public.my_scope()) = 'owner' then array['*']
    when (select role from public.my_scope()) is null then '{}'::text[]
    else coalesce((
      select array_agg(distinct k)
        from public.permissions p
        join public.permission_profiles pp on pp.id = p.permission_profile_id
        cross join unnest(pp.permissions) k
       where p.servant_id = auth.uid()), '{}'::text[])
  end
$$;

create or replace function public.has_permission(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.my_scope()) = 'owner', false)
      or p_key = any (public.my_permissions())
$$;
grant execute on function public.can_manage_servant(uuid) to authenticated;
grant execute on function public.my_permissions() to authenticated;
grant execute on function public.has_permission(text) to authenticated;

-- policies -------------------------------------------------------------
drop policy if exists permission_profiles_select on public.permission_profiles;
create policy permission_profiles_select on public.permission_profiles for select using (
  (select public.my_role()) is not null
);
drop policy if exists permission_profiles_insert on public.permission_profiles;
create policy permission_profiles_insert on public.permission_profiles for insert with check ((select public.is_owner()));
drop policy if exists permission_profiles_update on public.permission_profiles;
create policy permission_profiles_update on public.permission_profiles for update using ((select public.is_owner()));
drop policy if exists permission_profiles_delete on public.permission_profiles;
create policy permission_profiles_delete on public.permission_profiles for delete using ((select public.is_owner()));

drop policy if exists permissions_select on public.permissions;
create policy permissions_select on public.permissions for select using (
  servant_id = auth.uid()
  or (select public.is_owner())
  or public.can_manage_servant(servant_id)
);
drop policy if exists permissions_insert on public.permissions;
create policy permissions_insert on public.permissions for insert with check (
  public.can_manage_servant(servant_id)
);
drop policy if exists permissions_delete on public.permissions;
create policy permissions_delete on public.permissions for delete using (
  public.can_manage_servant(servant_id)
);

create or replace function public.touch_permission_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.edited_at := now();
  new.edited_by := coalesce(auth.uid(), new.edited_by);
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  return new;
end $$;
drop trigger if exists trg_touch_permission_profile on public.permission_profiles;
create trigger trg_touch_permission_profile before insert or update on public.permission_profiles
for each row execute function public.touch_permission_profile();

create or replace function public.stamp_permission_grant()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.granted_by := coalesce(new.granted_by, auth.uid());
  return new;
end $$;
drop trigger if exists trg_stamp_permission_grant on public.permissions;
create trigger trg_stamp_permission_grant before insert on public.permissions
for each row execute function public.stamp_permission_grant();

-- Managers list: which permission profiles does each visible servant hold?
create or replace function public.servant_permission_map()
returns table (servant_id uuid, permission_profile_ids uuid[])
language sql stable security invoker set search_path = public as $$
  select p.servant_id, array_agg(p.permission_profile_id order by p.created_at)
    from public.permissions p
   group by p.servant_id
$$;
grant execute on function public.servant_permission_map() to authenticated;

-- ---------------------------------------------------------------------
-- 9. REALTIME
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'permission_profiles') then
    alter publication supabase_realtime add table public.permission_profiles;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'permissions') then
    alter publication supabase_realtime add table public.permissions;
  end if;
end $$;
alter table public.permission_profiles replica identity full;
alter table public.permissions replica identity full;

commit;
