-- =====================================================================
-- 0045: ONE PERSON → MANY PLACES (نطاقات متعددة للخادم · فصول متعددة للمخدوم)
--
-- A servant may now serve in SEVERAL churches / services / classes at the
-- same time, and a child may be enrolled in several classes (that was
-- already possible through `enrollments`, now it is EASY in the UI).
--
--   servant_enrollments (تسجيل الخادم — the account)
--     role · status · church_id · service_id · class_id   ← the PRIMARY scope
--                                                            (unchanged, so every
--                                                            older function keeps
--                                                            working)
--   servant_scopes (نطاقات الخادم الإضافية)                ← NEW
--     servant_id → servant_enrollments · church_id · service_id · class_id
--
--   my_scopes()                 = primary ∪ servant_scopes of the caller
--   servant_all_scopes(id)      = primary ∪ servant_scopes of ANY servant
--   can_access / scope_overlaps / scope_contains / enrollment_visible /
--   can_manage_servant          → true when ANY of the caller's scopes matches
--   churches / services / classes / servant_enrollments / persons policies
--                               → rewritten over my_scopes()
--   servant mirror rows         → ONE `enrollments` row PER CLASS the servant
--                                 serves in (was: one per servant)
--   set_servant_scopes(servant, scopes) → replace the list (manager / owner)
--   servant_signup / admin_add_servant  → accept p_scopes (array)
--   set_enrollments_status      → a scope-wide stop reaches servants whose
--                                 EXTRA scope lies inside it too
--
-- The role is ONE per servant and applies to every scope.
-- Idempotent.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. servant_scopes — the additional places of a servant
-- ---------------------------------------------------------------------
create table if not exists public.servant_scopes (
  id          uuid primary key default gen_random_uuid(),
  servant_id  uuid not null references public.servant_enrollments(id) on delete cascade,
  church_id   uuid not null references public.churches(id) on delete cascade,
  service_id  uuid references public.services(id) on delete cascade,
  class_id    uuid references public.classes(id) on delete cascade,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.servant_enrollments(id) on delete set null
);
comment on table public.servant_scopes is
  'نطاقات الخادم الإضافية — أماكن خدمة أخرى (كنيسة → خدمة → فصل) بجانب النطاق الأساسي في servant_enrollments';

create index if not exists idx_servant_scopes_servant on public.servant_scopes(servant_id);
create index if not exists idx_servant_scopes_church  on public.servant_scopes(church_id);
create index if not exists idx_servant_scopes_service on public.servant_scopes(service_id);
create index if not exists idx_servant_scopes_class   on public.servant_scopes(class_id);
-- one row per (servant, exact scope) — nulls compare equal here
create unique index if not exists uq_servant_scopes on public.servant_scopes(
  servant_id, church_id,
  coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(class_id,   '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.servant_scopes enable row level security;
alter table public.servant_scopes replica identity full;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'servant_scopes') then
    alter publication supabase_realtime add table public.servant_scopes;
  end if;
end $$;

-- the chain must be consistent: service in church, class in service
create or replace function public.check_servant_scope_chain()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.service_id is not null
     and not exists (select 1 from public.services s where s.id = new.service_id and s.church_id = new.church_id) then
    raise exception 'service_not_in_church' using errcode = '22023';
  end if;
  if new.class_id is not null and (new.service_id is null
      or not exists (select 1 from public.classes c where c.id = new.class_id and c.service_id = new.service_id)) then
    raise exception 'class_not_in_service' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists trg_check_servant_scope_chain on public.servant_scopes;
create trigger trg_check_servant_scope_chain before insert or update on public.servant_scopes
for each row execute function public.check_servant_scope_chain();

-- ---------------------------------------------------------------------
-- 2. Scope readers
-- ---------------------------------------------------------------------
-- ALL scopes of any servant (primary ∪ extras). Security definer: used by
-- policies and helpers, never blocked by RLS.
create or replace function public.servant_all_scopes(p_servant uuid)
returns table (church_id uuid, service_id uuid, class_id uuid)
language sql stable security definer set search_path = public as $$
  select s.church_id, s.service_id, s.class_id
    from public.servant_enrollments s
   where s.id = p_servant and s.church_id is not null
  union
  select x.church_id, x.service_id, x.class_id
    from public.servant_scopes x
   where x.servant_id = p_servant
$$;
grant execute on function public.servant_all_scopes(uuid) to authenticated;

-- ALL scopes of the CALLER (approved only). The owner / a servant without
-- a scope still yields one row (role + nulls) exactly like my_scope().
create or replace function public.my_scopes()
returns table (role public.app_role, church_id uuid, service_id uuid, class_id uuid)
language sql stable security definer set search_path = public as $$
  select s.role, s.church_id, s.service_id, s.class_id
    from public.servant_enrollments s
   where s.id = auth.uid() and s.status = 'approved'
  union
  select s.role, x.church_id, x.service_id, x.class_id
    from public.servant_enrollments s
    join public.servant_scopes x on x.servant_id = s.id
   where s.id = auth.uid() and s.status = 'approved'
$$;
grant execute on function public.my_scopes() to authenticated, anon;

-- ---------------------------------------------------------------------
-- 3. Access predicates — ANY scope of the caller may match
-- ---------------------------------------------------------------------
create or replace function public.can_access(p_church uuid, p_service uuid, p_class uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select bool_or(case s.role
      when 'owner' then true
      when 'church_manager' then p_church = s.church_id
      when 'service_manager' then
        (s.service_id is null and p_church = s.church_id)
        or p_service = s.service_id
      when 'class_servant' then
        (s.class_id is null and (
          (s.service_id is null and p_church = s.church_id)
          or p_service = s.service_id
        ))
        or p_class = s.class_id
      else false
    end)
    from public.my_scopes() s
  ), false)
$$;

create or replace function public.scope_overlaps(p_church uuid, p_service uuid, p_class uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select bool_or(case s.role
      when 'owner' then true
      when 'church_manager' then p_church = s.church_id
      when 'service_manager' then
        p_church = s.church_id
        and (s.service_id is null or p_service is null or p_service = s.service_id)
      when 'class_servant' then
        p_church = s.church_id
        and (s.service_id is null or p_service is null or p_service = s.service_id)
        and (s.class_id is null or p_class is null or p_class = s.class_id)
      else false
    end)
    from public.my_scopes() s
  ), false)
$$;

create or replace function public.scope_contains(p_church uuid, p_service uuid, p_class uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select bool_or(case s.role
      when 'owner' then true
      when 'church_manager' then p_church = s.church_id
      when 'service_manager' then
        p_church = s.church_id
        and (s.service_id is null or (p_service is not null and p_service = s.service_id))
      when 'class_servant' then
        p_church = s.church_id
        and (s.service_id is null or (p_service is not null and p_service = s.service_id))
        and (s.class_id is null or (p_class is not null and p_class = s.class_id))
      else false
    end)
    from public.my_scopes() s
  ), false)
$$;

-- enrollment_visible(row scope, caller PRIMARY scope) is inlined in ~30
-- policies and ~15 RPCs. It keeps its signature; the primary check stays a
-- plain expression, and only when it fails the caller's EXTRA scopes are
-- looked up (cheap: indexed by servant_id, evaluated last thanks to the cost).
create or replace function public.extra_scope_visible(p_church uuid, p_service uuid, p_class uuid, s_role public.app_role)
returns boolean language sql stable security definer set search_path = public cost 500 as $$
  select s_role is not null and s_role <> 'owner' and exists (
    select 1 from public.servant_scopes x
     where x.servant_id = auth.uid()
       and case s_role
         when 'church_manager' then p_church = x.church_id
         when 'service_manager' then (x.service_id is null and p_church = x.church_id) or p_service = x.service_id
         when 'class_servant' then
           (x.class_id is null and ((x.service_id is null and p_church = x.church_id) or p_service = x.service_id))
           or p_class = x.class_id
         else false
       end)
$$;
grant execute on function public.extra_scope_visible(uuid, uuid, uuid, public.app_role) to authenticated, anon;

create or replace function public.enrollment_visible(p_church uuid, p_service uuid, p_class uuid,
                                                     s_role public.app_role, s_church uuid,
                                                     s_service uuid, s_class uuid)
returns boolean language sql stable as $$
  select coalesce(case s_role
    when 'owner' then true
    when 'church_manager' then p_church = s_church
    when 'service_manager' then (s_service is null and p_church = s_church) or p_service = s_service
    when 'class_servant' then
      (s_class is null and ((s_service is null and p_church = s_church) or p_service = s_service))
      or p_class = s_class
    else false
  end, false)
  or public.extra_scope_visible(p_church, p_service, p_class, s_role)
$$;

-- Is this servant (any of HIS scopes) inside the caller's management area?
-- church manager: same church · service manager: same service, or same
-- church when he manages the whole church. Owner handled by the callers.
create or replace function public.servant_in_my_scope(p_servant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.my_scopes() s
      join public.servant_all_scopes(p_servant) t
        on case s.role
             when 'church_manager'  then t.church_id = s.church_id
             when 'service_manager' then (s.service_id is null and t.church_id = s.church_id) or t.service_id = s.service_id
             else false
           end
  )
$$;
grant execute on function public.servant_in_my_scope(uuid) to authenticated;

-- May the caller grant THIS scope to a servant? (approval / add / edit)
create or replace function public.scope_grantable(p_church uuid, p_service uuid, p_class uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select bool_or(case s.role
      when 'owner' then true
      when 'church_manager' then p_church = s.church_id
      when 'service_manager' then (s.service_id is null and p_church = s.church_id) or (p_service is not null and p_service = s.service_id)
      else false
    end)
    from public.my_scopes() s), false)
$$;
grant execute on function public.scope_grantable(uuid, uuid, uuid) to authenticated;

-- Same rule for an explicit actor (service-role RPCs such as admin_add_servant)
create or replace function public.scope_grantable_by(p_actor uuid, p_church uuid, p_service uuid, p_class uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select bool_or(case a.role
      when 'owner' then true
      when 'church_manager' then p_church = t.church_id
      when 'service_manager' then (t.service_id is null and p_church = t.church_id) or (p_service is not null and p_service = t.service_id)
      else false
    end)
    from public.servant_enrollments a
    left join public.servant_all_scopes(p_actor) t on true
    where a.id = p_actor and a.status = 'approved'), false)
$$;

-- can_manage_servant — owner: anyone but himself; managers: servants with
-- ANY scope inside ANY of theirs (never himself, never an owner).
create or replace function public.can_manage_servant(p_servant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when p_servant = auth.uid() then false
      when me.role = 'owner' then true
      when me.role = 'church_manager' then t.role <> 'owner' and public.servant_in_my_scope(t.id)
      when me.role = 'service_manager' then t.role = 'class_servant' and public.servant_in_my_scope(t.id)
      else false
    end
    from public.my_scope() me, public.servant_enrollments t
    where t.id = p_servant
  ), false)
$$;

-- ---------------------------------------------------------------------
-- 4. Structural policies over my_scopes()
-- ---------------------------------------------------------------------
drop policy if exists churches_select on public.churches;
create policy churches_select on public.churches for select using (
  (select public.is_owner())
  or exists (select 1 from public.my_scopes() s where s.church_id = churches.id)
);
drop policy if exists churches_update on public.churches;
create policy churches_update on public.churches for update using (
  (select public.is_owner())
  or exists (select 1 from public.my_scopes() s where s.role = 'church_manager' and s.church_id = churches.id)
);

drop policy if exists services_select on public.services;
create policy services_select on public.services for select using (
  (select public.is_owner())
  or exists (select 1 from public.my_scopes() s
              where s.church_id = services.church_id
                and (s.role = 'church_manager' or s.service_id is null or s.service_id = services.id))
);
drop policy if exists services_insert on public.services;
create policy services_insert on public.services for insert with check (
  (select public.is_owner())
  or exists (select 1 from public.my_scopes() s where s.role = 'church_manager' and s.church_id = services.church_id)
);
drop policy if exists services_update on public.services;
create policy services_update on public.services for update using (
  (select public.is_owner())
  or exists (select 1 from public.my_scopes() s
              where s.church_id = services.church_id
                and (s.role = 'church_manager'
                     or (s.role = 'service_manager' and (s.service_id is null or s.service_id = services.id))))
);
drop policy if exists services_delete on public.services;
create policy services_delete on public.services for delete using (
  (select public.is_owner())
  or exists (select 1 from public.my_scopes() s where s.role = 'church_manager' and s.church_id = services.church_id)
);

drop policy if exists classes_select on public.classes;
create policy classes_select on public.classes for select using (
  (select public.is_owner())
  or exists (select 1 from public.my_scopes() s
              where case s.role
                when 'church_manager'  then classes.church_id = s.church_id
                when 'service_manager' then (s.service_id is null and classes.church_id = s.church_id) or classes.service_id = s.service_id
                when 'class_servant'   then (s.class_id is null and ((s.service_id is null and classes.church_id = s.church_id) or classes.service_id = s.service_id))
                                            or classes.id = s.class_id
                else false end)
);
drop policy if exists classes_insert on public.classes;
create policy classes_insert on public.classes for insert with check (
  (select public.is_owner())
  or exists (select 1 from public.my_scopes() s
              where (s.role = 'church_manager' and classes.church_id = s.church_id)
                 or (s.role = 'service_manager' and ((s.service_id is null and classes.church_id = s.church_id) or classes.service_id = s.service_id)))
);
drop policy if exists classes_update on public.classes;
create policy classes_update on public.classes for update using (
  (select public.is_owner())
  or exists (select 1 from public.my_scopes() s
              where (s.role = 'church_manager' and classes.church_id = s.church_id)
                 or (s.role = 'service_manager' and ((s.service_id is null and classes.church_id = s.church_id) or classes.service_id = s.service_id))
                 or (s.role = 'class_servant' and classes.id = s.class_id))
);
drop policy if exists classes_delete on public.classes;
create policy classes_delete on public.classes for delete using (
  (select public.is_owner())
  or exists (select 1 from public.my_scopes() s
              where (s.role = 'church_manager' and classes.church_id = s.church_id)
                 or (s.role = 'service_manager' and ((s.service_id is null and classes.church_id = s.church_id) or classes.service_id = s.service_id)))
);

drop policy if exists servant_enrollments_select on public.servant_enrollments;
create policy servant_enrollments_select on public.servant_enrollments for select using (
  id = auth.uid()
  or (select public.is_owner())
  or public.servant_in_my_scope(id)
);
drop policy if exists servant_enrollments_update_mgmt on public.servant_enrollments;
create policy servant_enrollments_update_mgmt on public.servant_enrollments for update using (
  (select public.is_owner())
  or public.servant_in_my_scope(id)
);
drop policy if exists servant_enrollments_delete on public.servant_enrollments;
create policy servant_enrollments_delete on public.servant_enrollments for delete using (
  (select public.is_owner())
  or public.servant_in_my_scope(id)
);

drop policy if exists persons_select_servants on public.persons;
create policy persons_select_servants on public.persons for select using (
  exists (select 1 from public.servant_enrollments s
           where s.person_id = persons.id
             and ((select public.is_owner()) or public.servant_in_my_scope(s.id)))
);
drop policy if exists persons_update_servants on public.persons;
create policy persons_update_servants on public.persons for update using (
  exists (select 1 from public.servant_enrollments s
           where s.person_id = persons.id
             and ((select public.is_owner()) or public.servant_in_my_scope(s.id)))
);

-- servant_scopes: read = the servant himself · owner · his managers.
-- Writes go through set_servant_scopes / the signup & add RPCs only.
drop policy if exists servant_scopes_select on public.servant_scopes;
create policy servant_scopes_select on public.servant_scopes for select using (
  servant_id = auth.uid()
  or (select public.is_owner())
  or public.servant_in_my_scope(servant_id)
);
grant select on public.servant_scopes to authenticated;
grant all on public.servant_scopes to service_role;

-- ---------------------------------------------------------------------
-- 5. Servant mirror rows — ONE per class he serves in
-- ---------------------------------------------------------------------
drop index if exists public.uq_enrollments_servant;
create index if not exists idx_enrollments_servant on public.enrollments(servant_id) where servant_id is not null;

create or replace function public.sync_servant_mirrors(p_servant uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  cur public.servant_enrollments%rowtype;
  v_status text;
  r record;
begin
  select * into cur from public.servant_enrollments where id = p_servant;
  if not found or cur.person_id is null or cur.status not in ('approved', 'suspended') then
    delete from public.enrollments where servant_id = p_servant;
    return;
  end if;
  v_status := case when cur.status = 'suspended' then 'stopped' else 'active' end;

  -- mirrors of classes he no longer serves in, or of an older person
  delete from public.enrollments e
   where e.servant_id = p_servant
     and (e.person_id <> cur.person_id
          or not exists (select 1 from public.servant_all_scopes(p_servant) t where t.class_id = e.class_id));

  for r in
    select distinct t.church_id, t.service_id, t.class_id
      from public.servant_all_scopes(p_servant) t
     where t.class_id is not null
  loop
    insert into public.enrollments (person_id, church_id, service_id, class_id, kind, servant_id, status, created_by, edited_by)
    values (cur.person_id, r.church_id, r.service_id, r.class_id, 'servant', p_servant, v_status,
            coalesce(cur.approved_by, cur.id), coalesce(cur.approved_by, cur.id))
    on conflict (person_id, class_id) do update
      set kind = 'servant', servant_id = excluded.servant_id, status = excluded.status,
          church_id = excluded.church_id, service_id = excluded.service_id;
  end loop;
end $$;

create or replace function public.sync_servant_mirror_enrollment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    delete from public.enrollments where servant_id = old.id;
    return old;
  end if;
  perform public.sync_servant_mirrors(new.id);
  return new;
end $$;
-- (trigger trg_sync_servant_mirror_enrollment from 0042 stays bound to this function)

create or replace function public.sync_servant_mirror_from_scopes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform public.sync_servant_mirrors(old.servant_id); end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.servant_id <> old.servant_id) then
    perform public.sync_servant_mirrors(new.servant_id);
  end if;
  return null;
end $$;
drop trigger if exists trg_sync_servant_mirror_from_scopes on public.servant_scopes;
create trigger trg_sync_servant_mirror_from_scopes
after insert or update or delete on public.servant_scopes
for each row execute function public.sync_servant_mirror_from_scopes();

-- ---------------------------------------------------------------------
-- 6. set_servant_scopes — replace the list of places of a servant
--    p_scopes: [{church_id, service_id, class_id}, …] — the FIRST becomes the
--    primary scope (servant_enrollments columns), the rest → servant_scopes.
--    A manager may only touch scopes inside his own area: his provided list
--    replaces the servant's scopes WITHIN that area; scopes outside it are
--    kept untouched. The owner replaces everything.
-- ---------------------------------------------------------------------
create or replace function public.set_servant_scopes(p_servant uuid, p_scopes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t public.servant_enrollments%rowtype;
  v jsonb;
  v_c uuid; v_s uuid; v_k uuid;
  v_kept jsonb := '[]'::jsonb;       -- scopes outside the caller's area (untouched)
  v_given jsonb := '[]'::jsonb;      -- validated + deduplicated input
  v_final jsonb;
  v_first boolean := true;
  v_pc uuid; v_ps uuid; v_pk uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into t from public.servant_enrollments where id = p_servant;
  if not found then raise exception 'servant_not_found' using errcode = '22023'; end if;
  if not (public.is_owner() or public.can_manage_servant(p_servant)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_scopes is null or jsonb_typeof(p_scopes) <> 'array' then
    raise exception 'scopes_required' using errcode = '22023';
  end if;

  -- 1) scopes the caller may NOT touch stay (never for the owner)
  if not public.is_owner() then
    select coalesce(jsonb_agg(jsonb_build_object('church_id', x.church_id, 'service_id', x.service_id, 'class_id', x.class_id)), '[]'::jsonb)
      into v_kept
      from public.servant_all_scopes(p_servant) x
     where not public.scope_grantable(x.church_id, x.service_id, x.class_id);
  end if;

  -- 2) validate + normalise the provided ones (role decides the depth)
  for v in select * from jsonb_array_elements(p_scopes) loop
    v_c := nullif(v->>'church_id', '')::uuid;
    v_s := nullif(v->>'service_id', '')::uuid;
    v_k := nullif(v->>'class_id', '')::uuid;
    if v_c is null then raise exception 'church_required' using errcode = '22023'; end if;
    if t.role = 'church_manager' then v_s := null; v_k := null; end if;
    if t.role = 'service_manager' then v_k := null; end if;
    if not exists (select 1 from public.churches c where c.id = v_c) then
      raise exception 'church_not_found' using errcode = '22023';
    end if;
    if v_s is not null and not exists (select 1 from public.services s where s.id = v_s and s.church_id = v_c) then
      raise exception 'service_not_in_church' using errcode = '22023';
    end if;
    if v_k is not null and (v_s is null or not exists (select 1 from public.classes c where c.id = v_k and c.service_id = v_s)) then
      raise exception 'class_not_in_service' using errcode = '22023';
    end if;
    if not public.scope_grantable(v_c, v_s, v_k) then
      raise exception 'scope_not_allowed' using errcode = '42501';
    end if;
    if not exists (select 1 from jsonb_array_elements(v_given) e
                    where (e->>'church_id')::uuid = v_c
                      and nullif(e->>'service_id', '')::uuid is not distinct from v_s
                      and nullif(e->>'class_id', '')::uuid is not distinct from v_k) then
      v_given := v_given || jsonb_build_object('church_id', v_c, 'service_id', v_s, 'class_id', v_k);
    end if;
  end loop;
  -- the provided scopes come FIRST (the first provided = primary), the kept ones after
  v_final := v_given || v_kept;
  if jsonb_array_length(v_final) = 0 then raise exception 'scopes_required' using errcode = '22023'; end if;

  -- 3) write: first → primary, rest → servant_scopes
  perform set_config('app.in_servant_signup', '1', true);   -- bypass the self-update guard
  delete from public.servant_scopes where servant_id = p_servant;
  for v in select * from jsonb_array_elements(v_final) loop
    v_c := (v->>'church_id')::uuid; v_s := (v->>'service_id')::uuid; v_k := (v->>'class_id')::uuid;
    if v_first then
      v_pc := v_c; v_ps := v_s; v_pk := v_k; v_first := false;
    else
      insert into public.servant_scopes (servant_id, church_id, service_id, class_id, created_by)
      values (p_servant, v_c, v_s, v_k, auth.uid())
      on conflict do nothing;
    end if;
  end loop;
  update public.servant_enrollments
     set church_id = v_pc, service_id = v_ps, class_id = v_pk, updated_at = now()
   where id = p_servant;
  perform set_config('app.in_servant_signup', '0', true);

  return jsonb_build_object('servant_id', p_servant, 'scopes', v_final, 'count', jsonb_array_length(v_final));
end $$;
revoke all on function public.set_servant_scopes(uuid, jsonb) from public, anon;
grant execute on function public.set_servant_scopes(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 7. servant_signup — p_scopes (array of places); the old single-scope
--    parameters keep working when p_scopes is null.
-- ---------------------------------------------------------------------
drop function if exists public.servant_signup(text, text, text, date, text, text, text, uuid, uuid, uuid, text);
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
  p_image_url text default null,
  p_scopes jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_code text := nullif(trim(p_code), '');
  v_user_id text;
  v_person public.persons%rowtype;
  v_created boolean := false;
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_scopes jsonb;
  v jsonb; v_c uuid; v_s uuid; v_k uuid;
  v_i int := 0;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if v_code is null then raise exception 'code_required' using errcode = '22023'; end if;
  if coalesce(trim(p_full_name), '') = '' then raise exception 'name_required' using errcode = '22023'; end if;
  if p_gender is not null and p_gender not in ('male', 'female') then raise exception 'invalid_gender' using errcode = '22023'; end if;
  if v_phone is null then raise exception 'phone_required' using errcode = '22023'; end if;

  -- the list of places: p_scopes, or the legacy single scope
  v_scopes := case
    when p_scopes is not null and jsonb_typeof(p_scopes) = 'array' and jsonb_array_length(p_scopes) > 0 then p_scopes
    when p_church is not null then jsonb_build_array(jsonb_build_object('church_id', p_church, 'service_id', p_service, 'class_id', p_class))
    else '[]'::jsonb end;

  -- every chain must be consistent (all optional — the approver may set it)
  for v in select * from jsonb_array_elements(v_scopes) loop
    v_c := nullif(v->>'church_id', '')::uuid; v_s := nullif(v->>'service_id', '')::uuid; v_k := nullif(v->>'class_id', '')::uuid;
    if v_c is null then raise exception 'church_required' using errcode = '22023'; end if;
    if v_s is not null and not exists (select 1 from public.services s where s.id = v_s and s.church_id = v_c) then
      raise exception 'service_not_in_church' using errcode = '22023';
    end if;
    if v_k is not null and (v_s is null or not exists (select 1 from public.classes c where c.id = v_k and c.service_id = v_s)) then
      raise exception 'class_not_in_service' using errcode = '22023';
    end if;
  end loop;
  -- primary = the first place
  v_c := nullif(v_scopes->0->>'church_id', '')::uuid;
  v_s := nullif(v_scopes->0->>'service_id', '')::uuid;
  v_k := nullif(v_scopes->0->>'class_id', '')::uuid;

  v_user_id := public.code_to_user_id(v_code);
  if exists (select 1 from public.servant_enrollments s where s.user_id = v_user_id and s.id <> v_uid) then
    raise exception 'code_taken' using errcode = '23505';
  end if;

  perform set_config('app.in_servant_signup', '1', true);
  insert into public.servant_enrollments (id, full_name, user_id, phone, role, status, church_id, service_id, class_id)
  values (v_uid, trim(p_full_name), v_user_id, v_phone, 'class_servant', 'pending', v_c, v_s, v_k)
  on conflict (id) do nothing;
  if not exists (select 1 from public.servant_enrollments s where s.id = v_uid and s.status = 'pending') then
    raise exception 'already_registered' using errcode = '23505';
  end if;

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

  update public.servant_enrollments set
    person_id  = v_person.id,
    full_name  = v_person.name,
    user_id    = v_user_id,
    phone      = coalesce(v_person.phone, v_phone),
    church_id  = v_c,
    service_id = v_s,
    class_id   = v_k,
    photo_url  = v_person.image_url,
    updated_at = now()
  where id = v_uid and status = 'pending';

  -- the other requested places (re-running the signup refreshes them)
  delete from public.servant_scopes where servant_id = v_uid;
  for v in select * from jsonb_array_elements(v_scopes) loop
    v_i := v_i + 1;
    if v_i = 1 then continue; end if;
    insert into public.servant_scopes (servant_id, church_id, service_id, class_id, created_by)
    values (v_uid, nullif(v->>'church_id', '')::uuid, nullif(v->>'service_id', '')::uuid, nullif(v->>'class_id', '')::uuid, v_uid)
    on conflict do nothing;
  end loop;

  perform set_config('app.in_servant_signup', '0', true);
  return jsonb_build_object('person_id', v_person.id, 'person_created', v_created,
                            'national_id', v_person.national_id, 'user_id', v_user_id,
                            'scopes', jsonb_array_length(v_scopes));
end $$;
grant execute on function public.servant_signup(text, text, text, date, text, text, text, uuid, uuid, uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 8. admin_add_servant — p_scopes (service_role only, as in 0041)
-- ---------------------------------------------------------------------
drop function if exists public.admin_add_servant(uuid, uuid, text, text, public.app_role, uuid, uuid, uuid, text, date, text, text, text, text, uuid[]);
create or replace function public.admin_add_servant(
  p_actor     uuid,
  p_account   uuid,
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
  p_profiles  uuid[] default '{}',
  p_scopes    jsonb default null
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
  v_scopes jsonb;
  v jsonb; v_c uuid; v_s uuid; v_k uuid;
  v_i int := 0;
begin
  if p_actor is null or p_account is null then
    raise exception 'actor_required' using errcode = '22023';
  end if;
  select * into v_actor from public.servant_enrollments where id = p_actor;
  if not found or v_actor.status <> 'approved'
     or v_actor.role not in ('owner', 'church_manager', 'service_manager') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if v_code is null then raise exception 'code_required' using errcode = '22023'; end if;
  if v_name is null then raise exception 'name_required' using errcode = '22023'; end if;
  if p_gender is not null and p_gender not in ('male', 'female') then
    raise exception 'invalid_gender' using errcode = '22023';
  end if;
  if p_role = 'owner' then raise exception 'role_not_allowed' using errcode = '42501'; end if;

  -- what may THIS actor grant? (role)
  if v_actor.role = 'church_manager' and p_role = 'church_manager' then raise exception 'role_not_allowed' using errcode = '42501'; end if;
  if v_actor.role = 'service_manager' and p_role <> 'class_servant' then raise exception 'role_not_allowed' using errcode = '42501'; end if;

  v_scopes := case
    when p_scopes is not null and jsonb_typeof(p_scopes) = 'array' and jsonb_array_length(p_scopes) > 0 then p_scopes
    when p_church is not null then jsonb_build_array(jsonb_build_object('church_id', p_church, 'service_id', p_service, 'class_id', p_class))
    else '[]'::jsonb end;
  if jsonb_array_length(v_scopes) = 0 then raise exception 'church_required' using errcode = '22023'; end if;

  -- validate + normalise every place; the actor must be allowed to grant each
  for v in select * from jsonb_array_elements(v_scopes) loop
    v_c := nullif(v->>'church_id', '')::uuid; v_s := nullif(v->>'service_id', '')::uuid; v_k := nullif(v->>'class_id', '')::uuid;
    if v_c is null then raise exception 'church_required' using errcode = '22023'; end if;
    if p_role = 'church_manager' then v_s := null; v_k := null; end if;
    if p_role = 'service_manager' then v_k := null; end if;
    if not exists (select 1 from public.churches c where c.id = v_c) then
      raise exception 'church_not_found' using errcode = '22023';
    end if;
    if v_s is not null and not exists (select 1 from public.services s where s.id = v_s and s.church_id = v_c) then
      raise exception 'service_not_in_church' using errcode = '22023';
    end if;
    if v_k is not null and (v_s is null or not exists (select 1 from public.classes c where c.id = v_k and c.service_id = v_s)) then
      raise exception 'class_not_in_service' using errcode = '22023';
    end if;
    if not public.scope_grantable_by(p_actor, v_c, v_s, v_k) then
      raise exception 'scope_not_allowed' using errcode = '42501';
    end if;
  end loop;
  v_c := nullif(v_scopes->0->>'church_id', '')::uuid;
  v_s := case when p_role = 'church_manager' then null else nullif(v_scopes->0->>'service_id', '')::uuid end;
  v_k := case when p_role = 'class_servant' then nullif(v_scopes->0->>'class_id', '')::uuid else null end;

  v_user_id := public.code_to_user_id(v_code);
  if exists (select 1 from public.servant_enrollments s where s.user_id = v_user_id) then
    raise exception 'code_taken' using errcode = '23505';
  end if;
  if exists (select 1 from public.servant_enrollments s where s.id = p_account) then
    raise exception 'already_registered' using errcode = '23505';
  end if;
  select * into v_person from public.persons where national_id = v_code;
  if found and exists (select 1 from public.servant_enrollments s where s.person_id = v_person.id) then
    raise exception 'code_taken' using errcode = '23505';
  end if;

  perform set_config('app.in_servant_signup', '1', true);
  insert into public.servant_enrollments
    (id, full_name, user_id, phone, role, status, church_id, service_id, class_id, approved_by, approved_at)
  values
    (p_account, v_name, v_user_id, coalesce(v_phone, ''), p_role, 'approved', v_c, v_s, v_k, p_actor, now());

  if v_person.id is null then
    insert into public.persons (national_id, name, gender, birthdate, phone, address, notes, image_url, created_by, edited_by)
    values (v_code, v_name, p_gender, p_birthdate, v_phone,
            nullif(trim(coalesce(p_address, '')), ''), nullif(trim(coalesce(p_notes, '')), ''),
            p_image_url, p_actor, p_actor)
    returning * into v_person;
    v_created := true;
  else
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

  update public.servant_enrollments set
    person_id = v_person.id,
    full_name = v_person.name,
    phone     = coalesce(v_person.phone, ''),
    photo_url = v_person.image_url,
    updated_at = now()
  where id = p_account;

  -- the other places
  for v in select * from jsonb_array_elements(v_scopes) loop
    v_i := v_i + 1;
    if v_i = 1 then continue; end if;
    insert into public.servant_scopes (servant_id, church_id, service_id, class_id, created_by)
    values (p_account, nullif(v->>'church_id', '')::uuid,
            case when p_role = 'church_manager' then null else nullif(v->>'service_id', '')::uuid end,
            case when p_role = 'class_servant' then nullif(v->>'class_id', '')::uuid else null end,
            p_actor)
    on conflict do nothing;
  end loop;
  perform set_config('app.in_servant_signup', '0', true);

  -- permission profiles
  if p_profiles is not null and array_length(p_profiles, 1) > 0 then
    insert into public.permissions (servant_id, permission_profile_id, granted_by)
    select p_account, pp.id, p_actor
      from public.permission_profiles pp
     where pp.id = any (p_profiles)
    on conflict (servant_id, permission_profile_id) do nothing;
    get diagnostics v_granted = row_count;
  end if;

  return jsonb_build_object(
    'servant_id', p_account, 'person_id', v_person.id, 'person_created', v_created,
    'national_id', v_person.national_id, 'user_id', v_user_id,
    'profiles_granted', v_granted, 'scopes', jsonb_array_length(v_scopes));
end $$;
revoke all on function public.admin_add_servant(uuid, uuid, text, text, public.app_role, uuid, uuid, uuid, text, date, text, text, text, text, uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.admin_add_servant(uuid, uuid, text, text, public.app_role, uuid, uuid, uuid, text, date, text, text, text, text, uuid[], jsonb) to service_role;

-- ---------------------------------------------------------------------
-- 9. set_enrollments_status — a scope-wide stop reaches servants whose
--    EXTRA scope lies inside it too (same body as 0043 otherwise)
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
       where exists (select 1 from public.servant_all_scopes(s.id) t
                      where t.church_id = p_church
                        and (p_service is null or t.service_id = p_service)
                        and (p_class   is null or t.class_id   = p_class))
         and s.status in ('approved', 'suspended')
         and s.status <> v_srv_status
         and public.can_manage_servant(s.id)
      returning 1)
    select count(*) into v_servants from upd;
  end if;

  return jsonb_build_object('children', v_children, 'servants', v_servants);
end $$;

-- ---------------------------------------------------------------------
-- 10. Housekeeping: 0042 added `p_password` to add_person_and_enroll but
--     left the older 12-argument overload in place → a call with the
--     defaults is ambiguous ("could not choose a best candidate"). Keep
--     only the 13-argument version.
-- ---------------------------------------------------------------------
drop function if exists public.add_person_and_enroll(uuid, uuid, uuid, text, text, text, date, text, text, text, text, integer);

-- ---------------------------------------------------------------------
-- 11. Backfill: mirrors of every servant are rebuilt under the new rule
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select id from public.servant_enrollments where status in ('approved', 'suspended') loop
    perform public.sync_servant_mirrors(r.id);
  end loop;
end $$;

commit;
