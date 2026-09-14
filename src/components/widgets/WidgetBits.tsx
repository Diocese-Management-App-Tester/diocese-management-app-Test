'use client';

// ---------- Shared bits for the home-page widgets ----------
//   WidgetCard     — consistent card with a colored icon header (+ link)
//   WidgetEmpty    — friendly empty state
//   WidgetSkeleton — loading shimmer
//   Avatar         — small round picture / placeholder

import Link from 'next/link';
import Image from 'next/image';
import { ChevronLeft, User, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export type WidgetTone = 'primary' | 'emerald' | 'gold' | 'sky' | 'violet' | 'rose' | 'teal' | 'orange' | 'red' | 'pink' | 'cyan' | 'indigo' | 'amber' | 'slate';

const TONES: Record<WidgetTone, string> = {
  primary: 'bg-primary-100 text-primary-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  gold: 'bg-gold-100 text-gold-700',
  sky: 'bg-sky-100 text-sky-700',
  violet: 'bg-violet-100 text-violet-700',
  rose: 'bg-rose-100 text-rose-700',
  teal: 'bg-teal-100 text-teal-700',
  orange: 'bg-orange-100 text-orange-700',
  red: 'bg-red-100 text-red-700',
  pink: 'bg-pink-100 text-pink-700',
  cyan: 'bg-cyan-100 text-cyan-700',
  indigo: 'bg-indigo-100 text-indigo-700',
  amber: 'bg-amber-100 text-amber-700',
  slate: 'bg-slate-100 text-slate-600',
};

export function WidgetCard({
  id, icon: Icon, title, subtitle, tone = 'primary', href, badge, actions, children, className = '', flush = false,
}: {
  id: string;
  icon: LucideIcon;
  title?: string;
  subtitle?: string;
  tone?: WidgetTone;
  href?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  const head = (
    <>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${TONES[tone]}`}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-extrabold text-slate-800">{title}</span>
        {subtitle && <span className="block truncate text-[11px] font-bold text-slate-400">{subtitle}</span>}
      </span>
      {badge}
      {actions}
      {href && <ChevronLeft className="h-4 w-4 shrink-0 text-slate-300" />}
    </>
  );
  return (
    <section id={id} className={`card !p-0 overflow-hidden ${className}`}>
      {title && (href ? (
        <Link href={href} className="flex items-center gap-2.5 border-b border-slate-100 px-3.5 py-2.5 transition hover:bg-slate-50/70">
          {head}
        </Link>
      ) : (
        <header className="flex items-center gap-2.5 border-b border-slate-100 px-3.5 py-2.5">{head}</header>
      ))}
      <div className={flush ? '' : 'p-3.5'}>{children}</div>
    </section>
  );
}

export function WidgetEmpty({ icon: Icon, text, hint }: { icon: LucideIcon; text: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-5 text-center">
      <Icon className="mb-1.5 h-7 w-7 text-slate-200" />
      <p className="text-xs font-extrabold text-slate-400">{text}</p>
      {hint && <p className="mt-0.5 px-3 text-[11px] font-bold text-slate-300">{hint}</p>}
    </div>
  );
}

export function WidgetSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-8 animate-pulse rounded-xl bg-slate-100" style={{ width: `${92 - i * 14}%` }} />
      ))}
    </div>
  );
}

export function Avatar({ url, name, size = 36, className = '' }: { url: string | null | undefined; name: string; size?: number; className?: string }) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-slate-300 ring-2 ring-white ${className}`}
      style={{ width: size, height: size }}
    >
      {url ? (
        <Image src={url} alt={name} fill sizes={`${size}px`} className="object-cover" />
      ) : (
        <User style={{ width: size * 0.5, height: size * 0.5 }} />
      )}
    </span>
  );
}

export const fmtNum = (n: number) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(n);

export function fmtTimeShort(iso: string): string {
  return new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function fmtDayShort(iso: string): string {
  return new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
}

export function fmtRelative(iso: string, now = new Date()): string {
  const diff = Math.round((new Date(iso).getTime() - now.getTime()) / 60000);
  const abs = Math.abs(diff);
  const w = (s: string) => (diff < 0 ? `منذ ${s}` : `بعد ${s}`);
  if (abs < 1) return 'الآن';
  if (abs < 60) return w(`${fmtNum(abs)} د`);
  if (abs < 60 * 24) return w(`${fmtNum(Math.round(abs / 60))} س`);
  return w(`${fmtNum(Math.round(abs / (60 * 24)))} يوم`);
}

/** «٣ س ٢٠ د» / «٢ يوم» */
export function fmtDur(min: number): string {
  if (min < 60) return `${fmtNum(min)} د`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 24) return m ? `${fmtNum(h)} س ${fmtNum(m)} د` : `${fmtNum(h)} س`;
  const d = Math.floor(h / 24);
  return `${fmtNum(d)} يوم${h % 24 ? ` ${fmtNum(h % 24)} س` : ''}`;
}

/** Full Arabic weekday + day + month for a 'YYYY-MM-DD' day. */
export function fmtYmdLong(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('ar-EG', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(Date.UTC(y, m - 1, d)));
}
