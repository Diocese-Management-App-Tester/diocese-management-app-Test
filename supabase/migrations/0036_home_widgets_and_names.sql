-- =====================================================================
-- 0036: HOME WIDGETS + CUSTOM NAMES (تخصيص التطبيق — الرئيسية والأسماء)
--
-- No new tables: this migration only DOCUMENTS the two new keys stored in
-- `app_settings` (created in 0035, owner-write / all-read / realtime) and
-- adds a validation trigger so the owner can never save a malformed layout.
--
--   key = 'widgets' → {
--     version: 1,
--     items: [{ key, size?, title? } …]      -- home-page widgets, in order
--   }
--   `items[].key`  — a widget from the registry (`src/lib/widgets.ts`)
--   `items[].size` — 'full' | 'half' (grid span on the home page)
--   `items[].title`— optional custom heading (≤ 30 chars)
--
--   key = 'names' → { "<destination key>": "<custom label>", … }
--   A single source of truth for the DISPLAY NAME of every destination
--   (core pages · modules · owner module). The name entered here — or in
--   the taskbar slot editor — is what the taskbar, the side menu, the
--   settings hub, the module headers and the page titles all show.
--
-- Resolution (which widget a given servant actually sees) stays in the
-- app: a widget bound to a module hidden from the caller is skipped — see
-- `src/lib/customization-context.tsx`. Idempotent — safe to re-run.
-- =====================================================================

begin;

create or replace function public.validate_app_settings()
returns trigger language plpgsql as $$
begin
  if jsonb_typeof(new.value) <> 'object' then
    raise exception 'app_settings.value must be a JSON object (key %)', new.key;
  end if;
  if new.key = 'names' then
    if exists (
      select 1 from jsonb_each(new.value) kv
       where jsonb_typeof(kv.value) <> 'string'
          or length(kv.value #>> '{}') = 0
          or length(kv.value #>> '{}') > 30
    ) then
      raise exception 'app_settings.names: every label must be a 1–30 character string';
    end if;
  end if;
  if new.key = 'widgets' then
    if jsonb_typeof(new.value -> 'items') <> 'array'
       or jsonb_array_length(new.value -> 'items') > 40 then
      raise exception 'app_settings.widgets: items must be an array (max 40)';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_validate_app_settings on public.app_settings;
create trigger trg_validate_app_settings before insert or update on public.app_settings
for each row execute function public.validate_app_settings();

commit;
