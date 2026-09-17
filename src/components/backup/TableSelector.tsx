'use client';

// ---------- Table selector — «ماذا تريد أن تنسخ / تسترجع؟» ----------
// Grouped checklist of every table (Arabic labels), «الكل» toggle, per-group
// toggles, row counts. Used by the backup modal, the restore modal and the
// schedule form. `available` is the catalogue (DB tables or file tables);
// `AUTH_USERS_KEY` is a pseudo-row for the servants' login accounts.

import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Square, SquareCheckBig, KeyRound, Table2 } from 'lucide-react';
import { BACKUP_GROUPS, AUTH_USERS_KEY, tableGroup, tableLabel } from '@/lib/backup';

export interface SelectableTable { name: string; rows?: number; note?: string }

export default function TableSelector({
  available, selected, onChange, showAuth = true, authRows, compact = false,
}: {
  available: SelectableTable[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** offer the «حسابات دخول الخدام» pseudo-table */
  showAuth?: boolean;
  authRows?: number;
  compact?: boolean;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const items = useMemo<SelectableTable[]>(
    () => (showAuth ? [...available, { name: AUTH_USERS_KEY, rows: authRows }] : available),
    [available, showAuth, authRows]
  );
  const groups = useMemo(() => {
    const by = new Map<string, SelectableTable[]>();
    for (const it of items) {
      const g = tableGroup(it.name);
      if (!by.has(g)) by.set(g, []);
      by.get(g)!.push(it);
    }
    return BACKUP_GROUPS.filter((g) => by.has(g.key)).map((g) => ({
      ...g,
      tables: by.get(g.key)!.sort((a, b) => tableLabel(a.name).localeCompare(tableLabel(b.name), 'ar')),
    }));
  }, [items]);

  const allNames = items.map((i) => i.name);
  const allSelected = allNames.length > 0 && allNames.every((n) => selected.has(n));
  const totalRows = items.reduce((s, i) => s + (selected.has(i.name) ? (i.rows ?? 0) : 0), 0);

  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name); else next.add(name);
    onChange(next);
  };
  const toggleAll = () => onChange(allSelected ? new Set() : new Set(allNames));
  const toggleGroup = (names: string[]) => {
    const every = names.every((n) => selected.has(n));
    const next = new Set(selected);
    names.forEach((n) => (every ? next.delete(n) : next.add(n)));
    onChange(next);
  };

  return (
    <div id="table-selector" className="space-y-2">
      {/* All */}
      <button
        type="button"
        id="table-selector-all"
        onClick={toggleAll}
        className={`flex w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-right transition ${
          allSelected ? 'border-primary-500 bg-primary-50' : 'border-slate-200 bg-white hover:bg-slate-50'
        }`}
      >
        {allSelected ? <SquareCheckBig className="h-5 w-5 text-primary-600" /> : <Square className="h-5 w-5 text-slate-300" />}
        <span className="flex-1">
          <span className="block text-sm font-extrabold">الكل — كل الجداول{showAuth ? ' وحسابات الدخول' : ''}</span>
          <span className="block text-xs text-slate-400">
            {selected.size} / {allNames.length} جدول · {totalRows.toLocaleString('ar-EG')} سجل
          </span>
        </span>
      </button>

      {groups.map((g) => {
        const names = g.tables.map((t) => t.name);
        const count = names.filter((n) => selected.has(n)).length;
        const every = count === names.length;
        const some = count > 0 && !every;
        const isOpen = open[g.key] ?? !compact;
        return (
          <div key={g.key} className="overflow-hidden rounded-2xl border border-indigo-50 bg-white">
            <div className="flex items-center gap-2 px-3 py-2.5">
              <button
                type="button"
                onClick={() => toggleGroup(names)}
                aria-label={`تحديد ${g.label}`}
                className="rounded-lg p-1 hover:bg-slate-50"
              >
                {every ? (
                  <SquareCheckBig className="h-5 w-5 text-primary-600" />
                ) : some ? (
                  <span className="flex h-5 w-5 items-center justify-center rounded border-2 border-primary-500 bg-primary-100">
                    <span className="h-2 w-2 rounded-sm bg-primary-600" />
                  </span>
                ) : (
                  <Square className="h-5 w-5 text-slate-300" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [g.key]: !isOpen }))}
                className="flex flex-1 items-center gap-2 text-right"
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-extrabold">{g.label}</span>
                  <span className="block truncate text-[11px] text-slate-400">{g.desc}</span>
                </span>
                <span className="badge bg-slate-100 text-slate-600 tabular-nums">{count}/{names.length}</span>
                {isOpen ? <ChevronUp className="h-4 w-4 text-slate-300" /> : <ChevronDown className="h-4 w-4 text-slate-300" />}
              </button>
            </div>
            {isOpen && (
              <ul className="divide-y divide-indigo-50 border-t border-indigo-50">
                {g.tables.map((t) => {
                  const on = selected.has(t.name);
                  const isAuth = t.name === AUTH_USERS_KEY;
                  return (
                    <li key={t.name}>
                      <button
                        type="button"
                        data-table={t.name}
                        onClick={() => toggle(t.name)}
                        className={`flex w-full items-center gap-3 px-3 py-2.5 text-right transition ${on ? 'bg-primary-50/50' : 'hover:bg-slate-50'}`}
                      >
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 ${on ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300'}`}>
                          {on && <Check className="h-3.5 w-3.5" />}
                        </span>
                        {isAuth ? <KeyRound className="h-4 w-4 shrink-0 text-amber-500" /> : <Table2 className="h-4 w-4 shrink-0 text-slate-300" />}
                        <span className="flex-1 min-w-0">
                          <span className="block truncate text-sm font-bold">{tableLabel(t.name)}</span>
                          <span className="block truncate text-[11px] text-slate-400" dir="ltr">
                            {t.name}{t.note ? ` · ${t.note}` : ''}
                          </span>
                        </span>
                        {t.rows != null && (
                          <span className="badge bg-slate-100 text-slate-500 tabular-nums">{t.rows.toLocaleString('ar-EG')}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
