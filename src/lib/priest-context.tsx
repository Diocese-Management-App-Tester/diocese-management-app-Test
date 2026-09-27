'use client';

// ---------- Priest portal session (بوابة الكاهن) ----------
// Holds the token + the loaded profile + the two shared lists (confessors ·
// appointments) so header / menu / pages fetch ONCE. `PriestShell`
// redirects to /login?as=priest when there is no token.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  clearPriestToken, fetchPriestProfile, getPriestToken, priestLogout, priestSessionTouch, priestErrorMessage,
  fetchConfessors, fetchAppointments, type PriestProfile, type Confessor, type Appointment,
} from '@/lib/priest-portal';

interface PriestState {
  token: string | null;
  profile: PriestProfile | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  logout: () => void;
  confessors: Confessor[] | null;
  reloadConfessors: () => void;
  appointments: Appointment[] | null;
  reloadAppointments: () => void;
  /** reload everything (profile counters + both lists) */
  reloadAll: () => void;
}

const Ctx = createContext<PriestState>({
  token: null, profile: null, loading: true, error: null,
  refresh: async () => {}, logout: () => {},
  confessors: null, reloadConfessors: () => {},
  appointments: null, reloadAppointments: () => {},
  reloadAll: () => {},
});

function startPoll(fn: () => void, everyMs = 45_000): () => void {
  const t = setInterval(() => { if (document.visibilityState === 'visible') fn(); }, everyMs);
  return () => clearInterval(t);
}

export function PriestProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<PriestProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const dropSession = useCallback(() => {
    clearPriestToken();
    setToken(null);
    setProfile(null);
  }, []);

  const load = useCallback(async (t: string) => {
    try {
      const p = await fetchPriestProfile(supabase, t);
      setProfile(p);
      setError(null);
    } catch (e) {
      const raw = ((e as { message?: string } | null)?.message ?? '');
      if (raw.includes('session_expired') || raw.includes('account_stopped') || raw.includes('invalid_code')) dropSession();
      setError(priestErrorMessage(e));
    }
  }, [supabase, dropSession]);

  useEffect(() => {
    const t = getPriestToken();
    setToken(t);
    if (!t) { setLoading(false); return; }
    (async () => {
      try { await priestSessionTouch(supabase, t); }
      catch (e) {
        const raw = ((e as { message?: string } | null)?.message ?? '');
        if (raw.includes('session_expired') || raw.includes('account_stopped') || raw.includes('invalid_code')) {
          dropSession(); setError(priestErrorMessage(e)); setLoading(false); return;
        }
      }
      await load(t);
      setLoading(false);
    })();
  }, [load, supabase, dropSession]);

  useEffect(() => {
    if (!token) return;
    const onVisible = () => { if (document.visibilityState === 'visible') { priestSessionTouch(supabase, token).catch(() => {}); load(token); } };
    document.addEventListener('visibilitychange', onVisible);
    const stop = startPoll(() => load(token), 60_000);
    return () => { document.removeEventListener('visibilitychange', onVisible); stop(); };
  }, [token, supabase, load]);

  const refresh = useCallback(async () => { if (token) await load(token); }, [token, load]);

  const logout = useCallback(() => {
    const t = getPriestToken();
    if (t) priestLogout(supabase, t).catch(() => {});
    dropSession();
    setError(null);
  }, [supabase, dropSession]);

  // ---- confessors
  const [confessors, setConfessors] = useState<Confessor[] | null>(null);
  const [cTick, setCTick] = useState(0);
  const reloadConfessors = useCallback(() => setCTick((t) => t + 1), []);
  useEffect(() => {
    if (!token) { setConfessors(null); return; }
    let cancelled = false;
    const run = () => fetchConfessors(supabase, token).then((r) => { if (!cancelled) setConfessors(r); }).catch(() => {});
    run();
    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVis);
    const stop = startPoll(run, 60_000);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVis); stop(); };
  }, [token, supabase, cTick]);

  // ---- appointments (pending + upcoming)
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [aTick, setATick] = useState(0);
  const reloadAppointments = useCallback(() => setATick((t) => t + 1), []);
  useEffect(() => {
    if (!token) { setAppointments(null); return; }
    let cancelled = false;
    const run = () => fetchAppointments(supabase, token).then((r) => { if (!cancelled) setAppointments(r); }).catch(() => {});
    run();
    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVis);
    const stop = startPoll(run, 30_000);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVis); stop(); };
  }, [token, supabase, aTick]);

  const reloadAll = useCallback(() => { refresh(); reloadConfessors(); reloadAppointments(); }, [refresh, reloadConfessors, reloadAppointments]);

  const value = useMemo(() => ({
    token, profile, loading, error, refresh, logout, confessors, reloadConfessors, appointments, reloadAppointments, reloadAll,
  }), [token, profile, loading, error, refresh, logout, confessors, reloadConfessors, appointments, reloadAppointments, reloadAll]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const usePriest = () => useContext(Ctx);
