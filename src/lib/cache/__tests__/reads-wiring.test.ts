// Static wiring guards for Phase 2 (the app files import through the `@/` alias,
// which plain node cannot resolve, so these tests read the sources instead).
//  • every RPC name passed to reads.rpc / reads.rpcSoft is registered in RPC_READS
//  • every registered RPC is actually used (no dead registration)
//  • a migrated RPC is never called directly any more (it would dodge the cache)
//  • the write RPCs / excluded reads are NOT registered
//  • no realtime hook receives a bare cached `load` (it must force)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RPC_READS } from '../reads.ts';

const ROOT = new URL('../../../../src/', import.meta.url).pathname;
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== '__tests__' && f !== 'node_modules') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}
const files = walk(ROOT).map((p) => ({ p, s: readFileSync(p, 'utf8') }));
const registered = Object.keys(RPC_READS);

test('every RPC passed to reads.rpc / reads.rpcSoft is registered', () => {
  const used = new Set<string>();
  for (const { s } of files) for (const m of Array.from(s.matchAll(/reads\.rpc(?:Soft)?(?:<[^(]*>)?\(\s*supabase,\s*'(\w+)'/g))) used.add(m[1]);
  assert.ok(used.size > 0);
  for (const n of Array.from(used)) assert.ok(registered.includes(n), `${n} is used through reads but not registered`);
});

test('every registered RPC is used by some wrapper / widget', () => {
  const blob = files.map((f) => f.s).join('\n');
  for (const n of registered) assert.ok(new RegExp(`reads\\.rpc(?:Soft)?(?:<[^(]*>)?\\(\\s*supabase,\\s*'${n}'`).test(blob), `${n} registered but unused`);
});

// Reads that deliberately stay LIVE although the RPC is registered (reported in the PR):
//  • settings/page.tsx — the «إدارة الطلبات» menu badge: not one of the five Phase 2 targets,
//    realtime-driven on data_change_requests, a single tiny count → left untouched.
const DIRECT_OK: Record<string, string[]> = {
  'app/settings/page.tsx': ['pending_data_requests_count'],
};

test('a migrated RPC is never called directly (it would bypass the cache) — except the documented ones', () => {
  for (const { p, s } of files) {
    if (p.endsWith('cache/reads.ts')) continue; // the one place that calls supabase.rpc(name, args)
    const allowed = Object.entries(DIRECT_OK).find(([rel]) => p.endsWith(rel))?.[1] ?? [];
    for (const n of registered) {
      if (allowed.includes(n)) continue;
      assert.ok(!s.includes(`.rpc('${n}'`), `${p} calls ${n} directly`);
    }
  }
  // …and the exception list itself must not rot
  for (const [rel, names] of Object.entries(DIRECT_OK)) {
    const s = files.find((f) => f.p.endsWith(rel))!.s;
    for (const n of names) assert.ok(s.includes(`.rpc('${n}'`), `${rel} no longer calls ${n} — drop it from DIRECT_OK`);
  }
});

test('write RPCs and excluded reads are not registered', () => {
  for (const n of [
    'owner_bulk_enroll', 'owner_bulk_unenroll', 'owner_bulk_delete_persons', 'owner_merge_persons',
    'owner_add_priest_for_person', 'owner_add_servant_places',
  ]) assert.ok(!registered.includes(n), `${n} must never be cacheable`);
  for (const n of registered) assert.ok(/^(stats_|dashboard_counts$|pending_data_requests_count$|owner_persons_(page|counts)$)/.test(n), `unexpected ${n}`);
});

test('no realtime hook gets a bare cached loader — it must force', () => {
  // the migrated screens' loaders take (force) → useDebouncedRealtime(..., load, ...) would pass the debounce args
  const migrated = [
    'components/widgets/ActivityWidgets.tsx', 'components/widgets/CoreWidgets.tsx',
    'app/owner/persons/page.tsx',
  ];
  for (const rel of migrated) {
    const s = files.find((f) => f.p.endsWith(rel))!.s;
    for (const m of Array.from(s.matchAll(/useDebouncedRealtime\([\s\S]*?\);/g))) {
      assert.ok(!/\],\s*(load|loadAttended)\s*,/.test(m[0]) && !/^\s*(load|loadAttended),\s*$/m.test(m[0]), `${rel}: ${m[0].slice(0, 80)} passes a bare loader`);
    }
    for (const m of Array.from(s.matchAll(/useBusIds\([^;]*?\);/g))) {
      for (const c of Array.from(m[0].matchAll(/void (load|loadAttended)\((\w*)\)/g))) assert.equal(c[2], 'true', `${rel}: bus callback calls ${c[1]}(${c[2]})`);
    }
  }
});

test('a force-taking loader is never passed bare as a callback prop', () => {
  for (const rel of ['components/widgets/ActivityWidgets.tsx', 'components/widgets/CoreWidgets.tsx', 'app/owner/persons/page.tsx']) {
    const s = files.find((f) => f.p.endsWith(rel))!.s;
    assert.ok(!/\b(on\w+|callback)=\{(load|loadAttended)\}/.test(s), `${rel}: bare loader passed as a prop (its event argument would become \`force\`)`);
  }
});

test('stats tabs: effects load cached, the imperative handle forces', () => {
  for (const t of ['Overview', 'Attendance', 'Points', 'Calls']) {
    const s = files.find((f) => f.p.endsWith(`components/stats/${t}Tab.tsx`))!.s;
    assert.match(s, /useEffect\(\(\) => \{ (reload|loadAll)\(false\); \}/, `${t}: mount load must be cacheable`);
    assert.match(s, /reload: \(\) => (reload|loadAll)\(true\)/, `${t}: reload handle must force`);
  }
});

test('owner persons page: select-all and merge search bypass, writes force', () => {
  const page = files.find((f) => f.p.endsWith('app/owner/persons/page.tsx'))!.s;
  assert.match(page, /fetchOwnerPersons\(supabase, filter, p, 500, \{ bypass: true \}\)/);
  assert.ok(!/onDone=\{[^}]*\bload\(\)/.test(page), 'onDone must force-load');
  assert.equal((page.match(/void load\(true\)/g) ?? []).length >= 7, true);
  const merge = files.find((f) => f.p.endsWith('owner/MergePersonsModal.tsx'))!.s;
  assert.match(merge, /\{ bypass: true \}/);
});

test('backup restore invalidates the Phase 2 reads', () => {
  const s = files.find((f) => f.p.endsWith('app/owner/backup/page.tsx'))!.s;
  assert.match(s, /invalidateReads\(\)/);
});
