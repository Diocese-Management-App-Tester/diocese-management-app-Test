-- =====================================================================
-- 0051: FIX — saving «الأسماء المخصصة» (app_settings.names) failed
--
-- 0040 rewrote validate_app_settings() and declared a loop variable
-- `kv record` for the code-system scope check. The older `names` check
-- (0036) uses `kv` as the SQL alias of jsonb_each(new.value) — PL/pgSQL
-- resolves `kv.value` to the (never assigned) record variable first and
-- raises:  record "kv" is not assigned yet.
-- Every insert / update of the 'names' key has been failing since 0040
-- (تخصيص التطبيق → الأسماء). This migration recreates the function with
-- the loop record renamed (`sc`); the checks themselves are unchanged.
--
-- Idempotent; run after 0050.
-- =====================================================================

begin;

create or replace function public.validate_app_settings()
returns trigger language plpgsql as $$
declare g text; gen jsonb; sc record;
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
  if new.key = 'codes' then
    perform public.validate_code_template(new.value -> 'default', 'default');
    if jsonb_array_length(new.value -> 'default' -> 'parts') = 0 then
      raise exception 'app_settings.codes: default template needs at least one part';
    end if;
    if new.value ? 'generators' then
      if jsonb_typeof(new.value -> 'generators') <> 'object' then
        raise exception 'app_settings.codes: generators must be an object';
      end if;
      for g, gen in select * from jsonb_each(new.value -> 'generators') loop
        if g not in ('person', 'servant', 'store_item', 'ticket') then
          raise exception 'app_settings.codes: unknown generator %', g;
        end if;
        if coalesce(gen ->> 'mode', 'legacy') not in ('default', 'custom', 'legacy') then
          raise exception 'app_settings.codes: generator % has an invalid mode', g;
        end if;
        if gen ? 'template' then perform public.validate_code_template(gen -> 'template', g); end if;
        if gen ->> 'mode' = 'custom' and jsonb_array_length(coalesce(gen -> 'template' -> 'parts', '[]'::jsonb)) = 0 then
          raise exception 'app_settings.codes: generator % is custom but has no parts', g;
        end if;
      end loop;
    end if;
    if new.value ? 'scopes' then
      for sc in
        select m.key as grp, e.key as id, e.value as abbr
          from jsonb_each(new.value -> 'scopes') m
          cross join lateral jsonb_each(m.value) e
      loop
        if sc.grp not in ('churches', 'services', 'classes') then
          raise exception 'app_settings.codes: unknown scope group %', sc.grp;
        end if;
        if jsonb_typeof(sc.abbr) <> 'string' or (sc.abbr #>> '{}') !~ '^[A-Za-z0-9._-]{1,8}$' then
          raise exception 'app_settings.codes: abbreviation for % must be 1–8 safe characters', sc.id;
        end if;
      end loop;
    end if;
  end if;
  return new;
end $$;

-- the trigger from 0040 (trg_validate_app_settings) stays bound to the function

commit;
