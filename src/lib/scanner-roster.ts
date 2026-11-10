'use client';

// ---------------------------------------------------------------------
// scanner-roster — Phase 4 binding: the scope's roster, in memory.
// The rules (guards, bus handling, fallbacks) are in src/lib/cache/roster.ts
// (unit-tested); this file only hands it the real loaders and the real bus /
// identity signals of the Phase 1 cache. Memory only — nothing is persisted.
//
// The roster is loaded with fetchEnrollmentsPage(kind:'all') — the same query,
// columns, RLS and ordering as the list screens — because the server RPC it
// stands in for (lookup_enrollments_by_national_id) also returns every kind.
// ---------------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchEnrollmentsPage, fetchEnrollmentsByIds } from '@/lib/queries';
import { onBusTable, onAppResume } from '@/lib/realtime';
import { queryCacheNamespace, queryBusTrusted, onQueryBusTrust, onQueryIdentity } from '@/lib/cached-query';
import { createScannerRoster } from '@/lib/cache/roster';
import type { EnrollmentWithPerson } from '@/lib/types';

export const scannerRoster = createScannerRoster<EnrollmentWithPerson, SupabaseClient>({
  fetchPage: (client, scope, page, size) => fetchEnrollmentsPage(client, scope, { page, pageSize: size, kind: 'all' }),
  fetchByIds: (client, ids) => fetchEnrollmentsByIds(client, ids),
  namespace: queryCacheNamespace,
  trusted: queryBusTrusted,
  bus: {
    onTable: (table, fn) => onBusTable(table, fn),
    onTrust: onQueryBusTrust,
    onResume: onAppResume,
    onIdentity: onQueryIdentity,
  },
});
