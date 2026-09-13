'use client';

// ---------- App customization context (تخصيص التطبيق) ----------
// Loads the owner's navigation layout from `app_settings.key = 'navigation'`
// (migration 0035), keeps it fresh in realtime and RESOLVES it for the
// signed-in user: a taskbar slot pointing at a module hidden from him falls
// back to a default core page, header widgets bound to a module vanish when
// the module isn't granted, and the side menu lists everything else.
//
// Falls back to the default layout when the migration isn't applied yet.

import {
  createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { useDebouncedRealtime } from '@/lib/realtime';
import { useModules } from '@/lib/modules-context';
import {
  DEFAULT_NAVIGATION, NAVIGATION_SETTING_KEY, normalizeNavigation, resolveTaskbar, resolveMenuRest,
  resolveHeader, CORE_KEYS, OWNER_DEST,
  type NavigationConfig, type ResolvedNavItem, type ResolvedHeaderItem,
} from '@/lib/navigation';

interface CustomizationState {
  /** the raw (normalized) layout the owner saved */
  navigation: NavigationConfig;
  /** true when a saved layout exists (false = defaults) */
  customized: boolean;
  /** destination keys the signed-in user may see */
  allowed: Set<string>;
  taskbar: ResolvedNavItem[];
  menuRest: ResolvedNavItem[];
  header: ResolvedHeaderItem[];
  loading: boolean;
  reload: () => Promise<void>;
  /** OWNER ONLY — persist a new layout (RLS rejects everybody else) */
  saveNavigation: (cfg: NavigationConfig) => Promise<string | null>;
  /** OWNER ONLY — back to defaults */
  resetNavigation: () => Promise<string | null>;
}

const defaultAllowed = new Set<string>(CORE_KEYS);

const CustomizationContext = createContext<CustomizationState>({
  navigation: DEFAULT_NAVIGATION,
  customized: false,
  allowed: defaultAllowed,
  taskbar: resolveTaskbar(DEFAULT_NAVIGATION, defaultAllowed),
  menuRest: [],
  header: resolveHeader(DEFAULT_NAVIGATION, defaultAllowed),
  loading: true,
  reload: async () => {},
  saveNavigation: async () => 'not ready',
  resetNavigation: async () => 'not ready',
});

export function CustomizationProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const { visibleModules, loading: modulesLoading } = useModules();
  const [supabase] = useState(() => createClient());
  const [navigation, setNavigation] = useState<NavigationConfig>(DEFAULT_NAVIGATION);
  const [customized, setCustomized] = useState(false);
  const [loading, setLoading] = useState(true);
  const approved = profile?.status === 'approved';

  const reload = useCallback(async () => {
    if (!approved) { setNavigation(DEFAULT_NAVIGATION); setCustomized(false); setLoading(false); return; }
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', NAVIGATION_SETTING_KEY)
      .maybeSingle();
    if (error || !data) {
      // migration missing or nothing saved yet → defaults
      setNavigation(DEFAULT_NAVIGATION);
      setCustomized(false);
    } else {
      setNavigation(normalizeNavigation(data.value));
      setCustomized(true);
    }
    setLoading(false);
  }, [supabase, approved]);

  useEffect(() => { reload(); }, [reload]);

  useDebouncedRealtime(
    supabase, 'app-settings', [{ table: 'app_settings' }], reload,
    { enabled: approved, delayMs: 400 }
  );

  const saveNavigation = useCallback(async (cfg: NavigationConfig): Promise<string | null> => {
    const value = normalizeNavigation(cfg);
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key: NAVIGATION_SETTING_KEY, value, updated_by: profile?.id ?? null }, { onConflict: 'key' });
    if (error) return error.message;
    setNavigation(value);
    setCustomized(true);
    return null;
  }, [supabase, profile?.id]);

  const resetNavigation = useCallback(async (): Promise<string | null> => {
    const { error } = await supabase.from('app_settings').delete().eq('key', NAVIGATION_SETTING_KEY);
    if (error) return error.message;
    setNavigation(DEFAULT_NAVIGATION);
    setCustomized(false);
    return null;
  }, [supabase]);

  // destination keys this user may see
  const allowed = useMemo(() => {
    const s = new Set<string>(CORE_KEYS);
    if (profile?.role === 'owner') s.add(OWNER_DEST.key);
    visibleModules.forEach((m) => s.add(m.key));
    return s;
  }, [profile?.role, visibleModules]);

  const value = useMemo<CustomizationState>(() => {
    const taskbar = resolveTaskbar(navigation, allowed);
    return {
      navigation,
      customized,
      allowed,
      taskbar,
      menuRest: resolveMenuRest(taskbar, allowed),
      header: resolveHeader(navigation, allowed),
      loading: loading || modulesLoading,
      reload,
      saveNavigation,
      resetNavigation,
    };
  }, [navigation, customized, allowed, loading, modulesLoading, reload, saveNavigation, resetNavigation]);

  return <CustomizationContext.Provider value={value}>{children}</CustomizationContext.Provider>;
}

export const useCustomization = () => useContext(CustomizationContext);
