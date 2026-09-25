'use client';

// ---------- Child portal — الامتحانات ----------
// The exams open for this child (published, in window, in his class scope,
// module granted) + the closed ones he already took. Each card shows the
// rules (questions, seconds per question, pass rule, points) and the
// state: ابدأ / أكمل (open attempt) / النتيجة / لا محاولات متبقية.

import { useMemo } from 'react';
import Link from 'next/link';
import {
  GraduationCap, Clock, ListChecks, Trophy, Star, Play, RotateCcw, Lock, CheckCircle2, XCircle, ChevronLeft, Timer, 
} from 'lucide-react';
import ChildShell from '@/components/child/ChildShell';
import { EmptyState, PageTitle, usePortalList, fmtDateTime } from '@/components/child/ChildBits';
import { ScoreRing } from '@/components/exams/ExamBits';
import { useChild } from '@/lib/child-context';
import { createClient } from '@/lib/supabase/client';
import { fetchChildExams, type ChildExam } from '@/lib/child-portal';
import { fmtSeconds, passLabel } from '@/lib/exams';

export default function ChildExamsPage() {
  return (
    <ChildShell>
      <ExamsContent />
    </ChildShell>
  );
}

function ExamsContent() {
  const { token, profile } = useChild();
  const supabase = useMemo(() => createClient(), []);
  const { rows, error } = usePortalList<ChildExam>(
    token ? () => fetchChildExams(supabase, token) : null,
    `exams-${token}-${profile?.enrollments.map((e) => e.points).join(',')}`
  );

  const open = (rows ?? []).filter((x) => x.is_open);
  const past = (rows ?? []).filter((x) => !x.is_open);

  return (
    <>
      <PageTitle icon={<GraduationCap className="h-5 w-5 text-violet-600" />} title="الامتحانات" info="امتحانات فصلك — كل سؤال له وقت محدد، ولا يمكن الرجوع للسؤال السابق. عند بدء الامتحان يظهر لك سؤال واحد كل مرة مع عدّاد للوقت؛ اختر إجابتك واضغط «التالي» أو ينتقل تلقائياً عند انتهاء الوقت. إذا أُغلق التطبيق يمكنك المتابعة من حيث توقفت." />

      {error && <div className="card mb-3 text-center text-sm font-bold text-red-600">{error}</div>}
      {rows === null && !error && <div className="card py-10 text-center text-sm font-bold text-slate-400">جارٍ التحميل…</div>}

      {rows && rows.length === 0 && <EmptyState text="لا توجد امتحانات متاحة لك الآن" />}

      {open.length > 0 && (
        <section className="mb-4">
          <p className="mb-2 px-1 text-xs font-extrabold text-slate-500">متاح الآن</p>
          <div className="space-y-3">{open.map((x) => <ExamCard key={x.id} exam={x} />)}</div>
        </section>
      )}
      {past.length > 0 && (
        <section>
          <p className="mb-2 px-1 text-xs font-extrabold text-slate-500">امتحانات سابقة</p>
          <div className="space-y-3">{past.map((x) => <ExamCard key={x.id} exam={x} />)}</div>
        </section>
      )}

    </>
  );
}

function ExamCard({ exam: x }: { exam: ChildExam }) {
  const r = x.last_result;
  const attemptsLeft = Math.max(0, x.max_attempts - x.attempts_used);
  const canStart = x.is_open && (x.open_attempt_id || attemptsLeft > 0) && x.total_questions > 0;
  const passed = r?.passed;

  return (
    <div id={`child-exam-${x.id}`} className="card !p-0 overflow-hidden">
      <div className={`px-4 pt-3 pb-2 ${x.is_open ? 'bg-gradient-to-l from-violet-50 to-white' : 'bg-slate-50'}`}>
        <div className="flex items-start gap-3">
          <span className={`rounded-xl p-2.5 ${x.is_open ? 'bg-violet-600 text-white' : 'bg-slate-200 text-slate-500'}`}><GraduationCap className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h3 className="font-extrabold leading-tight">{x.title}</h3>
            <p className="mt-0.5 text-[11px] font-bold text-slate-400">{x.service_name} · {x.class_name}</p>
            {x.description && <p className="mt-1.5 text-xs text-slate-600">{x.description}</p>}
          </div>
          {r && r.show_result && r.percent !== undefined && <ScoreRing percent={Number(r.percent)} size={52} stroke={5} />}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="badge bg-white ring-1 ring-slate-200"><ListChecks className="h-3 w-3" /> {x.served_questions} سؤال</span>
          <span className="badge bg-white ring-1 ring-slate-200"><Clock className="h-3 w-3" /> {fmtSeconds(x.default_seconds)} للسؤال</span>
          <span className="badge bg-white ring-1 ring-slate-200"><Trophy className="h-3 w-3" /> النجاح {passLabel(x)}</span>
          {(x.points_pass > 0 || x.points_full > 0) && (
            <span className="badge bg-gold-100 text-gold-700"><Star className="h-3 w-3" /> {x.points_pass > 0 ? `+${x.points_pass}` : ''}{x.points_full > 0 ? ` · كاملة +${x.points_full}` : ''}</span>
          )}
          {x.max_attempts > 1 && <span className="badge bg-white ring-1 ring-slate-200"><RotateCcw className="h-3 w-3" /> {attemptsLeft} من {x.max_attempts} محاولة</span>}
          {x.closes_at && x.is_open && <span className="badge bg-amber-100 text-amber-700"><Timer className="h-3 w-3" /> حتى {fmtDateTime(x.closes_at)}</span>}
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 py-3">
        {r && (
          <div className="min-w-0 flex-1 text-xs font-bold">
            {r.show_result ? (
              passed
                ? <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-4 w-4" /> {r.full_mark ? 'الدرجة الكاملة 🎉' : 'نجحت'} — {Number(r.score)} / {Number(r.max_score)}{r.points_granted ? ` · +${r.points_granted} نقطة` : ''}</span>
                : <span className="flex items-center gap-1 text-red-600"><XCircle className="h-4 w-4" /> لم تنجح — {Number(r.score)} / {Number(r.max_score)}</span>
            ) : (
              <span className="text-slate-500">أكملت الامتحان — النتيجة عند الخادم</span>
            )}
            <span className="block text-[10px] text-slate-400">{fmtDateTime(r.finished_at ?? r.started_at)}</span>
          </div>
        )}
        {!r && !x.open_attempt_id && <p className="flex-1 text-xs font-bold text-slate-500">{x.is_open ? 'لم تحل هذا الامتحان بعد' : 'غير متاح'}</p>}
        {x.open_attempt_id && <p className="flex-1 text-xs font-bold text-amber-700">لديك محاولة لم تنته — أكملها</p>}

        <div className="flex shrink-0 gap-1.5">
          {r && (
            <Link id={`child-exam-result-${x.id}`} href={`/child/exams/${x.id}?attempt=${r.attempt_id}&view=result`} className="btn-secondary flex items-center gap-1 !py-2 !px-3 text-xs">
              النتيجة <ChevronLeft className="h-3.5 w-3.5" />
            </Link>
          )}
          {canStart ? (
            <Link id={`child-exam-start-${x.id}`} href={`/child/exams/${x.id}`} className="btn-primary flex items-center gap-1 !py-2 !px-3 text-xs !from-violet-600 !to-violet-500">
              {x.open_attempt_id ? <><RotateCcw className="h-4 w-4" /> أكمل</> : r ? <><RotateCcw className="h-4 w-4" /> إعادة</> : <><Play className="h-4 w-4" /> ابدأ</>}
            </Link>
          ) : x.is_open && attemptsLeft === 0 ? (
            <span className="badge bg-slate-100 text-slate-500"><Lock className="h-3 w-3" /> لا محاولات متبقية</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
