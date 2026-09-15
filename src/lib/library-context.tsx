'use client';

// ---------- Library context (servant side) ----------
// ONE load of subjects / books / lectures / favorites (RLS-trimmed) shared
// by /library and /library/[id], kept fresh in realtime. Favorites toggle
// optimistically.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { useDebouncedRealtime } from '@/lib/realtime';
import { cachedLookup } from '@/lib/queries';
import {
  fetchLibrary, fetchLibraryPermissions, setFavorite, favoriteKeys, isMigrationMissing, libraryErrorMessage,
  NO_LIBRARY_PERMISSIONS, type LibraryData, type LibraryPermissions, type LibrarySubject, type LibraryBook, type LibraryLecture,
} from '@/lib/library';
import type { Church, Service, ClassRoom } from '@/lib/types';

type FavKind = 'book' | 'lecture';

interface LibraryState extends LibraryData {
  perms: LibraryPermissions;
  loading: boolean;
  migrationMissing: boolean;
  isFav: (kind: FavKind, id: string) => boolean;
  toggleFav: (kind: FavKind, id: string) => Promise<void>;
  reload: () => Promise<void>;
  upsertSubject: (s: LibrarySubject) => void;
  removeSubject: (id: string) => void;
  upsertBook: (b: LibraryBook) => void;
  removeBook: (id: string) => void;
  upsertLecture: (l: LibraryLecture) => void;
  removeLecture: (id: string) => void;
  lookups: { churches: Church[]; services: Service[]; classes: ClassRoom[] };
  toast: string | null;
  flash: (m: string) => void;
}

const empty: LibraryData = { subjects: [], books: [], lectures: [], favorites: [] };
const Ctx = createContext<LibraryState | null>(null);

const upsert = <T extends { id: string }>(list: T[], x: T) => (list.some((y) => y.id === x.id) ? list.map((y) => (y.id === x.id ? x : y)) : [...list, x]);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const [data, setData] = useState<LibraryData>(empty);
  const [perms, setPerms] = useState<LibraryPermissions>(NO_LIBRARY_PERMISSIONS);
  const [loading, setLoading] = useState(true);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [lookups, setLookups] = useState<LibraryState['lookups']>({ churches: [], services: [], classes: [] });
  const [toast, setToast] = useState<string | null>(null);
  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); }, []);

  useEffect(() => {
    if (!approved) return;
    (async () => {
      const [churches, services, classes] = await Promise.all([
        cachedLookup<Church>(supabase, 'churches'),
        cachedLookup<Service>(supabase, 'services'),
        cachedLookup<ClassRoom>(supabase, 'classes'),
      ]);
      setLookups({ churches, services, classes });
    })();
  }, [supabase, approved]);

  const reload = useCallback(async () => {
    if (!approved) return;
    try {
      const [d, p] = await Promise.all([fetchLibrary(supabase), fetchLibraryPermissions(supabase)]);
      setData(d); setPerms(p); setMigrationMissing(false);
    } catch (err) {
      if (isMigrationMissing(err)) setMigrationMissing(true);
    } finally { setLoading(false); }
  }, [supabase, approved]);

  useEffect(() => { reload(); }, [reload]);
  useDebouncedRealtime(
    supabase, 'library-ctx',
    [{ table: 'library_subjects' }, { table: 'library_books' }, { table: 'library_lectures' }],
    reload, { enabled: approved, delayMs: 700 }
  );

  const favKeys = useMemo(() => favoriteKeys(data.favorites), [data.favorites]);

  const toggleFav = useCallback(async (kind: FavKind, id: string) => {
    if (!profile) return;
    const on = !favKeys.has(`${kind}:${id}`);
    setData((d) => ({
      ...d,
      favorites: on
        ? [...d.favorites, { id: `tmp-${kind}-${id}`, user_id: profile.id, person_id: null, book_id: kind === 'book' ? id : null, lecture_id: kind === 'lecture' ? id : null, created_at: new Date().toISOString() }]
        : d.favorites.filter((f) => !((kind === 'book' && f.book_id === id) || (kind === 'lecture' && f.lecture_id === id))),
    }));
    try {
      await setFavorite(supabase, profile.id, kind === 'book' ? { book_id: id } : { lecture_id: id }, on);
    } catch (e) {
      flash(libraryErrorMessage(e, 'تعذر تحديث المفضلة'));
      reload();
    }
  }, [profile, favKeys, supabase, flash, reload]);

  const value = useMemo<LibraryState>(() => ({
    ...data, perms, loading, migrationMissing, lookups, toast, flash, reload, toggleFav,
    isFav: (kind, id) => favKeys.has(`${kind}:${id}`),
    upsertSubject: (s) => setData((d) => ({ ...d, subjects: upsert(d.subjects, s) })),
    removeSubject: (id) => setData((d) => ({ ...d, subjects: d.subjects.filter((x) => x.id !== id), books: d.books.filter((b) => b.subject_id !== id), lectures: d.lectures.filter((l) => l.subject_id !== id) })),
    upsertBook: (b) => setData((d) => ({ ...d, books: upsert(d.books, b) })),
    removeBook: (id) => setData((d) => ({ ...d, books: d.books.filter((x) => x.id !== id) })),
    upsertLecture: (l) => setData((d) => ({ ...d, lectures: upsert(d.lectures, l) })),
    removeLecture: (id) => setData((d) => ({ ...d, lectures: d.lectures.filter((x) => x.id !== id) })),
  }), [data, perms, loading, migrationMissing, favKeys, lookups, toast, flash, reload, toggleFav]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLibrary(): LibraryState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLibrary must be used inside <LibraryProvider>');
  return v;
}
