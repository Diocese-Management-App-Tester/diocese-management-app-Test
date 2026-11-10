-- =====================================================================
-- 20261020120000 — بوابة المخدوم: كل الإنجازات المتاحة لنطاقه (محقَّقة وغير محقَّقة)
--
-- Until now child_portal_achievements(nid) returned
--     { earned: [...], progress: [...] }
-- `progress` held only the ATTENDANCE achievements still in reach, so a
-- child never saw the achievements that a servant awards by hand (kind
-- 'normal') until he had already got them, and never saw which of the
-- available ones he had NOT reached.
--
-- This migration adds ONE key, `catalog`: every ACTIVE achievement that
-- applies to each of the child's enrollments (church = his church ·
-- service null/= his · class null/= his), both kinds, with how many times he
-- got it and — for attendance ones — current / target. The page derives
-- «حققتها» vs «لم تحققها» from awards_count.
--
--   * `earned` and `progress` are returned EXACTLY as before (same rows,
--     same order, same fields) → older clients keep working.
--   * Same visibility rule as before: only enrollments whose scope has the
--     'achievements' module granted (module_granted_for); the person is
--     resolved from the session token by child_portal_person().
--   * READ ONLY: no insert / update / delete, no new table, no new grant.
--   * Idempotent (create or replace). Rollback = re-run the function from
--     0031_achievements.sql section 12.
-- =====================================================================
begin;

create or replace function public.child_portal_achievements(p_national_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  p public.persons;
  v_earned jsonb;
  v_progress jsonb := '[]'::jsonb;
  v_catalog jsonb := '[]'::jsonb;
  e record; ach public.achievements; pr record; v_ev text;
begin
  p := public.child_portal_person(p_national_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', ua.id,
           'achievement_id', ua.achievement_id,
           'enrollment_id', ua.enrollment_id,
           'name', ach.name,
           'description', ach.description,
           'image_url', ach.image_url,
           'kind', a.kind,
           'points', ua.points_awarded,
           'awarded_at', ua.awarded_at,
           'source', ua.source,
           'event_name', ev.name,
           'class_name', cl.name,
           'service_name', sv.name,
           'church_name', ch.name
         ) order by ua.awarded_at desc), '[]'::jsonb)
    into v_earned
    from public.user_achievements ua
    join public.achievements a on a.id = ua.achievement_id
    join public.classes  cl on cl.id = ua.class_id
    join public.services sv on sv.id = ua.service_id
    join public.churches ch on ch.id = ua.church_id
    left join public.events ev on ev.id = ua.event_id
   where ua.person_id = p.id
     and public.module_granted_for('achievements', ua.church_id, ua.service_id, ua.class_id);

  for e in
    select en.id, en.church_id, en.service_id, en.class_id, cl.name as class_name
      from public.enrollments en join public.classes cl on cl.id = en.class_id
     where en.person_id = p.id
       and public.module_granted_for('achievements', en.church_id, en.service_id, en.class_id)
  loop
    for ach in
      select x.* from public.achievements x
       where x.is_active
         and x.church_id = e.church_id
         and (x.service_id is null or x.service_id = e.service_id)
         and (x.class_id   is null or x.class_id   = e.class_id)
       order by x.sort_order, x.name
    loop
      select * into pr from public.achievement_progress(ach.id, e.id);
      v_ev := null;
      if ach.event_id is not null then select ev.name into v_ev from public.events ev where ev.id = ach.event_id; end if;

      -- the full list of what applies to him (both kinds), with his state
      v_catalog := v_catalog || jsonb_build_object(
        'achievement_id', ach.id,
        'enrollment_id', e.id,
        'class_name', e.class_name,
        'name', ach.name,
        'description', ach.description,
        'image_url', ach.image_url,
        'points', ach.points,
        'kind', ach.kind,
        'award_mode', ach.award_mode,
        'max_awards', ach.max_awards,
        'min_interval_days', ach.min_interval_days,
        'rule', ach.attendance_rule,
        'target', case when ach.kind = 'attendance' then pr.target_value else null end,
        'current', case when ach.kind = 'attendance' then pr.current_value else null end,
        'awards_count', pr.awards_count,
        'last_awarded_at', pr.last_awarded_at,
        'block', pr.block,
        'event_name', v_ev);

      -- unchanged: attendance achievements still in reach
      if ach.kind = 'attendance' and coalesce(pr.block, '') not in ('already_awarded', 'max_reached') then
        v_progress := v_progress || jsonb_build_object(
          'achievement_id', ach.id,
          'enrollment_id', e.id,
          'class_name', e.class_name,
          'name', ach.name,
          'description', ach.description,
          'image_url', ach.image_url,
          'points', ach.points,
          'rule', ach.attendance_rule,
          'current', pr.current_value,
          'target', pr.target_value,
          'awards_count', pr.awards_count,
          'event_name', v_ev);
      end if;
    end loop;
  end loop;

  return jsonb_build_object('earned', v_earned, 'progress', v_progress, 'catalog', v_catalog);
end $$;
grant execute on function public.child_portal_achievements(text) to anon, authenticated;

commit;
