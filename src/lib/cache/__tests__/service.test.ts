import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createQueryService, BUS_SETTLE_MS, SECURITY_TABLES, PERMISSION_TABLES, type BusPort,
} from '../service.ts';
import { STORAGE_PREFIX, DEFAULT_FALLBACK_TTL_MS, DEFAULT_TTL_MS, type StorageLike } from '../query-cache.ts';

class FakeStorage implements StorageLike {
  map = new Map<string, string>();
  get length() { return this.map.size; }
  key(i: number) { return Array.from(this.map.keys())[i] ?? null; }
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
  keys() { return Array.from(this.map.keys()); }
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
  setUp(ok: boolean) { this.up = ok; this.conn.forEach((f) => f(ok)); }
  fireResume() { this.resume.forEach((f) => f()); }
  count(t: string) { return this.tables.get(t)?.size ?? 0; }
  total() { let n = 0; this.tables.forEach((s) => { n += s.size; }); return n; }
}

function setup() {
  const clock = { t: 5_000_000 };
  const bus = new FakeBus();
  const storage = new FakeStorage();
  const timers: { fn: () => void; at: number; id: number; live: boolean }[] = [];
  let seq = 0;
  const svc = createQueryService({
    bus, storage, now: () => clock.t,
    schedule: (fn, ms) => { const t = { fn, at: clock.t + ms, id: ++seq, live: true }; timers.push(t); return t.id; },
    cancel: (h) => { const t = timers.find((x) => x.id === h); if (t) t.live = false; },
  });
  const advance = (ms: number) => {
    clock.t += ms;
    timers.filter((t) => t.live && t.at <= clock.t).forEach((t) => { t.live = false; t.fn(); });
  };
  return { svc, bus, storage, clock, advance };
}

const ID_A = { uid: 'user-a', role: 'owner', status: 'approved', scopes: [] as { church_id: string | null }[] };
const ID_B = { uid: 'user-b', role: 'class_servant', status: 'approved', scopes: [{ church_id: 'c1', service_id: 's1', class_id: 'k1' }] };

/** a minimal PostgREST-like query builder: records the calls and answers from `result` */
function fakeSupabase(result: { data: unknown; error?: unknown }) {
  const log = { from: [] as string[], order: [] as string[], eq: [] as [string, unknown][], reads: 0 };
  const builder = {
    select() { return builder; },
    order(col: string) { log.order.push(col); return builder; },
    eq(c: string, v: unknown) { log.eq.push([c, v]); return builder; },
    maybeSingle() { log.reads++; return Promise.resolve({ data: result.data, error: result.error ?? null }); },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { log.reads++; return Promise.resolve({ data: result.data, error: result.error ?? null }).then(res, rej); },
  };
  const client = { from(t: string) { log.from.push(t); return builder; } };
  return { client: client as never, log };
}

describe('lookup', () => {
  test('keeps the query shape: manual order for structural tables, caller order otherwise', async () => {
    const { svc } = setup();
    svc.setIdentity(ID_A);
    const a = fakeSupabase({ data: [{ id: 1 }] });
    await svc.lookup(a.client, 'churches');
    assert.deepEqual(a.log.order, ['sort_order', 'name']);
    const b = fakeSupabase({ data: [{ id: 1 }] });
    await svc.lookup(b.client, 'events', { column: 'event_date', ascending: false, nullsFirst: false });
    assert.deepEqual(b.log.order, ['event_date']);
  });

  test('different orderings of the same table do not share an entry', async () => {
    const { svc } = setup();
    svc.setIdentity(ID_A);
    const a = fakeSupabase({ data: ['by-name'] });
    const b = fakeSupabase({ data: ['by-date'] });
    assert.deepEqual(await svc.lookup(a.client, 'events'), ['by-name']);
    assert.deepEqual(await svc.lookup(b.client, 'events', { column: 'event_date', ascending: false }), ['by-date']);
    assert.deepEqual(await svc.lookup(a.client, 'events'), ['by-name']);
    assert.equal(a.log.reads, 1);
    assert.equal(b.log.reads, 1);
  });

  test('an error yields [] (as before) and is NOT cached', async () => {
    const { svc } = setup();
    svc.setIdentity(ID_A);
    const bad = fakeSupabase({ data: null, error: new Error('rls') });
    assert.deepEqual(await svc.lookup(bad.client, 'classes'), []);
    const good = fakeSupabase({ data: [{ id: 'k' }] });
    assert.deepEqual(await svc.lookup(good.client, 'classes'), [{ id: 'k' }]);
  });

  test('force bypasses the cache; invalidateLookup(table) and invalidateLookup() drop entries', async () => {
    const { svc } = setup();
    svc.setIdentity(ID_A);
    const s = fakeSupabase({ data: [1] });
    await svc.lookup(s.client, 'services');
    await svc.lookup(s.client, 'services');
    assert.equal(s.log.reads, 1);
    await svc.lookup(s.client, 'services', { column: 'name' }, true);
    assert.equal(s.log.reads, 2);
    svc.invalidateLookup('services');
    await svc.lookup(s.client, 'services');
    assert.equal(s.log.reads, 3);
    await svc.lookup(s.client, 'churches');
    svc.invalidateLookup();
    await svc.lookup(s.client, 'services'); await svc.lookup(s.client, 'churches');
    // services: 1 first load + 1 forced + 1 after invalidate('services') + 1 after invalidate() = 4
    // churches: 1 first load + 1 after invalidate()                                           = 2
    assert.equal(s.log.reads, 6);
  });

  test('a bus message for the table refreshes it', async () => {
    const { svc, bus, advance } = setup();
    svc.setIdentity(ID_A);
    advance(BUS_SETTLE_MS + 1);
    const s = fakeSupabase({ data: ['v1'] });
    await svc.lookup(s.client, 'churches');
    bus.emit('churches');
    await svc.lookup(s.client, 'churches');
    assert.equal(s.log.reads, 2);
  });

  test('church/service/class lookups persist; permission-gated ones NEVER do', async () => {
    const { svc, storage } = setup();
    svc.setIdentity(ID_A);
    const s = fakeSupabase({ data: [{ id: 1 }] });
    await svc.lookup(s.client, 'churches');
    const persisted = storage.keys().length;
    assert.equal(persisted, 1);
    await svc.lookup(s.client, 'events');
    await svc.lookup(s.client, 'causes');
    await svc.lookup(s.client, 'call_feedbacks');
    assert.equal(storage.keys().length, persisted, 'permission-gated rows must not reach storage');
  });

  test('permission-gated lookups are dropped when permissions change; plain ones are not', async () => {
    const { svc, bus, advance } = setup();
    svc.setIdentity(ID_A);
    advance(BUS_SETTLE_MS + 1);
    const ev = fakeSupabase({ data: ['e'] }); const ch = fakeSupabase({ data: ['c'] });
    await svc.lookup(ev.client, 'events'); await svc.lookup(ch.client, 'churches');
    for (const t of PERMISSION_TABLES) {
      bus.emit(t);
      await svc.lookup(ev.client, 'events');
      await svc.lookup(ch.client, 'churches');
    }
    assert.equal(ev.log.reads, 1 + PERMISSION_TABLES.length);
    assert.equal(ch.log.reads, 1);
  });
});

describe('row (single-row reads)', () => {
  test('a found row is cached, a missing row is not', async () => {
    const { svc } = setup();
    svc.setIdentity(ID_A);
    const miss = fakeSupabase({ data: null });
    assert.equal(await svc.row(miss.client, 'churches', 'c1'), null);
    assert.equal(await svc.row(miss.client, 'churches', 'c1'), null);
    assert.equal(miss.log.reads, 2);
    const hit = fakeSupabase({ data: { id: 'c1', name: 'x' } });
    await svc.row(hit.client, 'churches', 'c1');
    await svc.row(hit.client, 'churches', 'c1');
    assert.equal(hit.log.reads, 1);
    assert.deepEqual(hit.log.eq, [['id', 'c1']]);
  });

  test('different columns / ids are different entries; an error yields null', async () => {
    const { svc } = setup();
    svc.setIdentity(ID_A);
    const s = fakeSupabase({ data: { id: 1 } });
    await svc.row(s.client, 'churches', 'c1', 'name, logo_url');
    await svc.row(s.client, 'churches', 'c1', '*');
    await svc.row(s.client, 'churches', 'c2', '*');
    assert.equal(s.log.reads, 3);
    const bad = fakeSupabase({ data: null, error: new Error('x') });
    assert.equal(await svc.row(bad.client, 'services', 's1'), null);
  });
});

describe('identity + bus trust', () => {
  test('with no identity every call goes to the network (signed out / pending)', async () => {
    const { svc } = setup();
    const s = fakeSupabase({ data: [1] });
    await svc.lookup(s.client, 'churches'); await svc.lookup(s.client, 'churches');
    assert.equal(s.log.reads, 2);
  });

  test('A → B through the service: nothing of A is served, stored or left subscribed', async () => {
    const { svc, storage, bus } = setup();
    svc.setIdentity(ID_A);
    const a = fakeSupabase({ data: ['church-of-A'] });
    await svc.lookup(a.client, 'churches');
    assert.equal(svc.setIdentity(ID_B), true);
    const b = fakeSupabase({ data: ['church-of-B'] });
    assert.deepEqual(await svc.lookup(b.client, 'churches'), ['church-of-B']);
    assert.ok(!Array.from(storage.map.values()).some((v) => v.includes('church-of-A')));
    assert.equal(svc.setIdentity(ID_B), false);
    svc.suspend();
    assert.equal(bus.count('churches'), 0);
    for (const t of SECURITY_TABLES) assert.equal(bus.count(t), 0, `security subscription ${t} must be released on sign-out`);
  });

  test('settle window: right after an identity change entries are NOT trusted for the long TTL; afterwards they are', async () => {
    const { svc, advance, clock } = setup();
    svc.setIdentity(ID_A);
    const s = fakeSupabase({ data: [1] });
    await svc.lookup(s.client, 'churches');                      // fetched inside the settle window
    clock.t += DEFAULT_FALLBACK_TTL_MS + 1;
    await svc.lookup(s.client, 'churches');
    assert.equal(s.log.reads, 2, 'unverified → short TTL');
    advance(BUS_SETTLE_MS + 1);                                  // settled
    const s2 = fakeSupabase({ data: [2] });
    await svc.lookup(s2.client, 'services');
    clock.t += DEFAULT_FALLBACK_TTL_MS + 1;
    await svc.lookup(s2.client, 'services');
    assert.equal(s2.log.reads, 1, 'verified → long TTL');
    clock.t += DEFAULT_TTL_MS;
  });

  test('bus down → short TTL; bus back + resume gate → trust withdrawn', async () => {
    const { svc, bus, advance, clock } = setup();
    svc.setIdentity(ID_A); advance(BUS_SETTLE_MS + 1);
    const s = fakeSupabase({ data: [1] });
    await svc.lookup(s.client, 'churches');
    bus.fireResume();                                            // long suspension
    clock.t += DEFAULT_FALLBACK_TTL_MS + 1;
    await svc.lookup(s.client, 'churches');
    assert.equal(s.log.reads, 2);
    const t = fakeSupabase({ data: [1] });
    await svc.lookup(t.client, 'services');
    bus.setUp(false);
    clock.t += DEFAULT_FALLBACK_TTL_MS + 1;
    await svc.lookup(t.client, 'services');
    assert.equal(t.log.reads, 2);
  });

  test('a server-side service (no bus) never verifies and never subscribes', async () => {
    const svc = createQueryService({});
    svc.setIdentity(ID_A);
    const s = fakeSupabase({ data: [1] });
    await svc.lookup(s.client, 'churches');
    assert.equal(svc.cache.stats().subscriptions, 0);
  });
});

describe('security tables', () => {
  for (const table of SECURITY_TABLES) {
    test(`a change to ${table} empties the WHOLE cache at once`, async () => {
      const { svc, bus, storage } = setup();
      svc.setIdentity(ID_B);
      const s = fakeSupabase({ data: [1] });
      await svc.lookup(s.client, 'churches'); await svc.lookup(s.client, 'classes');
      await svc.query('custom', async () => 'x');
      assert.ok(storage.keys().length > 0);
      bus.emit(table);
      assert.equal(svc.cache.stats().entries, 0);
      assert.equal(storage.keys().length, 0);
    });
  }

  test('security subscriptions are registered once per identity set, not per call', async () => {
    const { svc, bus } = setup();
    svc.setIdentity(ID_A); svc.setIdentity(ID_A); svc.setIdentity(ID_B); svc.setIdentity(ID_B);
    for (const t of SECURITY_TABLES) assert.equal(bus.count(t), 1);
  });
});

describe('active place', () => {
  const P1 = { church_id: 'c1', service_id: null, class_id: null };
  const P2 = { church_id: 'c2', service_id: null, class_id: null };
  const me = { uid: 'u', role: 'church_manager', status: 'approved' };

  test('switching place: the identity changes, the old place\'s lists are gone, and back again they are refetched', async () => {
    const { svc } = setup();
    svc.setIdentity({ ...me, scopes: [P1], activePlace: P1 });
    const s1 = fakeSupabase({ data: ['classes-c1'] });
    await svc.lookup(s1.client, 'classes');
    svc.suspend();                                              // switch in progress
    const during = fakeSupabase({ data: ['classes-during'] });
    assert.deepEqual(await svc.lookup(during.client, 'classes'), ['classes-during']);
    assert.deepEqual(await svc.lookup(during.client, 'classes'), ['classes-during']);
    assert.equal(during.log.reads, 2, 'nothing is cached while suspended');
    svc.setIdentity({ ...me, scopes: [P2], activePlace: P2 });
    const s2 = fakeSupabase({ data: ['classes-c2'] });
    assert.deepEqual(await svc.lookup(s2.client, 'classes'), ['classes-c2']);
    svc.setIdentity({ ...me, scopes: [P1], activePlace: P1 });
    const s3 = fakeSupabase({ data: ['classes-c1-again'] });
    assert.deepEqual(await svc.lookup(s3.client, 'classes'), ['classes-c1-again']);
  });
});

describe('persistence through the service', () => {
  test('a reload restores church/service/class lists for the SAME identity only', async () => {
    const storage = new FakeStorage();
    const mk = () => {
      const clock = { t: 9_000_000 };
      return { clock, svc: createQueryService({ storage, now: () => clock.t, bus: new FakeBus() }) };
    };
    const first = mk();
    first.svc.setIdentity(ID_A);
    const s = fakeSupabase({ data: [{ id: 'c1' }] });
    await first.svc.lookup(s.client, 'churches');
    assert.ok(storage.keys().every((k) => k.startsWith(STORAGE_PREFIX)));

    const second = mk();
    second.svc.setIdentity(ID_A);
    const s2 = fakeSupabase({ data: [{ id: 'fresh' }] });
    assert.deepEqual(await second.svc.lookup(s2.client, 'churches'), [{ id: 'c1' }]);
    assert.equal(s2.log.reads, 0);

    const third = mk();
    third.svc.setIdentity(ID_B);
    const s3 = fakeSupabase({ data: [{ id: 'b-church' }] });
    assert.deepEqual(await third.svc.lookup(s3.client, 'churches'), [{ id: 'b-church' }]);
  });
});
