'use client';

// ---------- Shared pieces for الافتقاد الأسري (priest portal) ----------
//   LocationFields   — lat/lng (paste a Google Maps link · «موقعي الحالي») · maps link · note
//   DirectionsButton — «الاتجاهات» opens Google Maps navigation to the family
//   VisitBadge       — «منذ N يومًا» since the last visit
//   VisitRow         — one visit with approve / move / reject / done / cancel
//   FamilyCard       — name · place · members · last / next visit · call · directions
//   PlaceSelects     — area → street → building cascading selects

import { useState } from 'react';
import Link from 'next/link';
import {
  MapPin, Navigation, LocateFixed, Link2, Phone, Clock, Check, XCircle, Ban, CheckCircle2, CalendarPlus, Loader2, Footprints,
  UsersRound, ChevronLeft, AlertTriangle, Trash2, Home,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { usePriest } from '@/lib/priest-context';
import { waNumber, todayYmd, shortTime } from '@/lib/priest-portal';
import {
  type GeoLocation, type LocationInput, type Visit, type PriestFamily, type Area, type VisitAction,
  VISIT_STATUS_LABELS, LOCATION_SOURCE_LABELS, directionsUrl, mapUrl, parseLatLng, placeLine, visitDaysLabel, decideVisit, familyErrorMessage,
} from '@/lib/priest-families';
import { WhatsAppIcon } from '@/components/priest/ConfessorBits';
import { fmtDay } from '@/components/child/ChildBits';

// ---------- Location editor ----------
export function emptyLocation(): LocationInput { return { lat: null, lng: null, maps_url: null, location_note: null }; }

export function LocationFields({ value, onChange, compact = false }: { value: LocationInput; onChange: (v: LocationInput) => void; compact?: boolean }) {
  const [paste, setPaste] = useState('');
  const [locating, setLocating] = useState(false);
  const [err, setErr] = useState('');
  const set = (patch: Partial<LocationInput>) => onChange({ ...value, ...patch });

  const applyPaste = (t: string) => {
    setPaste(t);
    const p = parseLatLng(t);
    if (p) { set({ lat: p.lat, lng: p.lng, maps_url: /^https?:/i.test(t.trim()) ? t.trim() : value.maps_url }); setErr(''); }
    else if (/^https?:/i.test(t.trim())) { set({ maps_url: t.trim() }); setErr(''); }
  };
  const locate = () => {
    if (!navigator.geolocation) { setErr('المتصفح لا يدعم تحديد الموقع'); return; }
    setLocating(true); setErr('');
    navigator.geolocation.getCurrentPosition(
      (pos) => { set({ lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6) }); setLocating(false); },
      () => { setErr('تعذر تحديد موقعك — اسمح بالوصول إلى الموقع'); setLocating(false); },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  };
  const has = value.lat != null && value.lng != null;
  return (
    <div className="space-y-2 rounded-2xl bg-slate-50 p-3">
      <p className="flex items-center gap-1.5 text-xs font-extrabold text-slate-600"><MapPin className="h-4 w-4 text-violet-600" /> الموقع على الخريطة <span className="font-normal text-slate-400">(اختياري — للاتجاهات)</span></p>
      <div className="flex gap-2">
        <input className="input-field flex-1 !py-2 text-xs" dir="ltr" placeholder="الصق رابط Google Maps أو «lat, lng»" value={paste} onChange={(e) => applyPaste(e.target.value)} />
        <button type="button" onClick={locate} disabled={locating} title="موقعي الحالي" aria-label="موقعي الحالي" className="rounded-xl bg-violet-600 px-3 text-white">{locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}</button>
      </div>
      {!compact && (
        <div className="grid grid-cols-2 gap-2">
          <input className="input-field !py-2 text-xs" dir="ltr" type="number" step="any" placeholder="خط العرض (lat)" value={value.lat ?? ''} onChange={(e) => set({ lat: e.target.value === '' ? null : Number(e.target.value) })} />
          <input className="input-field !py-2 text-xs" dir="ltr" type="number" step="any" placeholder="خط الطول (lng)" value={value.lng ?? ''} onChange={(e) => set({ lng: e.target.value === '' ? null : Number(e.target.value) })} />
        </div>
      )}
      <div className="relative">
        <Link2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input className="input-field !py-2 pr-8 text-xs" dir="ltr" placeholder="رابط الخريطة (اختياري)" value={value.maps_url ?? ''} onChange={(e) => set({ maps_url: e.target.value || null })} />
      </div>
      <input className="input-field !py-2 text-xs" placeholder="وصف الوصول — مثال: بجوار الصيدلية، الباب الأزرق" value={value.location_note ?? ''} onChange={(e) => set({ location_note: e.target.value || null })} />
      <div className="flex items-center justify-between text-[11px] font-bold">
        {has ? <span className="text-emerald-700" dir="ltr">✓ {value.lat}, {value.lng}</span> : <span className="text-slate-400">لم يُحدَّد موقع</span>}
        {(has || value.maps_url) && <button type="button" onClick={() => { set({ lat: null, lng: null, maps_url: null }); setPaste(''); }} className="text-red-500">مسح الموقع</button>}
      </div>
      {err && <p className="text-[11px] font-bold text-red-600">{err}</p>}
    </div>
  );
}

// ---------- Directions ----------
export function DirectionsButton({ loc, size = 'md', label = 'الاتجاهات' }: { loc: GeoLocation | null | undefined; size?: 'sm' | 'md'; label?: string }) {
  const url = directionsUrl(loc);
  if (!url) return <span className="text-[10px] font-bold text-slate-300">بلا موقع</span>;
  const cls = size === 'sm' ? 'px-2 py-1.5 text-[11px]' : 'px-3 py-2 text-xs';
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={loc ? LOCATION_SOURCE_LABELS[loc.source] : ''}
      className={`flex items-center gap-1 rounded-xl bg-sky-600 font-extrabold text-white hover:bg-sky-700 ${cls}`}>
      <Navigation className="h-4 w-4" /> {label}
    </a>
  );
}
export function LocationLine({ loc }: { loc: GeoLocation | null | undefined }) {
  if (!loc) return null;
  const url = mapUrl(loc);
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-slate-500">
      <MapPin className="h-3 w-3 text-sky-600" />
      <span className="badge bg-sky-50 text-sky-700">{LOCATION_SOURCE_LABELS[loc.source]}</span>
      {loc.note && <span>{loc.note}</span>}
      {url && <a href={url} target="_blank" rel="noopener noreferrer" className="text-sky-700 underline">عرض على الخريطة</a>}
    </p>
  );
}

// ---------- Call / WhatsApp ----------
export function PhoneButtons({ phone, size = 'md' }: { phone: string | null; size?: 'sm' | 'md' }) {
  if (!phone) return null;
  const cls = size === 'sm' ? 'p-1.5' : 'p-2';
  return (
    <div className="flex items-center gap-1">
      <a href={`tel:${phone}`} aria-label="اتصال" title="اتصال" className={`rounded-xl bg-teal-50 text-teal-700 hover:bg-teal-100 ${cls}`}><Phone className="h-4 w-4" /></a>
      <a href={`https://wa.me/${waNumber(phone)}`} target="_blank" rel="noopener noreferrer" aria-label="واتساب" title="واتساب" className={`rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 ${cls}`}><WhatsAppIcon /></a>
    </div>
  );
}

// ---------- Visit badges ----------
export function VisitBadge({ f }: { f: { last_visit: string | null; days_since_visit: number | null; visits_count: number } }) {
  const n = f.days_since_visit;
  const cls = n == null ? 'bg-rose-100 text-rose-700 ring-1 ring-rose-200' : n > 90 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700';
  return (
    <span className={`badge tabular-nums ${cls}`} title={f.last_visit ? `آخر زيارة ${fmtDay(f.last_visit)}` : 'لا زيارات مسجَّلة'}>
      {n == null && <AlertTriangle className="ml-1 h-3 w-3" />}
      <Footprints className="ml-1 h-3 w-3" />{visitDaysLabel(n)}{f.visits_count > 0 ? ` · ${f.visits_count}` : ''}
    </span>
  );
}

export const VISIT_TONE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700', approved: 'bg-violet-100 text-violet-700', rejected: 'bg-red-100 text-red-600',
  cancelled: 'bg-slate-100 text-slate-500', done: 'bg-emerald-100 text-emerald-700',
};

// ---------- One visit row (priest side) ----------
export function VisitRow({ v, onChanged, showFamily = true, onOpenFamily }: { v: Visit; onChanged: () => void; showFamily?: boolean; onOpenFamily?: (id: string) => void }) {
  const { token } = usePriest();
  const [supabase] = useState(() => createClient());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [panel, setPanel] = useState<'none' | 'move' | 'done'>('none');
  const [on, setOn] = useState(v.on);
  const [time, setTime] = useState(shortTime(v.time));
  const [doneOn, setDoneOn] = useState(todayYmd());
  const [note, setNote] = useState('');
  const act = async (action: VisitAction, opts: { on?: string | null; time?: string | null; note?: string | null } = {}) => {
    if (!token) return;
    setBusy(true); setErr('');
    try { await decideVisit(supabase, token, v.id, action, opts); setPanel('none'); setNote(''); onChanged(); }
    catch (e) { setErr(familyErrorMessage(e)); }
    finally { setBusy(false); }
  };
  const open = v.status === 'pending' || v.status === 'approved';
  return (
    <li className="py-2.5 text-sm">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {showFamily && (
            <button type="button" onClick={() => onOpenFamily?.(v.family_id)} className="block truncate text-right font-extrabold text-slate-800 hover:underline">
              <Home className="ml-1 inline h-3.5 w-3.5 text-violet-500" />{v.family.name}
            </button>
          )}
          {showFamily && placeLine(v.family) && <p className="truncate text-[11px] text-slate-400">{placeLine(v.family)}</p>}
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs font-bold text-slate-600">
            <Clock className="h-3.5 w-3.5 text-violet-500" />{fmtDay(v.on)}{v.time ? ` · ${shortTime(v.time)}` : ''}
            <span className={`badge ${VISIT_TONE[v.status]}`}>{VISIT_STATUS_LABELS[v.status]}</span>
            <span className="badge bg-slate-100 text-slate-500">{v.requested_by === 'family' ? `طلب العائلة${v.requested_by_person ? ` (${v.requested_by_person.name})` : ''}` : 'حددها الكاهن'}</span>
          </p>
          {v.note && <p className="mt-0.5 text-[11px] text-slate-500">💬 {v.note}</p>}
          {v.decision_note && <p className="mt-0.5 text-[11px] text-slate-400">↩ {v.decision_note}</p>}
          {v.visit_note && <p className="mt-0.5 text-[11px] text-emerald-700">📝 {v.visit_note}</p>}
        </div>
        {showFamily && <DirectionsButton loc={v.family.location} size="sm" />}
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {v.status === 'pending' && <button type="button" disabled={busy} onClick={() => act('approve')} className="flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-extrabold text-white"><Check className="h-4 w-4" /> موافقة</button>}
          <button type="button" disabled={busy} onClick={() => setPanel(panel === 'move' ? 'none' : 'move')} className="flex items-center gap-1 rounded-xl bg-violet-100 px-3 py-1.5 text-xs font-extrabold text-violet-700"><CalendarPlus className="h-4 w-4" /> {v.status === 'pending' ? 'موافقة بموعد آخر' : 'تغيير الموعد'}</button>
          <button type="button" disabled={busy} onClick={() => setPanel(panel === 'done' ? 'none' : 'done')} className="flex items-center gap-1 rounded-xl bg-violet-600 px-3 py-1.5 text-xs font-extrabold text-white"><CheckCircle2 className="h-4 w-4" /> تمّت الزيارة</button>
          {v.status === 'pending' && <button type="button" disabled={busy} onClick={() => act('reject', { note: note || undefined })} className="flex items-center gap-1 rounded-xl bg-red-50 px-3 py-1.5 text-xs font-extrabold text-red-600"><XCircle className="h-4 w-4" /> رفض</button>}
          {v.status === 'approved' && <button type="button" disabled={busy} onClick={() => act('cancel')} className="flex items-center gap-1 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-extrabold text-slate-600"><Ban className="h-4 w-4" /> إلغاء</button>}
          {busy && <Loader2 className="h-4 w-4 animate-spin text-violet-500" />}
        </div>
      )}
      {panel === 'move' && open && (
        <div className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-1.5 rounded-xl bg-violet-50 p-2">
          <input type="date" className="input-field !py-1.5" value={on} min={todayYmd()} onChange={(e) => setOn(e.target.value)} aria-label="اليوم" />
          <input type="time" className="input-field !py-1.5" value={time} onChange={(e) => setTime(e.target.value)} aria-label="الوقت" />
          <button type="button" disabled={busy} onClick={() => act('approve', { on, time: time || null, note: note || undefined })} className="rounded-xl bg-violet-600 px-3 text-xs font-extrabold text-white">حفظ</button>
          <input className="input-field col-span-3 !py-1.5" placeholder="ملاحظة للعائلة (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}
      {panel === 'done' && open && (
        <div className="mt-2 grid grid-cols-[1fr_auto] gap-1.5 rounded-xl bg-emerald-50 p-2">
          <input type="date" className="input-field !py-1.5" value={doneOn} max={todayYmd()} onChange={(e) => setDoneOn(e.target.value)} aria-label="يوم الزيارة" />
          <button type="button" disabled={busy} onClick={() => act('done', { on: doneOn, note: note || undefined })} className="rounded-xl bg-emerald-600 px-3 text-xs font-extrabold text-white">تسجيل</button>
          <input className="input-field col-span-2 !py-1.5" placeholder="ملاحظة عن الزيارة (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}
      {err && <p className="mt-1 text-[11px] font-bold text-red-600">{err}</p>}
    </li>
  );
}

// ---------- Family card (list) ----------
export function FamilyCard({ f, compact = false }: { f: PriestFamily; compact?: boolean }) {
  const place = placeLine(f);
  return (
    <li className={`card !p-3 ${f.days_since_visit == null ? 'ring-1 ring-rose-100' : ''}`}>
      <div className="flex items-start gap-3">
        <Link href={`/priest/families/${f.id}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-sm"><UsersRound className="h-5 w-5" /></Link>
        <div className="min-w-0 flex-1">
          <Link href={`/priest/families/${f.id}`} className="block truncate text-sm font-extrabold text-slate-800 hover:underline">{f.name}</Link>
          <p className="truncate text-[11px] text-slate-400" dir="ltr">{f.code}{f.phone ? ` · ${f.phone}` : ''}</p>
          {place && <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] font-bold text-slate-500"><MapPin className="h-3 w-3 shrink-0 text-violet-500" />{place}</p>}
          {!compact && f.members.length > 0 && (
            <p className="mt-0.5 truncate text-[11px] text-slate-500">{f.members.map((m) => m.person.name.split(' ')[0]).join(' · ')}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <VisitBadge f={f} />
            <span className="badge bg-slate-100 text-slate-500 tabular-nums">{f.members_count} فرد</span>
            {f.next_visit && (
              <span className={`badge ${f.next_visit.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-violet-100 text-violet-700'}`}>
                <Clock className="ml-1 h-3 w-3" />{fmtDay(f.next_visit.on)}{f.next_visit.time ? ` ${shortTime(f.next_visit.time)}` : ''}{f.next_visit.status === 'pending' ? ' · طلب' : ''}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <PhoneButtons phone={f.phone} size="sm" />
          <DirectionsButton loc={f.location} size="sm" />
        </div>
      </div>
    </li>
  );
}

// ---------- area → street → building cascading selects ----------
export function PlaceSelects({ areas, value, onChange, allowNone = true }: {
  areas: Area[];
  value: { area_id: string | null; street_id: string | null; building_id: string | null };
  onChange: (v: { area_id: string | null; street_id: string | null; building_id: string | null }) => void;
  allowNone?: boolean;
}) {
  const area = areas.find((a) => a.id === value.area_id) ?? null;
  const street = area?.streets.find((s) => s.id === value.street_id) ?? null;
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-500">المنطقة</label>
        <select className="input-field" value={value.area_id ?? ''} onChange={(e) => onChange({ area_id: e.target.value || null, street_id: null, building_id: null })}>
          {allowNone && <option value="">— بلا منطقة —</option>}
          {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-500">الشارع</label>
        <select className="input-field" value={value.street_id ?? ''} disabled={!area} onChange={(e) => onChange({ area_id: value.area_id, street_id: e.target.value || null, building_id: null })}>
          <option value="">— بلا شارع —</option>
          {(area?.streets ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-500">العمارة</label>
        <select className="input-field" value={value.building_id ?? ''} disabled={!street} onChange={(e) => onChange({ ...value, building_id: e.target.value || null })}>
          <option value="">— بلا عمارة —</option>
          {(street?.buildings ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}{b.number ? ` ${b.number}` : ''}</option>)}
        </select>
      </div>
    </div>
  );
}

// ---------- small confirm ----------
export function ConfirmDelete({ title, text, onConfirm, onClose, busy }: { title: string; text: string; onConfirm: () => void; onClose: () => void; busy?: boolean }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-sm sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-2 flex items-center gap-2 text-lg font-extrabold text-red-600"><Trash2 className="h-5 w-5" /> {title}</h3>
        <p className="mb-4 text-sm font-bold text-slate-600">{text}</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onConfirm} disabled={busy} className="flex items-center justify-center gap-1.5 rounded-xl bg-red-500 py-2.5 font-extrabold text-white shadow active:scale-95 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} حذف</button>
          <button type="button" onClick={onClose} className="btn-secondary">إلغاء</button>
        </div>
      </div>
    </div>
  );
}

export function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="flex items-center text-xs text-violet-700">{children} <ChevronLeft className="h-3.5 w-3.5" /></Link>;
}
