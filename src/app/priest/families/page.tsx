'use client';

// ---------- Priest portal — العائلات ----------
// Every family of the church: search · place filters (منطقة → شارع → عمارة) ·
// visit chips (الكل / بلا زيارة / زيارة واحدة / زيارتان+ / طلب زيارة / موعد قادم)
// · sort (longest without a visit first · name · newest) · «+ عائلة».
// URL: /priest/families?area=…&street=…&building=…&new=1

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { UsersRound, Plus, Search, ArrowUpDown, Loader2, MapPinned, X } from 'lucide-react';
import PriestShell, { PriestTitle } from '@/components/priest/PriestShell';
import { usePriest } from '@/lib/priest-context';
import { type PriestFamily } from '@/lib/priest-families';
import { FamilyCard, PlaceSelects } from '@/components/priest/FamilyBits';
import FamilyFormModal from '@/components/priest/FamilyFormModal';

type Chip = 'all' | 'never' | 'one' | 'many' | 'request' | 'upcoming';
type Sort = 'days_desc' | 'name' | 'newest' | 'visits';
const SORT_LABELS: Record<Sort, string> = { days_desc: 'الأطول بلا زيارة أولاً', visits: 'الأكثر زيارات', name: 'الاسم', newest: 'الأحدث إضافة' };

export default function FamiliesPage() {
  return (
    <PriestShell>
      <Suspense fallback={<div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-violet-400" /></div>}>
        <Families />
      </Suspense>
    </PriestShell>
  );
}

function Families() {
  const { families, areas, reloadAll } = usePriest();
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState('');
  const [chip, setChip] = useState<Chip>('all');
  const [sort, setSort] = useState<Sort>('days_desc');
  const [place, setPlace] = useState({ area_id: params.get('area'), street_id: params.get('street'), building_id: params.get('building') });
  const [adding, setAdding] = useState(params.get('new') === '1');
  const [showPlace, setShowPlace] = useState(!!(params.get('area') || params.get('street') || params.get('building')));

  // a preset building / street from the URL → fill the chain once the tree is loaded
  useEffect(() => {
    if (!areas) return;
    const b = params.get('building'); const s = params.get('street');
    if (b && !place.area_id) for (const a of areas.areas) for (const st of a.streets) if (st.buildings.some((x) => x.id === b)) setPlace({ area_id: a.id, street_id: st.id, building_id: b });
    else if (s && !place.area_id) for (const a of areas.areas) if (a.streets.some((x) => x.id === s)) setPlace({ area_id: a.id, street_id: s, building_id: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areas]);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    let l = families ?? [];
    if (t) l = l.filter((f) => f.name.toLowerCase().includes(t) || f.code.toLowerCase().includes(t) || (f.phone ?? '').includes(t) || (f.address ?? '').toLowerCase().includes(t)
      || f.members.some((m) => m.person.name.toLowerCase().includes(t) || m.person.national_id.toLowerCase().includes(t) || (m.person.phone ?? '').includes(t)));
    if (place.building_id) l = l.filter((f) => f.building_id === place.building_id);
    else if (place.street_id) l = l.filter((f) => f.street_id === place.street_id);
    else if (place.area_id) l = l.filter((f) => f.area_id === place.area_id);
    if (chip === 'never') l = l.filter((f) => f.visits_count === 0);
    if (chip === 'one') l = l.filter((f) => f.visits_count === 1);
    if (chip === 'many') l = l.filter((f) => f.visits_count >= 2);
    if (chip === 'request') l = l.filter((f) => f.pending_requests > 0);
    if (chip === 'upcoming') l = l.filter((f) => f.next_visit?.status === 'approved');
    const s = [...l];
    switch (sort) {
      case 'days_desc': return s.sort((a, b) => (a.days_since_visit ?? 99999) === (b.days_since_visit ?? 99999) ? a.name.localeCompare(b.name, 'ar') : (b.days_since_visit ?? 99999) - (a.days_since_visit ?? 99999));
      case 'visits': return s.sort((a, b) => b.visits_count - a.visits_count);
      case 'name': return s.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
      default: return s.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
  }, [families, q, place, chip, sort]);

  const scoped = useMemo(() => {
    let l = families ?? [];
    if (place.building_id) l = l.filter((f) => f.building_id === place.building_id);
    else if (place.street_id) l = l.filter((f) => f.street_id === place.street_id);
    else if (place.area_id) l = l.filter((f) => f.area_id === place.area_id);
    return l;
  }, [families, place]);
  const counts: Record<Chip, number> = {
    all: scoped.length,
    never: scoped.filter((f) => f.visits_count === 0).length,
    one: scoped.filter((f) => f.visits_count === 1).length,
    many: scoped.filter((f) => f.visits_count >= 2).length,
    request: scoped.filter((f) => f.pending_requests > 0).length,
    upcoming: scoped.filter((f) => f.next_visit?.status === 'approved').length,
  };
  const CHIPS: { k: Chip; l: string }[] = [
    { k: 'all', l: 'الكل' }, { k: 'never', l: 'بلا زيارة' }, { k: 'one', l: 'زيارة واحدة' }, { k: 'many', l: 'زيارتان+' }, { k: 'request', l: 'طلب زيارة' }, { k: 'upcoming', l: 'موعد قادم' },
  ];
  const placeLabel = useMemo(() => {
    if (!areas) return '';
    const a = areas.areas.find((x) => x.id === place.area_id); const s = a?.streets.find((x) => x.id === place.street_id); const b = s?.buildings.find((x) => x.id === place.building_id);
    return [a?.name, s?.name, b ? `عمارة ${b.name}` : null].filter(Boolean).join(' › ');
  }, [areas, place]);

  const onSaved = (f: PriestFamily) => { setAdding(false); reloadAll(); router.push(`/priest/families/${f.id}?members=1`); };
  const preset = { area_id: place.area_id, street_id: place.street_id, building_id: place.building_id };

  return (
    <>
      <PriestTitle icon={<UsersRound className="h-5 w-5 text-violet-600" />} title="العائلات" sub={`${families?.length ?? 0} عائلة · ${counts.never} بلا زيارة مسجَّلة`}
        action={<button id="pf-add" type="button" onClick={() => setAdding(true)} className="btn-primary flex items-center gap-1 !px-3 !py-2 !bg-gradient-to-br !from-violet-600 !to-violet-800"><Plus className="h-4 w-4" /> عائلة</button>} />

      <div className="mb-3 space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input id="pf-search" className="input-field pr-9" placeholder="اسم العائلة · الكود · الهاتف · اسم فرد" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button type="button" onClick={() => setShowPlace((v) => !v)} aria-pressed={showPlace} className={`flex items-center gap-1 rounded-xl px-3 text-xs font-extrabold ${place.area_id ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600'}`}><MapPinned className="h-4 w-4" /> المكان</button>
        </div>
        {showPlace && (
          <div className="rounded-2xl bg-violet-50/60 p-3">
            <PlaceSelects areas={areas?.areas ?? []} value={place} onChange={setPlace} />
            {place.area_id && <button type="button" onClick={() => setPlace({ area_id: null, street_id: null, building_id: null })} className="mt-2 flex items-center gap-1 text-[11px] font-bold text-slate-500"><X className="h-3 w-3" /> إلغاء تصفية المكان</button>}
          </div>
        )}
        {!showPlace && placeLabel && <p className="flex items-center gap-1 text-[11px] font-bold text-violet-700"><MapPinned className="h-3 w-3" /> {placeLabel} <button type="button" onClick={() => setPlace({ area_id: null, street_id: null, building_id: null })} className="text-slate-400"><X className="h-3 w-3" /></button></p>}
        <div className="flex items-center gap-2">
          <div role="tablist" className="flex flex-1 gap-1 overflow-x-auto rounded-2xl bg-slate-100 p-1">
            {CHIPS.map((c) => (
              <button key={c.k} role="tab" aria-selected={chip === c.k} onClick={() => setChip(c.k)} className={`flex shrink-0 items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-extrabold transition ${chip === c.k ? 'bg-white text-violet-700 shadow' : 'text-slate-500'}`}>
                {c.l}<span className={`tabular-nums ${c.k === 'never' && counts.never ? 'text-rose-600' : c.k === 'request' && counts.request ? 'text-amber-600' : 'text-slate-400'}`}>{counts[c.k]}</span>
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1 text-xs font-bold text-slate-500">
            <ArrowUpDown className="h-4 w-4" />
            <select id="pf-sort" className="input-field !w-auto !py-1.5 text-xs" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="الترتيب">
              {(Object.keys(SORT_LABELS) as Sort[]).map((k) => <option key={k} value={k}>{SORT_LABELS[k]}</option>)}
            </select>
          </label>
        </div>
      </div>

      {families === null ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-violet-400" /></div>
        : list.length === 0 ? (
          <div className="card py-10 text-center">
            <UsersRound className="mx-auto mb-2 h-8 w-8 text-slate-300" />
            <p className="text-sm font-bold text-slate-400">{(families.length === 0) ? 'لا عائلات بعد — ابدأ بـ «+ عائلة»' : 'لا نتائج'}</p>
          </div>
        ) : <ul className="space-y-2">{list.map((f) => <FamilyCard key={f.id} f={f} />)}</ul>}

      {adding && <FamilyFormModal family={null} preset={preset} onSaved={onSaved} onClose={() => setAdding(false)} />}
    </>
  );
}
