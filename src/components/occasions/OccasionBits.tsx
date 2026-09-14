'use client';

// ---------- Occasions — shared UI bits (leader + child portal) ----------
// OccasionsHeader : back arrow + title + badge
// OccasionCover   : picture (or kind emoji placeholder) with a status ribbon
// OccasionCard    : the board card — cover · title · date · place · seats
// RegStatusBadge  : pending / confirmed / checked_in / cancelled pill
// TicketCard      : the electronic ticket (QR of the ticket code)
// StatsRow        : registered · confirmed · checked-in · cancelled · remaining
// Toast           : bottom toast

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import QRCode from 'qrcode';
import {
  ArrowRight, Tent, CalendarDays, Clock, MapPin, Users, User, Ticket, CheckCircle2, Hourglass, XCircle, Armchair,
  Star, Phone, ExternalLink, Sparkles,
} from 'lucide-react';
import type { Church, Service, ClassRoom } from '@/lib/types';
import {
  KIND_EMOJI, KIND_LABELS, OCCASION_STATUS_LABELS, REG_STATUS_LABELS, REG_STATUS_STYLE, PHASE_LABELS,
  occasionPhase, fmtDateShort, fmtTime, fmtWhen, relativeDay, remainingSeats,
  type Occasion, type OccasionCounts, type RegistrationStatus, type OccasionKind, type OccasionStatus,
} from '@/lib/occasions';
import { useNavLabel } from '@/lib/customization-context';

export function OccasionsHeader({ title, badge, back = '/settings', action }: { title?: string; badge?: ReactNode; back?: string; action?: ReactNode }) {
  const name = useNavLabel('occasions');
  return (
    <section className="mb-3 flex items-center gap-2">
      <Link href={back} aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
        <ArrowRight className="h-5 w-5" />
      </Link>
      <h2 className="flex min-w-0 flex-1 items-center gap-2 text-lg font-extrabold">
        <Tent className="h-5 w-5 shrink-0 text-cyan-600" />
        <span className="shrink-0">{name}</span>
        {title && <span className="truncate text-sm font-bold text-slate-400">· {title}</span>}
        {badge}
      </h2>
      {action}
    </section>
  );
}

/** Cover picture or a soft gradient with the kind emoji. */
export function OccasionCover({ url, title, kind, className = '', children }: {
  url: string | null; title: string; kind: OccasionKind; className?: string; children?: ReactNode;
}) {
  return (
    <div className={`relative overflow-hidden bg-gradient-to-br from-cyan-500 to-primary-600 ${className}`}>
      {url ? (
        <Image src={url} alt={title} fill sizes="(max-width: 768px) 100vw, 640px" className="object-cover" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-5xl opacity-80 drop-shadow">{KIND_EMOJI[kind]}</span>
      )}
      {children}
    </div>
  );
}

export function KindBadge({ kind }: { kind: OccasionKind }) {
  return <span className="badge bg-white/90 text-slate-700 shadow-sm">{KIND_EMOJI[kind]} {KIND_LABELS[kind]}</span>;
}

export function OccasionStatusBadge({ status, o }: { status: OccasionStatus; o?: Pick<Occasion, 'starts_at' | 'ends_at'> }) {
  if (status === 'published' && o) {
    const ph = occasionPhase(o);
    const cls = ph === 'ongoing' ? 'bg-emerald-500 text-white' : ph === 'past' ? 'bg-slate-500 text-white' : 'bg-cyan-600 text-white';
    return <span className={`badge ${cls}`}>{ph === 'ongoing' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />}{PHASE_LABELS[ph]}</span>;
  }
  const cls = status === 'draft' ? 'bg-amber-500 text-white' : status === 'cancelled' ? 'bg-red-500 text-white' : 'bg-slate-500 text-white';
  return <span className={`badge ${cls}`}>{OCCASION_STATUS_LABELS[status]}</span>;
}

export function RegStatusIcon({ status, className = 'h-3 w-3' }: { status: RegistrationStatus; className?: string }) {
  const Icon = status === 'pending' ? Hourglass : status === 'confirmed' ? Ticket : status === 'checked_in' ? CheckCircle2 : XCircle;
  return <Icon className={className} />;
}

export function RegStatusBadge({ status, className = '' }: { status: RegistrationStatus; className?: string }) {
  return (
    <span className={`badge ${REG_STATUS_STYLE[status]} ${className}`}>
      <RegStatusIcon status={status} /> {REG_STATUS_LABELS[status]}
    </span>
  );
}

/** «١٢ سبتمبر · ٩:٠٠ ص → ٥:٠٠ م» */
export function whenLabel(o: { starts_at: string; ends_at: string | null }): string {
  const s = `${fmtDateShort(o.starts_at)} · ${fmtTime(o.starts_at)}`;
  if (!o.ends_at) return s;
  const sameDay = fmtDateShort(o.starts_at) === fmtDateShort(o.ends_at);
  return sameDay ? `${s} → ${fmtTime(o.ends_at)}` : `${s} → ${fmtDateShort(o.ends_at)} · ${fmtTime(o.ends_at)}`;
}

/** Board card (leader board + child board share the look). */
export function OccasionCard({ o, href, counts, right, footer, id }: {
  o: Pick<Occasion, 'id' | 'title' | 'image_url' | 'kind' | 'starts_at' | 'ends_at' | 'location' | 'organizer' | 'capacity' | 'registration_deadline' | 'status' | 'description'>;
  href: string; counts?: { active: number } | null; right?: ReactNode; footer?: ReactNode; id?: string;
}) {
  const remaining = counts ? remainingSeats(o, counts.active) : null;
  const ph = occasionPhase(o);
  return (
    <Link id={id} href={href} className={`card block overflow-hidden !p-0 transition hover:shadow-lg ${o.status !== 'published' || ph === 'past' ? 'opacity-80' : ''}`}>
      <OccasionCover url={o.image_url} title={o.title} kind={o.kind} className="h-32 w-full">
        <div className="absolute inset-x-0 top-0 flex items-start justify-between p-2">
          <KindBadge kind={o.kind} />
          <OccasionStatusBadge status={o.status} o={o} />
        </div>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6 text-white">
          <p className="truncate text-base font-extrabold drop-shadow">{o.title}</p>
        </div>
      </OccasionCover>
      <div className="space-y-1 px-3 py-2.5 text-xs font-bold text-slate-600">
        <p className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 shrink-0 text-cyan-600" /> <span className="truncate">{whenLabel(o)}</span>
          {ph === 'upcoming' && <span className="mr-auto shrink-0 rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] text-cyan-700">{relativeDay(o.starts_at)}</span>}
        </p>
        {o.location && <p className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 shrink-0 text-rose-500" /> <span className="truncate">{o.location}</span></p>}
        {o.organizer && <p className="flex items-center gap-1.5"><User className="h-3.5 w-3.5 shrink-0 text-violet-500" /> <span className="truncate">{o.organizer}</span></p>}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {counts && (
            <span className="badge bg-primary-50 text-primary-700"><Users className="h-3 w-3" /> {counts.active} مشارك</span>
          )}
          {o.capacity !== null && (
            <span className={`badge ${remaining === 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
              <Armchair className="h-3 w-3" /> {remaining === null ? `${o.capacity} مقعد` : remaining === 0 ? 'اكتمل العدد' : `${remaining} متاح من ${o.capacity}`}
            </span>
          )}
          {o.registration_deadline && ph === 'upcoming' && (
            <span className={`badge ${new Date(o.registration_deadline) < new Date() ? 'bg-slate-200 text-slate-600' : 'bg-amber-50 text-amber-700'}`}>
              <Clock className="h-3 w-3" /> {new Date(o.registration_deadline) < new Date() ? 'انتهى التسجيل' : `التسجيل حتى ${fmtDateShort(o.registration_deadline)}`}
            </span>
          )}
          {right}
        </div>
        {footer}
      </div>
    </Link>
  );
}

/** Details block: date · time · place (map link) · organizer (call) · deadline · seats */
export function OccasionInfoList({ o, remaining, active }: {
  o: Pick<Occasion, 'starts_at' | 'ends_at' | 'location' | 'location_url' | 'organizer' | 'organizer_phone' | 'registration_deadline' | 'capacity' | 'checkin_points'>;
  remaining: number | null; active?: number;
}) {
  const Row = ({ icon, label, value, action }: { icon: ReactNode; label: string; value: ReactNode; action?: ReactNode }) => (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span className="rounded-xl bg-slate-50 p-2 text-slate-500">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-bold text-slate-400">{label}</span>
        <span className="block truncate text-sm font-extrabold text-slate-700">{value}</span>
      </span>
      {action}
    </div>
  );
  return (
    <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
      <Row icon={<CalendarDays className="h-5 w-5 text-cyan-600" />} label="الموعد" value={<>{fmtWhen(o.starts_at)}{o.ends_at && <span className="text-slate-400"> → {fmtDateShort(o.ends_at) === fmtDateShort(o.starts_at) ? fmtTime(o.ends_at) : fmtWhen(o.ends_at)}</span>}</>} />
      {o.location && (
        <Row icon={<MapPin className="h-5 w-5 text-rose-500" />} label="المكان" value={o.location}
          action={o.location_url ? <a href={o.location_url} target="_blank" rel="noreferrer" className="rounded-full bg-rose-50 p-2 text-rose-600" aria-label="افتح الخريطة"><ExternalLink className="h-4 w-4" /></a> : undefined} />
      )}
      {o.organizer && (
        <Row icon={<User className="h-5 w-5 text-violet-500" />} label="المنظّم" value={o.organizer}
          action={o.organizer_phone ? <a href={`tel:${o.organizer_phone}`} className="rounded-full bg-emerald-50 p-2 text-emerald-600" aria-label="اتصال"><Phone className="h-4 w-4" /></a> : undefined} />
      )}
      {o.registration_deadline && <Row icon={<Clock className="h-5 w-5 text-amber-500" />} label="آخر موعد للتسجيل" value={fmtWhen(o.registration_deadline)} />}
      <Row icon={<Armchair className="h-5 w-5 text-emerald-600" />} label="الأماكن"
        value={o.capacity === null ? `غير محدود${active !== undefined ? ` · ${active} مشارك` : ''}` : remaining === 0 ? `اكتمل العدد (${o.capacity})` : `${remaining ?? o.capacity} متاح من ${o.capacity}`} />
      {o.checkin_points > 0 && <Row icon={<Star className="h-5 w-5 text-gold-500" />} label="نقاط الحضور" value={`+${o.checkin_points} نقطة عند تسجيل الدخول`} />}
    </div>
  );
}

/** Dashboard counters. */
export function StatsRow({ counts, capacity, id }: { counts: Omit<OccasionCounts, 'occasion_id'>; capacity: number | null; id?: string }) {
  const remaining = capacity === null ? null : Math.max(capacity - counts.active, 0);
  const cells: { label: string; value: string | number; cls: string }[] = [
    { label: 'مسجّل', value: counts.active, cls: 'text-primary-600' },
    { label: 'قيد المراجعة', value: counts.pending, cls: 'text-amber-600' },
    { label: 'مؤكد', value: counts.confirmed, cls: 'text-emerald-600' },
    { label: 'سجّل الدخول', value: counts.checked_in, cls: 'text-cyan-600' },
    { label: 'ملغي', value: counts.cancelled, cls: 'text-slate-500' },
    { label: 'متاح', value: remaining === null ? '∞' : remaining, cls: remaining === 0 ? 'text-red-600' : 'text-teal-600' },
  ];
  return (
    <section id={id} className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
      {cells.map((c) => (
        <div key={c.label} className="card !p-2 text-center">
          <p className={`text-lg font-extrabold tabular-nums ${c.cls}`}>{c.value}</p>
          <p className="text-[10px] font-bold text-slate-400">{c.label}</p>
        </div>
      ))}
    </section>
  );
}

/** Hook: QR data-url for a code (null → ''). */
export function useQrDataUrl(code: string | null | undefined, size = 512): string {
  const [qr, setQr] = useState('');
  useEffect(() => {
    if (!code) { setQr(''); return; }
    QRCode.toDataURL(code, { margin: 1, width: size, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(''));
  }, [code, size]);
  return qr;
}

/** Electronic ticket — QR of the ticket code + name + occasion. */
export function TicketCard({ code, personName, title, when, place, status, className = '', id }: {
  code: string; personName: string; title: string; when: string; place?: string | null; status: RegistrationStatus; className?: string; id?: string;
}) {
  const [qr, setQr] = useState('');
  useEffect(() => {
    QRCode.toDataURL(code, { margin: 1, width: 512, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(''));
  }, [code]);
  const checked = status === 'checked_in';
  return (
    <div id={id} className={`overflow-hidden rounded-3xl bg-white shadow-card ring-1 ring-cyan-100 ${className}`}>
      <div className="bg-gradient-to-l from-cyan-600 to-primary-600 px-4 py-3 text-white">
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-cyan-100"><Ticket className="h-3.5 w-3.5" /> تذكرة إلكترونية</p>
        <p className="truncate text-lg font-extrabold">{title}</p>
        <p className="truncate text-xs text-cyan-100">{when}{place ? ` · ${place}` : ''}</p>
      </div>
      <div className="relative flex flex-col items-center px-4 pb-4 pt-4">
        <span className="absolute -top-3 right-0 h-6 w-6 -translate-x-1/2 rounded-full bg-slate-50 ring-1 ring-cyan-100" aria-hidden />
        <span className="absolute -top-3 left-0 h-6 w-6 translate-x-1/2 rounded-full bg-slate-50 ring-1 ring-cyan-100" aria-hidden />
        <div className={`relative h-52 w-52 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-100 ${checked ? 'opacity-60' : ''}`}>
          {qr ? <Image src={qr} alt="QR التذكرة" fill sizes="208px" className="object-contain" unoptimized /> : <Ticket className="absolute inset-0 m-auto h-10 w-10 text-slate-200" />}
          {checked && (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="rotate-[-12deg] rounded-xl border-4 border-emerald-500 bg-white/90 px-3 py-1 text-lg font-extrabold text-emerald-600">تم الدخول ✓</span>
            </span>
          )}
        </div>
        <p className="mt-3 font-mono text-base font-extrabold tracking-widest text-slate-700" dir="ltr">{code}</p>
        <p className="mt-1 truncate text-sm font-extrabold text-slate-800">{personName}</p>
        <RegStatusBadge status={status} className="mt-2" />
        {!checked && <p className="mt-2 flex items-center gap-1 text-[11px] font-bold text-slate-400"><Sparkles className="h-3 w-3" /> اعرض هذا الكود للخادم عند الدخول</p>}
      </div>
    </div>
  );
}

/** «كنيسة ← خدمة ← فصل» */
export function scopeLabel(
  a: Pick<Occasion, 'church_id' | 'service_id' | 'class_id'>,
  churches: Church[], services: Service[], classes: ClassRoom[]
) {
  const church = churches.find((c) => c.id === a.church_id)?.name ?? '';
  if (a.service_id === null) return `${church} ← كل الخدمات`;
  const service = services.find((x) => x.id === a.service_id)?.name ?? '';
  if (a.class_id === null) return `${church} ← ${service} ← كل الفصول`;
  return `${church} ← ${service} ← ${classes.find((c) => c.id === a.class_id)?.name ?? ''}`;
}

export function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div id="occasions-toast" role="status" className="fixed inset-x-4 bottom-24 z-[70] mx-auto max-w-md rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm font-bold text-white shadow-xl">
      {msg}
    </div>
  );
}

/** Person avatar (participants list / check-in result). */
export function PersonAvatar({ url, name, size = 44 }: { url: string | null; name: string; size?: number }) {
  return (
    <div className="relative shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-primary-600 to-accent-600 text-white ring-1 ring-primary-100" style={{ width: size, height: size }}>
      {url ? <Image src={url} alt={name} fill sizes={`${size}px`} className="object-cover" /> : <User className="absolute inset-0 m-auto" style={{ width: size * 0.5, height: size * 0.5 }} />}
    </div>
  );
}
