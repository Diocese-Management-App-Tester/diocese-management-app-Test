'use client';

// ---------- تخصيص التطبيق → أيقونات الهيدر ----------
// The owner picks which icons sit in the header (end side, before the fixed
// menu button) and their order: built-in widgets (تاريخ العمل · جرس الرسائل
// · جرس الإشعارات) and QUICK LINKS to any destination (core page / module).
// Each item may carry a custom icon (the date button keeps its own look).

import { useEffect, useMemo, useState } from 'react';
import {
  PanelTop, ChevronRight, ChevronLeft, Pencil, Trash2, Plus, Menu, Info, Link as LinkIcon, RotateCcw, X,
} from 'lucide-react';
import Image from 'next/image';
import AppShell from '@/components/AppShell';
import { OwnerGate } from '@/components/ModuleGate';
import IconPicker from '@/components/customize/IconPicker';
import { EditorHeader, SaveBar, KIND_LABEL } from '@/components/customize/shared';
import { useAuth } from '@/lib/auth-context';
import { BRANDING, dioceseLogo } from '@/lib/branding';
import { useCustomization } from '@/lib/customization-context';
import {
  ALL_DESTINATIONS, DEST_BY_KEY, HEADER_WIDGETS, HEADER_WIDGET_BY_KEY, DEFAULT_NAVIGATION,
  isLinkItem, linkTarget, resolveIcon,
  type NavigationConfig, type HeaderItem,
} from '@/lib/navigation';

const MAX_ITEMS = 6;

function describe(item: HeaderItem, label: (key: string) => string) {
  if (isLinkItem(item.key)) {
    const d = DEST_BY_KEY[linkTarget(item.key)];
    return { label: label(d.key), sub: `رابط سريع — ${KIND_LABEL[d.kind]}`, defaultIcon: d.icon, defaultName: d.iconName, isDate: false };
  }
  const w = HEADER_WIDGET_BY_KEY[item.key];
  return { label: w.label, sub: w.desc, defaultIcon: w.icon, defaultName: w.iconName, isDate: w.key === 'date' };
}

export default function CustomizeHeaderPage() {
  const { church } = useAuth();
  const { navigation, customized, loading, saveNavigation, resetNavigation, label } = useCustomization();

  const [items, setItems] = useState<HeaderItem[]>(navigation.header);
  const [pristine, setPristine] = useState(JSON.stringify(navigation.header));
  const [picking, setPicking] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const remote = JSON.stringify(navigation.header);
    if (JSON.stringify(items) === pristine) setItems(navigation.header);
    setPristine(remote);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation.header]);

  const dirty = JSON.stringify(items) !== pristine;
  const used = useMemo(() => new Set(items.map((i) => i.key)), [items]);

  const availableWidgets = HEADER_WIDGETS.filter((w) => !used.has(w.key));
  const availableLinks = ALL_DESTINATIONS.filter((d) => !used.has(`link:${d.key}`));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    setSaved(false);
    setItems((prev) => { const n = [...prev]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  };
  const remove = (i: number) => { setSaved(false); setItems((prev) => prev.filter((_, idx) => idx !== i)); };
  const setIcon = (i: number, icon: string | undefined) => {
    setSaved(false);
    setItems((prev) => prev.map((it, idx) => {
      if (idx !== i) return it;
      const n: HeaderItem = { key: it.key };
      if (icon) n.icon = icon;
      return n;
    }));
  };
  const add = (key: string) => {
    if (items.length >= MAX_ITEMS || used.has(key)) return;
    setSaved(false);
    setItems((prev) => [...prev, { key }]);
    setAdding(false);
  };

  const save = async () => {
    setSaving(true); setError('');
    const cfg: NavigationConfig = { ...navigation, header: items };
    const err = await saveNavigation(cfg);
    setSaving(false);
    if (err) { setError(`تعذر الحفظ — تأكد من تشغيل الترحيل 0035 (${err})`); return; }
    setPristine(JSON.stringify(items));
    setSaved(true);
  };

  const reset = async () => {
    if (!confirm('إرجاع أيقونات الهيدر إلى الشكل الافتراضي؟')) return;
    setSaving(true); setError('');
    const cfg: NavigationConfig = { ...navigation, header: DEFAULT_NAVIGATION.header };
    const taskbarIsDefault = JSON.stringify(navigation.taskbar) === JSON.stringify(DEFAULT_NAVIGATION.taskbar);
    const err = taskbarIsDefault ? await resetNavigation() : await saveNavigation(cfg);
    setSaving(false);
    if (err) { setError(`تعذر الحفظ — تأكد من تشغيل الترحيل 0035 (${err})`); return; }
    setItems(DEFAULT_NAVIGATION.header);
    setPristine(JSON.stringify(DEFAULT_NAVIGATION.header));
    setSaved(true);
  };

  return (
    <AppShell>
      <OwnerGate>
        <EditorHeader back="/owner/customize" icon={PanelTop} title="أيقونات الهيدر" badge={`${items.length} / ${MAX_ITEMS}`} />

        {/* ---------- live preview ---------- */}
        <section id="header-preview" className="mb-4 overflow-hidden rounded-2xl border border-indigo-100 bg-slate-100 shadow-card">
          <p className="px-4 pt-3 text-[11px] font-bold text-slate-400">معاينة مباشرة</p>
          <div className="mx-3 mb-3 mt-2 overflow-hidden rounded-xl bg-gradient-to-l from-primary-700 via-primary-600 to-accent-600 text-white shadow">
            <div className="flex items-center gap-3 px-3 py-2.5">
              <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-white ring-2 ring-gold-300/70">
                <Image src={church?.logo_url ?? dioceseLogo(96)} alt="" fill sizes="40px" className="object-cover" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold leading-tight">{church?.name ?? BRANDING.dioceseName}</p>
                <p className="truncate text-[10px] text-indigo-100">الهيدر</p>
              </div>
              <div className="flex items-center gap-0.5">
                {items.map((it) => {
                  const d = describe(it, label);
                  if (d.isDate) {
                    return (
                      <span key={it.key} className="flex h-10 w-10 flex-col items-center justify-center rounded-xl bg-white/15 text-xs font-extrabold">
                        <span className="leading-none">١٣</span>
                        <span className="mt-0.5 text-[8px] leading-none opacity-90">سبتمبر</span>
                      </span>
                    );
                  }
                  const Icon = resolveIcon(it.icon, d.defaultIcon);
                  return (
                    <span key={it.key} className="rounded-full p-1.5">
                      <Icon className="h-5 w-5" />
                    </span>
                  );
                })}
              </div>
              <span className="rounded-full p-1.5 opacity-80"><Menu className="h-5 w-5" /></span>
            </div>
          </div>
        </section>

        <p className="mb-4 flex items-start gap-2 rounded-2xl bg-indigo-50 px-4 py-3 text-xs font-bold text-indigo-700">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            رتّب الأيقونات بالأسهم، غيّر أيقونة أي عنصر، احذف ما لا تريده وأضف روابط سريعة لأي صفحة أو وحدة.
            زر القائمة ثابت في النهاية. جرس الرسائل / الإشعارات يظهر فقط لمن لديه الوحدة.
          </span>
        </p>

        {/* ---------- items ---------- */}
        {loading ? null : items.length === 0 ? (
          <p id="header-empty" className="card py-8 text-center text-xs font-bold text-slate-400">
            لا توجد أيقونات في الهيدر — سيظهر زر القائمة فقط
          </p>
        ) : (
          <ul id="header-items" className="space-y-3">
            {items.map((it, i) => {
              const d = describe(it, label);
              const Icon = resolveIcon(it.icon, d.defaultIcon);
              return (
                <li key={it.key} id={`header-item-${i + 1}`} className="card !p-0 overflow-hidden">
                  <div className="flex items-center gap-3 px-3 py-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-xs font-extrabold tabular-nums text-white">
                      {i + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => !d.isDate && setPicking(i)}
                      disabled={d.isDate}
                      aria-label="تغيير الأيقونة"
                      title={d.isDate ? 'زر التاريخ له شكله الخاص' : 'تغيير الأيقونة'}
                      className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border-2 transition ${
                        d.isDate ? 'border-slate-200 bg-slate-50 text-slate-500' :
                        it.icon ? 'border-primary-300 bg-primary-50 text-primary-700 hover:bg-primary-100' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <Icon className="h-6 w-6" />
                      {!d.isDate && (
                        <span className="absolute -bottom-1.5 -left-1.5 rounded-full bg-white p-0.5 shadow ring-1 ring-slate-200">
                          <Pencil className="h-3 w-3 text-slate-500" />
                        </span>
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-sm font-extrabold text-slate-800">
                        {isLinkItem(it.key) && <LinkIcon className="h-3.5 w-3.5 text-slate-400" />}
                        {d.label}
                      </p>
                      <p className="truncate text-xs text-slate-400">{d.sub}</p>
                      {it.icon && (
                        <button
                          type="button"
                          onClick={() => setIcon(i, undefined)}
                          className="mt-1 flex items-center gap-1 text-[11px] font-bold text-primary-600 hover:underline"
                        >
                          <RotateCcw className="h-3 w-3" /> الأيقونة الافتراضية (<span dir="ltr">{it.icon}</span>)
                        </button>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="تحريك لليمين"
                        className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-30">
                        <ChevronRight className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="تحريك لليسار"
                        className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-30">
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      aria-label="حذف من الهيدر"
                      className="rounded-xl bg-red-50 p-2 text-red-600 transition hover:bg-red-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <button
          id="header-add"
          type="button"
          onClick={() => setAdding(true)}
          disabled={items.length >= MAX_ITEMS}
          className="btn-secondary mt-3 flex w-full items-center justify-center gap-1.5 !py-2.5 text-sm disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {items.length >= MAX_ITEMS ? `الحد الأقصى ${MAX_ITEMS} أيقونات` : 'إضافة أيقونة'}
        </button>

        <SaveBar
          dirty={dirty}
          saving={saving}
          saved={saved}
          customized={customized}
          onSave={save}
          onReset={reset}
          error={error}
        />

        {picking !== null && items[picking] && (
          <IconPicker
            title={`أيقونة «${describe(items[picking], label).label}»`}
            value={items[picking].icon}
            defaultName={describe(items[picking], label).defaultName}
            onPick={(name) => { setIcon(picking, name); setPicking(null); }}
            onClose={() => setPicking(null)}
          />
        )}

        {adding && (
          <div
            className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/45 backdrop-blur-[2px] p-0 sm:p-6"
            onClick={() => setAdding(false)}
          >
            <div
              id="header-add-modal"
              className="flex w-full max-w-md max-h-[85dvh] flex-col rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-indigo-50 px-5 py-4">
                <h3 className="text-base font-extrabold">إضافة أيقونة للهيدر</h3>
                <button onClick={() => setAdding(false)} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                <div>
                  <p className="mb-2 text-xs font-extrabold text-slate-500">عناصر الهيدر</p>
                  {availableWidgets.length === 0 ? (
                    <p className="text-xs font-bold text-slate-400">كلها مضافة</p>
                  ) : (
                    <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
                      {availableWidgets.map((w) => {
                        const Icon = w.icon;
                        return (
                          <button key={w.key} type="button" onClick={() => add(w.key)}
                            className="flex w-full items-center gap-3 px-4 py-3 text-start transition hover:bg-indigo-50/50">
                            <Icon className="h-5 w-5 shrink-0 text-primary-600" />
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-bold">{w.label}</span>
                              <span className="block truncate text-xs text-slate-400">{w.desc}</span>
                            </span>
                            <Plus className="h-4 w-4 text-slate-300" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-extrabold text-slate-500">
                    <LinkIcon className="h-3.5 w-3.5" /> روابط سريعة
                  </p>
                  <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
                    {availableLinks.map((d) => {
                      const Icon = d.icon;
                      return (
                        <button key={d.key} type="button" onClick={() => add(`link:${d.key}`)}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-start transition hover:bg-indigo-50/50">
                          <Icon className={`h-5 w-5 shrink-0 ${d.color ?? 'text-slate-600'}`} />
                          <span className="flex-1 text-sm font-bold">{label(d.key)}</span>
                          <span className="badge bg-slate-100 text-slate-500">{KIND_LABEL[d.kind]}</span>
                          <Plus className="h-4 w-4 text-slate-300" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </OwnerGate>
    </AppShell>
  );
}
