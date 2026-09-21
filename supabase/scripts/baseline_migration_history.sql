-- =====================================================================
-- ONE-TIME BASELINE — mark the migrations that are ALREADY applied.
--
-- Run this ONCE, in the Supabase SQL editor, on a database that was set
-- up by hand (SQL editor) before CI took over.  It does NOT change the
-- schema — it only tells the Supabase CLI which files it must NOT run
-- again, so the first `supabase db push` from GitHub Actions applies
-- only the new files.
--
-- How it works:
--   `supabase db push` compares the file names in supabase/migrations/
--   (the digits before the first "_" = the "version") against the table
--   supabase_migrations.schema_migrations(version).  Whatever is in the
--   table is skipped.  We insert 0001 .. 0051 here.
--
-- Equivalent CLI command (needs the DB password, same result):
--   supabase migration repair --status applied 0001 0002 0003 ... 0051
--
-- Safe to re-run (ON CONFLICT DO NOTHING).  0002 (owner 000000 / 000000)
-- is listed too: an existing database already has its owner, so CI must
-- NOT create a second one.  If you DO want the default owner on an
-- existing DB, run supabase/migrations/0002_bootstrap_owner.sql by hand.
-- =====================================================================

create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text not null primary key
);
alter table supabase_migrations.schema_migrations add column if not exists statements text[];
alter table supabase_migrations.schema_migrations add column if not exists name text;

insert into supabase_migrations.schema_migrations (version, name) values
  ('0001', 'schema'),
  ('0002', 'bootstrap_owner'),
  ('0003', 'signup_scope'),
  ('0004', 'class_servant_edit'),
  ('0005', 'photos_and_servants'),
  ('0006', 'null_scope_means_all'),
  ('0007', 'child_job'),
  ('0008', 'attendance_points_logs'),
  ('0009', 'child_gender_photo'),
  ('0010', 'rebuild_children_order'),
  ('0011', 'persons_enrollments'),
  ('0012', 'simplify_logs'),
  ('0013', 'events_causes'),
  ('0014', 'event_schedule_scope_points'),
  ('0015', 'default_and_points_mode'),
  ('0016', 'data_job_delete'),
  ('0017', 'card_templates'),
  ('0018', 'card_print_requests'),
  ('0019', 'performance_rls_indexes_rpc'),
  ('0020', 'statistics_rpcs'),
  ('0021', 'child_portal'),
  ('0022', 'event_bound_operations'),
  ('0023', 'call_feedbacks'),
  ('0024', 'owner_module_access'),
  ('0025', 'shepherd_groups'),
  ('0026', 'points_store'),
  ('0027', 'exams'),
  ('0028', 'birthdays'),
  ('0029', 'chat_messages'),
  ('0030', 'online_classes'),
  ('0031', 'achievements'),
  ('0032', 'occasions'),
  ('0033', 'occasions_ticket_code_fix'),
  ('0034', 'notifications'),
  ('0035', 'app_customization'),
  ('0036', 'home_widgets_and_names'),
  ('0037', 'servant_enrollments_permissions'),
  ('0038', 'exam_results'),
  ('0039', 'library'),
  ('0040', 'code_system'),
  ('0041', 'admin_add_servants'),
  ('0042', 'child_accounts_servant_mirror'),
  ('0043', 'stop_enrollments_default_password'),
  ('0044', 'backup_restore'),
  ('0045', 'multi_scope_servants'),
  ('0046', 'realtime_broadcast_scale'),
  ('0047', 'activity_log'),
  ('0048', 'scoped_defaults'),
  ('0049', 'card_print_profiles'),
  ('0050', 'report_templates'),
  ('0051', 'fix_app_settings_names_validation')
on conflict (version) do nothing;

-- What the CLI will now consider "already applied":
select version, name from supabase_migrations.schema_migrations order by version;
