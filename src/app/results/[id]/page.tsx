'use client';

// ---------- RESULTS EXAM PAGE (صفحة الامتحان) ----------
// Header (status · lock · publish) + tabs:
//   اللوحة    — KPIs + grade distribution chart
//   المواد    — list (↑↓ · edit · duplicate · delete) + add
//   النتائج   — every student: totals · % · grade · status · rank → result card
//   الترتيب   — ranking by percent / total with ties
//   الإعدادات — summary · edit · copy from exam · clear · duplicate · delete · audit

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  Loader2, Plus, Pencil, Trash2, ChevronUp, ChevronDown, Copy, Lock, Unlock, Eye, EyeOff, Settings2, Users, BookOpen, Trophy,
  LayoutDashboard, Keyboard, FileUp, FileDown, Search, Eraser, ClipboardCopy, AlertTriangle,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import {
  ResultsHeader, StatusBadge, StudentStatusBadge, GradePill, PctBar, Toast, ConfirmModal, BarChart, Kpi, Avatar, useResultLookups, ModalFrame, ExamPicker,
} from '@/components/results/ResultBits';
import ExamFormModal from '@/components/results/ExamFormModal';
import SubjectFormModal from '@/components/results/SubjectFormModal';
import StudentResultModal from '@/components/results/StudentResultModal';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import {
  fetchResultExam, fetchSubjects, fetchSummary, fetchGradingSystems, fetchGrades, fetchResultPermissions, fetchResultExams,
  updateResultExam, deleteResultExam, duplicateResultExam, setExamLock, createSubject, deleteSubject, reorderSubjects, copyFromExam, clearResults,
  computeStats, examScopeLabel, resultErrorMessage, fmtNum, fmtPct, fmtDate, fmtDateTime, rankLabel, safeFile,
  EXAM_STATUS_LABELS, PASS_RULE_LABELS, STUDENT_STATUS_LABELS, NO_PERMISSIONS,
  type ResultExam, type ResultSubject, type StudentSummary, type GradingSystem, type GradingGrade, type ResultPermissions, type StudentStatus, type ResultExamStatus,
} from '@/lib/results';

type Tab = 'dashboard' | 'subjects' | 'results' | 'ranking' | 'settings';
const TABS: { key: Tab; label: string; icon: typeof Users }[] = [
  { key: 'dashboard', label: 'اللوحة', icon: LayoutDashboard },
  { key: 'subjects', label: 'المواد', icon: BookOpen },
  { key: 'results', label: 'النتائج', icon: Users },
  { key: 'ranking', label: 'الترتيب', icon: Trophy },
  { key: 'settings', label: 'الإعدادات', icon: Settings2 },
];

export default function ResultExamPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';
  const { churches, services, classes } = useResultLookups(supabase, approved);

  const [exam, setExam] = useState<ResultExam | null>(null);
  const [subjects, setSubjects] = useState<ResultSubject[]>([]);
  const [summary, setSummary] = useState<StudentSummary[]>([]);
  const [systems, setSystems] = useState<GradingSystem[]>([]);
  const [grades, setGrades] = useState<GradingGrade[]>([]);
  const [perms, setPerms] = useState<ResultPermissions>(NO_PERMISSIONS);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<Tab>((search.get('tab') as Tab) || 'dashboard');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | StudentStatus>('all');
  const [rankBy, setRankBy] = useState<'percent' | 'score'>('percent');
  const [sForm, setSForm] = useState<{ open: boolean; s: ResultSubject | null }>({ open: false, s: null });
  const [xForm, setXForm] = useState(false);
  const [student, setStudent] = useState<StudentSummary | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'delete-exam' | 'delete-subject' | 'clear' | 'clear-subject' | 'lock' | 'unlock'; s?: ResultSubject } | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000); };

  const load = useCallback(async () => {
    try {
      const [x, subs, p, gs] = await Promise.all([fetchResultExam(supabase, id), fetchSubjects(supabase, id), fetchResultPermissions(supabase), fetchGradingSystems(supabase)]);
      if (!x) { setNotFound(true); return; }
      setExam(x); setSubjects(subs); setPerms(p); setSystems(gs);
      const [sum, gr] = await Promise.all([fetchSummary(supabase, id), fetchGrades(supabase, gs.map((g) => g.id))]);
      setSummary(sum); setGrades(gr);
    } catch (e) { flash(resultErrorMessage(e, 'تعذر التحميل')); }
    finally { setLoading(false); }
  }, [supabase, id]);
  useEffect(() => { if (approved) load(); }, [approved, load]);
  useDebouncedRealtime(supabase, `results-exam-${id}`, [
    { table: 'result_exams', filter: `id=eq.${id}` }, { table: 'result_subjects', filter: `exam_id=eq.${id}` }, { table: 'exam_results', filter: `exam_id=eq.${id}` }, { table: 'grading_grades' },
  ], load, { enabled: approved, delayMs: 800 });

  const canWrite = perms.enter || perms.edit;
  const stats = useMemo(() => computeStats(summary, grades, exam?.grading_system_id ?? null), [summary, grades, exam]);
  const system = systems.find((g) => g.id === exam?.grading_system_id);
  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return summary.filter((r) => (statusFilter === 'all' || r.status === statusFilter) && (!s || r.name.toLowerCase().includes(s) || r.national_id.includes(s)));
  }, [summary, q, statusFilter]);
  const ranked = useMemo(() => summary.filter((r) => r.rank !== null).sort((a, b) => (rankBy === 'percent' ? (a.rank ?? 0) - (b.rank ?? 0) : (a.rank_score ?? 0) - (b.rank_score ?? 0)) || a.name.localeCompare(b.name, 'ar')), [summary, rankBy]);

  // ---- actions ----
  const patchExam = async (patch: Parameters<typeof updateResultExam>[2], ok: string) => {
    if (!exam) return;
    setBusy(true);
    try { setExam(await updateResultExam(supabase, exam.id, patch)); flash(ok); }
    catch (e) { flash(resultErrorMessage(e)); }
    finally { setBusy(false); }
  };
  const toggleLock = async (locked: boolean) => {
    if (!exam) return;
    setBusy(true);
    try { setExam(await setExamLock(supabase, exam.id, locked)); flash(locked ? 'تم قفل النتائج' : 'تم فتح النتائج'); setConfirm(null); }
    catch (e) { flash(resultErrorMessage(e)); }
    finally { setBusy(false); }
  };
  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= subjects.length) return;
    const next = [...subjects]; [next[i], next[j]] = [next[j], next[i]];
    setSubjects(next);
    try { await reorderSubjects(supabase, next.map((s) => s.id)); } catch (e) { flash(resultErrorMessage(e)); load(); }
  };
  const dupSubject = async (s: ResultSubject) => {
    try {
      const saved = await createSubject(supabase, id, { name: `${s.name} (نسخة)`, code: null, full_degree: s.full_degree, pass_degree: s.pass_degree, weight: s.weight, is_bonus: s.is_bonus }, subjects.length + 1);
      setSubjects((l) => [...l, saved]); flash('تم نسخ المادة');
    } catch (e) { flash(resultErrorMessage(e)); }
  };
  const doConfirm = async () => {
    if (!confirm || !exam) return;
    setBusy(true);
    try {
      if (confirm.kind === 'delete-exam') { await deleteResultExam(supabase, exam.id); router.push('/results'); return; }
      if (confirm.kind === 'delete-subject' && confirm.s) { await deleteSubject(supabase, confirm.s.id); setSubjects((l) => l.filter((x) => x.id !== confirm.s!.id)); flash('تم حذف المادة'); }
      if (confirm.kind === 'clear') { const n = await clearResults(supabase, exam.id); flash(`تم مسح ${n} نتيجة`); }
      if (confirm.kind === 'clear-subject' && confirm.s) { const n = await clearResults(supabase, exam.id, confirm.s.id); flash(`تم مسح ${n} نتيجة`); }
      if (confirm.kind === 'lock') { await toggleLock(true); return; }
      if (confirm.kind === 'unlock') { await toggleLock(false); return; }
      setConfirm(null); load();
    } catch (e) { flash(resultErrorMessage(e)); }
    finally { setBusy(false); }
  };
  const duplicate = async () => {
    if (!exam) return;
    const name = prompt('اسم الامتحان الجديد', `${exam.name} (نسخة)`); if (name === null) return;
    try { const nid = await duplicateResultExam(supabase, exam.id, name); router.push(`/results/${nid}`); } catch (e) { flash(resultErrorMessage(e)); }
  };

  const exportExcel = async () => {
    if (!exam) return;
    const XLSX = await import('xlsx');
    const { fetchResultRows } = await import('@/lib/results');
    const rows = await fetchResultRows(supabase, exam.id);
    const byKey = new Map(rows.map((r) => [`${r.enrollment_id}|${r.subject_id}`, r]));
    const sheet = summary.map((st) => {
      const o: Record<string, string | number | null> = { 'الكود': st.national_id, 'الاسم': st.name, 'الفصل': classes.find((c) => c.id === st.class_id)?.name ?? '' };
      subjects.forEach((s) => {
        const r = byKey.get(`${st.enrollment_id}|${s.id}`);
        o[`${s.name} (${fmtNum(s.full_degree)})`] = r ? (r.status === 'absent' || r.status === 'excused' ? 'غائب' : r.score) : null;
        if (exam.grade_subject) o[`تقدير ${s.name}`] = grades.find((g) => g.id === r?.grade_id)?.name ?? null;
      });
      o['المجموع'] = st.total_score; o['من'] = st.total_full; o['النسبة'] = st.percent; o['التقدير'] = st.grade_name; o['الترتيب'] = st.rank;
      o['النتيجة'] = STUDENT_STATUS_LABELS[st.status];
      return o;
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet.length ? sheet : [{ '': 'لا توجد بيانات' }]), 'النتائج');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(subjects.map((s) => ({ 'المادة': s.name, 'الكود': s.code, 'الدرجة الكاملة': s.full_degree, 'درجة النجاح': s.pass_degree, 'الوزن': s.weight, 'إضافي': s.is_bonus ? 'نعم' : '' }))), 'المواد');
    XLSX.writeFile(wb, `نتائج_${safeFile(exam.name)}.xlsx`);
  };

  if (loading) return <AppShell><ResultsHeader back="/results" tabs={false} /><div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-emerald-500" /></div></AppShell>;
  if (notFound || !exam) return <AppShell><ResultsHeader back="/results" tabs={false} /><div className="card py-12 text-center font-bold text-slate-400">الامتحان غير موجود أو خارج نطاقك</div></AppShell>;

  return (
    <AppShell>
      <ResultsHeader title={exam.name} back="/results" tabs={false} badge={<StatusBadge status={exam.status} locked={exam.locked} />} />

      {/* quick actions */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {canWrite && !exam.locked && exam.status !== 'archived' && (
          <Link id="rx-go-bulk" href={`/results/bulk?exam=${exam.id}`} className="btn-primary flex items-center gap-1.5 !py-2 !px-3 text-sm !from-emerald-600 !to-emerald-500"><Keyboard className="h-4 w-4" /> إدخال جماعي</Link>
        )}
        {perms.import && !exam.locked && <Link href={`/results/import?exam=${exam.id}`} className="btn-secondary flex items-center gap-1.5 !py-2 !px-3 text-sm !border-emerald-200 !text-emerald-700"><FileUp className="h-4 w-4" /> استيراد Excel</Link>}
        {perms.export && <button type="button" onClick={exportExcel} className="btn-secondary flex items-center gap-1.5 !py-2 !px-3 text-sm !border-slate-200 !text-slate-700"><FileDown className="h-4 w-4" /> تصدير Excel</button>}
        {perms.lock && (exam.locked
          ? <button id="rx-unlock" type="button" onClick={() => setConfirm({ kind: 'unlock' })} className="btn-secondary flex items-center gap-1.5 !py-2 !px-3 text-sm !border-slate-300 !text-slate-800"><Unlock className="h-4 w-4" /> فتح القفل</button>
          : <button id="rx-lock" type="button" onClick={() => setConfirm({ kind: 'lock' })} className="btn-secondary flex items-center gap-1.5 !py-2 !px-3 text-sm !border-slate-300 !text-slate-800"><Lock className="h-4 w-4" /> قفل النتائج</button>)}
        {perms.manage_exams && (exam.published_at
          ? <button type="button" disabled={busy} onClick={() => patchExam({ published_at: null }, 'أُخفيت النتائج عن المخدومين')} className="btn-secondary flex items-center gap-1.5 !py-2 !px-3 text-sm !border-violet-200 !text-violet-700"><EyeOff className="h-4 w-4" /> إخفاء عن المخدومين</button>
          : <button type="button" disabled={busy} onClick={() => patchExam({ published_at: new Date().toISOString() }, 'نُشرت النتائج للمخدومين في بوابتهم')} className="btn-secondary flex items-center gap-1.5 !py-2 !px-3 text-sm !border-violet-200 !text-violet-700"><Eye className="h-4 w-4" /> نشر للمخدومين</button>)}
      </div>

      <nav className="mb-3 grid grid-cols-5 gap-1">
        {TABS.map((t) => { const I = t.icon; return (
          <button key={t.key} id={`rx-tab-${t.key}`} type="button" onClick={() => setTab(t.key)} aria-pressed={tab === t.key}
            className={`flex h-11 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-extrabold ${tab === t.key ? 'bg-emerald-600 text-white shadow' : 'bg-white text-slate-600 border border-slate-200'}`}>
            <I className="h-4 w-4" /> {t.label}
          </button>
        ); })}
      </nav>

      {subjects.length === 0 && tab !== 'subjects' && (
        <div className="mb-3 flex items-center gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
          <AlertTriangle className="h-4 w-4 shrink-0" /> لا توجد مواد بعد — أضف المواد أولاً {perms.manage_subjects && <button type="button" onClick={() => setTab('subjects')} className="underline">من هنا</button>}
        </div>
      )}

      {/* ---------- DASHBOARD ---------- */}
      {tab === 'dashboard' && (
        <section className="space-y-3">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            <Kpi label="المخدومين" value={stats.students} tone="text-slate-800" />
            <Kpi label="نتائج مكتملة" value={stats.completed} tone="text-sky-600" sub={stats.notEntered ? `${stats.notEntered} لم تُدخل` : undefined} />
            <Kpi label="ناجح" value={stats.passed} tone="text-emerald-600" />
            <Kpi label="لم ينجح" value={stats.failed} tone="text-red-600" />
            <Kpi label="نسبة النجاح" value={fmtPct(stats.passRate)} tone="text-emerald-700" />
            <Kpi label="المتوسط" value={fmtPct(stats.average)} tone="text-violet-600" />
            <Kpi label="الأعلى" value={fmtPct(stats.highest?.percent)} tone="text-amber-600" sub={stats.highest?.name} />
            <Kpi label="الأدنى" value={fmtPct(stats.lowest?.percent)} tone="text-slate-600" sub={stats.lowest?.name} />
          </div>
          <div className="card">
            <p className="mb-2 text-sm font-extrabold text-slate-700">توزيع التقديرات {system && <span className="text-xs font-bold text-slate-400">· {system.name}</span>}</p>
            {exam.grading_system_id ? <BarChart id="rx-grade-dist" items={stats.gradeDist} /> : <p className="text-xs font-bold text-slate-400">لم يُحدد نظام تقدير لهذا الامتحان</p>}
          </div>
          <div className="card">
            <p className="mb-2 text-sm font-extrabold text-slate-700">حالة الإدخال</p>
            <BarChart items={[
              { name: 'ناجح', count: stats.passed, color: '#059669' }, { name: 'لم ينجح', count: stats.failed, color: '#dc2626' },
              { name: 'غير مكتمل', count: stats.incomplete, color: '#d97706' }, { name: 'غائب', count: stats.absent, color: '#64748b' }, { name: 'لم تُدخل', count: stats.notEntered, color: '#cbd5e1' },
            ]} />
          </div>
          <div className="card grid grid-cols-2 gap-2 text-xs font-bold text-slate-600">
            <p>التاريخ: <span className="text-slate-800">{fmtDate(exam.exam_date)}</span></p>
            <p>العام: <span className="text-slate-800">{exam.academic_year ?? '—'}</span></p>
            <p className="col-span-2">النطاق: <span className="text-slate-800">{examScopeLabel(exam, churches, services, classes)}</span></p>
            <p>المواد: <span className="text-slate-800">{subjects.length} · مجموع {fmtNum(subjects.filter((s) => !s.is_bonus).reduce((a, s) => a + s.full_degree, 0))}</span></p>
            <p>النجاح: <span className="text-slate-800">{PASS_RULE_LABELS[exam.pass_rule]}{exam.pass_rule !== 'subjects' && ` (${fmtNum(exam.pass_percent)}٪)`}</span></p>
          </div>
        </section>
      )}

      {/* ---------- SUBJECTS ---------- */}
      {tab === 'subjects' && (
        <section className="space-y-2">
          {perms.manage_subjects && !exam.locked && (
            <button id="rs-add" type="button" onClick={() => setSForm({ open: true, s: null })} className="btn-primary flex items-center gap-1.5 !py-2 !px-3 text-sm !from-emerald-600 !to-emerald-500"><Plus className="h-4 w-4" /> إضافة مادة</button>
          )}
          {subjects.length === 0 ? (
            <div className="card py-10 text-center text-slate-400"><BookOpen className="mx-auto mb-2 h-9 w-9 text-emerald-200" /><p className="font-bold">لا مواد بعد</p></div>
          ) : (
            <div className="card !p-0 divide-y divide-slate-100 overflow-hidden">
              <div className="grid grid-cols-12 bg-slate-50 px-3 py-2 text-[10px] font-extrabold text-slate-500"><span className="col-span-5">المادة</span><span className="col-span-2 text-center">الكاملة</span><span className="col-span-2 text-center">النجاح</span><span className="col-span-1 text-center">الوزن</span><span className="col-span-2" /></div>
              {subjects.map((s, i) => (
                <div key={s.id} id={`rs-item-${s.id}`} className="grid grid-cols-12 items-center px-3 py-2 text-sm">
                  <div className="col-span-5 min-w-0">
                    <p className="truncate font-extrabold">{s.name} {s.is_bonus && <span className="badge bg-amber-100 text-amber-700 !text-[10px]">إضافي</span>}</p>
                    {s.code && <p className="text-[10px] font-bold text-slate-400" dir="ltr">{s.code}</p>}
                  </div>
                  <span className="col-span-2 text-center font-extrabold tabular-nums">{fmtNum(s.full_degree)}</span>
                  <span className="col-span-2 text-center tabular-nums text-slate-600">{fmtNum(s.pass_degree)}</span>
                  <span className="col-span-1 text-center tabular-nums text-slate-500">{s.weight === null ? '—' : fmtNum(s.weight)}</span>
                  <div className="col-span-2 flex items-center justify-end gap-0.5">
                    {perms.manage_subjects && !exam.locked && (<>
                      <button type="button" aria-label="أعلى" disabled={i === 0} onClick={() => move(i, -1)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30"><ChevronUp className="h-4 w-4" /></button>
                      <button type="button" aria-label="أسفل" disabled={i === subjects.length - 1} onClick={() => move(i, 1)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button>
                      <button type="button" aria-label="تعديل" onClick={() => setSForm({ open: true, s })} className="rounded-lg p-1 text-primary-600 hover:bg-primary-50"><Pencil className="h-4 w-4" /></button>
                      <button type="button" aria-label="نسخ" onClick={() => dupSubject(s)} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"><Copy className="h-4 w-4" /></button>
                      <button type="button" aria-label="حذف" onClick={() => setConfirm({ kind: 'delete-subject', s })} className="rounded-lg p-1 text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                    </>)}
                  </div>
                </div>
              ))}
              <div className="flex justify-between bg-emerald-50/60 px-3 py-2 text-xs font-extrabold text-emerald-800">
                <span>{subjects.length} مادة</span><span>الدرجة الكاملة للامتحان: {fmtNum(subjects.filter((s) => !s.is_bonus).reduce((a, s) => a + s.full_degree, 0))}</span>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ---------- RESULTS ---------- */}
      {tab === 'results' && (
        <section className="space-y-2">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input id="rx-res-search" className="input-field pr-9" placeholder="ابحث بالاسم أو الكود…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-1">
            {(['all', 'passed', 'failed', 'incomplete', 'not_entered', 'absent', 'draft'] as const).map((f) => (
              <button key={f} type="button" onClick={() => setStatusFilter(f)} aria-pressed={statusFilter === f}
                className={`rounded-full px-3 py-1 text-xs font-extrabold ${statusFilter === f ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>
                {f === 'all' ? `الكل (${summary.length})` : `${STUDENT_STATUS_LABELS[f]} (${summary.filter((r) => r.status === f).length})`}
              </button>
            ))}
          </div>
          {visible.length === 0 ? <div className="card py-10 text-center font-bold text-slate-400">لا مخدومين</div> : (
            <div id="rx-results" className="card !p-0 divide-y divide-slate-100 overflow-hidden">
              {visible.map((r) => (
                <button key={r.enrollment_id} type="button" id={`rx-st-${r.enrollment_id}`} onClick={() => setStudent(r)} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-start hover:bg-emerald-50/40">
                  <Avatar name={r.name} url={r.image_url} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5"><p className="truncate font-extrabold">{r.name}</p><StudentStatusBadge status={r.status} /></div>
                    <p className="text-[10px] font-bold text-slate-400" dir="ltr">{r.national_id}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="flex-1"><PctBar pct={r.percent} color={r.grade_color} /></div>
                      <span className="text-[10px] font-bold text-slate-500 tabular-nums">{r.subjects_entered}/{r.subjects_total} مادة</span>
                    </div>
                  </div>
                  <div className="text-end">
                    <p className="font-extrabold tabular-nums">{fmtNum(r.total_score)}<span className="text-[10px] text-slate-400"> / {fmtNum(r.total_full)}</span></p>
                    <p className="text-xs font-extrabold tabular-nums text-emerald-700">{fmtPct(r.percent)}</p>
                    <GradePill name={r.grade_name} color={r.grade_color} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ---------- RANKING ---------- */}
      {tab === 'ranking' && (
        <section className="space-y-2">
          <div className="flex gap-1">
            {(['percent', 'score'] as const).map((k) => (
              <button key={k} type="button" onClick={() => setRankBy(k)} aria-pressed={rankBy === k} className={`rounded-full px-3 py-1 text-xs font-extrabold ${rankBy === k ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>
                {k === 'percent' ? 'حسب النسبة' : 'حسب المجموع'}
              </button>
            ))}
          </div>
          {ranked.length === 0 ? <div className="card py-10 text-center font-bold text-slate-400">لا نتائج مكتملة للترتيب بعد</div> : (
            <div id="rx-ranking" className="card !p-0 divide-y divide-slate-100 overflow-hidden">
              {ranked.map((r) => { const rk = rankBy === 'percent' ? r.rank : r.rank_score; return (
                <button key={r.enrollment_id} type="button" onClick={() => setStudent(r)} className="flex w-full items-center gap-3 px-3 py-2.5 text-start hover:bg-emerald-50/40">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold tabular-nums ${rk === 1 ? 'bg-amber-100 text-amber-700' : rk === 2 ? 'bg-slate-200 text-slate-700' : rk === 3 ? 'bg-orange-100 text-orange-700' : 'bg-slate-50 text-slate-500'}`}>{rk}</span>
                  <Avatar name={r.name} url={r.image_url} size={36} />
                  <div className="min-w-0 flex-1"><p className="truncate font-extrabold">{r.name}</p><p className="text-[10px] font-bold text-slate-400">{rankLabel(rk)} · {r.passed ? 'ناجح' : 'لم ينجح'}</p></div>
                  <div className="text-end"><p className="font-extrabold tabular-nums">{rankBy === 'percent' ? fmtPct(r.percent) : `${fmtNum(r.total_score)} / ${fmtNum(r.total_full)}`}</p><GradePill name={r.grade_name} color={r.grade_color} /></div>
                </button>
              ); })}
            </div>
          )}
        </section>
      )}

      {/* ---------- SETTINGS ---------- */}
      {tab === 'settings' && (
        <section className="space-y-3">
          <div className="card space-y-1 text-sm font-bold text-slate-600">
            <p>الاسم: <span className="text-slate-800">{exam.name}</span></p>
            <p>الحالة: <span className="text-slate-800">{EXAM_STATUS_LABELS[exam.status]}</span>{exam.locked && ' · 🔒 مقفل'}</p>
            <p>التاريخ: <span className="text-slate-800">{fmtDate(exam.exam_date)}</span> · العام: <span className="text-slate-800">{exam.academic_year ?? '—'}</span></p>
            <p>النطاق: <span className="text-slate-800">{examScopeLabel(exam, churches, services, classes)}</span></p>
            <p>نظام التقدير: <span className="text-slate-800">{system?.name ?? 'بدون'}</span> · {exam.grade_overall && 'تقدير كلي'}{exam.grade_overall && exam.grade_subject && ' + '}{exam.grade_subject && 'تقدير لكل مادة'}</p>
            <p>قاعدة النجاح: <span className="text-slate-800">{PASS_RULE_LABELS[exam.pass_rule]}{exam.pass_rule !== 'subjects' && ` — ${fmtNum(exam.pass_percent)}٪`}</span></p>
            <p>الغائب: <span className="text-slate-800">{exam.absent_as_zero ? 'يحصل على صفر' : 'لا يُحسب له صفر'}</span>{exam.min_required_subjects && ` · أقل عدد مواد: ${exam.min_required_subjects}`}</p>
            {exam.description && <p className="text-slate-500">{exam.description}</p>}
            <div className="mt-2 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
              <p>أُنشئ: {fmtDateTime(exam.created_at)}</p><p>آخر تعديل: {fmtDateTime(exam.edited_at)}</p>
              {exam.locked && <p>قُفل: {fmtDateTime(exam.locked_at)}</p>}
              {exam.published_at && <p>نُشر للمخدومين: {fmtDateTime(exam.published_at)}</p>}
            </div>
          </div>
          {perms.manage_exams && (
            <div className="card space-y-2">
              <p className="text-xs font-extrabold text-slate-500">الحالة السريعة</p>
              <div className="grid grid-cols-4 gap-1">
                {(Object.keys(EXAM_STATUS_LABELS) as ResultExamStatus[]).map((s) => (
                  <button key={s} type="button" disabled={busy || exam.status === s} onClick={() => patchExam({ status: s }, `الحالة الآن: ${EXAM_STATUS_LABELS[s]}`)}
                    className={`rounded-xl px-1 py-2 text-[11px] font-extrabold ${exam.status === s ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>{EXAM_STATUS_LABELS[s]}</button>
                ))}
              </div>
              <button id="rx-edit" type="button" onClick={() => setXForm(true)} className="btn-secondary flex w-full items-center justify-center gap-1.5 !py-2.5 !border-emerald-200 !text-emerald-700"><Pencil className="h-4 w-4" /> تعديل الإعدادات</button>
              <button type="button" onClick={duplicate} className="btn-secondary flex w-full items-center justify-center gap-1.5 !py-2.5 !border-slate-200 !text-slate-700"><Copy className="h-4 w-4" /> نسخ الامتحان (المواد فقط)</button>
            </div>
          )}
          {canWrite && !exam.locked && (
            <div className="card space-y-2">
              <p className="text-xs font-extrabold text-slate-500">إجراءات جماعية على النتائج</p>
              <button id="rx-copy-from" type="button" onClick={() => setCopyOpen(true)} className="btn-secondary flex w-full items-center justify-center gap-1.5 !py-2.5 !border-sky-200 !text-sky-700"><ClipboardCopy className="h-4 w-4" /> نسخ النتائج من امتحان آخر</button>
              {perms.edit && (<>
                {subjects.map((s) => (
                  <button key={s.id} type="button" onClick={() => setConfirm({ kind: 'clear-subject', s })} className="btn-secondary flex w-full items-center justify-center gap-1.5 !py-2 !border-amber-200 !text-amber-700 text-xs"><Eraser className="h-4 w-4" /> مسح نتائج «{s.name}»</button>
                ))}
                <button id="rx-clear" type="button" onClick={() => setConfirm({ kind: 'clear' })} className="btn-secondary flex w-full items-center justify-center gap-1.5 !py-2.5 !border-red-200 !text-red-600"><Eraser className="h-4 w-4" /> مسح كل النتائج</button>
              </>)}
            </div>
          )}
          {perms.manage_exams && !exam.locked && (
            <button id="rx-delete" type="button" onClick={() => setConfirm({ kind: 'delete-exam' })} className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-red-50 px-4 py-3 font-extrabold text-red-600 hover:bg-red-100"><Trash2 className="h-4 w-4" /> حذف الامتحان</button>
          )}
        </section>
      )}

      {/* ---------- modals ---------- */}
      {sForm.open && (
        <SubjectFormModal examId={exam.id} subject={sForm.s} nextOrder={subjects.length + 1}
          onClose={() => setSForm({ open: false, s: null })}
          onSaved={(saved, keep) => { setSubjects((l) => (l.some((x) => x.id === saved.id) ? l.map((x) => (x.id === saved.id ? saved : x)) : [...l, saved])); if (!keep) setSForm({ open: false, s: null }); flash('تم الحفظ'); }} />
      )}
      {xForm && (
        <ExamFormModal exam={exam} churches={churches} services={services} classes={classes} gradingSystems={systems}
          onClose={() => setXForm(false)} onSaved={(saved) => { setExam(saved); setXForm(false); flash('تم حفظ الإعدادات'); load(); }} />
      )}
      {student && <StudentResultModal exam={exam} subjects={subjects} grades={grades} student={student} canWrite={canWrite} onClose={() => setStudent(null)} onSaved={load} />}
      {copyOpen && <CopyFromModal supabaseExamId={exam.id} onClose={() => setCopyOpen(false)} onDone={(n) => { setCopyOpen(false); flash(`تم نسخ ${n} نتيجة`); load(); }} />}
      {confirm && (
        <ConfirmModal
          title={{ 'delete-exam': 'حذف الامتحان', 'delete-subject': 'حذف المادة', clear: 'مسح كل النتائج', 'clear-subject': 'مسح نتائج المادة', lock: 'قفل النتائج', unlock: 'فتح القفل' }[confirm.kind]}
          danger={confirm.kind !== 'lock' && confirm.kind !== 'unlock'}
          confirmLabel={confirm.kind === 'lock' ? 'قفل' : confirm.kind === 'unlock' ? 'فتح' : 'تأكيد'}
          desc={
            confirm.kind === 'delete-exam' ? <>سيُحذف الامتحان ومواده وكل نتائجه نهائياً.</>
            : confirm.kind === 'delete-subject' ? <>ستُحذف مادة «{confirm.s?.name}» مع كل نتائجها وتُعاد حساب النسب.</>
            : confirm.kind === 'clear' ? <>ستُمسح كل نتائج هذا الامتحان ({summary.filter((r) => r.subjects_entered > 0).length} مخدوم). المواد والإعدادات تبقى.</>
            : confirm.kind === 'clear-subject' ? <>ستُمسح نتائج مادة «{confirm.s?.name}» فقط.</>
            : confirm.kind === 'lock' ? <>بعد القفل لا يستطيع الخدام تعديل النتائج أو المواد؛ يُغلق الامتحان ويُعتبر مكتملاً. يمكن للمسؤول فتحه لاحقاً.</>
            : <>سيتمكن الخدام من تعديل النتائج مرة أخرى.</>
          }
          busy={busy} onConfirm={doConfirm} onClose={() => setConfirm(null)}
        />
      )}
      <Toast msg={toast} />
    </AppShell>
  );
}

/** Pick a source exam → copy its results (subjects matched by code / name) */
function CopyFromModal({ supabaseExamId, onClose, onDone }: { supabaseExamId: string; onClose: () => void; onDone: (n: number) => void }) {
  const [supabase] = useState(() => createClient());
  const [exams, setExams] = useState<ResultExam[]>([]);
  const [from, setFrom] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetchResultExams(supabase).then((l) => setExams(l.filter((x) => x.id !== supabaseExamId))).catch(() => {}); }, [supabase, supabaseExamId]);
  const run = async () => {
    if (!from) return;
    setBusy(true); setErr(null);
    try { onDone(await copyFromExam(supabase, from, supabaseExamId)); } catch (e) { setErr(resultErrorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <ModalFrame title="نسخ النتائج من امتحان" icon={<ClipboardCopy className="h-5 w-5 text-sky-600" />} onClose={onClose}>
      <p className="mb-2 text-xs font-bold text-slate-500">تُطابق المواد بالكود ثم بالاسم، وتُحوَّل الدرجة نسبياً إذا اختلفت الدرجة الكاملة. النتائج الموجودة لا تُستبدل.</p>
      <ExamPicker exams={exams} value={from} onChange={setFrom} id="rx-copy-src" placeholder="اختر الامتحان المصدر…" />
      {err && <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{err}</p>}
      <button type="button" disabled={!from || busy} onClick={run} className="btn-primary mt-3 flex w-full items-center justify-center gap-1.5 !from-sky-600 !to-sky-500">{busy && <Loader2 className="h-4 w-4 animate-spin" />} نسخ</button>
    </ModalFrame>
  );
}
