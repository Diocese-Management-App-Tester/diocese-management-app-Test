'use client';

// ---------------------------------------------------------------------
// cachedQuery — the app-wide client cache (Phase 1 of the performance plan)
// ---------------------------------------------------------------------
// The rules live in src/lib/cache/query-cache.ts (read its header) and
// src/lib/cache/service.ts; both are unit-tested. This file only binds them
// to the real realtime bus and sessionStorage.
//
// Usage:
//   const rows = await cachedQuery('my:key', () => load(), { tables: ['churches'] });
//
// • Put EVERYTHING that changes the result into the key (table, columns,
//   filters, order) — the signed-in identity is added automatically.
// • List the bus `tables` the result depends on: that is what lets the entry
//   live for minutes yet never be stale (a change drops it instantly).
// • Never cache writes, session tokens or permission / role data. A query
//   whose RLS depends on permissions must list the permission tables and
//   must not use `persist`.
// ---------------------------------------------------------------------

import { createQueryService } from '@/lib/cache/service';
import type { CachedQueryOptions, NamespaceParts, StorageLike } from '@/lib/cache/query-cache';
import { onBusTable, onBusConnection, onAppResume, busConnected } from '@/lib/realtime';

function browserSessionStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined') return null;
    const s = window.sessionStorage;
    const probe = '__dma_qc_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null; // private mode / blocked storage → memory only
  }
}

const isBrowser = typeof window !== 'undefined';

/** one instance per page session; on the server it is an inert pass-through (no identity is ever set) */
const service = createQueryService({
  storage: isBrowser ? browserSessionStorage() : null,
  bus: isBrowser
    ? { onTable: onBusTable, onConnection: onBusConnection, connected: busConnected, onResume: onAppResume }
    : null,
});

export const cachedQuery = service.query;
export const peekQuery = service.peek;
export const invalidateQuery = service.invalidateKey;
export const invalidateQueryTables = service.invalidateTables;
export const cachedLookupRows = service.lookup;
export const cachedRow = service.row;
export const invalidateLookupTables = service.invalidateLookup;

/**
 * AuthProvider → who is signed in. A different value (another uid, another
 * active place, scope set, role or status) empties every cache; `null` =
 * signed out / not approved → the cache is disabled and storage purged.
 */
export function setQueryIdentity(parts: NamespaceParts | null): boolean { return service.setIdentity(parts); }

/** switching account / place, signing out: disable the cache right now, until the new identity is known */
export function suspendQueryCache(): void { service.suspend(); }

/** the current identity namespace (null = signed out / suspended); Phase 4 roster ties its data to it */
export function queryCacheNamespace(): string | null { return service.cache.namespace; }

/** realtime bus connected and past the settle window — only then can a bus message be relied on to keep data fresh */
export function queryBusTrusted(): boolean { return service.busTrusted(); }

/** fires when that trust is gained / lost (bus drop, reconnect, end of the post-identity-change settle window) */
export function onQueryBusTrust(fn: (ok: boolean) => void): () => void { return service.onBusTrust(fn); }

/** fires whenever the identity namespace changes (another account / place, sign-out) */
export function onQueryIdentity(fn: (ns: string | null) => void): () => void { return service.onIdentityChange(fn); }

/** true while an identity is set (approved + signed in) — i.e. while a cache fill can be reused */
export function queryCacheEnabled(): boolean { return service.cache.namespace !== null; }

/** true when the cache currently belongs to this uid */
export function queryCacheBelongsTo(uid: string): boolean { return service.belongsTo(uid); }

export type { CachedQueryOptions, NamespaceParts };
