'use client';

// ---------- Student result card (كارت نتيجة المخدوم) ----------
// Exam name + date · one row per subject (score / full · % · grade · pass) ·
// totals · overall grade · PASS / FAIL · rank. Editable inline when the
// caller may write (score / status per subject) — saves through
// result_save_bulk so the DB computes everything. Printable.

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Printer, Save, UserRound, Check, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { ModalFrame, GradePill, StudentStatusBadge, Avatar, gradeOf } from '@/components/results/ResultBits';
import {
  fetchResultRows, saveBulk, validateScore, previewPercent, gradeFor, resultErrorMessage, fmtNum, fmtPct, fmtDate, rankLabel, ROW_STATUS_LABELS,
  type ResultExam, type ResultSubject, type GradingGrade, type StudentSummary, type ExamResultRow, type ResultRowStatus, type BulkRow,
} from '@/lib/results';

interface Draft { score: string; status: ResultRowStatus; dirty: boolean; error: string | null }

export default function StudentResultModal({
  exam, subjects, grades, student, canWrite, onClose, onSaved,
}: {
  exam: ResultExam; subjects: ResultSubject[]; grades: GradingGrade[]; student: StudentSummary;
  canWrite: boolean; onClose: () => void; onSaved?: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<ExamResultRow[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchResultRows(supabase, exam.id).then((all) => {
      if (!live) return;
      const mine = all.filter((r) => r.enrollment_id === student.enrollment_id);
      setRows(mine);
      const d: Record<string, Draft> = {};
      subjects.forEach((s) => {
        const r = mine.find((x) => x.subject_id === s.id);
        d[s.id] = { score: r?.score === null || r?.score === undefined ? '' : String(r.score), status: r?.status ?? 'completed', dirty: false, error: null };
      });
      setDrafts(d);
    }).catch((e) => setMsg(resultErrorMessage(e)));
    return () => { live = false; };
  }, [supabase, exam.id, student.enrollment_id, subjects]);

  const byId = useMemo(() => new Map((rows ?? []).map((r) => [r.subject_id, r])), [rows]);
  const overall = gradeOf(grades, student.grade_id);

  const setScore = (s: ResultSubject, v: string) => {
    const { error } = validateScore(v, s.full_degree);
    setDrafts((d) => ({ ...d, [s.id]: { ...d[s.id], score: v, dirty: true, error, status: d[s.id].status === 'absent' || d[s.id].status === 'excused' ? 'completed' : d[s.id].status } }));
  };
  const setStatus = (s: ResultSubject, st: ResultRowStatus) =>
    setDrafts((d) => ({ ...d, [s.id]: { ...d[s.id], status: st, dirty: true, error: st === 'absent' || st === 'excused' ? null : d[s.id].error, score: st === 'absent' || st === 'excused' ? '' : d[s.id].score } }));

  const save = async () => {
    const payload: BulkRow[] = [];
    for (const s of subjects) {
      const d = drafts[s.id];
      if (!d?.dirty) continue;
      if (d.error) { setMsg('صحّح الدرجات غير الصالحة أولاً'); return; }
      const absent = d.status === 'absent' || d.status === 'excused';
      if (!absent && d.score.trim() === '') continue;
      payload.push({ subject_id: s.id, enrollment_id: student.enrollment_id, score: absent ? null : validateScore(d.score, s.full_degree).value, status: d.status });
    }
    if (payload.length === 0) { setEditing(false); return; }
    setSaving(true); setMsg(null);
    try {
      const out = await saveBulk(supabase, exam.id, payload);
      const failed = out.filter((o) => !o.ok);
      if (failed.length) setMsg(resultErrorMessage(failed[0].error, 'تعذر حفظ بعض الدرجات'));
      else { setMsg('تم الحفظ'); setEditing(false); }
      const all = await fetchResultRows(supabase, exam.id);
      setRows(all.filter((r) => r.enrollment_id === student.enrollment_id));
      setDrafts((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, { ...v, dirty: false }])));
      onSaved?.();
    } catch (e) { setMsg(resultErrorMessage(e)); }
    finally { setSaving(false); }
  };

  const print = () => {
    const w = window.open('', '_blank', 'width=720,height=900');
    if (!w) return;
    const lines = subjects.map((s) => {
      const r = byId.get(s.id);
      const g = gradeOf(grades, r?.grade_id);
      const sc = r ? (r.status === 'absent' || r.status === 'excused' ? ROW_STATUS_LABELS[r.status] : `${fmtNum(r.score)} / ${fmtNum(s.full_degree)}`) : '—';
      return `<tr><td>${s.name}</td><td>${sc}</td><td>${r ? fmtPct(r.percent) : '—'}</td><td>${g?.name ?? '—'}</td><td>${r?.passed === null || !r ? '—' : r.passed ? 'ناجح' : 'لم ينجح'}</td></tr>`;
    }).join('');
    w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${student.name}</title>
<style>body{font-family:system-ui,Tahoma;padding:24px;color:#0f172a}h1{font-size:22px;margin:0}h2{font-size:16px;color:#475569;margin:4px 0 16px}table{width:100%;border-collapse:collapse;font-size:14px}th,td{border:1px solid #cbd5e1;padding:8px;text-align:center}th{background:#f1f5f9}.tot{margin-top:16px;display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.tot div{border:1px solid #cbd5e1;border-radius:12px;padding:10px;text-align:center}.tot b{display:block;font-size:20px}.res{font-size:26px;font-weight:900;color:${student.passed ? '#059669' : '#dc2626'}}</style></head><body>
<h1>${student.name} <small style="font-size:13px;color:#64748b">(${student.national_id})</small></h1><h2>${exam.name} · ${fmtDate(exam.exam_date)}</h2>
<table><thead><tr><th>المادة</th><th>الدرجة</th><th>النسبة</th><th>التقدير</th><th>النتيجة</th></tr></thead><tbody>${lines}</tbody></table>
<div class="tot"><div>المجموع<b>${fmtNum(student.total_score)} / ${fmtNum(student.total_full)}</b></div><div>النسبة<b>${fmtPct(student.percent)}</b></div><div>التقدير<b>${overall?.name ?? '—'}</b></div><div>الترتيب<b>${rankLabel(student.rank)}</b></div></div>
<p class="res" style="text-align:center;margin-top:18px">${student.passed === null ? '' : student.passed ? 'ناجح ✓' : 'لم ينجح ✗'}</p>
<script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  };

  return (
    <ModalFrame title="نتيجة المخدوم" icon={<UserRound className="h-5 w-5 text-emerald-600" />} onClose={onClose} wide>
      <div className="mb-3 flex items-center gap-3">
        <Avatar name={student.name} url={student.image_url} size={52} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-extrabold">{student.name}</p>
          <p className="text-[11px] font-bold text-slate-400" dir="ltr">{student.national_id}</p>
          <p className="truncate text-xs font-bold text-slate-500">{exam.name} · {fmtDate(exam.exam_date)}</p>
        </div>
        <StudentStatusBadge status={student.status} />
      </div>

      {rows === null ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-emerald-500" /></div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-100">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] font-extrabold text-slate-500">
              <tr><th className="px-2 py-2 text-start">المادة</th><th className="px-2 py-2">الدرجة</th><th className="px-2 py-2">النسبة</th><th className="px-2 py-2">التقدير</th><th className="px-2 py-2">النتيجة</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {subjects.map((s) => {
                const r = byId.get(s.id);
                const d = drafts[s.id];
                const absent = d && (d.status === 'absent' || d.status === 'excused');
                const livePct = editing && d && !absent ? previewPercent(validateScore(d.score, s.full_degree).value, s.full_degree) : r?.percent ?? null;
                const liveGrade = editing && d ? (exam.grade_subject ? gradeFor(grades, exam.grading_system_id, livePct) : null) : gradeOf(grades, r?.grade_id);
                const passed = editing && d
                  ? (absent || d.score === '' ? null : (validateScore(d.score, s.full_degree).value ?? -1) >= s.pass_degree)
                  : r?.passed ?? null;
                return (
                  <tr key={s.id} className={s.is_bonus ? 'bg-amber-50/40' : ''}>
                    <td className="px-2 py-2 font-bold">{s.name}{s.is_bonus && <span className="mr-1 text-[10px] text-amber-600">إضافي</span>}<span className="block text-[10px] font-bold text-slate-400">نجاح {fmtNum(s.pass_degree)} / {fmtNum(s.full_degree)}</span></td>
                    <td className="px-2 py-2 text-center tabular-nums">
                      {editing && d ? (
                        <div className="flex flex-col items-center gap-1">
                          <input id={`sr-score-${s.id}`} inputMode="decimal" disabled={absent} value={d.score} onChange={(e) => setScore(s, e.target.value)}
                            className={`w-20 rounded-lg border px-2 py-1.5 text-center font-extrabold outline-none ${d.error ? 'border-red-400 bg-red-50 text-red-600' : 'border-slate-200 focus:border-emerald-400'}`} />
                          <select value={d.status} onChange={(e) => setStatus(s, e.target.value as ResultRowStatus)} className="rounded-lg border border-slate-200 px-1 py-0.5 text-[10px] font-bold">
                            {(Object.keys(ROW_STATUS_LABELS) as ResultRowStatus[]).map((k) => <option key={k} value={k}>{ROW_STATUS_LABELS[k]}</option>)}
                          </select>
                          {d.error && <span className="text-[10px] font-bold text-red-500">{d.error}</span>}
                        </div>
                      ) : r ? (
                        r.status === 'absent' || r.status === 'excused'
                          ? <span className="badge bg-slate-200 text-slate-600">{ROW_STATUS_LABELS[r.status]}</span>
                          : <span className="font-extrabold">{fmtNum(r.score)}<span className="text-slate-400"> / {fmtNum(s.full_degree)}</span>{r.status === 'draft' && <span className="mr-1 text-[10px] text-violet-600">مسودة</span>}</span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-2 py-2 text-center tabular-nums font-bold">{fmtPct(livePct)}</td>
                    <td className="px-2 py-2 text-center"><GradePill name={liveGrade?.name} color={liveGrade?.color} /></td>
                    <td className="px-2 py-2 text-center">
                      {passed === null ? <span className="text-slate-300">—</span>
                        : passed ? <Check className="mx-auto h-4 w-4 text-emerald-600" /> : <X className="mx-auto h-4 w-4 text-red-500" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 grid grid-cols-4 gap-2">
        <div className="card !p-2 text-center"><p className="text-[10px] font-bold text-slate-400">المجموع</p><p className="font-extrabold tabular-nums">{fmtNum(student.total_score)} <span className="text-slate-400">/ {fmtNum(student.total_full)}</span></p></div>
        <div className="card !p-2 text-center"><p className="text-[10px] font-bold text-slate-400">النسبة</p><p className="font-extrabold tabular-nums">{fmtPct(student.percent)}</p></div>
        <div className="card !p-2 text-center"><p className="text-[10px] font-bold text-slate-400">التقدير الكلي</p><GradePill name={overall?.name} color={overall?.color} /></div>
        <div className="card !p-2 text-center"><p className="text-[10px] font-bold text-slate-400">الترتيب</p><p className="font-extrabold tabular-nums">{rankLabel(student.rank)}</p></div>
      </div>
      <p className={`mt-3 text-center text-xl font-extrabold ${student.passed === null ? 'text-slate-400' : student.passed ? 'text-emerald-600' : 'text-red-600'}`}>
        {student.passed === null ? 'النتيجة غير مكتملة' : student.passed ? 'ناجح ✓' : 'لم ينجح ✗'}
      </p>

      {msg && <p className="mt-2 rounded-xl bg-slate-100 px-3 py-2 text-center text-xs font-bold text-slate-700">{msg}</p>}

      <div className="mt-4 flex gap-2">
        <button type="button" onClick={print} className="btn-secondary flex items-center gap-1 !py-2.5 !border-slate-200 !text-slate-700"><Printer className="h-4 w-4" /> طباعة</button>
        {canWrite && !exam.locked && (editing ? (
          <button id="sr-save" type="button" disabled={saving} onClick={save} className="btn-primary flex flex-1 items-center justify-center gap-1.5 !py-2.5 !from-emerald-600 !to-emerald-500">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} حفظ الدرجات
          </button>
        ) : (
          <button id="sr-edit" type="button" onClick={() => setEditing(true)} className="btn-primary flex-1 !py-2.5 !from-emerald-600 !to-emerald-500">تعديل الدرجات</button>
        ))}
        {canWrite && exam.locked && <p className="flex-1 self-center text-center text-xs font-bold text-slate-500">🔒 النتائج مقفلة</p>}
      </div>
    </ModalFrame>
  );
}
