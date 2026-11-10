// Scanner data-layer measurement (Phase 3 + Phase 4).
//
//   node --experimental-strip-types scripts/measure-scanner.ts [--json]
//
// WHAT IS REAL: the cache is the app's real Phase 1 service (createQueryService);
// request COUNTS are exact for the data layer.
// WHAT IS SIMULATED: the network (a fixed round-trip time) and the time the
// browser needs to download/hydrate the /scanner route chunk. There is no
// Supabase backend or browser in the sandbox, so these are NOT field
// measurements — they show the shape of the saving, not a production number.
// Tunable: RTT_MS, CHUNK_MS, RUNS.

import { createQueryService } from '../src/lib/cache/service.ts';
import { loadScannerLookups, createScannerPrefetch } from '../src/lib/cache/scanner.ts';
import { createScannerRoster, identifyScan, type RosterRow, type RosterScope } from '../src/lib/cache/roster.ts';

const RTT_MS = Number(process.env.RTT_MS ?? 80);
const CHUNK_MS = Number(process.env.CHUNK_MS ?? 150);
const RUNS = Number(process.env.RUNS ?? 7);

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

function fakeNet() {
  const log: { what: string; at: number }[] = [];
  const client = {
    from(table: string) {
      const b: Record<string, unknown> = {
        select: () => b, order: () => b,
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
          log.push({ what: `from:${table}`, at: performance.now() });
          return wait(RTT_MS).then(() => ({ data: [{ id: table }], error: null })).then(res, rej);
        },
      };
      return b;
    },
    rpc(name: string) {
      log.push({ what: `rpc:${name}`, at: performance.now() });
      return wait(RTT_MS).then(() => ({ data: name === 'family_lookup' ? { matched: 'person', family: null } : [{ id: 'e1' }], error: null }));
    },
  };
  return { client: client as never, log };
}

function newService() {
  const svc = createQueryService({
    bus: { onTable: () => () => {}, onConnection: () => () => {}, connected: () => true, onResume: () => () => {} },
    storage: null,
  });
  svc.setIdentity({ uid: 'u1', role: 'class_servant', status: 'approved', scopes: [{ church_id: 'c1', service_id: 's1', class_id: 'k1' }] });
  return svc;
}

// ---- BASELINE = the exact call pattern of main's scanner (copied) ----
type Svc = ReturnType<typeof newService>;
export function baselineLoadLookups(svc: Svc, client: never) {
  return Promise.all([
    svc.lookup(client, 'churches', { column: 'name' }, false),
    svc.lookup(client, 'services', { column: 'name' }, false),
    svc.lookup(client, 'classes', { column: 'name' }, false),
    svc.lookup(client, 'events', { column: 'event_date', ascending: false, nullsFirst: false }, false),
    svc.lookup(client, 'causes', { column: 'name' }, false),
    svc.lookup(client, 'call_feedbacks', { column: 'sort_order' }, false),
  ]);
}
/** main's handleQr: family lookup, THEN (if no family) the national-id lookup */
export async function baselineScan(client: { rpc: (n: string, a?: unknown) => Promise<{ data: unknown; error: unknown }> }, familyOn: boolean) {
  if (familyOn) {
    try { const fam = (await client.rpc('family_lookup', {})).data as { matched: string; family: unknown }; if (fam.matched === 'family' || (fam.matched === 'person' && fam.family)) return 'family'; } catch { /* fall through */ }
  }
  await client.rpc('lookup_enrollments_by_national_id', {});
  return 'enrollments';
}

export type Row = { scenario: string; requests: number; readyMs: number };

export async function measureBaseline(): Promise<Row[]> {
  const out: Row[] = [];
  const reps = async (name: string, fn: () => Promise<{ requests: number; ms: number }>) => {
    const rs: { requests: number; ms: number }[] = [];
    for (let i = 0; i < RUNS; i++) rs.push(await fn());
    out.push({ scenario: name, requests: rs[0].requests, readyMs: Math.round(median(rs.map((r) => r.ms))) });
  };

  await reps('init · cold (route chunk + 6 lookups after mount)', async () => {
    const svc = newService(); const { client, log } = fakeNet(); const t0 = performance.now();
    await wait(CHUNK_MS);                       // route chunk download + hydrate, THEN the effect fires
    await baselineLoadLookups(svc, client);
    return { requests: log.length, ms: performance.now() - t0 };
  });
  await reps('init · warm (second visit inside the TTL)', async () => {
    const svc = newService(); const { client, log } = fakeNet();
    await baselineLoadLookups(svc, client); const before = log.length; const t0 = performance.now();
    await wait(CHUNK_MS);
    await baselineLoadLookups(svc, client);
    return { requests: log.length - before, ms: performance.now() - t0 };
  });
  await reps('scan · person WITHOUT family (family module on)', async () => {
    const { client, log } = fakeNet(); const t0 = performance.now();
    await baselineScan(client as never, true);
    return { requests: log.length, ms: performance.now() - t0 };
  });
  await reps('scan · family member (picker opens)', async () => {
    const { client, log } = fakeNet(); const t0 = performance.now();
    // main: family matched → no second request. (stub answers 'person' without family, so emulate the family answer)
    const c2 = { rpc: async (n: string) => { log.push({ what: `rpc:${n}`, at: performance.now() }); await wait(RTT_MS); return { data: { matched: 'family', family: {} }, error: null }; } };
    await baselineScan(c2 as never, true);
    return { requests: log.length, ms: performance.now() - t0 };
  });
  await reps('scan · family module OFF', async () => {
    const { client, log } = fakeNet(); const t0 = performance.now();
    await baselineScan(client as never, false);
    return { requests: log.length, ms: performance.now() - t0 };
  });
  return out;
}

// ---- AFTER = the REAL Phase 3 code (loadScannerLookups + createScannerPrefetch) ----
export type After = { scenario: string; requests: number; roster_ms: number; ready_ms: number; redundant: number };

/**
 * Timeline (all from the moment the user COMMITS to navigating, t=0 = click):
 *   prefetch fires `lead` ms BEFORE the click (hover / touchstart), the route chunk then needs CHUNK_MS,
 *   the page effect then calls the loader.
 *   roster_ms = until the six lookups are in the page's hands · ready_ms = same moment (the page is
 *   usable as soon as the lookups are set; there is no other init read) · redundant = requests beyond one per table.
 */
async function afterRun(lead: number, prefetchOn: boolean) {
  const svc = newService(); const { client, log } = fakeNet();
  const lookup = (sb: never, t: never, o: never, f: boolean) => svc.lookup(sb, t, o, f);
  const prefetch = createScannerPrefetch({ lookup: lookup as never, enabled: () => true });
  const t0 = performance.now();
  if (prefetchOn) {
    void prefetch(client);                       // pointerenter / touchstart at t0
    await wait(lead);                             // …the user keeps moving towards the click
  }
  const click = performance.now();
  await wait(CHUNK_MS);                           // route chunk
  await loadScannerLookups(lookup as never, client, false); // page init
  const done = performance.now();
  void t0;
  return { requests: log.length, ms: done - click, redundant: Math.max(0, log.length - 6) };
}

export async function measureAfter(): Promise<After[]> {
  const out: After[] = [];
  const reps = async (name: string, lead: number, on: boolean) => {
    const rs = []; for (let i = 0; i < RUNS; i++) rs.push(await afterRun(lead, on));
    const ms = Math.round(median(rs.map((r) => r.ms)));
    out.push({ scenario: name, requests: rs[0].requests, roster_ms: ms, ready_ms: ms, redundant: rs[0].redundant });
  };
  await reps('init · cold, NO prefetch (Phase 3 loader only)', 0, false);
  await reps('init · cold, prefetch fires at click (lead 0 ms)', 0, true);
  await reps('init · cold, prefetch 100 ms before click (hover/touchstart)', 100, true);
  await reps('init · cold, prefetch 250 ms before click (desktop hover)', 250, true);
  // warm second visit
  {
    const rs: { requests: number; ms: number }[] = [];
    for (let i = 0; i < RUNS; i++) {
      const svc = newService(); const { client, log } = fakeNet();
      const lookup = (sb: never, t: never, o: never, f: boolean) => svc.lookup(sb, t, o, f);
      await loadScannerLookups(lookup as never, client, false); const b = log.length; const t = performance.now();
      await wait(CHUNK_MS); await loadScannerLookups(lookup as never, client, false);
      rs.push({ requests: log.length - b, ms: performance.now() - t });
    }
    out.push({ scenario: 'init · warm (second visit) with Phase 3', requests: rs[0].requests, roster_ms: Math.round(median(rs.map((r) => r.ms))), ready_ms: Math.round(median(rs.map((r) => r.ms))), redundant: 0 });
  }
  return out;
}

// =====================================================================
// Phase 4 — roster prefetch. REAL roster code (createScannerRoster / identifyScan);
// fake server table + bus. Request COUNTS are exact. Latency below = sequential
// lookup requests per scan × RTT_MS (a model: no backend in the sandbox).
// =====================================================================
interface P4Row extends RosterRow { name: string }
const P4_SCOPE: RosterScope = { church: 'c1', service: 's1', class: 'k1' };
const p4row = (i: number, cls = 'k1'): P4Row => ({ id: `e${i}`, person_id: `p${i}`, church_id: 'c1', service_id: 's1', class_id: cls, status: 'active', created_at: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z`, name: `kid ${i}`, person: { id: `p${i}`, national_id: `n${i}` } });

function p4env(rows: P4Row[]) {
  const c = { pages: 0, byIds: 0, rpc: 0, family: 0, inserts: 0 };
  const trust = new Set<(ok: boolean) => void>();
  const roster = createScannerRoster<P4Row, string>({
    fetchPage: async (_cl, sc, page, size) => {
      c.pages++;
      const list = rows.filter((r) => r.class_id === sc.class).slice(page * size, page * size + size + 1);
      return { rows: list.length > size ? list.slice(0, size) : list, hasMore: list.length > size };
    },
    fetchByIds: async (_cl, ids) => { c.byIds++; return rows.filter((r) => ids.includes(r.id)); },
    namespace: () => 'ns', trusted: () => true,
    bus: { onTable: () => () => {}, onTrust: (f) => { trust.add(f); return () => { trust.delete(f); }; }, onResume: () => () => {}, onIdentity: () => () => {} },
  });
  const rpc = (nid: string) => { c.rpc++; return Promise.resolve({ data: rows.filter((r) => r.person.national_id === nid), error: null as unknown }); };
  return { roster, c, rpc, rows };
}

export type P4Result = { scenario: string; scans: number; before: number; after: number; saved: string; before_ms_per_scan: number; after_ms_per_scan: number };

/** `scans` badge scans of distinct children of a class of `size`, `unknownEvery`-th is an unknown id. */
async function p4scenario(name: string, size: number, scans: number, familyOn: boolean, opts: { dupEvery?: number; unknownEvery?: number } = {}): Promise<P4Result> {
  const rows = Array.from({ length: size }, (_, i) => p4row(i));
  const ids: string[] = [];
  for (let i = 0; i < scans; i++) {
    if (opts.unknownEvery && i % opts.unknownEvery === opts.unknownEvery - 1) ids.push(`unknown${i}`);
    else if (opts.dupEvery && i % opts.dupEvery === opts.dupEvery - 1 && ids.length) ids.push(ids[ids.length - 1]);
    else ids.push(`n${i % size}`);
  }
  // BEFORE (main): per scan = [family_lookup if family mode] + lookup_enrollments_by_national_id
  const before = ids.length * (familyOn ? 2 : 1);
  // AFTER: real roster. family_lookup is untouched (still first, server); the RPC only when the roster does not decide.
  const t = p4env(rows);
  await t.roster.load('c', P4_SCOPE);
  const rosterRequests = t.c.pages;
  let fam = 0;
  for (const nid of ids) {
    if (familyOn) fam++;
    await identifyScan(t.roster, 'c', nid, P4_SCOPE, (r) => r.class_id === 'k1', t.rpc);
  }
  const after = rosterRequests + t.c.byIds + fam + t.c.rpc;
  const lookupPerScanAfter = (fam + t.c.rpc) / ids.length;        // requests ON the scan path (roster load is before the first scan)
  const lookupPerScanBefore = before / ids.length;
  return {
    scenario: name, scans: ids.length, before, after,
    saved: `${(((before - after) / before) * 100).toFixed(1)}%`,
    before_ms_per_scan: Math.round(lookupPerScanBefore * RTT_MS), after_ms_per_scan: Math.round(lookupPerScanAfter * RTT_MS),
  };
}

export async function measurePhase4(): Promise<P4Result[]> {
  const out: P4Result[] = [];
  for (const familyOn of [false, true]) {
    const tag = familyOn ? 'family mode ON ' : 'family mode OFF';
    out.push(await p4scenario(`${tag} · 60-child class, 60 scans`, 60, 60, familyOn));
    out.push(await p4scenario(`${tag} · 200-child class, 300 scans (busy event)`, 200, 300, familyOn));
    out.push(await p4scenario(`${tag} · 200-child class, 300 scans, 10% unknown`, 200, 300, familyOn, { unknownEvery: 10 }));
    out.push(await p4scenario(`${tag} · 200-child class, 300 scans, 20% duplicate`, 200, 300, familyOn, { dupEvery: 5 }));
    out.push(await p4scenario(`${tag} · 2,000-child scope, 600 scans`, 2000, 600, familyOn));
    out.push(await p4scenario(`${tag} · 3,500-child scope (over cap → server), 100 scans`, 3500, 100, familyOn));
  }
  return out;
}

async function main() {
  const rows = await measureBaseline();
  const after = await measureAfter();
  const p4 = await measurePhase4();
  if (process.argv.includes('--json')) console.log(JSON.stringify({ rows, after, p4 }));
  else {
    console.log(`# SIMULATED network RTT ${RTT_MS} ms, route chunk ${CHUNK_MS} ms, median of ${RUNS}. Request counts are exact; times are model output, not field data.`);
    console.log('\n## BEFORE (main: page-mount loader, no prefetch)');
    for (const r of rows) console.log(`${r.scenario.padEnd(60)} requests=${String(r.requests).padStart(2)}  ready=${String(r.readyMs).padStart(4)} ms`);
    console.log('\n## AFTER (Phase 3 code) — times measured from the click');
    for (const r of after) console.log(`${r.scenario.padEnd(60)} requests=${String(r.requests).padStart(2)}  lookups-available=ready=${String(r.ready_ms).padStart(4)} ms  redundant=${r.redundant}`);
    console.log('\n## PHASE 4 — scanner roster prefetch (requests = roster pages + by-ids + family_lookup + lookup RPC; attendance inserts are identical before/after and excluded)');
    console.log('   latency column = lookup requests on the scan path × RTT (modelled, not field data)');
    for (const r of p4) console.log(`${r.scenario.padEnd(62)} scans=${String(r.scans).padStart(3)}  before=${String(r.before).padStart(4)}  after=${String(r.after).padStart(4)}  saved=${r.saved.padStart(6)}  lookup/scan ${String(r.before_ms_per_scan).padStart(3)}→${String(r.after_ms_per_scan).padStart(3)} ms`);
  }
}

if (process.argv[1]?.endsWith('measure-scanner.ts') && !process.env.MEASURE_IMPORT_ONLY) {
  void main();
}
