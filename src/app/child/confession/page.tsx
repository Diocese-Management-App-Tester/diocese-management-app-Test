'use client';

// ---------- بوابة المخدوم → الاعتراف ----------
// My confession father (or every priest of my church) with «آخر اعتراف»,
// «اطلب موعدًا» (day · time · note → pending until the priest approves) and
// the list of my requests / appointments with their status.

import { useState } from 'react';
import Image from 'next/image';
import { Cross, CalendarPlus, Loader2, Check, Clock, X, User } from 'lucide-react';
import ChildShell from '@/components/child/ChildShell';
import { PageTitle, EmptyState, fmtDay, fmtDateTime } from '@/components/child/ChildBits';
import { useChildConfession } from '@/components/child/ConfessionBits';
import { useChild } from '@/lib/child-context';
import { createClient } from '@/lib/supabase/client';
import {
  childRequestConfession, childCancelConfession, priestErrorMessage, todayYmd, shortTime, APPOINTMENT_STATUS_LABELS, type ChildConfessionPriest,
} from '@/lib/priest-portal';

export default function ChildConfessionPage() {
  return <ChildShell><Content /></ChildShell>;
}

const TONE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700', approved: 'bg-violet-100 text-violet-700', rejected: 'bg-red-100 text-red-600',
  cancelled: 'bg-slate-100 text-slate-500', done: 'bg-emerald-100 text-emerald-700',
};

function Content() {
  const { token } = useChild();
  const { data, reload } = useChildConfession();
  const [supabase] = useState(() => createClient());
  const [asking, setAsking] = useState<ChildConfessionPriest | null>(null);
  const [on, setOn] = useState(todayYmd());
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !asking) return;
    setBusy(true); setErr('');
    try {
      await childRequestConfession(supabase, token, asking.id, on, time || null, note || null);
      setOk(`تم إرسال طلبك إلى ${asking.title ? `${asking.title} ` : ''}${asking.name} — سيصلك الرد هنا`);
      setAsking(null); setNote(''); setTime(''); reload();
      setTimeout(() => setOk(''), 4000);
    } catch (er) { setErr(priestErrorMessage(er)); } finally { setBusy(false); }
  };
  const cancel = async (id: string) => {
    if (!token) return;
    setBusy(true); setErr('');
    try { await childCancelConfession(supabase, token, id); reload(); } catch (er) { setErr(priestErrorMessage(er)); } finally { setBusy(false); }
  };

  if (!data) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-violet-500" /></div>;
  const sorted = [...data.appointments];
  const active = sorted.filter((a) => a.status === 'pending' || (a.status === 'approved' && a.on >= data.server_today));
  const history = sorted.filter((a) => !active.includes(a));

  return (
    <>
      <PageTitle icon={<Cross className="h-5 w-5 text-violet-600" />} title="الاعتراف" sub="اطلب موعدًا من أب اعترافك — يوافق عليه أو يقترح موعدًا آخر" />
      {ok && <p className="mb-3 flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700"><Check className="h-4 w-4" />{ok}</p>}
      {err && <p className="mb-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600">{err}</p>}

      {data.priests.length === 0 ? <EmptyState text="لا يوجد كاهن مسجَّل في كنيستك بعد" /> : (
        <section className="mb-4 space-y-2">
          {data.priests.map((p) => (
            <div key={p.id} className={`card flex items-center gap-3 !p-3 ${p.is_mine ? 'ring-2 ring-violet-200' : ''}`}>
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white">
                {p.image_url ? <Image src={p.image_url} alt={p.name} fill sizes="56px" className="object-cover" /> : <User className="absolute inset-0 m-auto h-7 w-7" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold">{p.title ? `${p.title} ` : ''}{p.name}</p>
                <p className="truncate text-xs text-slate-500">{p.church_name}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {p.is_mine && <span className="badge bg-violet-100 text-violet-700">أب اعترافي</span>}
                  {p.last_confession && <span className="badge bg-emerald-100 text-emerald-700">آخر اعتراف {fmtDay(p.last_confession)}</span>}
                </div>
              </div>
              <button id={`ask-${p.id}`} type="button" onClick={() => { setAsking(p); setErr(''); }} className="flex flex-col items-center gap-0.5 rounded-2xl bg-violet-600 px-3 py-2 text-[11px] font-extrabold text-white"><CalendarPlus className="h-5 w-5" /> اطلب موعدًا</button>
            </div>
          ))}
        </section>
      )}

      {active.length > 0 && (
        <section className="mb-4">
          <h3 className="mb-2 text-sm font-extrabold text-slate-600">مواعيدي</h3>
          <ul className="space-y-2">{active.map((a) => (
            <li key={a.id} className="card !p-3">
              <div className="flex items-start gap-2">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-extrabold text-slate-800">{fmtDay(a.on)}{a.time ? ` · ${shortTime(a.time)}` : ''}</p>
                  <p className="text-xs text-slate-500">{a.priest_title ? `${a.priest_title} ` : ''}{a.priest_name}</p>
                  {a.status === 'approved' && (a.on !== a.requested_on || (a.time ?? '') !== (a.requested_time ?? '')) && (
                    <p className="mt-0.5 text-[11px] font-bold text-amber-700">غيّر الكاهن الموعد (كان {fmtDay(a.requested_on)}{a.requested_time ? ` ${shortTime(a.requested_time)}` : ''})</p>
                  )}
                  {a.decision_note && <p className="mt-0.5 text-[11px] text-slate-500">↩ {a.decision_note}</p>}
                  {a.note && <p className="mt-0.5 text-[11px] text-slate-400">💬 {a.note}</p>}
                </div>
                <span className={`badge ${TONE[a.status]}`}>{APPOINTMENT_STATUS_LABELS[a.status]}</span>
              </div>
              <button type="button" disabled={busy} onClick={() => cancel(a.id)} className="mt-2 flex items-center gap-1 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600"><X className="h-3.5 w-3.5" /> إلغاء الطلب</button>
            </li>
          ))}</ul>
        </section>
      )}

      {history.length > 0 && (
        <section className="mb-4">
          <h3 className="mb-2 text-sm font-extrabold text-slate-600">السجل</h3>
          <ul className="card !p-0 divide-y divide-indigo-50">{history.map((a) => (
            <li key={a.id} className="flex items-center gap-2 px-3 py-2 text-xs">
              <span className="flex-1 font-bold text-slate-700">{fmtDay(a.on)}{a.time ? ` · ${shortTime(a.time)}` : ''}<span className="block text-[11px] font-normal text-slate-400">{a.priest_name}{a.decision_note ? ` — ${a.decision_note}` : ''} · {fmtDateTime(a.created_at)}</span></span>
              <span className={`badge ${TONE[a.status]}`}>{APPOINTMENT_STATUS_LABELS[a.status]}</span>
            </li>
          ))}</ul>
        </section>
      )}

      {asking && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={() => setAsking(null)}>
          <form onSubmit={submit} className="w-full max-w-md space-y-3 rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold">طلب موعد اعتراف</h3>
              <button type="button" onClick={() => setAsking(null)} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <p className="text-sm text-slate-600">عند {asking.title ? `${asking.title} ` : ''}<b>{asking.name}</b></p>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="mb-1 block text-xs font-bold text-slate-500">اليوم *</label><input type="date" className="input-field" required min={todayYmd()} value={on} onChange={(e) => setOn(e.target.value)} /></div>
              <div><label className="mb-1 block text-xs font-bold text-slate-500">الوقت المفضَّل</label><input type="time" className="input-field" value={time} onChange={(e) => setTime(e.target.value)} /></div>
            </div>
            <div><label className="mb-1 block text-xs font-bold text-slate-500">ملاحظة</label><input className="input-field" placeholder="مثال: بعد القداس" value={note} onChange={(e) => setNote(e.target.value)} /></div>
            {err && <p className="text-xs font-bold text-red-600">{err}</p>}
            <button type="submit" disabled={busy} className="btn-primary flex w-full items-center justify-center gap-2 !bg-gradient-to-br !from-violet-600 !to-violet-800">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <CalendarPlus className="h-5 w-5" />} إرسال الطلب</button>
          </form>
        </div>
      )}
    </>
  );
}
