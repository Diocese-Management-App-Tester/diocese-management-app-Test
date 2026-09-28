-- =====================================================================
-- 20260928130000 — (A) ترتيب الكنائس / الخدمات / الفصول يدويًا
--                  (B) أب اعتراف واحد لكل شخص
-- =====================================================================
--
-- (A) MANUAL ORDER — churches · services · classes
--   * `sort_order integer` on the three structural tables. The manager
--     decides what comes first and what comes next; EVERY list / select /
--     tree in the app (settings pages, scope filters, scanner, children
--     page, statistics…) reads `order by sort_order, name` so the chosen
--     order is the one shown everywhere.
--   * Backfill: existing rows are numbered 1..n by name inside their parent
--     (churches globally · services per church · classes per service).
--   * BEFORE INSERT trigger: a new row without an explicit order goes to the
--     END of its siblings (max + 1) — never «jumps» in front of the others.
--   * RPC `reorder_scope_items(p_table, p_ids)` — the caller sends the ids
--     of the siblings in the wanted order and the rows are renumbered
--     1..n. SECURITY INVOKER → the normal RLS update policies decide who
--     may reorder what (owner everything · church manager his services and
--     classes · service manager his classes). A row the caller may not
--     update raises `forbidden`.
--   * `stats_attendance_by_class` follows the manual order too.
--
-- (B) ONE CONFESSION FATHER — priest_confessors
--   A person can NOT be the confessor of two priests at the same time.
--   * Existing duplicates are collapsed: the priest with the most recent
--     confession wins (then the most recently added row).
--   * `unique (person_id)` on priest_confessors.
--   * BEFORE INSERT trigger: adding the person to a priest DELETES his row
--     at any other priest first — «the new one replaces the old one». This
--     covers every path that binds a confessor: add by scan / search / new
--     person, تسجيل اعتراف, موعد created by the priest, approving a child's
--     appointment request.
--   * `priest_add_confessor` returns `moved_from` (the previous priest's
--     name) so the UI can say «تم نقله من أبونا فلان»;
--     `priest_lookup_code` returns `other_priest` like the search does.
--   The old priest keeps his confession history rows (`confessions`) — only
--     the binding moves.
--
-- Idempotent. Run after 20260928120000.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A1. sort_order columns + backfill
-- ---------------------------------------------------------------------
alter table public.churches add column if not exists sort_order integer not null default 0;
alter table public.services add column if not exists sort_order integer not null default 0;
alter table public.classes  add column if not exists sort_order integer not null default 0;

comment on column public.churches.sort_order is 'الترتيب اليدوي — الأصغر يظهر أولاً في كل القوائم';
comment on column public.services.sort_order is 'الترتيب اليدوي داخل الكنيسة — الأصغر يظهر أولاً في كل القوائم';
comment on column public.classes.sort_order  is 'الترتيب اليدوي داخل الخدمة — الأصغر يظهر أولاً في كل القوائم';

-- number the rows that were never ordered (0) by name inside their parent,
-- AFTER the rows that already carry an order (re-running is harmless)
with r as (
  select id, row_number() over (order by (sort_order = 0), sort_order, name collate "C", created_at) as rn
    from public.churches)
update public.churches c set sort_order = r.rn from r where r.id = c.id and c.sort_order <> r.rn;

with r as (
  select id, row_number() over (partition by church_id order by (sort_order = 0), sort_order, name collate "C", created_at) as rn
    from public.services)
update public.services s set sort_order = r.rn from r where r.id = s.id and s.sort_order <> r.rn;

with r as (
  select id, row_number() over (partition by service_id order by (sort_order = 0), sort_order, name collate "C", created_at) as rn
    from public.classes)
update public.classes k set sort_order = r.rn from r where r.id = k.id and k.sort_order <> r.rn;

create index if not exists idx_churches_sort on public.churches(sort_order, name);
create index if not exists idx_services_sort on public.services(church_id, sort_order, name);
create index if not exists idx_classes_sort  on public.classes(service_id, sort_order, name);

-- ---------------------------------------------------------------------
-- A2. new rows go to the end of their siblings
-- ---------------------------------------------------------------------
create or replace function public.scope_item_default_order()
returns trigger language plpgsql as $$
begin
  if new.sort_order is null or new.sort_order <= 0 then
    if tg_table_name = 'churches' then
      select coalesce(max(sort_order), 0) + 1 into new.sort_order from public.churches;
    elsif tg_table_name = 'services' then
      select coalesce(max(sort_order), 0) + 1 into new.sort_order from public.services where church_id = new.church_id;
    else
      select coalesce(max(sort_order), 0) + 1 into new.sort_order from public.classes where service_id = new.service_id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_churches_default_order on public.churches;
create trigger trg_churches_default_order before insert on public.churches
  for each row execute function public.scope_item_default_order();
drop trigger if exists trg_services_default_order on public.services;
create trigger trg_services_default_order before insert on public.services
  for each row execute function public.scope_item_default_order();
drop trigger if exists trg_classes_default_order on public.classes;
create trigger trg_classes_default_order before insert on public.classes
  for each row execute function public.scope_item_default_order();

-- ---------------------------------------------------------------------
-- A3. reorder RPC — siblings renumbered 1..n in the given order (RLS applies)
-- ---------------------------------------------------------------------
create or replace function public.reorder_scope_items(p_table text, p_ids uuid[])
returns void language plpgsql volatile security invoker set search_path = public as $$
declare i integer; n integer;
begin
  if p_table not in ('churches', 'services', 'classes') then
    raise exception 'invalid_table' using errcode = '22023';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then return; end if;
  for i in 1 .. array_length(p_ids, 1) loop
    execute format('update public.%I set sort_order = $1 where id = $2', p_table) using i, p_ids[i];
    get diagnostics n = row_count;
    if n = 0 then raise exception 'forbidden' using errcode = '42501'; end if;
  end loop;
end $$;
revoke all on function public.reorder_scope_items(text, uuid[]) from public, anon;
grant execute on function public.reorder_scope_items(text, uuid[]) to authenticated;
comment on function public.reorder_scope_items(text, uuid[]) is 'إعادة ترتيب الكنائس / الخدمات / الفصول — المعرّفات بالترتيب المطلوب؛ صلاحيات RLS تُطبَّق';

-- ---------------------------------------------------------------------
-- A4. statistics follow the manual order
-- ---------------------------------------------------------------------
create or replace function public.stats_attendance_by_class(
  p_day date,
  p_church uuid default null, p_service uuid default null, p_class uuid default null,
  p_kind text default 'child')
returns table (
  class_id     uuid,
  class_name   text,
  service_name text,
  church_name  text,
  enrolled     bigint,
  attendees    bigint,
  attendance   bigint,
  points       bigint
)
language sql stable security invoker set search_path = public as $$
  with sc as (
    select e.id, e.person_id, e.class_id
      from public.enrollments e
     where (p_church  is null or e.church_id  = p_church)
       and (p_service is null or e.service_id = p_service)
       and (p_class   is null or e.class_id   = p_class)
       and (p_kind is null or p_kind = 'all' or e.kind = p_kind)
  ),
  att as (
    select sc.class_id, sc.person_id, a.points_delta
      from public.attendance_log a join sc on sc.id = a.enrollment_id
     where a.attended_on = p_day
  )
  select c.id, c.name, s.name, ch.name,
         (select count(*) from sc where sc.class_id = c.id)::bigint,
         (select count(distinct person_id) from att where att.class_id = c.id)::bigint,
         (select count(*) from att where att.class_id = c.id)::bigint,
         (select coalesce(sum(points_delta), 0) from att where att.class_id = c.id)::bigint
    from public.classes c
    join public.services s on s.id = c.service_id
    join public.churches ch on ch.id = c.church_id
   where c.id in (select distinct class_id from sc)
   order by ch.sort_order, ch.name, s.sort_order, s.name, c.sort_order, c.name
$$;

-- ---------------------------------------------------------------------
-- B1. one confession father per person — collapse duplicates
-- ---------------------------------------------------------------------
with ranked as (
  select c.id,
         row_number() over (
           partition by c.person_id
           order by (select max(x.confessed_on) from public.confessions x where x.priest_id = c.priest_id and x.person_id = c.person_id) desc nulls last,
                    c.created_at desc) as rn
    from public.priest_confessors c)
delete from public.priest_confessors where id in (select id from ranked where rn > 1);

create unique index if not exists uq_priest_confessors_person on public.priest_confessors(person_id);

-- B2. adding him to a priest removes him from any other priest
create or replace function public.priest_confessors_single_father()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.priest_confessors where person_id = new.person_id and priest_id <> new.priest_id;
  return new;
end $$;
drop trigger if exists trg_priest_confessors_single_father on public.priest_confessors;
create trigger trg_priest_confessors_single_father before insert or update of person_id, priest_id on public.priest_confessors
  for each row execute function public.priest_confessors_single_father();

-- B3. RPCs — report the previous priest
create or replace function public.priest_add_confessor(p_token text, p_person uuid, p_notes text default null, p_last_confession date default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests; c public.priest_confessors; v_prev text;
begin
  pr := public.priest_portal_self(p_token);
  if not exists (select 1 from public.persons where id = p_person) then raise exception 'person_not_found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.priest_confessors where priest_id = pr.id and person_id = p_person) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;
  -- the priest he confesses at today (if any) — the insert below moves him here
  select pp.name into v_prev
    from public.priest_confessors x
    join public.priests px on px.id = x.priest_id
    join public.persons pp on pp.id = px.person_id
   where x.person_id = p_person and x.priest_id <> pr.id
   limit 1;
  insert into public.priest_confessors (priest_id, person_id, notes) values (pr.id, p_person, nullif(trim(coalesce(p_notes, '')), ''))
  returning * into c;
  if p_last_confession is not null then
    if p_last_confession > public.cairo_today_date() then raise exception 'future_date' using errcode = '22023'; end if;
    insert into public.confessions (priest_id, person_id, confessed_on, notes) values (pr.id, p_person, p_last_confession, 'آخر اعتراف عند الإضافة');
  end if;
  return public.priest_confessor_json(pr, c) || jsonb_build_object('moved_from', v_prev);
end $$;
grant execute on function public.priest_add_confessor(text, uuid, text, date) to anon, authenticated;

create or replace function public.priest_lookup_code(p_token text, p_code text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare pr public.priests; p public.persons; c public.priest_confessors; v_is boolean;
begin
  pr := public.priest_portal_self(p_token);
  select * into p from public.persons where national_id = trim(coalesce(p_code, ''));
  if not found then return jsonb_build_object('found', false, 'code', trim(coalesce(p_code, ''))); end if;
  select * into c from public.priest_confessors where priest_id = pr.id and person_id = p.id;
  v_is := found;
  return jsonb_build_object('found', true, 'person', public.priest_person_json(p), 'places', public.priest_person_places(p.id),
                            'is_confessor', v_is, 'confessor', case when v_is then public.priest_confessor_json(pr, c) else null end,
                            'other_priest', (select pp.name from public.priest_confessors x
                                               join public.priests px on px.id = x.priest_id
                                               join public.persons pp on pp.id = px.person_id
                                              where x.person_id = p.id and x.priest_id <> pr.id limit 1));
end $$;
grant execute on function public.priest_lookup_code(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
