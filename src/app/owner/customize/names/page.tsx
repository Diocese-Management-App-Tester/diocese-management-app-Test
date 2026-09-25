'use client';

// ---------- تخصيص التطبيق → أسماء الصفحات والوحدات ----------
// One place to rename ANY destination (core page · module · owner module).
// The custom name is applied everywhere: page title, taskbar, side menu,
// header links, home widgets and quick actions. Saving writes
// app_settings.names (realtime → all devices).

import { useEffect, useMemo, useState } from 'react';
import { Type, RotateCcw, Search, type LucideIcon } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { OwnerGate } from '@/components/ModuleGate';
import { EditorHeader, SaveBar, KIND_LABEL } from '@/components/customize/shared';
import { useCustomization } from '@/lib/customization-context';
import { ALL_DESTINATIONS, MAX_NAME_LENGTH, type NamesConfig } from '@/lib/navigation';

export default function CustomizeNamesPage() {
  const { names, loading, saveNames } = useCustomization();

  const [draft, setDraft] = useState<NamesConfig>(names);
  const [pristine, setPristine] = useState(JSON.stringify(names));
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // follow remote changes while nothing is edited locally
  useEffect(() => {
    const remote = JSON.stringify(names);
    if (JSON.stringify(draft) === pristine) setDraft(names);
    setPristine(remote);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names]);

  const dirty = JSON.stringify(draft) !== pristine;
  const customCount = Object.keys(draft).length;

  const list = useMemo(() => {
    const needle = q.trim();
    if (!needle) return ALL_DESTINATIONS;
    return ALL_DESTINATIONS.filter((d) => d.label.includes(needle) || (draft[d.key] ?? '').includes(needle));
  }, [q, draft]);

  const setName = (key: string, value: string, defaultLabel: string) => {
    setSaved(false);
    setDraft((prev) => {
      const next = { ...prev };
      const v = value.slice(0, MAX_NAME_LENGTH);
      if (!v.trim() || v.trim() === defaultLabel) delete next[key];
      else next[key] = v;
      return next;
    });
  };

  const save = async () => {
    setSaving(true); setError('');
    const cleaned: NamesConfig = {};
    for (const [k, v] of Object.entries(draft)) if (v.trim()) cleaned[k] = v.trim();
    const err = await saveNames(cleaned);
    setSaving(false);
    if (err) { setError(`تعذر الحفظ — تأكد من تشغيل الترحيل 0036 (${err})`); return; }
    setDraft(cleaned);
    setPristine(JSON.stringify(cleaned));
    setSaved(true);
  };

  const reset = async () => {
    if (!confirm('إرجاع كل الأسماء إلى الافتراضي؟')) return;
    setSaving(true); setError('');
    const err = await saveNames({});
    setSaving(false);
    if (err) { setError(`تعذر الحفظ — تأكد من تشغيل الترحيل 0036 (${err})`); return; }
    setDraft({});
    setPristine('{}');
    setSaved(true);
  };

  return (
    <AppShell>
      <OwnerGate>
        <EditorHeader
          back="/owner/customize"
          icon={Type}
          title="أسماء الصفحات والوحدات"
          badge={customCount ? `${customCount} مخصص` : undefined}
          info={<>الاسم الذي تكتبه هنا يظهر في <b>كل مكان</b>: عنوان الصفحة نفسها، شريط المهام، القائمة الجانبية، الهيدر، وودجات الرئيسية. اترك الحقل فارغاً للاسم الافتراضي.</>}
        />

        <div className="relative mb-3">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            id="names-search"
            className="input-field !pr-9 text-sm"
            placeholder="ابحث عن صفحة أو وحدة…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {loading ? null : (
          <ul id="names-list" className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
            {list.length === 0 && (
              <li className="px-4 py-6 text-center text-xs font-bold text-slate-400">لا نتائج</li>
            )}
            {list.map((d) => {
              const Icon: LucideIcon = d.icon;
              const custom = draft[d.key];
              const isCustom = !!custom;
              return (
                <li key={d.key} id={`name-${d.key}`} className="flex items-center gap-3 px-3 py-2.5">
                  <span className={`shrink-0 rounded-xl p-2 ${isCustom ? 'bg-primary-50' : 'bg-slate-50'}`}>
                    <Icon className={`h-5 w-5 ${d.color ?? 'text-slate-500'}`} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold text-slate-400">
                      <span className="truncate">{d.label}</span>
                      <span className="badge bg-slate-100 text-slate-500">{KIND_LABEL[d.kind]}</span>
                    </div>
                    <input
                      className={`input-field !py-1.5 !px-3 text-sm font-bold ${isCustom ? '!border-primary-300 !bg-primary-50/40' : ''}`}
                      placeholder={d.label}
                      value={custom ?? ''}
                      maxLength={MAX_NAME_LENGTH}
                      onChange={(e) => setName(d.key, e.target.value, d.label)}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setName(d.key, '', d.label)}
                    disabled={!isCustom}
                    aria-label="الاسم الافتراضي"
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-30"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <SaveBar
          dirty={dirty}
          saving={saving}
          saved={saved}
          customized={Object.keys(names).length > 0}
          onSave={save}
          onReset={reset}
          error={error}
        />
      </OwnerGate>
    </AppShell>
  );
}
