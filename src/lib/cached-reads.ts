'use client';

// ---------------------------------------------------------------------
// cached-reads — Phase 2 binding (statistics · dashboard · follow-up ·
// owner persons). The rules, keys and dependency tables live in
// src/lib/cache/reads.ts (unit-tested); this file only hands it the Phase 1
// `cachedQuery` singleton — there is no second cache.
//
//   reads.rpc(supabase, 'stats_day_summary', args, { force })   // cached under name + ALL args
//   reads.rpcSoft(...)                                          // error → null (never cached)
//   { force: true }   realtime reload · resume · «تحديث» · after a write
//   { bypass: true }  select-all before a bulk delete · merge search
// ---------------------------------------------------------------------

import { cachedQuery, invalidateQueryTables } from '@/lib/cached-query';
import { createReads, ALL_READ_TABLES } from '@/lib/cache/reads';

export type { ReadOpts, RpcReadOpts, FollowUpRosterRow } from '@/lib/cache/reads';

export const reads = createReads({ query: cachedQuery });

/**
 * Something changed the data WITHOUT telling the bus (a backup restore runs
 * with the zzz_rt_* triggers disabled) → drop every Phase 2 entry.
 */
export function invalidateReads(): void {
  invalidateQueryTables(ALL_READ_TABLES);
}
