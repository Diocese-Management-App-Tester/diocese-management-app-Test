// Child portal الإنجازات — catalog derivation (حققتها / لم أحققها / الكل) + static guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildChildAchievementView, pickAchievements, howToEarn, isAchieved } from '../../child-achievements-view.ts';
import type { ChildCatalogItem, ChildEarnedAchievement } from '../../achievements.ts';

type Item = ChildCatalogItem;
const item = (id: string, o: Partial<Item> = {}): Item => ({
  achievement_id: id, enrollment_id: 'e1', class_name: 'فصل أ', name: `إنجاز ${id}`, description: null, image_url: null,
  points: 10, kind: 'normal', award_mode: 'once', max_awards: null, min_interval_days: null, rule: null,
  target: null, current: null, awards_count: 0, last_awarded_at: null, block: null, event_name: null, ...o,
} as Item);

test('achieved = got it at least once; missing = never — every available one is in exactly one of them', () => {
  const v = buildChildAchievementView([
    item('a', { awards_count: 1, last_awarded_at: '2026-01-02T10:00:00Z', block: 'already_awarded' }),
    item('b'),
    item('c', { kind: 'attendance', rule: 'count', target: 5, current: 2 }),
    item('d', { kind: 'attendance', rule: 'streak', target: 4, current: 4, awards_count: 2, last_awarded_at: '2026-02-01T10:00:00Z' }),
  ]);
  assert.deepEqual(v.counts, { available: 4, achieved: 2, missing: 2 });
  assert.deepEqual(v.achieved.map((c) => c.achievement_id).sort(), ['a', 'd']);
  assert.deepEqual(v.missing.map((c) => c.achievement_id).sort(), ['b', 'c']);
  assert.equal(v.all.length, 4);
  assert.equal(new Set(v.all.map((c) => c.achievement_id)).size, 4);
});

test('the filter picks the right list', () => {
  const v = buildChildAchievementView([item('a', { awards_count: 1 }), item('b')]);
  assert.deepEqual(pickAchievements(v, 'all').map((c) => c.achievement_id), ['b', 'a']);
  assert.deepEqual(pickAchievements(v, 'achieved').map((c) => c.achievement_id), ['a']);
  assert.deepEqual(pickAchievements(v, 'missing').map((c) => c.achievement_id), ['b']);
});

test('missing: closest attendance target first, manual ones after; ties keep the server order', () => {
  const v = buildChildAchievementView([
    item('m1'),
    item('far', { kind: 'attendance', rule: 'count', target: 10, current: 1 }),
    item('near', { kind: 'attendance', rule: 'count', target: 4, current: 3 }),
    item('m2'),
  ]);
  assert.deepEqual(v.missing.map((c) => c.achievement_id), ['near', 'far', 'm1', 'm2']);
});

test('achieved: most recent first', () => {
  const v = buildChildAchievementView([
    item('old', { awards_count: 1, last_awarded_at: '2026-01-01T00:00:00Z' }),
    item('new', { awards_count: 1, last_awarded_at: '2026-03-01T00:00:00Z' }),
  ]);
  assert.deepEqual(v.achieved.map((c) => c.achievement_id), ['new', 'old']);
});

test('a repeatable achievement he already got stays «achieved» even while a new run is in progress', () => {
  const c = item('r', { kind: 'attendance', award_mode: 'multiple', rule: 'streak', target: 4, current: 1, awards_count: 1, last_awarded_at: '2026-01-01T00:00:00Z' });
  assert.equal(isAchieved(c), true);
  assert.equal(buildChildAchievementView([c]).counts.missing, 0);
});

test('empty / missing / junk catalog never throws', () => {
  for (const x of [null, undefined, [], [null as never, { } as never]]) {
    const v = buildChildAchievementView(x as never);
    assert.deepEqual(v.counts, { available: 0, achieved: 0, missing: 0 });
  }
});

test('howToEarn explains the condition', () => {
  assert.equal(howToEarn({ kind: 'normal', rule: null, target: null, event_name: null }), 'يمنحه لك خادمك');
  assert.equal(howToEarn({ kind: 'attendance', rule: 'count', target: 5, event_name: null }), 'احضر 5 مرات');
  assert.equal(howToEarn({ kind: 'attendance', rule: 'streak', target: 4, event_name: 'القداس' }), 'احضر 4 مرات متتالية في «القداس»');
  assert.equal(howToEarn({ kind: 'attendance', rule: 'count', target: 2, event_name: null }), 'احضر 2 مرتين');
});

test('something he earned that is no longer in the active catalog still shows as achieved (once per achievement × enrollment)', () => {
  const earned = (id: string, at: string, ach = 'gone'): ChildEarnedAchievement => ({
    id, achievement_id: ach, enrollment_id: 'e1', name: 'قديم', description: null, image_url: null, kind: 'normal', points: 5,
    awarded_at: at, source: 'manual', event_name: null, class_name: 'فصل أ', service_name: 's', church_name: 'c',
  });
  const v = buildChildAchievementView([item('a'), item('b', { awards_count: 1, last_awarded_at: '2026-01-01T00:00:00Z' })],
    [earned('u1', '2026-01-01T00:00:00Z', 'b'), earned('u2', '2026-02-01T00:00:00Z'), earned('u3', '2026-03-01T00:00:00Z')]);
  assert.deepEqual(v.counts, { available: 3, achieved: 2, missing: 1 });          // 'b' not duplicated, 'gone' added once
  const gone = v.achieved.find((c) => c.achievement_id === 'gone')!;
  assert.equal(gone.awards_count, 2);
  assert.equal(gone.last_awarded_at, '2026-03-01T00:00:00Z');
  assert.equal(gone.target, null);                                                // no progress bar for it
  assert.deepEqual(v.achieved.map((c) => c.achievement_id), ['gone', 'b']);       // most recent first
});

// ---------- static guards ----------
const ROOT = new URL('../../../../', import.meta.url).pathname;
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

test('page: catalog view when the migration is there, previous view otherwise; filter has the three tabs', () => {
  const page = read('src/app/child/achievements/page.tsx');
  assert.ok(/data\.catalog\s*\?\s*<CatalogContent/.test(page) && page.includes('<LegacyContent'));
  for (const label of ['الكل', 'حققتها', 'لم أحققها']) assert.ok(page.includes(label), label);
  assert.ok(page.includes('buildChildAchievementView') && page.includes('pickAchievements'));
});

test('client data layer: catalog is optional (old RPC keeps working) and the fetch is unchanged', () => {
  const lib = read('src/lib/achievements.ts');
  assert.ok(/catalog\?:\s*ChildCatalogItem\[\]/.test(lib));
  assert.ok(lib.includes("supabase.rpc('child_portal_achievements', { p_national_id: token })"));
});

test('migration: read-only, same grants, earned/progress kept, one new key', () => {
  const sql = read('supabase/migrations/20261020120000_child_achievements_catalog.sql');
  const code = sql.replace(/--.*$/gm, '');
  assert.ok(!/\b(insert|update|delete|alter|drop|create table|create policy)\b/i.test(code.replace(/create or replace function/gi, '')), 'no writes / DDL besides the function');
  assert.ok(/security definer set search_path = public/.test(code));
  assert.ok(code.includes("grant execute on function public.child_portal_achievements(text) to anon, authenticated;"));
  assert.ok(code.includes("jsonb_build_object('earned', v_earned, 'progress', v_progress, 'catalog', v_catalog)"));
  assert.ok(code.includes("module_granted_for('achievements'"), 'module gate kept');
  assert.ok(code.includes('x.is_active'), 'only active achievements are listed');
  assert.ok(code.includes('child_portal_person(p_national_id)'), 'person resolved from the session token');
  // the progress block must keep the exact condition of 0031
  assert.ok(code.includes("ach.kind = 'attendance' and coalesce(pr.block, '') not in ('already_awarded', 'max_reached')"));
});
