'use client';

// ---------- تخصيص التطبيق → ودجات الرئيسية ----------
// The owner decides which widgets the home page shows, their order, size
// (full / half) and heading. Miniature preview on top; the list below is the
// layout (arrows · size toggle · rename · remove); the widgets NOT yet on the
// page are listed underneath with «إضافة». Saving writes app_settings.widgets.

import { useEffect, useMemo, useState } from 'react';
import {
  LayoutGrid, ChevronUp, ChevronDown, Trash2, Plus, RectangleHorizontal, Square, Pencil, RotateCcw, Lock, Users,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { OwnerGate } from '@/components/ModuleGate';
import { EditorHeader, SaveBar } from '@/components/customize/shared';
import { useCustomization } from '@/lib/customization-context';
import { ROLE_LABELS } from '@/lib/types';
import {
  WIDGETS, WIDGET_BY_KEY, DEFAULT_WIDGETS, MAX_WIDGET_TITLE,
  type WidgetItem, type WidgetsConfig, type WidgetDef,
} from '@/lib/widgets';

export default function CustomizeWidgetsPage() {
  const { widgetsConfig, widgetsCustomized, loading, saveWidgets, resetWidgets, label } = useCustomization();

  const [items, setItems] = useState<WidgetItem[]>(widgetsConfig.items);
  const [pristine, setPristine] = useState(JSON.stringify(widgetsConfig.items));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [renaming, setRenaming] = useState<number | null>(null);

  useEffect(() => {
    const remote = JSON.stringify(widgetsConfig.items);
    if (JSON.stringify(items) === pristine) setItems(widgetsConfig.items);
    setPristine(remote);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetsConfig.items]);

  const dirty = JSON.stringify(items) !== pristine;
  const used = useMemo(() => new Set(items.map((i) => i.key)), [items]);
  const available = WIDGETS.filter((w) => !used.has(w.key));

  const touch = () => setSaved(false);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    touch();
    setItems((prev) => { const n = [...prev]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  };
  const remove = (i: number) => { touch(); setItems((prev) => prev.filter((_, k) => k !== i)); };
  const add = (key: string) => { touch(); setItems((prev) => [...prev, { key }]); };
  const patch = (i: number, p: Partial<WidgetItem>) => {
    touch();
    setItems((prev) => prev.map((it, k) => {
      if (k !== i) return it;
      const next = { ...it, ...p };
      if (!next.size) delete next.size;
      if (!next.title || !next.title.trim()) delete next.title;
      return next;
    }));
  };
  const sizeOf = (it: WidgetItem, def: WidgetDef) => (def.resizable ? (it.size ?? def.size) : def.size);
  const toggleSize = (i: number) => {
    const it = items[i]; const def = WIDGET_BY_KEY[it.key];
    if (!def.resizable) return;
    const next = sizeOf(it, def) === 'full' ? 'half' : 'full';
    patch(i, { size: next === def.size ? undefined : next });
  };

  const save = async () => {
    setSaving(true); setError('');
    const cfg: WidgetsConfig = { version: 1, items };
    const err = await saveWidgets(cfg);
    setSaving(false);
    if (err) { setError(`تعذر الحفظ — تأكد من تشغيل الترحيل 0035/0036 (${err})`); return; }
    setPristine(JSON.stringify(items));
    setSaved(true);
  };

  const reset = async () => {
    if (!confirm('إرجاع الرئيسية إلى الشكل الافتراضي؟')) return;
    setSaving(true); setError('');
    const err = await resetWidgets();
    setSaving(false);
    if (err) { setError(`تعذر الحفظ (${err})`); return; }
    setItems(DEFAULT_WIDGETS.items);
    setPristine(JSON.stringify(DEFAULT_WIDGETS.items));
    setSaved(true);
  };

  return (
    <AppShell>
      <OwnerGate>
        <EditorHeader
          back="/owner/customize" icon={LayoutGrid} title="ودجات الرئيسية" badge={`${items.length} ودجة`}
          info="رتّب الودجات بالأسهم، غيّر الحجم (عرض كامل / نصف) أو العنوان، واحذف ما لا تريده. الودجة المرتبطة بوحدة لا تظهر إلا لمن فُعِّلت له الوحدة، والودجات الخاصة بالمسؤولين لا تظهر لخدام الفصول."
        />

        {/* ---------- miniature preview ---------- */}
        <section id="widgets-preview" className="mb-4 overflow-hidden rounded-2xl border border-indigo-100 bg-slate-100 shadow-card">
          <p className="px-4 pt-3 text-[11px] font-bold text-slate-400">معاينة الترتيب</p>
          <div className="mx-3 mb-3 mt-2 grid grid-cols-2 gap-1.5 rounded-xl border border-indigo-100 bg-white p-2">
            {items.length === 0 && <p className="col-span-2 py-6 text-center text-xs font-bold text-slate-300">الرئيسية فارغة</p>}
            {items.map((it, i) => {
              const def = WIDGET_BY_KEY[it.key];
              const Icon = def.icon;
              const full = sizeOf(it, def) === 'full';
              return (
                <div key={it.key} className={`flex items-center gap-1.5 rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5 ${full ? 'col-span-2' : 'col-span-1'}`}>
                  <span className="text-[9px] font-extrabold tabular-nums text-slate-300">{i + 1}</span>
                  <Icon className={`h-3.5 w-3.5 shrink-0 ${def.color}`} />
                  <span className="truncate text-[10px] font-bold text-slate-600">{it.title ?? def.heading ?? def.label}</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* ---------- current layout ---------- */}
        {loading ? null : (
          <ul id="widgets-list" className="space-y-2">
            {items.map((it, i) => {
              const def = WIDGET_BY_KEY[it.key];
              const Icon = def.icon;
              const full = sizeOf(it, def) === 'full';
              const changed = !!it.size || !!it.title;
              return (
                <li key={it.key} id={`widget-item-${it.key}`} className="card !p-0 overflow-hidden">
                  <div className="flex items-center gap-2.5 px-3 py-2.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-xs font-extrabold tabular-nums text-white">{i + 1}</span>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-50"><Icon className={`h-5 w-5 ${def.color}`} /></span>
                    <div className="min-w-0 flex-1">
                      {renaming === i ? (
                        <input
                          autoFocus
                          className="input-field !py-1.5 !px-2.5 text-sm"
                          placeholder={def.heading ?? def.label}
                          maxLength={MAX_WIDGET_TITLE}
                          value={it.title ?? ''}
                          onChange={(e) => patch(i, { title: e.target.value })}
                          onBlur={() => setRenaming(null)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setRenaming(null); }}
                        />
                      ) : (
                        <button type="button" onClick={() => def.heading !== undefined && setRenaming(i)} className="flex max-w-full items-center gap-1 text-start">
                          <span className="truncate text-sm font-extrabold text-slate-800">{it.title ?? def.heading ?? def.label}</span>
                          {def.heading !== undefined && <Pencil className="h-3 w-3 shrink-0 text-slate-300" />}
                        </button>
                      )}
                      <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] font-bold text-slate-400">
                        <span className="truncate">{def.label}</span>
                        {def.module && <span className="badge bg-slate-100 text-slate-500"><Lock className="h-2.5 w-2.5" /> {label(def.module)}</span>}
                        {def.roles && <span className="badge bg-slate-100 text-slate-500"><Users className="h-2.5 w-2.5" /> المسؤولون</span>}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleSize(i)}
                      disabled={!def.resizable}
                      aria-label={full ? 'عرض كامل — اضغط للنصف' : 'نصف العرض — اضغط للكامل'}
                      title={def.resizable ? (full ? 'عرض كامل' : 'نصف العرض') : 'حجم ثابت'}
                      className={`rounded-lg border p-1.5 transition disabled:opacity-30 ${full ? 'border-primary-200 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                    >
                      {full ? <RectangleHorizontal className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                    </button>
                    <div className="flex flex-col gap-1">
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="أعلى" className="rounded-lg border border-slate-200 p-1 text-slate-500 hover:bg-slate-50 disabled:opacity-30"><ChevronUp className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="أسفل" className="rounded-lg border border-slate-200 p-1 text-slate-500 hover:bg-slate-50 disabled:opacity-30"><ChevronDown className="h-3.5 w-3.5" /></button>
                    </div>
                    <button type="button" onClick={() => remove(i)} aria-label="إزالة من الرئيسية" className="rounded-lg border border-red-100 p-1.5 text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                  </div>
                  {changed && (
                    <div className="flex items-center justify-between border-t border-indigo-50 bg-slate-50/60 px-3 py-1.5">
                      <span className="truncate text-[11px] font-bold text-slate-400">
                        {it.size && <>الحجم: {it.size === 'full' ? 'كامل' : 'نصف'}</>}
                        {it.size && it.title && ' · '}
                        {it.title && <>العنوان الافتراضي: {def.heading}</>}
                      </span>
                      <button type="button" onClick={() => patch(i, { size: undefined, title: undefined })} className="flex items-center gap-1 text-[11px] font-bold text-primary-600 hover:underline">
                        <RotateCcw className="h-3 w-3" /> الافتراضي
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
            {items.length === 0 && <li className="card py-6 text-center text-xs font-bold text-slate-400">لا ودجات — أضف من القائمة أدناه</li>}
          </ul>
        )}

        {/* ---------- available widgets ---------- */}
        <section id="widgets-available" className="mt-5">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-extrabold text-slate-500">
            <Plus className="h-4 w-4" /> ودجات متاحة للإضافة
            <span className="badge bg-slate-100 text-slate-500">{available.length}</span>
          </h3>
          <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
            {available.length === 0 ? (
              <p className="px-4 py-4 text-center text-xs font-bold text-slate-400">كل الودجات على الرئيسية</p>
            ) : available.map((w) => {
              const Icon = w.icon;
              return (
                <div key={w.key} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-50"><Icon className={`h-5 w-5 ${w.color}`} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-extrabold text-slate-800">{w.label}</span>
                    <span className="block text-[11px] font-bold leading-snug text-slate-400">{w.desc}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      <span className="badge bg-slate-100 text-slate-500">{w.size === 'full' ? 'عرض كامل' : 'نصف العرض'}{w.resizable ? ' · قابل للتغيير' : ''}</span>
                      {w.module && <span className="badge bg-slate-100 text-slate-500"><Lock className="h-2.5 w-2.5" /> يحتاج وحدة {label(w.module)}</span>}
                      {w.roles && <span className="badge bg-slate-100 text-slate-500"><Users className="h-2.5 w-2.5" /> {w.roles.map((r) => ROLE_LABELS[r]).join(' · ')}</span>}
                    </span>
                  </span>
                  <button type="button" onClick={() => add(w.key)} className="btn-primary flex shrink-0 items-center gap-1 !px-3 !py-1.5 text-xs"><Plus className="h-3.5 w-3.5" /> إضافة</button>
                </div>
              );
            })}
          </div>
        </section>

        <SaveBar dirty={dirty} saving={saving} saved={saved} customized={widgetsCustomized} onSave={save} onReset={reset} error={error} />
      </OwnerGate>
    </AppShell>
  );
}
