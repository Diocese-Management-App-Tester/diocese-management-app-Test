'use client';

// ---------- Child portal — الفصول الأونلاين ----------
// Live classes first (big red «ادخل الفصل»), then upcoming (date / time /
// teacher / countdown) and recent ended ones with the child's own result
// (حاضر / غائب, presence %, checks).

import Link from 'next/link';
import {
  Video, Clock, User, Play, ChevronLeft, Radio, CalendarClock, CheckCircle2, XCircle, ShieldCheck, GraduationCap, Star,
} from 'lucide-react';
import ChildShell, { useChildOnline } from '@/components/child/ChildShell';
import { EmptyState, PageTitle, fmtDateTime, fmtTime } from '@/components/child/ChildBits';
import { PlatformBadge } from '@/components/online/OnlineBits';
import type { ChildOnlineClass } from '@/lib/child-portal';
import { fmtPercent } from '@/lib/online-classes';

export default function ChildOnlinePage() {
  return (
    <ChildShell>
      <OnlineContent />
    </ChildShell>
  );
}

function OnlineContent() {
  const { classes } = useChildOnline();
  const live = (classes ?? []).filter((c) => c.status === 'live');
  const upcoming = (classes ?? []).filter((c) => c.status === 'scheduled');
  const past = (classes ?? []).filter((c) => c.status === 'ended');

  return (
    <>
      <PageTitle icon={<Video className="h-5 w-5 text-red-600" />} title="الفصول الأونلاين" info="ادخل الفصل المباشر وأبقَ الصفحة مفتوحة — الحضور يُحسب من وقتك وردودك على فحوص الانتباه. أثناء الفصل يرسل الخادم «فحص انتباه» — نافذة تظهر لك وعليك الضغط عليها خلال المهلة. تُحسب حاضراً إذا حققت نسبة الوقت وعدد الفحوص المطلوبة." />

      {classes === null && <div className="card py-10 text-center text-sm font-bold text-slate-400">جارٍ التحميل…</div>}
      {classes && classes.length === 0 && <EmptyState text="لا توجد فصول أونلاين لك الآن" />}

      {live.length > 0 && (
        <section className="mb-4">
          <p className="mb-2 flex items-center gap-1.5 px-1 text-xs font-extrabold text-red-600"><Radio className="h-3.5 w-3.5 animate-pulse" /> مباشر الآن</p>
          <div className="space-y-3">{live.map((c) => <ClassCard key={c.id} c={c} />)}</div>
        </section>
      )}
      {upcoming.length > 0 && (
        <section className="mb-4">
          <p className="mb-2 flex items-center gap-1.5 px-1 text-xs font-extrabold text-slate-500"><CalendarClock className="h-3.5 w-3.5" /> فصول قادمة</p>
          <div className="space-y-3">{upcoming.map((c) => <ClassCard key={c.id} c={c} />)}</div>
        </section>
      )}
      {past.length > 0 && (
        <section>
          <p className="mb-2 px-1 text-xs font-extrabold text-slate-500">فصول سابقة</p>
          <div className="space-y-3">{past.map((c) => <ClassCard key={c.id} c={c} />)}</div>
        </section>
      )}

    </>
  );
}

function ClassCard({ c }: { c: ChildOnlineClass }) {
  const p = c.participant;
  const isLive = c.status === 'live';
  const ended = c.status === 'ended';
  const result = ended ? (p?.final_status ?? (p ? 'absent' : null)) : null;

  return (
    <div id={`child-oc-${c.id}`} className={`card !p-0 overflow-hidden ${isLive ? 'ring-2 ring-red-300' : ''}`}>
      <div className={`px-4 pt-3 pb-2 ${isLive ? 'bg-gradient-to-l from-red-50 to-white' : ended ? 'bg-slate-50' : 'bg-gradient-to-l from-sky-50 to-white'}`}>
        <div className="flex items-start gap-3">
          <span className={`rounded-xl p-2.5 ${isLive ? 'bg-red-600 text-white' : ended ? 'bg-slate-200 text-slate-500' : 'bg-sky-600 text-white'}`}><Video className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h3 className="font-extrabold leading-tight">{c.title}</h3>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] font-bold text-slate-500">
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {fmtDateTime(c.starts_at)} – {fmtTime(c.ends_at)}</span>
              {c.teacher_name && <span className="flex items-center gap-1"><User className="h-3 w-3" /> {c.teacher_name}</span>}
            </p>
            {c.description && <p className="mt-1.5 text-xs text-slate-600">{c.description}</p>}
          </div>
          {isLive && <span className="badge bg-red-600 text-white"><Radio className="h-3 w-3" /> مباشر</span>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <PlatformBadge platform={c.platform} />
          <span className="badge bg-white ring-1 ring-slate-200">{c.service_name} · {c.class_name}</span>
          <span className="badge bg-white ring-1 ring-slate-200"><ShieldCheck className="h-3 w-3" /> {c.min_time_percent}٪ · {c.checks_min_success}/{c.checks_required} فحوص</span>
          {c.attendance_points > 0 && <span className="badge bg-gold-100 text-gold-700"><Star className="h-3 w-3" /> +{c.attendance_points}</span>}
          {c.exam_title && <span className="badge bg-violet-100 text-violet-700"><GraduationCap className="h-3 w-3" /> امتحان</span>}
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 py-3">
        <div className="min-w-0 flex-1 text-xs font-bold">
          {isLive && (p ? <span className="text-emerald-700">أنت في الفصل — {fmtPercent(p.percent)} من الوقت · {p.checks_ok} فحص</span> : <span className="text-red-600">الفصل بدأ — ادخل الآن</span>)}
          {c.status === 'scheduled' && <span className="text-slate-500">يبدأ {fmtDateTime(c.starts_at)}</span>}
          {ended && (
            result === 'present'
              ? <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-4 w-4" /> حاضر — {fmtPercent(p?.final_percent ?? p?.percent)} · {p?.checks_ok ?? 0}/{p?.checks_total ?? 0} فحوص{c.attendance_points ? ` · +${c.attendance_points}` : ''}</span>
              : result === 'absent'
                ? <span className="flex items-center gap-1 text-red-600"><XCircle className="h-4 w-4" /> غائب — {p ? `${fmtPercent(p.final_percent ?? p.percent)} · ${p.checks_ok}/${p.checks_total} فحوص` : 'لم تدخل الفصل'}</span>
                : <span className="text-slate-400">انتهى</span>
          )}
        </div>
        <div className="flex shrink-0 gap-1.5">
          {isLive ? (
            <Link id={`child-oc-enter-${c.id}`} href={`/child/online/${c.id}`} className="btn-primary flex items-center gap-1 !py-2 !px-3 text-xs !from-red-600 !to-red-500">
              <Play className="h-4 w-4" /> {p ? 'ارجع للفصل' : 'ادخل الفصل'}
            </Link>
          ) : (
            <Link href={`/child/online/${c.id}`} className="btn-secondary flex items-center gap-1 !py-2 !px-3 text-xs">
              التفاصيل <ChevronLeft className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
