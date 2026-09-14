'use client';

// ---------- Points store — shared UI bits ----------
// StoreHeader: back arrow + title + the 3 module tabs (المخزون · الكاشير · الأرشيف)
// ItemThumb  : item picture or a placeholder
// ScopeSelectors: church → service → class selects (same as the other modules)
// useStoreLookups: churches / services / classes via cachedLookup

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { ArrowRight, ShoppingBag, Package, ScanLine, Archive, ImageIcon } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cachedLookup, ALL } from '@/lib/queries';
import type { Church, Service, ClassRoom } from '@/lib/types';
import { useNavLabel } from '@/lib/customization-context';

const TABS = [
  { href: '/store/pos', label: 'الكاشير', icon: ScanLine, id: 'store-tab-pos' },
  { href: '/store/inventory', label: 'المخزون', icon: Package, id: 'store-tab-inventory' },
  { href: '/store/archive', label: 'الأرشيف', icon: Archive, id: 'store-tab-archive' },
];

export function StoreHeader({ title, badge }: { title?: string; badge?: React.ReactNode }) {
  const path = usePathname();
  const name = useNavLabel('store');
  return (
    <>
      <section className="mb-3 flex items-center gap-2">
        <Link href="/settings" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
          <ArrowRight className="h-5 w-5" />
        </Link>
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <ShoppingBag className="h-5 w-5 text-orange-600" />
          {name}
          {title && <span className="text-slate-400 font-bold text-sm">· {title}</span>}
          {badge}
        </h2>
      </section>
      <nav id="store-tabs" className="mb-3 grid grid-cols-3 gap-2">
        {TABS.map((t) => {
          const active = path?.startsWith(t.href);
          const Icon = t.icon;
          return (
            <Link
              key={t.href} id={t.id} href={t.href} aria-current={active ? 'page' : undefined}
              className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-extrabold transition active:scale-95 ${
                active ? 'bg-orange-600 text-white shadow ring-2 ring-orange-300' : 'bg-white text-slate-600 border border-slate-200'
              }`}
            >
              <Icon className="h-4 w-4" /> {t.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

/** Item picture (or placeholder). `fill` → stretches to the parent box. */
export function ItemThumb({ url, name, size = 48, fill = false, className = '' }: {
  url: string | null; name: string; size?: number; fill?: boolean; className?: string;
}) {
  return (
    <div
      className={`relative shrink-0 overflow-hidden ${fill ? 'h-full w-full' : 'rounded-xl ring-1 ring-orange-100'} bg-orange-50 text-orange-300 ${className}`}
      style={fill ? undefined : { width: size, height: size }}
    >
      {url ? (
        <Image src={url} alt={name} fill sizes={fill ? '50vw' : `${size}px`} className="object-cover" />
      ) : (
        <ImageIcon className="absolute inset-0 m-auto" style={fill ? { width: '40%', height: '40%' } : { width: size * 0.45, height: size * 0.45 }} />
      )}
    </div>
  );
}

export function useStoreLookups(supabase: SupabaseClient, enabled: boolean) {
  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  useEffect(() => {
    if (!enabled) return;
    (async () => {
      const [chs, svs, cls] = await Promise.all([
        cachedLookup<Church>(supabase, 'churches'),
        cachedLookup<Service>(supabase, 'services'),
        cachedLookup<ClassRoom>(supabase, 'classes'),
      ]);
      setChurches(chs); setServices(svs); setClasses(cls);
    })();
  }, [supabase, enabled]);
  return { churches, services, classes };
}

export interface ScopeState {
  church: string; service: string; class: string;
  setChurch: (v: string) => void; setService: (v: string) => void; setClass: (v: string) => void;
}

export function useScopeState(): ScopeState {
  const [church, setChurchRaw] = useState(ALL);
  const [service, setServiceRaw] = useState(ALL);
  const [cls, setClassRaw] = useState(ALL);
  return {
    church, service, class: cls,
    setChurch: (v) => { setChurchRaw(v); setServiceRaw(ALL); setClassRaw(ALL); },
    setService: (v) => { setServiceRaw(v); setClassRaw(ALL); },
    setClass: (v) => setClassRaw(v),
  };
}

export function ScopeSelectors({
  idPrefix, scope, churches, services, classes,
}: { idPrefix: string; scope: ScopeState; churches: Church[]; services: Service[]; classes: ClassRoom[] }) {
  const visibleServices = useMemo(
    () => services.filter((s) => scope.church === ALL || s.church_id === scope.church),
    [services, scope.church]
  );
  const visibleClasses = useMemo(
    () => classes.filter((c) =>
      (scope.church === ALL || c.church_id === scope.church) &&
      (scope.service === ALL || c.service_id === scope.service)),
    [classes, scope.church, scope.service]
  );
  return (
    <div className="mb-3 grid grid-cols-3 gap-2">
      <select
        id={`${idPrefix}-church`} aria-label="اختيار الكنيسة"
        className="input-field appearance-none !px-2 text-xs font-bold"
        value={scope.church} disabled={churches.length <= 1}
        onChange={(e) => scope.setChurch(e.target.value)}
      >
        <option value={ALL}>{churches.length === 1 ? churches[0].name : 'كل الكنائس'}</option>
        {churches.length > 1 && churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select
        id={`${idPrefix}-service`} aria-label="اختيار الخدمة"
        className="input-field appearance-none !px-2 text-xs font-bold"
        value={scope.service} disabled={visibleServices.length <= 1}
        onChange={(e) => scope.setService(e.target.value)}
      >
        <option value={ALL}>{visibleServices.length === 1 ? visibleServices[0].name : 'كل الخدمات'}</option>
        {visibleServices.length > 1 && visibleServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <select
        id={`${idPrefix}-class`} aria-label="اختيار الفصل"
        className="input-field appearance-none !px-2 text-xs font-bold"
        value={scope.class} disabled={visibleClasses.length <= 1}
        onChange={(e) => scope.setClass(e.target.value)}
      >
        <option value={ALL}>{visibleClasses.length === 1 ? visibleClasses[0].name : 'كل الفصول'}</option>
        {visibleClasses.length > 1 && visibleClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </div>
  );
}

/** «كنيسة ← خدمة ← فصل» label for an item / order scope */
export function scopeLabel(
  x: { church_id: string; service_id: string | null; class_id: string | null },
  churches: Church[], services: Service[], classes: ClassRoom[]
) {
  const church = churches.find((c) => c.id === x.church_id)?.name ?? '';
  if (x.service_id === null) return `${church} ← كل الخدمات`;
  const service = services.find((s) => s.id === x.service_id)?.name ?? '';
  if (x.class_id === null) return `${church} ← ${service} ← كل الفصول`;
  const cls = classes.find((c) => c.id === x.class_id)?.name ?? '';
  return `${church} ← ${service} ← ${cls}`;
}

export function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div id="store-toast" role="status" className="fixed inset-x-4 bottom-24 z-[70] mx-auto max-w-md rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm font-bold text-white shadow-xl">
      {msg}
    </div>
  );
}
