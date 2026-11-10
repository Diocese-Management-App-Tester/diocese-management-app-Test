// Phase 4 — scanner roster. Real roster code, fake bus / clock / server table.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createScannerRoster, identifyScan, scopeKey, ROSTER_TTL_MS, ROSTER_IDLE_MS, ROSTER_MAX_ROWS,
  type RosterRow, type RosterBusMessage, type RosterScope,
} from '../roster.ts';
import { SECURITY_TABLES } from '../service.ts';

interface Row extends RosterRow { name: string; points: number }
const SCOPE_K1: RosterScope = { church: 'c1', service: 's1', class: 'k1' };
const SCOPE_ALL: RosterScope = { church: 'all', service: 'all', class: 'all' };

function mk(i: number, o: Partial<Row> = {}): Row {
  return {
    id: `e${i}`, person_id: `p${i}`, church_id: 'c1', service_id: 's1', class_id: 'k1', status: 'active',
    created_at: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z`, name: `kid ${i}`, points: 0,
    person: { id: `p${i}`, national_id: `n${i}` }, ...o,
  };
}

const tick = () => new Promise<void>((r) => setImmediate(r));
async function settle(n = 6) { for (let i = 0; i < n; i++) await tick(); }

function setup(rows: Row[], envOver: Record<string, unknown> = {}) {
  const clock = { t: 5_000_000 };
  const timers: { fn: () => void; at: number; id: number; live: boolean }[] = [];
  let seq = 0;
  const server = { rows: [...rows], pages: 0, byIds: 0, rpc: 0, failPages: false, failByIds: false, gate: null as Promise<void> | null };
  const tables = new Map<string, Set<(m: RosterBusMessage) => void>>();
  const trust = new Set<(ok: boolean) => void>(); const resume = new Set<() => void>(); const ident = new Set<(ns: string | null) => void>();
  const state = { ns: 'ns-a' as string | null, trusted: true };
  const inScope = (sc: RosterScope, r: Row) =>
    (!sc.church || sc.church === 'all' || r.church_id === sc.church) && (!sc.service || sc.service === 'all' || r.service_id === sc.service) && (!sc.class || sc.class === 'all' || r.class_id === sc.class);
  const roster = createScannerRoster<Row, string>({
    fetchPage: async (_c, scope, page, size) => {
      server.pages++;
      if (server.gate) await server.gate;
      if (server.failPages) throw new Error('offline');
      const list = server.rows.filter((r) => inScope(scope, r)).sort((a, b) => (a.class_id + a.name + a.id < b.class_id + b.name + b.id ? -1 : 1)).slice(page * size, page * size + size + 1);
      return { rows: list.length > size ? list.slice(0, size) : list, hasMore: list.length > size };
    },
    fetchByIds: async (_c, ids) => { server.byIds++; if (server.failByIds) throw new Error('offline'); return server.rows.filter((r) => ids.includes(r.id)); },
    namespace: () => state.ns,
    trusted: () => state.trusted,
    bus: {
      onTable: (t, fn) => { let s = tables.get(t); if (!s) { s = new Set(); tables.set(t, s); } s.add(fn); return () => { s!.delete(fn); }; },
      onTrust: (fn) => { trust.add(fn); return () => { trust.delete(fn); }; },
      onResume: (fn) => { resume.add(fn); return () => { resume.delete(fn); }; },
      onIdentity: (fn) => { ident.add(fn); return () => { ident.delete(fn); }; },
    },
    now: () => clock.t,
    schedule: (fn, ms) => { const t = { fn, at: clock.t + ms, id: ++seq, live: true }; timers.push(t); return t.id; },
    cancel: (h) => { const t = timers.find((x) => x.id === h); if (t) t.live = false; },
    ...envOver,
  });
  const advance = async (ms: number) => { clock.t += ms; timers.filter((t) => t.live && t.at <= clock.t).forEach((t) => { t.live = false; t.fn(); }); await settle(); };
  const emit = (table: string, m: RosterBusMessage) => Array.from(tables.get(table) ?? []).forEach((f) => f(m));
  const setTrust = (ok: boolean) => { state.trusted = ok; Array.from(trust).forEach((f) => f(ok)); };
  const setIdentity = (ns: string | null) => { state.ns = ns; Array.from(ident).forEach((f) => f(ns)); };
  const fireResume = () => Array.from(resume).forEach((f) => f());
  const listeners = () => { let n = 0; tables.forEach((s) => { n += s.size; }); return n + trust.size + resume.size + ident.size; };
  /** the existing server RPC: all enrollments of the person (any scope) — RLS ignored in this fake */
  const rpc = (nid: string) => { server.rpc++; return Promise.resolve({ data: server.rows.filter((r) => r.person.national_id === nid).sort((a, b) => (a.created_at ?? '') < (b.created_at ?? '') ? -1 : 1), error: null as unknown }); };
  return { roster, server, clock, advance, emit, setTrust, setIdentity, fireResume, state, rpc, listeners };
}
const inK1 = (r: Row) => r.class_id === 'k1';

describe('initial roster loading', () => {
  test('loads the scope once, indexes it, and resolves valid scans locally (zero server calls)', async () => {
    const t = setup(Array.from({ length: 40 }, (_, i) => mk(i)));
    assert.equal(await t.roster.load('c', SCOPE_K1), 'ready');
    assert.equal(t.roster.size, 40);
    assert.equal(t.server.pages, 1);
    for (let i = 0; i < 40; i++) {
      const r = await identifyScan(t.roster, 'c', `n${i}`, SCOPE_K1, inK1, t.rpc);
      assert.equal(r.source, 'local');
      assert.equal(r.rows[0].id, `e${i}`);
    }
    assert.equal(t.server.rpc, 0);
  });

  test('a second load of the same scope while ready is free; concurrent loads share one fetch', async () => {
    const t = setup([mk(1)]);
    let release!: () => void; t.server.gate = new Promise<void>((r) => { release = r; });
    const a = t.roster.load('c', SCOPE_K1); const b = t.roster.load('c', SCOPE_K1);
    release(); await Promise.all([a, b]);
    assert.equal(t.server.pages, 1);
    await t.roster.load('c', SCOPE_K1);
    assert.equal(t.server.pages, 1);
    assert.equal(t.roster.stats.loads, 1);
  });

  test('while loading, scans fall back to the server (the scanner is never blocked)', async () => {
    const t = setup([mk(1)]);
    let release!: () => void; t.server.gate = new Promise<void>((r) => { release = r; });
    const p = t.roster.load('c', SCOPE_K1);
    const r = await identifyScan(t.roster, 'c', 'n1', SCOPE_K1, inK1, t.rpc);
    assert.equal(r.source, 'server'); assert.equal(r.source === 'server' && r.reason, 'no-roster');
    release(); await p;
  });

  test('no load without an identity, and none while the bus is not trusted', async () => {
    const t = setup([mk(1)]);
    t.state.ns = null;
    assert.equal(await t.roster.load('c', SCOPE_K1), 'skipped');
    t.state.ns = 'ns-a'; t.state.trusted = false;
    assert.equal(await t.roster.load('c', SCOPE_K1), 'waiting');
    assert.equal(t.server.pages, 0);
  });

  test('a load deferred by an untrusted bus starts by itself when trust arrives', async () => {
    const t = setup([mk(1)]);
    t.state.trusted = false;
    await t.roster.load('c', SCOPE_K1);
    t.setTrust(true); await settle();
    assert.equal(t.roster.state, 'ready');
    assert.equal(t.server.pages, 1);
  });
});

describe('unknown / invalid identifiers → existing server path', () => {
  test('an unknown id asks the server, keeps the server’s error/empty handling, and is NOT remembered', async () => {
    const t = setup([mk(1)]);
    await t.roster.load('c', SCOPE_K1);
    const a = await identifyScan(t.roster, 'c', 'nope', SCOPE_K1, inK1, t.rpc);
    const b = await identifyScan(t.roster, 'c', 'nope', SCOPE_K1, inK1, t.rpc);
    assert.deepEqual([a.source, b.source], ['server', 'server']);
    assert.equal(a.rows.length, 0);
    assert.equal(t.server.rpc, 2, 'no negative cache');
  });

  test('an id the roster does not hold but the server does (person added elsewhere) is served by the server and triggers a roster reload', async () => {
    const t = setup([mk(1)]);
    await t.roster.load('c', SCOPE_K1);
    t.server.rows.push(mk(2));                    // missed by the roster (no bus message)
    const r = await identifyScan(t.roster, 'c', 'n2', SCOPE_K1, inK1, t.rpc);
    assert.equal(r.source, 'server'); assert.equal(r.rows[0].id, 'e2');
    await t.advance(3_000);
    assert.equal(t.roster.size, 2, 'reloaded');
    assert.equal((await identifyScan(t.roster, 'c', 'n2', SCOPE_K1, inK1, t.rpc)).source, 'local');
  });

  test('reloads caused by server-only people are rate limited (a bad QR stream cannot hammer the API)', async () => {
    const t = setup([mk(1)]);
    await t.roster.load('c', SCOPE_K1);
    for (let i = 2; i < 12; i++) { t.server.rows.push(mk(i)); await identifyScan(t.roster, 'c', `n${i}`, SCOPE_K1, inK1, t.rpc); await t.advance(3_000); }
    assert.ok(t.roster.stats.loads <= 2, `loads=${t.roster.stats.loads}`);
  });

  test('an id of another class (server returns rows out of scope) changes nothing and does not reload', async () => {
    const t = setup([mk(1), mk(2, { class_id: 'k2' })]);
    await t.roster.load('c', SCOPE_K1);
    const r = await identifyScan(t.roster, 'c', 'n2', SCOPE_K1, inK1, t.rpc);
    assert.equal(r.source, 'server'); assert.equal(r.rows.length, 1);       // the page then says «غير مسجل في النطاق المختار»
    await t.advance(10_000);
    assert.equal(t.roster.stats.loads, 1);
  });

  test('empty, oversized and control-character ids always go to the server', async () => {
    const t = setup([mk(1)]);
    await t.roster.load('c', SCOPE_K1);
    for (const bad of ['', 'x'.repeat(129), 'n1\n', 'n1\u0000', '\u007fn1']) {
      const r = await identifyScan(t.roster, 'c', bad, SCOPE_K1, inK1, t.rpc);
      assert.equal(r.source, 'server', JSON.stringify(bad));
    }
    assert.equal(t.server.rpc, 5);
  });

  test('a server error is reported as an error (the page shows its existing message) and nothing is learned', async () => {
    const t = setup([mk(1)]);
    await t.roster.load('c', SCOPE_K1);
    const r = await identifyScan(t.roster, 'c', 'zzz', SCOPE_K1, inK1, async () => ({ data: null, error: new Error('rls') }));
    assert.equal(r.source, 'server'); assert.equal(r.source === 'server' && r.error, true);
  });
});

describe('duplicate and simultaneous scans stay server-decided', () => {
  /** minimal page: identify → insert into a table with the real unique index (enrollment, event, day) */
  function pageScan(t: ReturnType<typeof setup>, attendance: Set<string>, writes: { n: number }) {
    return async (nid: string): Promise<'ok' | 'dup' | 'unknown'> => {
      const id = await identifyScan(t.roster, 'c', nid, SCOPE_K1, inK1, t.rpc);
      const e = id.rows[0]; if (!e) return 'unknown';
      writes.n++;
      const key = `${e.id}|ev1|2026-01-01`;
      if (attendance.has(key)) return 'dup';                // server: unique index → 23505
      attendance.add(key); return 'ok';
    };
  }
  test('scanning the same person twice: the first is identified locally, the repeat goes to the server, and the SERVER says duplicate', async () => {
    const t = setup([mk(1)]); await t.roster.load('c', SCOPE_K1);
    const att = new Set<string>(); const w = { n: 0 }; const scan = pageScan(t, att, w);
    assert.equal(await scan('n1'), 'ok');
    assert.equal(t.server.rpc, 0);
    assert.equal(await scan('n1'), 'dup');
    assert.equal(t.server.rpc, 1, 'repeat scan was NOT answered from the roster');
    assert.equal(w.n, 2, 'both attempts reached the write path (the server rejected the second)');
  });

  test('two simultaneous scans of the same person: one local, one server; exactly one is accepted', async () => {
    const t = setup([mk(1)]); await t.roster.load('c', SCOPE_K1);
    const att = new Set<string>(); const w = { n: 0 }; const scan = pageScan(t, att, w);
    const res = await Promise.all([scan('n1'), scan('n1')]);
    assert.deepEqual([...res].sort(), ['dup', 'ok']);
    assert.equal(t.server.rpc, 1);
  });

  test('many simultaneous scans of different people are all local and independent', async () => {
    const t = setup(Array.from({ length: 50 }, (_, i) => mk(i))); await t.roster.load('c', SCOPE_K1);
    const att = new Set<string>(); const w = { n: 0 }; const scan = pageScan(t, att, w);
    const res = await Promise.all(Array.from({ length: 50 }, (_, i) => scan(`n${i}`)));
    assert.ok(res.every((x) => x === 'ok'));
    assert.equal(t.server.rpc, 0);
  });

  test('a person whose row a write touched (bus UPDATE after the insert) is dirty until the roster reloads', async () => {
    const t = setup([mk(1)]); await t.roster.load('c', SCOPE_K1);
    t.emit('enrollments', { op: 'UPDATE', ids: ['e1'], n: 1 });
    const r = await identifyScan(t.roster, 'c', 'n1', SCOPE_K1, inK1, t.rpc);
    assert.equal(r.source, 'server'); assert.equal(r.source === 'server' && r.reason, 'dirty');
  });

  test('the roster never stores attendance, points or write results: its public surface has no such state', () => {
    const t = setup([mk(1)]);
    const keys = Object.keys(t.roster).sort();
    assert.deepEqual(keys, ['dispose', 'learn', 'load', 'markUsed', 'refreshIfNeeded', 'release', 'resolve', 'size', 'state', 'stats', 'verified']);
  });
});

describe('offline / failed loading', () => {
  test('a failed load leaves no roster (scans use the server), is retried only after the retry gap', async () => {
    const t = setup([mk(1)]); t.server.failPages = true;
    assert.equal(await t.roster.load('c', SCOPE_K1), 'failed');
    assert.equal((await identifyScan(t.roster, 'c', 'n1', SCOPE_K1, inK1, t.rpc)).source, 'server');
    const n = t.server.pages;
    assert.equal(await t.roster.load('c', SCOPE_K1), 'failed');            // inside the gap → no request
    assert.equal(t.server.pages, n);
    t.server.failPages = false; await t.advance(16_000);
    assert.equal(await t.roster.load('c', SCOPE_K1), 'ready');
  });

  test('losing the bus makes every local hit stop immediately (offline scans go to the server path)', async () => {
    const t = setup([mk(1)]); await t.roster.load('c', SCOPE_K1);
    assert.equal((await identifyScan(t.roster, 'c', 'n1', SCOPE_K1, inK1, async () => ({ data: [], error: null }))).source, 'local');
    t.setTrust(false);
    const r = await identifyScan(t.roster, 'c', 'n1', SCOPE_K1, inK1, t.rpc);
    assert.equal(r.source, 'server'); assert.equal(r.source === 'server' && r.reason, 'untrusted');
  });

  test('reconnection reloads the roster (messages may have been missed) and local hits resume', async () => {
    const t = setup([mk(1)]); await t.roster.load('c', SCOPE_K1);
    t.setTrust(false);
    t.server.rows.push(mk(2));                                              // changed while offline
    const pagesBefore = t.server.pages;
    t.setTrust(true); await settle(); await t.advance(3_000);
    assert.ok(t.server.pages > pagesBefore);
    assert.equal(t.roster.size, 2);
    assert.equal((await identifyScan(t.roster, 'c', 'n2', SCOPE_K1, inK1, t.rpc)).source, 'local');
  });

  test('a drop that happens DURING a load means the result is not trusted for local hits until a clean load', async () => {
    const t = setup([mk(1)]);
    let release!: () => void; t.server.gate = new Promise<void>((r) => { release = r; });
    const p = t.roster.load('c', SCOPE_K1);
    t.setTrust(false); t.server.gate = null; release(); await p;
    assert.equal(t.roster.verified, false);
    assert.equal((await identifyScan(t.roster, 'c', 'n1', SCOPE_K1, inK1, t.rpc)).source, 'server');
  });

  test('an offline server RPC during fallback is an error result, not a crash', async () => {
    const t = setup([]); await t.roster.load('c', SCOPE_K1);
    const r = await identifyScan(t.roster, 'c', 'n9', SCOPE_K1, inK1, async () => ({ data: null, error: { message: 'Failed to fetch' } }));
    assert.equal(r.source === 'server' && r.error, true);
  });

  test('resume (long suspension / manual refresh) drops trust and reloads', async () => {
    const t = setup([mk(1)]); await t.roster.load('c', SCOPE_K1);
    t.server.rows.push(mk(2));
    t.fireResume(); await settle(); await t.advance(3_000);
    assert.equal(t.roster.size, 2);
  });

  test('entries expire after the TTL: the next scan is server-served and refreshes the roster', async () => {
    const t = setup([mk(1)]); await t.roster.load('c', SCOPE_K1);
    t.clock.t += ROSTER_TTL_MS + 1;
    const r = await identifyScan(t.roster, 'c', 'n1', SCOPE_K1, inK1, t.rpc);
    assert.equal(r.source, 'server'); assert.equal(r.source === 'server' && r.reason, 'expired');
    await settle();
    assert.equal(t.roster.stats.loads, 2);
  });
});

describe('roster refresh from bus events', () => {
  test('UPDATE of a held row → that person goes to the server; others stay local', async () => {
    const t = setup([mk(1), mk(2)]); await t.roster.load('c', SCOPE_K1);
    t.emit('enrollments', { op: 'UPDATE', ids: ['e1'], n: 1 });
    assert.equal((await identifyScan(t.roster, 'c', 'n1', SCOPE_K1, inK1, t.rpc)).source, 'server');
    assert.equal((await identifyScan(t.roster, 'c', 'n2', SCOPE_K1, inK1, t.rpc)).source, 'local');
  });

  test('persons UPDATE (rename / new national id) → that person goes to the server', async () => {
    const t = setup([mk(1), mk(2)]); await t.roster.load('c', SCOPE_K1);
    t.emit('persons', { op: 'UPDATE', ids: ['p1'], n: 1 });
    assert.equal((await identifyScan(t.roster, 'c', 'n1', SCOPE_K1, inK1, t.rpc)).source, 'server');
    assert.equal((await identifyScan(t.roster, 'c', 'n2', SCOPE_K1, inK1, t.rpc)).source, 'local');
  });

  test('INSERT blocks local hits until the new rows are fetched (one by-ids request), then they resolve locally', async () => {
    const t = setup([mk(1)]); await t.roster.load('c', SCOPE_K1);
    t.server.rows.push(mk(2));
    t.emit('enrollments', { op: 'INSERT', ids: ['e2'], n: 1 });
    const blocked = await identifyScan(t.roster, 'c', 'n1', SCOPE_K1, inK1, t.rpc);
    assert.equal(blocked.source === 'server' && blocked.reason, 'blocked');
    await t.advance(300);
    assert.equal(t.server.byIds, 1);
    assert.equal((await identifyScan(t.roster, 'c', 'n2', SCOPE_K1, inK1, t.rpc)).source, 'local');
    // the earlier blocked n1 scan was served by the server (never marked used), so n1 is local again
    assert.equal((await identifyScan(t.roster, 'c', 'n1', SCOPE_K1, inK1, t.rpc)).source, 'local');
    // …but a repeat scan of n2 right after a local hit is server-fresh
    assert.equal((await identifyScan(t.roster, 'c', 'n2', SCOPE_K1, inK1, t.rpc)).source, 'server');
  });

  test('a burst of INSERTs is coalesced into one by-ids request', async () => {
    const t = setup([mk(1)]); await t.roster.load('c', SCOPE_K1);
    for (let i = 2; i < 12; i++) { t.server.rows.push(mk(i)); t.emit('enrollments', { op: 'INSERT', ids: [`e${i}`], n: 1 }); }
    await t.advance(300);
    assert.equal(t.server.byIds, 1); assert.equal(t.roster.size, 11);
  });

  test('if the by-ids fetch fails the roster is invalidated and reloaded (never left blocked forever)', async () => {
    const t = setup([mk(1)]); await t.roster.load('c', SCOPE_K1);
    t.server.rows.push(mk(2)); t.server.failByIds = true;
    t.emit('enrollments', { op: 'INSERT', ids: ['e2'], n: 1 });
    await t.advance(300); await t.advance(3_000);
    assert.equal(t.roster.size, 2);
    assert.equal((await identifyScan(t.roster, 'c', 'n2', SCOPE_K1, inK1, t.rpc)).source, 'local');
  });

  test('DELETE removes the row: the id becomes unknown and the server decides', async () => {
    const t = setup([mk(1)]); await t.roster.load('c', SCOPE_K1);
    t.server.rows = [];
    t.emit('enrollments', { op: 'DELETE', ids: ['e1'], n: 1 });
    assert.equal(t.roster.size, 0);
    const r = await identifyScan(t.roster, 'c', 'n1', SCOPE_K1, inK1, t.rpc);
    assert.equal(r.source === 'server' && r.reason, 'unknown'); assert.equal(r.rows.length, 0);
  });

  test('a bulk message (no ids, or n > ids) invalidates and reloads', async () => {
    const t = setup([mk(1)]); await t.roster.load('c', SCOPE_K1);
    t.server.rows.push(mk(2));
    t.emit('enrollments', { op: 'UPDATE', n: 800 });
    assert.equal(t.roster.verified, false);
    await t.advance(3_000);
    assert.equal(t.roster.size, 2);
    t.emit('enrollments', { op: 'UPDATE', ids: Array.from({ length: 50 }, (_, i) => `e${i}`), n: 300 });
    assert.equal(t.roster.verified, false);
  });

  test('an UPDATE of a row the roster does not hold (moved into a multi-class scope) is fetched, not ignored', async () => {
    const t = setup([mk(1), mk(2, { class_id: 'k2' })]); await t.roster.load('c', { church: 'c1', service: 's1', class: 'all' });
    assert.equal(t.roster.size, 2);
    t.server.rows.push(mk(3)); t.emit('enrollments', { op: 'UPDATE', ids: ['e3'], n: 1 });
    await t.advance(3_000);
    assert.equal(t.roster.size, 3);
  });

  test('security-table messages (scopes / active place) empty the roster and reload', async () => {
    for (const tb of SECURITY_TABLES) {
      const t = setup([mk(1)]); await t.roster.load('c', SCOPE_K1);
      t.server.rows = [mk(7)];
      t.emit(tb, { op: 'UPDATE', ids: ['x'], n: 1 });
      assert.equal(t.roster.size, 0, tb);
      assert.equal((await identifyScan(t.roster, 'c', 'n1', SCOPE_K1, inK1, async () => ({ data: [], error: null }))).source, 'server');
      await t.advance(3_000);
      assert.equal(t.roster.size, 1, tb);
    }
  });

  test('event-driven reloads are spaced (a stream of bulk messages cannot hammer the API)', async () => {
    const t = setup([mk(1)]); await t.roster.load('c', SCOPE_K1);
    for (let i = 0; i < 10; i++) { t.emit('enrollments', { op: 'UPDATE', n: 900 }); await t.advance(100); }
    await t.advance(3_000);
    assert.ok(t.roster.stats.loads <= 3, `loads=${t.roster.stats.loads}`);
  });
});

describe('scope switching', () => {
  test('a different scope is a different roster: the old one is not used for it, and the new one loads', async () => {
    const t = setup([mk(1), mk(2, { class_id: 'k2', service_id: 's2' })]);
    await t.roster.load('c', SCOPE_K1);
    const k2: RosterScope = { church: 'c1', service: 's2', class: 'k2' };
    const r0 = await identifyScan(t.roster, 'c', 'n1', k2, (r) => r.class_id === 'k2', t.rpc);
    assert.equal(r0.source === 'server' && r0.reason, 'scope');
    await t.roster.load('c', k2);
    assert.equal(t.roster.size, 1);
    assert.equal((await identifyScan(t.roster, 'c', 'n2', k2, (r) => r.class_id === 'k2', t.rpc)).source, 'local');
    assert.equal((await identifyScan(t.roster, 'c', 'n1', k2, (r) => r.class_id === 'k2', t.rpc)).source, 'server');
  });

  test('switching scope while the previous load is in flight discards the old answer', async () => {
    const t = setup([mk(1), mk(2, { class_id: 'k2' })]);
    let release!: () => void; t.server.gate = new Promise<void>((r) => { release = r; });
    const first = t.roster.load('c', SCOPE_K1);
    const second = t.roster.load('c', { church: 'c1', service: 's1', class: 'k2' });
    t.server.gate = null; release();
    assert.equal(await first, 'stale'); assert.equal(await second, 'ready');
    assert.equal(t.roster.size, 1);
    assert.equal(scopeKey({ church: 'c1', service: 's1', class: 'k2' }), 'c1/s1/k2');
  });

  test('a scan whose scope differs from the roster’s (selectors changed, effect not run yet) is never answered locally', async () => {
    const t = setup([mk(1)]); await t.roster.load('c', SCOPE_K1);
    const r = await identifyScan(t.roster, 'c', 'n1', SCOPE_ALL, inK1, t.rpc);
    assert.equal(r.source, 'server');
  });

  test('a person enrolled in several classes: the local answer equals the server answer after the scope filter, in the same order', async () => {
    const rows = [mk(1, { class_id: 'k1', created_at: '2026-02-01T00:00:00Z', id: 'ea' }), mk(1, { class_id: 'k2', created_at: '2026-01-01T00:00:00Z', id: 'eb' }), mk(1, { class_id: 'k3', service_id: 's9', created_at: '2026-03-01T00:00:00Z', id: 'ec' })];
    const sc: RosterScope = { church: 'c1', service: 's1', class: 'all' };
    const t = setup(rows); await t.roster.load('c', sc);
    const inSc = (r: Row) => r.service_id === 's1';
    const local = await identifyScan(t.roster, 'c', 'n1', sc, inSc, t.rpc);
    const server = (await t.rpc('n1')).data.filter(inSc);
    assert.equal(local.source, 'local');
    assert.deepEqual(local.rows.map((r) => r.id), server.map((r) => r.id));
  });

  test('release() keeps the roster for a quick return, then drops it and its listeners after the idle time', async () => {
    const t = setup([mk(1)]); await t.roster.load('c', SCOPE_K1);
    assert.ok(t.listeners() > 0);
    t.roster.release();
    await t.advance(ROSTER_IDLE_MS - 1_000); assert.equal(t.roster.size, 1);
    await t.roster.load('c', SCOPE_K1);                  // came back → idle timer cancelled
    await t.advance(ROSTER_IDLE_MS + 1_000); assert.equal(t.roster.size, 1);
    t.roster.release(); await t.advance(ROSTER_IDLE_MS + 1_000);
    assert.equal(t.roster.size, 0); assert.equal(t.listeners(), 0);
  });
});

describe('account switching', () => {
  test('an identity change empties the roster at once; the previous user’s people are never served to the next', async () => {
    const t = setup([mk(1)]); await t.roster.load('c', SCOPE_K1);
    t.server.rows = [mk(5)];                               // what user B may see
    t.setIdentity('ns-b');
    assert.equal(t.roster.size, 0);
    const r = await identifyScan(t.roster, 'c', 'n1', SCOPE_K1, inK1, async () => ({ data: [], error: null }));
    assert.equal(r.source, 'server'); assert.equal(r.rows.length, 0);
  });

  test('after the switch (and once the bus is trusted for the new identity) the roster of the NEW user loads', async () => {
    const t = setup([mk(1)]); await t.roster.load('c', SCOPE_K1);
    t.server.rows = [mk(5)];
    t.state.trusted = false; t.setIdentity('ns-b'); await settle();
    assert.equal(t.roster.size, 0);
    t.setTrust(true); await settle();
    assert.equal(t.roster.size, 1);
    assert.equal((await identifyScan(t.roster, 'c', 'n5', SCOPE_K1, inK1, t.rpc)).source, 'local');
    assert.equal((await identifyScan(t.roster, 'c', 'n1', SCOPE_K1, inK1, async () => ({ data: [], error: null }))).source, 'server');
  });

  test('a load that finishes AFTER an account switch is discarded (no cross-account leak)', async () => {
    const t = setup([mk(1)]);
    let release!: () => void; t.server.gate = new Promise<void>((r) => { release = r; });
    const p = t.roster.load('c', SCOPE_K1);
    t.state.trusted = false; t.setIdentity('ns-b'); t.state.trusted = true;
    release(); t.server.gate = null;
    assert.equal(await p, 'stale');
    assert.equal(t.roster.size, 0);
  });

  test('sign-out (identity → null) drops everything and loads nothing', async () => {
    const t = setup([mk(1)]); await t.roster.load('c', SCOPE_K1);
    const pages = t.server.pages;
    t.setIdentity(null); await settle();
    assert.equal(t.roster.size, 0); assert.equal(t.server.pages, pages);
    assert.equal(await t.roster.load('c', SCOPE_K1), 'skipped');
  });

  test('a stale namespace in the roster is never served even if the switch event was missed', async () => {
    const t = setup([mk(1)]); await t.roster.load('c', SCOPE_K1);
    t.state.ns = 'ns-b';                                  // namespace changed, event not delivered yet
    const r = await identifyScan(t.roster, 'c', 'n1', SCOPE_K1, inK1, t.rpc);
    assert.equal(r.source === 'server' && r.reason, 'identity');
  });
});

describe('large rosters and pagination', () => {
  test('a roster larger than one page is loaded page by page and every row is resolvable', async () => {
    const t = setup(Array.from({ length: 1_800 }, (_, i) => mk(i)));
    assert.equal(await t.roster.load('c', SCOPE_K1), 'ready');
    assert.equal(t.server.pages, 4);                         // 500 ×3 + 300
    assert.equal(t.roster.size, 1_800);
    for (const i of [0, 499, 500, 999, 1000, 1799]) assert.equal((await identifyScan(t.roster, 'c', `n${i}`, SCOPE_K1, inK1, t.rpc)).source, 'local', `n${i}`);
  });

  test('exactly a multiple of the page size ends cleanly (no phantom page)', async () => {
    const t = setup(Array.from({ length: 1_000 }, (_, i) => mk(i)));
    await t.roster.load('c', SCOPE_K1);
    assert.equal(t.roster.size, 1_000); assert.equal(t.server.pages, 2);
  });

  test('a scope over the cap is NOT used at all (never a partial roster), is remembered, and every scan uses the server', async () => {
    const t = setup(Array.from({ length: 700 }, (_, i) => mk(i)), { maxRows: 600 });
    assert.equal(await t.roster.load('c', SCOPE_K1), 'too-large');
    assert.equal(t.roster.size, 0);
    const pages = t.server.pages;
    assert.equal(await t.roster.load('c', SCOPE_K1), 'too-large');
    assert.equal(t.server.pages, pages, 'not retried');
    assert.equal((await identifyScan(t.roster, 'c', 'n5', SCOPE_K1, inK1, t.rpc)).source, 'server');
    assert.ok(ROSTER_MAX_ROWS <= 5_000);
  });

  test('a change during a multi-page load (offset shift) restarts the load instead of trusting a roster that may skip a row', async () => {
    const t = setup(Array.from({ length: 1_200 }, (_, i) => mk(i)));
    let release!: () => void; t.server.gate = new Promise<void>((r) => { release = r; });
    const p = t.roster.load('c', SCOPE_K1);
    await tick();
    t.server.rows.push(mk(5000));
    t.emit('enrollments', { op: 'INSERT', ids: ['e5000'], n: 1 });   // lands while the first page is still in flight
    t.server.gate = null; release();
    assert.equal(await p, 'ready');
    assert.ok(t.server.pages > 3, `pages=${t.server.pages}`);
    assert.equal(t.roster.size, 1_201);
  });

  test('lookups stay O(1): 3000 resolutions on a 3000-row roster take well under a second', async () => {
    const t = setup(Array.from({ length: 3_000 }, (_, i) => mk(i)));
    await t.roster.load('c', SCOPE_K1);
    const t0 = performance.now();
    for (let i = 0; i < 3_000; i++) assert.ok(t.roster.resolve(`n${i}`, SCOPE_K1).hit);
    assert.ok(performance.now() - t0 < 1_000);
  });
});

describe('guards on a local hit', () => {
  test('a stopped enrollment is always decided by the server', async () => {
    const t = setup([mk(1, { status: 'stopped' })]); await t.roster.load('c', SCOPE_K1);
    const r = await identifyScan(t.roster, 'c', 'n1', SCOPE_K1, inK1, t.rpc);
    assert.equal(r.source === 'server' && r.reason, 'stopped');
  });

  test('a local hit whose rows are all outside the page’s inScope filter falls back to the server', async () => {
    const t = setup([mk(1)]); await t.roster.load('c', SCOPE_K1);
    const r = await identifyScan(t.roster, 'c', 'n1', SCOPE_K1, () => false, t.rpc);
    assert.equal(r.source, 'server');
  });

  test('the roster is memory-only: it never touches storage', async () => {
    const g = globalThis as unknown as { sessionStorage?: unknown; localStorage?: unknown };
    let touched = 0;
    const spy = { getItem() { touched++; return null; }, setItem() { touched++; }, removeItem() { touched++; }, key() { touched++; return null; }, length: 0 };
    g.sessionStorage = spy; g.localStorage = spy;
    try { const t = setup([mk(1)]); await t.roster.load('c', SCOPE_K1); await identifyScan(t.roster, 'c', 'n1', SCOPE_K1, inK1, t.rpc); }
    finally { delete g.sessionStorage; delete g.localStorage; }
    assert.equal(touched, 0);
  });
});

describe('request reduction (counted, not estimated)', () => {
  test('a 200-child class, 150 scans, everybody scanned once: 1 roster request instead of 150 lookups', async () => {
    const t = setup(Array.from({ length: 200 }, (_, i) => mk(i)));
    await t.roster.load('c', SCOPE_K1);
    for (let i = 0; i < 150; i++) await identifyScan(t.roster, 'c', `n${i}`, SCOPE_K1, inK1, t.rpc);
    assert.equal(t.server.rpc, 0);
    assert.equal(t.server.pages, 1);
  });
});
