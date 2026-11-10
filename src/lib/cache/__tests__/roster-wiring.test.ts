// Phase 4 static guards (app files use the `@/` alias → read the sources instead).
//  • the scanner page identifies a national id through identifyScan, with the ORIGINAL RPC as the server fallback
//  • the roster layer never touches attendance / points / contact writes or any storage
//  • doJob keeps the authoritative DB handling (23505 duplicate, enrollment_stopped) and its direct writes
//  • the family lookup still runs first and is not cached; realtime.ts is untouched
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../../../src/', import.meta.url).pathname;
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const page = read('app/scanner/page.tsx');
const roster = read('lib/cache/roster.ts');
const binding = read('lib/scanner-roster.ts');
const service = read('lib/cache/service.ts');

function section(src: string, a: string, b: string): string {
  const i = src.indexOf(a); const j = src.indexOf(b, i + 1);
  assert.ok(i >= 0 && j > i, `section ${a} not found`);
  return src.slice(i, j);
}
const doJob = section(page, 'const doJob = useCallback(', 'const handleQr = useCallback(');
const handleQr = section(page, 'const handleQr = useCallback(', '// A member / enrollment was chosen in the family picker');

test('handleQr identifies the person through identifyScan; the original RPC is only the server fallback', () => {
  assert.ok(handleQr.includes('identifyScan('));
  assert.ok(handleQr.includes('scannerRoster'));
  const calls = Array.from(page.matchAll(/lookup_enrollments_by_national_id/g));
  assert.equal(calls.length, 1, 'the RPC is referenced exactly once in the page');
  const rpcAt = handleQr.indexOf("supabase.rpc('lookup_enrollments_by_national_id'");
  assert.ok(rpcAt > handleQr.indexOf('identifyScan('), 'RPC lives inside the identifyScan fallback callback');
  assert.ok(handleQr.includes('تعذر البحث عن الرقم القومي'), 'same error message preserved');
});

test('the family lookup still runs first, on the server', () => {
  assert.ok(handleQr.indexOf('lookupFamily(supabase') >= 0);
  assert.ok(handleQr.indexOf('lookupFamily(supabase') < handleQr.indexOf('identifyScan('));
  assert.ok(read('lib/families.ts').includes("supabase.rpc('family_lookup'"));
});

test('doJob: authoritative DB handling and direct writes are untouched', () => {
  assert.ok(doJob.includes("supabase.from('attendance_log').insert("));
  assert.ok(doJob.includes("error?.code === '23505'"), 'unique-index duplicate handling');
  assert.ok(Array.from(doJob.matchAll(/enrollment_stopped/g)).length >= 2, 'stopped trigger handled for attendance and points');
  assert.ok(doJob.includes("supabase.from('points_log').insert("));
  assert.ok(doJob.includes('.delete()'), 'remove-attendance stays a direct delete');
  assert.ok(!/scannerRoster|identifyScan|resolve\(/.test(doJob), 'doJob never consults the roster');
});

test('the roster layer has no write path and never persists anything', () => {
  for (const [name, src] of [['roster.ts', roster], ['scanner-roster.ts', binding]] as const) {
    assert.ok(!/attendance_log|points_log|contact_log|call_feedback/.test(src), `${name} must not reference write tables`);
    assert.ok(!/sessionStorage|localStorage|indexedDB|caches\.open/.test(src), `${name} must stay in memory`);
    assert.ok(!/(?<!Array)\.from\(\s*'|\.rpc\(/.test(src.replace(/\/\/.*$/gm, '')), `${name} must not issue queries`);
    assert.ok(!/\.(insert|upsert)\(|\.update\(\{/.test(src), `${name} must not write`);
  }
  assert.ok(!/\.rpc\(/.test(roster), 'the core never calls an RPC itself; the server fallback is injected by the page');
  assert.ok(!/lookup_enrollments_by_national_id|family_lookup/.test((roster + binding).replace(/\/\/.*$/gm, '')), 'lookup RPCs are not wired into the roster layer');
});

test('the roster loads through fetchEnrollmentsPage with kind "all" (same rows the RPC would return)', () => {
  assert.ok(binding.includes('fetchEnrollmentsPage('));
  assert.ok(/kind:\s*'all'/.test(binding));
  assert.ok(binding.includes('onBusTable') && binding.includes('onAppResume'));
});

test('security tables and resume invalidate the roster; trust is required for local hits', () => {
  assert.ok(roster.includes('SECURITY_TABLES'));
  assert.ok(roster.includes('onResume') && roster.includes('onIdentity') && roster.includes('onTrust'));
  assert.ok(/verified\s*&&\s*env\.trusted\(\)/.test(roster) || roster.includes('env.trusted()'));
});

test('every guard has a server fallback reason (no silent local decision)', () => {
  for (const reason of ['no-roster', 'identity', 'scope', 'untrusted', 'expired', 'blocked', 'invalid-id', 'unknown', 'dirty', 'stopped']) {
    assert.ok(roster.includes(`'${reason}'`), `reason ${reason} present`);
  }
});

test('realtime.ts is untouched by Phase 4', () => {
  const rt = read('lib/realtime.ts');
  assert.ok(rt.includes('export function useDebouncedRealtime'));
  assert.ok(!/roster/i.test(rt));
});

test('service.ts additions are listeners only (no new cache behavior)', () => {
  assert.ok(service.includes('onBusTrust') && service.includes('onIdentityChange') && service.includes('busTrusted'));
  assert.ok(!/createScannerRoster|scannerRoster|fetchEnrollments/.test(service), 'service.ts does not know about the roster');
});

test('the page releases the roster on unmount and loads it only for approved profiles', () => {
  assert.ok(page.includes('scannerRoster.release()'));
  const load = section(page, 'void scannerRoster.load(', '}, [');
  assert.ok(load.includes('supabase'));
  assert.ok(/status\s*!==?\s*'approved'|status\s*===\s*'approved'/.test(page.slice(page.indexOf('void scannerRoster.load(') - 400, page.indexOf('void scannerRoster.load('))));
});
