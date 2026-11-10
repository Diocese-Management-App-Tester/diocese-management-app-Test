// ---------- Child portal — الإنجازات: كل المتاح / حققتها / لم تحققها ----------
// Pure derivation over `child_portal_achievements().catalog` (migration 20261020120000).
// No alias imports on purpose: unit-tested with node:test (src/lib/cache/__tests__).

import type { ChildCatalogItem, ChildEarnedAchievement } from './achievements';

export type AchievementFilter = 'all' | 'achieved' | 'missing';

export interface ChildAchievementView {
  /** every achievement available to his scope (one row per achievement × enrollment), stable order */
  all: ChildCatalogItem[];
  achieved: ChildCatalogItem[];
  missing: ChildCatalogItem[];
  counts: { available: number; achieved: number; missing: number };
}

/** achieved = he got it at least once (awards_count > 0); missing = never */
export const isAchieved = (c: Pick<ChildCatalogItem, 'awards_count'>): boolean => c.awards_count > 0;

/**
 * Attendance achievements that are not achieved yet come first (closest to the target first),
 * then the manual ones; achieved ones keep the most recent first. The server order (sort_order, name)
 * is the tie-breaker, so the result is deterministic.
 */
export function buildChildAchievementView(
  catalog: ChildCatalogItem[] | null | undefined,
  earned?: ChildEarnedAchievement[] | null,
): ChildAchievementView {
  const list = Array.isArray(catalog) ? catalog.filter((c) => c && c.achievement_id) : [];
  // The catalog lists ACTIVE achievements only. Something he already earned that was deactivated (or no
  // longer applies) must not vanish from «حققتها» → add it from `earned`, once per achievement × enrollment.
  const have = new Set(list.map((c) => `${c.achievement_id}|${c.enrollment_id}`));
  const extra = new Map<string, ChildCatalogItem>();
  for (const e of Array.isArray(earned) ? earned : []) {
    if (!e || !e.achievement_id) continue;
    const key = `${e.achievement_id}|${e.enrollment_id}`;
    if (have.has(key)) continue;
    const prev = extra.get(key);
    if (prev) {
      prev.awards_count += 1;
      if ((e.awarded_at ?? '') > (prev.last_awarded_at ?? '')) prev.last_awarded_at = e.awarded_at;
    } else {
      extra.set(key, {
        achievement_id: e.achievement_id, enrollment_id: e.enrollment_id, class_name: e.class_name, name: e.name,
        description: e.description, image_url: e.image_url, points: e.points, kind: e.kind, award_mode: 'once',
        max_awards: null, min_interval_days: null, rule: null, target: null, current: null,
        awards_count: 1, last_awarded_at: e.awarded_at, block: 'inactive', event_name: e.event_name,
      });
    }
  }
  list.push(...Array.from(extra.values()));
  const idx = new Map(list.map((c, i) => [c, i] as const));
  const ratio = (c: ChildCatalogItem) => (c.kind === 'attendance' && c.target ? Math.min(c.current ?? 0, c.target) / c.target : -1);

  const missing = list.filter((c) => !isAchieved(c)).sort((a, b) => ratio(b) - ratio(a) || idx.get(a)! - idx.get(b)!);
  const achieved = list.filter(isAchieved).sort((a, b) => (b.last_awarded_at ?? '').localeCompare(a.last_awarded_at ?? '') || idx.get(a)! - idx.get(b)!);
  return {
    all: [...missing, ...achieved],
    achieved,
    missing,
    counts: { available: list.length, achieved: achieved.length, missing: missing.length },
  };
}

export function pickAchievements(view: ChildAchievementView, filter: AchievementFilter): ChildCatalogItem[] {
  return filter === 'achieved' ? view.achieved : filter === 'missing' ? view.missing : view.all;
}

/** «كيف أحصل عليه؟» — the condition in words */
export function howToEarn(c: Pick<ChildCatalogItem, 'kind' | 'rule' | 'target' | 'event_name'>): string {
  if (c.kind === 'normal') return 'يمنحه لك خادمك';
  const n = c.target ?? 0;
  const ev = c.event_name ? ` في «${c.event_name}»` : '';
  if (c.rule === 'streak') return `احضر ${n} ${n === 1 ? 'مرة' : n === 2 ? 'مرتين' : n <= 10 ? 'مرات' : 'مرة'} متتالية${ev}`;
  return `احضر ${n} ${n === 1 ? 'مرة' : n === 2 ? 'مرتين' : n <= 10 ? 'مرات' : 'مرة'}${ev}`;
}
