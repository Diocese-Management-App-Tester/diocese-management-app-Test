'use client';

// ---------- عائلة جديدة / تعديل عائلة (priest portal) ----------
// code (typed · scanned · generated, live check) · name · phone · address ·
// notes · place (منطقة → شارع → عمارة · دور · شقة) · location (for directions)

import { useEffect, useState } from 'react';
import { X, Check, Loader2, Wand2, ScanLine, QrCode } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import QrScanner from '@/components/store/QrScanner';
import { generateCode as renderCode, normalizeCodes, type CodesConfig } from '@/lib/code-templates';
import { PHONE_LOCAL_LENGTH, PHONE_PREFIX } from '@/lib/types';
import { usePriest } from '@/lib/priest-context';
import { phoneToLocalDigits } from '@/lib/bulk-import';
import {
  type PriestFamily, type LocationInput, type FamilyCodeLookup, savePriestFamily, priestFamilyCodeLookup, familyErrorMessage,
} from '@/lib/priest-families';
import { LocationFields, emptyLocation, PlaceSelects } from '@/components/priest/FamilyBits';

export default function FamilyFormModal({ family, preset, onSaved, onClose }: {
  family: PriestFamily | null;
  /** pre-selected place for a new family (from the areas page) */
  preset?: { area_id?: string | null; street_id?: string | null; building_id?: string | null };
  onSaved: (f: PriestFamily) => void;
  onClose: () => void;
}) {
  const { token, areas, profile } = usePriest();
  const [supabase] = useState(() => createClient());
  const [codesCfg, setCodesCfg] = useState<CodesConfig | null>(null);
  useEffect(() => { supabase.rpc('code_settings').then(({ data }) => setCodesCfg(data ? normalizeCodes(data) : null)); }, [supabase]);
  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, []);

  const [name, setName] = useState(family?.name ?? '');
  const [code, setCode] = useState(family?.code ?? '');
  const [scan, setScan] = useState(false);
  const [look, setLook] = useState<FamilyCodeLookup | null>(null);
  const [phoneLocal, setPhoneLocal] = useState(family?.phone ? phoneToLocalDigits(family.phone) : '');
  const [address, setAddress] = useState(family?.address ?? '');
  const [notes, setNotes] = useState(family?.notes ?? '');
  const [place, setPlace] = useState({
    area_id: family?.area_id ?? preset?.area_id ?? null,
    street_id: family?.street_id ?? preset?.street_id ?? null,
    building_id: family?.building_id ?? preset?.building_id ?? null,
  });
  const [floor, setFloor] = useState(family?.floor ?? '');
  const [apartment, setApartment] = useState(family?.apartment ?? '');
  const [loc, setLoc] = useState<LocationInput>(family ? { lat: family.lat, lng: family.lng, maps_url: family.maps_url, location_note: family.location_note } : emptyLocation());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const phoneValid = !phoneLocal || phoneLocal.length === PHONE_LOCAL_LENGTH;

  // resolve a preset building → its street / area (the selects need the chain)
  useEffect(() => {
    if (family || !areas) return;
    if (preset?.building_id && !place.street_id) {
      for (const a of areas.areas) for (const s of a.streets) if (s.buildings.some((b) => b.id === preset.building_id)) setPlace({ area_id: a.id, street_id: s.id, building_id: preset.building_id });
    } else if (preset?.street_id && !place.area_id) {
      for (const a of areas.areas) if (a.streets.some((s) => s.id === preset.street_id)) setPlace((p) => ({ ...p, area_id: a.id }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areas]);

  // live code check
  useEffect(() => {
    const t = code.trim();
    if (!token || !t || t === family?.code) { setLook(null); return; }
    const h = setTimeout(async () => { try { setLook(await priestFamilyCodeLookup(supabase, token, t)); } catch { setLook(null); } }, 350);
    return () => clearTimeout(h);
  }, [code, token, supabase, family?.code]);
  const codeBad = look && !look.free && code.trim() !== family?.code;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (!name.trim()) { setErr('اسم العائلة مطلوب'); return; }
    if (!phoneValid) { setErr(`رقم الهاتف يجب أن يكون ${PHONE_LOCAL_LENGTH} رقمًا`); return; }
    if (codeBad) { setErr(look?.person ? 'هذا الكود لشخص — اختر كودًا آخر' : 'هذا الكود لعائلة أخرى'); return; }
    if ((loc.lat == null) !== (loc.lng == null)) { setErr('أدخل خط العرض وخط الطول معًا'); return; }
    setBusy(true); setErr('');
    try {
      const f = await savePriestFamily(supabase, token, {
        id: family?.id ?? null, name, code: code.trim() || null, phone: phoneLocal ? `${PHONE_PREFIX}${phoneLocal}` : null,
        address: address.trim() || null, notes: notes.trim() || null, ...place, floor: floor.trim() || null, apartment: apartment.trim() || null, ...loc,
      });
      onSaved(f);
    } catch (er) { setErr(familyErrorMessage(er)); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <form id="family-form" onSubmit={submit} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-indigo-50 bg-white/95 px-5 py-3 backdrop-blur">
          <h3 className="text-base font-extrabold">{family ? 'تعديل العائلة' : 'عائلة جديدة'}</h3>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3 p-5">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">اسم العائلة *</label>
            <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: عائلة جرجس" autoFocus />
          </div>
          <div>
            <label className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500"><QrCode className="h-3.5 w-3.5" /> كود العائلة <span className="font-normal text-slate-400">(اختياري — يُولَّد تلقائيًا)</span></label>
            <div className="flex gap-2">
              <input className={`input-field flex-1 ${codeBad ? '!border-red-300' : ''}`} dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} placeholder="F-XXXXXX" />
              <button type="button" onClick={() => setCode(renderCode(codesCfg, 'family', { churchId: profile?.church.id }))} aria-label="توليد كود" className="rounded-xl bg-violet-600 px-3 text-white"><Wand2 className="h-5 w-5" /></button>
              <button type="button" onClick={() => setScan((v) => !v)} aria-label="مسح" className={`rounded-xl px-3 text-white ${scan ? 'bg-orange-700' : 'bg-orange-500'}`}><ScanLine className="h-5 w-5" /></button>
            </div>
            {scan && <QrScanner idPrefix="ff" autoStart hint="امسح كارت العائلة" onCode={(v) => { const t = v.trim(); if (t) { setCode(t); setScan(false); } }} />}
            {codeBad && <p className="mt-1 text-[11px] font-bold text-red-600">{look?.person ? `هذا الكود للشخص «${look.person.name}»` : `هذا الكود للعائلة «${look?.family?.name}»`}</p>}
            {look?.free && <p className="mt-1 text-[11px] font-bold text-emerald-700">✓ الكود متاح</p>}
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">هاتف العائلة</label>
            <div className="flex items-stretch overflow-hidden rounded-xl border border-indigo-100 bg-white" dir="ltr">
              <span className="flex items-center bg-violet-50 px-3 text-sm font-extrabold text-violet-700">{PHONE_PREFIX}</span>
              <input type="tel" inputMode="numeric" className="w-full px-3 py-2.5 text-sm font-bold outline-none" placeholder="01xxxxxxxxx" value={phoneLocal} maxLength={PHONE_LOCAL_LENGTH} onChange={(e) => setPhoneLocal(e.target.value.replace(/\D/g, '').slice(0, PHONE_LOCAL_LENGTH))} />
            </div>
            {phoneLocal && !phoneValid && <p className="mt-1 text-[11px] font-bold text-red-500">{PHONE_LOCAL_LENGTH} رقمًا</p>}
          </div>

          <div className="rounded-2xl bg-violet-50/60 p-3">
            <p className="mb-2 text-xs font-extrabold text-violet-800">المكان — الكنيسة: {profile?.church.name}</p>
            {areas && areas.areas.length === 0 && <p className="mb-2 text-[11px] font-bold text-amber-700">لا مناطق بعد — أنشئها من «المناطق والشوارع» ثم اربط العائلة بها</p>}
            <PlaceSelects areas={areas?.areas ?? []} value={place} onChange={setPlace} />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div><label className="mb-1 block text-xs font-bold text-slate-500">الدور</label><input className="input-field" value={floor} onChange={(e) => setFloor(e.target.value)} /></div>
              <div><label className="mb-1 block text-xs font-bold text-slate-500">الشقة</label><input className="input-field" value={apartment} onChange={(e) => setApartment(e.target.value)} /></div>
            </div>
            <div className="mt-2"><label className="mb-1 block text-xs font-bold text-slate-500">العنوان (نص حر)</label><input className="input-field" value={address} onChange={(e) => setAddress(e.target.value)} /></div>
          </div>

          <LocationFields value={loc} onChange={setLoc} />
          <p className="-mt-1 text-[11px] text-slate-400">إن لم تحدد موقعًا للعائلة يُستخدم موقع العمارة ثم الشارع ثم المنطقة للاتجاهات</p>

          <div><label className="mb-1 block text-xs font-bold text-slate-500">ملاحظات</label><textarea className="input-field" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          {err && <p className="text-xs font-bold text-red-600">{err}</p>}
          <button id="family-form-save" type="submit" disabled={busy} className="btn-primary flex w-full items-center justify-center gap-2 !bg-gradient-to-br !from-violet-600 !to-violet-800">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />} {family ? 'حفظ' : 'إنشاء العائلة'}</button>
        </div>
      </form>
    </div>
  );
}
