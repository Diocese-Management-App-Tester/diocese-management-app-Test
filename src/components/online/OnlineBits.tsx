'use client';

// ---------- Online classes module — shared UI bits ----------
// OnlineHeader  : back arrow + title (+ badge / actions)
// StatusBadge   : scheduled / live / ended / cancelled pill (live pulses)
// PlatformBadge : YouTube / Facebook / Zoom / Meet / other
// StreamPlayer  : iframe embed (YouTube / Facebook) or an «open stream» card
// Toast, fmtDateTime, fmtTime, scopeLabel

import Link from 'next/link';
import { ArrowRight, Video, ExternalLink, Radio } from 'lucide-react';
import {
  CLASS_STATUS_LABELS, CLASS_STATUS_STYLE, PLATFORM_LABELS, streamEmbed,
  type OnlineClassStatus, type StreamPlatform,
} from '@/lib/online-classes';
import { APP_TZ } from '@/lib/time';
import { useNavLabel } from '@/lib/customization-context';
import InfoTip from '@/components/InfoTip';

export function OnlineHeader({
  title, badge, back = '/online', actions, sub, info,
}: { title?: string; badge?: React.ReactNode; back?: string; actions?: React.ReactNode; sub?: string; info?: React.ReactNode }) {
  const name = useNavLabel('online');
  return (
    <section className="mb-3 flex items-center gap-2">
      <Link href={back} aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
        <ArrowRight className="h-5 w-5" />
      </Link>
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-2 text-lg font-extrabold leading-tight">
          <Video className="h-5 w-5 shrink-0 text-red-600" />
          <span className="truncate">{title ?? name}</span>
          {badge}
          {info && <InfoTip title={title ?? name}>{info}</InfoTip>}
        </h2>
        {sub && <p className="truncate text-[11px] font-bold text-slate-400">{sub}</p>}
      </div>
      {actions}
    </section>
  );
}

export function StatusBadge({ status, size = 'sm' }: { status: OnlineClassStatus; size?: 'sm' | 'lg' }) {
  return (
    <span className={`badge ${CLASS_STATUS_STYLE[status]} ${size === 'lg' ? '!px-3 !py-1 !text-xs' : ''}`}>
      {status === 'live' && <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-red-600" /></span>}
      {CLASS_STATUS_LABELS[status]}
    </span>
  );
}

const PLATFORM_STYLE: Record<StreamPlatform, string> = {
  youtube: 'bg-red-50 text-red-700 ring-red-100',
  facebook: 'bg-blue-50 text-blue-700 ring-blue-100',
  zoom: 'bg-sky-50 text-sky-700 ring-sky-100',
  meet: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  other: 'bg-slate-100 text-slate-600 ring-slate-200',
};
export function PlatformBadge({ platform }: { platform: StreamPlatform }) {
  return <span className={`badge ring-1 ${PLATFORM_STYLE[platform]}`}><Radio className="h-3 w-3" /> {PLATFORM_LABELS[platform]}</span>;
}

/**
 * The video area. `compact` → 16:9 box that fits the servant control room;
 * the child room uses the full width. Zoom / Meet / channel links can't be
 * iframed → a card with a big open button (target=_blank keeps our tab —
 * and the heartbeat — alive).
 */
export function StreamPlayer({ platform, url, title, muted = false }: { platform: StreamPlatform; url: string | null; title: string; muted?: boolean }) {
  const embed = streamEmbed(platform, url);
  if (!embed) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-2xl bg-slate-900 text-center text-slate-400">
        <div>
          <Video className="mx-auto mb-2 h-10 w-10 opacity-60" />
          <p className="text-sm font-bold">لم يُضَف رابط البث بعد</p>
        </div>
      </div>
    );
  }
  if (embed.kind === 'iframe') {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black shadow-lg">
        <iframe
          id="stream-player"
          src={muted ? `${embed.src}&mute=1` : embed.src}
          title={title}
          className="absolute inset-0 h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    );
  }
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-700 p-4 text-center text-white shadow-lg">
      <Video className="h-12 w-12 text-red-400" />
      <p className="text-sm font-extrabold">البث على {embed.label} يُفتح في تطبيقه</p>
      <p className="max-w-xs text-[11px] font-bold text-slate-300">افتح البث ثم ارجع لهذه الصفحة وأبقها مفتوحة — الحضور يُحسب من هنا (فحوص الانتباه تظهر هنا)</p>
      <a id="stream-open" href={embed.src} target="_blank" rel="noopener noreferrer" className="btn-primary flex items-center gap-2 !from-red-600 !to-red-500 !px-5">
        <ExternalLink className="h-4 w-4" /> افتح البث
      </a>
    </div>
  );
}

export function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div id="online-toast" role="status" className="fixed inset-x-4 bottom-24 z-[70] mx-auto max-w-md rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm font-bold text-white shadow-xl">
      {msg}
    </div>
  );
}

export const fmtDateTime = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('ar-EG', { timeZone: APP_TZ, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '—';
export const fmtTime = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('ar-EG', { timeZone: APP_TZ, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)) : '—';
export const fmtDate = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('ar-EG', { timeZone: APP_TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso)) : '—';

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

/** live countdown / elapsed text, ticks from the caller */
export function elapsedLabel(fromIso: string | null, now: Date): string {
  if (!fromIso) return '—';
  const s = Math.max(0, Math.round((now.getTime() - new Date(fromIso).getTime()) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`;
}
