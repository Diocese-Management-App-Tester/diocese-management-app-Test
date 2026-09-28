'use client';

// ---------- Shared pieces for المعترفين / الافتقاد ----------
//   DaysBadge       — «منذ N يومًا» since the last confession (red when overdue)
//   ContactButtons  — tel: / wa.me / sms: open the app AND log the contact
//   ConfessorCard   — photo · name · places · badges · contact buttons
//   AppointmentRow  — one appointment with approve / move / reject / done
//   (the details sheet lives in ConfessorModal.tsx)

import { useState } from 'react';
import { Phone, MessageSquare, StickyNote, AlertTriangle, MapPin, Clock, Check, XCircle, Ban, CheckCircle2, CalendarPlus, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { usePriest } from '@/lib/priest-context';
import {
  type Confessor, type ContactKind, type Appointment,
  CONTACT_KIND_LABELS, APPOINTMENT_STATUS_LABELS, logContact, decideAppointment, waNumber, todayYmd, shortTime, daysLabel, priestErrorMessage,
} from '@/lib/priest-portal';
import { PersonPhoto } from '@/components/priest/PriestShell';
import { fmtDay, fmtDateTime } from '@/components/child/ChildBits';

export function WhatsAppIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M17.5 14.4c-.3-.1-1.8-.9-2-1s-.5-.1-.7.1-.8 1-.9 1.2-.3.2-.6.1a7.4 7.4 0 0 1-3.6-3.2c-.3-.5.3-.4.8-1.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4s-1 1-1 2.5 1.1 2.9 1.2 3.1c.2.2 2.1 3.2 5.1 4.5 2.5 1 3 .8 3.6.7.6-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4l-.6-.3zM12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2z" />
    </svg>
  );
}

export const CONTACT_ICONS: Record<ContactKind, React.ReactNode> = {
  call: <Phone className="h-3.5 w-3.5" />,
  whatsapp: <WhatsAppIcon className="h-3.5 w-3.5" />,
  sms: <MessageSquare className="h-3.5 w-3.5" />,
  note: <StickyNote className="h-3.5 w-3.5" />,
};

export function DaysBadge({ c, reminderDays }: { c: Confessor; reminderDays: number }) {
  const cls = c.overdue ? 'bg-rose-100 text-rose-700 ring-1 ring-rose-200' : c.days_since > reminderDays * 0.75 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700';
  return (
    <span className={`badge tabular-nums ${cls}`} title={c.last_confession ? `آخر اعتراف ${fmtDay(c.last_confession)}` : 'لم يُسجَّل اعتراف بعد'}>
      {c.overdue && <AlertTriangle className="ml-1 h-3 w-3" />}
      {c.last_confession ? daysLabel(c.days_since) : 'بلا اعتراف مسجَّل'}
    </span>
  );
}

/** Opens the phone / WhatsApp / SMS app and logs the contact. */
export function useContactActions(onLogged?: () => void) {
  const { token } = usePriest();
  const [supabase] = useState(() => createClient());
  return async (c: { person_id: string; person: { phone: string | null } }, kind: Exclude<ContactKind, 'note'>, message?: string) => {
    const phone = c.person.phone;
    if (!phone) return;
    if (kind === 'call') window.location.href = `tel:${phone}`;
    else if (kind === 'whatsapp') window.open(`https://wa.me/${waNumber(phone)}${message ? `?text=${encodeURIComponent(message)}` : ''}`, '_blank', 'noopener,noreferrer');
    else window.location.href = `sms:${phone}${message ? `?body=${encodeURIComponent(message)}` : ''}`;
    if (token) { try { await logContact(supabase, token, c.person_id, kind, message ?? null); onLogged?.(); } catch { /* best-effort */ } }
  };
}

export function ContactButtons({ c, onLogged, size = 'md' }: { c: Confessor; onLogged?: () => void; size?: 'sm' | 'md' }) {
  const act = useContactActions(onLogged);
  if (!c.person.phone) return <span className="text-[10px] font-bold text-slate-300">بلا هاتف</span>;
  const cls = size === 'sm' ? 'p-1.5' : 'p-2';
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => act(c, 'call')} aria-label={`اتصال بـ ${c.person.name}`} title="اتصال" className={`rounded-xl bg-teal-50 text-teal-700 hover:bg-teal-100 ${cls}`}><Phone className="h-4 w-4" /></button>
      <button type="button" onClick={() => act(c, 'whatsapp')} aria-label="واتساب" title="واتساب" className={`rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 ${cls}`}><WhatsAppIcon /></button>
      <button type="button" onClick={() => act(c, 'sms')} aria-label="رسالة SMS" title="رسالة SMS" className={`rounded-xl bg-indigo-50 text-indigo-700 hover:bg-indigo-100 ${cls}`}><MessageSquare className="h-4 w-4" /></button>
    </div>
  );
}

export function ConfessorCard({ c, reminderDays, onOpen, onChanged, compact = false }: {
  c: Confessor; reminderDays: number; onOpen: (c: Confessor) => void; onChanged: () => void; compact?: boolean;
}) {
  const places = c.places.filter((p) => p.kind === 'child');
  return (
    <li className={`card !p-3 ${c.overdue ? 'ring-1 ring-rose-200' : ''}`}>
      <div className="flex items-start gap-3">
        <button type="button" onClick={() => onOpen(c)} className="shrink-0"><PersonPhoto name={c.person.name} url={c.person.image_url} size={48} /></button>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => onOpen(c)} className="block max-w-full truncate text-right text-sm font-extrabold text-slate-800 hover:underline">{c.person.name}</button>
          {places.length > 0 && !compact && (
            <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] font-bold text-slate-400"><MapPin className="h-3 w-3 shrink-0" />{places.map((p) => `${p.service_name} · ${p.class_name}`).join(' — ')}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <DaysBadge c={c} reminderDays={reminderDays} />
            {c.last_confession && <span className="text-[10px] font-bold text-slate-400">{fmtDay(c.last_confession)}</span>}
            {c.next_appointment && (
              <span className={`badge ${c.next_appointment.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-violet-100 text-violet-700'}`}>
                <Clock className="ml-1 h-3 w-3" />{fmtDay(c.next_appointment.on)}{c.next_appointment.time ? ` ${shortTime(c.next_appointment.time)}` : ''}{c.next_appointment.status === 'pending' ? ' · طلب' : ''}
              </span>
            )}
            {c.last_contact && (
              <span className="badge bg-slate-100 text-slate-500" title={fmtDateTime(c.last_contact.created_at)}>{CONTACT_ICONS[c.last_contact.kind]}<span className="mr-1">{CONTACT_KIND_LABELS[c.last_contact.kind]}</span></span>
            )}
          </div>
        </div>
        <ContactButtons c={c} onLogged={onChanged} size="sm" />
      </div>
    </li>
  );
}

// ---------- One appointment row with the decision buttons ----------
const APPT_TONE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700', approved: 'bg-violet-100 text-violet-700', rejected: 'bg-red-100 text-red-600',
  cancelled: 'bg-slate-100 text-slate-500', done: 'bg-emerald-100 text-emerald-700',
};

export function AppointmentRow({ a, onChanged, compact = false, onOpenPerson }: {
  a: Appointment; onChanged: () => void; compact?: boolean; onOpenPerson?: (personId: string) => void;
}) {
  const { token } = usePriest();
  const [supabase] = useState(() => createClient());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [move, setMove] = useState(false);
  const [on, setOn] = useState(a.on);
  const [time, setTime] = useState(shortTime(a.time));
  const [note, setNote] = useState('');
  const act = async (action: 'approve' | 'reject' | 'cancel' | 'done', opts: { on?: string; time?: string | null; note?: string } = {}) => {
    if (!token) return;
    setBusy(true); setErr('');
    try { await decideAppointment(supabase, token, a.id, action, opts); setMove(false); onChanged(); }
    catch (e) { setErr(priestErrorMessage(e)); }
    finally { setBusy(false); }
  };
  const open = a.status === 'pending' || a.status === 'approved';
  return (
    <li className={`py-2 ${compact ? 'text-xs' : 'text-sm'}`}>
      <div className="flex items-start gap-2">
        {!compact && <button type="button" onClick={() => onOpenPerson?.(a.person_id)} className="shrink-0"><PersonPhoto name={a.person.name} url={a.person.image_url} size={40} /></button>}
        <div className="min-w-0 flex-1">
          {!compact && <button type="button" onClick={() => onOpenPerson?.(a.person_id)} className="block truncate text-right font-extrabold text-slate-800 hover:underline">{a.person.name}</button>}
          <p className="flex flex-wrap items-center gap-1.5 font-bold text-slate-600">
            <Clock className="h-3.5 w-3.5 text-violet-500" />{fmtDay(a.on)}{a.time ? ` · ${shortTime(a.time)}` : ''}
            <span className={`badge ${APPT_TONE[a.status]}`}>{APPOINTMENT_STATUS_LABELS[a.status]}</span>
            <span className="badge bg-slate-100 text-slate-500">{a.requested_by === 'child' ? 'طلب المخدوم' : 'حدده الكاهن'}</span>
          </p>
          {a.note && <p className="mt-0.5 text-[11px] text-slate-500">💬 {a.note}</p>}
          {a.decision_note && <p className="mt-0.5 text-[11px] text-slate-400">↩ {a.decision_note}</p>}
          {!compact && a.last_confession && <p className="mt-0.5 text-[11px] text-slate-400">آخر اعتراف: {fmtDay(a.last_confession)}</p>}
        </div>
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {a.status === 'pending' && <button type="button" disabled={busy} onClick={() => act('approve')} className="flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-extrabold text-white"><Check className="h-4 w-4" /> موافقة</button>}
          <button type="button" disabled={busy} onClick={() => setMove((v) => !v)} className="flex items-center gap-1 rounded-xl bg-violet-100 px-3 py-1.5 text-xs font-extrabold text-violet-700"><CalendarPlus className="h-4 w-4" /> {a.status === 'pending' ? 'موافقة بموعد آخر' : 'تغيير الموعد'}</button>
          {a.status === 'approved' && <button type="button" disabled={busy} onClick={() => act('done')} className="flex items-center gap-1 rounded-xl bg-violet-600 px-3 py-1.5 text-xs font-extrabold text-white"><CheckCircle2 className="h-4 w-4" /> تمّ الاعتراف</button>}
          {a.status === 'pending' && <button type="button" disabled={busy} onClick={() => act('reject', { note: note || undefined })} className="flex items-center gap-1 rounded-xl bg-red-50 px-3 py-1.5 text-xs font-extrabold text-red-600"><XCircle className="h-4 w-4" /> رفض</button>}
          {a.status === 'approved' && <button type="button" disabled={busy} onClick={() => act('cancel')} className="flex items-center gap-1 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-extrabold text-slate-600"><Ban className="h-4 w-4" /> إلغاء</button>}
          {busy && <Loader2 className="h-4 w-4 animate-spin text-violet-500" />}
        </div>
      )}
      {move && open && (
        <div className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-1.5 rounded-xl bg-violet-50 p-2">
          <input type="date" className="input-field !py-1.5" value={on} min={todayYmd()} onChange={(e) => setOn(e.target.value)} aria-label="اليوم" />
          <input type="time" className="input-field !py-1.5" value={time} onChange={(e) => setTime(e.target.value)} aria-label="الوقت" />
          <button type="button" disabled={busy} onClick={() => act('approve', { on, time: time || null, note: note || undefined })} className="rounded-xl bg-violet-600 px-3 text-xs font-extrabold text-white">حفظ</button>
          <input className="input-field col-span-3 !py-1.5" placeholder="ملاحظة للمخدوم (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}
      {err && <p className="mt-1 text-[11px] font-bold text-red-600">{err}</p>}
    </li>
  );
}

/** Sort helpers for the lists */
export type ConfessorSort = 'days_desc' | 'days_asc' | 'name' | 'added';
export const SORT_LABELS: Record<ConfessorSort, string> = {
  days_desc: 'الأطول غيابًا أولاً', days_asc: 'الأحدث اعترافًا أولاً', name: 'الاسم', added: 'الأحدث إضافة',
};
export function sortConfessors(list: Confessor[], sort: ConfessorSort): Confessor[] {
  const l = [...list];
  switch (sort) {
    case 'days_desc': return l.sort((a, b) => b.days_since - a.days_since);
    case 'days_asc': return l.sort((a, b) => a.days_since - b.days_since);
    case 'name': return l.sort((a, b) => a.person.name.localeCompare(b.person.name, 'ar'));
    default: return l.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
}
