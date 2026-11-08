// Phase 3 — scanner lookups + intent prefetch, run against the REAL Phase 1 service
// (createQueryService) with a fake PostgREST client. No second cache is involved.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createQueryService, BUS_SETTLE_MS, PERMISSION_TABLES, SECURITY_TABLES, type BusPort } from '../service.ts';
import { loadScannerLookups, createScannerPrefetch, SCANNER_LOOKUPS, PREFETCH_MIN_GAP_MS, type LookupFn } from '../scanner.ts';

class FakeBus implements BusPort {
  up = true;
  tables = new Map<string, Set<() => void>>();
  conn = new Set<(ok: boolean) => void>();
  resume = new Set<() => void>();
  onTable(t: string, fn: () => void) { let s = this.tables.get(t); if (!s) { s = new Set(); this.tables.set(t, s); } s.add(fn); return () => { s!.delete(fn); }; }
  onConnection(fn: (ok: boolean) => void) { this.conn.add(fn); return () => { this.conn.delete(fn); }; }
  connected() { return this.up; }
  onResume(fn: () => void) { this.resume.add(fn); return () => { this.resume.delete(fn); }; }
  emit(t: string) { Array.from(this.tables.get(t) ?? []).forEach((f) => f()); }
}

function setup() {
  const clock = { t: 9_000_000 };
  const bus = new FakeBus();
  const timers: { fn: () => void; at: number; id: number; live: boolean }[] = [];
  let seq = 0;
  const svc = createQueryService({
    bus, storage: null, now: () => clock.t,
    schedule: (fn, ms) => { const t = { fn, at: clock.t + ms, id: ++seq, live: true }; timers.push(t); return t.id; },
    cancel: (h) => { const t = timers.find((x) => x.id === h); if (t) t.live = false; },
  });
  const advance = (ms: number) => { clock.t += ms; timers.filter((t) => t.live && t.at <= clock.t).forEach((t) => { t.live = false; t.fn(); }); };
  const lookup: LookupFn = (sb, table, ob, force) => svc.lookup(sb, table, ob, force);
  return { svc, bus, clock, advance, lookup };
}

const ID_A = { uid: 'user-a', role: 'class_servant', status: 'approved', scopes: [{ church_id: 'c1', service_id: 's1', class_id: 'k1' }] };
const ID_B = { uid: 'user-b', role: 'owner', status: 'approved', scopes: [] as { church_id: string | null }[] };

/** counts every network read per table; `fail` makes the given tables error; `tag` marks whose rows these are */
function fakeNet(opts: { tag?: string; fail?: () => boolean; gate?: Promise<void> } = {}) {
  const reads: string[] = [];
  const client = {
    from(table: string) {
      const b: Record<string, unknown> = {
        select: () => b, order: () => b,
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
          reads.push(table);
          const run = async () => {
            if (opts.gate) await opts.gate;
            if (opts.fail?.()) return { data: null, error: new Error('offline') };
            return { data: [{ id: `${opts.tag ?? 'x'}:${table}` }], error: null };
          };
          return run().then(res, rej);
        },
      };
      return b;
    },
    // anything but .from() would be a bug for these lookups
    rpc() { throw new Error('lookups must not call rpc'); },
  };
  return { client: client as never, reads };
}

const SIX = ['churches', 'services', 'classes', 'events', 'causes', 'call_feedbacks'];

describe('scanner init — cold and warm cache', () => {
  test('cold: six parallel reads, one per lookup table, rows returned under the right names', async () => {
    const { svc, lookup } = setup(); svc.setIdentity(ID_A);
    const net = fakeNet({ tag: 'a' });
    const r = await loadScannerLookups<{ id: string }, { id: string }, { id: string }, { id: string }, { id: string }, { id: string }>(lookup, net.client);
    assert.deepEqual([...net.reads].sort(), [...SIX].sort());
    assert.equal(r.churches[0].id, 'a:churches');
    assert.equal(r.feedbacks[0].id, 'a:call_feedbacks');
    assert.equal(r.events[0].id, 'a:events');
  });

  test('cold reads are issued in parallel, not one after another', async () => {
    const { svc, lookup } = setup(); svc.setIdentity(ID_A);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const net = fakeNet({ gate });
    const p = loadScannerLookups(lookup, net.client);
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(net.reads.length, 6, 'all six must already be in flight while the first is still pending');
    release(); await p;
  });

  test('warm: a second init inside the TTL makes zero requests', async () => {
    const { svc, lookup } = setup(); svc.setIdentity(ID_A);
    const net = fakeNet();
    await loadScannerLookups(lookup, net.client);
    const n = net.reads.length;
    const again = await loadScannerLookups<{ id: string }>(lookup, net.client);
    assert.equal(net.reads.length, n);
    assert.equal(again.churches.length, 1);
  });

  test('explicit refresh (force) refetches all six', async () => {
    const { svc, lookup } = setup(); svc.setIdentity(ID_A);
    const net = fakeNet();
    await loadScannerLookups(lookup, net.client);
    await loadScannerLookups(lookup, net.client, true);
    assert.equal(net.reads.length, 12);
  });

  test('the lookup shapes are exactly the ones the scanner used before Phase 3', () => {
    assert.deepEqual(SCANNER_LOOKUPS, {
      churches: { column: 'name' }, services: { column: 'name' }, classes: { column: 'name' },
      events: { column: 'event_date', ascending: false, nullsFirst: false },
      causes: { column: 'name' }, call_feedbacks: { column: 'sort_order' },
    });
  });
});

describe('prefetch → scanner navigation', () => {
  test('prefetch fills the cache; the page init afterwards makes no request', async () => {
    const { svc, lookup } = setup(); svc.setIdentity(ID_A);
    const net = fakeNet();
    const prefetch = createScannerPrefetch({ lookup, enabled: () => svc.cache.namespace !== null });
    assert.equal(await prefetch(net.client), true);
    assert.equal(net.reads.length, 6);
    await loadScannerLookups(lookup, net.client); // the page mounting
    assert.equal(net.reads.length, 6, 'zero redundant fetches after a prefetch');
  });

  test('page init while the prefetch is still in flight shares it (in-flight dedupe)', async () => {
    const { svc, lookup } = setup(); svc.setIdentity(ID_A);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const net = fakeNet({ gate });
    const prefetch = createScannerPrefetch({ lookup, enabled: () => true });
    const pf = prefetch(net.client);
    const page = loadScannerLookups(lookup, net.client);
    release(); await Promise.all([pf, page]);
    assert.equal(net.reads.length, 6, 'one fetch per table, not two');
  });

  test('prefetch never forces: a fresh entry is not refetched', async () => {
    const { svc, lookup, clock } = setup(); svc.setIdentity(ID_A);
    const net = fakeNet();
    await loadScannerLookups(lookup, net.client);
    const prefetch = createScannerPrefetch({ lookup, enabled: () => true, now: () => clock.t });
    await prefetch(net.client);
    assert.equal(net.reads.length, 6);
  });

  test('repeated hovers inside the gap are ignored (no request storm)', async () => {
    const { svc, lookup, clock } = setup(); svc.setIdentity(ID_A);
    const net = fakeNet({ fail: () => true }); // failures are not cached → only the gap protects us
    const prefetch = createScannerPrefetch({ lookup, enabled: () => true, now: () => clock.t });
    await prefetch(net.client);
    const n = net.reads.length;
    assert.equal(await prefetch(net.client), false);
    assert.equal(await prefetch(net.client), false);
    assert.equal(net.reads.length, n);
    clock.t += PREFETCH_MIN_GAP_MS + 1;
    await prefetch(net.client);
    assert.equal(net.reads.length, n * 2);
  });

  test('no prefetch without a cache identity (signed out / pending) or while offline', async () => {
    const { svc, lookup } = setup(); // identity NOT set
    const net = fakeNet();
    const noId = createScannerPrefetch({ lookup, enabled: () => svc.cache.namespace !== null });
    assert.equal(await noId(net.client), false);
    const off = createScannerPrefetch({ lookup, enabled: () => true, online: () => false });
    assert.equal(await off(net.client), false);
    assert.equal(net.reads.length, 0);
  });

  test('a prefetch that slipped in before identity exists caches nothing (pass-through)', async () => {
    const { svc, lookup } = setup(); // no identity
    const net = fakeNet({ tag: 'anon' });
    await loadScannerLookups(lookup, net.client);
    assert.equal(net.reads.length, 6);
    svc.setIdentity(ID_A);
    const net2 = fakeNet({ tag: 'a' });
    const r = await loadScannerLookups<{ id: string }>(lookup, net2.client);
    assert.equal(net2.reads.length, 6, 'nothing from the identity-less call was reused');
    assert.equal(r.churches[0].id, 'a:churches');
  });
});

describe('realtime invalidation', () => {
  async function warm() {
    const s = setup(); s.svc.setIdentity(ID_A);
    const net = fakeNet();
    await loadScannerLookups(s.lookup, net.client);
    s.advance(BUS_SETTLE_MS + 1); // bus verified → entries live on bus messages
    return { ...s, net };
  }

  for (const t of SIX) {
    test(`a bus message on ${t} drops exactly that lookup`, async () => {
      const { bus, lookup, net } = await warm();
      bus.emit(t);
      const before = net.reads.length;
      await loadScannerLookups(lookup, net.client);
      assert.equal(net.reads.length - before, 1);
      assert.equal(net.reads[net.reads.length - 1], t);
    });
  }

  test('permission tables drop the three permission-gated lookups (events, causes, call_feedbacks)', async () => {
    for (const pt of PERMISSION_TABLES) {
      const { bus, lookup, net } = await warm();
      bus.emit(pt);
      const before = net.reads.length;
      await loadScannerLookups(lookup, net.client);
      assert.deepEqual(net.reads.slice(before).sort(), ['call_feedbacks', 'causes', 'events']);
    }
  });

  test('a security-table message (scope / active place / enrollments of servants) empties everything', async () => {
    for (const st of SECURITY_TABLES) {
      const { bus, lookup, net } = await warm();
      bus.emit(st);
      const before = net.reads.length;
      await loadScannerLookups(lookup, net.client);
      assert.equal(net.reads.length - before, 6);
    }
  });

  test('forced reload after the invalidation returns the NEW rows', async () => {
    const { bus, lookup, net, clock } = await warm();
    void clock;
    bus.emit('classes');
    const fresh = fakeNet({ tag: 'new' });
    const r = await loadScannerLookups<{ id: string }, { id: string }, { id: string }>(lookup, fresh.client);
    assert.equal(r.classes[0].id, 'new:classes');
    assert.equal(r.churches[0].id, 'x:churches', 'untouched tables are still served from the cache');
    void net;
  });
});

describe('user and active-place switching', () => {
  test('another user never sees the previous user’s lookups', async () => {
    const { svc, lookup } = setup();
    svc.setIdentity(ID_A);
    await loadScannerLookups(lookup, fakeNet({ tag: 'A' }).client);
    svc.setIdentity(ID_B);
    const netB = fakeNet({ tag: 'B' });
    const r = await loadScannerLookups<{ id: string }>(lookup, netB.client);
    assert.equal(netB.reads.length, 6);
    assert.equal(r.churches[0].id, 'B:churches');
  });

  test('switching the active place (same uid) empties the cache', async () => {
    const { svc, lookup } = setup();
    svc.setIdentity({ ...ID_A, activePlace: { church_id: 'c1', service_id: 's1', class_id: 'k1' } });
    await loadScannerLookups(lookup, fakeNet({ tag: 'place1' }).client);
    svc.setIdentity({ ...ID_A, activePlace: { church_id: 'c2', service_id: 's2', class_id: 'k2' } });
    const net2 = fakeNet({ tag: 'place2' });
    const r = await loadScannerLookups<unknown, { id: string }>(lookup, net2.client);
    assert.equal(net2.reads.length, 6);
    assert.equal(r.services[0].id, 'place2:services');
  });

  test('suspend (switch account / sign-out) disables the cache; going back does not resurrect old rows', async () => {
    const { svc, lookup } = setup();
    svc.setIdentity(ID_A);
    await loadScannerLookups(lookup, fakeNet({ tag: 'A' }).client);
    svc.suspend();
    const mid = fakeNet({ tag: 'mid' });
    await loadScannerLookups(lookup, mid.client);
    await loadScannerLookups(lookup, mid.client);
    assert.equal(mid.reads.length, 12, 'while suspended nothing is cached');
    svc.setIdentity(ID_A);
    const back = fakeNet({ tag: 'A2' });
    const r = await loadScannerLookups<{ id: string }>(lookup, back.client);
    assert.equal(back.reads.length, 6);
    assert.equal(r.churches[0].id, 'A2:churches');
  });

  test('a prefetch that resolves AFTER an account switch does not leak into the new account', async () => {
    const { svc, lookup } = setup();
    svc.setIdentity(ID_A);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slowA = fakeNet({ tag: 'A', gate });
    const prefetch = createScannerPrefetch({ lookup, enabled: () => true });
    const pf = prefetch(slowA.client);
    svc.setIdentity(ID_B);          // user switches while A's requests are in flight
    release(); await pf;
    const netB = fakeNet({ tag: 'B' });
    const r = await loadScannerLookups<{ id: string }>(lookup, netB.client);
    assert.equal(netB.reads.length, 6, 'A’s late answers were not stored under B');
    assert.equal(r.churches[0].id, 'B:churches');
  });
});

describe('offline / failed loading', () => {
  test('a failed lookup yields [] (unchanged page behaviour) and the other lookups still load', async () => {
    const { svc, lookup } = setup(); svc.setIdentity(ID_A);
    const reads: string[] = [];
    const client = {
      from(table: string) {
        const b: Record<string, unknown> = {
          select: () => b, order: () => b,
          then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
            reads.push(table);
            return Promise.resolve(table === 'classes' ? { data: null, error: new Error('boom') } : { data: [{ id: table }], error: null }).then(res, rej);
          },
        };
        return b;
      },
    } as never;
    const r = await loadScannerLookups<{ id: string }, { id: string }, { id: string }>(lookup, client);
    assert.deepEqual(r.classes, []);
    assert.equal(r.churches[0].id, 'churches');
  });

  test('failures are not cached: the next init retries and recovers', async () => {
    const { svc, lookup } = setup(); svc.setIdentity(ID_A);
    let down = true;
    const net = fakeNet({ fail: () => down });
    const bad = await loadScannerLookups(lookup, net.client);
    assert.ok(Object.values(bad).every((x) => Array.isArray(x) && x.length === 0));
    down = false;
    const ok = await loadScannerLookups<{ id: string }>(lookup, net.client);
    assert.equal(ok.churches.length, 1);
    assert.equal(net.reads.length, 12);
  });

  test('a thrown (network-level) error never escapes the loader or the prefetch', async () => {
    const { svc, lookup } = setup(); svc.setIdentity(ID_A);
    const client = { from() { throw new Error('fetch failed'); } } as never;
    const r = await loadScannerLookups(lookup, client);
    assert.deepEqual(r.churches, []);
    const prefetch = createScannerPrefetch({ lookup, enabled: () => true });
    assert.equal(await prefetch(client), true); // resolved, did not reject
  });
});
