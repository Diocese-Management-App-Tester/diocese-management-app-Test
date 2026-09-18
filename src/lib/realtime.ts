'use client';

import { useEffect, useRef } from 'react';
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

/**
 * Debounced realtime subscription.
 *
 * WHY: every scan on Sunday inserts an `attendance_log` row AND (via trigger)
 * updates an `enrollments` row → 2 events. Before, every open screen reacted
 * to every event by re-downloading the full list, so the work grew as
 * scans × screens × rows. This hook:
 *
 *   • coalesces bursts of events into ONE reload (trailing debounce),
 *   • never overlaps reloads (a reload that arrives while one is in flight
 *     is queued as a single follow-up),
 *   • supports optional server-side `filter` per table so a class servant is
 *     not woken up by another church's changes,
 *   • pauses while the tab is hidden and does a single refresh on return —
 *     a phone in a pocket costs nothing.
 *
 * `onChange` may receive the payload for cheap local patches; callers that
 * need a full refetch just pass their `load`.
 */
/**
 * Realtime channel topics MUST be unique per subscription.
 *
 * `supabase.channel(topic)` returns the EXISTING channel when one with the
 * same topic is already registered on the (singleton) browser client. If that
 * channel has already been `subscribe()`d, calling `.on('postgres_changes')`
 * on it throws «cannot add postgres_changes callbacks … after subscribe()» —
 * which happened whenever two mounted components (or a React strict-mode
 * effect re-run racing the async `removeChannel`) used the same topic and
 * crashed the whole page (the child portal could not be opened).
 *
 * `uniqueTopic('child-msgs')` → `child-msgs-<time>-<n>`: readable prefix,
 * never colliding.
 */
let topicSeq = 0;
export function uniqueTopic(base: string): string {
  topicSeq += 1;
  return `${base}-${Date.now().toString(36)}-${topicSeq}`;
}

export interface RealtimeTableSpec {
  table: string;
  /** PostgREST-style filter, e.g. `church_id=eq.<uuid>` */
  filter?: string;
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
}

export function useDebouncedRealtime(
  supabase: SupabaseClient,
  channelName: string,
  tables: RealtimeTableSpec[],
  reload: () => Promise<unknown> | void,
  opts: { enabled?: boolean; delayMs?: number } = {}
) {
  const { enabled = true, delayMs = 1200 } = opts;
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  // Stable key for the table spec so effect deps don't churn on re-render
  const specKey = JSON.stringify(tables);

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let pending = false;
    let disposed = false;

    const run = async () => {
      if (disposed) return;
      if (inFlight) { pending = true; return; }
      inFlight = true;
      try {
        await reloadRef.current();
      } finally {
        inFlight = false;
        if (pending && !disposed) {
          pending = false;
          schedule();
        }
      }
    };

    const schedule = () => {
      if (document.visibilityState === 'hidden') { pending = true; return; }
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, delayMs);
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible' && pending) {
        pending = false;
        schedule();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    // unique topic per subscription — see uniqueTopic()
    let channel: RealtimeChannel = supabase.channel(uniqueTopic(channelName));
    (JSON.parse(specKey) as RealtimeTableSpec[]).forEach((t) => {
      channel = channel.on(
        'postgres_changes',
        { event: t.event ?? '*', schema: 'public', table: t.table, ...(t.filter ? { filter: t.filter } : {}) },
        schedule
      );
    });
    channel.subscribe();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, channelName, specKey, enabled, delayMs]);
}

/**
 * Build the realtime filter that matches the caller's own scope, so the
 * server only pushes changes he can actually see. Returns undefined for the
 * owner (sees everything) or when the column is not scoped.
 */
export function scopeFilter(
  profile: {
    role: string;
    church_id: string | null;
    service_id: string | null;
    class_id: string | null;
  } | null,
  /**
   * 0045: every place of the caller (useAuth().scopes). A servant bound to
   * SEVERAL places cannot be expressed as one `col=eq.` filter — the caller
   * then gets the unfiltered stream (RLS still decides what he receives);
   * with one common church / service we narrow to that column instead.
   */
  scopes?: { church_id: string; service_id: string | null; class_id: string | null }[],
): string | undefined {
  if (!profile || profile.role === 'owner') return undefined;
  if (scopes && scopes.length > 1) {
    const classes = new Set(scopes.map((s) => s.class_id ?? ''));
    if (classes.size === 1 && !classes.has('')) return `class_id=eq.${scopes[0].class_id}`;
    const services = new Set(scopes.map((s) => s.service_id ?? ''));
    if (services.size === 1 && !services.has('')) return `service_id=eq.${scopes[0].service_id}`;
    const churches = new Set(scopes.map((s) => s.church_id));
    if (churches.size === 1) return `church_id=eq.${scopes[0].church_id}`;
    return undefined;
  }
  if (profile.class_id) return `class_id=eq.${profile.class_id}`;
  if (profile.service_id) return `service_id=eq.${profile.service_id}`;
  if (profile.church_id) return `church_id=eq.${profile.church_id}`;
  return undefined;
}
