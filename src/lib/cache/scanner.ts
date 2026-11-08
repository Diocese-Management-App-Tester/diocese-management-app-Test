// ---------------------------------------------------------------------
// scanner — Phase 3: the data the attendance scanner needs to START.
// ---------------------------------------------------------------------
// There is no "roster" read on the scanner (nobody downloads the enrollments
// up front: a scan asks the database about ONE national id). What the page
// needs before the servant can pick a scope is the six small reference lookups
// below. They already live in the Phase 1 cache (service.lookup); this module
// only gives them ONE definition, so that the scanner page and the
// navigation-intent prefetch use the SAME cache keys (a prefetch is then a
// plain cache fill, never a second copy).
//
// Deliberately NOT here (and never cached — see the PR / scanner-wiring tests):
//   family_lookup · lookup_enrollments_by_national_id · attendance_log reads
//   (duplicate / already-scanned checks) · the remove-attendance select ·
//   enrollments.points · contact_log reads · the manual search · every write.
// Those decide whether a scan is accepted, or show live state, so they always
// go to the database.
//
// Framework-free: the cache lookup function is injected (tests use the real
// Phase 1 service with a fake client).
// ---------------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LookupTable, OrderBy } from './service.ts';

export type LookupFn = <T>(supabase: SupabaseClient, table: LookupTable, orderBy: OrderBy, force: boolean) => Promise<T[]>;

/** the six lookups, with the exact ordering the scanner (and the children page) always used */
export const SCANNER_LOOKUPS = {
  churches: { column: 'name' },
  services: { column: 'name' },
  classes: { column: 'name' },
  events: { column: 'event_date', ascending: false, nullsFirst: false },
  causes: { column: 'name' },
  call_feedbacks: { column: 'sort_order' },
} as const satisfies Record<LookupTable, OrderBy>;

export interface ScannerLookups<C, S, K, E, U, F> {
  churches: C[]; services: S[]; classes: K[]; events: E[]; causes: U[]; feedbacks: F[];
}

/**
 * Load all six IN PARALLEL (independent reads). An individual failure yields
 * `[]` for that table (the cache's contract) and is never cached, so the next
 * call retries. `force` bypasses a fresh entry (explicit refresh).
 */
export async function loadScannerLookups<C = unknown, S = unknown, K = unknown, E = unknown, U = unknown, F = unknown>(
  lookup: LookupFn, supabase: SupabaseClient, force = false,
): Promise<ScannerLookups<C, S, K, E, U, F>> {
  const [churches, services, classes, events, causes, feedbacks] = await Promise.all([
    lookup<C>(supabase, 'churches', SCANNER_LOOKUPS.churches, force),
    lookup<S>(supabase, 'services', SCANNER_LOOKUPS.services, force),
    lookup<K>(supabase, 'classes', SCANNER_LOOKUPS.classes, force),
    lookup<E>(supabase, 'events', SCANNER_LOOKUPS.events, force),
    lookup<U>(supabase, 'causes', SCANNER_LOOKUPS.causes, force),
    lookup<F>(supabase, 'call_feedbacks', SCANNER_LOOKUPS.call_feedbacks, force),
  ]);
  return { churches, services, classes, events, causes, feedbacks };
}

export interface PrefetchEnv {
  lookup: LookupFn;
  /** true only while a cache identity exists (approved, signed in). Without one the cache is a
   *  pass-through, so a prefetch would be a wasted request that nobody could reuse. */
  enabled: () => boolean;
  online?: () => boolean;
  now?: () => number;
  /** minimum gap between two prefetch ATTEMPTS (a failed one is not cached, so without this every
   *  hover while offline / during an outage would re-fire six requests) */
  minGapMs?: number;
}

export const PREFETCH_MIN_GAP_MS = 10_000;

/**
 * Warm the lookups before the scanner route mounts (hover / touch / focus on a link to it).
 * Never forces, never throws, never blocks: a fresh entry makes it a no-op, an in-flight one is
 * shared (query dedupe), a failure leaves nothing behind.
 */
export function createScannerPrefetch(env: PrefetchEnv) {
  const now = env.now ?? Date.now;
  const gap = env.minGapMs ?? PREFETCH_MIN_GAP_MS;
  let last = -Infinity;
  return function prefetchScanner(supabase: SupabaseClient): Promise<boolean> {
    if (!env.enabled()) return Promise.resolve(false);
    if (env.online && !env.online()) return Promise.resolve(false);
    const t = now();
    if (t - last < gap) return Promise.resolve(false);
    last = t;
    return loadScannerLookups(env.lookup, supabase, false).then(() => true, () => false);
  };
}
