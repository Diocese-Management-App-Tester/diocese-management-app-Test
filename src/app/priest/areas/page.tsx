'use client';

// ---------- Priest portal — المناطق والشوارع والعمارات ----------
// The geographic tree of the priest's church:
//   منطقة (connected to one or more priests · location)
//     └ شارع (location)
//         └ عمارة (number · floors · location) → families live here
// Every level: add · edit · delete · «الاتجاهات». Tap a family counter to
// open the families list filtered by that place.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { MapPinned, Plus, Pencil, Trash2, ChevronDown, ChevronLeft, Loader2, Building2, Route, UsersRound, Cross, X, Check } from 'lucide-react';
import PriestShell, { PriestTitle, PersonPhoto } from '@/components/priest/PriestShell';
import { usePriest } from '@/lib/priest-context';
import { createClient } from '@/lib/supabase/client';
import {
  type Area, type Street, type Building, type LocationInput, type PriestShort,
  saveArea, deleteArea, saveStreet, deleteStreet, saveBuilding, deleteBuilding, familyErrorMessage,
} from '@/lib/priest-families';
import { LocationFields, emptyLocation, DirectionsButton, LocationLine, ConfirmDelete } from '@/components/priest/FamilyBits';

export default function AreasPage() {
  return <PriestShell><Areas /></PriestShell>;
}

type Editing =
  | { kind: 'area'; area: Area | null }
  | { kind: 'street'; areaId: string; street: Street | null }
  | { kind: 'building'; streetId: string; building: Building | null }
  | null;
type Deleting = { kind: 'area' | 'street' | 'building'; id: string; name: string; families: number } | null;

function Areas() {
  const { areas, profile, reloadAll } = usePriest();
  const [openArea, setOpenArea] = useState<string | null>(null);
  const [openStreet, setOpenStreet] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<Deleting>(null);
  const [onlyMine, setOnlyMine] = useState(false);
  const list = useMemo(() => (areas?.areas ?? []).filter((a) => !onlyMine || a.is_mine), [areas, onlyMine]);
  const myId = profile?.priest.id;

  return (
    <>
      <PriestTitle icon={<MapPinned className="h-5 w-5 text-violet-600" />} title="المناطق والشوارع"
        sub={`${areas?.areas.length ?? 0} منطقة · ${areas?.areas.filter((a) => a.is_mine).length ?? 0} مرتبطة بك — كل منطقة فيها شوارع وعمارات تسكنها العائلات`}
        action={<button id="pa-add" type="button" onClick={() => setEditing({ kind: 'area', area: null })} className="btn-primary flex items-center gap-1 !px-3 !py-2 !bg-gradient-to-br !from-violet-600 !to-violet-800"><Plus className="h-4 w-4" /> منطقة</button>} />

      {(areas?.areas.length ?? 0) > 0 && (
        <div role="tablist" className="mb-3 grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
          <button role="tab" aria-selected={!onlyMine} onClick={() => setOnlyMine(false)} className={`rounded-xl py-1.5 text-xs font-extrabold ${!onlyMine ? 'bg-white text-violet-700 shadow' : 'text-slate-500'}`}>كل مناطق الكنيسة</button>
          <button role="tab" aria-selected={onlyMine} onClick={() => setOnlyMine(true)} className={`rounded-xl py-1.5 text-xs font-extrabold ${onlyMine ? 'bg-white text-violet-700 shadow' : 'text-slate-500'}`}>مناطقي</button>
        </div>
      )}

      {areas === null ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-violet-400" /></div>
        : list.length === 0 ? (
          <div className="card py-10 text-center">
            <MapPinned className="mx-auto mb-2 h-8 w-8 text-slate-300" />
            <p className="text-sm font-bold text-slate-400">{onlyMine ? 'لا مناطق مرتبطة بك' : 'لا مناطق بعد — أنشئ أول منطقة ثم أضف شوارعها وعماراتها'}</p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {list.map((a) => {
              const open = openArea === a.id;
              return (
                <li key={a.id} className={`card !p-0 overflow-hidden ${a.is_mine ? 'ring-1 ring-violet-200' : ''}`}>
                  <div className="flex items-start gap-2 p-3">
                    <button type="button" onClick={() => setOpenArea(open ? null : a.id)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><MapPinned className="h-5 w-5" /></button>
                    <div className="min-w-0 flex-1">
                      <button type="button" onClick={() => setOpenArea(open ? null : a.id)} className="flex w-full items-center gap-1 text-right text-sm font-extrabold text-slate-800">
                        <span className="truncate">{a.name}</span>{a.is_mine && <span className="badge bg-violet-100 text-violet-700">منطقتي</span>}
                        <ChevronDown className={`mr-auto h-4 w-4 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
                      </button>
                      {a.description && <p className="truncate text-[11px] text-slate-500">{a.description}</p>}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-slate-500">
                        <span className="badge bg-slate-100 text-slate-500"><Route className="ml-1 h-3 w-3" />{a.streets.length} شارع</span>
                        <span className="badge bg-slate-100 text-slate-500"><Building2 className="ml-1 h-3 w-3" />{a.streets.reduce((n, s) => n + s.buildings.length, 0)} عمارة</span>
                        <Link href={`/priest/families?area=${a.id}`} className="badge bg-emerald-50 text-emerald-700"><UsersRound className="ml-1 h-3 w-3" />{a.families_count} عائلة</Link>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <Cross className="h-3 w-3 text-violet-500" />
                        {a.priests.length === 0 ? <span className="text-[11px] font-bold text-amber-600">لا كاهن مرتبط — اضغط «تعديل»</span>
                          : a.priests.map((p) => <span key={p.id} className={`badge ${p.id === myId ? 'bg-violet-600 text-white' : 'bg-violet-50 text-violet-700'}`}>{p.title ? `${p.title} ` : ''}{p.name}</span>)}
                      </div>
                      <LocationLine loc={a.location} />
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex gap-1">
                        <button type="button" onClick={() => setEditing({ kind: 'area', area: a })} aria-label="تعديل" className="rounded-lg bg-slate-100 p-1.5 text-slate-600"><Pencil className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={() => setDeleting({ kind: 'area', id: a.id, name: a.name, families: a.families_count })} aria-label="حذف" className="rounded-lg bg-red-50 p-1.5 text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                      <DirectionsButton loc={a.location} size="sm" />
                    </div>
                  </div>

                  {open && (
                    <div className="border-t border-violet-50 bg-violet-50/40 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs font-extrabold text-slate-600">الشوارع ({a.streets.length})</p>
                        <button type="button" onClick={() => setEditing({ kind: 'street', areaId: a.id, street: null })} className="flex items-center gap-1 rounded-xl bg-violet-600 px-2.5 py-1 text-[11px] font-extrabold text-white"><Plus className="h-3.5 w-3.5" /> شارع</button>
                      </div>
                      {a.streets.length === 0 ? <p className="py-3 text-center text-xs font-bold text-slate-400">لا شوارع بعد</p> : (
                        <ul className="space-y-1.5">
                          {a.streets.map((s) => {
                            const sOpen = openStreet === s.id;
                            return (
                              <li key={s.id} className="rounded-2xl bg-white p-2.5 shadow-sm">
                                <div className="flex items-start gap-2">
                                  <button type="button" onClick={() => setOpenStreet(sOpen ? null : s.id)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700"><Route className="h-4 w-4" /></button>
                                  <div className="min-w-0 flex-1">
                                    <button type="button" onClick={() => setOpenStreet(sOpen ? null : s.id)} className="flex w-full items-center text-right text-sm font-extrabold text-slate-800"><span className="truncate">{s.name}</span><ChevronDown className={`mr-auto h-4 w-4 text-slate-400 transition ${sOpen ? 'rotate-180' : ''}`} /></button>
                                    <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px]">
                                      <span className="badge bg-slate-100 text-slate-500"><Building2 className="ml-1 h-3 w-3" />{s.buildings.length} عمارة</span>
                                      <Link href={`/priest/families?street=${s.id}`} className="badge bg-emerald-50 text-emerald-700"><UsersRound className="ml-1 h-3 w-3" />{s.families_count} عائلة</Link>
                                    </div>
                                    <LocationLine loc={s.location} />
                                  </div>
                                  <div className="flex flex-col items-end gap-1">
                                    <div className="flex gap-1">
                                      <button type="button" onClick={() => setEditing({ kind: 'street', areaId: a.id, street: s })} aria-label="تعديل" className="rounded-lg bg-slate-100 p-1.5 text-slate-600"><Pencil className="h-3.5 w-3.5" /></button>
                                      <button type="button" onClick={() => setDeleting({ kind: 'street', id: s.id, name: s.name, families: s.families_count })} aria-label="حذف" className="rounded-lg bg-red-50 p-1.5 text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                                    </div>
                                    <DirectionsButton loc={s.location} size="sm" />
                                  </div>
                                </div>
                                {sOpen && (
                                  <div className="mt-2 border-t border-slate-100 pt-2">
                                    <div className="mb-1.5 flex items-center justify-between">
                                      <p className="text-[11px] font-extrabold text-slate-500">العمارات ({s.buildings.length})</p>
                                      <button type="button" onClick={() => setEditing({ kind: 'building', streetId: s.id, building: null })} className="flex items-center gap-1 rounded-xl bg-sky-600 px-2.5 py-1 text-[11px] font-extrabold text-white"><Plus className="h-3.5 w-3.5" /> عمارة</button>
                                    </div>
                                    {s.buildings.length === 0 ? <p className="py-2 text-center text-[11px] font-bold text-slate-400">لا عمارات بعد</p> : (
                                      <ul className="divide-y divide-slate-50">
                                        {s.buildings.map((b) => (
                                          <li key={b.id} className="flex items-start gap-2 py-1.5">
                                            <Building2 className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
                                            <div className="min-w-0 flex-1">
                                              <p className="text-xs font-extrabold text-slate-700">{b.name}{b.number ? <span className="text-slate-400"> · رقم {b.number}</span> : ''}{b.floors_count != null ? <span className="text-slate-400"> · {b.floors_count} أدوار</span> : ''}</p>
                                              <div className="mt-0.5 flex flex-wrap gap-1.5">
                                                <Link href={`/priest/families?building=${b.id}`} className="badge bg-emerald-50 text-emerald-700"><UsersRound className="ml-1 h-3 w-3" />{b.families_count} عائلة</Link>
                                                <Link href={`/priest/families?new=1&building=${b.id}`} className="badge bg-violet-50 text-violet-700"><Plus className="ml-1 h-3 w-3" />عائلة هنا</Link>
                                              </div>
                                              <LocationLine loc={b.location} />
                                            </div>
                                            <div className="flex flex-col items-end gap-1">
                                              <div className="flex gap-1">
                                                <button type="button" onClick={() => setEditing({ kind: 'building', streetId: s.id, building: b })} aria-label="تعديل" className="rounded-lg bg-slate-100 p-1.5 text-slate-600"><Pencil className="h-3.5 w-3.5" /></button>
                                                <button type="button" onClick={() => setDeleting({ kind: 'building', id: b.id, name: b.name, families: b.families_count })} aria-label="حذف" className="rounded-lg bg-red-50 p-1.5 text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                                              </div>
                                              <DirectionsButton loc={b.location} size="sm" />
                                            </div>
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

      <p className="mt-4 flex items-center gap-1 text-[11px] text-slate-400"><ChevronLeft className="h-3 w-3" /> العائلات تُربط بالمنطقة والشارع والعمارة من <Link href="/priest/families" className="text-violet-700 underline">صفحة العائلات</Link></p>

      {editing && <EditPlaceModal editing={editing} churchPriests={areas?.church_priests ?? []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reloadAll(); }} />}
      {deleting && <DeletePlace d={deleting} onClose={() => setDeleting(null)} onDone={() => { setDeleting(null); reloadAll(); }} />}
    </>
  );
}

// ---------- add / edit modal (area · street · building) ----------
function EditPlaceModal({ editing, churchPriests, onClose, onSaved }: { editing: NonNullable<Editing>; churchPriests: PriestShort[]; onClose: () => void; onSaved: () => void }) {
  const { token, profile } = usePriest();
  const [supabase] = useState(() => createClient());
  const row = editing.kind === 'area' ? editing.area : editing.kind === 'street' ? editing.street : editing.building;
  const [name, setName] = useState(row?.name ?? '');
  const [description, setDescription] = useState(editing.kind === 'area' ? editing.area?.description ?? '' : '');
  const [number, setNumber] = useState(editing.kind === 'building' ? editing.building?.number ?? '' : '');
  const [floors, setFloors] = useState(editing.kind === 'building' && editing.building?.floors_count != null ? String(editing.building.floors_count) : '');
  const [priestIds, setPriestIds] = useState<string[]>(editing.kind === 'area' ? (editing.area?.priest_ids ?? (profile ? [profile.priest.id] : [])) : []);
  const [loc, setLoc] = useState<LocationInput>(row ? { lat: row.lat, lng: row.lng, maps_url: row.maps_url, location_note: row.location_note } : emptyLocation());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const title = editing.kind === 'area' ? (row ? 'تعديل المنطقة' : 'منطقة جديدة') : editing.kind === 'street' ? (row ? 'تعديل الشارع' : 'شارع جديد') : (row ? 'تعديل العمارة' : 'عمارة جديدة');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (!name.trim()) { setErr('الاسم مطلوب'); return; }
    if ((loc.lat == null) !== (loc.lng == null)) { setErr('أدخل خط العرض وخط الطول معًا'); return; }
    setBusy(true); setErr('');
    try {
      if (editing.kind === 'area') await saveArea(supabase, token, { id: editing.area?.id ?? null, name, description: description || null, ...loc, priest_ids: priestIds });
      else if (editing.kind === 'street') await saveStreet(supabase, token, { id: editing.street?.id ?? null, area_id: editing.areaId, name, ...loc });
      else await saveBuilding(supabase, token, { id: editing.building?.id ?? null, street_id: editing.streetId, name, number: number || null, floors_count: floors === '' ? null : Number(floors), ...loc });
      onSaved();
    } catch (er) { setErr(familyErrorMessage(er)); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <form onSubmit={submit} className="max-h-[92vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-extrabold">{title}</h3>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">الاسم *</label>
          <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} placeholder={editing.kind === 'area' ? 'مثال: منطقة الكرنك' : editing.kind === 'street' ? 'مثال: شارع التلفزيون' : 'مثال: عمارة النور'} autoFocus />
        </div>
        {editing.kind === 'area' && (
          <>
            <div><label className="mb-1 block text-xs font-bold text-slate-500">وصف</label><input className="input-field" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="حدود المنطقة أو ملاحظات" /></div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">الكهنة المرتبطون بالمنطقة</label>
              <ul className="divide-y divide-slate-50 overflow-hidden rounded-2xl border border-slate-100">
                {churchPriests.map((p) => {
                  const on = priestIds.includes(p.id);
                  return (
                    <li key={p.id}>
                      <button type="button" onClick={() => setPriestIds((l) => (on ? l.filter((x) => x !== p.id) : [...l, p.id]))} className={`flex w-full items-center gap-2 px-3 py-2 text-right ${on ? 'bg-violet-50' : ''}`}>
                        <PersonPhoto name={p.name} url={p.image_url} size={32} />
                        <span className="flex-1 text-sm font-bold">{p.title ? `${p.title} ` : ''}{p.name}{p.id === profile?.priest.id && <span className="text-[10px] text-slate-400"> (أنت)</span>}</span>
                        <span className={`flex h-5 w-5 items-center justify-center rounded-full ${on ? 'bg-violet-600 text-white' : 'bg-slate-100'}`}>{on && <Check className="h-3 w-3" />}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-1 text-[11px] text-slate-400">أفراد العائلات في هذه المنطقة يرون هؤلاء الكهنة ويمكنهم الاتصال بهم وطلب زيارة</p>
            </div>
          </>
        )}
        {editing.kind === 'building' && (
          <div className="grid grid-cols-2 gap-2">
            <div><label className="mb-1 block text-xs font-bold text-slate-500">رقم العمارة</label><input className="input-field" value={number} onChange={(e) => setNumber(e.target.value)} /></div>
            <div><label className="mb-1 block text-xs font-bold text-slate-500">عدد الأدوار</label><input className="input-field" type="number" min={0} max={200} value={floors} onChange={(e) => setFloors(e.target.value)} /></div>
          </div>
        )}
        <LocationFields value={loc} onChange={setLoc} />
        {err && <p className="text-xs font-bold text-red-600">{err}</p>}
        <button type="submit" disabled={busy} className="btn-primary flex w-full items-center justify-center gap-2 !bg-gradient-to-br !from-violet-600 !to-violet-800">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />} حفظ</button>
      </form>
    </div>
  );
}

function DeletePlace({ d, onClose, onDone }: { d: NonNullable<Deleting>; onClose: () => void; onDone: () => void }) {
  const { token } = usePriest();
  const [supabase] = useState(() => createClient());
  const [busy, setBusy] = useState(false);
  const label = d.kind === 'area' ? 'المنطقة' : d.kind === 'street' ? 'الشارع' : 'العمارة';
  const go = async () => {
    if (!token) return;
    setBusy(true);
    try {
      if (d.kind === 'area') await deleteArea(supabase, token, d.id);
      else if (d.kind === 'street') await deleteStreet(supabase, token, d.id);
      else await deleteBuilding(supabase, token, d.id);
      onDone();
    } catch { setBusy(false); }
  };
  return <ConfirmDelete title={`حذف ${label}`} text={`حذف «${d.name}» يحذف ما بداخلها${d.kind === 'area' ? ' من شوارع وعمارات' : d.kind === 'street' ? ' من عمارات' : ''}. العائلات (${d.families}) تبقى لكن يُفكّ ارتباطها بهذا المكان.`} onConfirm={go} onClose={onClose} busy={busy} />;
}
