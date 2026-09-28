'use client';

// ---------- ReorderButtons — ▲ ▼ for the manual order of churches / services / classes ----------
// (migration 20260928130000). The settings pages show the two arrows on every
// card the caller may edit; moving swaps the item with its neighbour INSIDE
// its own group (churches globally · services of the same church · classes of
// the same service) and sends the whole group to `reorder_scope_items`, which
// renumbers it 1..n. Every list / select / tree in the app reads `sort_order`
// first, so the order chosen here is the order shown everywhere.

import { ChevronUp, ChevronDown, Loader2 } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ScopeTable = 'churches' | 'services' | 'classes';

/** Renumber the given siblings 1..n in this order (RLS decides who may) */
export async function reorderScopeItems(supabase: SupabaseClient, table: ScopeTable, ids: string[]) {
  const { error } = await supabase.rpc('reorder_scope_items', { p_table: table, p_ids: ids });
  if (error) throw error;
}

/**
 * Move `id` one step up / down inside `siblings` (already in display order)
 * and persist the new order. Returns the new order or null when nothing moved.
 */
export async function moveScopeItem<T extends { id: string }>(
  supabase: SupabaseClient, table: ScopeTable, siblings: T[], id: string, dir: -1 | 1,
): Promise<T[] | null> {
  const idx = siblings.findIndex((s) => s.id === id);
  const to = idx + dir;
  if (idx < 0 || to < 0 || to >= siblings.length) return null;
  const next = [...siblings];
  [next[idx], next[to]] = [next[to], next[idx]];
  await reorderScopeItems(supabase, table, next.map((s) => s.id));
  return next;
}

export function ReorderButtons({
  index, count, busy, onMove, label, tone = 'slate',
}: {
  /** position of the item inside its group (0-based) */
  index: number;
  /** size of the group */
  count: number;
  busy?: boolean;
  onMove: (dir: -1 | 1) => void;
  /** item name for the aria labels */
  label: string;
  tone?: 'slate' | 'primary' | 'accent' | 'sky';
}) {
  if (count < 2) return null;
  const cls: Record<NonNullable<typeof tone>, string> = {
    slate: 'bg-slate-50 text-slate-500 hover:bg-slate-100',
    primary: 'bg-primary-50 text-primary-600 hover:bg-primary-100',
    accent: 'bg-accent-50 text-accent-600 hover:bg-accent-100',
    sky: 'bg-sky-50 text-sky-600 hover:bg-sky-100',
  };
  return (
    <div className="flex shrink-0 flex-col gap-1" aria-label={`ترتيب ${label}`}>
      <button
        type="button"
        onClick={() => onMove(-1)}
        disabled={busy || index === 0}
        aria-label={`تحريك ${label} لأعلى`}
        title="لأعلى"
        className={`rounded-lg p-1 transition disabled:opacity-30 ${cls[tone]}`}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronUp className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={() => onMove(1)}
        disabled={busy || index === count - 1}
        aria-label={`تحريك ${label} لأسفل`}
        title="لأسفل"
        className={`rounded-lg p-1 transition disabled:opacity-30 ${cls[tone]}`}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
