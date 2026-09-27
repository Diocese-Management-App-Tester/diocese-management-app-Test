'use client';

// ---------- Priest portal — المعترفين ----------
// Search · filter (الكل / متأخرون / لديهم موعد) · sort by the period since the
// last confession · «إضافة» (scan / search / new person) · details sheet.

import { useMemo, useState } from 'react';
import { Users, UserPlus, Search, ArrowUpDown } from 'lucide-react';
import PriestShell, { PriestTitle } from '@/components/priest/PriestShell';
import { usePriest } from '@/lib/priest-context';
import { ConfessorCard, sortConfessors, SORT_LABELS, type ConfessorSort } from '@/components/priest/ConfessorBits';
import ConfessorModal from '@/components/priest/ConfessorModal';
import AddConfessorPanel from '@/components/priest/AddConfessorPanel';
import type { Confessor } from '@/lib/priest-portal';

type Filter = 'all' | 'overdue' | 'appt' | 'never';

export default function ConfessorsPage() {
  return <PriestShell><Confessors /></PriestShell>;
}

function Confessors() {
  const { profile, confessors, reloadAll } = usePriest();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<ConfessorSort>('days_desc');
  const [open, setOpen] = useState<Confessor | null>(null);
  const [adding, setAdding] = useState(false);
  const reminder = profile?.priest.reminder_days ?? 40;

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    let l = confessors ?? [];
    if (t) l = l.filter((c) => c.person.name.toLowerCase().includes(t) || (c.person.phone ?? '').includes(t) || c.person.national_id.toLowerCase().includes(t));
    if (filter === 'overdue') l = l.filter((c) => c.overdue);
    if (filter === 'appt') l = l.filter((c) => c.next_appointment);
    if (filter === 'never') l = l.filter((c) => !c.last_confession);
    return sortConfessors(l, sort);
  }, [confessors, q, filter, sort]);
  const counts = useMemo(() => ({
    all: confessors?.length ?? 0,
    overdue: (confessors ?? []).filter((c) => c.overdue).length,
    appt: (confessors ?? []).filter((c) => c.next_appointment).length,
    never: (confessors ?? []).filter((c) => !c.last_confession).length,
  }), [confessors]);
  const current = open ? (confessors ?? []).find((c) => c.id === open.id) ?? open : null;

  const FILTERS: { k: Filter; l: string }[] = [{ k: 'all', l: 'الكل' }, { k: 'overdue', l: 'متأخرون' }, { k: 'appt', l: 'لديهم موعد' }, { k: 'never', l: 'بلا اعتراف' }];

  return (
    <>
      <PriestTitle icon={<Users className="h-5 w-5 text-violet-600" />} title="المعترفون" sub={`${counts.all} معترف · التذكير بعد ${reminder} يومًا`}
        action={<button id="pc-add" type="button" onClick={() => setAdding(true)} className="btn-primary flex items-center gap-1 !px-3 !py-2 !bg-gradient-to-br !from-violet-600 !to-violet-800"><UserPlus className="h-4 w-4" /> إضافة</button>} />

      <div className="mb-3 space-y-2">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input id="pc-search" className="input-field pr-9" placeholder="بحث بالاسم · الهاتف · الكود" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <div role="tablist" className="flex flex-1 gap-1 overflow-x-auto rounded-2xl bg-slate-100 p-1">
            {FILTERS.map((f) => (
              <button key={f.k} role="tab" aria-selected={filter === f.k} onClick={() => setFilter(f.k)} className={`flex shrink-0 items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-extrabold transition ${filter === f.k ? 'bg-white text-violet-700 shadow' : 'text-slate-500'}`}>
                {f.l}<span className={`tabular-nums ${f.k === 'overdue' && counts.overdue ? 'text-rose-600' : 'text-slate-400'}`}>{counts[f.k]}</span>
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1 text-xs font-bold text-slate-500">
            <ArrowUpDown className="h-4 w-4" />
            <select id="pc-sort" className="input-field !w-auto !py-1.5 text-xs" value={sort} onChange={(e) => setSort(e.target.value as ConfessorSort)} aria-label="الترتيب">
              {(Object.keys(SORT_LABELS) as ConfessorSort[]).map((k) => <option key={k} value={k}>{SORT_LABELS[k]}</option>)}
            </select>
          </label>
        </div>
      </div>

      {confessors === null ? <div className="card py-8 text-center text-xs text-slate-400">جارٍ التحميل...</div>
        : list.length === 0 ? (
          <div className="card py-10 text-center">
            <Users className="mx-auto mb-2 h-8 w-8 text-slate-300" />
            <p className="text-sm font-bold text-slate-400">{counts.all === 0 ? 'لا معترفون بعد — ابدأ بـ «إضافة»' : 'لا نتائج'}</p>
          </div>
        ) : <ul className="space-y-2">{list.map((c) => <ConfessorCard key={c.id} c={c} reminderDays={reminder} onOpen={setOpen} onChanged={reloadAll} />)}</ul>}

      {current && <ConfessorModal c={current} onClose={() => setOpen(null)} onChanged={reloadAll} />}
      {adding && <AddConfessorPanel onAdded={() => reloadAll()} onClose={() => setAdding(false)} />}
    </>
  );
}
