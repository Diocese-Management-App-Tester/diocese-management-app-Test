'use client';

// ---------- Icon picker modal (تخصيص التطبيق) ----------
// Grid of every icon in the library (`ICON_LIBRARY`) with a name filter and
// a «الافتراضي» choice that clears the override. Returns the library name.

import { useMemo, useState } from 'react';
import { X, Search, RotateCcw, Check } from 'lucide-react';
import { ICON_LIBRARY, ICON_NAMES } from '@/lib/navigation';

export default function IconPicker({
  value, defaultName, onPick, onClose, title = 'اختر أيقونة',
}: {
  value: string | undefined;
  defaultName: string;
  onPick: (name: string | undefined) => void;
  onClose: () => void;
  title?: string;
}) {
  const [q, setQ] = useState('');
  const names = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? ICON_NAMES.filter((n) => n.toLowerCase().includes(s)) : ICON_NAMES;
  }, [q]);
  const DefaultIcon = ICON_LIBRARY[defaultName];

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/45 backdrop-blur-[2px] p-0 sm:p-6"
      onClick={onClose}
    >
      <div
        id="icon-picker"
        className="flex w-full max-w-lg max-h-[88dvh] flex-col rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-indigo-50 px-5 py-4">
          <h3 className="text-base font-extrabold">{title}</h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 pt-3">
          <div className="relative">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              id="icon-picker-search"
              className="input-field !pr-9 !py-2.5"
              placeholder="ابحث باسم الأيقونة (بالإنجليزية)…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              dir="ltr"
              autoFocus
            />
          </div>
          <button
            id="icon-picker-default"
            onClick={() => onPick(undefined)}
            className={`mt-3 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-sm font-bold transition ${
              !value ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-slate-200 hover:bg-slate-50'
            }`}
          >
            {DefaultIcon && <DefaultIcon className="h-5 w-5" />}
            <span className="flex-1 text-start">الأيقونة الافتراضية</span>
            {!value ? <Check className="h-4 w-4" /> : <RotateCcw className="h-4 w-4 text-slate-400" />}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {names.length === 0 ? (
            <p className="py-10 text-center text-xs font-bold text-slate-400">لا توجد أيقونة بهذا الاسم</p>
          ) : (
            <div className="grid grid-cols-6 xs:grid-cols-7 sm:grid-cols-8 gap-1.5">
              {names.map((n) => {
                const Icon = ICON_LIBRARY[n];
                const active = value === n;
                return (
                  <button
                    key={n}
                    type="button"
                    title={n}
                    onClick={() => onPick(n)}
                    className={`flex aspect-square items-center justify-center rounded-xl border transition ${
                      active
                        ? 'border-primary-400 bg-primary-100 text-primary-700 ring-2 ring-primary-200'
                        : 'border-slate-100 text-slate-600 hover:bg-slate-50 hover:border-slate-200'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <p className="border-t border-indigo-50 px-5 py-2 text-center text-[11px] font-bold text-slate-400" dir="ltr">
          {value ?? defaultName}
        </p>
      </div>
    </div>
  );
}
