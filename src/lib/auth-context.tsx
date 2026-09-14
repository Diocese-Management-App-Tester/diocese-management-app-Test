'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import type { ServantEnrollment, Church, Service, Person } from '@/lib/types';
import { SERVANTS_TABLE } from '@/lib/types';
import type { User } from '@supabase/supabase-js';

interface AuthState {
  user: User | null;
  /** the signed-in servant's enrollment (table `servant_enrollments`, 0037) */
  profile: ServantEnrollment | null;
  /** the servant's identity row in `persons` (code = national_id) */
  person: Person | null;
  church: Church | null;
  service: Service | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  profile: null,
  person: null,
  church: null,
  service: null,
  loading: true,
  refresh: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ServantEnrollment | null>(null);
  const [person, setPerson] = useState<Person | null>(null);
  const [church, setChurch] = useState<Church | null>(null);
  const [service, setService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  const loadProfile = useCallback(
    async (uid: string) => {
      // 0037: servant_enrollments. Fall back to the old `profiles` table when
      // the migration has not been applied yet (identical columns).
      let { data: p, error } = await supabase
        .from(SERVANTS_TABLE)
        .select('*')
        .eq('id', uid)
        .maybeSingle();
      if (error) {
        const res = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
        p = res.data;
      }
      const prof = (p ?? null) as ServantEnrollment | null;
      setProfile(prof);

      if (prof?.person_id) {
        const { data: per } = await supabase.from('persons').select('*').eq('id', prof.person_id).maybeSingle();
        setPerson((per ?? null) as Person | null);
      } else {
        setPerson(null);
      }

      if (prof?.church_id) {
        const { data: c } = await supabase
          .from('churches')
          .select('*')
          .eq('id', prof.church_id)
          .single();
        setChurch(c ?? null);
      } else {
        setChurch(null);
      }

      if (prof?.service_id) {
        const { data: s } = await supabase
          .from('services')
          .select('*')
          .eq('id', prof.service_id)
          .single();
        setService(s ?? null);
      } else {
        setService(null);
      }
    },
    [supabase]
  );

  const refresh = useCallback(async () => {
    const {
      data: { user: u },
    } = await supabase.auth.getUser();
    setUser(u);
    if (u) await loadProfile(u.id);
    else {
      setProfile(null);
      setPerson(null);
      setChurch(null);
      setService(null);
    }
    setLoading(false);
  }, [supabase, loadProfile]);

  useEffect(() => {
    refresh();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) loadProfile(session.user.id);
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime: react to own enrollment changes (e.g. approval) instantly
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`servant-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: SERVANTS_TABLE, filter: `id=eq.${user.id}` },
        () => loadProfile(user.id)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, supabase, loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  }, [supabase]);

  return (
    <AuthContext.Provider value={{ user, profile, person, church, service, loading, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
