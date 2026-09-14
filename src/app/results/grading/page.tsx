'use client';

// ---------- GRADING SYSTEMS (أنظمة التقدير) ----------
// Left: list of systems (global = church_id null, owner-only · per church).
// Right: editor — name, description, church, default flag, and the grade
// bands table (name · min% · max% · description · color · pass). Bands are
// validated live: 0..100, min ≤ max, no overlaps, gaps warning. Actions:
// new (with DEFAULT_GRADES), duplicate, delete, save. Percent tester shows
// which band a sample percentage lands in.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Loader2, Copy, Trash2, Save, Percent, AlertTriangle, ArrowUp, ArrowDown, Star, Globe, Church as ChurchIcon, Wand2 } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { ResultsHeader, Toast, ConfirmModal, Field, Toggle, GradePill, useResultLookups } from '@/components/results/ResultBits';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import {
  fetchGradingSystems, fetchGrades, fetchResultPermissions, saveGradingSystem, deleteGradingSystem, duplicateGradingSystem, saveGrades,
  DEFAULT_GRADES, GRADE_COLORS, normalizeNumber, fmtNum, isMigrationMissing, MIGRATION_HINT, resultErrorMessage, NO_PERMISSIONS,
  type GradingSystem, type GradingGrade, type GradeInput, type ResultPermissions,
} from '@/lib/results';

type Band = GradeInput & { id?: string; _key: string };
let seq = 0;
const mk = (g: GradeInput, id?: string): Band => ({ ...g, id, _key: `${Date.now()}-${seq++}` });

interface Draft {
  id: string | null;
  name: string;
  description: string;
  church_id: string | null;
  is_default: boolean;
  bands: Band[];
}

function validateBands(bands: Band[]): { errors: Map<string, string>; warnings: string[] } {
  const errors = new Map<string, string>();
  const warnings: string[] = [];
  bands.forEach((b) => {
    if (!b.name.trim()) errors.set(b._key, 'الاسم مطلوب');
    else if (!Number.isFinite(b.min_percent) || !Number.isFinite(b.max_percent)) errors.set(b._key, 'نسبة غير صالحة');
    else if (b.min_percent < 0 || b.max_percent > 100) errors.set(b._key, 'النسبة بين 0 و 100');
    else if (b.min_percent > b.max_percent) errors.set(b._key, 'الحد الأدنى أكبر من الأقصى');
  });
  const names = new Map<string, number>();
  bands.forEach((b) => names.set(b.name.trim(), (names.get(b.name.trim()) ?? 0) + 1));
  bands.forEach((b) => { if ((names.get(b.name.trim()) ?? 0) > 1 && !errors.has(b._key)) errors.set(b._key, 'اسم مكرر'); });
  const sorted = [...bands].filter((b) => !errors.has(b._key)).sort((a, b) => a.min_percent - b.min_percent);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1], cur = sorted[i];
    if (cur.min_percent <= prev.max_percent) errors.set(cur._key, `يتداخل مع «${prev.name}»`);
    else if (cur.min_percent - prev.max_percent > 0.011) warnings.push(`فجوة بين ${fmtNum(prev.max_percent)}٪ و ${fmtNum(cur.min_percent)}٪ — النسب داخلها بلا تقدير`);
  }
  if (sorted.length && sorted[0].min_percent > 0) warnings.push(`النسب أقل من ${fmtNum(sorted[0].min_percent)}٪ بلا تقدير`);
  if (sorted.length && sorted[sorted.length - 1].max_percent < 100) warnings.push(`النسب أعلى من ${fmtNum(sorted[sorted.length - 1].max_percent)}٪ بلا تقدير`);
  return { errors, warnings };
}

export default function GradingPage() {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const isOwner = profile?.role === 'owner';
  const { churches } = useResultLookups(supabase, approved);

  const [systems, setSystems] = useState<GradingSystem[]>([]);
  const [grades, setGrades] = useState<GradingGrade[]>([]);
  const [perms, setPerms] = useState<ResultPermissions>(NO_PERMISSIONS);
  const [usage, setUsage] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState<GradingSystem | null>(null);
  const [tester, setTester] = useState('85');
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };

  const load = useCallback(async () => {
    try {
      const [gs, p] = await Promise.all([fetchGradingSystems(supabase), fetchResultPermissions(supabase)]);
      setSystems(gs); setPerms(p);
      setGrades(await fetchGrades(supabase, gs.map((g) => g.id)));
      const { data } = await supabase.from('result_exams').select('grading_system_id').not('grading_system_id', 'is', null).limit(5000);
      const u = new Map<string, number>();
      ((data ?? []) as { grading_system_id: string }[]).forEach((r) => u.set(r.grading_system_id, (u.get(r.grading_system_id) ?? 0) + 1));
      setUsage(u);
      setMigrationMissing(false);
    } catch (err) { if (isMigrationMissing(err)) setMigrationMissing(true); else flash(resultErrorMessage(err)); }
    finally { setLoading(false); }
  }, [supabase]);
  useEffect(() => { if (approved) load(); }, [approved, load]);
  useDebouncedRealtime(supabase, 'results-grading', [{ table: 'grading_systems' }, { table: 'grading_grades' }], load, { enabled: approved, delayMs: 800 });

  // open a system into the draft
  const open = (s: GradingSystem) => {
    setSelected(s.id);
    setDraft({
      id: s.id, name: s.name, description: s.description ?? '', church_id: s.church_id, is_default: s.is_default,
      bands: grades.filter((g) => g.grading_system_id === s.id).sort((a, b) => a.sort_order - b.sort_order).map((g) => mk(g, g.id)),
    });
  };
  useEffect(() => {
    // keep the draft's bands in sync when not editing (first load)
    if (!draft && systems.length && !selected) open(systems.find((s) => s.is_default) ?? systems[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systems, grades]);

  const startNew = () => {
    setSelected(null);
    setDraft({ id: null, name: '', description: '', church_id: isOwner ? null : (churches[0]?.id ?? profile?.church_id ?? null), is_default: false, bands: DEFAULT_GRADES.map((g) => mk(g)) });
  };

  const canManage = perms.manage_grading;
  const canEditDraft = canManage && !!draft && (draft.church_id !== null || isOwner);
  const { errors, warnings } = useMemo(() => (draft ? validateBands(draft.bands) : { errors: new Map<string, string>(), warnings: [] as string[] }), [draft]);
  const dirty = useMemo(() => {
    if (!draft) return false;
    if (!draft.id) return true;
    const s = systems.find((x) => x.id === draft.id);
    if (!s) return false;
    const orig = grades.filter((g) => g.grading_system_id === s.id).sort((a, b) => a.sort_order - b.sort_order);
    if (s.name !== draft.name.trim() || (s.description ?? '') !== draft.description.trim() || s.church_id !== draft.church_id || s.is_default !== draft.is_default) return true;
    if (orig.length !== draft.bands.length) return true;
    return draft.bands.some((b, i) => {
      const o = orig[i];
      return !o || o.id !== b.id || o.name !== b.name || o.min_percent !== b.min_percent || o.max_percent !== b.max_percent || (o.description ?? '') !== (b.description ?? '') || (o.color ?? '') !== (b.color ?? '') || o.is_pass !== b.is_pass;
    });
  }, [draft, systems, grades]);

  // ---- band edits ----
  const patchBand = (k: string, patch: Partial<Band>) => setDraft((d) => d && ({ ...d, bands: d.bands.map((b) => (b._key === k ? { ...b, ...patch } : b)) }));
  const numOf = (raw: string) => { const n = Number(normalizeNumber(raw)); return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN; };
  const moveBand = (k: string, dir: -1 | 1) => setDraft((d) => {
    if (!d) return d;
    const i = d.bands.findIndex((b) => b._key === k); const j = i + dir;
    if (i < 0 || j < 0 || j >= d.bands.length) return d;
    const arr = [...d.bands]; [arr[i], arr[j]] = [arr[j], arr[i]];
    return { ...d, bands: arr };
  });
  const addBand = () => setDraft((d) => {
    if (!d) return d;
    const last = [...d.bands].sort((a, b) => a.min_percent - b.min_percent)[0];
    const max = last ? Math.max(0, Math.round((last.min_percent - 0.01) * 100) / 100) : 100;
    const min = Math.max(0, Math.round((max - 9.99) * 100) / 100);
    return { ...d, bands: [...d.bands, mk({ name: `Grade ${d.bands.length + 1}`, min_percent: min, max_percent: max, description: '', color: GRADE_COLORS[d.bands.length % GRADE_COLORS.length], is_pass: min >= 50, sort_order: d.bands.length + 1 })] };
  });
  const removeBand = (k: string) => setDraft((d) => d && ({ ...d, bands: d.bands.filter((b) => b._key !== k) }));
  const sortBands = () => setDraft((d) => d && ({ ...d, bands: [...d.bands].sort((a, b) => b.min_percent - a.min_percent) }));
  const resetDefaults = () => setDraft((d) => d && ({ ...d, bands: DEFAULT_GRADES.map((g) => mk(g)) }));

  // ---- save / duplicate / delete ----
  const save = async () => {
    if (!draft || !canEditDraft) return;
    if (!draft.name.trim()) { flash('اسم النظام مطلوب'); return; }
    if (!draft.bands.length) { flash('أضف تقديراً واحداً على الأقل'); return; }
    if (errors.size) { flash('صحّح أخطاء التقديرات أولاً'); return; }
    setSaving(true);
    try {
      const sys = await saveGradingSystem(supabase, draft.id, { name: draft.name.trim(), description: draft.description.trim() || null, church_id: draft.church_id, is_default: draft.is_default });
      const sortedBands = [...draft.bands].sort((a, b) => b.min_percent - a.min_percent);
      await saveGrades(supabase, sys.id, sortedBands.map((b, i) => ({ id: b.id, name: b.name.trim(), min_percent: b.min_percent, max_percent: b.max_percent, description: b.description?.trim() || null, color: b.color || null, is_pass: b.is_pass, sort_order: i + 1 })));
      flash('تم الحفظ');
      await load();
      const fresh = await fetchGradingSystems(supabase);
      const s = fresh.find((x) => x.id === sys.id);
      const gr = await fetchGrades(supabase, [sys.id]);
      if (s) { setSelected(s.id); setDraft({ id: s.id, name: s.name, description: s.description ?? '', church_id: s.church_id, is_default: s.is_default, bands: gr.sort((a, b) => a.sort_order - b.sort_order).map((g) => mk(g, g.id)) }); }
    } catch (err) { flash(resultErrorMessage(err, 'تعذر الحفظ')); }
    finally { setSaving(false); }
  };
  const duplicate = async (s: GradingSystem) => {
    try { const id = await duplicateGradingSystem(supabase, s.id, `${s.name} (نسخة)`); flash('تم إنشاء نسخة'); await load(); const gs = await fetchGradingSystems(supabase); const n = gs.find((x) => x.id === id); const gr = await fetchGrades(supabase, [id]); if (n) { setSelected(id); setDraft({ id, name: n.name, description: n.description ?? '', church_id: n.church_id, is_default: n.is_default, bands: gr.map((g) => mk(g, g.id)) }); } }
    catch (err) { flash(resultErrorMessage(err, 'تعذر النسخ')); }
  };
  const remove = async () => {
    if (!confirmDel) return;
    setSaving(true);
    try { await deleteGradingSystem(supabase, confirmDel.id); flash('تم الحذف'); setConfirmDel(null); setSelected(null); setDraft(null); await load(); }
    catch (err) { flash(resultErrorMessage(err, 'تعذر الحذف — قد يكون مستخدماً في امتحانات')); }
    finally { setSaving(false); }
  };

  const testerPct = numOf(tester);
  const testerBand = draft && Number.isFinite(testerPct) ? [...draft.bands].filter((b) => !errors.has(b._key) && testerPct >= b.min_percent && testerPct <= b.max_percent).sort((a, b) => b.min_percent - a.min_percent)[0] : undefined;
  const churchName = (id: string | null) => (id === null ? 'عام (كل الكنائس)' : churches.find((c) => c.id === id)?.name ?? '—');

  if (migrationMissing) return <AppShell><ResultsHeader /><div className="card flex items-start gap-3 border-amber-200 bg-amber-50 text-amber-900"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><p className="text-sm font-bold">{MIGRATION_HINT}</p></div></AppShell>;

  return (
    <AppShell>
      <ResultsHeader title="أنظمة التقدير" actions={canManage ? <button type="button" id="grd-new" className="btn-primary !py-1.5 text-xs" onClick={startNew}><Plus className="h-4 w-4" /> نظام جديد</button> : undefined} />
      <Toast msg={toast} />
      {loading ? <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div> : (
        <div className="grid gap-3 lg:grid-cols-[300px_1fr]">
          {/* list */}
          <section className="card !p-2">
            {systems.length === 0 && <p className="py-8 text-center text-sm text-slate-500">لا توجد أنظمة تقدير بعد</p>}
            <ul className="space-y-1" id="grd-list">
              {systems.map((s) => {
                const bands = grades.filter((g) => g.grading_system_id === s.id).sort((a, b) => a.sort_order - b.sort_order);
                return (
                  <li key={s.id}>
                    <button type="button" onClick={() => open(s)} className={`w-full rounded-xl px-3 py-2 text-start transition ${selected === s.id ? 'bg-emerald-50 ring-1 ring-emerald-300' : 'hover:bg-slate-50'}`}>
                      <div className="flex items-center gap-1.5">
                        {s.church_id === null ? <Globe className="h-3.5 w-3.5 text-sky-500" /> : <ChurchIcon className="h-3.5 w-3.5 text-slate-400" />}
                        <span className="min-w-0 flex-1 truncate text-sm font-bold">{s.name}</span>
                        {s.is_default && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-label="افتراضي" />}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {bands.slice(0, 6).map((b) => <GradePill key={b.id} name={b.name} color={b.color} />)}
                        {bands.length > 6 && <span className="text-[10px] text-slate-400">+{bands.length - 6}</span>}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-400">{churchName(s.church_id)} · {usage.get(s.id) ?? 0} امتحان</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* editor */}
          <section className="space-y-3">
            {!draft ? <div className="card py-12 text-center text-sm text-slate-500">اختر نظاماً من القائمة أو أنشئ نظاماً جديداً</div> : (
              <>
                <div className="card space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="اسم النظام">
                      <input id="grd-name" className="input-field" value={draft.name} disabled={!canEditDraft} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="مثال: نظام التقدير العام" />
                    </Field>
                    <Field label="النطاق" hint={isOwner ? 'النظام العام متاح لكل الكنائس' : 'يمكنك إدارة أنظمة كنيستك فقط'}>
                      <select id="grd-church" className="input-field appearance-none" value={draft.church_id ?? ''} disabled={!canEditDraft || !!draft.id} onChange={(e) => setDraft({ ...draft, church_id: e.target.value || null })}>
                        {isOwner && <option value="">عام (كل الكنائس)</option>}
                        {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Field label="الوصف">
                    <input id="grd-desc" className="input-field" value={draft.description} disabled={!canEditDraft} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="اختياري" />
                  </Field>
                  <Toggle id="grd-default" checked={draft.is_default} disabled={!canEditDraft} onChange={(v) => setDraft({ ...draft, is_default: v })} label="النظام الافتراضي" desc="يُختار تلقائياً عند إنشاء امتحان جديد في نطاقه" />
                </div>

                <div className="card !p-0 overflow-hidden">
                  <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
                    <h3 className="flex items-center gap-1.5 text-sm font-extrabold"><Percent className="h-4 w-4 text-emerald-600" /> التقديرات <span className="text-xs font-bold text-slate-400">({draft.bands.length})</span></h3>
                    <div className="mr-auto flex gap-1">
                      {canEditDraft && <>
                        <button type="button" className="btn-secondary !py-1 text-xs" onClick={sortBands} title="ترتيب من الأعلى للأقل">ترتيب</button>
                        <button type="button" className="btn-secondary !py-1 text-xs" onClick={resetDefaults}><Wand2 className="h-3.5 w-3.5" /> الافتراضي</button>
                        <button type="button" id="grd-add-band" className="btn-primary !py-1 text-xs" onClick={addBand}><Plus className="h-3.5 w-3.5" /> تقدير</button>
                      </>}
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[620px] text-sm" id="grd-bands">
                      <thead className="bg-slate-50 text-xs text-slate-500">
                        <tr>
                          <th className="px-2 py-2 text-right font-bold">التقدير</th>
                          <th className="px-2 py-2 text-center font-bold">من ٪</th>
                          <th className="px-2 py-2 text-center font-bold">إلى ٪</th>
                          <th className="px-2 py-2 text-right font-bold">الوصف</th>
                          <th className="px-2 py-2 text-center font-bold">اللون</th>
                          <th className="px-2 py-2 text-center font-bold">ناجح</th>
                          {canEditDraft && <th className="px-2 py-2" />}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {draft.bands.map((b, i) => {
                          const err = errors.get(b._key);
                          return (
                            <tr key={b._key} className={err ? 'bg-red-50/50' : ''}>
                              <td className="px-2 py-1.5">
                                <div className="flex items-center gap-2">
                                  <GradePill name={b.name || '—'} color={b.color} />
                                  <input aria-label="اسم التقدير" className="input-field !py-1 text-sm" value={b.name} disabled={!canEditDraft} onChange={(e) => patchBand(b._key, { name: e.target.value })} />
                                </div>
                                {err && <div className="mt-0.5 text-[11px] font-bold text-red-600">{err}</div>}
                              </td>
                              <td className="px-2 py-1.5 text-center"><input aria-label="الحد الأدنى" inputMode="decimal" className="input-field w-20 !py-1 text-center text-sm tabular-nums" value={Number.isFinite(b.min_percent) ? b.min_percent : ''} disabled={!canEditDraft} onChange={(e) => patchBand(b._key, { min_percent: numOf(e.target.value) })} /></td>
                              <td className="px-2 py-1.5 text-center"><input aria-label="الحد الأقصى" inputMode="decimal" className="input-field w-20 !py-1 text-center text-sm tabular-nums" value={Number.isFinite(b.max_percent) ? b.max_percent : ''} disabled={!canEditDraft} onChange={(e) => patchBand(b._key, { max_percent: numOf(e.target.value) })} /></td>
                              <td className="px-2 py-1.5"><input aria-label="الوصف" className="input-field !py-1 text-sm" value={b.description ?? ''} disabled={!canEditDraft} onChange={(e) => patchBand(b._key, { description: e.target.value })} placeholder="ممتاز / جيد…" /></td>
                              <td className="px-2 py-1.5">
                                <div className="flex items-center justify-center gap-1">
                                  <input type="color" aria-label="اللون" className="h-7 w-9 cursor-pointer rounded border border-slate-200 bg-white p-0.5" value={b.color ?? '#64748b'} disabled={!canEditDraft} onChange={(e) => patchBand(b._key, { color: e.target.value })} />
                                  {canEditDraft && <div className="hidden gap-0.5 md:flex">{GRADE_COLORS.slice(0, 5).map((c) => <button key={c} type="button" aria-label={`لون ${c}`} className="h-4 w-4 rounded-full ring-1 ring-white" style={{ background: c }} onClick={() => patchBand(b._key, { color: c })} />)}</div>}
                                </div>
                              </td>
                              <td className="px-2 py-1.5 text-center"><input type="checkbox" aria-label="ناجح" className="h-4 w-4 accent-emerald-600" checked={b.is_pass} disabled={!canEditDraft} onChange={(e) => patchBand(b._key, { is_pass: e.target.checked })} /></td>
                              {canEditDraft && (
                                <td className="px-1 py-1.5">
                                  <div className="flex items-center justify-end gap-0.5">
                                    <button type="button" aria-label="أعلى" className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30" disabled={i === 0} onClick={() => moveBand(b._key, -1)}><ArrowUp className="h-3.5 w-3.5" /></button>
                                    <button type="button" aria-label="أسفل" className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30" disabled={i === draft.bands.length - 1} onClick={() => moveBand(b._key, 1)}><ArrowDown className="h-3.5 w-3.5" /></button>
                                    <button type="button" aria-label="حذف" className="rounded p-1 text-red-400 hover:bg-red-50" onClick={() => removeBand(b._key)}><Trash2 className="h-3.5 w-3.5" /></button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                        {draft.bands.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-sm text-slate-500">لا توجد تقديرات — أضف تقديراً أو استخدم الافتراضي</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  {warnings.length > 0 && (
                    <ul className="space-y-0.5 border-t border-amber-100 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800">
                      {warnings.map((w) => <li key={w} className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{w}</li>)}
                    </ul>
                  )}
                  <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-3 py-2 text-xs">
                    <span className="font-bold text-slate-500">اختبار نسبة:</span>
                    <input id="grd-tester" inputMode="decimal" className="input-field w-20 !py-1 text-center text-sm tabular-nums" value={tester} onChange={(e) => setTester(e.target.value)} />
                    <span>٪ ←</span>
                    {testerBand ? <GradePill name={testerBand.name} color={testerBand.color} size="lg" /> : <span className="font-bold text-slate-400">بلا تقدير</span>}
                    {testerBand && <span className={`font-bold ${testerBand.is_pass ? 'text-emerald-700' : 'text-red-600'}`}>{testerBand.is_pass ? 'ناجح' : 'راسب'}</span>}
                  </div>
                </div>

                {canManage && (
                  <div className="flex flex-wrap items-center gap-2">
                    {draft.id && canEditDraft && (
                      <button type="button" id="grd-delete" className="btn-secondary !py-2 text-xs !text-red-600" onClick={() => setConfirmDel(systems.find((s) => s.id === draft.id) ?? null)}><Trash2 className="h-4 w-4" /> حذف</button>
                    )}
                    {draft.id && <button type="button" id="grd-dup" className="btn-secondary !py-2 text-xs" onClick={() => { const s = systems.find((x) => x.id === draft.id); if (s) duplicate(s); }}><Copy className="h-4 w-4" /> نسخ</button>}
                    <div className="mr-auto flex items-center gap-2">
                      {!canEditDraft && <span className="text-xs font-bold text-slate-400">النظام العام يديره المالك فقط</span>}
                      {dirty && canEditDraft && <span className="text-xs font-bold text-amber-600">تغييرات غير محفوظة</span>}
                      <button type="button" id="grd-save" className="btn-primary !py-2 text-sm" disabled={!canEditDraft || saving || !dirty || errors.size > 0} onClick={save}>
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} حفظ
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
      {confirmDel && (
        <ConfirmModal title={`حذف «${confirmDel.name}»؟`} busy={saving}
          desc={usage.get(confirmDel.id) ? `هذا النظام مستخدم في ${usage.get(confirmDel.id)} امتحان — لن يمكن حذفه قبل تغيير نظام التقدير في تلك الامتحانات.` : 'سيتم حذف النظام وكل تقديراته. لا يمكن التراجع.'}
          confirmLabel="حذف" onConfirm={remove} onClose={() => setConfirmDel(null)} />
      )}
    </AppShell>
  );
}
