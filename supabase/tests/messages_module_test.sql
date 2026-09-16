-- =====================================================================
-- Functional test for migration 0029 (وحدة الرسائل). Run on the local
-- shim DB after run_migrations.sh:  psql -d app -f supabase/tests/messages_module_test.sql
-- Every assert raises on failure; a clean run ends with «MESSAGES TESTS PASSED».
-- =====================================================================
\set ON_ERROR_STOP on
begin;

-- ---------- seed ----------
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'),  -- owner
  ('00000000-0000-0000-0000-000000000002'),  -- class servant A
  ('00000000-0000-0000-0000-000000000003'),  -- class servant B
  ('00000000-0000-0000-0000-000000000004'),  -- service manager (service 1)
  ('00000000-0000-0000-0000-000000000005'),  -- church manager (church 1)
  ('00000000-0000-0000-0000-000000000006');  -- class servant in church 2
insert into public.churches (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'كنيسة ١'),
  ('10000000-0000-0000-0000-000000000002', 'كنيسة ٢');
insert into public.services (id, church_id, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'مدارس الأحد'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'خدمة ٢');
insert into public.classes (id, church_id, service_id, name) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل أ'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'فصل ب'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'فصل ج');
insert into public.profiles (id, full_name, user_id, phone, role, status, church_id, service_id, class_id) values
  ('00000000-0000-0000-0000-000000000001', 'المالك', 'owner', '0100', 'owner', 'approved', null, null, null),
  ('00000000-0000-0000-0000-000000000002', 'خادم أ', 'servant_a', '0101', 'class_servant', 'approved',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000003', 'خادم ب', 'servant_b', '0102', 'class_servant', 'approved',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000004', 'مسؤول الخدمة', 'svc_mgr', '0103', 'service_manager', 'approved',
     '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null),
  ('00000000-0000-0000-0000-000000000005', 'مدير الكنيسة', 'ch_mgr', '0104', 'church_manager', 'approved',
     '10000000-0000-0000-0000-000000000001', null, null),
  ('00000000-0000-0000-0000-000000000006', 'خادم ج', 'servant_c', '0105', 'class_servant', 'approved',
     '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003');
insert into public.persons (id, national_id, name) values
  ('40000000-0000-0000-0000-000000000001', '29901010000001', 'مينا'),
  ('40000000-0000-0000-0000-000000000002', '29901010000002', 'مريم'),
  ('40000000-0000-0000-0000-000000000003', '29901010000003', 'يوسف');
-- 0042: the portal now needs a session token; for the legacy tests the raw code doubles as the token
insert into public.child_sessions (person_id, token_hash, expires_at)
select id, encode(digest(national_id, 'sha256'), 'hex'), now() + interval '1 day' from public.persons;

insert into public.enrollments (id, person_id, church_id, service_id, class_id) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002'),
  ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003');

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('role', 'anon', true);
end $$;
create or replace function pg_temp.expect_error(q text, code text) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    if sqlerrm not like '%' || code || '%' then raise exception 'expected % got %', code, sqlerrm; end if;
    return;
  end;
  raise exception 'expected error % but succeeded: %', code, q;
end $$;

-- ---------- 1. module NOT granted ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
select pg_temp.expect_error($$select public.chat_send('{"target":"children","enrollment_ids":["50000000-0000-0000-0000-000000000001"],"body":"hi"}')$$, 'module_not_visible');
do $$ begin
  if (public.chat_inbox()->>'total_unread')::int <> 0 then raise exception 'inbox should be empty without module'; end if;
end $$;
select pg_temp.as_anon();
select pg_temp.expect_error($$select public.child_chat_send('29901010000001', '50000000-0000-0000-0000-000000000001', 'hi')$$, 'module_not_visible');
do $$ begin
  if jsonb_array_length(public.child_chat_overview('29901010000001')) <> 0 then raise exception 'child overview should be empty without grant'; end if;
end $$;
reset role;

-- ---------- 2. owner grants the module globally ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
insert into public.module_access (module_key, church_id) values ('messages', null);
reset role;

-- ---------- 3. child writes → servants of his tenant see it ----------
select pg_temp.as_anon();
select pg_temp.expect_error($$select public.child_chat_send('29901010000001', '50000000-0000-0000-0000-000000000001', '   ')$$, 'empty_message');
-- a child cannot write in ANOTHER child's enrollment
select pg_temp.expect_error($$select public.child_chat_send('29901010000001', '50000000-0000-0000-0000-000000000002', 'x')$$, 'enrollment_not_found');
select public.child_chat_send('29901010000001', '50000000-0000-0000-0000-000000000001', 'سلام يا أبونا');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-000000000002');   -- servant A (class A) → sees
do $$ declare ib jsonb; begin
  ib := public.chat_inbox();
  if jsonb_array_length(ib->'conversations') <> 1 then raise exception 'servant A should see 1 conversation, got %', ib; end if;
  if (ib->'conversations'->0->>'unread')::int <> 1 then raise exception 'unread should be 1'; end if;
  if (ib->'conversations'->0->>'person_name') <> 'مينا' then raise exception 'wrong person'; end if;
  if (select count(*) from public.chat_messages) <> 1 then raise exception 'RLS: servant A should read 1 row'; end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');   -- servant B (class B) → does NOT see
do $$ begin
  if jsonb_array_length(public.chat_inbox()->'conversations') <> 0 then raise exception 'servant B must not see class A conversation'; end if;
  if (select count(*) from public.chat_messages) <> 0 then raise exception 'RLS leak to servant B'; end if;
end $$;
select pg_temp.expect_error($$select public.chat_thread('e:50000000-0000-0000-0000-000000000001')$$, 'enrollment_not_visible');
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');   -- service manager → sees
do $$ begin
  if jsonb_array_length(public.chat_inbox()->'conversations') <> 1 then raise exception 'service manager should see the conversation'; end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-000000000006');   -- church 2 servant → no
do $$ begin
  if (select count(*) from public.chat_messages) <> 0 then raise exception 'RLS leak across churches'; end if;
end $$;
reset role;

-- ---------- 4. servant replies to the child; read state ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
select public.chat_send('{"target":"children","enrollment_ids":["50000000-0000-0000-0000-000000000001"],"body":"أهلاً مينا"}');
do $$ declare ib jsonb; th jsonb; begin
  ib := public.chat_inbox();
  if (ib->'conversations'->0->>'unread')::int <> 0 then raise exception 'sending should mark my bucket read, got %', ib; end if;
  th := public.chat_thread('e:50000000-0000-0000-0000-000000000001');
  if jsonb_array_length(th->'messages') <> 2 then raise exception 'thread should have 2 messages'; end if;
  if (th->'messages'->0->>'sender_kind') <> 'child' or (th->'messages'->1->>'is_me')::boolean is not true then raise exception 'thread order / flags wrong: %', th; end if;
end $$;
-- servant A cannot write to a child of class B
select pg_temp.expect_error($$select public.chat_send('{"target":"children","enrollment_ids":["50000000-0000-0000-0000-000000000002"],"body":"x"}')$$, 'enrollment_not_visible');
reset role;

select pg_temp.as_anon();
do $$ declare ov jsonb; ms jsonb; begin
  ov := public.child_chat_overview('29901010000001');
  if jsonb_array_length(ov) <> 1 then raise exception 'child should have 1 conversation'; end if;
  if (ov->0->>'unread')::int <> 1 then raise exception 'child unread should be 1, got %', ov; end if;
  if public.child_chat_unread('29901010000001') <> 1 then raise exception 'child_chat_unread wrong'; end if;
  ms := public.child_chat_messages('29901010000001', '50000000-0000-0000-0000-000000000001');
  if jsonb_array_length(ms->'messages') <> 2 then raise exception 'child sees 2 messages'; end if;
  if (ms->'messages'->1->>'sender_name') <> 'خادم أ' then raise exception 'servant name expected'; end if;
  perform public.child_chat_mark_read('29901010000001', '50000000-0000-0000-0000-000000000001');
  if public.child_chat_unread('29901010000001') <> 0 then raise exception 'mark read failed'; end if;
end $$;
reset role;

-- ---------- 5. broadcasts to children by scope ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');   -- class servant: own class OK, service NOT, all NOT
select public.chat_send('{"target":"children","church_id":"10000000-0000-0000-0000-000000000001","service_id":"20000000-0000-0000-0000-000000000001","class_id":"30000000-0000-0000-0000-000000000001","body":"إعلان الفصل"}');
select pg_temp.expect_error($$select public.chat_send('{"target":"children","church_id":"10000000-0000-0000-0000-000000000001","service_id":"20000000-0000-0000-0000-000000000001","body":"x"}')$$, 'scope_not_allowed');
select pg_temp.expect_error($$select public.chat_send('{"target":"children","body":"x"}')$$, 'scope_not_allowed');
do $$ begin
  if public.chat_audience_count('children', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001') <> 1 then raise exception 'audience count class A'; end if;
  if public.chat_audience_count('children', '10000000-0000-0000-0000-000000000001', null, null) <> 0 then raise exception 'audience count must be 0 outside my scope'; end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');   -- service manager: service OK, church NOT
select public.chat_send('{"target":"children","church_id":"10000000-0000-0000-0000-000000000001","service_id":"20000000-0000-0000-0000-000000000001","body":"إعلان الخدمة"}');
select pg_temp.expect_error($$select public.chat_send('{"target":"children","church_id":"10000000-0000-0000-0000-000000000001","body":"x"}')$$, 'scope_not_allowed');
select pg_temp.as_user('00000000-0000-0000-0000-000000000005');   -- church manager: church OK, all NOT
select public.chat_send('{"target":"children","church_id":"10000000-0000-0000-0000-000000000001","body":"إعلان الكنيسة"}');
select pg_temp.expect_error($$select public.chat_send('{"target":"children","body":"x"}')$$, 'scope_not_allowed');
-- chain check: class of another service
select pg_temp.expect_error($$select public.chat_send('{"target":"children","church_id":"10000000-0000-0000-0000-000000000001","service_id":"20000000-0000-0000-0000-000000000001","class_id":"30000000-0000-0000-0000-000000000003","body":"x"}')$$, 'scope_chain');
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');   -- owner: all churches
select public.chat_send('{"target":"children","body":"إعلان الإيبارشية"}');
reset role;

-- the child of class A receives: class + service + church + all = 4 broadcasts (+2 direct)
select pg_temp.as_anon();
do $$ declare ms jsonb; n int; begin
  ms := public.child_chat_messages('29901010000001', '50000000-0000-0000-0000-000000000001');
  select count(*) into n from jsonb_array_elements(ms->'messages') x where (x->>'is_broadcast')::boolean;
  if n <> 4 then raise exception 'child A should receive 4 broadcasts, got %', n; end if;
  if public.child_chat_unread('29901010000001') <> 4 then raise exception 'child A unread should be 4'; end if;
  -- child of class B: service + church + all = 3
  ms := public.child_chat_messages('29901010000002', '50000000-0000-0000-0000-000000000002');
  select count(*) into n from jsonb_array_elements(ms->'messages') x where (x->>'is_broadcast')::boolean;
  if n <> 3 then raise exception 'child B should receive 3 broadcasts, got %', n; end if;
  -- child of church 2: only «all» = 1
  ms := public.child_chat_messages('29901010000003', '50000000-0000-0000-0000-000000000003');
  if jsonb_array_length(ms->'messages') <> 1 then raise exception 'child C should receive 1 broadcast'; end if;
end $$;
reset role;

-- servant B sees the service / church / all announcements but NOT class A's
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
do $$ declare th jsonb; begin
  th := public.chat_thread('b');
  if jsonb_array_length(th->'messages') <> 3 then raise exception 'servant B should see 3 announcements, got %', jsonb_array_length(th->'messages'); end if;
  if (public.chat_inbox()->>'broadcasts_unread')::int <> 3 then raise exception 'servant B broadcasts_unread should be 3'; end if;
  perform public.chat_mark_read('b');
  if (public.chat_inbox()->>'broadcasts_unread')::int <> 0 then raise exception 'mark read b failed'; end if;
end $$;
reset role;

-- ---------- 6. staff messages: hierarchy ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');   -- class servant A → cannot write up to his manager, nor to B
select pg_temp.expect_error($$select public.chat_send('{"target":"staff","profile_ids":["00000000-0000-0000-0000-000000000004"],"body":"x"}')$$, 'staff_not_reachable');
select pg_temp.expect_error($$select public.chat_send('{"target":"staff","profile_ids":["00000000-0000-0000-0000-000000000003"],"body":"x"}')$$, 'staff_not_reachable');
do $$ begin
  if jsonb_array_length(public.chat_staff_recipients()) <> 0 then raise exception 'class servant A should have no staff recipients yet'; end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');   -- service manager → A and B (below), not church manager, not church 2
do $$ declare r jsonb; begin
  r := public.chat_staff_recipients();
  if jsonb_array_length(r) <> 2 then raise exception 'service manager should reach 2 servants, got %', r; end if;
end $$;
select public.chat_send('{"target":"staff","profile_ids":["00000000-0000-0000-0000-000000000002"],"body":"يا خادم أ، من فضلك"}');
select pg_temp.expect_error($$select public.chat_send('{"target":"staff","profile_ids":["00000000-0000-0000-0000-000000000005"],"body":"x"}')$$, 'staff_not_reachable');
select pg_temp.expect_error($$select public.chat_send('{"target":"staff","profile_ids":["00000000-0000-0000-0000-000000000006"],"body":"x"}')$$, 'staff_not_reachable');
-- staff broadcast to my service's servants
select public.chat_send('{"target":"staff","church_id":"10000000-0000-0000-0000-000000000001","service_id":"20000000-0000-0000-0000-000000000001","body":"اجتماع الخدام"}');
do $$ begin
  if public.chat_audience_count('staff', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null) <> 2 then raise exception 'staff audience should be 2'; end if;
end $$;
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-000000000002');   -- A: now may REPLY to the manager; sees the staff broadcast
do $$ declare ib jsonb; th jsonb; begin
  ib := public.chat_inbox();
  if (select count(*) from jsonb_array_elements(ib->'conversations') c where c->>'kind' = 'staff') <> 1 then raise exception 'A should have 1 staff conversation: %', ib; end if;
  if (ib->>'broadcasts_unread')::int < 1 then raise exception 'A should have the staff broadcast unread'; end if;
  th := public.chat_thread('b');
  if not exists (select 1 from jsonb_array_elements(th->'messages') x where x->>'kind' = 'broadcast_staff') then raise exception 'A should see the staff broadcast'; end if;
  if jsonb_array_length(public.chat_staff_recipients()) <> 1 then raise exception 'A should now reach the manager who wrote to him'; end if;
end $$;
select public.chat_send('{"target":"staff","profile_ids":["00000000-0000-0000-0000-000000000004"],"body":"حاضر"}');
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');   -- B: sees the staff broadcast, NOT the direct conversation
do $$ declare ib jsonb; begin
  ib := public.chat_inbox();
  if (select count(*) from jsonb_array_elements(ib->'conversations') c where c->>'kind' = 'staff') <> 0 then raise exception 'B must not see the A↔manager conversation'; end if;
  if (select count(*) from public.chat_messages where kind = 'staff') <> 0 then raise exception 'RLS leak of staff messages to B'; end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-000000000005');   -- church manager: the service staff-broadcast is BELOW him → not addressed to him
do $$ declare th jsonb; begin
  th := public.chat_thread('b');
  if exists (select 1 from jsonb_array_elements(th->'messages') x where x->>'kind' = 'broadcast_staff') then raise exception 'church manager should not receive a staff broadcast aimed at the service servants'; end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');   -- manager: thread with A has 2 messages, unread 1
do $$ declare th jsonb; ib jsonb; begin
  th := public.chat_thread('s:00000000-0000-0000-0000-000000000002');
  if jsonb_array_length(th->'messages') <> 2 then raise exception 'staff thread should have 2 messages'; end if;
  ib := public.chat_inbox();
  if (select (c->>'unread')::int from jsonb_array_elements(ib->'conversations') c where c->>'kind' = 'staff') <> 1 then raise exception 'manager unread from A should be 1'; end if;
end $$;
reset role;

-- ---------- 7. deletes ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');   -- B cannot delete A's class broadcast (not visible anyway) nor the manager's service broadcast
do $$ declare n int; begin
  delete from public.chat_messages where body = 'إعلان الخدمة';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'servant B must not delete the service announcement'; end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');   -- manager deletes the class-A announcement (in his scope)
do $$ declare n int; begin
  delete from public.chat_messages where body = 'إعلان الفصل';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'service manager should delete the class announcement'; end if;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');   -- A deletes his own reply
do $$ declare n int; begin
  delete from public.chat_messages where body = 'أهلاً مينا';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'author should delete own message'; end if;
  delete from public.chat_messages where body = 'سلام يا أبونا';   -- child's message: class servant is not a manager
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'class servant must not delete the child message'; end if;
end $$;
reset role;

-- ---------- 8. direct table writes blocked ----------
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ begin
  begin
    insert into public.chat_messages (kind, enrollment_id, church_id, service_id, class_id, sender_profile_id, body)
    values ('child', '50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'direct');
    raise exception 'direct insert should be blocked by RLS';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.chat_read_state (reader_profile_id, bucket) values ('00000000-0000-0000-0000-000000000002', 'x');
    raise exception 'direct read_state insert should be blocked';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ---------- 9. realtime ----------
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_messages') then
    raise exception 'chat_messages not in realtime publication';
  end if;
end $$;

rollback;
\echo MESSAGES TESTS PASSED
