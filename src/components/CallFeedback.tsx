'use client';

// ---------- Call feedback UI (migration 0023) ----------
// CallFeedbackIcon   — maps a stored icon key → lucide icon
// CallFeedbackBadge  — the badge shown AFTER the status badge on a child's
//                      card: «لم يُفتقد بعد» / «لم يُفتقد» / the recorded
//                      feedback (its color + icon + name). Tapping opens…
// CallFeedbackModal  — colored feedback buttons (scoped to the child's
//                      church / service / class and the selected event);
//                      choosing one inserts a contact_log row (kind 'call',
//                      feedback_id, occurrence_on) and the badge updates.
//                      Read-only once the cycle has CLOSED in real time.
// useCallFeedbackStates — per-enrollment badge state for the rows on
//                      screen: the WORKING date picks the occurrence, the
//                      REAL date decides whether its cycle is still open.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import type { LucideIcon } from 'lucide-react';
import {
  Phone, PhoneCall, PhoneMissed, PhoneOff, Voicemail,
  Check, X, CircleHelp, TriangleAlert, Ban, Clock, Hourglass, RefreshCw,
  ThumbsUp, ThumbsDown, Heart, Smile, Meh, Frown,
  Thermometer, Stethoscope, Pill, Bed, Hospital,
  Plane, Car, Bus, MapPin, House, Moon,
  GraduationCap, BookOpen, Briefcase, Users, Baby,
  Church, Gift, PartyPopper, Sparkles, MessageCircle,
  Loader2, PhoneForwarded, Trash2, CalendarDays, User,
} from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { ModalFrame } from '@/components/PersonDataModals';
import { feedbackApplies, type AppEvent, type CallFeedback, type EnrollmentWithPerson } from '@/lib/types';
import { cairoToday, APP_TZ } from '@/lib/time';
import {
  followUpCycle, callFeedbackState, indexFeedbackRows, feedbackStyle, feedbackTintStyle,
  canRecordFeedback, CALL_STATE_LABELS, CALL_STATE_SHORT_LABELS,
  type CallFeedbackIconKey, type CallFeedbackState, type EnrollmentFeedbackDays, type FollowUpCycle,
} from '@/lib/call-feedback';

// ---------- Icon map ----------
export const CALL_FEEDBACK_ICONS: Record<CallFeedbackIconKey, LucideIcon> = {
  'phone': Phone, 'phone-call': PhoneCall, 'phone-missed': PhoneMissed, 'phone-off': PhoneOff, 'voicemail': Voicemail,
  'check': Check, 'x': X, 'circle-help': CircleHelp, 'triangle-alert': TriangleAlert, 'ban': Ban,
  'clock': Clock, 'hourglass': Hourglass, 'refresh-cw': RefreshCw,
  'thumbs-up': ThumbsUp, 'thumbs-down': ThumbsDown, 'heart': Heart, 'smile': Smile, 'meh': Meh, 'frown': Frown,
  'thermometer': Thermometer, 'stethoscope': Stethoscope, 'pill': Pill, 'bed': Bed, 'hospital': Hospital,
  'plane': Plane, 'car': Car, 'bus': Bus, 'map-pin': MapPin, 'house': House, 'moon': Moon,
  'graduation-cap': GraduationCap, 'book-open': BookOpen, 'briefcase': Briefcase, 'users': Users, 'baby': Baby,
  'church': Church, 'gift': Gift, 'party-popper': PartyPopper, 'sparkles': Sparkles, 'message-circle': MessageCircle,
};

export function CallFeedbackIcon({ icon, className }: { icon: string; className?: string }) {
  const Cmp = (CALL_FEEDBACK_ICONS as Record<string, LucideIcon>)[icon] ?? Phone;
  return <Cmp className={className ?? 'h-3.5 w-3.5'} />;
}

// ---------- Card avatar (children page + scanner card header) ----------
export function PersonAvatar({ name, imageUrl, size = 44 }: { name: string; imageUrl: string | null; size?: number }) {
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 text-white ring-2 ring-white shadow-sm"
      style={{ width: size, height: size }}
    >
      {imageUrl ? (
        <Image src={imageUrl} alt={name} fill sizes={`${size}px`} className="object-cover" />
      ) : (
        <User className="absolute inset-0 m-auto" style={{ width: size * 0.5, height: size * 0.5 }} />
      )}
    </div>
  );
}

// ---------- Badge ----------
export function CallFeedbackBadge({
  id, state, onClick, disabled, full,
}: {
  id?: string;
  state: CallFeedbackState;
  onClick?: () => void;
  disabled?: boolean;
  /** show the full label (modal header); the card badge uses the compact one */
  full?: boolean;
}) {
  const label = state.kind === 'feedback' ? state.feedback.name : CALL_STATE_LABELS[state.kind];
  const shown = state.kind === 'feedback' || full ? label : CALL_STATE_SHORT_LABELS[state.kind];
  const cls =
    state.kind === 'feedback'
      ? '!ring-black/10'
      : state.kind === 'wasnt_called'
        ? 'bg-amber-100 text-amber-700 !ring-amber-300'
        : 'bg-slate-100 text-slate-500 !ring-slate-200';
  const style = state.kind === 'feedback' ? feedbackStyle(state.feedback.color) : undefined;
  return (
    <button
      id={id}
      type="button"
      aria-label={`نتيجة الافتقاد: ${label}`}
      title={`نتيجة الافتقاد: ${label} — اضغط للتفاصيل`}
      onClick={onClick}
      disabled={disabled}
      style={style}
      className={`badge-btn disabled:opacity-60 ${cls}`}
    >
      {state.kind === 'feedback' ? (
        <CallFeedbackIcon icon={state.feedback.icon} />
      ) : state.kind === 'wasnt_called' ? (
        <PhoneMissed className="h-3.5 w-3.5" />
      ) : (
        <PhoneForwarded className="h-3.5 w-3.5" />
      )}
      <span className="truncate">{shown}</span>
    </button>
  );
}

// ---------- Per-enrollment states for the rows on screen ----------
export interface CallFeedbackStates {
  cycle: FollowUpCycle | null;
  stateOf: (e: EnrollmentWithPerson) => CallFeedbackState | null;
  /** optimistic patch after recording a feedback */
  setRecorded: (enrollmentId: string, occurrenceOn: string, feedbackId: string | null) => void;
  reload: () => Promise<void>;
}

export function useCallFeedbackStates(
  supabase: SupabaseClient,
  rows: EnrollmentWithPerson[],
  selectedEvent: AppEvent | null,
  feedbacks: CallFeedback[],
  /** the app's working date (frozen override or live) — picks the occurrence */
  working: Date,
  /** the REAL clock — decides whether that occurrence's cycle is open or closed */
  real: Date
): CallFeedbackStates {
  const cycle = useMemo(
    () => (selectedEvent ? followUpCycle(selectedEvent, working, real) : null),
    [selectedEvent, working, real]
  );
  const feedbacksById = useMemo(() => new Map(feedbacks.map((f) => [f.id, f])), [feedbacks]);
  const [recorded, setRecordedMap] = useState<Record<string, EnrollmentFeedbackDays>>({});

  const idsKey = rows.map((e) => e.id).join(',');
  const targetDay = cycle?.target ?? '';

  const load = useCallback(async () => {
    if (!selectedEvent || !idsKey || !targetDay) { setRecordedMap({}); return; }
    const ids = idsKey.split(',');
    const all: { enrollment_id: string; occurrence_on: string | null; feedback_id: string | null; created_at: string }[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await supabase
        .from('contact_log')
        .select('enrollment_id, occurrence_on, feedback_id, created_at')
        .eq('event_id', selectedEvent.id)
        .eq('occurrence_on', targetDay)
        .not('feedback_id', 'is', null)
        .in('enrollment_id', ids.slice(i, i + 100));
      all.push(...((data ?? []) as typeof all));
    }
    setRecordedMap(indexFeedbackRows(all));
  }, [supabase, selectedEvent, idsKey, targetDay]);

  useEffect(() => {
    let cancelled = false;
    load().then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
  }, [load]);

  const stateOf = useCallback(
    (e: EnrollmentWithPerson): CallFeedbackState | null => {
      if (!cycle || !selectedEvent) return null;
      if (cycle.beforeCreation) return null; // the event didn't exist on that day
      if (selectedEvent.church_id !== e.church_id) return null;
      if (selectedEvent.service_id !== null && selectedEvent.service_id !== e.service_id) return null;
      if (selectedEvent.class_id !== null && selectedEvent.class_id !== e.class_id) return null;
      return callFeedbackState(cycle, recorded[e.id], feedbacksById);
    },
    [cycle, selectedEvent, recorded, feedbacksById]
  );

  const setRecorded = useCallback((enrollmentId: string, occurrenceOn: string, feedbackId: string | null) => {
    setRecordedMap((prev) => {
      const cur = { ...(prev[enrollmentId] ?? {}) };
      if (feedbackId) cur[occurrenceOn] = feedbackId; else delete cur[occurrenceOn];
      return { ...prev, [enrollmentId]: cur };
    });
  }, []);

  return { cycle, stateOf, setRecorded, reload: load };
}

// ---------- Modal ----------
const fmtDay = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date(Date.UTC(y, m - 1, d)));
};
const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat('ar-EG', {
    timeZone: APP_TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));

interface HistoryRow {
  id: string;
  feedback_id: string | null;
  occurrence_on: string | null;
  created_at: string;
  recorded_by: string | null;
}

export function CallFeedbackModal({
  enrollment, event, cycle, feedbacks, current, now, onRecorded, onClose,
}: {
  enrollment: EnrollmentWithPerson;
  event: AppEvent;
  cycle: FollowUpCycle;
  feedbacks: CallFeedback[];
  current: CallFeedbackState;
  now: () => Date;
  onRecorded: (occurrenceOn: string, feedbackId: string | null) => void;
  onClose: () => void;
}) {
  const supabase = createClient();
  const { profile } = useAuth();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  // Feedbacks that apply to THIS child inside THIS event
  const options = useMemo(
    () => feedbacks
      .filter((f) => feedbackApplies(f, enrollment, event.id))
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ar')),
    [feedbacks, enrollment, event.id]
  );
  const byId = useMemo(() => new Map(feedbacks.map((f) => [f.id, f])), [feedbacks]);

  // Feedback history of this child for this event (newest first)
  const loadHistory = useCallback(async () => {
    const { data } = await supabase
      .from('contact_log')
      .select('id, feedback_id, occurrence_on, created_at, recorded_by')
      .eq('enrollment_id', enrollment.id)
      .eq('event_id', event.id)
      .not('feedback_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(30);
    const rows = (data ?? []) as HistoryRow[];
    setHistory(rows);
    const ids = Array.from(new Set(rows.map((r) => r.recorded_by).filter((x): x is string => !!x)));
    if (ids.length) {
      const { data: profs } = await supabase.from('servant_enrollments').select('id, full_name').in('id', ids);
      const map: Record<string, string> = {};
      (profs ?? []).forEach((p: { id: string; full_name: string }) => { map[p.id] = p.full_name; });
      setNames(map);
    }
  }, [supabase, enrollment.id, event.id]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Recording is allowed only while the cycle is OPEN in real time
  const editable = canRecordFeedback(cycle);

  const record = async (fb: CallFeedback) => {
    if (!editable) return;
    setError('');
    setSaving(fb.id);
    const { error: err } = await supabase.from('contact_log').insert({
      enrollment_id: enrollment.id,
      event_id: event.id,
      kind: 'call',
      message: null,
      contacted_on: cairoToday(now()),
      occurrence_on: cycle.target,
      feedback_id: fb.id,
      recorded_by: profile?.id,
    });
    setSaving(null);
    if (err) {
      setError('تعذر تسجيل النتيجة — تأكد من تشغيل تحديث قاعدة البيانات (0023)');
      return;
    }
    onRecorded(cycle.target, fb.id);
    onClose();
  };

  // Remove the latest feedback of the current occurrence (undo)
  const undo = async () => {
    if (!editable) return;
    const latest = history?.find((h) => h.occurrence_on === cycle.target);
    if (!latest) return;
    if (!confirm('حذف نتيجة الافتقاد المسجلة لهذه المناسبة؟')) return;
    setSaving('undo');
    const { error: err } = await supabase.from('contact_log').delete().eq('id', latest.id);
    setSaving(null);
    if (err) { setError('تعذر الحذف'); return; }
    const remaining = (history ?? []).filter((h) => h.id !== latest.id);
    setHistory(remaining);
    const nextForTarget = remaining.find((h) => h.occurrence_on === cycle.target)?.feedback_id ?? null;
    onRecorded(cycle.target, nextForTarget);
  };

  const hasCurrent = current.kind === 'feedback';
  const closed = cycle.status === 'closed';

  return (
    <ModalFrame title="نتيجة الافتقاد" icon={<PhoneCall className="h-5 w-5 text-primary-600" />} onClose={onClose}>
      {/* Child + event + occurrence */}
      <div className="mb-3 rounded-2xl bg-slate-50 px-3 py-2.5">
        <p className="truncate font-extrabold">{enrollment.person.name}</p>
        <p className="mt-0.5 flex items-center gap-1 text-xs font-bold text-slate-500">
          <CalendarDays className="h-3.5 w-3.5" />
          {event.name} — {fmtDay(cycle.target)}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[11px] font-bold text-slate-400">الحالة الآن:</span>
          <CallFeedbackBadge state={current} disabled full />
        </div>
      </div>

      {cycle.status === 'closed' && (
        <p id="call-cycle-closed" className={`mb-3 rounded-xl px-3 py-2 text-xs font-bold ${current.kind === 'wasnt_called' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
          {current.kind === 'wasnt_called' ? '⚠️ لم يُفتقد هذا المخدوم لمناسبة ' : '🔒 نتيجة الافتقاد لمناسبة '}
          {fmtDay(cycle.target)} — انتهت فترة الافتقاد ببداية مناسبة {fmtDay(cycle.realTarget)} في الوقت الفعلي؛ يُعرض السجل فقط
        </p>
      )}
      {cycle.status === 'future' && (
        <p id="call-cycle-future" className="mb-3 rounded-xl bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700">
          ⏳ مناسبة {fmtDay(cycle.target)} لم تبدأ بعد في الوقت الفعلي — يمكن تسجيل نتيجة الافتقاد بعد بدايتها
        </p>
      )}

      {/* Feedback buttons + actions — hidden when the period is CLOSED
          (real time passed the next occurrence): the modal is then a
          read-only history of this child's feedbacks. */}
      {!closed && (<>
      <p className="mb-1.5 text-xs font-bold text-slate-500">{editable ? 'اختر نتيجة الافتقاد' : 'نتائج الافتقاد (للعرض فقط)'}</p>
      {options.length === 0 ? (
        <p className="rounded-xl bg-violet-50 px-3 py-2 text-xs font-bold text-violet-600">
          لا توجد نتائج افتقاد معرّفة لهذا النطاق — أضفها من الإعدادات ← إدارة نتائج الافتقاد
        </p>
      ) : (
        <div id="call-feedback-options" className="grid grid-cols-2 gap-2">
          {options.map((fb) => {
            const active = current.kind === 'feedback' && current.feedback.id === fb.id;
            return (
              <button
                key={fb.id}
                id={`call-fb-${fb.id}`}
                type="button"
                disabled={saving !== null || !editable}
                aria-pressed={active}
                onClick={() => record(fb)}
                style={active ? feedbackStyle(fb.color) : feedbackTintStyle(fb.color)}
                className={`flex min-h-[3rem] items-center gap-2 rounded-xl border-2 px-3 py-2 text-sm font-extrabold transition active:scale-95 ${
                  active ? 'shadow ring-2 ring-offset-1' : ''
                } ${editable ? 'disabled:opacity-60' : active ? 'cursor-not-allowed' : 'cursor-not-allowed opacity-40'}`}
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={active ? { backgroundColor: 'rgba(255,255,255,0.25)' } : feedbackStyle(fb.color)}
                >
                  {saving === fb.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CallFeedbackIcon icon={fb.icon} className="h-4 w-4" />}
                </span>
                <span className="truncate text-right">{fb.name}</span>
              </button>
            );
          })}
        </div>
      )}

      {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}

      <div className="mt-3 flex gap-2">
        {enrollment.person.phone && (
          <a
            href={`tel:${enrollment.person.phone}`}
            className="btn-secondary flex flex-1 items-center justify-center gap-2 !py-2.5 text-sm"
          >
            <Phone className="h-4 w-4" /> اتصال
          </a>
        )}
        {hasCurrent && editable && (
          <button
            type="button"
            onClick={undo}
            disabled={saving !== null}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-bold text-red-600 hover:bg-red-100 disabled:opacity-60"
          >
            {saving === 'undo' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            حذف النتيجة
          </button>
        )}
      </div>
      </>)}

      {/* History */}
      <div className="mt-4">
        <p className="mb-1.5 text-xs font-bold text-slate-500">سجل نتائج الافتقاد — {event.name}</p>
        {history === null ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-primary-500" /></div>
        ) : history.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-3 py-3 text-center text-xs font-bold text-slate-400">لا توجد نتائج مسجلة بعد</p>
        ) : (
          <ul className="max-h-48 space-y-1.5 overflow-y-auto no-scrollbar">
            {history.map((h) => {
              const fb = h.feedback_id ? byId.get(h.feedback_id) : undefined;
              return (
                <li key={h.id} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                    style={feedbackStyle(fb?.color ?? '#94a3b8')}
                  >
                    <CallFeedbackIcon icon={fb?.icon ?? 'phone'} className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-extrabold">{fb?.name ?? 'نتيجة محذوفة'}</span>
                    <span className="block truncate text-[11px] text-slate-500">
                      مناسبة {h.occurrence_on ? fmtDay(h.occurrence_on) : '—'} · {fmtDateTime(h.created_at)}
                      {h.recorded_by && names[h.recorded_by] ? ` · ${names[h.recorded_by]}` : ''}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </ModalFrame>
  );
}
