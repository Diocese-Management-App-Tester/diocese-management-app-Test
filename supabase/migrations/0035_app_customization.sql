-- =====================================================================
-- 0035: APP CUSTOMIZATION (تخصيص التطبيق) — owner-controlled settings
--
-- A tiny key/value store for APP-WIDE customization decided by the OWNER
-- from وحدة المالك → تخصيص التطبيق. First consumer: the NAVIGATION layout
--
--   key = 'navigation' → {
--     version: 1,
--     taskbar: [{ key, icon?, label? } × 5],   -- the 5 bottom-bar slots
--     header:  [{ key, icon? } …]              -- header icons, in order
--   }
--
-- `taskbar[].key` is a navigation destination: one of the core pages
-- (home · children · scanner · stats · settings), any module key from the
-- registry (`src/lib/modules.ts`) or `owner`. Everything that is NOT in the
-- taskbar is listed in the side menu under the 5 main slots. `header[].key`
-- is a header widget (`date` · `messages` · `notifications`) or
-- `link:<destination>` for a quick-link icon. The menu button is fixed.
--
-- Resolution (which module a given servant may actually see) stays in the
-- app: a slot pointing at a module hidden from the caller falls back to the
-- next default core page — see `src/lib/customization-context.tsx`.
--
-- RLS: every authenticated user READS (the shell needs it); only the OWNER
-- WRITES. Realtime so every open app re-lays its bars the moment the owner
-- saves. Idempotent — safe to re-run. Depends on 0019 (is_owner).
-- =====================================================================

begin;

create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id),
  constraint app_settings_key_fmt check (key ~ '^[a-z][a-z0-9_:-]{1,60}$')
);

alter table public.app_settings enable row level security;

drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings for select using (
  auth.role() = 'authenticated'
);
drop policy if exists app_settings_insert on public.app_settings;
create policy app_settings_insert on public.app_settings for insert with check (
  (select public.is_owner())
);
drop policy if exists app_settings_update on public.app_settings;
create policy app_settings_update on public.app_settings for update using (
  (select public.is_owner())
) with check (
  (select public.is_owner())
);
drop policy if exists app_settings_delete on public.app_settings;
create policy app_settings_delete on public.app_settings for delete using (
  (select public.is_owner())
);

-- keep updated_at honest
create or replace function public.touch_app_settings()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_touch_app_settings on public.app_settings;
create trigger trg_touch_app_settings before update on public.app_settings
for each row execute function public.touch_app_settings();

-- realtime — bars re-lay instantly on every device
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_settings'
  ) then
    alter publication supabase_realtime add table public.app_settings;
  end if;
end $$;
alter table public.app_settings replica identity full;

commit;
