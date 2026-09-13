'use client';

// ---------- تخصيص التطبيق → شريط المهام ----------
// The owner decides which 5 destinations (core pages · modules · owner
// module) sit in the bottom bar, their order, and — per slot — a custom icon
// and label. Everything else lands in the side menu below the 5.
// Live preview on top; saving writes app_settings.navigation (realtime).

import { useEffect, useMemo, useState } from 'react';
import {
  PanelBottom, ChevronRight, ChevronLeft, Pencil, RotateCcw, Layers, Info, Menu, type LucideIcon,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { OwnerGate } from '@/components/ModuleGate';
import IconPicker from '@/components/customize/IconPicker';
import { EditorHeader, SaveBar, KIND_LABEL } from '@/components/customize/shared';
import { useCustomization } from '@/lib/customization-context';
import {
  ALL_DESTINATIONS, DEST_BY_KEY, TASKBAR_SIZE, DEFAULT_NAVIGATION, resolveIcon,
  type NavigationConfig, type TaskbarSlot,
} from '@/lib/navigation';

export default function CustomizeTaskbarPage() {
  const { navigation, customized, loading, saveNavigation, resetNavigation } = useCustomization();

  const [slots, setSlots] = useState<TaskbarSlot[]>(navigation.taskbar);
  const [pristine, setPristine] = useState(JSON.stringify(navigation.taskbar));
  const [picking, setPicking] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // follow remote changes while nothing is edited locally
  useEffect(() => {
    const remote = JSON.stringify(navigation.taskbar);
    if (JSON.stringify(slots) === pristine) { setSlots(navigation.taskbar); }
    setPristine(remote);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation.taskbar]);

  const dirty = JSON.stringify(slots) !== pristine;
  const usedKeys = useMemo(() => new Set(slots.map((s) => s.key)), [slots]);
  const rest = ALL_DESTINATIONS.filter((d) => !usedKeys.has(d.key));

  const update = (i: number, patch: Partial<TaskbarSlot> | null) => {
    setSaved(false);
    setSlots((prev) => prev.map((s, idx) => {
      if (idx !== i) return s;
      if (patch === null) return { key: s.key };                // reset icon + label
      const next: TaskbarSlot = { ...s, ...patch };
      if (!next.icon) delete next.icon;
      if (!next.label || !next.label.trim()) delete next.label;
      return next;
    }));
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= slots.length) return;
    setSaved(false);
    setSlots((prev) => {
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const save = async () => {
    setSaving(true); setError('');
    const cfg: NavigationConfig = { ...navigation, taskbar: slots };
    const err = await saveNavigation(cfg);
    setSaving(false);
    if (err) { setError(`تعذر الحفظ — تأكد من تشغيل الترحيل 0035 (${err})`); return; }
    setPristine(JSON.stringify(slots));
    setSaved(true);
  };

  const reset = async () => {
    if (!confirm('إرجاع شريط المهام إلى الشكل الافتراضي؟')) return;
    setSaving(true); setError('');
    // only the taskbar goes back to default — the header keeps its layout
    const cfg: NavigationConfig = { ...navigation, taskbar: DEFAULT_NAVIGATION.taskbar };
    const headerIsDefault = JSON.stringify(navigation.header) === JSON.stringify(DEFAULT_NAVIGATION.header);
    const err = headerIsDefault ? await resetNavigation() : await saveNavigation(cfg);
    setSaving(false);
    if (err) { setError(`تعذر الحفظ — تأكد من تشغيل الترحيل 0035 (${err})`); return; }
    setSlots(DEFAULT_NAVIGATION.taskbar);
    setPristine(JSON.stringify(DEFAULT_NAVIGATION.taskbar));
    setSaved(true);
  };

  return (
    <AppShell>
      <OwnerGate>
        <EditorHeader back="/owner/customize" icon={PanelBottom} title="شريط المهام" badge={`${TASKBAR_SIZE} خانات`} />

        {/* ---------- live preview ---------- */}
        <section id="taskbar-preview" className="mb-4 overflow-hidden rounded-2xl border border-indigo-100 bg-slate-100 shadow-card">
          <p className="px-4 pt-3 text-[11px] font-bold text-slate-400">معاينة مباشرة</p>
          <div className="mx-3 mb-3 mt-2 overflow-hidden rounded-xl border border-indigo-100 bg-white shadow-nav">
            <div className="grid grid-cols-5">
              {slots.map((s, i) => {
                const d = DEST_BY_KEY[s.key];
                const Icon = resolveIcon(s.icon, d.icon);
                const owner = d.kind === 'owner';
                return (
                  <div
                    key={s.key}
                    className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-bold ${
                      i === 0 ? (owner ? 'text-gold-600' : 'text-primary-600') : 'text-slate-400'
                    }`}
                  >
                    <span className={`rounded-xl px-3 py-1 ${i === 0 ? (owner ? 'bg-gold-100' : 'bg-primary-100') : ''}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="max-w-full truncate px-0.5">{s.label ?? d.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <p className="mb-4 flex items-start gap-2 rounded-2xl bg-indigo-50 px-4 py-3 text-xs font-bold text-indigo-700">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            لكل خانة: اختر الوجهة (صفحة أساسية أو وحدة)، غيّر الأيقونة أو الاسم، وحرّك الترتيب بالأسهم.
            الخادم الذي لا تُفعَّل له وحدة موجودة في الشريط يرى بدلاً منها صفحة أساسية.
          </span>
        </p>

        {/* ---------- 5 slots ---------- */}
        {loading ? null : (
          <ul id="taskbar-slots" className="space-y-3">
            {slots.map((s, i) => {
              const d = DEST_BY_KEY[s.key];
              const Icon = resolveIcon(s.icon, d.icon);
              const changed = !!s.icon || !!s.label;
              return (
                <li key={s.key} id={`taskbar-slot-${i + 1}`} className="card !p-0 overflow-hidden">
                  <div className="flex items-center gap-3 px-3 py-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-xs font-extrabold tabular-nums text-white">
                      {i + 1}
                    </span>

                    {/* icon (tap → picker) */}
                    <button
                      type="button"
                      onClick={() => setPicking(i)}
                      aria-label="تغيير الأيقونة"
                      className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border-2 transition hover:bg-slate-50 ${
                        s.icon ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-600'
                      }`}
                    >
                      <Icon className="h-6 w-6" />
                      <span className="absolute -bottom-1.5 -left-1.5 rounded-full bg-white p-0.5 shadow ring-1 ring-slate-200">
                        <Pencil className="h-3 w-3 text-slate-500" />
                      </span>
                    </button>

                    <div className="min-w-0 flex-1 space-y-1.5">
                      {/* destination */}
                      <select
                        id={`taskbar-slot-${i + 1}-dest`}
                        className="input-field !py-2 !px-3 text-sm font-bold"
                        value={s.key}
                        onChange={(e) => update(i, { key: e.target.value, icon: undefined, label: undefined })}
                      >
                        {ALL_DESTINATIONS.filter((x) => x.key === s.key || !usedKeys.has(x.key)).map((x) => (
                          <option key={x.key} value={x.key}>
                            {x.label} — {KIND_LABEL[x.kind]}
                          </option>
                        ))}
                      </select>
                      {/* label */}
                      <input
                        id={`taskbar-slot-${i + 1}-label`}
                        className="input-field !py-2 !px-3 text-sm"
                        placeholder={`الاسم في الشريط (الافتراضي: ${d.label})`}
                        value={s.label ?? ''}
                        maxLength={20}
                        onChange={(e) => update(i, { label: e.target.value })}
                      />
                    </div>

                    {/* order arrows — RTL: right = towards start */}
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        aria-label="تحريك لليمين"
                        className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-30"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(i, 1)}
                        disabled={i === slots.length - 1}
                        aria-label="تحريك لليسار"
                        className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-30"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  {changed && (
                    <div className="flex items-center justify-between border-t border-indigo-50 bg-slate-50/60 px-3 py-1.5">
                      <span className="text-[11px] font-bold text-slate-400">
                        {s.icon && <>أيقونة: <span dir="ltr">{s.icon}</span></>}
                        {s.icon && s.label && ' · '}
                        {s.label && <>الاسم الافتراضي: {d.label}</>}
                      </span>
                      <button
                        type="button"
                        onClick={() => update(i, null)}
                        className="flex items-center gap-1 text-[11px] font-bold text-primary-600 hover:underline"
                      >
                        <RotateCcw className="h-3 w-3" /> الافتراضي
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* ---------- what goes to the side menu ---------- */}
        <section id="taskbar-rest" className="mt-5">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-extrabold text-slate-500">
            <Menu className="h-4 w-4" />
            في القائمة الجانبية (أسفل الخمسة)
            <span className="badge bg-slate-100 text-slate-500">{rest.length}</span>
          </h3>
          <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
            {rest.length === 0 ? (
              <p className="px-4 py-4 text-center text-xs font-bold text-slate-400">كل الوجهات في الشريط</p>
            ) : rest.map((d) => {
              const Icon: LucideIcon = d.icon;
              return (
                <div key={d.key} className="flex items-center gap-3 px-4 py-2.5">
                  <Icon className={`h-5 w-5 shrink-0 ${d.color ?? 'text-slate-500'}`} />
                  <span className="flex-1 text-sm font-bold text-slate-700">{d.label}</span>
                  <span className="badge bg-slate-100 text-slate-500 flex items-center gap-1">
                    <Layers className="h-3 w-3" /> {KIND_LABEL[d.kind]}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 px-1 text-[11px] font-bold text-slate-400">
            كل خادم يرى من هذه القائمة الوحدات المفعّلة لنطاقه فقط (صلاحيات الوحدات).
          </p>
        </section>

        <SaveBar
          dirty={dirty}
          saving={saving}
          saved={saved}
          customized={customized}
          onSave={save}
          onReset={reset}
          error={error}
        />

        {picking !== null && (
          <IconPicker
            title={`أيقونة «${slots[picking].label ?? DEST_BY_KEY[slots[picking].key].label}»`}
            value={slots[picking].icon}
            defaultName={DEST_BY_KEY[slots[picking].key].iconName}
            onPick={(name) => { update(picking, { icon: name }); setPicking(null); }}
            onClose={() => setPicking(null)}
          />
        )}
      </OwnerGate>
    </AppShell>
  );
}
