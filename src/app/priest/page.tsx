'use client';

// ---------- Priest portal — الرئيسية ----------
// Greeting · counters (المعترفين · متأخرون · طلبات · مواعيد اليوم) ·
// today's appointments · pending requests · the overdue reminder list.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Users, AlertTriangle, CalendarClock, Inbox, ChevronLeft, Cross, Clock, PhoneCall } from 'lucide-react';
import PriestShell, { PriestTitle } from '@/components/priest/PriestShell';
import { usePriest } from '@/lib/priest-context';
import { ConfessorCard, AppointmentRow, sortConfessors } from '@/components/priest/ConfessorBits';
import ConfessorModal from '@/components/priest/ConfessorModal';
import { todayYmd, type Confessor } from '@/lib/priest-portal';

export default function PriestHomePage() {
  return <PriestShell><Home /></PriestShell>;
}

function Home() {
  const { profile, confessors, appointments, reloadAll } = usePriest();
  const [open, setOpen] = useState<Confessor | null>(null);
  const today = todayYmd();
  const reminder = profile?.priest.reminder_days ?? 40;
  const overdue = useMemo(() => sortConfessors((confessors ?? []).filter((c) => c.overdue), 'days_desc'), [confessors]);
  const pending = useMemo(() => (appointments ?? []).filter((a) => a.status === 'pending'), [appointments]);
  const todays = useMemo(() => (appointments ?? []).filter((a) => a.status === 'approved' && a.on === today), [appointments, today]);
  const current = open ? (confessors ?? []).find((c) => c.id === open.id) ?? open : null;
  if (!profile) return null;

  const kpi = (icon: React.ReactNode, value: number, label: string, tone: string, href: string) => (
    <Link href={href} className={`card flex items-center gap-3 ${tone}`}>
      <span className="rounded-xl bg-white/70 p-2">{icon}</span>
      <div><p className="text-2xl font-extrabold tabular-nums leading-tight">{value}</p><p className="text-xs font-bold text-slate-500">{label}</p></div>
    </Link>
  );

  return (
    <>
      <PriestTitle icon={<Cross className="h-5 w-5 text-violet-600" />} title={`أهلًا ${profile.priest.title ? `${profile.priest.title} ` : ''}${profile.person.name}`} sub={profile.church.name} />
      <div className="mb-4 grid grid-cols-2 gap-2">
        {kpi(<Users className="h-5 w-5 text-violet-600" />, profile.counts.confessors, 'المعترفون', 'bg-violet-50', '/priest/confessors')}
        {kpi(<AlertTriangle className="h-5 w-5 text-rose-600" />, profile.counts.overdue, `أكثر من ${reminder} يومًا بلا اعتراف`, profile.counts.overdue ? 'bg-rose-50' : 'bg-emerald-50', '/priest/followup')}
        {kpi(<Inbox className="h-5 w-5 text-amber-600" />, profile.counts.pending_appointments, 'طلبات مواعيد', 'bg-amber-50', '/priest/appointments')}
        {kpi(<CalendarClock className="h-5 w-5 text-sky-600" />, profile.counts.today_appointments, 'مواعيد اليوم', 'bg-sky-50', '/priest/appointments')}
      </div>

      {todays.length > 0 && (
        <section className="card mb-4 !p-0 overflow-hidden">
          <h3 className="flex items-center gap-2 bg-sky-50 px-4 py-2 text-sm font-extrabold text-sky-800"><Clock className="h-4 w-4" /> مواعيد اليوم</h3>
          <ul className="divide-y divide-indigo-50 px-4">{todays.map((a) => <AppointmentRow key={a.id} a={a} onChanged={reloadAll} onOpenPerson={(pid) => setOpen((confessors ?? []).find((c) => c.person_id === pid) ?? null)} />)}</ul>
        </section>
      )}

      {pending.length > 0 && (
        <section className="card mb-4 !p-0 overflow-hidden">
          <h3 className="flex items-center justify-between bg-amber-50 px-4 py-2 text-sm font-extrabold text-amber-800">
            <span className="flex items-center gap-2"><Inbox className="h-4 w-4" /> طلبات مواعيد بانتظارك</span>
            <Link href="/priest/appointments" className="flex items-center text-xs">الكل <ChevronLeft className="h-3.5 w-3.5" /></Link>
          </h3>
          <ul className="divide-y divide-indigo-50 px-4">{pending.slice(0, 3).map((a) => <AppointmentRow key={a.id} a={a} onChanged={reloadAll} onOpenPerson={(pid) => setOpen((confessors ?? []).find((c) => c.person_id === pid) ?? null)} />)}</ul>
        </section>
      )}

      <section className="mb-4">
        <h3 className="mb-2 flex items-center justify-between text-sm font-extrabold text-slate-600">
          <span className="flex items-center gap-2"><PhoneCall className="h-4 w-4 text-rose-500" /> تذكير الافتقاد — أكثر من {reminder} يومًا</span>
          {overdue.length > 5 && <Link href="/priest/followup" className="flex items-center text-xs text-violet-700">الكل ({overdue.length}) <ChevronLeft className="h-3.5 w-3.5" /></Link>}
        </h3>
        {confessors === null ? <div className="card py-6 text-center text-xs text-slate-400">جارٍ التحميل...</div>
          : overdue.length === 0 ? <div className="card py-6 text-center text-sm font-bold text-emerald-700">كل المعترفين اعترفوا خلال {reminder} يومًا 🙏</div>
          : <ul className="space-y-2">{overdue.slice(0, 5).map((c) => <ConfessorCard key={c.id} c={c} reminderDays={reminder} onOpen={setOpen} onChanged={reloadAll} compact />)}</ul>}
      </section>
      {current && <ConfessorModal c={current} onClose={() => setOpen(null)} onChanged={reloadAll} />}
    </>
  );
}
