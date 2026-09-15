-- =====================================================================
-- 0039: LIBRARY MODULE — المكتبة (links only, simple v1)
--
-- A library organised by SUBJECTS. Each subject holds BOOKS (PDF links)
-- and LECTURES (video / voice links). Nothing is uploaded or stored — every
-- book / lecture / cover / thumbnail is a URL (Google Drive, YouTube, direct
-- PDF / audio / video …).
--
--   1. library_subjects   — name · description · cover image · audience
--   2. library_books      — subject · title · author · description · cover ·
--                           pdf_url · audience
--   3. library_lectures   — subject · title · speaker · description · date ·
--                           kind (video | voice) · media_url · thumbnail ·
--                           audience
--   4. library_favorites  — ⭐ per servant (user_id) or per child (person_id)
--                           on a book or a lecture
--
-- AUDIENCE (من يرى المحتوى) — reuses the existing scope model:
--   everyone : every servant + every child (child portal)
--   servants : servants only (never shown in the child portal)
--   service  : servants whose scope overlaps church → service, and children
--              enrolled in that service
--   class    : servants whose scope overlaps church → service → class, and
--              children enrolled in that class
--   A book / lecture is visible only when ITS audience AND ITS SUBJECT's
--   audience both allow the viewer.
--
-- PERMISSIONS (existing RBAC — module grant + role + permission keys 0037):
--   library_can(key): module_visible('library') AND (role in owner /
--   church_manager / service_manager  OR  key = 'library.view'  OR
--   has_permission(key)).
--     library.view    — browse (every servant of a granted scope)
--     library.manage  — add / edit / delete subjects, books, lectures
--   Rows with audience service / class additionally require
--   scope_contains(church, service, class) to be written.
--
-- CHILD PORTAL (anon, token = national id):
--   child_portal_library(nid)          → subjects + books + lectures +
--                                        favorites the child may see
--   child_portal_library_favorite(...) → toggle ⭐
--
-- Idempotent — safe to re-run. Depends on 0019 (my_scope / scope_*), 0021
-- (child portal), 0024 (module_visible), 0027 (module_granted_for), 0037
-- (has_permission, servant_enrollments). NO module grant is seeded — the
-- owner enables it per scope in وحدة المالك → صلاحيات الوحدات.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. PERMISSION HELPERS
-- ---------------------------------------------------------------------
create or replace function public.library_can(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.module_visible('library')
     and (
       (select role from public.my_scope()) in ('owner', 'church_manager', 'service_manager')
       or p_key = 'library.view'
       or public.has_permission(p_key)
     )
$$;
grant execute on function public.library_can(text) to authenticated;

create or replace function public.library_permissions()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'view',   public.library_can('library.view'),
    'manage', public.library_can('library.manage')
  )
$$;
grant execute on function public.library_permissions() to authenticated;

-- Can the signed-in SERVANT see content with this audience?
create or replace function public.library_audience_visible(
  p_audience text, p_church uuid, p_service uuid, p_class uuid
) returns boolean language sql stable security definer set search_path = public as $$
  select case p_audience
    when 'everyone' then true
    when 'servants' then true
    when 'service'  then public.scope_overlaps(p_church, p_service, null)
    when 'class'    then public.scope_overlaps(p_church, p_service, p_class)
    else false
  end
$$;
grant execute on function public.library_audience_visible(text, uuid, uuid, uuid) to authenticated;

-- May the signed-in servant WRITE content with this audience?
create or replace function public.library_audience_writable(
  p_audience text, p_church uuid, p_service uuid, p_class uuid
) returns boolean language sql stable security definer set search_path = public as $$
  select public.library_can('library.manage')
     and case p_audience
       when 'everyone' then true
       when 'servants' then true
       when 'service'  then public.scope_contains(p_church, p_service, null)
       when 'class'    then public.scope_contains(p_church, p_service, p_class)
       else false
     end
$$;
grant execute on function public.library_audience_writable(text, uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 1. TABLE: library_subjects (المواضيع)
-- ---------------------------------------------------------------------
create table if not exists public.library_subjects (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  image_url    text,
  audience     text not null default 'everyone' check (audience in ('everyone', 'servants', 'service', 'class')),
  church_id    uuid references public.churches(id) on delete cascade,
  service_id   uuid references public.services(id) on delete cascade,
  class_id     uuid references public.classes(id)  on delete cascade,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.servant_enrollments(id) on delete set null,
  edited_at    timestamptz not null default now(),
  edited_by    uuid references public.servant_enrollments(id) on delete set null,
  constraint library_subjects_name_not_blank check (length(trim(name)) > 0),
  constraint library_subjects_audience_scope check (
    (audience in ('everyone', 'servants') and church_id is null and service_id is null and class_id is null)
    or (audience = 'service' and church_id is not null and service_id is not null and class_id is null)
    or (audience = 'class'   and church_id is not null and service_id is not null and class_id is not null)
  )
);
comment on table public.library_subjects is 'المكتبة — المواضيع (اسم · وصف · صورة · من يراه)';

create index if not exists idx_library_subjects_order on public.library_subjects(sort_order, name);
create index if not exists idx_library_subjects_scope on public.library_subjects(church_id, service_id, class_id);

-- ---------------------------------------------------------------------
-- 2. TABLE: library_books (الكتب — روابط PDF)
-- ---------------------------------------------------------------------
create table if not exists public.library_books (
  id           uuid primary key default gen_random_uuid(),
  subject_id   uuid not null references public.library_subjects(id) on delete cascade,
  title        text not null,
  author       text,
  description  text,
  cover_url    text,
  pdf_url      text not null,
  audience     text not null default 'everyone' check (audience in ('everyone', 'servants', 'service', 'class')),
  church_id    uuid references public.churches(id) on delete cascade,
  service_id   uuid references public.services(id) on delete cascade,
  class_id     uuid references public.classes(id)  on delete cascade,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.servant_enrollments(id) on delete set null,
  edited_at    timestamptz not null default now(),
  edited_by    uuid references public.servant_enrollments(id) on delete set null,
  constraint library_books_title_not_blank check (length(trim(title)) > 0),
  constraint library_books_url_not_blank   check (length(trim(pdf_url)) > 0),
  constraint library_books_audience_scope check (
    (audience in ('everyone', 'servants') and church_id is null and service_id is null and class_id is null)
    or (audience = 'service' and church_id is not null and service_id is not null and class_id is null)
    or (audience = 'class'   and church_id is not null and service_id is not null and class_id is not null)
  )
);
comment on table public.library_books is 'المكتبة — الكتب (رابط PDF · عنوان · مؤلف · وصف · غلاف)';

create index if not exists idx_library_books_subject on public.library_books(subject_id, sort_order, title);
create index if not exists idx_library_books_scope   on public.library_books(church_id, service_id, class_id);

-- ---------------------------------------------------------------------
-- 3. TABLE: library_lectures (المحاضرات — فيديو / صوت)
-- ---------------------------------------------------------------------
create table if not exists public.library_lectures (
  id             uuid primary key default gen_random_uuid(),
  subject_id     uuid not null references public.library_subjects(id) on delete cascade,
  title          text not null,
  speaker        text,
  description    text,
  lecture_date   date,
  kind           text not null default 'video' check (kind in ('video', 'voice')),
  media_url      text not null,
  thumbnail_url  text,
  audience       text not null default 'everyone' check (audience in ('everyone', 'servants', 'service', 'class')),
  church_id      uuid references public.churches(id) on delete cascade,
  service_id     uuid references public.services(id) on delete cascade,
  class_id       uuid references public.classes(id)  on delete cascade,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.servant_enrollments(id) on delete set null,
  edited_at      timestamptz not null default now(),
  edited_by      uuid references public.servant_enrollments(id) on delete set null,
  constraint library_lectures_title_not_blank check (length(trim(title)) > 0),
  constraint library_lectures_url_not_blank   check (length(trim(media_url)) > 0),
  constraint library_lectures_audience_scope check (
    (audience in ('everyone', 'servants') and church_id is null and service_id is null and class_id is null)
    or (audience = 'service' and church_id is not null and service_id is not null and class_id is null)
    or (audience = 'class'   and church_id is not null and service_id is not null and class_id is not null)
  )
);
comment on table public.library_lectures is 'المكتبة — المحاضرات (فيديو أو صوت · رابط · متحدث · تاريخ · صورة)';

create index if not exists idx_library_lectures_subject on public.library_lectures(subject_id, sort_order, lecture_date desc);
create index if not exists idx_library_lectures_scope   on public.library_lectures(church_id, service_id, class_id);

-- ---------------------------------------------------------------------
-- 4. TABLE: library_favorites (⭐ المفضلة)
-- ---------------------------------------------------------------------
create table if not exists public.library_favorites (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.servant_enrollments(id) on delete cascade,  -- a servant …
  person_id   uuid references public.persons(id)             on delete cascade,  -- … or a child
  book_id     uuid references public.library_books(id)       on delete cascade,
  lecture_id  uuid references public.library_lectures(id)    on delete cascade,
  created_at  timestamptz not null default now(),
  constraint library_favorites_one_owner check ((user_id is null) <> (person_id is null)),
  constraint library_favorites_one_item  check ((book_id is null) <> (lecture_id is null))
);
comment on table public.library_favorites is 'المكتبة — المفضلة: خادم (user_id) أو مخدوم (person_id) ⭐ كتاب أو محاضرة';

create unique index if not exists uq_library_fav_user_book      on public.library_favorites(user_id, book_id)      where user_id is not null and book_id is not null;
create unique index if not exists uq_library_fav_user_lecture   on public.library_favorites(user_id, lecture_id)   where user_id is not null and lecture_id is not null;
create unique index if not exists uq_library_fav_person_book    on public.library_favorites(person_id, book_id)    where person_id is not null and book_id is not null;
create unique index if not exists uq_library_fav_person_lecture on public.library_favorites(person_id, lecture_id) where person_id is not null and lecture_id is not null;
create index if not exists idx_library_fav_user   on public.library_favorites(user_id);
create index if not exists idx_library_fav_person on public.library_favorites(person_id);

-- ---------------------------------------------------------------------
-- 5. TRIGGERS — audit, scope chain validation
-- ---------------------------------------------------------------------
create or replace function public.library_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.edited_by  := coalesce(new.edited_by,  auth.uid());
  else
    new.edited_at := now();
    if auth.uid() is not null then new.edited_by := auth.uid(); end if;
  end if;
  -- the service must belong to the church, the class to the service
  if new.service_id is not null and not exists (
    select 1 from public.services s where s.id = new.service_id and s.church_id = new.church_id
  ) then
    raise exception 'service does not belong to the church';
  end if;
  if new.class_id is not null and not exists (
    select 1 from public.classes c
     where c.id = new.class_id and c.service_id = new.service_id and c.church_id = new.church_id
  ) then
    raise exception 'class does not belong to the service';
  end if;
  return new;
end $$;

drop trigger if exists trg_library_subjects_write on public.library_subjects;
create trigger trg_library_subjects_write before insert or update on public.library_subjects
for each row execute function public.library_before_write();
drop trigger if exists trg_library_books_write on public.library_books;
create trigger trg_library_books_write before insert or update on public.library_books
for each row execute function public.library_before_write();
drop trigger if exists trg_library_lectures_write on public.library_lectures;
create trigger trg_library_lectures_write before insert or update on public.library_lectures
for each row execute function public.library_before_write();

-- ---------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------
alter table public.library_subjects  enable row level security;
alter table public.library_books     enable row level security;
alter table public.library_lectures  enable row level security;
alter table public.library_favorites enable row level security;

-- Is the subject visible to the signed-in servant? (security definer so the
-- books / lectures policies don't recurse through the subjects policy)
create or replace function public.library_subject_visible(p_subject uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.library_subjects s
     where s.id = p_subject
       and public.library_audience_visible(s.audience, s.church_id, s.service_id, s.class_id)
  )
$$;
grant execute on function public.library_subject_visible(uuid) to authenticated;

-- subjects ---------------------------------------------------------------
drop policy if exists library_subjects_select on public.library_subjects;
create policy library_subjects_select on public.library_subjects for select using (
  (select public.library_can('library.view'))
  and public.library_audience_visible(audience, church_id, service_id, class_id)
);
drop policy if exists library_subjects_insert on public.library_subjects;
create policy library_subjects_insert on public.library_subjects for insert with check (
  public.library_audience_writable(audience, church_id, service_id, class_id)
);
drop policy if exists library_subjects_update on public.library_subjects;
create policy library_subjects_update on public.library_subjects for update using (
  public.library_audience_writable(audience, church_id, service_id, class_id)
) with check (
  public.library_audience_writable(audience, church_id, service_id, class_id)
);
drop policy if exists library_subjects_delete on public.library_subjects;
create policy library_subjects_delete on public.library_subjects for delete using (
  public.library_audience_writable(audience, church_id, service_id, class_id)
);

-- books -------------------------------------------------------------------
drop policy if exists library_books_select on public.library_books;
create policy library_books_select on public.library_books for select using (
  (select public.library_can('library.view'))
  and public.library_audience_visible(audience, church_id, service_id, class_id)
  and public.library_subject_visible(subject_id)
);
drop policy if exists library_books_insert on public.library_books;
create policy library_books_insert on public.library_books for insert with check (
  public.library_audience_writable(audience, church_id, service_id, class_id)
  and public.library_subject_visible(subject_id)
);
drop policy if exists library_books_update on public.library_books;
create policy library_books_update on public.library_books for update using (
  public.library_audience_writable(audience, church_id, service_id, class_id)
) with check (
  public.library_audience_writable(audience, church_id, service_id, class_id)
  and public.library_subject_visible(subject_id)
);
drop policy if exists library_books_delete on public.library_books;
create policy library_books_delete on public.library_books for delete using (
  public.library_audience_writable(audience, church_id, service_id, class_id)
);

-- lectures ----------------------------------------------------------------
drop policy if exists library_lectures_select on public.library_lectures;
create policy library_lectures_select on public.library_lectures for select using (
  (select public.library_can('library.view'))
  and public.library_audience_visible(audience, church_id, service_id, class_id)
  and public.library_subject_visible(subject_id)
);
drop policy if exists library_lectures_insert on public.library_lectures;
create policy library_lectures_insert on public.library_lectures for insert with check (
  public.library_audience_writable(audience, church_id, service_id, class_id)
  and public.library_subject_visible(subject_id)
);
drop policy if exists library_lectures_update on public.library_lectures;
create policy library_lectures_update on public.library_lectures for update using (
  public.library_audience_writable(audience, church_id, service_id, class_id)
) with check (
  public.library_audience_writable(audience, church_id, service_id, class_id)
  and public.library_subject_visible(subject_id)
);
drop policy if exists library_lectures_delete on public.library_lectures;
create policy library_lectures_delete on public.library_lectures for delete using (
  public.library_audience_writable(audience, church_id, service_id, class_id)
);

-- favorites: a servant owns his rows; children go through the RPC ----------
drop policy if exists library_favorites_select on public.library_favorites;
create policy library_favorites_select on public.library_favorites for select using (
  user_id = auth.uid()
);
drop policy if exists library_favorites_insert on public.library_favorites;
create policy library_favorites_insert on public.library_favorites for insert with check (
  user_id = auth.uid() and person_id is null and (select public.library_can('library.view'))
);
drop policy if exists library_favorites_delete on public.library_favorites;
create policy library_favorites_delete on public.library_favorites for delete using (
  user_id = auth.uid()
);

-- ---------------------------------------------------------------------
-- 7. CHILD PORTAL — anon RPCs (token = national id)
-- ---------------------------------------------------------------------
-- Is content with this audience visible to the child (any of his
-- enrollments, and the module granted for that enrollment)?
create or replace function public.library_child_visible(
  p_person uuid, p_audience text, p_church uuid, p_service uuid, p_class uuid
) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.enrollments e
     where e.person_id = p_person
       and public.module_granted_for('library', e.church_id, e.service_id, e.class_id)
       and case p_audience
             when 'everyone' then true
             when 'service'  then e.church_id = p_church and e.service_id = p_service
             when 'class'    then e.church_id = p_church and e.service_id = p_service and e.class_id = p_class
             else false
           end
  )
$$;
revoke all on function public.library_child_visible(uuid, text, uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.child_portal_library(p_national_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  p public.persons;
  v_subjects jsonb; v_books jsonb; v_lectures jsonb; v_favs jsonb;
begin
  p := public.child_portal_person(p_national_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name, 'description', s.description, 'image_url', s.image_url,
           'sort_order', s.sort_order
         ) order by s.sort_order, s.name), '[]'::jsonb)
    into v_subjects
    from public.library_subjects s
   where public.library_child_visible(p.id, s.audience, s.church_id, s.service_id, s.class_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'subject_id', b.subject_id, 'title', b.title, 'author', b.author,
           'description', b.description, 'cover_url', b.cover_url, 'pdf_url', b.pdf_url,
           'sort_order', b.sort_order, 'created_at', b.created_at
         ) order by b.sort_order, b.title), '[]'::jsonb)
    into v_books
    from public.library_books b
    join public.library_subjects s on s.id = b.subject_id
   where public.library_child_visible(p.id, s.audience, s.church_id, s.service_id, s.class_id)
     and public.library_child_visible(p.id, b.audience, b.church_id, b.service_id, b.class_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'subject_id', l.subject_id, 'title', l.title, 'speaker', l.speaker,
           'description', l.description, 'lecture_date', l.lecture_date, 'kind', l.kind,
           'media_url', l.media_url, 'thumbnail_url', l.thumbnail_url,
           'sort_order', l.sort_order, 'created_at', l.created_at
         ) order by l.sort_order, l.lecture_date desc nulls last, l.title), '[]'::jsonb)
    into v_lectures
    from public.library_lectures l
    join public.library_subjects s on s.id = l.subject_id
   where public.library_child_visible(p.id, s.audience, s.church_id, s.service_id, s.class_id)
     and public.library_child_visible(p.id, l.audience, l.church_id, l.service_id, l.class_id);

  select coalesce(jsonb_agg(jsonb_build_object('book_id', f.book_id, 'lecture_id', f.lecture_id)), '[]'::jsonb)
    into v_favs
    from public.library_favorites f
   where f.person_id = p.id;

  return jsonb_build_object('subjects', v_subjects, 'books', v_books, 'lectures', v_lectures, 'favorites', v_favs);
end $$;
grant execute on function public.child_portal_library(text) to anon, authenticated;

-- toggle ⭐ — p_on = true → add, false → remove. Only on items he can see.
create or replace function public.child_portal_library_favorite(
  p_national_id text, p_book uuid, p_lecture uuid, p_on boolean
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  p public.persons;
  ok boolean := false;
begin
  p := public.child_portal_person(p_national_id);
  if (p_book is null) = (p_lecture is null) then
    raise exception 'invalid_item' using errcode = 'P0001';
  end if;

  if p_book is not null then
    select public.library_child_visible(p.id, s.audience, s.church_id, s.service_id, s.class_id)
       and public.library_child_visible(p.id, b.audience, b.church_id, b.service_id, b.class_id)
      into ok
      from public.library_books b join public.library_subjects s on s.id = b.subject_id
     where b.id = p_book;
  else
    select public.library_child_visible(p.id, s.audience, s.church_id, s.service_id, s.class_id)
       and public.library_child_visible(p.id, l.audience, l.church_id, l.service_id, l.class_id)
      into ok
      from public.library_lectures l join public.library_subjects s on s.id = l.subject_id
     where l.id = p_lecture;
  end if;
  if not coalesce(ok, false) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if p_on then
    insert into public.library_favorites (person_id, book_id, lecture_id)
    values (p.id, p_book, p_lecture)
    on conflict do nothing;
  else
    delete from public.library_favorites
     where person_id = p.id
       and ((p_book is not null and book_id = p_book) or (p_lecture is not null and lecture_id = p_lecture));
  end if;
  return p_on;
end $$;
grant execute on function public.child_portal_library_favorite(text, uuid, uuid, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. REALTIME
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['library_subjects', 'library_books', 'library_lectures', 'library_favorites'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception when undefined_object then null;   -- no publication on a local shim
end $$;
alter table public.library_subjects  replica identity full;
alter table public.library_books     replica identity full;
alter table public.library_lectures  replica identity full;
alter table public.library_favorites replica identity full;

commit;
