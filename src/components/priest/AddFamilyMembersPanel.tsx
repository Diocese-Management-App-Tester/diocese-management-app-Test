'use client';

// ---------- العائلة → إضافة أفراد (priest portal) ----------
//   مسح كود   — scan the member's card (or type the code) → «إضافة»
//   بحث       — persons of the church / confessors / no-enrollment persons
//   فرد جديد  — create the person (code optional) and add him at once
// A relation (أب · أم · ابن …) is chosen once and applied to the next
// additions. A person already in another family asks «نقل؟».

import { useEffect, useRef, useState } from 'react';
import { QrCode, Search, UserPlus, Loader2, Check, AlertCircle, Wand2, ScanLine, Camera, Trash2, MapPin, X, ArrowLeftRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import QrScanner from '@/components/store/QrScanner';
import PhotoCropModal from '@/components/PhotoCropModal';
import { uploadPhoto } from '@/lib/upload';
import { generateCode as renderCode, normalizeCodes, type CodesConfig } from '@/lib/code-templates';
import { PHONE_LOCAL_LENGTH, PHONE_PREFIX, GENDER_LABELS, type Gender } from '@/lib/types';
import { RELATIONS, RELATION_LABELS, type FamilyRelation } from '@/lib/families';
import { usePriest } from '@/lib/priest-context';
import {
  type PriestFamily, type FamilyLookupResult, type FamilyPersonHit,
  priestFamilyLookupCode, priestFamilySearchPersons, priestFamilyAddMember, priestFamilyAddNewMember, familyErrorMessage, otherFamilyOf,
} from '@/lib/priest-families';
import { PersonPhoto } from '@/components/priest/PriestShell';

type Mode = 'scan' | 'search' | 'new';
const MODES: { key: Mode; label: string; icon: typeof QrCode }[] = [
  { key: 'scan', label: 'مسح كود', icon: QrCode },
  { key: 'search', label: 'بحث', icon: Search },
  { key: 'new', label: 'فرد جديد', icon: UserPlus },
];

export default function AddFamilyMembersPanel({ family, onAdded, onClose }: { family: PriestFamily; onAdded: () => void; onClose: () => void }) {
  const { token, profile } = usePriest();
  const [supabase] = useState(() => createClient());
  const [mode, setMode] = useState<Mode>('scan');
  const [relation, setRelation] = useState<FamilyRelation | ''>('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [move, setMove] = useState<{ personId: string; name: string; other: string } | null>(null);
  const [log, setLog] = useState<string[]>([]);
  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, []);

  const ok = (name: string, moved?: string | null) => {
    const t = `تمت إضافة ${name}${moved ? ` (نُقل من ${moved})` : ''} ✔`;
    setFlash({ kind: 'ok', text: t }); setLog((l) => [t, ...l]); onAdded();
  };
  const fail = (e: unknown) => setFlash({ kind: 'err', text: familyErrorMessage(e) });

  const add = async (personId: string, name: string, doMove = false) => {
    if (!token) return;
    setBusy(true); setFlash(null);
    try {
      const r = await priestFamilyAddMember(supabase, token, family.id, personId, relation || null, doMove);
      ok(name, r.moved_from?.name); setMove(null);
    } catch (e) {
      const other = otherFamilyOf(e);
      if (other) setMove({ personId, name, other: other.name }); else fail(e);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <div id="add-family-members" role="dialog" aria-modal="true" className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-indigo-50 bg-white/95 px-4 py-3 backdrop-blur">
          <UserPlus className="h-5 w-5 text-violet-600" />
          <div className="flex-1"><h3 className="text-base font-extrabold">إضافة أفراد</h3><p className="text-[11px] text-slate-400">{family.name} · {family.members_count} فرد</p></div>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3 p-4">
          <div role="tablist" className="grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1">
            {MODES.map((m) => { const I = m.icon; return (
              <button key={m.key} role="tab" aria-selected={mode === m.key} onClick={() => { setMode(m.key); setFlash(null); }}
                className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-extrabold transition ${mode === m.key ? 'bg-white text-violet-700 shadow' : 'text-slate-500'}`}><I className="h-4 w-4" />{m.label}</button>
            ); })}
          </div>

          <div>
            <p className="mb-1 text-xs font-bold text-slate-500">صلة القرابة للإضافات التالية</p>
            <div className="flex flex-wrap gap-1">
              <button type="button" onClick={() => setRelation('')} className={`rounded-xl px-2.5 py-1 text-xs font-extrabold ${relation === '' ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600'}`}>بدون</button>
              {RELATIONS.map((r) => <button key={r} type="button" onClick={() => setRelation(r)} className={`rounded-xl px-2.5 py-1 text-xs font-extrabold ${relation === r ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{RELATION_LABELS[r]}</button>)}
            </div>
          </div>

          {flash && (
            <p className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold ${flash.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
              {flash.kind === 'ok' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}{flash.text}
            </p>
          )}
          {move && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
              <ArrowLeftRight className="h-4 w-4" /><span className="flex-1">{move.name} في عائلة «{move.other}» — نقله إلى هنا؟</span>
              <button type="button" disabled={busy} onClick={() => add(move.personId, move.name, true)} className="rounded-lg bg-amber-600 px-3 py-1 text-white">نقل</button>
              <button type="button" onClick={() => setMove(null)} className="rounded-lg bg-white px-3 py-1">لا</button>
            </div>
          )}

          {mode === 'scan' && <ScanMode token={token!} busy={busy} familyId={family.id} onAdd={add} />}
          {mode === 'search' && <SearchMode token={token!} busy={busy} familyId={family.id} onAdd={add} />}
          {mode === 'new' && <NewMode token={token!} familyId={family.id} churchId={profile?.church.id ?? ''} relation={relation || null} onDone={ok} onFail={fail} />}

          {log.length > 0 && (
            <div className="rounded-2xl bg-slate-50 p-2.5">
              <p className="mb-1 text-[11px] font-extrabold text-slate-500">أُضيف في هذه الجلسة</p>
              <ul className="space-y-0.5 text-[11px] text-slate-600">{log.map((l, i) => <li key={i}>• {l}</li>)}</ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PersonLine({ name, url, code, phone, places, right }: { name: string; url: string | null; code: string; phone: string | null; places?: { service_name: string; class_name: string; kind: string }[]; right: React.ReactNode }) {
  const kids = (places ?? []).filter((p) => p.kind === 'child');
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-indigo-50 p-2.5">
      <PersonPhoto name={name} url={url} size={44} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-extrabold text-slate-800">{name}</p>
        <p className="truncate text-[11px] text-slate-400" dir="ltr">{code}{phone ? ` · ${phone}` : ''}</p>
        {kids.length > 0 && <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] font-bold text-slate-400"><MapPin className="h-3 w-3" />{kids.map((p) => `${p.service_name} · ${p.class_name}`).join(' — ')}</p>}
      </div>
      {right}
    </div>
  );
}

function ScanMode({ token, busy, familyId, onAdd }: { token: string; busy: boolean; familyId: string; onAdd: (id: string, name: string) => Promise<void> }) {
  const [supabase] = useState(() => createClient());
  const [code, setCode] = useState('');
  const [scan, setScan] = useState(true);
  const [look, setLook] = useState<FamilyLookupResult | null>(null);
  const [checking, setChecking] = useState(false);
  const lookup = async (c: string) => {
    const t = c.trim(); if (!t) return;
    setChecking(true);
    try { setLook(await priestFamilyLookupCode(supabase, token, t)); } catch { setLook(null); } finally { setChecking(false); }
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input className="input-field flex-1" dir="ltr" placeholder="اكتب كود الفرد أو امسحه" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookup(code); } }} />
        <button type="button" onClick={() => lookup(code)} className="rounded-xl bg-violet-600 px-3 text-xs font-extrabold text-white">تحقق</button>
        <button type="button" onClick={() => setScan((v) => !v)} aria-pressed={scan} aria-label="الكاميرا" className={`rounded-xl px-3 text-white ${scan ? 'bg-orange-700' : 'bg-orange-500'}`}><ScanLine className="h-5 w-5" /></button>
      </div>
      {scan && <QrScanner idPrefix="pfm" autoStart hint="وجّه الكاميرا إلى كارت الفرد" onCode={(v) => { const t = v.trim(); if (t) { setCode(t); lookup(t); } }} />}
      {checking && <p className="flex items-center gap-1 text-[11px] font-bold text-slate-400"><Loader2 className="h-3 w-3 animate-spin" /> جارٍ البحث...</p>}
      {look && look.found === null && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">لا يوجد شخص بهذا الكود — استخدم «فرد جديد» لإنشائه</p>}
      {look && look.found === 'family' && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">هذا كود عائلة «{look.family.name}» — امسح كود فرد</p>}
      {look && look.found === 'person' && (
        <PersonLine name={look.person.name} url={look.person.image_url} code={look.person.national_id} phone={look.person.phone} places={look.places}
          right={look.family?.id === familyId ? <span className="badge bg-emerald-100 text-emerald-700">في العائلة ✓</span> : (
            <div className="flex flex-col items-end gap-1">
              {look.family && <span className="text-[10px] font-bold text-amber-600">في عائلة {look.family.name}</span>}
              <button type="button" disabled={busy} onClick={() => onAdd(look.person.id, look.person.name)} className="rounded-xl bg-violet-600 px-3 py-2 text-xs font-extrabold text-white">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'إضافة'}</button>
            </div>
          )} />
      )}
    </div>
  );
}

function SearchMode({ token, busy, familyId, onAdd }: { token: string; busy: boolean; familyId: string; onAdd: (id: string, name: string) => Promise<void> }) {
  const [supabase] = useState(() => createClient());
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<FamilyPersonHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setHits(null); return; }
    setSearching(true);
    const h = setTimeout(async () => {
      try { setHits(await priestFamilySearchPersons(supabase, token, t)); } catch { setHits([]); } finally { setSearching(false); }
    }, 350);
    return () => clearTimeout(h);
  }, [q, supabase, token]);
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input className="input-field pr-9" placeholder="الاسم · الهاتف · الكود (حرفان على الأقل)" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      {searching && <p className="flex items-center gap-1 text-[11px] font-bold text-slate-400"><Loader2 className="h-3 w-3 animate-spin" /> جارٍ البحث...</p>}
      {hits && hits.length === 0 && !searching && <p className="py-3 text-center text-xs font-bold text-slate-400">لا نتائج</p>}
      <div className="space-y-1.5">
        {(hits ?? []).map((h) => (
          <PersonLine key={h.person.id} name={h.person.name} url={h.person.image_url} code={h.person.national_id} phone={h.person.phone} places={h.places}
            right={h.family?.id === familyId || added.has(h.person.id) ? <span className="badge bg-emerald-100 text-emerald-700">✓</span> : (
              <div className="flex flex-col items-end gap-1">
                {h.family && <span className="text-[10px] font-bold text-amber-600">في عائلة {h.family.name}</span>}
                <button type="button" disabled={busy} onClick={async () => { await onAdd(h.person.id, h.person.name); setAdded((s) => new Set(s).add(h.person.id)); }} className="rounded-xl bg-violet-600 px-3 py-1.5 text-xs font-extrabold text-white">إضافة</button>
              </div>
            )} />
        ))}
      </div>
    </div>
  );
}

function NewMode({ token, familyId, churchId, relation, onDone, onFail }: { token: string; familyId: string; churchId: string; relation: string | null; onDone: (name: string, moved?: string | null) => void; onFail: (e: unknown) => void }) {
  const [supabase] = useState(() => createClient());
  const [codesCfg, setCodesCfg] = useState<CodesConfig | null>(null);
  useEffect(() => { supabase.rpc('code_settings').then(({ data }) => setCodesCfg(data ? normalizeCodes(data) : null)); }, [supabase]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [scan, setScan] = useState(false);
  const [gender, setGender] = useState<Gender | ''>('');
  const [phoneLocal, setPhoneLocal] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [notes, setNotes] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [rawImage, setRawImage] = useState('');
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const phoneValid = !phoneLocal || phoneLocal.length === PHONE_LOCAL_LENGTH;

  const submit = async () => {
    if (!name.trim()) return onFail(new Error('name_required'));
    if (!phoneValid) return onFail(new Error(`رقم الهاتف يجب أن يكون ${PHONE_LOCAL_LENGTH} رقمًا`));
    setBusy(true);
    let imageUrl: string | null = null;
    if (photoBlob) { try { imageUrl = await uploadPhoto(supabase, 'priests', photoBlob, 'member.webp'); } catch { /* optional */ } }
    try {
      const r = await priestFamilyAddNewMember(supabase, token, familyId, {
        name, code: code.trim() || null, gender: gender || null, birthdate: birthdate || null,
        phone: phoneLocal ? `${PHONE_PREFIX}${phoneLocal}` : null, address: null, notes: notes.trim() || null, image_url: imageUrl, relation, move: true,
      });
      onDone(r.person.name, r.moved_from?.name);
      setName(''); setCode(''); setGender(''); setPhoneLocal(''); setBirthdate(''); setNotes(''); setPhotoBlob(null); setPreview('');
    } catch (e) { onFail(e); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => fileRef.current?.click()} className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-violet-50 ring-2 ring-violet-100">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="h-full w-full object-cover" />
          ) : <Camera className="h-7 w-7 text-violet-400" />}
        </button>
        <div className="flex-1">
          <label className="mb-1 block text-xs font-bold text-slate-500">الاسم *</label>
          <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} placeholder="الاسم الكامل" />
        </div>
        {photoBlob && <button type="button" onClick={() => { setPhotoBlob(null); setPreview(''); }} aria-label="إزالة الصورة" className="text-red-500"><Trash2 className="h-4 w-4" /></button>}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setRawImage(URL.createObjectURL(f)); }} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-500">الكود <span className="font-normal text-slate-400">(اختياري — يُولَّد تلقائيًا)</span></label>
        <div className="flex gap-2">
          <input className="input-field flex-1" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} />
          <button type="button" onClick={() => setCode(renderCode(codesCfg, 'person', { churchId }))} aria-label="توليد كود" className="rounded-xl bg-violet-600 px-3 text-white"><Wand2 className="h-5 w-5" /></button>
          <button type="button" onClick={() => setScan((v) => !v)} aria-label="مسح" className={`rounded-xl px-3 text-white ${scan ? 'bg-orange-700' : 'bg-orange-500'}`}><ScanLine className="h-5 w-5" /></button>
        </div>
        {scan && <QrScanner idPrefix="pfn" autoStart hint="امسح الكارت" onCode={(v) => { const t = v.trim(); if (t) { setCode(t); setScan(false); } }} />}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" aria-pressed={gender === 'male'} onClick={() => setGender(gender === 'male' ? '' : 'male')} className={`rounded-xl py-2 text-sm font-extrabold ${gender === 'male' ? 'bg-primary-600 text-white' : 'bg-primary-50 text-primary-600'}`}>{GENDER_LABELS.male}</button>
        <button type="button" aria-pressed={gender === 'female'} onClick={() => setGender(gender === 'female' ? '' : 'female')} className={`rounded-xl py-2 text-sm font-extrabold ${gender === 'female' ? 'bg-pink-500 text-white' : 'bg-pink-50 text-pink-500'}`}>{GENDER_LABELS.female}</button>
      </div>
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-500">رقم الهاتف</label>
        <div className="flex items-stretch overflow-hidden rounded-xl border border-indigo-100 bg-white" dir="ltr">
          <span className="flex items-center bg-violet-50 px-3 text-sm font-extrabold text-violet-700">{PHONE_PREFIX}</span>
          <input type="tel" inputMode="numeric" className="w-full px-3 py-2.5 text-sm font-bold outline-none" placeholder="01xxxxxxxxx" value={phoneLocal} maxLength={PHONE_LOCAL_LENGTH} onChange={(e) => setPhoneLocal(e.target.value.replace(/\D/g, '').slice(0, PHONE_LOCAL_LENGTH))} />
        </div>
        {phoneLocal && !phoneValid && <p className="mt-1 text-[11px] font-bold text-red-500">{PHONE_LOCAL_LENGTH} رقمًا</p>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="mb-1 block text-xs font-bold text-slate-500">تاريخ الميلاد</label><input type="date" className="input-field" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} /></div>
        <div><label className="mb-1 block text-xs font-bold text-slate-500">ملاحظات</label><input className="input-field" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </div>
      <button type="button" disabled={busy} onClick={submit} className="btn-primary flex w-full items-center justify-center gap-2 !bg-gradient-to-br !from-violet-600 !to-violet-800">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <UserPlus className="h-5 w-5" />} إنشاء وإضافة</button>
      {rawImage && <PhotoCropModal src={rawImage} onDone={(b) => { setPhotoBlob(b); setPreview(URL.createObjectURL(b)); URL.revokeObjectURL(rawImage); setRawImage(''); }} onClose={() => { URL.revokeObjectURL(rawImage); setRawImage(''); }} />}
    </div>
  );
}
