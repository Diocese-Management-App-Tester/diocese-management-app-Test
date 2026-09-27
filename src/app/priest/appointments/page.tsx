'use client';

// ---------- Priest portal — المواعيد ----------
// Pending requests first, then the confirmed appointments grouped BY DAY.
// «السجل» loads the past (done / rejected / cancelled) too.

import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Inbox, History, Loader2, CalendarPlus } from 'lucide-react';
import PriestShell, { PriestTitle } from '@/components/priest/PriestShell';
import { usePriest } from '@/lib/priest-context';
import { AppointmentRow } from '@/components/priest/ConfessorBits';
import ConfessorModal from '@/components/priest/ConfessorModal';
import { createClient } from '@/lib/supabase/client';
import { fetchAppointments, todayYmd, addDays, type Appointment, type Confessor } from '@/lib/priest-portal';
import { fmtDay } from '@/components/child/ChildBits';

export default function AppointmentsPage() {
  return <PriestShell><Appointments /></PriestShell>;
}

function dayTitle(ymd: string, today: string) {
  if (ymd === today) return `اليوم — ${fmtDay(ymd)}`;
  if (ymd === addDays(today, 1)) return `غدًا — ${fmtDay(ymd)}`;
  if (ymd < today) return `${fmtDay(ymd)} (فات)`;
  return fmtDay(ymd);
}

function Appointments() {
  const { token, appointments, confessors, reloadAll } = usePriest();
  const [supabase] = useState(() => createClient());
  const [tab, setTab] = useState<'upcoming' | 'history'>('upcoming');
  const [past, setPast] = useState<Appointment[] | null>(null);
  const [open, setOpen] = useState<Confessor | null>(null);
  const today = todayYmd();

  useEffect(() => {
    if (tab !== 'history' || !token) return;
    let alive = true;
    fetchAppointments(supabase, token, { includePast: true, from: addDays(today, -180), to: addDays(today, -1) }).then((r) => { if (alive) setPast([...r].reverse()); }).catch(() => { if (alive) setPast([]); });
    return () => { alive = false; };
  }, [tab, token, supabase, today, appointments]);

  const pending = useMemo(() => (appointments ?? []).filter((a) => a.status === 'pending'), [appointments]);
  const byDay = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of (appointments ?? []).filter((a) => a.status === 'approved')) { const l = m.get(a.on) ?? []; l.push(a); m.set(a.on, l); }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [appointments]);
  const openPerson = (pid: string) => setOpen((confessors ?? []).find((c) => c.person_id === pid) ?? null);
  const current = open ? (confessors ?? []).find((c) => c.id === open.id) ?? open : null;

  return (
    <>
      <PriestTitle icon={<CalendarClock className="h-5 w-5 text-violet-600" />} title="مواعيد الاعتراف" sub="طلبات المخدومين ومواعيدك مرتبة بالأيام — لتحديد موعد جديد افتح المعترف واختر «موعد»" />
      <div role="tablist" className="mb-3 grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
        <button role="tab" aria-selected={tab === 'upcoming'} onClick={() => setTab('upcoming')} className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-extrabold ${tab === 'upcoming' ? 'bg-white text-violet-700 shadow' : 'text-slate-500'}`}><CalendarPlus className="h-4 w-4" /> القادمة{pending.length > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-[10px] text-white tabular-nums">{pending.length}</span>}</button>
        <button role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')} className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-extrabold ${tab === 'history' ? 'bg-white text-violet-700 shadow' : 'text-slate-500'}`}><History className="h-4 w-4" /> السجل</button>
      </div>

      {tab === 'upcoming' && (
        <>
          {pending.length > 0 && (
            <section className="card mb-3 !p-0 overflow-hidden ring-1 ring-amber-200">
              <h3 className="flex items-center gap-2 bg-amber-50 px-4 py-2 text-sm font-extrabold text-amber-800"><Inbox className="h-4 w-4" /> طلبات بانتظار موافقتك ({pending.length})</h3>
              <ul className="divide-y divide-indigo-50 px-4">{pending.map((a) => <AppointmentRow key={a.id} a={a} onChanged={reloadAll} onOpenPerson={openPerson} />)}</ul>
            </section>
          )}
          {appointments === null ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-violet-400" /></div>
            : byDay.length === 0 ? <div className="card py-10 text-center text-sm font-bold text-slate-400">لا مواعيد مؤكَّدة قادمة</div>
            : byDay.map(([day, list]) => (
              <section key={day} className="card mb-3 !p-0 overflow-hidden">
                <h3 className={`flex items-center justify-between px-4 py-2 text-sm font-extrabold ${day === today ? 'bg-sky-50 text-sky-800' : day < today ? 'bg-slate-50 text-slate-500' : 'bg-violet-50 text-violet-800'}`}>
                  <span>{dayTitle(day, today)}</span><span className="badge bg-white/70 tabular-nums">{list.length}</span>
                </h3>
                <ul className="divide-y divide-indigo-50 px-4">{list.map((a: Appointment) => <AppointmentRow key={a.id} a={a} onChanged={reloadAll} onOpenPerson={openPerson} />)}</ul>
              </section>
            ))}
        </>
      )}

      {tab === 'history' && (
        past === null ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-violet-400" /></div>
          : past.length === 0 ? <div className="card py-10 text-center text-sm font-bold text-slate-400">لا سجل في آخر 6 أشهر</div>
          : <section className="card !p-0 overflow-hidden"><ul className="divide-y divide-indigo-50 px-4">{past.map((a) => <AppointmentRow key={a.id} a={a} onChanged={reloadAll} onOpenPerson={openPerson} />)}</ul></section>
      )}
      {current && <ConfessorModal c={current} onClose={() => setOpen(null)} onChanged={reloadAll} />}
    </>
  );
}
