'use client';

// ---------- المعترفين → إضافة ----------
//   مسح كود   — scan the card (or type the code) → the person appears → «إضافة»
//   بحث       — persons of the priest's church by name / phone / code
//   شخص جديد  — create the person here (adult or child without a card) and add him
// Every mode may set «آخر اعتراف» (optional) so the reminder starts correctly.

import { useEffect, useRef, useState } from 'react';
import { QrCode, Search, UserPlus, Loader2, Check, AlertCircle, Wand2, ScanLine, Camera, Trash2, MapPin, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import QrScanner from '@/components/store/QrScanner';
import PhotoCropModal from '@/components/PhotoCropModal';
import { uploadPhoto } from '@/lib/upload';
import { generateCode as renderCode, normalizeCodes, type CodesConfig } from '@/lib/code-templates';
import { PHONE_LOCAL_LENGTH, PHONE_PREFIX, GENDER_LABELS, type Gender } from '@/lib/types';
import { usePriest } from '@/lib/priest-context';
import {
  priestLookupCode, priestSearchPersons, addConfessor, addNewConfessor, priestErrorMessage, todayYmd,
  type CodeLookup, type PersonHit, type Confessor,
} from '@/lib/priest-portal';
import { PersonPhoto } from '@/components/priest/PriestShell';

type Mode = 'scan' | 'search' | 'new';
const MODES: { key: Mode; label: string; icon: typeof QrCode }[] = [
  { key: 'scan', label: 'مسح كود', icon: QrCode },
  { key: 'search', label: 'بحث', icon: Search },
  { key: 'new', label: 'شخص جديد', icon: UserPlus },
];

export default function AddConfessorPanel({ onAdded, onClose }: { onAdded: (c: Confessor) => void; onClose: () => void }) {
  const { token, profile } = usePriest();
  const [supabase] = useState(() => createClient());
  const [mode, setMode] = useState<Mode>('scan');
  const [lastConf, setLastConf] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, []);

  const ok = (c: Confessor) => { setFlash({ kind: 'ok', text: `تمت إضافة ${c.person.name} إلى المعترفين ✔` }); onAdded(c); };
  const fail = (e: unknown) => setFlash({ kind: 'err', text: priestErrorMessage(e) });

  const add = async (personId: string) => {
    if (!token) return;
    setBusy(true); setFlash(null);
    try { ok(await addConfessor(supabase, token, personId, null, lastConf || null)); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <div id="add-confessor-panel" role="dialog" aria-modal="true" className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-indigo-50 bg-white/95 px-4 py-3 backdrop-blur">
          <UserPlus className="h-5 w-5 text-violet-600" />
          <h3 className="flex-1 text-base font-extrabold">إضافة معترف</h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3 p-4">
          <div role="tablist" className="grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1">
            {MODES.map((m) => { const I = m.icon; return (
              <button key={m.key} role="tab" aria-selected={mode === m.key} onClick={() => { setMode(m.key); setFlash(null); }}
                className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-extrabold transition ${mode === m.key ? 'bg-white text-violet-700 shadow' : 'text-slate-500'}`}><I className="h-4 w-4" />{m.label}</button>
            ); })}
          </div>

          <label className="flex items-center gap-2 rounded-2xl bg-violet-50 px-3 py-2 text-xs font-bold text-violet-800">
            <span className="flex-1">آخر اعتراف (اختياري — لبدء عدّاد التذكير)</span>
            <input type="date" className="input-field !w-auto !py-1" value={lastConf} max={todayYmd()} onChange={(e) => setLastConf(e.target.value)} />
          </label>

          {flash && (
            <p className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold ${flash.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
              {flash.kind === 'ok' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}{flash.text}
            </p>
          )}

          {mode === 'scan' && <ScanMode token={token!} busy={busy} onAdd={add} />}
          {mode === 'search' && <SearchMode token={token!} busy={busy} onAdd={add} />}
          {mode === 'new' && <NewMode token={token!} churchId={profile?.church.id ?? ''} lastConf={lastConf} onDone={ok} onFail={fail} />}
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

function ScanMode({ token, busy, onAdd }: { token: string; busy: boolean; onAdd: (id: string) => Promise<void> }) {
  const [supabase] = useState(() => createClient());
  const [code, setCode] = useState('');
  const [scan, setScan] = useState(true);
  const [look, setLook] = useState<CodeLookup | null>(null);
  const [checking, setChecking] = useState(false);
  const lookup = async (c: string) => {
    const t = c.trim(); if (!t) return;
    setChecking(true);
    try { setLook(await priestLookupCode(supabase, token, t)); } catch { setLook(null); } finally { setChecking(false); }
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input className="input-field flex-1" dir="ltr" placeholder="اكتب الكود أو امسحه" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookup(code); } }} />
        <button type="button" onClick={() => lookup(code)} className="rounded-xl bg-violet-600 px-3 text-xs font-extrabold text-white">تحقق</button>
        <button type="button" onClick={() => setScan((v) => !v)} aria-pressed={scan} aria-label="الكاميرا" className={`rounded-xl px-3 text-white ${scan ? 'bg-orange-700' : 'bg-orange-500'}`}><ScanLine className="h-5 w-5" /></button>
      </div>
      {scan && <QrScanner idPrefix="pc" autoStart hint="وجّه الكاميرا إلى كارت المخدوم" onCode={(v) => { const t = v.trim(); if (t) { setCode(t); lookup(t); } }} />}
      {checking && <p className="flex items-center gap-1 text-[11px] font-bold text-slate-400"><Loader2 className="h-3 w-3 animate-spin" /> جارٍ البحث...</p>}
      {look && !look.found && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">لا يوجد شخص بهذا الكود — استخدم «شخص جديد» لإنشائه</p>}
      {look?.found && look.person && (
        <PersonLine name={look.person.name} url={look.person.image_url} code={look.person.national_id} phone={look.person.phone} places={look.places}
          right={look.is_confessor ? <span className="badge bg-emerald-100 text-emerald-700">من المعترفين ✓</span> : (
            <button type="button" disabled={busy} onClick={() => onAdd(look.person!.id)} className="rounded-xl bg-violet-600 px-3 py-2 text-xs font-extrabold text-white">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'إضافة'}</button>
          )} />
      )}
    </div>
  );
}

function SearchMode({ token, busy, onAdd }: { token: string; busy: boolean; onAdd: (id: string) => Promise<void> }) {
  const [supabase] = useState(() => createClient());
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<PersonHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setHits(null); return; }
    setSearching(true);
    const h = setTimeout(async () => {
      try { setHits(await priestSearchPersons(supabase, token, t)); } catch { setHits([]); } finally { setSearching(false); }
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
      {hits && hits.length === 0 && !searching && <p className="py-3 text-center text-xs font-bold text-slate-400">لا نتائج في كنيستك</p>}
      <div className="space-y-1.5">
        {(hits ?? []).map((h) => (
          <PersonLine key={h.person.id} name={h.person.name} url={h.person.image_url} code={h.person.national_id} phone={h.person.phone} places={h.places}
            right={h.is_confessor || added.has(h.person.id) ? <span className="badge bg-emerald-100 text-emerald-700">✓</span> : (
              <div className="flex flex-col items-end gap-1">
                {h.other_priest && <span className="text-[10px] font-bold text-amber-600">يعترف عند {h.other_priest}</span>}
                <button type="button" disabled={busy} onClick={async () => { await onAdd(h.person.id); setAdded((s) => new Set(s).add(h.person.id)); }} className="rounded-xl bg-violet-600 px-3 py-1.5 text-xs font-extrabold text-white">إضافة</button>
              </div>
            )} />
        ))}
      </div>
    </div>
  );
}

function NewMode({ token, churchId, lastConf, onDone, onFail }: { token: string; churchId: string; lastConf: string; onDone: (c: Confessor) => void; onFail: (e: unknown) => void }) {
  const [supabase] = useState(() => createClient());
  const [codesCfg, setCodesCfg] = useState<CodesConfig | null>(null);
  useEffect(() => { supabase.rpc('code_settings').then(({ data }) => setCodesCfg(data ? normalizeCodes(data) : null)); }, [supabase]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [scan, setScan] = useState(false);
  const [gender, setGender] = useState<Gender | ''>('');
  const [phoneLocal, setPhoneLocal] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [address, setAddress] = useState('');
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
    if (photoBlob) { try { imageUrl = await uploadPhoto(supabase, 'priests', photoBlob, 'confessor.webp'); } catch { /* optional */ } }
    try {
      const c = await addNewConfessor(supabase, token, {
        name, code: code.trim() || null, gender: gender || null, birthdate: birthdate || null,
        phone: phoneLocal ? `${PHONE_PREFIX}${phoneLocal}` : null, address: address.trim() || null, notes: notes.trim() || null,
        image_url: imageUrl, last_confession: lastConf || null,
      });
      onDone(c);
      setName(''); setCode(''); setGender(''); setPhoneLocal(''); setBirthdate(''); setAddress(''); setNotes(''); setPhotoBlob(null); setPreview('');
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
        <label className="mb-1 block text-xs font-bold text-slate-500">الكود <span className="font-normal text-slate-400">(اختياري — يُولَّد تلقائيًا إن تُرك فارغًا)</span></label>
        <div className="flex gap-2">
          <input className="input-field flex-1" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} />
          <button type="button" onClick={() => setCode(renderCode(codesCfg, 'person', { churchId }))} aria-label="توليد كود" className="rounded-xl bg-violet-600 px-3 text-white"><Wand2 className="h-5 w-5" /></button>
          <button type="button" onClick={() => setScan((v) => !v)} aria-label="مسح" className={`rounded-xl px-3 text-white ${scan ? 'bg-orange-700' : 'bg-orange-500'}`}><ScanLine className="h-5 w-5" /></button>
        </div>
        {scan && <QrScanner idPrefix="pn" autoStart hint="امسح الكارت" onCode={(v) => { const t = v.trim(); if (t) { setCode(t); setScan(false); } }} />}
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
        <div><label className="mb-1 block text-xs font-bold text-slate-500">العنوان</label><input className="input-field" value={address} onChange={(e) => setAddress(e.target.value)} /></div>
      </div>
      <div><label className="mb-1 block text-xs font-bold text-slate-500">ملاحظات</label><input className="input-field" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      <button type="button" disabled={busy} onClick={submit} className="btn-primary flex w-full items-center justify-center gap-2 !bg-gradient-to-br !from-violet-600 !to-violet-800">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <UserPlus className="h-5 w-5" />} إنشاء وإضافة</button>
      {rawImage && <PhotoCropModal src={rawImage} onDone={(b) => { setPhotoBlob(b); setPreview(URL.createObjectURL(b)); URL.revokeObjectURL(rawImage); setRawImage(''); }} onClose={() => { URL.revokeObjectURL(rawImage); setRawImage(''); }} />}
    </div>
  );
}
