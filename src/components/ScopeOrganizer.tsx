'use client';

// ---------- ScopeOrganizer — «ترتيب حسب» الكنيسة · الخدمة · الفصل (0043) ----------
// Shared by إدارة المخدومين → المخدومين and إدارة الخدام → الخدام.
// A tiny toolbar: the grouping level (church / service / class / none) and
// the sort direction + a name sort. `organize()` turns a flat list into
// ordered GROUPS the panel renders with a sticky header per group.

import { ArrowDownAZ, ArrowUpZA, Church as ChurchIcon, Layers, School, Rows3 } from 'lucide-react';
import type { Church, Service, ClassRoom } from '@/lib/types';

export type OrganizeBy = 'none' | 'church' | 'service' | 'class';
export type OrganizeDir = 'asc' | 'desc';

export const ORGANIZE_OPTIONS: { value: OrganizeBy; label: string; icon: typeof Rows3 }[] = [
  { value: 'church', label: 'الكنيسة', icon: ChurchIcon },
  { value: 'service', label: 'الخدمة', icon: Layers },
  { value: 'class', label: 'الفصل', icon: School },
  { value: 'none', label: 'بدون', icon: Rows3 },
];

export interface ScopedRow {
  church_id: string | null;
  service_id: string | null;
  class_id: string | null;
}

export interface Lookups {
  churches: Church[];
  services: Service[];
  classes: ClassRoom[];
}

export interface OrganizedGroup<T> {
  key: string;
  /** breadcrumb: church ← service ← class (depending on the level) */
  title: string;
  rows: T[];
}

const nameOf = (list: { id: string; name: string }[], id: string | null, fallback: string) =>
  id ? list.find((x) => x.id === id)?.name ?? fallback : fallback;

/** Full breadcrumb for a row at the chosen level. */
export function scopeTitle(row: ScopedRow, by: OrganizeBy, lk: Lookups): string {
  const church = nameOf(lk.churches, row.church_id, 'كل الكنائس');
  const service = nameOf(lk.services, row.service_id, 'كل الخدمات');
  const cls = nameOf(lk.classes, row.class_id, 'كل الفصول');
  if (by === 'church') return church;
  if (by === 'service') return `${church} ← ${service}`;
  if (by === 'class') return `${church} ← ${service} ← ${cls}`;
  return '';
}

const groupKey = (row: ScopedRow, by: OrganizeBy) =>
  by === 'church' ? `c:${row.church_id ?? ''}`
  : by === 'service' ? `s:${row.church_id ?? ''}/${row.service_id ?? ''}`
  : by === 'class' ? `k:${row.church_id ?? ''}/${row.service_id ?? ''}/${row.class_id ?? ''}`
  : 'all';

/**
 * Group + sort. Groups are ordered by their breadcrumb (church, then
 * service, then class names); rows inside a group by `nameOf(row)`.
 */
export function organize<T extends ScopedRow>(
  rows: T[],
  by: OrganizeBy,
  dir: OrganizeDir,
  lk: Lookups,
  rowName: (r: T) => string
): OrganizedGroup<T>[] {
  const cmp = (a: string, b: string) => a.localeCompare(b, 'ar') * (dir === 'asc' ? 1 : -1);
  const map = new Map<string, OrganizedGroup<T>>();
  for (const r of rows) {
    const key = groupKey(r, by);
    let g = map.get(key);
    if (!g) {
      g = { key, title: scopeTitle(r, by, lk), rows: [] };
      map.set(key, g);
    }
    g.rows.push(r);
  }
  const groups = Array.from(map.values());
  groups.forEach((g) => g.rows.sort((a, b) => cmp(rowName(a), rowName(b))));
  // group order always by the breadcrumb (asc/desc follows dir)
  groups.sort((a, b) => cmp(a.title, b.title));
  return groups;
}

export default function ScopeOrganizer({
  by, dir, onBy, onDir, idPrefix = 'organize', total,
}: {
  by: OrganizeBy;
  dir: OrganizeDir;
  onBy: (b: OrganizeBy) => void;
  onDir: (d: OrganizeDir) => void;
  idPrefix?: string;
  total?: number;
}) {
  return (
    <div id={`${idPrefix}-bar`} className="mb-3 flex items-center gap-2">
      <span className="shrink-0 text-[11px] font-extrabold text-slate-400">ترتيب حسب</span>
      <div role="group" aria-label="ترتيب حسب" className="grid flex-1 grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1">
        {ORGANIZE_OPTIONS.map((o) => {
          const Icon = o.icon;
          const active = by === o.value;
          return (
            <button
              key={o.value}
              id={`${idPrefix}-${o.value}`}
              type="button"
              aria-pressed={active}
              onClick={() => onBy(o.value)}
              className={`flex h-8 items-center justify-center gap-1 rounded-lg text-[11px] font-extrabold transition ${
                active ? 'bg-white text-primary-700 shadow' : 'text-slate-500'
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {o.label}
            </button>
          );
        })}
      </div>
      <button
        id={`${idPrefix}-dir`}
        type="button"
        aria-label={dir === 'asc' ? 'تصاعدي' : 'تنازلي'}
        title={dir === 'asc' ? 'تصاعدي (أ → ي)' : 'تنازلي (ي → أ)'}
        onClick={() => onDir(dir === 'asc' ? 'desc' : 'asc')}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-primary-600 shadow-sm active:scale-95"
      >
        {dir === 'asc' ? <ArrowDownAZ className="h-4 w-4" /> : <ArrowUpZA className="h-4 w-4" />}
      </button>
      {typeof total === 'number' && (
        <span className="badge bg-primary-100 text-primary-700">{total}</span>
      )}
    </div>
  );
}
