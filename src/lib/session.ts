// ---------- «تذكرني» for servant sessions ----------
// Supabase keeps the auth session in cookies/localStorage for weeks. When
// the servant does NOT tick «تذكرني» on /login we flag the session as
// tab-only: a sessionStorage marker lives as long as the tab; on a cold start
// (marker gone but flag present) AuthProvider signs the servant out.

export const SERVANT_NO_REMEMBER_KEY = 'dma_no_remember';
export const SERVANT_TAB_ALIVE_KEY = 'dma_tab_alive';

/** true when the stored servant session must be dropped (tab-only session, new tab/cold start) */
export function servantSessionStale(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const noRemember = window.localStorage.getItem(SERVANT_NO_REMEMBER_KEY) === '1';
    if (!noRemember) return false;
    return window.sessionStorage.getItem(SERVANT_TAB_ALIVE_KEY) !== '1';
  } catch {
    return false;
  }
}

export function clearServantRememberFlags() {
  try {
    window.localStorage.removeItem(SERVANT_NO_REMEMBER_KEY);
    window.sessionStorage.removeItem(SERVANT_TAB_ALIVE_KEY);
  } catch { /* ignore */ }
}
