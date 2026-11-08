import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createQueryService, BUS_SETTLE_MS, PERMISSION_TABLES, type BusPort } from '../service.ts';
import { STORAGE_PREFIX, type StorageLike } from '../query-cache.ts';
import {
  createReads, rpcKey, stableArgs, RPC_READS, ALL_READ_TABLES, STATS_TABLES, OWNER_PERSON_TABLES, TTL,
} from '../reads.ts';

// ---------- rig: the REAL Phase 1 service + a fake bus + a fake clock ----------
class FakeStorage implements StorageLike {
  map = new Map<string, string>();
  writes = 0;
  get length() { return this.map.size; }
  key(i: number) { return Array.from(this.map.keys())[i] ?? null; }
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.writes++; this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
}

class FakeBus implements BusPort {
  up = true;
  tables = new Map<string, Set<() => void>>();
  conn = new Set<(ok: boolean) => void>();
  resume = new Set<() => void>();
  onTable(t: string, fn: () => void) {
    let s = this.tables.get(t); if (!s) { s = new Set(); this.tables.set(t, s); }
    s.add(fn); return () => { s!.delete(fn); };
  }
  onConnection(fn: (ok: boolean) => void) { this.conn.add(fn); return () => { this.conn.delete(fn); }; }
  connected() { return this.up; }
  onResume(fn: () => void) { this.resume.add(fn); return () => { this.resume.delete(fn); }; }
  emit(t: string) { Array.from(this.tables.get(t) ?? []).forEach((f) => f()); }
}

function rig() {
  const clock = { t: 20_000_000 };
  const bus = new FakeBus();
  const storage = new FakeStorage();
  const timers: { fn: () => void; at: number; live: boolean; id: number }[] = [];
  let seq = 0;
  const svc = createQueryService({
    bus, storage, now: () => clock.t,
    schedule: (fn, ms) => { const t = { fn, at: clock.t + ms, live: true, id: ++seq }; timers.push(t); return t.id; },
    cancel: (h) => { const t = timers.find((x) => x.id === h); if (t) t.live = false; },
  });
  const advance = (ms: number) => {
    clock.t += ms;
    timers.filter((t) => t.live && t.at <= clock.t).forEach((t) => { t.live = false; t.fn(); });
  };
  const reads = createReads({ query: svc.query });
  return { svc, bus, storage, clock, advance, reads };
}

const OWNER = { uid: 'owner-1', role: 'owner', status: 'approved', scopes: [] as { church_id: string | null }[] };
const OWNER_B = { uid: 'owner-2', role: 'owner', status: 'approved', scopes: [] as { church_id: string | null }[] };
const SERVANT_PLACE_1 = {
  uid: 'srv-1', role: 'class_servant', status: 'approved',
  scopes: [{ church_id: 'c1', service_id: 's1', class_id: 'k1' }],
  activePlace: { church_id: 'c1', service_id: 's1', class_id: 'k1' },
};
const SERVANT_PLACE_2 = {
  uid: 'srv-1', role: 'class_servant', status: 'approved',
  scopes: [{ church_id: 'c2', service_id: 's2', class_id: 'k2' }],
  activePlace: { church_id: 'c2', service_id: 's2', class_id: 'k2' },
};

/** a fake supabase: every rpc / select is logged; answers come from `answer(name,args)` */
function fakeSupabase(answer: (name: string, args: Record<string, unknown>) => unknown = (n, a) => [{ n, a }]) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const gate: { hold: ((v?: unknown) => void)[] } = { hold: [] };
  let holdNext = false;
  let failNext: { message: string } | null = null;
  const client = {
    rpc(name: string, args: Record<string, unknown> = {}) {
      calls.push({ name, args });
      const err = failNext; failNext = null;
      const result = err ? { data: null, error: err } : { data: answer(name, args), error: null };
      if (holdNext) {
        holdNext = false;
        return new Promise((res) => { gate.hold.push(() => res(result)); });
      }
      return Promise.resolve(result);
    },
    from(table: string) {
      const log = { table, eq: [] as [string, unknown][], limit: 0 };
      const result = () => ({ data: answer(`from:${table}`, Object.fromEntries(log.eq)), error: null, count: 7 });
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (c: string, v: unknown) => { log.eq.push([c, v]); return b; },
        limit: (n: number) => { log.limit = n; return b; },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
          calls.push({ name: `from:${table}`, args: Object.fromEntries(log.eq) });
          return Promise.resolve(result()).then(res, rej);
        },
      };
      return b;
    },
  };
  return {
    client: client as never, calls,
    holdNext: () => { holdNext = true; },
    release: () => { gate.hold.splice(0).forEach((r) => r()); },
    failNext: (message: string) => { failNext = { message }; },
    count: (name: string) => calls.filter((c) => c.name === name).length,
  };
}

const deferredTick = () => new Promise<void>((r) => setImmediate(r));
/** identity set AND the bus settle window over → entries fetched from now on are «verified» (10 min trust) */
function ready(r: ReturnType<typeof rig>, ident: Parameters<typeof r.svc.setIdentity>[0] = OWNER) {
  r.svc.setIdentity(ident);
  r.advance(BUS_SETTLE_MS + 1);
}

const PAGE_ARGS = {
  p_search: null, p_scope_mode: 'all', p_church: null, p_service: null, p_class: null,
  p_gender: null, p_kind: 'all', p_limit: 100, p_offset: 0,
};

// =====================================================================
describe('cache keys', () => {
  test('key = rpc name + canonical args: key order and undefined do not matter, null and values do', () => {
    assert.equal(rpcKey('x', { a: 1, b: 2 }), rpcKey('x', { b: 2, a: 1 }));
    assert.equal(rpcKey('x', { a: 1, b: undefined }), rpcKey('x', { a: 1 }));
    assert.notEqual(rpcKey('x', { a: 1, b: null }), rpcKey('x', { a: 1 }));
    assert.notEqual(rpcKey('x', { a: 1 }), rpcKey('x', { a: '1' }));
    assert.notEqual(rpcKey('x', { a: 1 }), rpcKey('y', { a: 1 }));
    assert.equal(stableArgs(undefined), '{}');
    assert.equal(rpcKey('owner_persons_counts'), rpcKey('owner_persons_counts', {}));
  });

  test('arrays and nested objects are part of the key', () => {
    assert.notEqual(rpcKey('x', { a: [1, 2] }), rpcKey('x', { a: [2, 1] }));
    assert.notEqual(rpcKey('x', { a: { b: 1 } }), rpcKey('x', { a: { b: 2 } }));
  });
});

describe('registry guards', () => {
  test('only registered pure-read RPCs can be cached; every write RPC is absent', async () => {
    const { reads } = rig();
    const { client } = fakeSupabase();
    for (const w of [
      'owner_bulk_enroll', 'owner_bulk_unenroll', 'owner_bulk_delete_persons', 'owner_merge_persons',
      'owner_add_priest_for_person', 'owner_add_servant_places', 'servant_set_active_place', 'account_switch',
      'record_attendance', 'add_points', 'check_duplicate_person', 'app_bootstrap',
    ]) {
      assert.equal(Object.prototype.hasOwnProperty.call(RPC_READS, w), false, `${w} must not be registered`);
      await assert.rejects(() => reads.rpc(client, w as never, {}), /not registered/);
    }
  });

  test('the registry covers every statistics RPC, the dashboard RPCs and both owner RPCs', () => {
    const names = Object.keys(RPC_READS);
    assert.equal(names.filter((n) => n.startsWith('stats_')).length, 25);
    for (const n of ['dashboard_counts', 'pending_data_requests_count', 'owner_persons_page', 'owner_persons_counts']) assert.ok(names.includes(n), n);
  });

  test('every entry depends on the permission tables too; the union includes security-relevant ones', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase();
    await r.reads.rpc(s.client, 'owner_persons_counts');
    for (const t of PERMISSION_TABLES) {
      assert.ok(r.bus.tables.has(t), `subscribed to ${t}`);
    }
    for (const t of PERMISSION_TABLES) assert.ok(ALL_READ_TABLES.includes(t));
  });
});

// =====================================================================
describe('1 · identical concurrent calls are deduplicated', () => {
  test('3 concurrent owner_persons_page calls with the same args → ONE request', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase();
    s.holdNext();
    const all = [r.reads.rpc(s.client, 'owner_persons_page', PAGE_ARGS), r.reads.rpc(s.client, 'owner_persons_page', { ...PAGE_ARGS }), r.reads.rpc(s.client, 'owner_persons_page', PAGE_ARGS)];
    await deferredTick();
    assert.equal(s.count('owner_persons_page'), 1);
    s.release();
    const out = await Promise.all(all);
    assert.equal(s.count('owner_persons_page'), 1);
    assert.deepEqual(out[0], out[1]); assert.deepEqual(out[1], out[2]);
  });

  test('the two widgets that both read the 14-day timeline in the same tick share one request', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase();
    const args = { p_from: '2026-10-26', p_to: '2026-11-08', p_bucket: 'day', p_church: null, p_service: null, p_class: null };
    s.holdNext();
    const a = r.reads.rpc(s.client, 'stats_attendance_timeline', args, { prefixErrors: true });
    const b = r.reads.rpc(s.client, 'stats_attendance_timeline', args, { prefixErrors: true });
    await deferredTick(); s.release(); await Promise.all([a, b]);
    assert.equal(s.count('stats_attendance_timeline'), 1);
  });

  test('concurrent callers with DIFFERENT args are not merged', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase();
    await Promise.all([
      r.reads.rpc(s.client, 'owner_persons_page', { ...PAGE_ARGS, p_offset: 0 }),
      r.reads.rpc(s.client, 'owner_persons_page', { ...PAGE_ARGS, p_offset: 100 }),
    ]);
    assert.equal(s.count('owner_persons_page'), 2);
  });
});

describe('2 · identical calls reuse a valid cached result', () => {
  test('counts: second call within the TTL is served from memory', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase(() => ({ total: 3 }));
    assert.deepEqual(await r.reads.rpc(s.client, 'owner_persons_counts'), { total: 3 });
    assert.deepEqual(await r.reads.rpc(s.client, 'owner_persons_counts'), { total: 3 });
    assert.equal(s.count('owner_persons_counts'), 1);
  });

  test('an entry expires after its TTL: stats 5 min · dashboard 2 min · owner page 1 min', async () => {
    for (const [name, args, ttl] of [
      ['stats_scope_summary', { p_church: null, p_service: null, p_class: null }, TTL.stats],
      ['dashboard_counts', { p_today_start: '2026-11-07T22:00:00.000Z' }, TTL.dashboard],
      ['owner_persons_page', PAGE_ARGS, TTL.ownerPage],
    ] as const) {
      const r = rig(); ready(r);
      const s = fakeSupabase();
      await r.reads.rpc(s.client, name, args);
      r.clock.t += ttl - 1;
      await r.reads.rpc(s.client, name, args);
      assert.equal(s.count(name), 1, `${name} still fresh just before the TTL`);
      r.clock.t += 2;
      await r.reads.rpc(s.client, name, args);
      assert.equal(s.count(name), 2, `${name} refetched after the TTL`);
    }
  });

  test('no stale answer is ever served: past the TTL the call waits for fresh data', async () => {
    const r = rig(); ready(r);
    let n = 0;
    const s = fakeSupabase(() => ({ v: ++n }));
    await r.reads.rpc(s.client, 'owner_persons_counts');
    r.clock.t += TTL.ownerCounts + 1_000;
    assert.deepEqual(await r.reads.rpc(s.client, 'owner_persons_counts'), { v: 2 });
  });

  test('an entry fetched inside the 4 s identity-settle window is only trusted for the 60 s fallback TTL', async () => {
    const r = rig();
    r.svc.setIdentity(OWNER);            // settling: bus not yet trusted for this identity
    const s = fakeSupabase();
    await r.reads.rpc(s.client, 'owner_persons_counts');
    r.clock.t += 61_000;
    await r.reads.rpc(s.client, 'owner_persons_counts');
    assert.equal(s.count('owner_persons_counts'), 2);
  });

  test('while the bus is down nothing is trusted beyond 60 s', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase();
    await r.reads.rpc(s.client, 'dashboard_counts', { p_today_start: 'x' });
    r.bus.up = false; r.bus.conn.forEach((f) => f(false));
    r.clock.t += 61_000;
    await r.reads.rpc(s.client, 'dashboard_counts', { p_today_start: 'x' });
    assert.equal(s.count('dashboard_counts'), 2);
  });
});

describe('3 · different RPC parameters produce different cache entries', () => {
  test('every stats argument is part of the key (period, bucket, scope, event, kind, order, limit, day)', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase();
    const base = { p_from: '2026-10-01', p_to: '2026-10-31', p_church: null, p_service: null, p_class: null, p_event: null, p_kind: 'child' };
    const variants: Record<string, unknown>[] = [
      base,
      { ...base, p_from: '2026-10-02' },
      { ...base, p_to: '2026-11-01' },
      { ...base, p_church: 'church-1' },
      { ...base, p_service: 'service-1' },
      { ...base, p_class: 'class-1' },
      { ...base, p_event: 'event-1' },
      { ...base, p_kind: 'servant' },
      { ...base, p_kind: 'all' },
    ];
    for (const v of variants) await r.reads.rpc(s.client, 'stats_attendance_period_summary', v);
    assert.equal(s.count('stats_attendance_period_summary'), variants.length, 'each variant fetched once');
    for (const v of variants) await r.reads.rpc(s.client, 'stats_attendance_period_summary', v);
    assert.equal(s.count('stats_attendance_period_summary'), variants.length, 'and each served from its own entry');

    const ranking = { ...base, p_order: 'most', p_limit: 10 };
    await r.reads.rpc(s.client, 'stats_attendance_persons', ranking);
    await r.reads.rpc(s.client, 'stats_attendance_persons', { ...ranking, p_order: 'least' });
    await r.reads.rpc(s.client, 'stats_attendance_persons', { ...ranking, p_limit: 20 });
    assert.equal(s.count('stats_attendance_persons'), 3);

    const bucketed = { p_from: '2026-10-01', p_to: '2026-10-31', p_church: null, p_service: null, p_class: null, p_bucket: 'day' };
    await r.reads.rpc(s.client, 'stats_attendance_timeline', bucketed);
    await r.reads.rpc(s.client, 'stats_attendance_timeline', { ...bucketed, p_bucket: 'week' });
    assert.equal(s.count('stats_attendance_timeline'), 2);

    await r.reads.rpc(s.client, 'stats_day_summary', { p_day: '2026-11-01', p_church: null, p_service: null, p_class: null });
    await r.reads.rpc(s.client, 'stats_day_summary', { p_day: '2026-11-02', p_church: null, p_service: null, p_class: null });
    assert.equal(s.count('stats_day_summary'), 2);

    await r.reads.rpc(s.client, 'stats_leaderboard_scoped', { p_by: 'points', p_limit: 10, p_church: null, p_service: null, p_class: null });
    await r.reads.rpc(s.client, 'stats_leaderboard_scoped', { p_by: 'attendance', p_limit: 10, p_church: null, p_service: null, p_class: null });
    assert.equal(s.count('stats_leaderboard_scoped'), 2);
  });

  test('dashboard_counts keyed by the Cairo day start: a new day is a new entry', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase();
    await r.reads.rpc(s.client, 'dashboard_counts', { p_today_start: '2026-11-07T22:00:00.000Z' });
    await r.reads.rpc(s.client, 'dashboard_counts', { p_today_start: '2026-11-08T22:00:00.000Z' });
    assert.equal(s.count('dashboard_counts'), 2);
  });

  test('different RPC names with identical args never share an entry', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase();
    const a = { p_church: null, p_service: null, p_class: null };
    await r.reads.rpc(s.client, 'stats_scope_summary', a);
    await r.reads.rpc(s.client, 'stats_points_distribution', a);
    assert.equal(s.count('stats_scope_summary'), 1); assert.equal(s.count('stats_points_distribution'), 1);
  });
});

describe('4 · pagination and search isolation (owner_persons_page)', () => {
  test('each page is its own entry; going back to a visited page is a hit', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase((n, a) => [{ page: (a as { p_offset: number }).p_offset }]);
    const p0 = await r.reads.rpc(s.client, 'owner_persons_page', { ...PAGE_ARGS, p_offset: 0 });
    const p1 = await r.reads.rpc(s.client, 'owner_persons_page', { ...PAGE_ARGS, p_offset: 100 });
    const p2 = await r.reads.rpc(s.client, 'owner_persons_page', { ...PAGE_ARGS, p_offset: 200 });
    assert.deepEqual([p0, p1, p2], [[{ page: 0 }], [{ page: 100 }], [{ page: 200 }]]);
    assert.deepEqual(await r.reads.rpc(s.client, 'owner_persons_page', { ...PAGE_ARGS, p_offset: 100 }), [{ page: 100 }]);
    assert.equal(s.count('owner_persons_page'), 3);
  });

  test('page size matters: 20 (merge search) · 100 (list) · 500 (select-all) never share', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase((n, a) => [{ limit: (a as { p_limit: number }).p_limit }]);
    for (const limit of [20, 100, 500]) {
      assert.deepEqual(await r.reads.rpc(s.client, 'owner_persons_page', { ...PAGE_ARGS, p_limit: limit }), [{ limit }]);
    }
    assert.equal(s.count('owner_persons_page'), 3);
  });

  test('search text: each term (and null) is its own entry, case and whitespace as sent', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase((n, a) => [{ q: (a as { p_search: string | null }).p_search }]);
    const terms: (string | null)[] = [null, 'مينا', 'مينا ', 'Mina', 'mina', 'KID-1'];
    for (const t of terms) assert.deepEqual(await r.reads.rpc(s.client, 'owner_persons_page', { ...PAGE_ARGS, p_search: t }), [{ q: t }]);
    assert.equal(s.count('owner_persons_page'), terms.length);
    for (const t of terms) assert.deepEqual(await r.reads.rpc(s.client, 'owner_persons_page', { ...PAGE_ARGS, p_search: t }), [{ q: t }]);
    assert.equal(s.count('owner_persons_page'), terms.length, 'repeat → all hits');
  });

  test('kind · gender · scope mode · church · service · class are all part of the key', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase();
    const variants = [
      PAGE_ARGS,
      { ...PAGE_ARGS, p_kind: 'child' }, { ...PAGE_ARGS, p_kind: 'servant' }, { ...PAGE_ARGS, p_kind: 'priest' },
      { ...PAGE_ARGS, p_gender: 'male' }, { ...PAGE_ARGS, p_gender: 'female' },
      { ...PAGE_ARGS, p_scope_mode: 'none' },
      { ...PAGE_ARGS, p_scope_mode: 'scope', p_church: 'c1' },
      { ...PAGE_ARGS, p_scope_mode: 'scope', p_church: 'c1', p_service: 's1' },
      { ...PAGE_ARGS, p_scope_mode: 'scope', p_church: 'c1', p_service: 's1', p_class: 'k1' },
      { ...PAGE_ARGS, p_scope_mode: 'scope', p_church: 'c2' },
    ];
    for (const v of variants) await r.reads.rpc(s.client, 'owner_persons_page', v);
    assert.equal(s.count('owner_persons_page'), variants.length);
  });

  test('the exact arguments reach the database unchanged (cache never rewrites a request)', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase();
    const args = { ...PAGE_ARGS, p_search: 'x', p_offset: 300 };
    await r.reads.rpc(s.client, 'owner_persons_page', args);
    assert.deepEqual(s.calls[0].args, args);
  });
});

describe('5 · realtime events invalidate cached results', () => {
  test('owner_persons_page / counts drop on persons · enrollments · servant_enrollments · servant_scopes · servant_scope_requests · priests', async () => {
    for (const table of ['persons', 'enrollments', 'servant_enrollments', 'servant_scopes', 'servant_scope_requests', 'priests'] as const) {
      const r = rig(); ready(r);
      const s = fakeSupabase();
      await r.reads.rpc(s.client, 'owner_persons_page', PAGE_ARGS);
      await r.reads.rpc(s.client, 'owner_persons_counts');
      r.bus.emit(table);
      await r.reads.rpc(s.client, 'owner_persons_page', PAGE_ARGS);
      await r.reads.rpc(s.client, 'owner_persons_counts');
      // servant_scopes / servant_enrollments are SECURITY tables (Phase 1 clears everything on them) — still a refetch
      assert.equal(s.count('owner_persons_page'), 2, `page refetched after ${table}`);
      assert.equal(s.count('owner_persons_counts'), 2, `counts refetched after ${table}`);
    }
  });

  test('stats_* drop on attendance_log · points_log · contact_log · enrollments (the tables the stats page listens to)', async () => {
    for (const table of ['attendance_log', 'points_log', 'contact_log', 'enrollments'] as const) {
      const r = rig(); ready(r);
      const s = fakeSupabase();
      const a = { p_church: null, p_service: null, p_class: null };
      await r.reads.rpc(s.client, 'stats_scope_summary', a);
      await r.reads.rpc(s.client, 'stats_calls_summary', { p_from: 'a', p_to: 'b', ...a, p_event: null, p_kind: 'child' });
      r.bus.emit(table);
      await r.reads.rpc(s.client, 'stats_scope_summary', a);
      await r.reads.rpc(s.client, 'stats_calls_summary', { p_from: 'a', p_to: 'b', ...a, p_event: null, p_kind: 'child' });
      assert.equal(s.count('stats_scope_summary'), 2, table);
      assert.equal(s.count('stats_calls_summary'), 2, table);
    }
  });

  test('dashboard_counts drop on attendance_log / enrollments / servant_enrollments / churches / services / classes', async () => {
    for (const table of ['attendance_log', 'enrollments', 'servant_enrollments', 'churches', 'services', 'classes'] as const) {
      const r = rig(); ready(r);
      const s = fakeSupabase();
      await r.reads.rpc(s.client, 'dashboard_counts', { p_today_start: 'd' });
      r.bus.emit(table);
      await r.reads.rpc(s.client, 'dashboard_counts', { p_today_start: 'd' });
      assert.equal(s.count('dashboard_counts'), 2, table);
    }
  });

  test('an UNRELATED table message does not drop anything', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase();
    await r.reads.rpc(s.client, 'owner_persons_counts');
    await r.reads.pendingServantsCount(s.client);
    r.bus.emit('chat_messages'); r.bus.emit('store_orders'); r.bus.emit('notifications');
    await r.reads.rpc(s.client, 'owner_persons_counts');
    await r.reads.pendingServantsCount(s.client);
    assert.equal(s.count('owner_persons_counts'), 1);
    assert.equal(s.count('from:servant_enrollments'), 1);
  });

  test('a PERMISSION change drops every Phase 2 entry (activity_item_can may gate the RLS)', async () => {
    for (const table of PERMISSION_TABLES) {
      const r = rig(); ready(r);
      const s = fakeSupabase();
      await r.reads.rpc(s.client, 'owner_persons_counts');
      await r.reads.rpc(s.client, 'pending_data_requests_count');
      await r.reads.rpc(s.client, 'stats_day_summary', { p_day: 'd', p_church: null, p_service: null, p_class: null });
      r.bus.emit(table);
      await r.reads.rpc(s.client, 'owner_persons_counts');
      await r.reads.rpc(s.client, 'pending_data_requests_count');
      await r.reads.rpc(s.client, 'stats_day_summary', { p_day: 'd', p_church: null, p_service: null, p_class: null });
      assert.equal(s.count('owner_persons_counts'), 2, table);
      assert.equal(s.count('pending_data_requests_count'), 2, table);
      assert.equal(s.count('stats_day_summary'), 2, table);
    }
  });

  test('a bus message while a fetch is in flight: the late response is NOT stored as fresh', async () => {
    const r = rig(); ready(r);
    let n = 0;
    const s = fakeSupabase(() => ({ v: ++n }));
    s.holdNext();
    const first = r.reads.rpc(s.client, 'owner_persons_counts');
    await deferredTick();
    r.bus.emit('persons');                 // the change lands while the request is on the wire
    s.release();
    await first;
    assert.deepEqual(await r.reads.rpc(s.client, 'owner_persons_counts'), { v: 2 }, 'the pre-change answer was not cached');
  });

  test('the follow-up roster / attended / contacted reads each drop on their own tables only', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase(() => []);
    const scope = { church: 'c1', service: null, class: null };
    await r.reads.followUpRoster(s.client, scope);
    await r.reads.followUpAttendedIds(s.client, 'e1', '2026-11-06');
    await r.reads.followUpContactedIds(s.client, 'e1', '2026-11-06');
    assert.equal(s.calls.length, 3);

    r.bus.emit('contact_log');             // a phone call → only «contacted» refetches
    await r.reads.followUpRoster(s.client, scope);
    await r.reads.followUpAttendedIds(s.client, 'e1', '2026-11-06');
    await r.reads.followUpContactedIds(s.client, 'e1', '2026-11-06');
    assert.equal(s.calls.length, 4);

    r.bus.emit('attendance_log');          // a scan → only «attended» refetches
    await r.reads.followUpRoster(s.client, scope);
    await r.reads.followUpAttendedIds(s.client, 'e1', '2026-11-06');
    await r.reads.followUpContactedIds(s.client, 'e1', '2026-11-06');
    assert.equal(s.calls.length, 5);

    r.bus.emit('persons');                 // a name / phone edit → the roster refetches
    await r.reads.followUpRoster(s.client, scope);
    assert.equal(s.calls.length, 6);
  });

  test('invalidateReads()-style bulk drop (backup restore) removes every Phase 2 entry', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase();
    await r.reads.rpc(s.client, 'owner_persons_counts');
    await r.reads.rpc(s.client, 'stats_scope_summary', { p_church: null, p_service: null, p_class: null });
    await r.reads.pendingServantsCount(s.client);
    await r.reads.followUpRoster(s.client, { church: 'c1' });
    r.svc.invalidateTables(ALL_READ_TABLES);
    assert.equal(r.svc.cache.stats().entries, 0);
  });
});

describe('6 · user and active-place changes never reuse stale data', () => {
  test('sign-out: the next call is a pass-through (no identity → nothing cached or shared)', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase();
    await r.reads.rpc(s.client, 'owner_persons_counts');
    r.svc.suspend();
    await r.reads.rpc(s.client, 'owner_persons_counts');
    await r.reads.rpc(s.client, 'owner_persons_counts');
    assert.equal(s.count('owner_persons_counts'), 3, 'every call went to the network');
    assert.equal(r.svc.cache.stats().entries, 0);
  });

  test('account A → account B: B never receives A\'s rows', async () => {
    const r = rig(); ready(r, OWNER);
    const s = fakeSupabase();
    const aRows = await r.reads.rpc(s.client, 'owner_persons_page', PAGE_ARGS);
    r.svc.suspend();
    r.svc.setIdentity(OWNER_B); r.advance(BUS_SETTLE_MS + 1);
    let n = 0;
    const s2 = fakeSupabase(() => [{ owner: 'B', n: ++n }]);
    const bRows = await r.reads.rpc(s2.client, 'owner_persons_page', PAGE_ARGS);
    assert.equal(s2.count('owner_persons_page'), 1, 'B fetched for himself');
    assert.notDeepEqual(bRows, aRows);
    assert.deepEqual(bRows, [{ owner: 'B', n: 1 }]);
  });

  test('a late response for account A (in flight during the switch) is never stored for B', async () => {
    const r = rig(); ready(r, OWNER);
    const s = fakeSupabase(() => [{ owner: 'A' }]);
    s.holdNext();
    const late = r.reads.rpc(s.client, 'owner_persons_page', PAGE_ARGS);
    await deferredTick();
    r.svc.suspend();
    r.svc.setIdentity(OWNER_B); r.advance(BUS_SETTLE_MS + 1);
    s.release();
    await late;
    const sB = fakeSupabase(() => [{ owner: 'B' }]);
    assert.deepEqual(await r.reads.rpc(sB.client, 'owner_persons_page', PAGE_ARGS), [{ owner: 'B' }]);
    assert.equal(sB.count('owner_persons_page'), 1);
  });

  test('servant active place 1 → place 2 (same uid): every Phase 2 read is refetched, nothing leaks across places', async () => {
    const r = rig(); ready(r, SERVANT_PLACE_1);
    const s1 = fakeSupabase(() => ({ place: 1 }));
    const a = { p_church: null, p_service: null, p_class: null };
    const stats1 = await r.reads.rpc(s1.client, 'stats_scope_summary', a);
    const dash1 = await r.reads.rpc(s1.client, 'dashboard_counts', { p_today_start: 'd' });
    const roster1 = await r.reads.followUpRoster(s1.client, { church: 'c1' });
    const pending1 = await r.reads.pendingServantsCount(s1.client);
    assert.deepEqual([stats1, dash1], [{ place: 1 }, { place: 1 }]);

    r.svc.suspend();                                  // servant_set_active_place → accounts.ts suspends
    r.svc.setIdentity(SERVANT_PLACE_2); r.advance(BUS_SETTLE_MS + 1);
    const s2 = fakeSupabase((name) => (name.startsWith('from:') ? [] : { place: 2 }));
    assert.deepEqual(await r.reads.rpc(s2.client, 'stats_scope_summary', a), { place: 2 });
    assert.deepEqual(await r.reads.rpc(s2.client, 'dashboard_counts', { p_today_start: 'd' }), { place: 2 });
    await r.reads.followUpRoster(s2.client, { church: 'c1' });
    await r.reads.pendingServantsCount(s2.client);
    assert.equal(s2.calls.length, 4, 'all four reads went to the database for the new place');
    void roster1; void pending1;
  });

  test('changing the place WITHOUT a suspend (identity swap only) still empties the cache', async () => {
    const r = rig(); ready(r, SERVANT_PLACE_1);
    const s = fakeSupabase();
    await r.reads.rpc(s.client, 'dashboard_counts', { p_today_start: 'd' });
    assert.equal(r.svc.setIdentity(SERVANT_PLACE_2), true);
    assert.equal(r.svc.cache.stats().entries, 0);
  });

  test('a role / scope change over the bus (SECURITY tables) clears everything at once', async () => {
    const r = rig(); ready(r, SERVANT_PLACE_1);
    const s = fakeSupabase();
    await r.reads.rpc(s.client, 'dashboard_counts', { p_today_start: 'd' });
    await r.reads.rpc(s.client, 'stats_scope_summary', { p_church: null, p_service: null, p_class: null });
    r.bus.emit('servant_active_places');
    assert.equal(r.svc.cache.stats().entries, 0);
  });

  test('nothing about people ever reaches sessionStorage (memory only)', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase(() => [{ name: 'SECRET-NAME', phone: '01000000000' }]);
    await r.reads.rpc(s.client, 'owner_persons_page', PAGE_ARGS);
    await r.reads.rpc(s.client, 'owner_persons_counts');
    await r.reads.rpc(s.client, 'stats_leaderboard_scoped', { p_by: 'points', p_limit: 6, p_church: null, p_service: null, p_class: null });
    await r.reads.followUpRoster(s.client, { church: 'c1' });
    await r.reads.pendingServantsCount(s.client);
    assert.equal(r.storage.writes, 0);
    assert.ok(!Array.from(r.storage.map.keys()).some((k) => k.startsWith(STORAGE_PREFIX)));
  });
});

describe('7 · forced refresh bypasses cached data', () => {
  test('force: true refetches although the entry is fresh, and the new value replaces the old one', async () => {
    const r = rig(); ready(r);
    let n = 0;
    const s = fakeSupabase(() => ({ v: ++n }));
    assert.deepEqual(await r.reads.rpc(s.client, 'owner_persons_counts'), { v: 1 });
    assert.deepEqual(await r.reads.rpc(s.client, 'owner_persons_counts'), { v: 1 });
    assert.deepEqual(await r.reads.rpc(s.client, 'owner_persons_counts', {}, { force: true }), { v: 2 });
    assert.deepEqual(await r.reads.rpc(s.client, 'owner_persons_counts'), { v: 2 }, 'the forced result is what the cache now holds');
    assert.equal(s.count('owner_persons_counts'), 2);
  });

  test('force only affects its own key (another page / another RPC stays cached)', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase();
    await r.reads.rpc(s.client, 'owner_persons_page', { ...PAGE_ARGS, p_offset: 0 });
    await r.reads.rpc(s.client, 'owner_persons_page', { ...PAGE_ARGS, p_offset: 100 });
    await r.reads.rpc(s.client, 'owner_persons_counts');
    await r.reads.rpc(s.client, 'owner_persons_page', { ...PAGE_ARGS, p_offset: 0 }, { force: true });
    await r.reads.rpc(s.client, 'owner_persons_page', { ...PAGE_ARGS, p_offset: 100 });
    await r.reads.rpc(s.client, 'owner_persons_counts');
    assert.equal(s.count('owner_persons_page'), 3);
    assert.equal(s.count('owner_persons_counts'), 1);
  });

  test('force on a follow-up read / pending count / event attendance refetches too', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase(() => []);
    await r.reads.followUpRoster(s.client, { church: 'c1' });
    await r.reads.followUpAttendedIds(s.client, 'e1', 'd');
    await r.reads.followUpContactedIds(s.client, 'e1', 'd');
    await r.reads.pendingServantsCount(s.client);
    await r.reads.eventAttendanceCount(s.client, 'e1', 'd');
    assert.equal(s.calls.length, 5);
    await r.reads.followUpRoster(s.client, { church: 'c1' }, { force: true });
    await r.reads.followUpAttendedIds(s.client, 'e1', 'd', { force: true });
    await r.reads.followUpContactedIds(s.client, 'e1', 'd', { force: true });
    await r.reads.pendingServantsCount(s.client, { force: true });
    await r.reads.eventAttendanceCount(s.client, 'e1', 'd', { force: true });
    assert.equal(s.calls.length, 10);
  });

  test('bypass: reads nothing from the cache, writes nothing to it, never shares an in-flight request', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase();
    await r.reads.rpc(s.client, 'owner_persons_page', PAGE_ARGS);                    // cached
    await r.reads.rpc(s.client, 'owner_persons_page', PAGE_ARGS, { bypass: true });  // goes out anyway
    assert.equal(s.count('owner_persons_page'), 2);
    const before = r.svc.cache.stats().entries;
    await r.reads.rpc(s.client, 'owner_persons_page', { ...PAGE_ARGS, p_limit: 500 }, { bypass: true });
    assert.equal(r.svc.cache.stats().entries, before, 'a bypassed call stores nothing');
  });

  test('force during an in-flight request starts a new one and only the NEWER result is stored', async () => {
    const r = rig(); ready(r);
    let n = 0;
    const s = fakeSupabase(() => ({ v: ++n }));
    s.holdNext();
    const slow = r.reads.rpc(s.client, 'owner_persons_counts');
    await deferredTick();
    const forced = await r.reads.rpc(s.client, 'owner_persons_counts', {}, { force: true });
    assert.deepEqual(forced, { v: 2 });
    s.release(); await slow;
    assert.deepEqual(await r.reads.rpc(s.client, 'owner_persons_counts'), { v: 2 });
  });
});

describe('errors, loading behaviour and result isolation', () => {
  test('an error is thrown exactly as before and is NEVER cached; the next call retries', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase(() => [{ ok: 1 }]);
    s.failNext('permission denied');
    await assert.rejects(() => r.reads.rpc(s.client, 'owner_persons_page', PAGE_ARGS), (e: unknown) => (e as { message: string }).message === 'permission denied');
    assert.deepEqual(await r.reads.rpc(s.client, 'owner_persons_page', PAGE_ARGS), [{ ok: 1 }]);
    assert.equal(s.count('owner_persons_page'), 2);
  });

  test('prefixErrors reproduces lib/stats.ts: Error("<rpc>: <message>")', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase();
    s.failNext('boom');
    await assert.rejects(
      () => r.reads.rpc(s.client, 'stats_scope_summary', { p_church: null, p_service: null, p_class: null }, { prefixErrors: true }),
      (e: unknown) => e instanceof Error && e.message === 'stats_scope_summary: boom',
    );
  });

  test('concurrent callers of a failing request all fail, none is cached, the retry succeeds', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase();
    s.failNext('timeout'); s.holdNext();
    const a = r.reads.rpc(s.client, 'dashboard_counts', { p_today_start: 'd' }).catch((e) => `E:${e.message}`);
    const b = r.reads.rpc(s.client, 'dashboard_counts', { p_today_start: 'd' }).catch((e) => `E:${e.message}`);
    await deferredTick(); s.release();
    assert.deepEqual(await Promise.all([a, b]), ['E:timeout', 'E:timeout']);
    assert.equal(s.count('dashboard_counts'), 1);
    await r.reads.rpc(s.client, 'dashboard_counts', { p_today_start: 'd' });
    assert.equal(s.count('dashboard_counts'), 2);
  });

  test('rpcSoft: an error or an empty answer yields null and is never cached (owner counts keep their old behaviour)', async () => {
    const r = rig(); ready(r);
    let mode: 'err' | 'null' | 'ok' = 'err';
    const s = fakeSupabase(() => (mode === 'ok' ? { total: 9 } : null));
    s.failNext('denied');
    assert.equal(await r.reads.rpcSoft(s.client, 'owner_persons_counts'), null);
    mode = 'null';
    assert.equal(await r.reads.rpcSoft(s.client, 'owner_persons_counts'), null);   // a non-owner gets null from the RPC
    mode = 'ok';
    assert.deepEqual(await r.reads.rpcSoft(s.client, 'owner_persons_counts'), { total: 9 });
    assert.equal(s.count('owner_persons_counts'), 3, 'null / error answers were not cached');
    assert.deepEqual(await r.reads.rpcSoft(s.client, 'owner_persons_counts'), { total: 9 });
    assert.equal(s.count('owner_persons_counts'), 3);
  });

  test('helper reads keep the old «ignore the error» result and cache nothing', async () => {
    const r = rig(); ready(r);
    const broken = {
      from: () => { const b: Record<string, unknown> = { select: () => b, eq: () => b, limit: () => b, then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'x' }, count: null }).then(res) }; return b; },
    } as never;
    assert.equal(await r.reads.pendingServantsCount(broken), 0);
    assert.deepEqual(await r.reads.followUpRoster(broken, { church: 'c1' }), []);
    assert.deepEqual(await r.reads.followUpAttendedIds(broken, 'e', 'd'), []);
    assert.deepEqual(await r.reads.followUpContactedIds(broken, 'e', 'd'), []);
    assert.equal(await r.reads.eventAttendanceCount(broken, 'e', 'd'), 0);
    assert.equal(r.svc.cache.stats().entries, 0);
  });

  test('a caller that mutates its result cannot change what the next caller gets', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase(() => [{ id: 1, tags: ['a'] }, { id: 2, tags: [] as string[] }]);
    const first = (await r.reads.rpc(s.client, 'owner_persons_page', PAGE_ARGS)) as { id: number; tags: string[] }[];
    first.reverse(); first[0].tags.push('MUTATED'); first.length = 0;
    const second = (await r.reads.rpc(s.client, 'owner_persons_page', PAGE_ARGS)) as { id: number; tags: string[] }[];
    assert.equal(s.count('owner_persons_page'), 1);
    assert.deepEqual(second, [{ id: 1, tags: ['a'] }, { id: 2, tags: [] }]);
  });
});

describe('dashboard + follow-up helpers: keys', () => {
  test('roster key carries church · service · class and the limit; attended / contacted carry event + day', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase(() => []);
    await r.reads.followUpRoster(s.client, { church: 'c1', service: null, class: null });
    await r.reads.followUpRoster(s.client, { church: 'c1', service: 's1', class: null });
    await r.reads.followUpRoster(s.client, { church: 'c1', service: 's1', class: 'k1' });
    await r.reads.followUpRoster(s.client, { church: 'c2', service: null, class: null });
    assert.equal(s.calls.length, 4);
    await r.reads.followUpAttendedIds(s.client, 'e1', '2026-11-06');
    await r.reads.followUpAttendedIds(s.client, 'e1', '2026-11-13');
    await r.reads.followUpAttendedIds(s.client, 'e2', '2026-11-06');
    assert.equal(s.calls.length, 7);
    await r.reads.followUpContactedIds(s.client, 'e1', '2026-11-06');
    await r.reads.followUpContactedIds(s.client, 'e1', '2026-11-06');
    assert.equal(s.calls.length, 8);
  });

  test('the query filters are the ones the widget always used', async () => {
    const r = rig(); ready(r);
    const s = fakeSupabase(() => []);
    await r.reads.followUpRoster(s.client, { church: 'c1', service: 's1', class: 'k1' });
    assert.deepEqual(s.calls[0].args, { church_id: 'c1', service_id: 's1', class_id: 'k1' });
    await r.reads.followUpAttendedIds(s.client, 'e1', '2026-11-06');
    assert.deepEqual(s.calls[1].args, { event_id: 'e1', attended_on: '2026-11-06' });
    await r.reads.followUpContactedIds(s.client, 'e1', '2026-11-06');
    assert.deepEqual(s.calls[2].args, { event_id: 'e1', occurrence_on: '2026-11-06' });
  });

  test('dependency tables are what each read really touches (documented, asserted)', () => {
    for (const t of ['attendance_log', 'points_log', 'contact_log', 'enrollments', 'persons', 'events', 'causes', 'call_feedbacks', 'classes', 'services', 'churches', 'servant_enrollments']) {
      assert.ok((STATS_TABLES as readonly string[]).includes(t), `stats depends on ${t}`);
    }
    for (const t of ['persons', 'enrollments', 'servant_enrollments', 'servant_scopes', 'servant_scope_requests', 'priests', 'person_credentials']) {
      assert.ok((OWNER_PERSON_TABLES as readonly string[]).includes(t), `owner persons depend on ${t}`);
    }
  });

  test('owner_persons_page has the shortest TTL (person_credentials has no bus trigger)', () => {
    assert.ok(TTL.ownerPage <= TTL.ownerCounts && TTL.ownerPage <= TTL.dashboard && TTL.ownerPage < TTL.stats);
  });
});
