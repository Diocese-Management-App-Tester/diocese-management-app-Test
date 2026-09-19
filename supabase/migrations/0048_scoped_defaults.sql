-- =====================================================================
-- 0048: SCOPED DEFAULTS — الافتراضي لكل مستوى (كنيسة → خدمة → فصل)
--
-- Until now ONE event and ONE cause in the whole database could be
-- "the default" (the app cleared every other `is_default` before
-- saving). That does not fit a diocese: every church needs its own
-- default, a service may want a different one from its church, and a
-- class may want its own again.
--
-- New rule — ONE default PER EXACT SCOPE, resolved most-specific-first:
--
--   scope of the row      meaning
--   ─────────────────     ──────────────────────────────────────────
--   church, null, null    default for the WHOLE church
--   church, service, null default for that SERVICE (overrides church)
--   church, service, cls  default for that CLASS   (overrides service)
--
-- Resolution for a given selection (church → service → class):
--   1. default bound to exactly this class            → use it
--   2. else default bound to exactly this service     → use it
--   3. else default bound to the church (all services) → use it
--   4. else nothing is preselected
--
-- So "if there is a default for the church AND one for the service,
-- the service wins; if the service has none, the church's is used".
--
-- The uniqueness is enforced HERE (trigger) instead of in the app, so
-- the settings forms only need to save `is_default = true`; the other
-- default of the same exact scope is switched off automatically.
-- Defaults of OTHER scopes are never touched.
--
-- Also exposes `default_event_for(church, service, class)` and
-- `default_cause_for(...)` so SQL / RPC callers can resolve the same
-- chain the app resolves (`pickScopedDefault` in src/lib/defaults.ts).
--
-- Idempotent; run after 0047.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. One default per exact scope — events
-- ---------------------------------------------------------------------
create or replace function public.check_event_default_scope()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_default and (tg_op = 'INSERT' or not old.is_default
      or old.church_id is distinct from new.church_id
      or old.service_id is distinct from new.service_id
      or old.class_id is distinct from new.class_id) then
    update public.events
       set is_default = false
     where id <> new.id and is_default
       and church_id = new.church_id
       and service_id is not distinct from new.service_id
       and class_id is not distinct from new.class_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_events_default_scope on public.events;
create trigger trg_events_default_scope before insert or update of is_default, church_id, service_id, class_id
  on public.events
  for each row execute function public.check_event_default_scope();

-- ---------------------------------------------------------------------
-- 2. One default per exact scope — causes
-- ---------------------------------------------------------------------
create or replace function public.check_cause_default_scope()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_default and (tg_op = 'INSERT' or not old.is_default
      or old.church_id is distinct from new.church_id
      or old.service_id is distinct from new.service_id
      or old.class_id is distinct from new.class_id) then
    update public.causes
       set is_default = false
     where id <> new.id and is_default
       and church_id = new.church_id
       and service_id is not distinct from new.service_id
       and class_id is not distinct from new.class_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_causes_default_scope on public.causes;
create trigger trg_causes_default_scope before insert or update of is_default, church_id, service_id, class_id
  on public.causes
  for each row execute function public.check_cause_default_scope();

-- ---------------------------------------------------------------------
-- 3. Clean up existing data: keep at most ONE default per exact scope
--    (the most recently edited one wins), so the new rule holds for
--    rows written before this migration.
-- ---------------------------------------------------------------------
with ranked as (
  select id,
         row_number() over (
           partition by church_id,
                        coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid),
                        coalesce(class_id,   '00000000-0000-0000-0000-000000000000'::uuid)
           order by edited_at desc, created_at desc, id
         ) as rn
    from public.events
   where is_default
)
update public.events e set is_default = false
  from ranked r where r.id = e.id and r.rn > 1;

with ranked as (
  select id,
         row_number() over (
           partition by church_id,
                        coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid),
                        coalesce(class_id,   '00000000-0000-0000-0000-000000000000'::uuid)
           order by edited_at desc, created_at desc, id
         ) as rn
    from public.causes
   where is_default
)
update public.causes c set is_default = false
  from ranked r where r.id = c.id and r.rn > 1;

-- ---------------------------------------------------------------------
-- 4. Indexes for the "find the default of this scope" lookups
-- ---------------------------------------------------------------------
create index if not exists idx_events_default_scope
  on public.events (church_id, service_id, class_id) where is_default;
create index if not exists idx_causes_default_scope
  on public.causes (church_id, service_id, class_id) where is_default;

-- ---------------------------------------------------------------------
-- 5. Resolvers — class → service → church (security invoker: RLS applies)
--    p_service / p_class may be null ("all") → only the wider levels are
--    consulted.
-- ---------------------------------------------------------------------
create or replace function public.default_event_for(p_church uuid, p_service uuid default null, p_class uuid default null)
returns uuid language sql stable security invoker set search_path = public as $$
  select e.id
    from public.events e
   where e.is_default
     and e.church_id = p_church
     and (e.service_id is null or e.service_id = p_service)
     and (e.class_id is null or e.class_id = p_class)
   order by (e.class_id is not null) desc, (e.service_id is not null) desc, e.edited_at desc
   limit 1
$$;

create or replace function public.default_cause_for(p_church uuid, p_service uuid default null, p_class uuid default null)
returns uuid language sql stable security invoker set search_path = public as $$
  select c.id
    from public.causes c
   where c.is_default
     and c.church_id = p_church
     and (c.service_id is null or c.service_id = p_service)
     and (c.class_id is null or c.class_id = p_class)
   order by (c.class_id is not null) desc, (c.service_id is not null) desc, c.edited_at desc
   limit 1
$$;

grant execute on function public.default_event_for(uuid, uuid, uuid) to authenticated;
grant execute on function public.default_cause_for(uuid, uuid, uuid) to authenticated;

comment on function public.default_event_for(uuid, uuid, uuid) is
  'Default event for a selection, most specific first: class → service → church (0048).';
comment on function public.default_cause_for(uuid, uuid, uuid) is
  'Default points cause for a selection, most specific first: class → service → church (0048).';
