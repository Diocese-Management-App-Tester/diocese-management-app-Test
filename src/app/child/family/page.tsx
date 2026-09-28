'use client';

// ---------- بوابة المخدوم → عائلتي ----------
// My family (name · place · members with their relation), the PRIESTS OF MY
// AREA (call · WhatsApp), «اطلب زيارة» (day · time · note → pending until the
// priest approves) and the family's visits (upcoming + history).

import { useState } from 'react';
import Image from 'next/image';
import { Home, Phone, CalendarPlus, Loader2, Check, Clock, X, User, MapPin, UsersRound, Footprints, Cross } from 'lucide-react';
import ChildShell from '@/components/child/ChildShell';
import { PageTitle, EmptyState, fmtDay, fmtDateTime } from '@/components/child/ChildBits';
import { useChildFamily } from '@/components/child/FamilyBits';
import { useChild } from '@/lib/child-context';
import { createClient } from '@/lib/supabase/client';
import { todayYmd, shortTime, waNumber } from '@/lib/priest-portal';
import { childRequestVisit, childCancelVisit, familyErrorMessage, placeLine, VISIT_STATUS_LABELS, type PriestShort } from '@/lib/priest-families';
import { relationLabel } from '@/lib/families';
import { WhatsAppIcon } from '@/components/priest/ConfessorBits';

export default function ChildFamilyPage() {
  return <ChildShell><Content /></ChildShell>;
}

const TONE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700', approved: 'bg-violet-100 text-violet-700', rejected: 'bg-red-100 text-red-600',
  cancelled: 'bg-slate-100 text-slate-500', done: 'bg-emerald-100 text-emerald-700',
};

function Content() {
  const { token } = useChild();
  const { data, reload } = useChildFamily();
  const [supabase] = useState(() => createClient());
  const [asking, setAsking] = useState<PriestShort | null>(null);
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
      await childRequestVisit(supabase, token, asking.id, on, time || null, note || null);
      setOk(`تم إرسال طلب الزيارة إلى ${asking.title ? `${asking.title} ` : ''}${asking.name} — سيصلك الرد هنا`);
      setAsking(null); setNote(''); setTime(''); reload();
      setTimeout(() => setOk(''), 4000);
    } catch (er) { setErr(familyErrorMessage(er)); } finally { setBusy(false); }
  };
  const cancel = async (id: string) => {
    if (!token) return;
    setBusy(true); setErr('');
    try { await childCancelVisit(supabase, token, id); reload(); } catch (er) { setErr(familyErrorMessage(er)); } finally { setBusy(false); }
  };

  if (!data) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-violet-500" /></div>;
  const f = data.family;
  const active = data.visits.filter((v) => v.status === 'pending' || (v.status === 'approved' && v.on >= data.server_today));
  const history = data.visits.filter((v) => !active.includes(v));
  const place = f ? placeLine(f) : '';

  return (
    <>
      <PageTitle icon={<Home className="h-5 w-5 text-violet-600" />} title="عائلتي" sub="عائلتك وكاهن منطقتك — اتصل به أو اطلب زيارة لعائلتك" />
      {ok && <p className="mb-3 flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700"><Check className="h-4 w-4" />{ok}</p>}
      {err && <p className="mb-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600">{err}</p>}

      {f ? (
        <section className="card mb-4 !p-3">
          <div className="flex items-start gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white"><UsersRound className="h-6 w-6" /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-extrabold">{f.name}</p>
              {place && <p className="mt-0.5 flex items-center gap-1 text-xs font-bold text-slate-600"><MapPin className="h-3.5 w-3.5 text-violet-500" />{place}</p>}
              {f.address && <p className="text-[11px] text-slate-500">{f.address}</p>}
              <div className="mt-1 flex flex-wrap gap-1.5">
                <span className="badge bg-slate-100 text-slate-500 tabular-nums">{f.members_count} فرد</span>
                {f.last_visit ? <span className="badge bg-emerald-100 text-emerald-700"><Footprints className="ml-1 h-3 w-3" />آخر زيارة {fmtDay(f.last_visit)}</span> : <span className="badge bg-slate-100 text-slate-500">لم تُزَر بعد</span>}
              </div>
            </div>
          </div>
          <ul className="mt-3 divide-y divide-indigo-50">
            {f.members.map((m) => (
              <li key={m.id} className="flex items-center gap-2.5 py-1.5">
                <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-primary-600 to-accent-600 text-white">
                  {m.person.image_url ? <Image src={m.person.image_url} alt={m.person.name} fill sizes="36px" className="object-cover" /> : <User className="absolute inset-0 m-auto h-4 w-4" />}
                </div>
                <span className="flex-1 truncate text-sm font-bold">{m.person.name}{m.person_id === data.me.id && <span className="text-[10px] text-violet-600"> (أنا)</span>}</span>
                {m.relation && <span className="badge bg-violet-50 text-violet-700">{relationLabel(m.relation)}</span>}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <EmptyState text="لست مسجَّلًا في عائلة بعد — كاهن كنيستك يضيفك إلى عائلتك" />
      )}

      <h3 className="mb-2 flex items-center gap-2 text-sm font-extrabold text-slate-600"><Cross className="h-4 w-4 text-violet-600" /> {data.priests_fallback ? 'كهنة كنيستك' : `كاهن منطقتك${f?.area_name ? ` — ${f.area_name}` : ''}`}</h3>
      {data.priests.length === 0 ? <EmptyState text="لا يوجد كاهن مسجَّل في كنيستك بعد" /> : (
        <section className="mb-4 space-y-2">
          {data.priests.map((p) => (
            <div key={p.id} className="card flex items-center gap-3 !p-3">
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white">
                {p.image_url ? <Image src={p.image_url} alt={p.name} fill sizes="56px" className="object-cover" /> : <User className="absolute inset-0 m-auto h-7 w-7" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold">{p.title ? `${p.title} ` : ''}{p.name}</p>
                {p.phone && <p className="text-xs text-slate-500" dir="ltr">{p.phone}</p>}
                <div className="mt-1.5 flex gap-1.5">
                  {p.phone && <a href={`tel:${p.phone}`} className="flex items-center gap-1 rounded-xl bg-teal-50 px-2.5 py-1 text-[11px] font-extrabold text-teal-700"><Phone className="h-3.5 w-3.5" /> اتصال</a>}
                  {p.phone && <a href={`https://wa.me/${waNumber(p.phone)}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded-xl bg-emerald-50 px-2.5 py-1 text-[11px] font-extrabold text-emerald-700"><WhatsAppIcon className="h-3.5 w-3.5" /> واتساب</a>}
                </div>
              </div>
              {f && <button id={`visit-${p.id}`} type="button" onClick={() => { setAsking(p); setErr(''); }} className="flex flex-col items-center gap-0.5 rounded-2xl bg-violet-600 px-3 py-2 text-[11px] font-extrabold text-white"><CalendarPlus className="h-5 w-5" /> اطلب زيارة</button>}
            </div>
          ))}
        </section>
      )}

      {active.length > 0 && (
        <section className="mb-4">
          <h3 className="mb-2 text-sm font-extrabold text-slate-600">زيارات عائلتي</h3>
          <ul className="space-y-2">{active.map((v) => (
            <li key={v.id} className="card !p-3">
              <div className="flex items-start gap-2">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-extrabold text-slate-800">{fmtDay(v.on)}{v.time ? ` · ${shortTime(v.time)}` : ''}</p>
                  {v.priest && <p className="text-xs text-slate-500">{v.priest.title ? `${v.priest.title} ` : ''}{v.priest.name}</p>}
                  {v.status === 'approved' && v.requested_by === 'family' && (v.on !== v.requested_on || (v.time ?? '') !== (v.requested_time ?? '')) && (
                    <p className="mt-0.5 text-[11px] font-bold text-amber-700">غيّر الكاهن الموعد (كان {v.requested_on ? fmtDay(v.requested_on) : ''}{v.requested_time ? ` ${shortTime(v.requested_time)}` : ''})</p>
                  )}
                  {v.decision_note && <p className="mt-0.5 text-[11px] text-slate-500">↩ {v.decision_note}</p>}
                  {v.note && <p className="mt-0.5 text-[11px] text-slate-400">💬 {v.note}</p>}
                </div>
                <span className={`badge ${TONE[v.status]}`}>{VISIT_STATUS_LABELS[v.status]}</span>
              </div>
              <button type="button" disabled={busy} onClick={() => cancel(v.id)} className="mt-2 flex items-center gap-1 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600"><X className="h-3.5 w-3.5" /> إلغاء</button>
            </li>
          ))}</ul>
        </section>
      )}

      {history.length > 0 && (
        <section className="mb-4">
          <h3 className="mb-2 text-sm font-extrabold text-slate-600">السجل</h3>
          <ul className="card !p-0 divide-y divide-indigo-50">{history.map((v) => (
            <li key={v.id} className="flex items-center gap-2 px-3 py-2 text-xs">
              <span className="flex-1 font-bold text-slate-700">{fmtDay(v.on)}{v.time ? ` · ${shortTime(v.time)}` : ''}<span className="block text-[11px] font-normal text-slate-400">{v.priest?.name}{v.decision_note ? ` — ${v.decision_note}` : ''} · {fmtDateTime(v.created_at)}</span></span>
              <span className={`badge ${TONE[v.status]}`}>{VISIT_STATUS_LABELS[v.status]}</span>
            </li>
          ))}</ul>
        </section>
      )}

      {asking && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={() => setAsking(null)}>
          <form onSubmit={submit} className="w-full max-w-md space-y-3 rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold">طلب زيارة للعائلة</h3>
              <button type="button" onClick={() => setAsking(null)} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <p className="text-sm text-slate-600">من {asking.title ? `${asking.title} ` : ''}<b>{asking.name}</b> لعائلة <b>{f?.name}</b></p>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="mb-1 block text-xs font-bold text-slate-500">اليوم *</label><input type="date" className="input-field" required min={todayYmd()} value={on} onChange={(e) => setOn(e.target.value)} /></div>
              <div><label className="mb-1 block text-xs font-bold text-slate-500">الوقت المفضَّل</label><input type="time" className="input-field" value={time} onChange={(e) => setTime(e.target.value)} /></div>
            </div>
            <div><label className="mb-1 block text-xs font-bold text-slate-500">ملاحظة</label><input className="input-field" placeholder="مثال: بعد الساعة 6 مساءً" value={note} onChange={(e) => setNote(e.target.value)} /></div>
            {err && <p className="text-xs font-bold text-red-600">{err}</p>}
            <button type="submit" disabled={busy} className="btn-primary flex w-full items-center justify-center gap-2 !bg-gradient-to-br !from-violet-600 !to-violet-800">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <CalendarPlus className="h-5 w-5" />} إرسال الطلب</button>
          </form>
        </div>
      )}
    </>
  );
}
