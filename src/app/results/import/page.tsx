'use client';

// ---------- EXCEL IMPORT (استيراد النتائج) ----------
// 1) pick exam → download template (كود · الاسم · one column per subject)
// 2) drop / choose .xlsx or .csv → parse first sheet
// 3) preview: match rows by student code (الرقم القومي) — or by name as a
//    fallback — detect unknown / duplicate / invalid / over-full / absent
//    words, let the user fix cells inline, skip bad rows
// 4) import through result_save_bulk with progress + failed list.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, FileUp, Download, AlertTriangle, CheckCircle2, XCircle, Upload, Trash2, RotateCcw, Lock, FileSpreadsheet } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { ResultsHeader, Toast, ExamPicker, Kpi } from '@/components/results/ResultBits';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import {
  fetchResultExams, fetchResultExam, fetchSubjects, fetchSummary, fetchResultPermissions,
  saveBulk, validateScore, normalizeNumber, fmtNum, safeFile, isMigrationMissing, MIGRATION_HINT, resultErrorMessage, NO_PERMISSIONS,
  type ResultExam, type ResultSubject, type StudentSummary, type ResultPermissions, type BulkRow, type ResultRowStatus,
} from '@/lib/results';

const CODE_HEADERS = ['الكود', 'كود', 'الرقم القومي', 'رقم قومي', 'code', 'national_id', 'id'];
const NAME_HEADERS = ['الاسم', 'اسم', 'name', 'المخدوم'];
const ABSENT_WORDS = ['غ', 'غائب', 'غياب', 'absent', 'a', 'abs'];

type CellState = { raw: string; value: number | null; status: ResultRowStatus | null; error: string | null };
interface ImportRow {
  idx: number;                 // sheet row number (1-based, for messages)
  code: string;
  name: string;
  student: StudentSummary | null;
  matchBy: 'code' | 'name' | null;
  problem: 'unknown' | 'duplicate' | 'out_of_scope' | null;
  cells: Record<string, CellState>;  // subject_id → cell
  skip: boolean;
  saved?: 'ok' | 'fail';
  failMsg?: string;
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const digitsOnly = (s: string) => normalizeNumber(s).replace(/\D/g, '');

function parseCell(raw: unknown, full: number): CellState {
  const str = String(raw ?? '').trim();
  if (str === '') return { raw: '', value: null, status: null, error: null };
  if (ABSENT_WORDS.includes(str.toLowerCase())) return { raw: str, value: null, status: 'absent', error: null };
  const { value, error } = validateScore(str, full);
  return { raw: str, value, status: error ? null : 'completed', error };
}

export default function ImportPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>}>
        <ImportInner />
      </Suspense>
    </AppShell>
  );
}

function ImportInner() {
  const params = useSearchParams();
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';

  const [exams, setExams] = useState<ResultExam[]>([]);
  const [examId, setExamId] = useState(params.get('exam') ?? '');
  const [exam, setExam] = useState<ResultExam | null>(null);
  const [subjects, setSubjects] = useState<ResultSubject[]>([]);
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [perms, setPerms] = useState<ResultPermissions>(NO_PERMISSIONS);
  const [loading, setLoading] = useState(true);
  const [loadingExam, setLoadingExam] = useState(false);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [unmatchedCols, setUnmatchedCols] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<{ ok: number; fail: number } | null>(null);
  const [overwrite, setOverwrite] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!approved) return;
    (async () => {
      try {
        const [xs, p] = await Promise.all([fetchResultExams(supabase), fetchResultPermissions(supabase)]);
        setExams(xs); setPerms(p); setMigrationMissing(false);
      } catch (err) { if (isMigrationMissing(err)) setMigrationMissing(true); else flash(resultErrorMessage(err)); }
      finally { setLoading(false); }
    })();
  }, [supabase, approved]);

  const loadExam = useCallback(async () => {
    setRows([]); setReport(null); setFileName('');
    if (!examId) { setExam(null); setSubjects([]); setStudents([]); return; }
    setLoadingExam(true);
    try {
      const [x, subs, sum] = await Promise.all([fetchResultExam(supabase, examId), fetchSubjects(supabase, examId), fetchSummary(supabase, examId)]);
      setExam(x); setSubjects(subs); setStudents(sum);
    } catch (err) { flash(resultErrorMessage(err, 'تعذر تحميل الامتحان')); }
    finally { setLoadingExam(false); }
  }, [supabase, examId]);
  useEffect(() => { loadExam(); }, [loadExam]);

  const canImport = perms.import && !!exam && !exam.locked && exam.status !== 'archived';

  // ---- template ----
  const downloadTemplate = async () => {
    if (!exam) return;
    const XLSX = await import('xlsx');
    const header: Record<string, string | number | null> = { 'الكود': '', 'الاسم': '' };
    subjects.forEach((s) => { header[s.name] = null; });
    const data = students.length
      ? students.map((st) => { const o: Record<string, string | number | null> = { 'الكود': st.national_id, 'الاسم': st.name }; subjects.forEach((s) => { o[s.name] = null; }); return o; })
      : [header];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [{ wch: 16 }, { wch: 28 }, ...subjects.map(() => ({ wch: 12 }))];
    XLSX.utils.book_append_sheet(wb, ws, 'النتائج');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { 'تعليمات': 'لا تغيّر عمود الكود — يُستخدم لمطابقة المخدوم' },
      { 'تعليمات': 'اكتب الدرجة في عمود كل مادة، أو «غ» للغائب، أو اتركه فارغاً لعدم الاستيراد' },
      ...subjects.map((s) => ({ 'تعليمات': `${s.name}: من ${fmtNum(s.full_degree)} · درجة النجاح ${fmtNum(s.pass_degree)}` })),
    ]), 'تعليمات');
    XLSX.writeFile(wb, `قالب_نتائج_${safeFile(exam.name)}.xlsx`);
  };

  // ---- parse ----
  const parseFile = async (file: File) => {
    if (!exam) return;
    setParsing(true); setReport(null);
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      if (!raw.length) { flash('الملف فارغ'); return; }
      const headers = Object.keys(raw[0]);
      const findHeader = (cands: string[]) => headers.find((h) => cands.includes(norm(h))) ?? null;
      const codeCol = findHeader(CODE_HEADERS);
      const nameCol = findHeader(NAME_HEADERS);
      if (!codeCol && !nameCol) { flash('لم يتم العثور على عمود «الكود» أو «الاسم»'); return; }
      // subject columns: match by name, code, or "name (full)"
      const subCol = new Map<string, string>(); // subject_id → header
      const used = new Set<string>([codeCol ?? '', nameCol ?? '']);
      subjects.forEach((s) => {
        const h = headers.find((hh) => !used.has(hh) && (norm(hh) === norm(s.name) || (s.code && norm(hh) === norm(s.code)) || norm(hh).startsWith(`${norm(s.name)} (`)));
        if (h) { subCol.set(s.id, h); used.add(h); }
      });
      setUnmatchedCols(headers.filter((h) => !used.has(h)));
      if (!subCol.size) { flash('لا يوجد عمود يطابق أي مادة من مواد الامتحان'); return; }

      const byCode = new Map(students.map((s) => [digitsOnly(s.national_id), s]));
      const byName = new Map<string, StudentSummary[]>();
      students.forEach((s) => { const k = norm(s.name); byName.set(k, [...(byName.get(k) ?? []), s]); });
      const seen = new Map<string, number>();
      const out: ImportRow[] = raw.map((r, i) => {
        const code = codeCol ? String(r[codeCol] ?? '').trim() : '';
        const name = nameCol ? String(r[nameCol] ?? '').trim() : '';
        let student: StudentSummary | null = null; let matchBy: ImportRow['matchBy'] = null;
        if (code && byCode.has(digitsOnly(code))) { student = byCode.get(digitsOnly(code))!; matchBy = 'code'; }
        else if (name && byName.get(norm(name))?.length === 1) { student = byName.get(norm(name))![0]; matchBy = 'name'; }
        const cells: Record<string, CellState> = {};
        subjects.forEach((s) => { const h = subCol.get(s.id); cells[s.id] = h ? parseCell(r[h], s.full_degree) : { raw: '', value: null, status: null, error: null }; });
        let problem: ImportRow['problem'] = student ? null : 'unknown';
        if (student) { const n = (seen.get(student.enrollment_id) ?? 0) + 1; seen.set(student.enrollment_id, n); if (n > 1) problem = 'duplicate'; }
        const empty = !code && !name && Object.values(cells).every((c) => c.raw === '');
        return { idx: i + 2, code, name, student, matchBy, problem, cells, skip: empty || problem !== null };
      }).filter((r) => r.code || r.name || Object.values(r.cells).some((c) => c.raw !== ''));
      setRows(out);
      setFileName(file.name);
      flash(`تم قراءة ${out.length} صف`);
    } catch (err) { flash(resultErrorMessage(err, 'تعذر قراءة الملف')); }
    finally { setParsing(false); }
  };

  const onFiles = (files: FileList | null) => { const f = files?.[0]; if (f) parseFile(f); if (fileInput.current) fileInput.current.value = ''; };

  // ---- inline fixes ----
  const editCell = (ri: number, sb: ResultSubject, raw: string) =>
    setRows((rs) => rs.map((r, i) => (i === ri ? { ...r, cells: { ...r.cells, [sb.id]: parseCell(raw, sb.full_degree) }, saved: undefined, failMsg: undefined } : r)));
  const assignStudent = (ri: number, enrollmentId: string) =>
    setRows((rs) => {
      const st = students.find((s) => s.enrollment_id === enrollmentId) ?? null;
      const next = rs.map((r, i) => (i === ri ? { ...r, student: st, matchBy: st ? 'code' as const : null, problem: st ? null : 'unknown' as const, skip: !st } : r));
      // recompute duplicates
      const seen = new Map<string, number>();
      return next.map((r) => {
        if (!r.student) return r;
        const n = (seen.get(r.student.enrollment_id) ?? 0) + 1; seen.set(r.student.enrollment_id, n);
        const dup = n > 1;
        return { ...r, problem: dup ? 'duplicate' : r.problem === 'duplicate' ? null : r.problem, skip: dup ? true : r.problem === 'duplicate' ? false : r.skip };
      });
    });
  const toggleSkip = (ri: number) => setRows((rs) => rs.map((r, i) => (i === ri ? { ...r, skip: !r.skip } : r)));

  // ---- stats ----
  const stats = useMemo(() => {
    const active = rows.filter((r) => !r.skip && r.student);
    let cells = 0, errors = 0, absent = 0;
    active.forEach((r) => Object.values(r.cells).forEach((c) => { if (c.raw !== '') { cells++; if (c.error) errors++; if (c.status === 'absent') absent++; } }));
    return {
      total: rows.length, matched: rows.filter((r) => r.student).length, unknown: rows.filter((r) => r.problem === 'unknown').length,
      duplicates: rows.filter((r) => r.problem === 'duplicate').length, byName: rows.filter((r) => r.matchBy === 'name').length,
      skipped: rows.filter((r) => r.skip).length, cells, errors, absent,
    };
  }, [rows]);

  // ---- import ----
  const doImport = async (onlyFailed = false) => {
    if (!exam || !canImport) return;
    const targets = rows.map((r, i) => ({ r, i })).filter(({ r }) => !r.skip && r.student && (!onlyFailed || r.saved === 'fail'));
    const existing = new Set<string>();
    if (!overwrite) {
      // rows with a stored score are skipped when not overwriting
      const { fetchResultRows } = await import('@/lib/results');
      (await fetchResultRows(supabase, exam.id)).forEach((x) => { if (x.score !== null || x.status === 'absent' || x.status === 'excused') existing.add(`${x.enrollment_id}|${x.subject_id}`); });
    }
    const bulk: BulkRow[] = [];
    const owner: number[] = [];
    targets.forEach(({ r, i }) => {
      subjects.forEach((s) => {
        const c = r.cells[s.id];
        if (!c || c.raw === '' || c.error || !c.status) return;
        if (!overwrite && existing.has(`${r.student!.enrollment_id}|${s.id}`)) return;
        bulk.push({ subject_id: s.id, enrollment_id: r.student!.enrollment_id, score: c.status === 'absent' ? null : c.value, status: c.status });
        owner.push(i);
      });
    });
    if (!bulk.length) { flash('لا توجد درجات صالحة للاستيراد'); return; }
    setSaving({ done: 0, total: bulk.length });
    const out = await saveBulk(supabase, exam.id, bulk, (d, t) => setSaving({ done: d, total: t }));
    const failByRow = new Map<number, string>();
    const okRows = new Set<number>();
    out.forEach((o, k) => { const ri = owner[k]; if (o.ok) okRows.add(ri); else failByRow.set(ri, resultErrorMessage({ message: o.error }, o.error ?? 'فشل')); });
    setRows((rs) => rs.map((r, i) => failByRow.has(i) ? { ...r, saved: 'fail', failMsg: failByRow.get(i) } : okRows.has(i) ? { ...r, saved: 'ok', failMsg: undefined } : r));
    const ok = out.filter((o) => o.ok).length;
    setReport({ ok, fail: out.length - ok });
    setSaving(null);
    flash(out.length - ok ? `تم استيراد ${ok} · فشل ${out.length - ok}` : `تم استيراد ${ok} درجة بنجاح`);
  };

  const failedRows = rows.filter((r) => r.saved === 'fail').length;

  if (migrationMissing) {
    return (<><ResultsHeader /><div className="card flex items-start gap-3 border-amber-200 bg-amber-50 text-amber-900"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><p className="text-sm font-bold">{MIGRATION_HINT}</p></div></>);
  }

  return (
    <>
      <ResultsHeader title="استيراد النتائج من Excel" badge={exam?.locked ? <span className="badge bg-slate-100 text-slate-700"><Lock className="ml-1 inline h-3 w-3" />مقفول</span> : undefined} />
      <Toast msg={toast} />

      <section className="card mb-3 space-y-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <ExamPicker exams={exams} value={examId} onChange={setExamId} id="imp-exam" filter={(x) => x.status !== 'archived'} />
          <button type="button" id="imp-template" className="btn-secondary !py-2 text-sm" disabled={!exam || !subjects.length} onClick={downloadTemplate}>
            <Download className="h-4 w-4" /> تحميل القالب
          </button>
        </div>
        {exam && subjects.length > 0 && (
          <p className="text-xs text-slate-500">
            الأعمدة المتوقعة: <b>الكود</b> · <b>الاسم</b> · {subjects.map((s) => <span key={s.id} className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 font-bold text-slate-700">{s.name}</span>)}
            <span className="mr-1">— يتم مطابقة المخدوم بالكود (الرقم القومي) أولاً ثم بالاسم إذا كان فريداً. «غ» = غائب.</span>
          </p>
        )}
        {exam && !loadingExam && subjects.length === 0 && (
          <p className="text-sm font-bold text-amber-700">لا توجد مواد في هذا الامتحان — <Link href={`/results/${exam.id}?tab=subjects`} className="underline">أضف المواد أولاً</Link></p>
        )}
        {exam && !canImport && (
          <p className="flex items-center gap-1.5 text-sm font-bold text-amber-800"><Lock className="h-4 w-4" />{exam.locked ? 'النتائج مقفولة' : exam.status === 'archived' ? 'الامتحان مؤرشف' : 'ليس لديك صلاحية الاستيراد'}</p>
        )}
      </section>

      {(loading || loadingExam) && <div className="flex justify-center py-10"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>}

      {exam && canImport && subjects.length > 0 && (
        <section
          className={`card mb-3 flex flex-col items-center justify-center gap-2 border-2 border-dashed py-8 text-center transition ${dragOver ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200'}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); onFiles(e.dataTransfer.files); }}
        >
          <input ref={fileInput} id="imp-file" type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => onFiles(e.target.files)} />
          {parsing ? <Loader2 className="h-8 w-8 animate-spin text-emerald-500" /> : <FileSpreadsheet className="h-10 w-10 text-emerald-500" />}
          <p className="text-sm font-bold text-slate-700">{fileName ? `الملف: ${fileName}` : 'اسحب ملف Excel هنا أو'}</p>
          <button type="button" className="btn-primary !py-2 text-sm" onClick={() => fileInput.current?.click()} disabled={parsing}><FileUp className="h-4 w-4" /> {fileName ? 'اختيار ملف آخر' : 'اختيار ملف'}</button>
          <label className="mt-1 inline-flex items-center gap-1.5 text-xs font-bold text-slate-600">
            <input type="checkbox" id="imp-overwrite" className="h-4 w-4 accent-emerald-600" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> استبدال الدرجات المسجلة مسبقاً
          </label>
        </section>
      )}

      {rows.length > 0 && exam && (
        <>
          <section className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
            <Kpi label="الصفوف" value={stats.total} id="imp-k-total" />
            <Kpi label="مطابق" value={stats.matched} tone="text-emerald-700" sub={stats.byName ? `${stats.byName} بالاسم` : undefined} id="imp-k-matched" />
            <Kpi label="غير معروف" value={stats.unknown} tone={stats.unknown ? 'text-red-600' : 'text-slate-800'} id="imp-k-unknown" />
            <Kpi label="مكرر" value={stats.duplicates} tone={stats.duplicates ? 'text-amber-600' : 'text-slate-800'} id="imp-k-dup" />
            <Kpi label="درجات" value={stats.cells} sub={stats.absent ? `${stats.absent} غائب` : undefined} id="imp-k-cells" />
            <Kpi label="أخطاء" value={stats.errors} tone={stats.errors ? 'text-red-600' : 'text-slate-800'} id="imp-k-errors" />
          </section>
          {unmatchedCols.length > 0 && (
            <p className="mb-2 text-xs text-slate-500">أعمدة تم تجاهلها: {unmatchedCols.join(' · ')}</p>
          )}
          {stats.errors > 0 && <p className="mb-2 flex items-center gap-1 text-xs font-bold text-red-600"><AlertTriangle className="h-3.5 w-3.5" /> الخلايا الحمراء لن تُستورد حتى يتم تصحيحها (أكبر من الدرجة الكاملة أو غير رقمية)</p>}

          <section className="card overflow-hidden !p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm" id="imp-table">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-2 py-2 text-center font-bold">#</th>
                    <th className="px-2 py-2 text-center font-bold">استيراد</th>
                    <th className="px-3 py-2 text-right font-bold">المخدوم</th>
                    {subjects.map((s) => <th key={s.id} className="px-2 py-2 text-center font-bold whitespace-nowrap">{s.name}<div className="font-normal">/ {fmtNum(s.full_degree)}</div></th>)}
                    <th className="px-2 py-2 text-center font-bold">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r, ri) => (
                    <tr key={ri} className={r.skip ? 'bg-slate-50/70 text-slate-400' : r.saved === 'ok' ? 'bg-emerald-50/40' : r.saved === 'fail' ? 'bg-red-50/40' : ''}>
                      <td className="px-2 py-1.5 text-center text-xs tabular-nums">{r.idx}</td>
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" aria-label="استيراد هذا الصف" className="h-4 w-4 accent-emerald-600" checked={!r.skip} disabled={!r.student} onChange={() => toggleSkip(ri)} />
                      </td>
                      <td className="px-3 py-1.5">
                        {r.student ? (
                          <div className="min-w-0">
                            <div className="truncate font-bold text-slate-800">{r.student.name}</div>
                            <div className="text-[11px] text-slate-400">{r.student.national_id}{r.matchBy === 'name' && <span className="mr-1 rounded bg-sky-100 px-1 text-sky-700">مطابقة بالاسم</span>}{r.problem === 'duplicate' && <span className="mr-1 rounded bg-amber-100 px-1 text-amber-700">مكرر</span>}</div>
                          </div>
                        ) : (
                          <div className="min-w-0">
                            <div className="truncate font-bold text-red-600">{r.name || r.code || '—'} <span className="text-[11px] font-normal">غير معروف</span></div>
                            <select aria-label="اختيار المخدوم" className="input-field mt-1 !py-1 text-xs" value="" onChange={(e) => assignStudent(ri, e.target.value)}>
                              <option value="">اختيار المخدوم يدوياً…</option>
                              {students.map((s) => <option key={s.enrollment_id} value={s.enrollment_id}>{s.name} · {s.national_id}</option>)}
                            </select>
                          </div>
                        )}
                      </td>
                      {subjects.map((s) => {
                        const c = r.cells[s.id];
                        return (
                          <td key={s.id} className="px-2 py-1.5 text-center">
                            <input
                              aria-label={`${r.student?.name ?? r.name} — ${s.name}`}
                              value={c.raw}
                              disabled={r.skip && !r.student}
                              onChange={(e) => editCell(ri, s, e.target.value)}
                              className={`w-[70px] rounded-lg border px-2 py-1 text-center font-bold tabular-nums outline-none focus:ring-2 focus:ring-emerald-300 ${c.error ? 'border-red-400 bg-red-50 text-red-700' : c.status === 'absent' ? 'border-slate-200 bg-slate-100 text-slate-500' : c.raw === '' ? 'border-slate-100 bg-white' : 'border-slate-200 bg-white'}`}
                            />
                            {c.error && <div className="text-[10px] font-bold text-red-600">{c.error}</div>}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5 text-center text-xs">
                        {r.saved === 'ok' ? <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-600" />
                          : r.saved === 'fail' ? <span className="inline-flex items-center gap-1 text-red-600" title={r.failMsg}><XCircle className="h-4 w-4" />{r.failMsg}</span>
                          : r.problem === 'unknown' ? <span className="text-red-600">غير معروف</span>
                          : r.problem === 'duplicate' ? <span className="text-amber-600">مكرر</span>
                          : r.skip ? <span className="text-slate-400">مستبعد</span>
                          : Object.values(r.cells).some((c) => c.error) ? <span className="text-red-600">به أخطاء</span>
                          : <span className="text-emerald-700">جاهز</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* action bar */}
          <div className="fixed inset-x-0 bottom-16 z-30 px-3 sm:bottom-4">
            <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur">
              {saving ? (
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs font-bold text-slate-600"><span>جارٍ الاستيراد…</span><span>{saving.done} / {saving.total}</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${saving.total ? (saving.done / saving.total) * 100 : 0}%` }} /></div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex-1 text-xs font-bold text-slate-600">
                    {report ? <span className={report.fail ? 'text-red-600' : 'text-emerald-700'}><CheckCircle2 className="ml-0.5 inline h-3.5 w-3.5" />تم استيراد {report.ok}{report.fail ? ` · فشل ${report.fail}` : ''}</span>
                      : <span>{rows.filter((r) => !r.skip && r.student).length} صف جاهز · {stats.cells - stats.errors} درجة</span>}
                  </div>
                  <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={() => { setRows([]); setFileName(''); setReport(null); }}><Trash2 className="h-3.5 w-3.5" /> إلغاء</button>
                  {failedRows > 0 && <button type="button" id="imp-retry" className="btn-secondary !py-1.5 text-xs" onClick={() => doImport(true)}><RotateCcw className="h-3.5 w-3.5" /> إعادة الفاشلة ({failedRows})</button>}
                  <button type="button" id="imp-run" className="btn-primary !py-1.5 text-xs" disabled={!canImport || stats.cells - stats.errors === 0} onClick={() => doImport(false)}>
                    <Upload className="h-3.5 w-3.5" /> استيراد {stats.cells - stats.errors} درجة
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="h-24" />
        </>
      )}
    </>
  );
}
