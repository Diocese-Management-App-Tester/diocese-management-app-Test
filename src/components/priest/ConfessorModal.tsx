'use client';

// ---------- المعترف — details sheet ----------
// Phone actions · quick panels (تسجيل اعتراف · موعد · ملاحظة) · history tabs
// (الاعترافات · الافتقاد · المواعيد) · remove from the list.

import { useEffect, useState } from 'react';
import { Phone, MessageSquare, CheckCircle2, CalendarPlus, X, Loader2, Trash2, StickyNote, MapPin, Check } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { usePriest } from '@/lib/priest-context';
import {
  type Confessor, type ConfessorHistory, CONTACT_KIND_LABELS,
  logContact, recordConfession, createAppointment, fetchConfessorHistory, updateConfessorNotes, removeConfessor,
  deleteConfession, deleteContact, todayYmd, priestErrorMessage,
} from '@/lib/priest-portal';
import { PersonPhoto } from '@/components/priest/PriestShell';
import { DaysBadge, WhatsAppIcon, CONTACT_ICONS, AppointmentRow, useContactActions } from '@/components/priest/ConfessorBits';
import { fmtDay, fmtDateTime } from '@/components/child/ChildBits';

type Panel = 'none' | 'confess' | 'appt' | 'note';
type Tab = 'confessions' | 'contacts' | 'appointments';

export default function ConfessorModal({ c, onClose, onChanged }: { c: Confessor; onClose: () => void; onChanged: () => void }) {
  const { token, profile } = usePriest();
  const [supabase] = useState(() => createClient());
  const [hist, setHist] = useState<ConfessorHistory | null>(null);
  const [tab, setTab] = useState<Tab>('confessions');
  const [panel, setPanel] = useState<Panel>('none');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [confOn, setConfOn] = useState(todayYmd());
  const [confNote, setConfNote] = useState('');
  const [apptOn, setApptOn] = useState(todayYmd());
  const [apptTime, setApptTime] = useState('');
  const [apptNote, setApptNote] = useState('');
  const [notes, setNotes] = useState(c.notes ?? '');
  const [noteText, setNoteText] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);

  const load = async () => { if (!token) return; try { setHist(await fetchConfessorHistory(supabase, token, c.person_id)); } catch { /* ignore */ } };
  const act = useContactActions(() => { load(); onChanged(); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [c.person_id, token]);
  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, []);

  const run = async (fn: () => Promise<void>, done: string) => {
    if (!token) return;
    setBusy(true); setErr(''); setOk('');
    try { await fn(); if (done) setOk(done); await load(); onChanged(); setTimeout(() => setOk(''), 1800); }
    catch (e) { setErr(priestErrorMessage(e)); }
    finally { setBusy(false); }
  };

  const quick = (k: Panel, icon: React.ReactNode, label: string, id: string) => (
    <button id={id} type="button" onClick={() => setPanel(panel === k ? 'none' : k)}
      className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-2.5 text-xs font-extrabold transition ${panel === k ? 'bg-violet-600 text-white' : 'bg-violet-50 text-violet-700'}`}>{icon} {label}</button>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <div id="confessor-modal" role="dialog" aria-modal="true" className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-indigo-50 bg-white/95 px-4 py-3 backdrop-blur">
          <PersonPhoto name={c.person.name} url={c.person.image_url} size={56} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-extrabold">{c.person.name}</p>
            <p className="text-xs text-slate-400" dir="ltr">{c.person.national_id}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <DaysBadge c={c} reminderDays={profile?.priest.reminder_days ?? 40} />
              <span className="badge bg-slate-100 text-slate-500 tabular-nums">{c.confessions_count} اعتراف</span>
            </div>
          </div>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-3 p-4">
          {c.person.phone && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-2">
              <span className="text-sm font-bold text-slate-600" dir="ltr">{c.person.phone}</span>
              <div className="flex gap-1">
                <button type="button" onClick={() => act(c, 'call')} className="flex items-center gap-1 rounded-xl bg-teal-600 px-3 py-1.5 text-xs font-extrabold text-white"><Phone className="h-4 w-4" /> اتصال</button>
                <button type="button" onClick={() => act(c, 'whatsapp')} className="flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-extrabold text-white"><WhatsAppIcon /> واتساب</button>
                <button type="button" onClick={() => act(c, 'sms')} className="flex items-center gap-1 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-extrabold text-white"><MessageSquare className="h-4 w-4" /> SMS</button>
              </div>
            </div>
          )}
          {c.places.length > 0 && (
            <p className="flex items-start gap-1 text-[11px] font-bold text-slate-500"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {c.places.map((p) => `${p.church_name} ← ${p.service_name} ← ${p.class_name}${p.kind === 'servant' ? ' (خادم)' : ''}`).join(' · ')}</p>
          )}

          <div className="grid grid-cols-3 gap-2">
            {quick('confess', <CheckCircle2 className="h-5 w-5" />, 'تسجيل اعتراف', 'cm-confess')}
            {quick('appt', <CalendarPlus className="h-5 w-5" />, 'موعد', 'cm-appt')}
            {quick('note', <StickyNote className="h-5 w-5" />, 'ملاحظة', 'cm-note')}
          </div>

          {panel === 'confess' && (
            <div className="space-y-2 rounded-2xl border border-violet-100 p-3">
              <p className="text-xs font-extrabold text-slate-600">تسجيل اعتراف</p>
              <div className="grid grid-cols-2 gap-2">
                <input type="date" className="input-field" value={confOn} max={todayYmd()} onChange={(e) => setConfOn(e.target.value)} aria-label="يوم الاعتراف" />
                <input className="input-field" placeholder="ملاحظة (اختياري)" value={confNote} onChange={(e) => setConfNote(e.target.value)} />
              </div>
              <button type="button" disabled={busy} onClick={() => run(async () => { await recordConfession(supabase, token!, c.person_id, confOn, confNote || null); setConfNote(''); setPanel('none'); }, 'تم تسجيل الاعتراف')}
                className="btn-primary flex w-full items-center justify-center !bg-gradient-to-br !from-violet-600 !to-violet-800">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'تسجيل'}</button>
            </div>
          )}
          {panel === 'appt' && (
            <div className="space-y-2 rounded-2xl border border-violet-100 p-3">
              <p className="text-xs font-extrabold text-slate-600">موعد اعتراف جديد</p>
              <div className="grid grid-cols-2 gap-2">
                <input type="date" className="input-field" value={apptOn} min={todayYmd()} onChange={(e) => setApptOn(e.target.value)} aria-label="يوم الموعد" />
                <input type="time" className="input-field" value={apptTime} onChange={(e) => setApptTime(e.target.value)} aria-label="وقت الموعد" />
              </div>
              <input className="input-field" placeholder="ملاحظة (اختياري)" value={apptNote} onChange={(e) => setApptNote(e.target.value)} />
              <button type="button" disabled={busy} onClick={() => run(async () => { await createAppointment(supabase, token!, c.person_id, apptOn, apptTime || null, apptNote || null); setApptNote(''); setPanel('none'); setTab('appointments'); }, 'تم حفظ الموعد')}
                className="btn-primary flex w-full items-center justify-center !bg-gradient-to-br !from-violet-600 !to-violet-800">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'حفظ الموعد'}</button>
            </div>
          )}
          {panel === 'note' && (
            <div className="space-y-2 rounded-2xl border border-violet-100 p-3">
              <p className="text-xs font-extrabold text-slate-600">ملاحظة افتقاد (تُحفظ في السجل)</p>
              <textarea className="input-field min-h-[60px]" value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="مثال: تحدثت معه، سيأتي الجمعة" />
              <button type="button" disabled={busy || !noteText.trim()} onClick={() => run(async () => { await logContact(supabase, token!, c.person_id, 'note', noteText); setNoteText(''); setPanel('none'); setTab('contacts'); }, 'تم حفظ الملاحظة')}
                className="btn-primary w-full !bg-gradient-to-br !from-violet-600 !to-violet-800">حفظ</button>
              <div className="border-t border-indigo-50 pt-2">
                <p className="mb-1 text-xs font-extrabold text-slate-600">ملاحظات ثابتة على المعترف</p>
                <textarea className="input-field min-h-[50px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات عامة" />
                <button type="button" disabled={busy} onClick={() => run(() => updateConfessorNotes(supabase, token!, c.id, notes), 'تم الحفظ')} className="btn-secondary mt-1 w-full">حفظ الملاحظات</button>
              </div>
            </div>
          )}

          {err && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{err}</p>}
          {ok && <p className="flex items-center gap-1 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700"><Check className="h-4 w-4" />{ok}</p>}
          {c.notes && panel !== 'note' && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">📝 {c.notes}</p>}

          <div className="rounded-2xl border border-indigo-50">
            <div role="tablist" className="grid grid-cols-3 border-b border-indigo-50 text-xs font-extrabold">
              {([['confessions', 'الاعترافات', hist?.confessions.length], ['contacts', 'الافتقاد', hist?.contacts.length], ['appointments', 'المواعيد', hist?.appointments.length]] as const).map(([k, l, n]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`flex items-center justify-center gap-1 py-2 ${tab === k ? 'border-b-2 border-violet-600 text-violet-700' : 'text-slate-400'}`}>{l}{n !== undefined && <span className="tabular-nums">({n})</span>}</button>
              ))}
            </div>
            <div className="max-h-64 overflow-y-auto p-2">
              {!hist ? <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-violet-400" /></div> : (
                <>
                  {tab === 'confessions' && (hist.confessions.length === 0 ? <Empty text="لا اعترافات مسجَّلة" /> : (
                    <ul className="divide-y divide-indigo-50">{hist.confessions.map((x) => (
                      <li key={x.id} className="flex items-center gap-2 py-2 text-xs">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                        <span className="flex-1 font-bold text-slate-700">{fmtDay(x.confessed_on)}{x.notes && <span className="block text-[11px] font-normal text-slate-400">{x.notes}</span>}</span>
                        <button type="button" aria-label="حذف" onClick={() => run(() => deleteConfession(supabase, token!, x.id), 'تم الحذف')} className="rounded-lg p-1 text-slate-300 hover:bg-red-50 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                      </li>))}</ul>
                  ))}
                  {tab === 'contacts' && (hist.contacts.length === 0 ? <Empty text="لا سجل افتقاد بعد" /> : (
                    <ul className="divide-y divide-indigo-50">{hist.contacts.map((x) => (
                      <li key={x.id} className="flex items-center gap-2 py-2 text-xs">
                        <span className="rounded-lg bg-slate-100 p-1.5 text-slate-500">{CONTACT_ICONS[x.kind]}</span>
                        <span className="flex-1 font-bold text-slate-700">{CONTACT_KIND_LABELS[x.kind]}<span className="block text-[11px] font-normal text-slate-400">{fmtDateTime(x.created_at)}{x.message ? ` — ${x.message}` : ''}</span></span>
                        <button type="button" aria-label="حذف" onClick={() => run(() => deleteContact(supabase, token!, x.id), 'تم الحذف')} className="rounded-lg p-1 text-slate-300 hover:bg-red-50 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                      </li>))}</ul>
                  ))}
                  {tab === 'appointments' && (hist.appointments.length === 0 ? <Empty text="لا مواعيد" /> : (
                    <ul className="divide-y divide-indigo-50">{hist.appointments.map((a) => <AppointmentRow key={a.id} a={a} onChanged={() => { load(); onChanged(); }} compact />)}</ul>
                  ))}
                </>
              )}
            </div>
          </div>

          {!confirmRemove ? (
            <button type="button" onClick={() => setConfirmRemove(true)} className="flex w-full items-center justify-center gap-1 rounded-xl py-2 text-xs font-bold text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /> إزالة من المعترفين</button>
          ) : (
            <div className="flex items-center gap-2 rounded-xl bg-red-50 p-2 text-xs font-bold text-red-700">
              <span className="flex-1">إزالة {c.person.name} من قائمتك؟ (يبقى سجل الاعترافات)</span>
              <button type="button" onClick={() => run(async () => { await removeConfessor(supabase, token!, c.id); onClose(); }, '')} className="rounded-lg bg-red-600 px-3 py-1 text-white">إزالة</button>
              <button type="button" onClick={() => setConfirmRemove(false)} className="rounded-lg bg-white px-3 py-1">إلغاء</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-4 text-center text-xs font-bold text-slate-400">{text}</p>;
}
