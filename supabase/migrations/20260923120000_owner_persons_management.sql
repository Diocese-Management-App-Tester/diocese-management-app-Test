-- =====================================================================
-- OWNER MODULE → إدارة الأفراد (/owner/persons)
--
-- ONE page for the owner with EVERY person in the system (persons table —
-- children and servants alike) together with all his enrollments, filtered
-- by church → service → class (or «بدون تسجيلات» — persons that are in no
-- enrollment at all), with multi-select and bulk actions:
--   * add the selected persons to one or more class(es)   (owner_bulk_enroll)
--   * remove the selected persons from a scope             (owner_bulk_unenroll)
--   * delete the selected persons completely (cascade)     (owner_bulk_delete_persons)
--
-- Everything is owner-only (is_owner()) — the page itself sits behind
-- <OwnerGate>, the RPCs are the real wall. Idempotent.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. owner_persons_page — the list (server-side filters + pagination)
--    p_scope_mode: 'all' | 'scope' | 'none'
--       all   → every person
--       scope → persons with ≥ 1 enrollment inside p_church [→ p_service [→ p_class]]
--       none  → persons with NO enrollment row at all
--    p_kind: 'all' | 'child' | 'servant'   (servant = has a servant account)
--    Each row carries ALL his enrollments (jsonb) + his servant account (jsonb
--    or null) + total_count (count(*) over ()) for the pager.
-- ---------------------------------------------------------------------
create or replace function public.owner_persons_page(
  p_search      text default null,
  p_scope_mode  text default 'all',
  p_church      uuid default null,
  p_service     uuid default null,
  p_class       uuid default null,
  p_gender      text default null,
  p_kind        text default 'all',
  p_limit       integer default 100,
  p_offset      integer default 0
) returns table (
  id            uuid,
  national_id   text,
  name          text,
  birthdate     date,
  gender        text,
  phone         text,
  address       text,
  notes         text,
  image_url     text,
  created_at    timestamptz,
  edited_at     timestamptz,
  enrollments   jsonb,
  servant       jsonb,
  has_password  boolean,
  total_count   bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_mode   text := coalesce(p_scope_mode, 'all');
  v_kind   text := coalesce(p_kind, 'all');
  v_limit  integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.is_owner() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_mode not in ('all', 'scope', 'none') then
    raise exception 'invalid_scope_mode' using errcode = '22023';
  end if;
  if v_kind not in ('all', 'child', 'servant') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if p_gender is not null and p_gender not in ('male', 'female') then
    raise exception 'invalid_gender' using errcode = '22023';
  end if;
  if v_mode = 'scope' and p_church is null then
    raise exception 'church_required' using errcode = '22023';
  end if;

  return query
  with base as (
    select p.*
      from public.persons p
     where (v_search is null
            or p.name ilike '%' || v_search || '%'
            or p.phone ilike '%' || v_search || '%'
            or p.national_id ilike '%' || v_search || '%')
       and (p_gender is null or p.gender = p_gender)
       and (
         v_mode = 'all'
         or (v_mode = 'none' and not exists (select 1 from public.enrollments e where e.person_id = p.id))
         or (v_mode = 'scope' and exists (
              select 1 from public.enrollments e
               where e.person_id = p.id
                 and e.church_id = p_church
                 and (p_service is null or e.service_id = p_service)
                 and (p_class   is null or e.class_id   = p_class)))
       )
       and (
         v_kind = 'all'
         or (v_kind = 'servant' and     exists (select 1 from public.servant_enrollments s where s.person_id = p.id))
         or (v_kind = 'child'   and not exists (select 1 from public.servant_enrollments s where s.person_id = p.id))
       )
  ),
  counted as (
    select b.*, count(*) over () as total_count
      from base b
     order by b.name collate "C", b.id
     limit v_limit offset v_offset
  )
  select
    c.id, c.national_id, c.name, c.birthdate, c.gender, c.phone, c.address, c.notes, c.image_url,
    c.created_at, c.edited_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'church_id', e.church_id, 'service_id', e.service_id, 'class_id', e.class_id,
               'kind', e.kind, 'servant_id', e.servant_id, 'status', e.status,
               'points', e.points, 'attendance_count', e.attendance_count, 'created_at', e.created_at)
             order by e.created_at)
        from public.enrollments e where e.person_id = c.id
    ), '[]'::jsonb) as enrollments,
    (
      select jsonb_build_object(
               'id', s.id, 'role', s.role, 'status', s.status,
               'church_id', s.church_id, 'service_id', s.service_id, 'class_id', s.class_id,
               'scopes', coalesce((
                 select jsonb_agg(jsonb_build_object('church_id', x.church_id, 'service_id', x.service_id, 'class_id', x.class_id))
                   from public.servant_scopes x where x.servant_id = s.id), '[]'::jsonb))
        from public.servant_enrollments s where s.person_id = c.id
       limit 1
    ) as servant,
    exists (select 1 from public.person_credentials pc where pc.person_id = c.id) as has_password,
    c.total_count
  from counted c
  order by c.name collate "C", c.id;
end $$;

revoke all on function public.owner_persons_page(text, text, uuid, uuid, uuid, text, text, integer, integer) from public, anon;
grant execute on function public.owner_persons_page(text, text, uuid, uuid, uuid, text, text, integer, integer) to authenticated;

comment on function public.owner_persons_page(text, text, uuid, uuid, uuid, text, text, integer, integer) is
  'إدارة الأفراد (المالك): كل الأشخاص مع تسجيلاتهم وحساب الخادم — بحث · نطاق (كنيسة → خدمة → فصل) أو «بدون تسجيلات» · النوع · الصنف · ترقيم صفحات';

-- ---------------------------------------------------------------------
-- 2. owner_persons_counts — the header counters
-- ---------------------------------------------------------------------
create or replace function public.owner_persons_counts()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_owner() then jsonb_build_object(
    'total',      (select count(*) from public.persons),
    'unenrolled', (select count(*) from public.persons p where not exists (select 1 from public.enrollments e where e.person_id = p.id)),
    'servants',   (select count(*) from public.persons p where     exists (select 1 from public.servant_enrollments s where s.person_id = p.id)),
    'children',   (select count(*) from public.persons p where not exists (select 1 from public.servant_enrollments s where s.person_id = p.id))
  ) else null end
$$;
revoke all on function public.owner_persons_counts() from public, anon;
grant execute on function public.owner_persons_counts() to authenticated;

-- ---------------------------------------------------------------------
-- 3. owner_bulk_enroll — add MANY persons to MANY classes at once
--    p_scopes: jsonb array of {church_id, service_id, class_id} — every
--    level required (an enrollment is always a class). Existing
--    (person, class) pairs are skipped (unique key). Servant mirror rows
--    are never touched. Returns {added, skipped, persons, scopes}.
-- ---------------------------------------------------------------------
create or replace function public.owner_bulk_enroll(
  p_person_ids uuid[],
  p_scopes     jsonb
) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_added   integer := 0;
  v_skipped integer := 0;
  v_persons integer := 0;
  v_n       integer;
  s         record;
begin
  if public.my_role() is null then raise exception 'not_approved' using errcode = '42501'; end if;
  if p_person_ids is null or cardinality(p_person_ids) = 0 then raise exception 'persons_required' using errcode = '22023'; end if;
  if p_scopes is null or jsonb_typeof(p_scopes) <> 'array' or jsonb_array_length(p_scopes) = 0 then
    raise exception 'scopes_required' using errcode = '22023';
  end if;

  select count(*) into v_persons from public.persons p where p.id = any (p_person_ids);

  for s in
    select distinct
           (x->>'church_id')::uuid  as church_id,
           (x->>'service_id')::uuid as service_id,
           (x->>'class_id')::uuid   as class_id
      from jsonb_array_elements(p_scopes) x
  loop
    if s.church_id is null or s.service_id is null or s.class_id is null then
      raise exception 'class_required' using errcode = '22023';
    end if;
    -- the class must really belong to the service / church
    if not exists (
      select 1 from public.classes c
       where c.id = s.class_id and c.service_id = s.service_id and c.church_id = s.church_id
    ) then
      raise exception 'invalid_scope' using errcode = '22023';
    end if;
    -- owner always passes; kept generic so a manager could reuse it within his scope
    if not public.can_access(s.church_id, s.service_id, s.class_id) then
      raise exception 'no_access' using errcode = '42501';
    end if;

    with ins as (
      insert into public.enrollments (person_id, church_id, service_id, class_id, created_by, edited_by)
      select p.id, s.church_id, s.service_id, s.class_id, auth.uid(), auth.uid()
        from public.persons p
       where p.id = any (p_person_ids)
      on conflict (person_id, class_id) do nothing
      returning 1
    )
    select count(*) into v_n from ins;
    v_added   := v_added + v_n;
    v_skipped := v_skipped + (v_persons - v_n);
  end loop;

  return jsonb_build_object(
    'added',   v_added,
    'skipped', v_skipped,
    'persons', v_persons,
    'scopes',  (select count(distinct x->>'class_id') from jsonb_array_elements(p_scopes) x)
  );
end $$;
revoke all on function public.owner_bulk_enroll(uuid[], jsonb) from public, anon;
grant execute on function public.owner_bulk_enroll(uuid[], jsonb) to authenticated;

comment on function public.owner_bulk_enroll(uuid[], jsonb) is
  'إضافة عدة أشخاص إلى عدة فصول دفعة واحدة — التسجيلات الموجودة تُتخطى (person_id, class_id فريد)';

-- ---------------------------------------------------------------------
-- 4. owner_bulk_unenroll — remove MANY persons from a scope
--    p_church [→ p_service [→ p_class]] — nulls = the whole level under.
--    Only CHILD rows go (servant mirror rows follow the servant account and
--    are managed from إدارة الخدام). FK cascade wipes the rows' logs.
-- ---------------------------------------------------------------------
create or replace function public.owner_bulk_unenroll(
  p_person_ids uuid[],
  p_church     uuid,
  p_service    uuid default null,
  p_class      uuid default null
) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_removed integer := 0;
begin
  if public.my_role() is null then raise exception 'not_approved' using errcode = '42501'; end if;
  if p_person_ids is null or cardinality(p_person_ids) = 0 then raise exception 'persons_required' using errcode = '22023'; end if;
  if p_church is null then raise exception 'church_required' using errcode = '22023'; end if;
  if not public.can_access(p_church, p_service, p_class) then
    raise exception 'no_access' using errcode = '42501';
  end if;

  with del as (
    delete from public.enrollments e
     where e.person_id = any (p_person_ids)
       and e.kind = 'child'
       and e.church_id = p_church
       and (p_service is null or e.service_id = p_service)
       and (p_class   is null or e.class_id   = p_class)
    returning 1
  )
  select count(*) into v_removed from del;

  return jsonb_build_object('removed', v_removed);
end $$;
revoke all on function public.owner_bulk_unenroll(uuid[], uuid, uuid, uuid) from public, anon;
grant execute on function public.owner_bulk_unenroll(uuid[], uuid, uuid, uuid) to authenticated;

comment on function public.owner_bulk_unenroll(uuid[], uuid, uuid, uuid) is
  'حذف عدة أشخاص من نطاق (كنيسة → خدمة → فصل؛ null = كل ما تحته) — صفوف المخدومين فقط، ومعها حضورهم ونقاطهم في هذا النطاق';

-- ---------------------------------------------------------------------
-- 5. owner_bulk_delete_persons — delete MANY persons completely (cascade)
--    Owner only. A person who IS a servant account is skipped (the account
--    must be deleted from إدارة الخدام first). Returns {deleted, skipped_servants}.
-- ---------------------------------------------------------------------
create or replace function public.owner_bulk_delete_persons(p_person_ids uuid[])
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_deleted  integer := 0;
  v_servants integer := 0;
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_person_ids is null or cardinality(p_person_ids) = 0 then raise exception 'persons_required' using errcode = '22023'; end if;

  select count(*) into v_servants
    from public.persons p
   where p.id = any (p_person_ids)
     and exists (select 1 from public.servant_enrollments s where s.person_id = p.id);

  with del as (
    delete from public.persons p
     where p.id = any (p_person_ids)
       and not exists (select 1 from public.servant_enrollments s where s.person_id = p.id)
    returning 1
  )
  select count(*) into v_deleted from del;

  return jsonb_build_object('deleted', v_deleted, 'skipped_servants', v_servants);
end $$;
revoke all on function public.owner_bulk_delete_persons(uuid[]) from public, anon;
grant execute on function public.owner_bulk_delete_persons(uuid[]) to authenticated;

comment on function public.owner_bulk_delete_persons(uuid[]) is
  'حذف نهائي متسلسل لعدة أشخاص (المالك فقط) — أصحاب حسابات الخدام يُتخطَّون ويُحذفون من إدارة الخدام';

commit;
