'use client';

// ---------- Priest portal — الزيارات ----------
// Family requests first (طلب العائلة), then the arranged visits grouped BY
// DAY — or grouped BY AREA → STREET (to plan a round). «السجل» = the visits
// that happened / were rejected / cancelled in the past 6 months.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Footprints, Inbox, History, Loader2, CalendarDays, MapPinned, Route } from 'lucide-react';
import PriestShell, { PriestTitle } from '@/components/priest/PriestShell';
import { usePriest } from '@/lib/priest-context';
import { createClient } from '@/lib/supabase/client';
import { todayYmd, addDays } from '@/lib/priest-portal';
import { fetchVisits, type Visit } from '@/lib/priest-families';
import { VisitRow, DirectionsButton } from '@/components/priest/FamilyBits';
import { fmtDay } from '@/components/child/ChildBits';

export default function VisitsPage() {
  return <PriestShell><Visits /></PriestShell>;
}

function dayTitle(ymd: string, today: string) {
  if (ymd === today) return `اليوم — ${fmtDay(ymd)}`;
  if (ymd === addDays(today, 1)) return `غدًا — ${fmtDay(ymd)}`;
  if (ymd < today) return `${fmtDay(ymd)} (فات)`;
  return fmtDay(ymd);
}

function Visits() {
  const { token, visits, reloadAll } = usePriest();
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [tab, setTab] = useState<'upcoming' | 'history'>('upcoming');
  const [group, setGroup] = useState<'day' | 'place'>('day');
  const [past, setPast] = useState<Visit[] | null>(null);
  const today = todayYmd();

  useEffect(() => {
    if (tab !== 'history' || !token) return;
    let alive = true;
    fetchVisits(supabase, token, { includePast: true, from: addDays(today, -180), to: today }).then((r) => { if (alive) setPast([...r].filter((v) => v.status === 'done' || v.status === 'rejected' || v.status === 'cancelled').reverse()); }).catch(() => { if (alive) setPast([]); });
    return () => { alive = false; };
  }, [tab, token, supabase, today, visits]);

  const pending = useMemo(() => (visits ?? []).filter((v) => v.status === 'pending'), [visits]);
  const approved = useMemo(() => (visits ?? []).filter((v) => v.status === 'approved'), [visits]);
  const byDay = useMemo(() => {
    const m = new Map<string, Visit[]>();
    for (const v of approved) { const l = m.get(v.on) ?? []; l.push(v); m.set(v.on, l); }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [approved]);
  const byPlace = useMemo(() => {
    const m = new Map<string, { area: string; street: string; list: Visit[] }>();
    for (const v of approved) {
      const key = `${v.family.area_id ?? ''}|${v.family.street_id ?? ''}`;
      const g = m.get(key) ?? { area: v.family.area_name ?? 'بلا منطقة', street: v.family.street_name ?? 'بلا شارع', list: [] };
      g.list.push(v); m.set(key, g);
    }
    return Array.from(m.values()).sort((a, b) => a.area.localeCompare(b.area, 'ar') || a.street.localeCompare(b.street, 'ar'));
  }, [approved]);
  const openFamily = (id: string) => router.push(`/priest/families/${id}`);

  return (
    <>
      <PriestTitle icon={<Footprints className="h-5 w-5 text-violet-600" />} title="الزيارات" sub="طلبات العائلات وزياراتك المرتَّبة — بالأيام أو بالمناطق والشوارع لتنظيم جولتك" />
      <div role="tablist" className="mb-3 grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
        <button role="tab" aria-selected={tab === 'upcoming'} onClick={() => setTab('upcoming')} className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-extrabold ${tab === 'upcoming' ? 'bg-white text-violet-700 shadow' : 'text-slate-500'}`}><CalendarDays className="h-4 w-4" /> القادمة{pending.length > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-[10px] text-white tabular-nums">{pending.length}</span>}</button>
        <button role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')} className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-extrabold ${tab === 'history' ? 'bg-white text-violet-700 shadow' : 'text-slate-500'}`}><History className="h-4 w-4" /> السجل</button>
      </div>

      {tab === 'upcoming' && (
        <>
          {pending.length > 0 && (
            <section className="card mb-3 !p-0 overflow-hidden ring-1 ring-amber-200">
              <h3 className="flex items-center gap-2 bg-amber-50 px-4 py-2 text-sm font-extrabold text-amber-800"><Inbox className="h-4 w-4" /> طلبات زيارة بانتظارك ({pending.length})</h3>
              <ul className="divide-y divide-indigo-50 px-4">{pending.map((v) => <VisitRow key={v.id} v={v} onChanged={reloadAll} onOpenFamily={openFamily} />)}</ul>
            </section>
          )}
          {approved.length > 0 && (
            <div role="tablist" className="mb-2 flex gap-1 rounded-2xl bg-violet-50 p-1">
              <button role="tab" aria-selected={group === 'day'} onClick={() => setGroup('day')} className={`flex flex-1 items-center justify-center gap-1 rounded-xl py-1.5 text-xs font-extrabold ${group === 'day' ? 'bg-white text-violet-700 shadow' : 'text-slate-500'}`}><CalendarDays className="h-3.5 w-3.5" /> بالأيام</button>
              <button role="tab" aria-selected={group === 'place'} onClick={() => setGroup('place')} className={`flex flex-1 items-center justify-center gap-1 rounded-xl py-1.5 text-xs font-extrabold ${group === 'place' ? 'bg-white text-violet-700 shadow' : 'text-slate-500'}`}><MapPinned className="h-3.5 w-3.5" /> بالمناطق والشوارع</button>
            </div>
          )}
          {visits === null ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-violet-400" /></div>
            : approved.length === 0 ? <div className="card py-10 text-center text-sm font-bold text-slate-400">لا زيارات مرتَّبة قادمة — من صفحة العائلة اختر «ترتيب زيارة»</div>
            : group === 'day' ? byDay.map(([day, list]) => (
              <section key={day} className="card mb-3 !p-0 overflow-hidden">
                <h3 className={`flex items-center justify-between px-4 py-2 text-sm font-extrabold ${day === today ? 'bg-sky-50 text-sky-800' : day < today ? 'bg-slate-50 text-slate-500' : 'bg-violet-50 text-violet-800'}`}>
                  <span>{dayTitle(day, today)}</span><span className="badge bg-white/70 tabular-nums">{list.length}</span>
                </h3>
                <ul className="divide-y divide-indigo-50 px-4">{list.map((v) => <VisitRow key={v.id} v={v} onChanged={reloadAll} onOpenFamily={openFamily} />)}</ul>
              </section>
            )) : byPlace.map((g) => (
              <section key={`${g.area}|${g.street}`} className="card mb-3 !p-0 overflow-hidden">
                <h3 className="flex items-center justify-between bg-violet-50 px-4 py-2 text-sm font-extrabold text-violet-800">
                  <span className="flex items-center gap-1.5"><MapPinned className="h-4 w-4" />{g.area}<Route className="h-3.5 w-3.5 text-violet-400" />{g.street}</span>
                  <span className="flex items-center gap-1.5"><span className="badge bg-white/70 tabular-nums">{g.list.length}</span><DirectionsButton loc={g.list[0].family.location} size="sm" label="ابدأ" /></span>
                </h3>
                <ul className="divide-y divide-indigo-50 px-4">{g.list.map((v) => <VisitRow key={v.id} v={v} onChanged={reloadAll} onOpenFamily={openFamily} />)}</ul>
              </section>
            ))}
        </>
      )}

      {tab === 'history' && (
        past === null ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-violet-400" /></div>
          : past.length === 0 ? <div className="card py-10 text-center text-sm font-bold text-slate-400">لا سجل في آخر 6 أشهر</div>
          : <section className="card !p-0 overflow-hidden"><ul className="divide-y divide-indigo-50 px-4">{past.map((v) => <VisitRow key={v.id} v={v} onChanged={reloadAll} onOpenFamily={openFamily} />)}</ul></section>
      )}
    </>
  );
}
