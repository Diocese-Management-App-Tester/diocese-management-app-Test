'use client';

// ---------- Exams module — shared UI bits ----------
// ExamsHeader : back arrow + title (+ optional badge / actions)
// StatusBadge : draft / published / closed pill
// ScoreRing   : small SVG percentage ring
// Toast       : bottom toast

import Link from 'next/link';
import { ArrowRight, GraduationCap } from 'lucide-react';
import { EXAM_STATUS_LABELS, EXAM_STATUS_STYLE, type ExamStatus } from '@/lib/exams';
import { APP_TZ } from '@/lib/time';
import { useNavLabel } from '@/lib/customization-context';
import InfoTip from '@/components/InfoTip';

export function ExamsHeader({
  title, badge, back = '/exams', actions, info,
}: { title?: string; badge?: React.ReactNode; back?: string; actions?: React.ReactNode; info?: React.ReactNode }) {
  const name = useNavLabel('exams');
  return (
    <section className="mb-3 flex items-center gap-2">
      <Link href={back} aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
        <ArrowRight className="h-5 w-5" />
      </Link>
      <h2 className="flex min-w-0 flex-1 items-center gap-2 text-lg font-extrabold">
        <GraduationCap className="h-5 w-5 shrink-0 text-violet-600" />
        <span className="truncate">{title ?? name}</span>
        {badge}
        {info && <InfoTip title={title ?? name}>{info}</InfoTip>}
      </h2>
      {actions}
    </section>
  );
}

export function StatusBadge({ status }: { status: ExamStatus }) {
  return <span className={`badge ${EXAM_STATUS_STYLE[status]}`}>{EXAM_STATUS_LABELS[status]}</span>;
}

/** percentage ring (0..100) */
export function ScoreRing({ percent, size = 56, stroke = 6, tone }: { percent: number; size?: number; stroke?: number; tone?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, percent));
  const color = tone ?? (p >= 100 ? '#d97706' : p >= 50 ? '#059669' : '#dc2626');
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#e2e8f0" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (c * p) / 100}
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-extrabold tabular-nums" style={{ fontSize: size * 0.26, color }}>
        {Math.round(p)}٪
      </span>
    </div>
  );
}

export function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div id="exam-toast" role="status" className="fixed inset-x-4 bottom-24 z-[70] mx-auto max-w-md rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm font-bold text-white shadow-xl">
      {msg}
    </div>
  );
}

export const fmtDateTime = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('ar-EG', { timeZone: APP_TZ, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '—';

export const fmtDuration = (fromIso: string, toIso: string | null) => {
  if (!toIso) return '—';
  const s = Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m} د ${s % 60} ث` : `${s} ث`;
};

/** scope label for an exam row */
export function scopeLabel(
  x: { church_id: string; service_id: string | null; class_id: string | null },
  churches: { id: string; name: string }[], services: { id: string; name: string }[], classes: { id: string; name: string }[]
) {
  const church = churches.find((c) => c.id === x.church_id)?.name ?? '';
  if (x.service_id === null) return `${church} ← كل الخدمات`;
  const service = services.find((s) => s.id === x.service_id)?.name ?? '';
  if (x.class_id === null) return `${church} ← ${service} ← كل الفصول`;
  const cls = classes.find((c) => c.id === x.class_id)?.name ?? '';
  return `${church} ← ${service} ← ${cls}`;
}
