'use client';

// ---------------------------------------------------------------------
// scanner-data — Phase 3 binding: the scanner's lookups + the intent prefetch.
// The rules are in src/lib/cache/scanner.ts (unit-tested); the cache is the
// Phase 1 singleton (cached-query.ts) — there is no second cache.
// ---------------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js';
import { cachedLookupRows, queryCacheEnabled } from '@/lib/cached-query';
import { createClient } from '@/lib/supabase/client';
import { loadScannerLookups as load, createScannerPrefetch, type ScannerLookups, type LookupFn } from '@/lib/cache/scanner';

const lookup: LookupFn = (supabase, table, orderBy, force) => cachedLookupRows(supabase, table, orderBy, force);

/** the scanner page's init read (cold → 6 parallel requests · warm → 0) */
export function loadScannerLookups<C, S, K, E, U, F>(supabase: SupabaseClient, force = false): Promise<ScannerLookups<C, S, K, E, U, F>> {
  return load<C, S, K, E, U, F>(lookup, supabase, force);
}

const prefetch = createScannerPrefetch({
  lookup,
  enabled: queryCacheEnabled,
  online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
});

/** fire-and-forget; safe to call from any event handler */
export function prefetchScanner(): void {
  if (typeof window === 'undefined') return;
  void prefetch(createClient());
}

const SCANNER_HREF = '/scanner';

/**
 * Spread on a <Link>: warms the scanner's lookups the moment the user shows intent
 * (mouse hover · first touch · keyboard focus), i.e. before the route chunk even arrives.
 * Any other href gets no handlers at all.
 */
export function scannerIntentProps(href: string): {
  onPointerEnter?: (e: { pointerType?: string }) => void; onTouchStart?: () => void; onFocus?: () => void;
} {
  if (href !== SCANNER_HREF) return {};
  return {
    onPointerEnter: (e) => { if (e.pointerType === 'mouse' || e.pointerType === undefined) prefetchScanner(); },
    onTouchStart: prefetchScanner,
    onFocus: prefetchScanner,
  };
}
