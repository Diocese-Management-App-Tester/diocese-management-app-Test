-- =====================================================================
-- 20260927130000 — PRIEST PORTAL part 2: المعترفين · الاعترافات · المواعيد ·
--                  الافتقاد + the child-portal side (طلب موعد اعتراف)
-- Requires 20260927120000_priests_portal.sql (tables + sessions + owner).
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. PROFILE
-- ---------------------------------------------------------------------
create or replace function public.priest_portal_profile(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare pr public.priests; p public.persons; ch public.churches;
begin
  pr := public.priest_portal_self(p_token);
  select * into p from public.persons where id = pr.person_id;
  select * into ch from public.churches where id = pr.church_id;
  return jsonb_build_object(
    'priest', jsonb_build_object('id', pr.id, 'title', pr.title, 'status', pr.status, 'reminder_days', pr.reminder_days,
                                 'church_id', pr.church_id, 'created_at', pr.created_at),
    'person', public.priest_person_json(p),
    'church', jsonb_build_object('id', ch.id, 'name', ch.name, 'logo_url', ch.logo_url),
    'counts', jsonb_build_object(
      'confessors', (select count(*) from public.priest_confessors c where c.priest_id = pr.id),
      'overdue', (select count(*) from public.priest_confessors c where c.priest_id = pr.id
                    and coalesce((select max(x.confessed_on) from public.confessions x where x.priest_id = pr.id and x.person_id = c.person_id), c.created_at::date)
                        < public.cairo_today_date() - pr.reminder_days),
      'pending_appointments', (select count(*) from public.confession_appointments a where a.priest_id = pr.id and a.status = 'pending'),
      'today_appointments', (select count(*) from public.confession_appointments a where a.priest_id = pr.id and a.status = 'approved'
                               and coalesce(a.scheduled_on, a.requested_on) = public.cairo_today_date())
    ),
    'server_today', public.cairo_today_date()
  );
end $$;
grant execute on function public.priest_portal_profile(text) to anon, authenticated;

create or replace function public.priest_set_reminder_days(p_token text, p_days integer)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests;
begin
  pr := public.priest_portal_self(p_token);
  if p_days is null or p_days < 1 or p_days > 365 then raise exception 'invalid_days' using errcode = '22023'; end if;
  update public.priests set reminder_days = p_days where id = pr.id;
end $$;
grant execute on function public.priest_set_reminder_days(text, integer) to anon, authenticated;

-- the priest edits his own person data (name · phone · address · photo …)
create or replace function public.priest_update_self(p_token text, p_changes jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests; p public.persons;
begin
  pr := public.priest_portal_self(p_token);
  update public.persons set
    name      = coalesce(nullif(trim(p_changes->>'name'), ''), name),
    phone     = case when p_changes ? 'phone' then nullif(trim(p_changes->>'phone'), '') else phone end,
    address   = case when p_changes ? 'address' then nullif(trim(p_changes->>'address'), '') else address end,
    birthdate = case when p_changes ? 'birthdate' then nullif(p_changes->>'birthdate', '')::date else birthdate end,
    image_url = case when p_changes ? 'image_url' then nullif(p_changes->>'image_url', '') else image_url end,
    edited_at = now()
  where id = pr.person_id returning * into p;
  if p_changes ? 'title' then update public.priests set title = nullif(trim(p_changes->>'title'), '') where id = pr.id; end if;
  return public.priest_person_json(p);
end $$;
grant execute on function public.priest_update_self(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. JSON BUILDERS
-- ---------------------------------------------------------------------
create or replace function public.priest_appointment_json(a public.confession_appointments)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', a.id, 'person_id', a.person_id, 'requested_by', a.requested_by,
    'requested_on', a.requested_on, 'requested_time', a.requested_time, 'note', a.note,
    'status', a.status, 'scheduled_on', a.scheduled_on, 'scheduled_time', a.scheduled_time,
    'on', coalesce(a.scheduled_on, a.requested_on), 'time', coalesce(a.scheduled_time, a.requested_time),
    'decision_note', a.decision_note, 'decided_at', a.decided_at, 'created_at', a.created_at,
    'person', (select public.priest_person_json(p) from public.persons p where p.id = a.person_id),
    'is_confessor', exists (select 1 from public.priest_confessors c where c.priest_id = a.priest_id and c.person_id = a.person_id),
    'last_confession', (select max(x.confessed_on) from public.confessions x where x.priest_id = a.priest_id and x.person_id = a.person_id)
  )
$$;

create or replace function public.priest_confessor_json(pr public.priests, c public.priest_confessors)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id, 'person_id', c.person_id, 'notes', c.notes, 'created_at', c.created_at,
    'person', public.priest_person_json(p),
    'places', public.priest_person_places(p.id),
    'last_confession', (select max(x.confessed_on) from public.confessions x where x.priest_id = pr.id and x.person_id = c.person_id),
    'confessions_count', (select count(*) from public.confessions x where x.priest_id = pr.id and x.person_id = c.person_id),
    'days_since', public.cairo_today_date() - coalesce(
        (select max(x.confessed_on) from public.confessions x where x.priest_id = pr.id and x.person_id = c.person_id), c.created_at::date),
    'overdue', coalesce((select max(x.confessed_on) from public.confessions x where x.priest_id = pr.id and x.person_id = c.person_id), c.created_at::date)
               < public.cairo_today_date() - pr.reminder_days,
    'last_contact', (select jsonb_build_object('kind', k.kind, 'created_at', k.created_at)
                       from public.priest_contacts k where k.priest_id = pr.id and k.person_id = c.person_id
                      order by k.created_at desc limit 1),
    'next_appointment', (select jsonb_build_object('id', a.id, 'status', a.status,
                                 'on', coalesce(a.scheduled_on, a.requested_on), 'time', coalesce(a.scheduled_time, a.requested_time),
                                 'requested_by', a.requested_by)
                           from public.confession_appointments a
                          where a.priest_id = pr.id and a.person_id = c.person_id and a.status in ('pending', 'approved')
                            and coalesce(a.scheduled_on, a.requested_on) >= public.cairo_today_date()
                          order by coalesce(a.scheduled_on, a.requested_on), coalesce(a.scheduled_time, a.requested_time) nulls last limit 1)
  ) from public.persons p where p.id = c.person_id
$$;

-- ---------------------------------------------------------------------
-- 3. المعترفين — list · lookup · search · add (code / id / new) · edit · remove
-- ---------------------------------------------------------------------
create or replace function public.priest_confessors_list(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare pr public.priests;
begin
  pr := public.priest_portal_self(p_token);
  return coalesce((select jsonb_agg(public.priest_confessor_json(pr, c) order by c.created_at desc)
                     from public.priest_confessors c where c.priest_id = pr.id), '[]'::jsonb);
end $$;
grant execute on function public.priest_confessors_list(text) to anon, authenticated;

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
                            'is_confessor', v_is, 'confessor', case when v_is then public.priest_confessor_json(pr, c) else null end);
end $$;
grant execute on function public.priest_lookup_code(text, text) to anon, authenticated;

-- persons of HIS church (enrolled there) · his confessors · persons with no
-- enrollment at all (adults created by a priest / a family)
create or replace function public.priest_search_persons(p_token text, p_query text, p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  pr public.priests;
  v_q text := nullif(trim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  pr := public.priest_portal_self(p_token);
  if v_q is null or length(v_q) < 2 then return '[]'::jsonb; end if;
  return coalesce((
    with hits as (
      select p.* from public.persons p
       where (p.name ilike '%' || v_q || '%' or p.phone ilike '%' || v_q || '%' or p.national_id ilike '%' || v_q || '%')
         and (exists (select 1 from public.enrollments e where e.person_id = p.id and e.church_id = pr.church_id)
              or exists (select 1 from public.priest_confessors c where c.person_id = p.id and c.priest_id = pr.id)
              or not exists (select 1 from public.enrollments e where e.person_id = p.id))
       order by (p.national_id = v_q) desc, p.name collate "C"
       limit v_limit)
    select jsonb_agg(jsonb_build_object(
             'person', public.priest_person_json(h), 'places', public.priest_person_places(h.id),
             'is_confessor', exists (select 1 from public.priest_confessors c where c.priest_id = pr.id and c.person_id = h.id),
             'other_priest', (select pp.name from public.priest_confessors c join public.priests x on x.id = c.priest_id
                                join public.persons pp on pp.id = x.person_id where c.person_id = h.id and c.priest_id <> pr.id limit 1)
           ) order by (h.national_id = v_q) desc, h.name collate "C")
      from hits h), '[]'::jsonb);
end $$;
grant execute on function public.priest_search_persons(text, text, integer) to anon, authenticated;

create or replace function public.priest_add_confessor(p_token text, p_person uuid, p_notes text default null, p_last_confession date default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests; c public.priest_confessors;
begin
  pr := public.priest_portal_self(p_token);
  if not exists (select 1 from public.persons where id = p_person) then raise exception 'person_not_found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.priest_confessors where priest_id = pr.id and person_id = p_person) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;
  insert into public.priest_confessors (priest_id, person_id, notes) values (pr.id, p_person, nullif(trim(coalesce(p_notes, '')), ''))
  returning * into c;
  if p_last_confession is not null then
    if p_last_confession > public.cairo_today_date() then raise exception 'future_date' using errcode = '22023'; end if;
    insert into public.confessions (priest_id, person_id, confessed_on, notes) values (pr.id, p_person, p_last_confession, 'آخر اعتراف عند الإضافة');
  end if;
  return public.priest_confessor_json(pr, c);
end $$;
grant execute on function public.priest_add_confessor(text, uuid, text, date) to anon, authenticated;

create or replace function public.priest_add_confessor_by_code(p_token text, p_code text, p_notes text default null, p_last_confession date default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_person uuid;
begin
  perform public.priest_portal_self(p_token);
  select id into v_person from public.persons where national_id = trim(coalesce(p_code, ''));
  if v_person is null then raise exception 'person_not_found' using errcode = 'P0002'; end if;
  return public.priest_add_confessor(p_token, v_person, p_notes, p_last_confession);
end $$;
grant execute on function public.priest_add_confessor_by_code(text, text, text, date) to anon, authenticated;

-- create the person here (no enrollment — he may be an adult) and add him;
-- a code that already belongs to a person → his blanks are filled and he is added
create or replace function public.priest_add_new_confessor(
  p_token text, p_name text, p_code text default null, p_gender text default null, p_birthdate date default null,
  p_phone text default null, p_address text default null, p_notes text default null, p_image_url text default null,
  p_last_confession date default null
) returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  pr public.priests;
  v_code text := nullif(trim(coalesce(p_code, '')), '');
  v_person public.persons%rowtype;
begin
  pr := public.priest_portal_self(p_token);
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required' using errcode = '22023'; end if;
  if p_gender is not null and p_gender not in ('male', 'female') then raise exception 'invalid_gender' using errcode = '22023'; end if;
  if v_code is not null then
    select * into v_person from public.persons where national_id = v_code;
    if found then
      update public.persons set
        gender = coalesce(gender, p_gender), birthdate = coalesce(birthdate, p_birthdate),
        phone = coalesce(phone, nullif(trim(coalesce(p_phone, '')), '')), address = coalesce(address, nullif(trim(coalesce(p_address, '')), '')),
        image_url = coalesce(image_url, p_image_url), edited_at = now()
      where id = v_person.id returning * into v_person;
      return public.priest_add_confessor(p_token, v_person.id, p_notes, p_last_confession) || jsonb_build_object('created', false);
    end if;
    if exists (select 1 from public.families f where f.code = v_code) then raise exception 'code_taken' using errcode = '23505'; end if;
  end if;
  if v_code is null then
    insert into public.persons (name, gender, birthdate, phone, address, notes, image_url)
    values (trim(p_name), p_gender, p_birthdate, nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_address, '')), ''),
            nullif(trim(coalesce(p_notes, '')), ''), p_image_url) returning * into v_person;
  else
    insert into public.persons (national_id, name, gender, birthdate, phone, address, notes, image_url)
    values (v_code, trim(p_name), p_gender, p_birthdate, nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_address, '')), ''),
            nullif(trim(coalesce(p_notes, '')), ''), p_image_url) returning * into v_person;
  end if;
  return public.priest_add_confessor(p_token, v_person.id, null, p_last_confession) || jsonb_build_object('created', true);
end $$;
grant execute on function public.priest_add_new_confessor(text, text, text, text, date, text, text, text, text, date) to anon, authenticated;

create or replace function public.priest_update_confessor(p_token text, p_confessor uuid, p_notes text)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests;
begin
  pr := public.priest_portal_self(p_token);
  update public.priest_confessors set notes = nullif(trim(coalesce(p_notes, '')), '') where id = p_confessor and priest_id = pr.id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;
grant execute on function public.priest_update_confessor(text, uuid, text) to anon, authenticated;

create or replace function public.priest_remove_confessor(p_token text, p_confessor uuid)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests;
begin
  pr := public.priest_portal_self(p_token);
  delete from public.priest_confessors where id = p_confessor and priest_id = pr.id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;
grant execute on function public.priest_remove_confessor(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. CONFESSIONS + CONTACTS (الافتقاد) + HISTORY
-- ---------------------------------------------------------------------
create or replace function public.priest_record_confession(p_token text, p_person uuid, p_on date default null, p_notes text default null, p_appointment uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests; v public.confessions; c public.priest_confessors;
begin
  pr := public.priest_portal_self(p_token);
  select * into c from public.priest_confessors where priest_id = pr.id and person_id = p_person;
  if not found then
    insert into public.priest_confessors (priest_id, person_id) values (pr.id, p_person) returning * into c;
  end if;
  if p_on is not null and p_on > public.cairo_today_date() then raise exception 'future_date' using errcode = '22023'; end if;
  insert into public.confessions (priest_id, person_id, confessed_on, notes, appointment_id)
  values (pr.id, p_person, coalesce(p_on, public.cairo_today_date()), nullif(trim(coalesce(p_notes, '')), ''), p_appointment)
  returning * into v;
  if p_appointment is not null then
    update public.confession_appointments set status = 'done', decided_at = now() where id = p_appointment and priest_id = pr.id;
  end if;
  return jsonb_build_object('id', v.id, 'confessed_on', v.confessed_on, 'confessor', public.priest_confessor_json(pr, c));
end $$;
grant execute on function public.priest_record_confession(text, uuid, date, text, uuid) to anon, authenticated;

create or replace function public.priest_delete_confession(p_token text, p_confession uuid)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests;
begin
  pr := public.priest_portal_self(p_token);
  delete from public.confessions where id = p_confession and priest_id = pr.id;
end $$;
grant execute on function public.priest_delete_confession(text, uuid) to anon, authenticated;

create or replace function public.priest_log_contact(p_token text, p_person uuid, p_kind text, p_message text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests; k public.priest_contacts;
begin
  pr := public.priest_portal_self(p_token);
  if p_kind not in ('call', 'whatsapp', 'sms', 'note') then raise exception 'invalid_kind' using errcode = '22023'; end if;
  if not exists (select 1 from public.priest_confessors where priest_id = pr.id and person_id = p_person) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into public.priest_contacts (priest_id, person_id, kind, message)
  values (pr.id, p_person, p_kind, nullif(trim(coalesce(p_message, '')), '')) returning * into k;
  return jsonb_build_object('id', k.id, 'kind', k.kind, 'message', k.message, 'created_at', k.created_at);
end $$;
grant execute on function public.priest_log_contact(text, uuid, text, text) to anon, authenticated;

create or replace function public.priest_delete_contact(p_token text, p_contact uuid)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests;
begin
  pr := public.priest_portal_self(p_token);
  delete from public.priest_contacts where id = p_contact and priest_id = pr.id;
end $$;
grant execute on function public.priest_delete_contact(text, uuid) to anon, authenticated;

create or replace function public.priest_confessor_history(p_token text, p_person uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare pr public.priests;
begin
  pr := public.priest_portal_self(p_token);
  return jsonb_build_object(
    'confessions', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'confessed_on', x.confessed_on, 'notes', x.notes, 'created_at', x.created_at)
                                order by x.confessed_on desc, x.created_at desc)
                              from public.confessions x where x.priest_id = pr.id and x.person_id = p_person), '[]'::jsonb),
    'contacts', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'kind', k.kind, 'message', k.message, 'created_at', k.created_at)
                              order by k.created_at desc)
                            from public.priest_contacts k where k.priest_id = pr.id and k.person_id = p_person), '[]'::jsonb),
    'appointments', coalesce((select jsonb_agg(public.priest_appointment_json(a) order by coalesce(a.scheduled_on, a.requested_on) desc)
                                from public.confession_appointments a where a.priest_id = pr.id and a.person_id = p_person), '[]'::jsonb)
  );
end $$;
grant execute on function public.priest_confessor_history(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. APPOINTMENTS — priest side
-- ---------------------------------------------------------------------
create or replace function public.priest_appointments_list(p_token text, p_from date default null, p_to date default null, p_include_past boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare pr public.priests;
begin
  pr := public.priest_portal_self(p_token);
  return coalesce((
    select jsonb_agg(public.priest_appointment_json(a) order by coalesce(a.scheduled_on, a.requested_on), coalesce(a.scheduled_time, a.requested_time) nulls last, a.created_at)
      from public.confession_appointments a
     where a.priest_id = pr.id
       and (p_from is null or coalesce(a.scheduled_on, a.requested_on) >= p_from)
       and (p_to is null or coalesce(a.scheduled_on, a.requested_on) <= p_to)
       and (p_include_past or a.status = 'pending' or coalesce(a.scheduled_on, a.requested_on) >= public.cairo_today_date() - 1)
  ), '[]'::jsonb);
end $$;
grant execute on function public.priest_appointments_list(text, date, date, boolean) to anon, authenticated;

create or replace function public.priest_create_appointment(p_token text, p_person uuid, p_on date, p_time time default null, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests; a public.confession_appointments;
begin
  pr := public.priest_portal_self(p_token);
  if p_on is null then raise exception 'date_required' using errcode = '22023'; end if;
  if not exists (select 1 from public.persons where id = p_person) then raise exception 'person_not_found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.priest_confessors where priest_id = pr.id and person_id = p_person) then
    insert into public.priest_confessors (priest_id, person_id) values (pr.id, p_person);
  end if;
  insert into public.confession_appointments (priest_id, person_id, requested_by, requested_on, requested_time, note, status, scheduled_on, scheduled_time, decided_at)
  values (pr.id, p_person, 'priest', p_on, p_time, nullif(trim(coalesce(p_note, '')), ''), 'approved', p_on, p_time, now())
  returning * into a;
  return public.priest_appointment_json(a);
end $$;
grant execute on function public.priest_create_appointment(text, uuid, date, time, text) to anon, authenticated;

-- approve (optionally moving it) · reject · cancel · done (→ confession row)
create or replace function public.priest_decide_appointment(p_token text, p_appointment uuid, p_action text, p_on date default null, p_time time default null, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare pr public.priests; a public.confession_appointments;
begin
  pr := public.priest_portal_self(p_token);
  select * into a from public.confession_appointments where id = p_appointment and priest_id = pr.id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_action = 'approve' then
    if a.status not in ('pending', 'approved') then raise exception 'not_pending' using errcode = 'P0001'; end if;
    update public.confession_appointments
       set status = 'approved', scheduled_on = coalesce(p_on, a.scheduled_on, a.requested_on),
           scheduled_time = case when p_on is not null or p_time is not null then p_time else coalesce(a.scheduled_time, a.requested_time) end,
           decision_note = nullif(trim(coalesce(p_note, '')), ''), decided_at = now()
     where id = a.id returning * into a;
    if not exists (select 1 from public.priest_confessors where priest_id = pr.id and person_id = a.person_id) then
      insert into public.priest_confessors (priest_id, person_id) values (pr.id, a.person_id);
    end if;
  elsif p_action = 'reject' then
    if a.status <> 'pending' then raise exception 'not_pending' using errcode = 'P0001'; end if;
    update public.confession_appointments set status = 'rejected', decision_note = nullif(trim(coalesce(p_note, '')), ''), decided_at = now()
     where id = a.id returning * into a;
  elsif p_action = 'cancel' then
    if a.status not in ('pending', 'approved') then raise exception 'not_pending' using errcode = 'P0001'; end if;
    update public.confession_appointments set status = 'cancelled', decision_note = nullif(trim(coalesce(p_note, '')), ''), decided_at = now()
     where id = a.id returning * into a;
  elsif p_action = 'done' then
    if a.status <> 'approved' then raise exception 'not_pending' using errcode = 'P0001'; end if;
    perform public.priest_record_confession(p_token, a.person_id, least(coalesce(a.scheduled_on, a.requested_on), public.cairo_today_date()), p_note, a.id);
    select * into a from public.confession_appointments where id = p_appointment;
  else
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  return public.priest_appointment_json(a);
end $$;
grant execute on function public.priest_decide_appointment(text, uuid, text, date, time, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. CHILD PORTAL — الاعتراف: my priest(s) · ask for a date · my appointments
-- ---------------------------------------------------------------------
create or replace function public.child_portal_confession(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare p public.persons;
begin
  p := public.child_portal_person(p_token);
  return jsonb_build_object(
    'priests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pr.id, 'name', pp.name, 'title', pr.title, 'image_url', pp.image_url, 'church_id', pr.church_id, 'church_name', ch.name,
               'is_mine', exists (select 1 from public.priest_confessors c where c.priest_id = pr.id and c.person_id = p.id),
               'last_confession', (select max(x.confessed_on) from public.confessions x where x.priest_id = pr.id and x.person_id = p.id)
             ) order by exists (select 1 from public.priest_confessors c where c.priest_id = pr.id and c.person_id = p.id) desc, pp.name collate "C")
        from public.priests pr
        join public.persons pp on pp.id = pr.person_id
        join public.churches ch on ch.id = pr.church_id
       where pr.status = 'approved'
         and (exists (select 1 from public.priest_confessors c where c.priest_id = pr.id and c.person_id = p.id)
              or exists (select 1 from public.enrollments e where e.person_id = p.id and e.church_id = pr.church_id))
    ), '[]'::jsonb),
    'appointments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'priest_id', a.priest_id, 'priest_name', pp.name, 'priest_title', pr.title,
               'requested_on', a.requested_on, 'requested_time', a.requested_time, 'note', a.note,
               'status', a.status, 'on', coalesce(a.scheduled_on, a.requested_on), 'time', coalesce(a.scheduled_time, a.requested_time),
               'decision_note', a.decision_note, 'decided_at', a.decided_at, 'created_at', a.created_at)
             order by coalesce(a.scheduled_on, a.requested_on) desc, a.created_at desc)
        from public.confession_appointments a
        join public.priests pr on pr.id = a.priest_id
        join public.persons pp on pp.id = pr.person_id
       where a.person_id = p.id
    ), '[]'::jsonb),
    'server_today', public.cairo_today_date()
  );
end $$;
grant execute on function public.child_portal_confession(text) to anon, authenticated;

create or replace function public.child_request_confession(p_token text, p_priest uuid, p_on date, p_time time default null, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare p public.persons; pr public.priests; a public.confession_appointments;
begin
  p := public.child_portal_person(p_token);
  select * into pr from public.priests where id = p_priest and status = 'approved';
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not (exists (select 1 from public.priest_confessors c where c.priest_id = pr.id and c.person_id = p.id)
          or exists (select 1 from public.enrollments e where e.person_id = p.id and e.church_id = pr.church_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_on is null or p_on < public.cairo_today_date() then raise exception 'past_date' using errcode = '22023'; end if;
  if exists (select 1 from public.confession_appointments x where x.person_id = p.id and x.priest_id = pr.id and x.status = 'pending') then
    raise exception 'pending_exists' using errcode = '23505';
  end if;
  insert into public.confession_appointments (priest_id, person_id, requested_by, requested_on, requested_time, note, status)
  values (pr.id, p.id, 'child', p_on, p_time, nullif(trim(coalesce(p_note, '')), ''), 'pending') returning * into a;
  return jsonb_build_object('id', a.id, 'status', a.status, 'on', a.requested_on, 'time', a.requested_time);
end $$;
grant execute on function public.child_request_confession(text, uuid, date, time, text) to anon, authenticated;

create or replace function public.child_cancel_confession_request(p_token text, p_appointment uuid)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare p public.persons;
begin
  p := public.child_portal_person(p_token);
  update public.confession_appointments set status = 'cancelled', decided_at = now()
   where id = p_appointment and person_id = p.id and status in ('pending', 'approved');
  if not found then raise exception 'not_pending' using errcode = 'P0001'; end if;
end $$;
grant execute on function public.child_cancel_confession_request(text, uuid) to anon, authenticated;

commit;
