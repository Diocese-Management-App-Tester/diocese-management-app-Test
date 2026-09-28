'use client';

// ---------- FINANCE MODULE (الخزينة) — /finance ----------
// Three tabs:
//   نظرة عامة  — balance NOW (all time) · income / expense / net of a period
//                (this month · last month · 30d · this year · 12 months · all ·
//                custom) · timeline chart per day / month / year · totals per
//                cause (income and expense) — all for the chosen scope
//   القيود     — the entries list (filter by kind / scope / period), edit /
//                delete for managers
//   الأسباب    — the static causes of the scope (create · edit · delete)
// «+ إيراد» / «+ مصروف» open the entry form from anywhere.

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Wallet, ArrowRight, Loader2, Plus, TrendingUp, TrendingDown, Scale, Tag, Pencil, Trash2, ListOrdered,
  PieChart, LineChart, Filter, PenLine, ChevronDown, Info, Lock, CalendarDays,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { useAppDate } from '@/lib/app-date-context';
import { createClient } from '@/lib/supabase/client';
import { cachedLookup } from '@/lib/queries';
import { useDebouncedRealtime } from '@/lib/realtime';
import { useNavLabel } from '@/lib/customization-context';
import { cairoToday } from '@/lib/time';
import type { Church, Service, ClassRoom } from '@/lib/types';
import { SectionCard, KpiTile, StackedBarChart, RankedBars } from '@/components/stats/Charts';
import type { Series } from '@/lib/stats';
import {
  fetchFinancePermissions, fetchFinanceCauses, fetchFinanceEntries, fetchFinanceSummary, deleteFinanceEntry, deleteFinanceCause,
  resolvePeriod, financeBucketKeys, financeBucketLabel, fmtMoney, fmtSignedMoney, fmtEntryDay, financeErrorMessage,
  PERIOD_PRESETS, KIND_LABELS, KIND_PLURAL, CAUSE_KIND_LABELS,
  type FinanceCause, type FinanceEntry, type FinancePermissions, type FinanceSummary, type FinanceKind, type FinancePeriodPreset, type CauseKind,
} from '@/lib/finance';
import { EntryFormModal, CauseFormModal, type ScopeLookups } from '@/components/finance/FinanceForms';

type Tab = 'overview' | 'entries' | 'causes';
type ScopeRefLite = { church_id: string; service_id: string | null; class_id: string | null };
const ALL = 'all';
const TABS: { key: Tab; label: string; icon: typeof Wallet }[] = [
  { key: 'overview', label: 'نظرة عامة', icon: PieChart },
  { key: 'entries', label: 'القيود', icon: ListOrdered },
  { key: 'causes', label: 'الأسباب', icon: Tag },
];

export default function FinancePage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>}>
        <FinanceModule />
      </Suspense>
    </AppShell>
  );
}

function FinanceModule() {
  const pageName = useNavLabel('finance');
  const { profile } = useAuth();
  const { now } = useAppDate();
  const router = useRouter();
  const params = useSearchParams();
  const [supabase] = useState(() => createClient());
  const today = cairoToday(now());

  const tab = ((params.get('tab') as Tab) || 'overview');
  const go = (t: Tab) => router.replace(t === 'overview' ? '/finance' : `/finance?tab=${t}`);

  // ---------- lookups ----------
  const [lookups, setLookups] = useState<ScopeLookups>({ churches: [], services: [], classes: [] });
  useEffect(() => {
    (async () => {
      const [churches, services, classes] = await Promise.all([
        cachedLookup<Church>(supabase, 'churches'),
        cachedLookup<Service>(supabase, 'services'),
        cachedLookup<ClassRoom>(supabase, 'classes'),
      ]);
      setLookups({ churches, services, classes });
    })();
  }, [supabase]);

  // ---------- scope filter (shared by the 3 tabs) ----------
  const [churchId, setChurchId] = useState<string>(ALL);
  const [serviceId, setServiceId] = useState<string>(ALL);
  const [classId, setClassId] = useState<string>(ALL);
  useEffect(() => {
    // default to the caller's own place once the profile is known
    if (!profile) return;
    if (profile.church_id) setChurchId(profile.church_id);
    if (profile.service_id) setServiceId(profile.service_id);
    if (profile.class_id) setClassId(profile.class_id);
  }, [profile]);
  const scope = useMemo(() => ({
    church_id: churchId === ALL ? null : churchId,
    service_id: churchId === ALL || serviceId === ALL ? null : serviceId,
    class_id: churchId === ALL || serviceId === ALL || classId === ALL ? null : classId,
  }), [churchId, serviceId, classId]);
  const visibleServices = useMemo(() => lookups.services.filter((s) => churchId !== ALL && s.church_id === churchId), [lookups.services, churchId]);
  const visibleClasses = useMemo(() => lookups.classes.filter((c) => serviceId !== ALL && c.service_id === serviceId), [lookups.classes, serviceId]);
  const scopeName = useCallback((e: ScopeRefLite) => {
    const c = lookups.churches.find((x) => x.id === e.church_id)?.name;
    const s = e.service_id ? lookups.services.find((x) => x.id === e.service_id)?.name : null;
    const k = e.class_id ? lookups.classes.find((x) => x.id === e.class_id)?.name : null;
    return [lookups.churches.length > 1 ? c : null, s ?? 'كل الخدمات', k].filter(Boolean).join(' ← ');
  }, [lookups]);

  // ---------- period ----------
  const [preset, setPreset] = useState<FinancePeriodPreset>('month');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const period = useMemo(() => resolvePeriod(preset, today, custom.from && custom.to ? custom : undefined), [preset, today, custom]);

  // ---------- data ----------
  const [perms, setPerms] = useState<FinancePermissions>({ view: false, add: false, manage: false });
  const [causes, setCauses] = useState<FinanceCause[]>([]);
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [kindFilter, setKindFilter] = useState<FinanceKind | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    try {
      const [p, cs, es, sm] = await Promise.all([
        fetchFinancePermissions(supabase),
        fetchFinanceCauses(supabase),
        fetchFinanceEntries(supabase, { ...scope, kind: kindFilter === 'all' ? null : kindFilter, from: period.from, to: period.to }),
        fetchFinanceSummary(supabase, scope, period),
      ]);
      setPerms(p); setCauses(cs); setEntries(es); setSummary(sm); setLoadError('');
    } catch (err) {
      setLoadError(financeErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [supabase, scope, period, kindFilter]);
  useEffect(() => { if (profile?.status === 'approved') load(); }, [profile?.status, load]);
  useDebouncedRealtime(supabase, 'finance-module', [{ table: 'finance_entries' }, { table: 'finance_causes' }], load, {
    enabled: profile?.status === 'approved', delayMs: 600,
  });

  // ---------- modals ----------
  const [entryForm, setEntryForm] = useState<{ open: boolean; item: FinanceEntry | null; kind: FinanceKind }>({ open: false, item: null, kind: 'expense' });
  const [causeForm, setCauseForm] = useState<{ open: boolean; item: FinanceCause | null; scope?: ScopeRefLite | null; kind?: CauseKind }>({ open: false, item: null });
  const [deleteEntry, setDeleteEntry] = useState<FinanceEntry | null>(null);
  const [deleteCause, setDeleteCause] = useState<FinanceCause | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2500); return () => clearTimeout(t); }, [toast]);

  const onEntrySaved = (e: FinanceEntry) => {
    setEntryForm({ open: false, item: null, kind: e.kind });
    setToast(`${KIND_LABELS[e.kind]} ${fmtMoney(e.amount)} — ${e.cause_text ?? ''} ✓`);
    load();
  };
  const onCauseSaved = (c: FinanceCause) => {
    setCauses((prev) => {
      const i = prev.findIndex((x) => x.id === c.id);
      return i >= 0 ? prev.map((x) => (x.id === c.id ? c : x)) : [...prev, c];
    });
    setCauseForm({ open: false, item: null });
  };
  const doDeleteEntry = async () => {
    if (!deleteEntry) return;
    setBusy(true);
    try { await deleteFinanceEntry(supabase, deleteEntry.id); setDeleteEntry(null); load(); } catch (err) { setToast(financeErrorMessage(err)); } finally { setBusy(false); }
  };
  const doDeleteCause = async () => {
    if (!deleteCause) return;
    setBusy(true);
    try { await deleteFinanceCause(supabase, deleteCause.id); setCauses((p) => p.filter((x) => x.id !== deleteCause.id)); setDeleteCause(null); } catch (err) { setToast(financeErrorMessage(err)); } finally { setBusy(false); }
  };

  // ---------- chart data ----------
  const chart = useMemo(() => {
    if (!summary) return null;
    const keys = financeBucketKeys(period);
    const byKey = new Map(summary.series.map((s) => [s.key, s]));
    const income = keys.map((k) => byKey.get(k)?.income ?? 0);
    const expense = keys.map((k) => byKey.get(k)?.expense ?? 0);
    const series: Series[] = [
      { key: 'income', label: 'الإيرادات', total: income.reduce((a, b) => a + b, 0), values: income },
      { key: 'expense', label: 'المصروفات', total: expense.reduce((a, b) => a + b, 0), values: expense },
    ];
    return {
      series,
      labels: keys.map((k) => financeBucketLabel(k, period.bucket)),
      longLabels: keys.map((k) => financeBucketLabel(k, period.bucket, true)),
      byCause: (kind: FinanceKind) => summary.by_cause.filter((c) => c.kind === kind).map((c) => ({
        key: `${c.kind}-${c.cause_id ?? c.cause}`,
        label: c.cause,
        value: c.total,
        sublabel: `${c.count} ${c.count === 1 ? 'قيد' : 'قيود'}${c.cause_id ? '' : ' · سبب مكتوب'}`,
        color: kind === 'income' ? '#10b981' : '#f43f5e',
      })),
    };
  }, [summary, period]);

  const visibleCauses = useMemo(() => causes.filter((c) =>
    (scope.church_id === null || c.church_id === scope.church_id) &&
    (scope.service_id === null || c.service_id === null || c.service_id === scope.service_id) &&
    (scope.class_id === null || c.class_id === null || c.class_id === scope.class_id)), [causes, scope]);

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>;

  const bucketWord = period.bucket === 'day' ? 'يومياً' : period.bucket === 'week' ? 'أسبوعياً' : period.bucket === 'month' ? 'شهرياً' : 'سنوياً';
  const periodLabel = PERIOD_PRESETS.find((p) => p.value === preset)?.label ?? '';

  return (
    <>
      {/* ---------- header ---------- */}
      <section className="mb-3 flex items-center gap-2">
        <Link href="/settings" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100"><ArrowRight className="h-5 w-5" /></Link>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-lg font-extrabold"><Wallet className="h-5 w-5 text-green-700" /> {pageName}</h2>
          <p className="mt-0.5 text-xs text-slate-500">إيرادات ومصروفات بسبب — والرصيد الحالي وما دخل وما خرج خلال الفترة</p>
        </div>
      </section>

      {/* ---------- quick actions ---------- */}
      {perms.add && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <button id="finance-add-income" type="button" onClick={() => setEntryForm({ open: true, item: null, kind: 'income' })}
            className="flex items-center justify-center gap-1.5 rounded-2xl bg-emerald-600 py-3 font-extrabold text-white shadow-md active:scale-[0.98]">
            <Plus className="h-4 w-4" /><TrendingUp className="h-4 w-4" /> إيراد
          </button>
          <button id="finance-add-expense" type="button" onClick={() => setEntryForm({ open: true, item: null, kind: 'expense' })}
            className="flex items-center justify-center gap-1.5 rounded-2xl bg-rose-600 py-3 font-extrabold text-white shadow-md active:scale-[0.98]">
            <Plus className="h-4 w-4" /><TrendingDown className="h-4 w-4" /> مصروف
          </button>
        </div>
      )}

      {loadError && <p className="mb-3 rounded-2xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">{loadError}</p>}

      {/* ---------- tabs ---------- */}
      <div className="mb-3 grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1">
        {TABS.map((t) => (
          <button key={t.key} id={`finance-tab-${t.key}`} type="button" onClick={() => go(t.key)} aria-pressed={tab === t.key}
            className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-extrabold ${tab === t.key ? 'bg-white text-primary-700 shadow' : 'text-slate-500'}`}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* ---------- scope + period filters ---------- */}
      <div className="card mb-3 !p-3">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-extrabold text-slate-500"><Filter className="h-3.5 w-3.5" /> الخزينة</div>
        <div className="grid grid-cols-3 gap-1.5">
          <Select id="finance-scope-church" value={churchId} onChange={(v) => { setChurchId(v); setServiceId(ALL); setClassId(ALL); }} allLabel="كل الكنائس" options={lookups.churches} disabled={!!profile && profile.role !== 'owner'} />
          <Select id="finance-scope-service" value={serviceId} onChange={(v) => { setServiceId(v); setClassId(ALL); }} allLabel="كل الخدمات" options={visibleServices} disabled={churchId === ALL || (!!profile?.service_id && profile.role !== 'owner' && profile.role !== 'church_manager')} />
          <Select id="finance-scope-class" value={classId} onChange={setClassId} allLabel="كل الفصول" options={visibleClasses} disabled={serviceId === ALL || (!!profile?.class_id && profile.role === 'class_servant')} />
        </div>
        {tab !== 'causes' && (
          <>
            <div className="mb-1.5 mt-3 flex items-center gap-1.5 text-[11px] font-extrabold text-slate-500"><CalendarDays className="h-3.5 w-3.5" /> الفترة</div>
            <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5">
              {PERIOD_PRESETS.map((p) => (
                <button key={p.value} id={`finance-period-${p.value}`} type="button" onClick={() => setPreset(p.value)} aria-pressed={preset === p.value}
                  className={`shrink-0 rounded-full border-2 px-3 py-1 text-[11px] font-extrabold ${preset === p.value ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-slate-200 bg-white text-slate-600'}`}>{p.label}</button>
              ))}
            </div>
            {preset === 'custom' && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input type="date" aria-label="من" className="input-field !py-2 !px-2 text-xs" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
                <input type="date" aria-label="إلى" className="input-field !py-2 !px-2 text-xs" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
              </div>
            )}
          </>
        )}
      </div>

      {/* ================= OVERVIEW ================= */}
      {tab === 'overview' && summary && chart && (
        <div className="space-y-3">
          <div id="finance-balance" className={`card !border-0 bg-gradient-to-l ${summary.balance.net >= 0 ? 'from-green-700 to-emerald-500' : 'from-rose-700 to-rose-500'} text-white`}>
            <div className="flex items-center gap-2 text-xs font-bold text-white/80"><Scale className="h-4 w-4" /> الرصيد الحالي (كل الوقت)</div>
            <p className="mt-1 text-3xl font-extrabold tabular-nums">{fmtSignedMoney(summary.balance.net)}</p>
            <div className="mt-2 flex gap-4 text-[11px] font-bold text-white/85">
              <span className="inline-flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5" /> دخل {fmtMoney(summary.balance.income)}</span>
              <span className="inline-flex items-center gap-1"><TrendingDown className="h-3.5 w-3.5" /> خرج {fmtMoney(summary.balance.expense)}</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <KpiTile id="finance-kpi-income" icon={TrendingUp} tone="emerald" compact value={fmtMoney(summary.period.income)} label="إيرادات الفترة" />
            <KpiTile id="finance-kpi-expense" icon={TrendingDown} tone="rose" compact value={fmtMoney(summary.period.expense)} label="مصروفات الفترة" />
            <KpiTile id="finance-kpi-net" icon={Scale} tone={summary.period.net >= 0 ? 'primary' : 'rose'} compact value={fmtSignedMoney(summary.period.net)} label="صافي الفترة" hint={`${summary.period.count} قيد`} />
          </div>

          <SectionCard id="finance-timeline" icon={LineChart} tone="emerald" title={`الإيرادات والمصروفات ${bucketWord}`} subtitle={periodLabel}>
            <StackedBarChart id="finance-chart" series={chart.series} labels={chart.labels} longLabels={chart.longLabels} mode="grouped" emptyText="لا توجد قيود في هذه الفترة" />
          </SectionCard>

          <div className="grid gap-3 sm:grid-cols-2">
            <SectionCard id="finance-by-cause-income" icon={TrendingUp} tone="emerald" title="الإيرادات حسب السبب" subtitle={periodLabel}>
              <RankedBars items={chart.byCause('income')} valueLabel={fmtMoney} emptyText="لا إيرادات في هذه الفترة" />
            </SectionCard>
            <SectionCard id="finance-by-cause-expense" icon={TrendingDown} tone="rose" title="المصروفات حسب السبب" subtitle={periodLabel}>
              <RankedBars items={chart.byCause('expense')} valueLabel={fmtMoney} emptyText="لا مصروفات في هذه الفترة" />
            </SectionCard>
          </div>
        </div>
      )}

      {/* ================= ENTRIES ================= */}
      {tab === 'entries' && (
        <>
          <div className="mb-3 grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1">
            {(['all', 'income', 'expense'] as const).map((k) => (
              <button key={k} id={`finance-kind-${k}`} type="button" onClick={() => setKindFilter(k)} aria-pressed={kindFilter === k}
                className={`rounded-xl py-1.5 text-xs font-extrabold ${kindFilter === k ? 'bg-white shadow ' + (k === 'income' ? 'text-emerald-700' : k === 'expense' ? 'text-rose-700' : 'text-primary-700') : 'text-slate-500'}`}>
                {k === 'all' ? 'الكل' : KIND_PLURAL[k]}
              </button>
            ))}
          </div>
          {entries.length === 0 ? (
            <div className="card py-10 text-center">
              <Wallet className="mx-auto mb-2 h-10 w-10 text-slate-300" />
              <p className="font-bold text-slate-500">لا توجد قيود في هذه الفترة</p>
              {perms.add && <p className="mt-1 text-xs font-bold text-slate-400">سجّل أول إيراد أو مصروف من الزرين بالأعلى</p>}
            </div>
          ) : (
            <ul id="finance-entries" className="space-y-2">
              {groupByDay(entries).map(([day, rows]) => (
                <li key={day}>
                  <div className="mb-1 flex items-center justify-between px-1 text-[11px] font-extrabold text-slate-400">
                    <span>{fmtEntryDay(day)}</span>
                    <span className="tabular-nums">{fmtSignedMoney(rows.reduce((a, r) => a + (r.kind === 'income' ? r.amount : -r.amount), 0))}</span>
                  </div>
                  <ul className="space-y-1.5">
                    {rows.map((e) => (
                      <li key={e.id} id={`finance-entry-${e.id}`} className="card flex items-center gap-3 !p-3">
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${e.kind === 'income' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                          {e.kind === 'income' ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1 truncate text-sm font-extrabold text-slate-800">
                            {e.cause_id ? <Tag className="h-3 w-3 shrink-0 text-slate-400" /> : <PenLine className="h-3 w-3 shrink-0 text-amber-500" />}
                            {e.cause_text}
                          </p>
                          <p className="truncate text-[11px] font-bold text-slate-400">{[scopeName(e), e.note].filter(Boolean).join(' · ')}</p>
                        </div>
                        <span className={`shrink-0 text-sm font-extrabold tabular-nums ${e.kind === 'income' ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {e.kind === 'income' ? '+' : '−'} {fmtMoney(e.amount)}
                        </span>
                        {perms.manage && (
                          <div className="flex shrink-0 flex-col gap-1">
                            <button type="button" aria-label="تعديل" onClick={() => setEntryForm({ open: true, item: e, kind: e.kind })} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button>
                            <button type="button" aria-label="حذف" onClick={() => setDeleteEntry(e)} className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* ================= CAUSES ================= */}
      {tab === 'causes' && (
        <>
          <p className="mb-3 flex items-start gap-2 rounded-2xl bg-violet-50 px-3 py-2.5 text-xs font-bold text-violet-800">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>الأسباب الثابتة تُنشأ مرة وتُختار من قائمة عند التسجيل. وعند الحاجة إلى سبب غير موجود يختار الخادم «أخرى» ويكتبه.</span>
          </p>
          {perms.manage && (
            <button id="finance-cause-new" type="button" onClick={() => setCauseForm({ open: true, item: null, scope: scope.church_id ? { church_id: scope.church_id, service_id: scope.service_id, class_id: scope.class_id } : null })}
              className="btn-primary mb-3 flex w-full items-center justify-center gap-1.5">
              <Plus className="h-4 w-4" /> سبب ثابت جديد
            </button>
          )}
          {visibleCauses.length === 0 ? (
            <div className="card py-10 text-center">
              <Tag className="mx-auto mb-2 h-10 w-10 text-slate-300" />
              <p className="font-bold text-slate-500">لا توجد أسباب ثابتة لهذا النطاق بعد</p>
              {!perms.manage && <p className="mt-1 flex items-center justify-center gap-1 text-xs font-bold text-slate-400"><Lock className="h-3 w-3" /> إنشاء الأسباب يحتاج صلاحية «إدارة الخزينة»</p>}
            </div>
          ) : (
            <ul id="finance-causes" className="space-y-1.5">
              {visibleCauses.map((c) => (
                <li key={c.id} id={`finance-cause-${c.id}`} className={`card flex items-center gap-3 !p-3 ${c.is_active ? '' : 'opacity-60'}`}>
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${c.kind === 'income' ? 'bg-emerald-100 text-emerald-700' : c.kind === 'expense' ? 'bg-rose-100 text-rose-700' : 'bg-primary-100 text-primary-700'}`}><Tag className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold text-slate-800">{c.name}{!c.is_active && <span className="mr-1 text-[10px] font-bold text-slate-400">(موقوف)</span>}</p>
                    <p className="truncate text-[11px] font-bold text-slate-400">{CAUSE_KIND_LABELS[c.kind]} · {scopeName(c)}</p>
                  </div>
                  {perms.manage && (
                    <div className="flex shrink-0 gap-1">
                      <button type="button" aria-label="تعديل" onClick={() => setCauseForm({ open: true, item: c })} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button>
                      <button type="button" aria-label="حذف" onClick={() => setDeleteCause(c)} className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* ---------- modals ---------- */}
      {entryForm.open && (
        <EntryFormModal item={entryForm.item} defaultKind={entryForm.kind} causes={causes} lookups={lookups} today={today}
          onSaved={onEntrySaved} onClose={() => setEntryForm({ open: false, item: null, kind: 'expense' })}
          onNewCause={perms.manage ? (sc, k) => setCauseForm({ open: true, item: null, scope: sc, kind: k }) : undefined} />
      )}
      {causeForm.open && (
        <CauseFormModal item={causeForm.item} lookups={lookups} initialScope={causeForm.scope} initialKind={causeForm.kind} onSaved={onCauseSaved} onClose={() => setCauseForm({ open: false, item: null })} />
      )}
      {deleteEntry && (
        <ConfirmDelete title="حذف القيد" text={`حذف ${KIND_LABELS[deleteEntry.kind]} ${fmtMoney(deleteEntry.amount)} — «${deleteEntry.cause_text}»؟ سيتغير الرصيد.`} busy={busy} onConfirm={doDeleteEntry} onClose={() => setDeleteEntry(null)} />
      )}
      {deleteCause && (
        <ConfirmDelete title="حذف السبب" text={`حذف «${deleteCause.name}»؟ القيود المسجلة به تبقى كما هي باسم السبب.`} busy={busy} onConfirm={doDeleteCause} onClose={() => setDeleteCause(null)} />
      )}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
          <p className="rounded-2xl bg-slate-900 px-4 py-2 text-xs font-extrabold text-white shadow-lg">{toast}</p>
        </div>
      )}
    </>
  );
}

// ---------- small bits ----------
function Select({ id, value, onChange, allLabel, options, disabled }: { id: string; value: string; onChange: (v: string) => void; allLabel: string; options: { id: string; name: string }[]; disabled?: boolean }) {
  return (
    <div className="relative">
      <select id={id} className={`input-field appearance-none !py-2 !pl-7 !pr-2 text-[11px] font-bold ${disabled ? 'bg-slate-50 opacity-70' : ''}`} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value={ALL}>{allLabel}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

function ConfirmDelete({ title, text, busy, onConfirm, onClose }: { title: string; text: string; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-sm sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-2 flex items-center gap-2 text-lg font-extrabold text-red-600"><Trash2 className="h-5 w-5" /> {title}</h3>
        <p className="mb-4 text-sm font-bold text-slate-600">{text}</p>
        <div className="grid grid-cols-2 gap-2">
          <button id="finance-delete-confirm" type="button" onClick={onConfirm} disabled={busy} className="flex items-center justify-center gap-1.5 rounded-xl bg-red-500 py-2.5 font-extrabold text-white shadow active:scale-95 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} حذف
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">إلغاء</button>
        </div>
      </div>
    </div>
  );
}

function groupByDay(rows: FinanceEntry[]): [string, FinanceEntry[]][] {
  const m = new Map<string, FinanceEntry[]>();
  rows.forEach((r) => { (m.get(r.entry_date) ?? m.set(r.entry_date, []).get(r.entry_date)!).push(r); });
  return Array.from(m.entries());
}
