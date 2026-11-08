// Run with:  npm test      (node --test, TypeScript type-stripping, no extra dependency)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  QueryCache, buildNamespace, hashString, STORAGE_PREFIX,
  DEFAULT_TTL_MS, DEFAULT_FALLBACK_TTL_MS, DEFAULT_STALE_MS, REVALIDATE_RETRY_MS,
  type StorageLike,
} from '../query-cache.ts';

// ---------------------------------------------------------------- fakes
class FakeStorage implements StorageLike {
  map = new Map<string, string>();
  get length() { return this.map.size; }
  key(i: number) { return Array.from(this.map.keys())[i] ?? null; }
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
  keys() { return Array.from(this.map.keys()); }
}

class FakeBus {
  listeners = new Map<string, Set<() => void>>();
  subscribes = 0;
  unsubscribes = 0;
  subscribe = (table: string, fn: () => void) => {
    this.subscribes++;
    let s = this.listeners.get(table);
    if (!s) { s = new Set(); this.listeners.set(table, s); }
    s.add(fn);
    return () => { this.unsubscribes++; s!.delete(fn); };
  };
  emit(table: string) { Array.from(this.listeners.get(table) ?? []).forEach((f) => f()); }
  count(table: string) { return this.listeners.get(table)?.size ?? 0; }
  total() { let n = 0; this.listeners.forEach((s) => { n += s.size; }); return n; }
}

function setup(opts: { storage?: FakeStorage | null } = {}) {
  const clock = { t: 1_000_000 };
  const bus = new FakeBus();
  const storage = opts.storage === undefined ? new FakeStorage() : opts.storage;
  const cache = new QueryCache({ now: () => clock.t, storage, subscribeTable: bus.subscribe });
  return { cache, clock, bus, storage };
}

/** a fetcher that counts calls and can be resolved by hand */
function manual<T>() {
  const calls: { resolve: (v: T) => void; reject: (e: unknown) => void }[] = [];
  const fetcher = () => new Promise<T>((resolve, reject) => { calls.push({ resolve, reject }); });
  return { fetcher, calls };
}
const counting = <T>(make: (n: number) => T) => {
  const o = { n: 0, fetcher: async () => make(++o.n) };
  return o;
};
const tick = () => new Promise<void>((r) => setImmediate(r));

const NS_A = buildNamespace({ uid: 'user-a', role: 'owner', status: 'approved', scopes: [] });
const NS_B = buildNamespace({ uid: 'user-b', role: 'class_servant', status: 'approved', scopes: [{ church_id: 'c1', service_id: 's1', class_id: 'k1' }] });

// ================================================================ tests
describe('dedupe', () => {
  test('concurrent requests share ONE fetch', async () => {
    const { cache } = setup();
    cache.setIdentity(NS_A);
    const m = manual<string[]>();
    const p = [cache.query('k', m.fetcher), cache.query('k', m.fetcher), cache.query('k', m.fetcher)];
    await tick();
    assert.equal(m.calls.length, 1);
    assert.equal(cache.stats().flights, 1);
    m.calls[0].resolve(['x']);
    const r = await Promise.all(p);
    assert.deepEqual(r, [['x'], ['x'], ['x']]);
    assert.equal(cache.stats().flights, 0);
  });

  test('different keys do not share', async () => {
    const { cache } = setup();
    cache.setIdentity(NS_A);
    const a = counting((n) => `a${n}`); const b = counting((n) => `b${n}`);
    assert.deepEqual(await Promise.all([cache.query('a', a.fetcher), cache.query('b', b.fetcher)]), ['a1', 'b1']);
  });

  test('a synchronous throw in the fetcher leaves no dead flight', async () => {
    const { cache } = setup();
    cache.setIdentity(NS_A);
    const bad = (() => { throw new Error('boom'); }) as () => Promise<string>;
    await assert.rejects(cache.query('k', bad), /boom/);
    assert.equal(cache.stats().flights, 0);
    assert.equal(await cache.query('k', async () => 'ok'), 'ok');
  });
});

describe('TTL', () => {
  test('hit within TTL, refetch after (unverified → fallback TTL)', async () => {
    const { cache, clock } = setup();
    cache.setIdentity(NS_A);
    const f = counting((n) => n);
    assert.equal(await cache.query('k', f.fetcher), 1);
    clock.t += DEFAULT_FALLBACK_TTL_MS - 1;
    assert.equal(await cache.query('k', f.fetcher), 1);
    assert.equal(f.n, 1);
    clock.t += 2;
    assert.equal(await cache.query('k', f.fetcher), 2);
    assert.equal(f.n, 2);
  });

  test('verified entries (bus live + tables) use the long TTL', async () => {
    const { cache, clock } = setup();
    cache.setIdentity(NS_A);
    cache.setBusLive(true);
    const f = counting((n) => n);
    const o = { tables: ['churches'] };
    await cache.query('k', f.fetcher, o);
    clock.t += DEFAULT_TTL_MS - 1;
    assert.equal(await cache.query('k', f.fetcher, o), 1);
    assert.equal(f.n, 1);
  });

  test('bus live but NO tables declared → never verified (short TTL)', async () => {
    const { cache, clock } = setup();
    cache.setIdentity(NS_A);
    cache.setBusLive(true);
    const f = counting((n) => n);
    await cache.query('k', f.fetcher);
    clock.t += DEFAULT_FALLBACK_TTL_MS + 1;
    await cache.query('k', f.fetcher);
    assert.equal(f.n, 2);
  });

  test('a bus drop withdraws trust: the entry falls back to the short TTL', async () => {
    const { cache, clock } = setup();
    cache.setIdentity(NS_A);
    cache.setBusLive(true);
    const f = counting((n) => n);
    const o = { tables: ['churches'] };
    await cache.query('k', f.fetcher, o);
    cache.setBusLive(false);
    clock.t += DEFAULT_FALLBACK_TTL_MS + 1;
    assert.equal(await cache.query('k', f.fetcher, o), 2);
  });

  test('fetched while the bus was down is never verified, even if it comes back', async () => {
    const { cache, clock } = setup();
    cache.setIdentity(NS_A);
    const f = counting((n) => n);
    const o = { tables: ['churches'] };
    await cache.query('k', f.fetcher, o); // bus never live
    cache.setBusLive(true);
    clock.t += DEFAULT_FALLBACK_TTL_MS + 1;
    assert.equal(await cache.query('k', f.fetcher, o), 2);
  });

  test('a fetch that STARTED before a bus drop is not verified', async () => {
    const { cache, clock } = setup();
    cache.setIdentity(NS_A);
    cache.setBusLive(true);
    const m = manual<number>();
    const o = { tables: ['churches'] };
    const p = cache.query('k', m.fetcher, o);
    await tick();
    cache.setBusLive(false); cache.setBusLive(true); // flapped while the request was out
    m.calls[0].resolve(1);
    await p;
    clock.t += DEFAULT_FALLBACK_TTL_MS + 1;
    const f = counting(() => 2);
    assert.equal(await cache.query('k', f.fetcher, o), 2);
  });

  test('markUnverified (long suspension / resume) withdraws trust', async () => {
    const { cache, clock } = setup();
    cache.setIdentity(NS_A); cache.setBusLive(true);
    const f = counting((n) => n); const o = { tables: ['t'] };
    await cache.query('k', f.fetcher, o);
    cache.markUnverified();
    clock.t += DEFAULT_FALLBACK_TTL_MS + 1;
    assert.equal(await cache.query('k', f.fetcher, o), 2);
  });

  test('a clock that goes backwards expires the entry', async () => {
    const { cache, clock } = setup();
    cache.setIdentity(NS_A);
    const f = counting((n) => n);
    await cache.query('k', f.fetcher);
    clock.t -= 10_000;
    assert.equal(await cache.query('k', f.fetcher), 2);
  });
});

describe('bus-driven invalidation', () => {
  test('a change to a listed table drops the entry; unrelated tables keep theirs', async () => {
    const { cache, bus } = setup();
    cache.setIdentity(NS_A); cache.setBusLive(true);
    const ch = counting((n) => `ch${n}`); const sv = counting((n) => `sv${n}`);
    await cache.query('churches', ch.fetcher, { tables: ['churches'] });
    await cache.query('services', sv.fetcher, { tables: ['services'] });
    bus.emit('churches');
    assert.equal(await cache.query('churches', ch.fetcher, { tables: ['churches'] }), 'ch2');
    assert.equal(await cache.query('services', sv.fetcher, { tables: ['services'] }), 'sv1');
  });

  test('one query listing several tables is dropped by any of them', async () => {
    const { cache, bus } = setup();
    cache.setIdentity(NS_A); cache.setBusLive(true);
    const f = counting((n) => n); const o = { tables: ['classes', 'services'] };
    await cache.query('k', f.fetcher, o);
    bus.emit('services');
    assert.equal(await cache.query('k', f.fetcher, o), 2);
  });

  test('an in-flight response that predates the change is NOT cached', async () => {
    const { cache, bus } = setup();
    cache.setIdentity(NS_A); cache.setBusLive(true);
    const m = manual<string>(); const o = { tables: ['churches'] };
    const p = cache.query('k', m.fetcher, o);
    await tick();
    bus.emit('churches');                 // the change lands while the request is out
    m.calls[0].resolve('old');
    assert.equal(await p, 'old');         // its own caller still gets it…
    assert.equal(cache.peek('k', o).state, 'missing'); // …but it is not stored
    const f = counting(() => 'new');
    assert.equal(await cache.query('k', f.fetcher, o), 'new');
  });

  test('a caller arriving after the change does not join the superseded flight', async () => {
    const { cache, bus } = setup();
    cache.setIdentity(NS_A); cache.setBusLive(true);
    const m = manual<string>(); const o = { tables: ['t'] };
    const p1 = cache.query('k', m.fetcher, o);
    await tick();
    bus.emit('t');
    const p2 = cache.query('k', m.fetcher, o);
    await tick();
    assert.equal(m.calls.length, 2);
    m.calls[0].resolve('old'); m.calls[1].resolve('new');
    assert.equal(await p1, 'old');
    assert.equal(await p2, 'new');
    assert.equal(cache.peek('k', o).data, 'new');
  });

  test('subscriptions: one per table, shared, and released when nothing needs them', async () => {
    const { cache, bus } = setup();
    cache.setIdentity(NS_A); cache.setBusLive(true);
    await cache.query('a', async () => 1, { tables: ['churches'] });
    await cache.query('b', async () => 2, { tables: ['churches', 'services'] });
    await cache.query('c', async () => 3, { tables: ['churches'] });
    assert.equal(bus.count('churches'), 1);
    assert.equal(bus.count('services'), 1);
    assert.equal(bus.subscribes, 2);
    cache.invalidateKey('b');
    assert.equal(bus.count('services'), 0);  // nothing uses it any more
    assert.equal(bus.count('churches'), 1);
    cache.setIdentity(null);                 // sign-out
    assert.equal(bus.total(), 0);
  });

  test('no leak after many cycles', async () => {
    const { cache, bus } = setup();
    cache.setIdentity(NS_A); cache.setBusLive(true);
    for (let i = 0; i < 50; i++) {
      await cache.query('k', async () => i, { tables: ['churches'] });
      bus.emit('churches');
    }
    assert.ok(bus.total() <= 1);
    cache.setIdentity(null);
    assert.equal(bus.total(), 0);
    assert.equal(cache.stats().entries, 0);
  });

  test('the failure of a fetch releases the subscription too', async () => {
    const { cache, bus } = setup();
    cache.setIdentity(NS_A);
    await assert.rejects(cache.query('k', async () => { throw new Error('x'); }, { tables: ['t'] }));
    assert.equal(bus.total(), 0);
  });

  test('invalidateTables with an array and with a string', async () => {
    const { cache } = setup();
    cache.setIdentity(NS_A);
    await cache.query('a', async () => 1, { tables: ['x'] });
    await cache.query('b', async () => 2, { tables: ['y'] });
    cache.invalidateTables(['x', 'y']);
    assert.equal(cache.stats().entries, 0);
    await cache.query('a', async () => 1, { tables: ['x'] });
    cache.invalidateTables('x');
    assert.equal(cache.stats().entries, 0);
  });
});

describe('stale-while-revalidate', () => {
  const o = { tables: ['churches'] };

  test('verified + expired TTL but inside the stale window: old value now, fresh value in the background', async () => {
    const { cache, clock } = setup();
    cache.setIdentity(NS_A); cache.setBusLive(true);
    const got: number[] = [];
    const f = counting((n) => n);
    await cache.query('k', f.fetcher, o);
    clock.t += DEFAULT_TTL_MS + 1;
    const r = await cache.query('k', f.fetcher, { ...o, onRevalidated: (d: number) => got.push(d) });
    assert.equal(r, 1);                  // instant, stale
    await tick();
    assert.equal(f.n, 2);                // revalidated once
    assert.deepEqual(got, [2]);
    assert.equal(await cache.query('k', f.fetcher, o), 2); // now fresh
    assert.equal(f.n, 2);
  });

  test('many stale reads trigger ONE revalidation', async () => {
    const { cache, clock } = setup();
    cache.setIdentity(NS_A); cache.setBusLive(true);
    const m = manual<number>();
    await cache.query('k', async () => 1, o);
    clock.t += DEFAULT_TTL_MS + 1;
    const reads = await Promise.all([cache.query('k', m.fetcher, o), cache.query('k', m.fetcher, o), cache.query('k', m.fetcher, o)]);
    assert.deepEqual(reads, [1, 1, 1]);
    assert.equal(m.calls.length, 1);
    m.calls[0].resolve(2);
    await tick();
    assert.equal(cache.peek('k', o).data, 2);
  });

  test('beyond the stale window the read blocks on a fresh fetch', async () => {
    const { cache, clock } = setup();
    cache.setIdentity(NS_A); cache.setBusLive(true);
    const f = counting((n) => n);
    await cache.query('k', f.fetcher, o);
    clock.t += DEFAULT_TTL_MS + DEFAULT_STALE_MS + 1;
    assert.equal(await cache.query('k', f.fetcher, o), 2);
  });

  test('a failed revalidation keeps the stale value and backs off, then retries', async () => {
    const { cache, clock } = setup();
    cache.setIdentity(NS_A); cache.setBusLive(true);
    await cache.query('k', async () => 'v1', o);
    clock.t += DEFAULT_TTL_MS + 1;
    let calls = 0;
    const failing = async () => { calls++; throw new Error('offline'); };
    assert.equal(await cache.query('k', failing, o), 'v1');
    await tick();
    assert.equal(calls, 1);
    assert.equal(await cache.query('k', failing, o), 'v1'); // inside the back-off → no new request
    await tick();
    assert.equal(calls, 1);
    clock.t += REVALIDATE_RETRY_MS + 1;
    assert.equal(await cache.query('k', async () => { calls++; return 'v2'; }, o), 'v1');
    await tick();
    assert.equal(calls, 2);
    assert.equal(cache.peek('k', o).data, 'v2');
  });

  test('UNVERIFIED data is served stale only when the caller can show the update', async () => {
    const { cache, clock } = setup();
    cache.setIdentity(NS_A);             // bus never live → unverified
    const f = counting((n) => n);
    await cache.query('k', f.fetcher, o);
    clock.t += DEFAULT_FALLBACK_TTL_MS + 1;
    // no onRevalidated → blocking refetch
    assert.equal(await cache.query('k', f.fetcher, o), 2);
    clock.t += DEFAULT_FALLBACK_TTL_MS + 1;
    // with onRevalidated → stale now, refreshed after
    const got: number[] = [];
    assert.equal(await cache.query('k', f.fetcher, { ...o, onRevalidated: (d: number) => got.push(d) }), 2);
    await tick();
    assert.deepEqual(got, [3]);
  });

  test('a revalidation that resolves after an identity change is neither stored nor announced', async () => {
    const { cache, clock } = setup();
    cache.setIdentity(NS_A); cache.setBusLive(true);
    await cache.query('k', async () => 'a-data', o);
    clock.t += DEFAULT_TTL_MS + 1;
    const m = manual<string>(); const got: string[] = [];
    await cache.query('k', m.fetcher, { ...o, onRevalidated: (d: string) => got.push(d) });
    await tick();
    cache.setIdentity(NS_B);
    m.calls[0].resolve('a-late');
    await tick();
    assert.deepEqual(got, []);
    assert.equal(cache.peek('k', o).state, 'missing');
  });

  test('staleIfError: a blocking failure falls back to the expired value; without it the error propagates', async () => {
    const { cache, clock } = setup();
    cache.setIdentity(NS_A);
    await cache.query('k', async () => 'old', {});
    clock.t += DEFAULT_FALLBACK_TTL_MS + 1;
    const failing = async (): Promise<string> => { throw new Error('down'); };
    await assert.rejects(cache.query('k', failing, {}), /down/);
    assert.equal(await cache.query('k', failing, { staleIfError: true }), 'old');
  });
});

describe('errors', () => {
  test('errors are never cached, every waiter sees them, the next call retries', async () => {
    const { cache } = setup();
    cache.setIdentity(NS_A);
    const m = manual<string>();
    const a = cache.query('k', m.fetcher); const b = cache.query('k', m.fetcher);
    const settled = Promise.allSettled([a, b]);
    await tick();
    m.calls[0].reject(new Error('net'));
    const r = await settled;
    assert.deepEqual(r.map((x) => x.status), ['rejected', 'rejected']);
    assert.equal(cache.stats().entries, 0);
    assert.equal(cache.stats().flights, 0);
    assert.equal(await cache.query('k', async () => 'ok'), 'ok');
  });

  test('shouldCache keeps a «no row» result out of the cache', async () => {
    const { cache } = setup();
    cache.setIdentity(NS_A);
    const f = counting((n) => (n === 1 ? null : { id: n }));
    const o = { shouldCache: (d: { id: number } | null) => d !== null };
    assert.equal(await cache.query('row', f.fetcher, o), null);
    assert.deepEqual(await cache.query('row', f.fetcher, o), { id: 2 });
    assert.deepEqual(await cache.query('row', f.fetcher, o), { id: 2 });
    assert.equal(f.n, 2);
  });

  test('force drops the key first', async () => {
    const { cache } = setup();
    cache.setIdentity(NS_A);
    const f = counting((n) => n);
    await cache.query('k', f.fetcher);
    assert.equal(await cache.query('k', f.fetcher, { force: true }), 2);
    assert.equal(await cache.query('k', f.fetcher), 2);
  });
});

describe('persistence', () => {
  test('persist → restore in a new page session (as UNVERIFIED)', async () => {
    const storage = new FakeStorage();
    const s1 = setup({ storage });
    s1.cache.setIdentity(NS_A); s1.cache.setBusLive(true);
    const o = { tables: ['churches'], persist: true };
    await s1.cache.query('lookup:churches', async () => [{ id: 1, name: 'x' }], o);
    assert.equal(storage.keys().length, 1);
    assert.ok(storage.keys()[0].startsWith(STORAGE_PREFIX));
    assert.ok(!storage.keys()[0].includes('user-a'), 'the raw uid must not appear in a storage key');

    // «reload»: a brand-new cache over the same sessionStorage
    const s2 = setup({ storage }); s2.clock.t = s1.clock.t;
    s2.cache.setIdentity(NS_A);
    const f = counting(() => [{ id: 2, name: 'new' }]);
    const r = await s2.cache.query('lookup:churches', f.fetcher, o);
    assert.deepEqual(r, [{ id: 1, name: 'x' }]);    // restored
    assert.equal(f.n, 0);                           // within the fallback TTL → no request
    // restored entries are not trusted for the long TTL
    s2.clock.t += DEFAULT_FALLBACK_TTL_MS + 1;
    assert.deepEqual(await s2.cache.query('lookup:churches', f.fetcher, o), [{ id: 2, name: 'new' }]);
  });

  test('restored entries still honour bus invalidation that arrives before the first read', async () => {
    const storage = new FakeStorage();
    const s1 = setup({ storage });
    s1.cache.setIdentity(NS_A);
    const o = { tables: ['churches'], persist: true };
    await s1.cache.query('k', async () => 'old', o);
    const s2 = setup({ storage }); s2.clock.t = s1.clock.t;
    s2.cache.setIdentity(NS_A);
    assert.equal(s2.bus.count('churches'), 1);      // subscribed from restore, before any read
    s2.bus.emit('churches');
    assert.equal(storage.keys().length, 0);
    assert.equal(await s2.cache.query('k', async () => 'new', o), 'new');
  });

  test('another identity never restores this one\'s entries — and they are purged', async () => {
    const storage = new FakeStorage();
    const s1 = setup({ storage });
    s1.cache.setIdentity(NS_A);
    await s1.cache.query('k', async () => 'secret-of-a', { persist: true });
    const s2 = setup({ storage }); s2.clock.t = s1.clock.t;
    s2.cache.setIdentity(NS_B);
    assert.equal(await s2.cache.query('k', async () => 'b-data', { persist: true }), 'b-data');
    assert.ok(storage.keys().every((k) => !k.includes(hashString(NS_A))));
    assert.ok(!Array.from(storage.map.values()).some((v) => v.includes('secret-of-a')));
  });

  test('without persist: nothing is written', async () => {
    const { cache, storage } = setup();
    cache.setIdentity(NS_A);
    await cache.query('k', async () => 1, {});
    assert.equal(storage!.keys().length, 0);
  });

  test('a corrupted / foreign / oversized storage entry is ignored and removed', async () => {
    const storage = new FakeStorage();
    storage.setItem(STORAGE_PREFIX + 'garbage', '{not json');
    storage.setItem(STORAGE_PREFIX + 'wrongshape', JSON.stringify({ v: 9 }));
    storage.setItem('unrelated-key', 'keep me');
    const s = setup({ storage });
    s.cache.setIdentity(NS_A);
    assert.equal(storage.getItem('unrelated-key'), 'keep me');
    assert.equal(storage.keys().filter((k) => k.startsWith(STORAGE_PREFIX)).length, 0);
    // oversized payloads are skipped
    await s.cache.query('big', async () => 'x'.repeat(300_000), { persist: true });
    assert.equal(storage.keys().filter((k) => k.startsWith(STORAGE_PREFIX)).length, 0);
  });

  test('a storage that throws (quota / private mode) does not break the query', async () => {
    const bad: StorageLike = {
      length: 0, key: () => null, getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => { throw new Error('nope'); },
    };
    const { cache } = setup({ storage: bad as unknown as FakeStorage });
    cache.setIdentity(NS_A);
    assert.equal(await cache.query('k', async () => 7, { persist: true }), 7);
  });

  test('invalidateKey / invalidateTables / invalidateAll clear storage too', async () => {
    const { cache, storage } = setup();
    cache.setIdentity(NS_A);
    await cache.query('a', async () => 1, { persist: true, tables: ['x'] });
    await cache.query('b', async () => 2, { persist: true, tables: ['y'] });
    await cache.query('c', async () => 3, { persist: true });
    cache.invalidateKey('c');
    assert.equal(storage!.keys().length, 2);
    cache.invalidateTables('x');
    assert.equal(storage!.keys().length, 1);
    cache.invalidateAll();
    assert.equal(storage!.keys().length, 0);
  });

  test('no storage at all → memory only', async () => {
    const { cache } = setup({ storage: null });
    cache.setIdentity(NS_A);
    assert.equal(await cache.query('k', async () => 1, { persist: true }), 1);
  });
});

describe('sign-out isolation', () => {
  test('sign-out disables the cache: pass-through, memory empty, storage purged, bus released', async () => {
    const { cache, storage, bus } = setup();
    cache.setIdentity(NS_A); cache.setBusLive(true);
    await cache.query('k', async () => 'secret', { persist: true, tables: ['churches'] });
    assert.equal(cache.stats().entries, 1);
    cache.setIdentity(null);
    assert.equal(cache.stats().entries, 0);
    assert.equal(storage!.keys().length, 0);
    assert.equal(bus.total(), 0);
    // while signed out nothing is shared or stored
    const f = counting((n) => n);
    assert.deepEqual([await cache.query('k', f.fetcher), await cache.query('k', f.fetcher)], [1, 2]);
    assert.equal(cache.peek('k').state, 'missing');
    assert.equal(storage!.keys().length, 0);
  });

  test('an in-flight request that resolves after sign-out is not stored', async () => {
    const { cache } = setup();
    cache.setIdentity(NS_A);
    const m = manual<string>();
    const p = cache.query('k', m.fetcher, { persist: true });
    await tick();
    cache.setIdentity(null);
    m.calls[0].resolve('late');
    assert.equal(await p, 'late');
    assert.equal(cache.stats().entries, 0);
  });

  test('sign back in as the same user → empty start (no resurrection of old memory)', async () => {
    const { cache } = setup({ storage: null });
    cache.setIdentity(NS_A);
    await cache.query('k', async () => 1);
    cache.setIdentity(null);
    cache.setIdentity(NS_A);
    assert.equal(cache.peek('k').state, 'missing');
  });
});

describe('account switching', () => {
  test('A → B: B never sees A\'s data (memory + storage + in-flight)', async () => {
    const { cache, storage } = setup();
    cache.setIdentity(NS_A);
    await cache.query('lookup:classes', async () => ['class-of-A'], { persist: true });
    const m = manual<string[]>();
    const inflightA = cache.query('lookup:services', m.fetcher, { persist: true });
    await tick();

    cache.setIdentity(NS_B);                       // the uid changed → everything of A is gone
    assert.equal(cache.peek('lookup:classes').state, 'missing');
    assert.equal(storage!.keys().length, 0);

    const fB = counting(() => ['class-of-B']);
    assert.deepEqual(await cache.query('lookup:classes', fB.fetcher, { persist: true }), ['class-of-B']);

    // A's request resolves late, under B's identity
    m.calls[0].resolve(['service-of-A']);
    assert.deepEqual(await inflightA, ['service-of-A']); // its own caller (A's screen) is served…
    assert.equal(cache.peek('lookup:services').state, 'missing'); // …but B never sees it
    const fB2 = counting(() => ['service-of-B']);
    assert.deepEqual(await cache.query('lookup:services', fB2.fetcher), ['service-of-B']);
    assert.ok(!Array.from(storage!.map.values()).some((v) => v.includes('of-A')));
  });

  test('a new request issued under B does not join a flight started under A', async () => {
    const { cache } = setup();
    cache.setIdentity(NS_A);
    const mA = manual<string>();
    const pA = cache.query('k', mA.fetcher);
    await tick();
    cache.setIdentity(NS_B);
    const mB = manual<string>();
    const pB = cache.query('k', mB.fetcher);
    await tick();
    assert.equal(mB.calls.length, 1, 'B must run its own fetch');
    mA.calls[0].resolve('A'); mB.calls[0].resolve('B');
    assert.equal(await pA, 'A');
    assert.equal(await pB, 'B');
    assert.equal(cache.peek('k').data, 'B');
  });

  test('suspend() (switch in progress) is a pass-through until the new identity is set', async () => {
    const { cache } = setup();
    cache.setIdentity(NS_A);
    await cache.query('k', async () => 'a');
    cache.suspend();
    assert.equal(cache.namespace, null);
    assert.equal(await cache.query('k', async () => 'during-switch'), 'during-switch');
    cache.setIdentity(NS_B);
    assert.equal(cache.peek('k').state, 'missing');
  });

  test('the same identity set again is a no-op (token refresh / profile reload keeps the cache)', async () => {
    const { cache } = setup();
    cache.setIdentity(NS_A);
    const f = counting((n) => n);
    await cache.query('k', f.fetcher);
    cache.setIdentity(buildNamespace({ uid: 'user-a', role: 'owner', status: 'approved', scopes: [] }));
    assert.equal(await cache.query('k', f.fetcher), 1);
    assert.equal(f.n, 1);
  });

  test('belongsTo matches by uid only', () => {
    const { cache } = setup();
    cache.setIdentity(NS_A);
    assert.equal(cache.belongsTo('user-a'), true);
    assert.equal(cache.belongsTo('user-b'), false);
    assert.equal(cache.belongsTo('user'), false);
    cache.setIdentity(null);
    assert.equal(cache.belongsTo('user-a'), false);
  });
});

describe('active place / scope / role changes', () => {
  const base = { uid: 'u1', role: 'church_manager', status: 'approved' };
  const P1 = { church_id: 'c1', service_id: null, class_id: null };
  const P2 = { church_id: 'c2', service_id: null, class_id: null };

  test('the namespace differs for a different active place, scope set, role or status', () => {
    const all = buildNamespace({ ...base, scopes: [P1, P2], activePlace: null });
    const one = buildNamespace({ ...base, scopes: [P1], activePlace: P1 });
    const two = buildNamespace({ ...base, scopes: [P2], activePlace: P2 });
    assert.equal(new Set([all, one, two]).size, 3);
    assert.notEqual(buildNamespace({ ...base, role: 'owner', scopes: [P1], activePlace: P1 }), one);
    assert.notEqual(buildNamespace({ ...base, status: 'pending', scopes: [P1], activePlace: P1 }), one);
  });

  test('scope ORDER does not matter (no needless cache loss)', () => {
    assert.equal(buildNamespace({ ...base, scopes: [P1, P2] }), buildNamespace({ ...base, scopes: [P2, P1] }));
  });

  test('switching the active place within the same user drops the previous place\'s data', async () => {
    const { cache, storage } = setup();
    cache.setIdentity(buildNamespace({ ...base, scopes: [P1], activePlace: P1 }));
    await cache.query('lookup:classes', async () => ['classes-of-c1'], { persist: true });
    cache.setIdentity(buildNamespace({ ...base, scopes: [P2], activePlace: P2 }));
    assert.equal(cache.peek('lookup:classes').state, 'missing');
    assert.equal(storage!.keys().length, 0);
    assert.deepEqual(await cache.query('lookup:classes', async () => ['classes-of-c2'], { persist: true }), ['classes-of-c2']);
    // …and back: c1's entries are NOT resurrected
    cache.setIdentity(buildNamespace({ ...base, scopes: [P1], activePlace: P1 }));
    assert.equal(cache.peek('lookup:classes').state, 'missing');
  });

  test('«all my places» ↔ one place are different identities', () => {
    const a = buildNamespace({ ...base, scopes: [P1, P2], activePlace: null });
    const b = buildNamespace({ ...base, scopes: [P1, P2], activePlace: P1 });
    assert.notEqual(a, b);
  });

  test('invalidateAll (permission / scope row changed) keeps the identity but empties everything', async () => {
    const { cache } = setup();
    cache.setIdentity(NS_A);
    await cache.query('k', async () => 1);
    cache.invalidateAll();
    assert.equal(cache.namespace, NS_A);
    assert.equal(cache.peek('k').state, 'missing');
  });
});

describe('bounds', () => {
  test('memory is capped (oldest dropped first)', async () => {
    const { cache } = setup({ storage: null });
    cache.setIdentity(NS_A);
    for (let i = 0; i < 320; i++) await cache.query(`k${i}`, async () => i);
    assert.ok(cache.stats().entries <= 300);
    assert.equal(cache.peek('k0').state, 'missing');
    assert.equal(cache.peek('k319').state, 'fresh');
  });
});
