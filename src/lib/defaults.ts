// Scoped defaults — الافتراضي لكل مستوى (migration 0048)
//
// An event / cause marked `is_default` is the default OF ITS OWN SCOPE:
//   (church, null, null)     → default for the whole church
//   (church, service, null)  → default for that service   (beats the church's)
//   (church, service, class) → default for that class     (beats the service's)
//
// Given the selection on the children / scanner pages (church → service →
// class, each possibly "all") the default is resolved MOST SPECIFIC FIRST:
//   class default → service default → church default → nothing.
//
// The DB keeps at most one default per exact scope (trigger) and exposes the
// same chain as `default_event_for()` / `default_cause_for()`; this module is
// the client-side mirror so the pages don't need a round trip.

import { ALL } from '@/lib/queries';

export interface ScopedDefaultRow {
  id: string;
  church_id: string;
  service_id: string | null;
  class_id: string | null;
  is_default: boolean;
}

export interface DefaultSelection {
  church: string; // ALL | uuid
  service: string; // ALL | uuid
  class: string; // ALL | uuid
}

const isSet = (v: string | undefined | null): v is string => !!v && v !== ALL;

/**
 * Pick the default row for the current selection.
 *
 * - Class chosen   → its class default, else the service default, else the church default.
 * - Service chosen → the service default, else the church default.
 * - Church chosen  → the church-wide default only.
 * - Nothing chosen → when exactly ONE church is visible to the user (RLS) we
 *   resolve as if that church were selected; otherwise no default (we cannot
 *   guess which church the servant means).
 *
 * `rows` is the full lookup list (already RLS-scoped); only rows whose scope
 * covers the selection are considered, so the picked row is always present in
 * the page's "visible" dropdown.
 */
export function pickScopedDefault<T extends ScopedDefaultRow>(
  rows: T[],
  sel: DefaultSelection,
  fallbackChurchId?: string | null
): T | null {
  const church = isSet(sel.church) ? sel.church : fallbackChurchId ?? null;
  if (!church) return null;
  const service = isSet(sel.service) ? sel.service : null;
  const cls = isSet(sel.class) ? sel.class : null;

  let best: T | null = null;
  let bestRank = -1;
  for (const r of rows) {
    if (!r.is_default || r.church_id !== church) continue;
    // the row's scope must cover the selection
    if (r.service_id !== null && r.service_id !== service) continue;
    if (r.class_id !== null && r.class_id !== cls) continue;
    // most specific wins: class (2) > service (1) > church (0)
    const rank = r.class_id !== null ? 2 : r.service_id !== null ? 1 : 0;
    if (rank > bestRank) { best = r; bestRank = rank; }
  }
  return best;
}

/** Arabic label of the level a default row applies to (for badges). */
export function defaultLevelLabel(r: { service_id: string | null; class_id: string | null }): string {
  return r.class_id !== null ? 'افتراضي الفصل' : r.service_id !== null ? 'افتراضي الخدمة' : 'افتراضي الكنيسة';
}
