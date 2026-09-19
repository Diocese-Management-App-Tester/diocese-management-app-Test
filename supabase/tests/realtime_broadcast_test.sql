-- Test for 0046: statement-level broadcast triggers + topic auth + gate.
-- Run on a local DB built by tests/run_migrations.sh:
--   psql -h /tmp -p 5433 -U postgres -d app -v ON_ERROR_STOP=1 -f supabase/tests/realtime_broadcast_test.sql
begin;

-- Mock realtime.send → collect messages in a temp table
create schema if not exists realtime;
create table if not exists realtime.messages (
  topic text, extension text, payload jsonb, private boolean, inserted_at timestamptz default now()
);
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean)
returns void language sql as $$
  insert into realtime.messages(topic, extension, payload, private) values (topic, event, payload, private)
$$;
create or replace function realtime.topic() returns text language sql stable as
$$ select current_setting('rt.test_topic', true) $$;

-- Fixture: one church / service / class / owner
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000aaaa', 'owner@t'),
  ('00000000-0000-0000-0000-00000000bbbb', 'servant@t');
insert into public.churches (id, name) values ('10000000-0000-0000-0000-000000000001', 'C1');
insert into public.services (id, church_id, name) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'S1');
insert into public.classes  (id, church_id, service_id, name) values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'K1');
insert into public.servant_enrollments (id, role, status, full_name, user_id, phone, church_id, service_id, class_id, approved_at)
values ('00000000-0000-0000-0000-00000000aaaa', 'owner', 'approved', 'Owner', 'owner-t', '0100', null, null, null, now()),
       ('00000000-0000-0000-0000-00000000bbbb', 'class_servant', 'approved', 'Servant', 'srv-t', '0101', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', now());
delete from realtime.messages;

-- Owner adds two persons + enrolls them in ONE statement each
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000aaaa';
set local request.jwt.claim.role = 'authenticated';
insert into public.persons (id, national_id, name) values
  ('40000000-0000-0000-0000-000000000001', 'N1', 'A'),
  ('40000000-0000-0000-0000-000000000002', 'N2', 'B');
insert into public.enrollments (id, person_id, church_id, service_id, class_id) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001');

do $$
declare n int;
begin
  -- persons insert: no enrollment yet → only scope:all (1 msg)
  select count(*) into n from realtime.messages where payload->>'t' = 'persons';
  if n <> 1 then raise exception 'persons: expected 1 message, got %', n; end if;
  -- enrollments insert (2 rows, ONE statement) → scope:all + scope:church:C1 = 2 msgs
  select count(*) into n from realtime.messages where payload->>'t' = 'enrollments' and payload->>'op' = 'INSERT';
  if n <> 2 then raise exception 'enrollments insert: expected 2 messages, got %', n; end if;
  if not exists (select 1 from realtime.messages where topic = 'scope:church:10000000-0000-0000-0000-000000000001'
                   and payload->>'t' = 'enrollments' and (payload->>'n')::int = 2) then
    raise exception 'enrollments: church topic with n=2 missing';
  end if;
end $$;

-- Attendance: one insert → attendance_log msgs + the counter-trigger's
-- enrollments UPDATE msgs. Must be per statement, not per row.
delete from realtime.messages;
insert into public.events (id, church_id, name, event_date, points) values ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'E', current_date, 5);
insert into public.attendance_log (enrollment_id, event_id, points_delta, attended_on, recorded_by)
values ('50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 5, current_date, '00000000-0000-0000-0000-00000000aaaa'),
       ('50000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', 5, current_date, '00000000-0000-0000-0000-00000000aaaa');
do $$
declare n int; total int;
begin
  select count(*) into n from realtime.messages where payload->>'t' = 'attendance_log';
  if n <> 2 then raise exception 'attendance_log: expected 2 messages (all + church), got %', n; end if;
  select count(*) into total from realtime.messages;
  -- attendance_log(2) + enrollments update(2 per statement; the counter
  -- trigger is row-level so up to 2 statements) ≤ 6, never dozens
  if total > 8 then raise exception 'too many broadcast messages for one scan burst: %', total; end if;
  if exists (select 1 from realtime.messages where private is not true) then raise exception 'messages must be private'; end if;
end $$;

-- Topic authorization
do $$
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000bbbb', true);
  if not public.rt_topic_allowed('user:00000000-0000-0000-0000-00000000bbbb') then raise exception 'own user topic must be allowed'; end if;
  if public.rt_topic_allowed('user:00000000-0000-0000-0000-00000000aaaa') then raise exception 'other user topic must be denied'; end if;
  if public.rt_topic_allowed('scope:all') then raise exception 'scope:all must be owner-only'; end if;
  if not public.rt_topic_allowed('scope:church:10000000-0000-0000-0000-000000000001') then raise exception 'own church topic must be allowed'; end if;
  if public.rt_topic_allowed('scope:church:10000000-0000-0000-0000-000000000099') then raise exception 'foreign church topic must be denied'; end if;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000aaaa', true);
  if not public.rt_topic_allowed('scope:all') then raise exception 'owner must read scope:all'; end if;
end $$;

-- Publication: hot tables are gone
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
              and tablename in ('attendance_log', 'points_log', 'enrollments', 'persons', 'notification_recipients')) then
    raise exception 'hot tables still in the publication';
  end if;
end $$;

-- Dispatcher gate: first call passes, the second within the window doesn't
do $$
begin
  if not public.notif_dispatch_gate(45) then raise exception 'gate: first call must pass'; end if;
  if public.notif_dispatch_gate(45) then raise exception 'gate: second call must be blocked'; end if;
  if not public.notif_dispatch_gate(0) then raise exception 'gate: zero window must pass'; end if;
end $$;

-- Indexes
do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'idx_persons_name_trgm') then raise exception 'trgm index missing'; end if;
  if not exists (select 1 from pg_indexes where indexname = 'idx_enrollments_kind_class') then raise exception 'kind/class index missing'; end if;
end $$;

select 'realtime_broadcast_test: OK' as result;
rollback;
