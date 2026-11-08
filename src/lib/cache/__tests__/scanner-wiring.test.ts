// Phase 3 static guards (app files use the `@/` alias → read the sources instead).
//  • the scanner page loads its lookups ONLY through the shared loader
//  • nothing that decides a scan (family_lookup, lookup_enrollments_by_national_id,
//    attendance_log reads, remove-attendance select, points reads) is routed through any cache
//  • attendance / points writes are plain supabase calls, unregistered anywhere in the cache layer
//  • doJob / handleQr write paths still contain the authoritative DB handling (23505, enrollment_stopped)
//  • prefetch handlers are attached to /scanner links only; useDebouncedRealtime untouched
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RPC_READS } from '../reads.ts';
import { SCANNER_LOOKUPS } from '../scanner.ts';

const ROOT = new URL('../../../../src/', import.meta.url).pathname;
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== '__tests__' && f !== 'node_modules') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}
const page = read('app/scanner/page.tsx');
const cacheLayer = ['lib/cache/scanner.ts', 'lib/cache/service.ts', 'lib/cache/reads.ts', 'lib/scanner-data.ts', 'lib/cached-query.ts', 'lib/cached-reads.ts'].map(read).join('\n');

/** body of a top-level `const name = useCallback(` … up to the next top-level `const x = useCallback(` */
function section(src: string, startMarker: string, endMarker: string): string {
  const a = src.indexOf(startMarker); const b = src.indexOf(endMarker, a + 1);
  assert.ok(a >= 0 && b > a, `section ${startMarker} not found`);
  return src.slice(a, b);
}
const doJob = section(page, 'const doJob = useCallback(', 'const handleQr = useCallback(');
const handleQr = section(page, 'const handleQr = useCallback(', '// A member / enrollment was chosen in the family picker');

test('the scanner page loads its six lookups only through the shared loader', () => {
  assert.ok(page.includes("from '@/lib/scanner-data'"));
  assert.ok(/await\s+loadScannerLookups</.test(page));
  assert.ok(!/cachedLookup\b/.test(page), 'no direct cachedLookup left on the scanner page');
  assert.deepEqual(Object.keys(SCANNER_LOOKUPS).sort(), ['call_feedbacks', 'causes', 'churches', 'classes', 'events', 'services']);
});

test('the scanner page never forces/caches anything else: no cachedQuery / reads / cachedRow on it', () => {
  assert.ok(!/cachedQuery|cachedRow|reads\.rpc|peekQuery/.test(page));
});

test('duplicate-scan / acceptance reads stay live: direct supabase calls, not in any cache registry', () => {
  // the two lookups that decide whether a scan is accepted
  assert.ok(handleQr.includes("supabase.rpc('lookup_enrollments_by_national_id'"));
  assert.ok(handleQr.includes('lookupFamily(supabase'));
  assert.ok(read('lib/families.ts').includes("supabase.rpc('family_lookup'"));
  for (const n of ['lookup_enrollments_by_national_id', 'family_lookup', 'family_code_lookup']) {
    assert.ok(!(n in RPC_READS), `${n} must not be a registered cached read`);
    assert.ok(!cacheLayer.includes(`'${n}'`), `${n} must not appear anywhere in the cache layer`);
  }
  // the scanner's own attendance_log status read (visible rows) is a direct select
  const att = section(page, 'const fetchEventAttendance = useCallback(', '}, [supabase]);');
  assert.ok(att.includes('supabase') && att.includes(".from('attendance_log')") && att.includes('.select('), 'direct select');
  assert.ok(!/cachedQuery|reads\.|cachedLookup/.test(att), 'attendance status read is live');
  // Phase 3's own files know nothing about the attendance / points / contact tables.
  // (Phase 2's reads.ts caches attendance_log / contact_log AGGREGATES for the dashboard and follow-up
  //  screens; the scanner page does not use them — asserted above — and none decides a scan.)
  const phase3 = ['lib/cache/scanner.ts', 'lib/scanner-data.ts'].map(read).join('\n').replace(/\/\/.*$/gm, '');
  assert.ok(!/attendance_log|points_log|contact_log|enrollments/.test(phase3), 'Phase 3 code never names those tables');
});

test('attendance and points writes are plain supabase inserts/deletes (never wrapped, never cached)', () => {
  assert.ok(doJob.includes("supabase.from('attendance_log').insert("));
  assert.ok(doJob.includes("supabase.from('points_log').insert("));
  assert.ok(/\.from\('attendance_log'\)\s*\.delete\(\)/.test(doJob));
  assert.ok(read('app/scanner/page.tsx').includes("supabase.from('points_log').insert({")); // manual points modal too
  for (const kind of ['insert', 'update', 'delete', 'upsert']) {
    assert.ok(!new RegExp(`cachedQuery[^;]*\\.${kind}\\(`).test(page));
  }
  // write RPCs are not registered reads
  for (const n of Object.keys(RPC_READS)) assert.ok(!/^(add|set|remove|delete|insert|update|create|record|scan|mark)_/.test(n), `${n} looks like a write`);
});

test('no regression in scan acceptance: authoritative DB handling is still in doJob', () => {
  assert.ok(doJob.includes("error?.code === '23505'"), 'duplicate attendance still decided by the unique index');
  assert.equal(Array.from(doJob.matchAll(/enrollment_stopped/g)).length >= 2, true, 'stopped enrollments still rejected for attendance AND points');
  assert.ok(doJob.includes('scopeApplies') && doJob.includes('eventAvailability'));
  assert.ok(/stopped/.test(doJob));
});

test('no regression in handleQr: family lookup is still first, then the national-id lookup, sequential and live', () => {
  const iFam = handleQr.indexOf('lookupFamily(supabase');
  const iNid = handleQr.indexOf("supabase.rpc('lookup_enrollments_by_national_id'");
  assert.ok(iFam > 0 && iNid > iFam, 'order unchanged');
  assert.ok(handleQr.includes('await doJob(mine[0])'));
  assert.ok(handleQr.includes("setPicker({ person: mine[0].person, options: mine })"));
  assert.ok(handleQr.includes('رقم قومي غير معروف'), 'unknown-id message unchanged');
});

test('loadLookups keeps its contract: same state setters, force passthrough, no extra loads', () => {
  const lines = section(page, 'const loadLookups = useCallback(', '// ---------- Cascading selector options');
  for (const s of ['setChurches(chs)', 'setServices(svs)', 'setClasses(cls)', 'setEvents(evs)', 'setCauses(cas)', 'setFeedbacks(fbs)']) assert.ok(lines.includes(s), s);
  assert.ok(lines.includes('supabase, force'));
  assert.ok(lines.includes("profile?.status === 'approved'"), 'init still waits for an approved profile');
});

test('intent prefetch is attached only to /scanner links, via scannerIntentProps', () => {
  for (const f of ['components/BottomNav.tsx', 'components/SideMenu.tsx', 'components/widgets/CoreWidgets.tsx', 'app/family/page.tsx']) {
    assert.ok(read(f).includes('scannerIntentProps('), f);
  }
  const sd = read('lib/scanner-data.ts');
  assert.ok(sd.includes("if (href !== SCANNER_HREF) return {}"));
  assert.ok(sd.includes('enabled: queryCacheEnabled'), 'prefetch only while a cache identity exists');
  assert.ok(!/force\s*=\s*true|, true\)/.test(sd.replace(/\/\/.*$/gm, '')), 'prefetch never forces');
});

test('Phase 3 does not touch the realtime bus', () => {
  const rt = read('lib/realtime.ts');
  assert.ok(rt.includes('export function useDebouncedRealtime'));
  assert.ok(!/scanner/i.test(rt));
});
