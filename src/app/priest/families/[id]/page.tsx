'use client';

// ---------- Priest portal — العائلة (details) ----------
// Header (name · code · place · phone · directions) · quick actions
// (تسجيل زيارة · ترتيب زيارة · إضافة أفراد · تعديل · حذف) · the members with
// their relation (editable) · the area priests · the visits history.
// URL: /priest/families/<id>[?members=1]

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowRight, UsersRound, UserPlus, Pencil, Trash2, Footprints, CalendarPlus, MapPin, Loader2, Check, X, Cross, Home, Phone, QrCode, Copy, Share2,
} from 'lucide-react';
import PriestShell, { PersonPhoto } from '@/components/priest/PriestShell';
import { usePriest } from '@/lib/priest-context';
import { createClient } from '@/lib/supabase/client';
import { todayYmd, shortTime } from '@/lib/priest-portal';
import { RELATIONS, RELATION_LABELS, relationLabel } from '@/lib/families';
import {
  type PriestFamilyDetail, type FamilyMemberRow, fetchPriestFamily, createVisit, deletePriestFamily, priestFamilySetRelation, priestFamilyRemoveMember, deleteVisit, familyErrorMessage, placeLine,
} from '@/lib/priest-families';
import { DirectionsButton, LocationLine, PhoneButtons, VisitBadge, VisitRow, ConfirmDelete } from '@/components/priest/FamilyBits';
import FamilyFormModal from '@/components/priest/FamilyFormModal';
import AddFamilyMembersPanel from '@/components/priest/AddFamilyMembersPanel';
import { fmtDay } from '@/components/child/ChildBits';

export default function FamilyDetailPage() {
  return (
    <PriestShell>
      <Suspense fallback={<div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-violet-400" /></div>}>
        <FamilyDetail />
      </Suspense>
    </PriestShell>
  );
}

type Panel = 'none' | 'record' | 'schedule';

function FamilyDetail() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const { token, profile, reloadAll } = usePriest();
  const [supabase] = useState(() => createClient());
  const [f, setF] = useState<PriestFamilyDetail | null>(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [editing, setEditing] = useState(false);
  const [addingMembers, setAddingMembers] = useState(params.get('members') === '1');
  const [deleting, setDeleting] = useState(false);
  const [panel, setPanel] = useState<Panel>('none');
  const [busy, setBusy] = useState(false);
  const [on, setOn] = useState(todayYmd());
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [codeOpen, setCodeOpen] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try { setF(await fetchPriestFamily(supabase, token, id)); setErr(''); } catch (e) { setErr(familyErrorMessage(e)); }
  }, [token, supabase, id]);
  useEffect(() => { load(); }, [load]);
  const changed = () => { load(); reloadAll(); };

  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true); setErr(''); setOk('');
    try { await fn(); setOk(done); setPanel('none'); setNote(''); changed(); setTimeout(() => setOk(''), 2000); }
    catch (e) { setErr(familyErrorMessage(e)); } finally { setBusy(false); }
  };

  if (err && !f) return <div className="card text-center text-sm font-bold text-red-600">{err} — <Link href="/priest/families" className="underline">العائلات</Link></div>;
  if (!f) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-violet-400" /></div>;
  const place = placeLine(f);
  const openVisits = f.visits.filter((v) => v.status === 'pending' || v.status === 'approved');
  const pastVisits = f.visits.filter((v) => !openVisits.includes(v));

  return (
    <>
      <section className="mb-3 flex items-start gap-2">
        <Link href="/priest/families" aria-label="رجوع" className="mt-1 rounded-full p-1.5 hover:bg-slate-100"><ArrowRight className="h-5 w-5" /></Link>
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow"><UsersRound className="h-6 w-6" /></div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-extrabold">{f.name}</h2>
          <button type="button" onClick={() => setCodeOpen(true)} className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-violet-700" dir="ltr"><QrCode className="h-3 w-3" /> {f.code}</button>
          {place && <p className="mt-0.5 flex items-center gap-1 text-xs font-bold text-slate-600"><MapPin className="h-3.5 w-3.5 text-violet-500" />{place}</p>}
          {f.address && <p className="text-[11px] text-slate-500">{f.address}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <VisitBadge f={f} />
            {f.last_visit && <span className="text-[10px] font-bold text-slate-400">آخر زيارة {fmtDay(f.last_visit)}</span>}
            <span className="badge bg-slate-100 text-slate-500 tabular-nums">{f.members_count} فرد</span>
          </div>
          <LocationLine loc={f.location} />
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex gap-1">
            <button type="button" onClick={() => setEditing(true)} aria-label="تعديل" className="rounded-lg bg-slate-100 p-1.5 text-slate-600"><Pencil className="h-4 w-4" /></button>
            <button type="button" onClick={() => setDeleting(true)} aria-label="حذف" className="rounded-lg bg-red-50 p-1.5 text-red-600"><Trash2 className="h-4 w-4" /></button>
          </div>
          <PhoneButtons phone={f.phone} size="sm" />
        </div>
      </section>

      <div className="mb-3 grid grid-cols-3 gap-2">
        <button id="fd-record" type="button" onClick={() => setPanel(panel === 'record' ? 'none' : 'record')} className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-2.5 text-xs font-extrabold transition ${panel === 'record' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700'}`}><Footprints className="h-5 w-5" /> تسجيل زيارة</button>
        <button id="fd-schedule" type="button" onClick={() => setPanel(panel === 'schedule' ? 'none' : 'schedule')} className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-2.5 text-xs font-extrabold transition ${panel === 'schedule' ? 'bg-violet-600 text-white' : 'bg-violet-50 text-violet-700'}`}><CalendarPlus className="h-5 w-5" /> ترتيب زيارة</button>
        <DirectionsButtonBig loc={f.location} />
      </div>

      {panel !== 'none' && (
        <form onSubmit={(e) => { e.preventDefault(); if (!token) return; run(async () => { await createVisit(supabase, token, f.id, on, { time: time || null, note: panel === 'schedule' ? note || null : null, done: panel === 'record', visitNote: panel === 'record' ? note || null : null }); }, panel === 'record' ? 'تم تسجيل الزيارة ✔' : 'تم ترتيب الزيارة ✔'); }}
          className={`card mb-3 space-y-2 ${panel === 'record' ? 'ring-1 ring-emerald-200' : 'ring-1 ring-violet-200'}`}>
          <p className="text-sm font-extrabold">{panel === 'record' ? 'زيارة تمّت — متى؟' : 'زيارة قادمة — متى؟'}</p>
          <div className="grid grid-cols-2 gap-2">
            <input type="date" className="input-field" required value={on} min={panel === 'schedule' ? todayYmd() : undefined} max={panel === 'record' ? todayYmd() : undefined} onChange={(e) => setOn(e.target.value)} />
            <input type="time" className="input-field" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <input className="input-field" placeholder={panel === 'record' ? 'ملاحظة عن الزيارة (اختياري)' : 'ملاحظة للعائلة (اختياري)'} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={`flex flex-1 items-center justify-center gap-1 rounded-xl py-2 text-sm font-extrabold text-white ${panel === 'record' ? 'bg-emerald-600' : 'bg-violet-600'}`}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} حفظ</button>
            <button type="button" onClick={() => setPanel('none')} className="btn-secondary !py-2 text-sm">إلغاء</button>
          </div>
        </form>
      )}
      {ok && <p className="mb-3 flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700"><Check className="h-4 w-4" />{ok}</p>}
      {err && <p className="mb-3 rounded-2xl bg-red-50 px-4 py-2 text-sm font-bold text-red-600">{err}</p>}

      {/* members */}
      <section className="card mb-3 !p-0 overflow-hidden">
        <h3 className="flex items-center justify-between bg-violet-50 px-4 py-2 text-sm font-extrabold text-violet-800">
          <span className="flex items-center gap-2"><UsersRound className="h-4 w-4" /> الأفراد ({f.members_count})</span>
          <button id="fd-add-members" type="button" onClick={() => setAddingMembers(true)} className="flex items-center gap-1 rounded-xl bg-violet-600 px-2.5 py-1 text-[11px] font-extrabold text-white"><UserPlus className="h-3.5 w-3.5" /> إضافة أفراد</button>
        </h3>
        {f.members.length === 0 ? <p className="py-6 text-center text-xs font-bold text-slate-400">لا أفراد بعد — اضغط «إضافة أفراد» (مسح كود · بحث · فرد جديد)</p> : (
          <ul className="divide-y divide-indigo-50 px-3">{f.members.map((m) => <MemberRow key={m.id} m={m} onChanged={changed} />)}</ul>
        )}
      </section>

      {/* area priests */}
      <section className="card mb-3 !p-3">
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-extrabold text-slate-600"><Cross className="h-4 w-4 text-violet-600" /> كهنة المنطقة {f.area_name ? `(${f.area_name})` : ''}</p>
        {!f.area_id ? <p className="text-[11px] font-bold text-amber-700">العائلة غير مرتبطة بمنطقة — اضغط «تعديل» لربطها فيرى أفرادها كاهن منطقتهم</p>
          : f.area_priests.length === 0 ? <p className="text-[11px] font-bold text-amber-700">لا كاهن مرتبط بهذه المنطقة — من <Link href="/priest/areas" className="underline">المناطق</Link> اربط نفسك بها</p>
          : <div className="flex flex-wrap gap-1.5">{f.area_priests.map((p) => <span key={p.id} className={`badge ${p.id === profile?.priest.id ? 'bg-violet-600 text-white' : 'bg-violet-50 text-violet-700'}`}>{p.title ? `${p.title} ` : ''}{p.name}</span>)}</div>}
      </section>

      {/* visits */}
      <section className="card mb-3 !p-0 overflow-hidden">
        <h3 className="flex items-center gap-2 bg-emerald-50 px-4 py-2 text-sm font-extrabold text-emerald-800"><Footprints className="h-4 w-4" /> الزيارات ({f.visits_count} تمّت{openVisits.length ? ` · ${openVisits.length} قادمة / طلب` : ''})</h3>
        {f.visits.length === 0 ? <p className="py-6 text-center text-xs font-bold text-slate-400">لا زيارات بعد — سجّل زيارة تمّت أو رتّب زيارة قادمة</p> : (
          <ul className="divide-y divide-indigo-50 px-4">
            {openVisits.map((v) => <VisitRow key={v.id} v={v} onChanged={changed} showFamily={false} />)}
            {pastVisits.map((v) => (
              <li key={v.id} className="flex items-start gap-2 py-2 text-xs">
                <span className={`badge ${v.status === 'done' ? 'bg-emerald-100 text-emerald-700' : v.status === 'rejected' ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'}`}>{v.status === 'done' ? 'تمّت' : v.status === 'rejected' ? 'مرفوضة' : 'ملغاة'}</span>
                <span className="flex-1 font-bold text-slate-700">{fmtDay(v.on)}{v.time ? ` · ${shortTime(v.time)}` : ''}
                  {v.priest && v.priest.id !== profile?.priest.id && <span className="block text-[11px] font-normal text-slate-400">{v.priest.title ? `${v.priest.title} ` : ''}{v.priest.name}</span>}
                  {v.visit_note && <span className="block text-[11px] font-normal text-emerald-700">📝 {v.visit_note}</span>}
                  {v.decision_note && <span className="block text-[11px] font-normal text-slate-400">↩ {v.decision_note}</span>}
                </span>
                {v.priest_id === profile?.priest.id && <button type="button" aria-label="حذف" onClick={() => { if (token) run(async () => { await deleteVisit(supabase, token, v.id); }, 'حُذفت'); }} className="text-slate-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {f.notes && <p className="card mb-3 text-xs text-slate-600">📝 {f.notes}</p>}

      {editing && <FamilyFormModal family={f} onSaved={() => { setEditing(false); changed(); }} onClose={() => setEditing(false)} />}
      {addingMembers && <AddFamilyMembersPanel family={f} onAdded={changed} onClose={() => setAddingMembers(false)} />}
      {deleting && <ConfirmDelete title="حذف العائلة" text={`حذف «${f.name}» يفكّ ارتباط أفرادها (${f.members_count}) ويحذف زياراتها — بيانات الأشخاص تبقى.`} busy={busy}
        onConfirm={async () => { if (!token) return; setBusy(true); try { await deletePriestFamily(supabase, token, f.id); reloadAll(); router.replace('/priest/families'); } catch (e) { setErr(familyErrorMessage(e)); setBusy(false); setDeleting(false); } }}
        onClose={() => setDeleting(false)} />}
      {codeOpen && <FamilyCodeSheet code={f.code} name={f.name} onClose={() => setCodeOpen(false)} />}
    </>
  );
}

function DirectionsButtonBig({ loc }: { loc: PriestFamilyDetail['location'] }) {
  const has = !!loc;
  return has ? (
    <div className="flex"><DirectionsButton loc={loc} /></div>
  ) : (
    <span className="flex flex-col items-center gap-1 rounded-2xl bg-slate-50 px-2 py-2.5 text-center text-[11px] font-bold text-slate-400"><MapPin className="h-5 w-5" /> بلا موقع — أضفه من «تعديل»</span>
  );
}

function MemberRow({ m, onChanged }: { m: FamilyMemberRow; onChanged: () => void }) {
  const { token } = usePriest();
  const [supabase] = useState(() => createClient());
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const kids = m.places.filter((p) => p.kind === 'child');
  return (
    <li className="flex items-center gap-2.5 py-2">
      <PersonPhoto name={m.person.name} url={m.person.image_url} size={40} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-extrabold text-slate-800">{m.person.name}</p>
        <p className="truncate text-[11px] text-slate-400" dir="ltr">{m.person.national_id}{m.person.phone ? ` · ${m.person.phone}` : ''}</p>
        {kids.length > 0 && <p className="truncate text-[11px] font-bold text-slate-400">{kids.map((p) => `${p.service_name} · ${p.class_name}`).join(' — ')}</p>}
      </div>
      <select aria-label="صلة القرابة" className="input-field !w-auto !py-1 text-xs" value={m.relation ?? ''} disabled={busy}
        onChange={async (e) => { if (!token) return; setBusy(true); try { await priestFamilySetRelation(supabase, token, m.id, e.target.value || null); onChanged(); } finally { setBusy(false); } }}>
        <option value="">—</option>
        {RELATIONS.map((r) => <option key={r} value={r}>{RELATION_LABELS[r]}</option>)}
      </select>
      {m.person.phone && <a href={`tel:${m.person.phone}`} aria-label={`اتصال بـ ${m.person.name}`} className="rounded-lg bg-teal-50 p-1.5 text-teal-700"><Phone className="h-4 w-4" /></a>}
      {confirm ? (
        <div className="flex gap-1">
          <button type="button" disabled={busy} onClick={async () => { if (!token) return; setBusy(true); try { await priestFamilyRemoveMember(supabase, token, m.id); onChanged(); } finally { setBusy(false); setConfirm(false); } }} className="rounded-lg bg-red-500 px-2 py-1 text-[11px] font-extrabold text-white">إزالة</button>
          <button type="button" onClick={() => setConfirm(false)} className="rounded-lg bg-slate-100 p-1"><X className="h-3.5 w-3.5" /></button>
        </div>
      ) : <button type="button" onClick={() => setConfirm(true)} aria-label={`إزالة ${m.person.name} من العائلة`} title={relationLabel(m.relation) || 'إزالة'} className="rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>}
    </li>
  );
}

function FamilyCodeSheet({ code, name, onClose }: { code: string; name: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState('');
  useEffect(() => { import('qrcode').then((q) => q.toDataURL(code, { margin: 1, width: 240 }).then(setUrl)).catch(() => {}); }, [code]);
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-sm space-y-3 rounded-t-3xl bg-white p-5 text-center shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-base font-extrabold"><Home className="h-5 w-5 text-violet-600" /> كود العائلة</h3><button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url && <img src={url} alt={code} className="mx-auto h-56 w-56 rounded-2xl ring-1 ring-slate-100" />}
        <p className="text-sm font-extrabold">{name}</p>
        <p className="text-lg font-extrabold tracking-wider text-violet-700" dir="ltr">{code}</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="btn-secondary flex items-center justify-center gap-1 text-sm">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'نُسخ' : 'نسخ'}</button>
          <button type="button" onClick={() => { if (navigator.share) navigator.share({ title: name, text: `كود عائلة ${name}: ${code}` }).catch(() => {}); }} className="btn-secondary flex items-center justify-center gap-1 text-sm"><Share2 className="h-4 w-4" /> مشاركة</button>
        </div>
      </div>
    </div>
  );
}
