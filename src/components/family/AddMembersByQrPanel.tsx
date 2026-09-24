'use client';

// ---------- العائلات → QR → إضافة أفراد ----------
// Scan card after card (or type the code): the person is added to the
// family instantly with the pre-selected relation. A person who already
// belongs to ANOTHER family asks «نقل؟» (a person is in one family only).

import { useMemo, useState } from 'react';
import {
  UsersRound, QrCode, Loader2, Check, X, UserPlus, AlertCircle, CheckCircle2, ArrowLeftRight, Keyboard,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { PersonAvatar } from '@/components/CallFeedback';
import QrScanner from '@/components/store/QrScanner';
import {
  RELATIONS, RELATION_LABELS, relationLabel, addFamilyMemberByCode, FAMILY_ADD_ERROR_LABELS,
  type Family, type FamilyMemberWithPerson, type FamilyRelation, type FamilyAddResult,
} from '@/lib/families';

interface AddLogEntry { id: string; kind: 'ok' | 'moved' | 'err'; name: string; code: string; detail: string }

export default function AddMembersByQrPanel({
  family, members, onAdded,
}: {
  family: Family;
  members: FamilyMemberWithPerson[];
  /** a member was added (or moved in) — the caller refreshes its lists */
  onAdded: (r: FamilyAddResult) => void;
}) {
  const supabase = createClient();
  const [relation, setRelation] = useState<FamilyRelation | ''>('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<AddLogEntry[]>([]);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [moveAsk, setMoveAsk] = useState<{ code: string; other: { id: string; name: string } } | null>(null);

  const memberCodes = useMemo(() => new Set(members.map((m) => m.person.national_id)), [members]);

  const push = (e: Omit<AddLogEntry, 'id'>) =>
    setLog((prev) => [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...e }, ...prev].slice(0, 50));

  const add = async (rawCode: string, move = false) => {
    const code = rawCode.trim();
    if (!code || busy) return;
    if (!move && memberCodes.has(code)) {
      setFlash({ kind: 'err', text: `الكود ${code} موجود بالفعل في هذه العائلة` });
      return;
    }
    setBusy(true);
    setFlash(null);
    const out = await addFamilyMemberByCode(supabase, family.id, code, relation || null, move);
    setBusy(false);
    if (!out.ok) {
      if (out.error === 'in_other_family' && out.otherFamily) {
        setMoveAsk({ code, other: out.otherFamily });
        return;
      }
      const text = FAMILY_ADD_ERROR_LABELS[out.error];
      setFlash({ kind: 'err', text: `${code} — ${text}` });
      push({ kind: 'err', name: '—', code, detail: text });
      return;
    }
    const r = out.result;
    const rel = relationLabel(r.relation);
    if (r.moved_from) {
      setFlash({ kind: 'ok', text: `تم نقل ${r.person.name} من «${r.moved_from.name}» إلى هذه العائلة ✔` });
      push({ kind: 'moved', name: r.person.name, code, detail: `نُقل من ${r.moved_from.name}${rel ? ` · ${rel}` : ''}` });
    } else {
      setFlash({ kind: 'ok', text: `تمت إضافة ${r.person.name} ✔${rel ? ` (${rel})` : ''}` });
      push({ kind: 'ok', name: r.person.name, code, detail: rel || 'بدون صلة محددة' });
    }
    onAdded(r);
    setTyped('');
  };

  return (
    <div id="family-add-by-qr">
      <div className="mb-3 rounded-2xl bg-teal-50 px-3 py-2 text-xs font-bold text-teal-700">
        <p className="flex items-center gap-1.5"><QrCode className="h-4 w-4 shrink-0" /> امسح كود كل فرد (QR الكارت) واحداً بعد الآخر — يُضاف إلى «{family.name}» فوراً.</p>
        <p className="mt-1 text-[11px] text-teal-600">اختر صلة القرابة قبل المسح لتُسجَّل مع الفرد (يمكن تعديلها لاحقاً).</p>
      </div>

      <label className="mb-1 block text-xs font-bold text-slate-500">صلة القرابة للأفراد التاليين</label>
      <div id="family-add-relations" className="mb-3 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setRelation('')} aria-pressed={relation === ''}
          className={`rounded-xl px-3 py-1.5 text-xs font-extrabold transition ${relation === '' ? 'bg-slate-700 text-white shadow' : 'bg-slate-100 text-slate-500'}`}>
          بدون
        </button>
        {RELATIONS.map((r) => (
          <button key={r} type="button" onClick={() => setRelation(r)} aria-pressed={relation === r}
            className={`rounded-xl px-3 py-1.5 text-xs font-extrabold transition ${relation === r ? 'bg-teal-600 text-white shadow' : 'bg-teal-50 text-teal-700'}`}>
            {RELATION_LABELS[r]}
          </button>
        ))}
      </div>

      <QrScanner
        idPrefix="family-add"
        autoStart
        paused={busy || !!moveAsk}
        hint="شغّل الكاميرا ووجّهها إلى كود الفرد"
        onCode={(c) => add(c)}
      />

      {/* typed code fallback */}
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); add(typed); }}>
        <div className="relative flex-1">
          <Keyboard className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            id="family-add-code"
            className="input-field pr-9 font-mono"
            placeholder="أو اكتب الكود يدوياً…"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            dir="ltr"
          />
        </div>
        <button id="family-add-submit" type="submit" disabled={busy || !typed.trim()} className="btn-primary flex items-center gap-1.5 !px-4">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} إضافة
        </button>
      </form>

      {flash && (
        <p id="family-add-flash" className={`mt-3 flex items-center gap-2 rounded-2xl px-3 py-2.5 text-sm font-bold ${flash.kind === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
          {flash.kind === 'ok' ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <AlertCircle className="h-5 w-5 shrink-0" />}
          <span>{flash.text}</span>
        </p>
      )}

      {/* move confirmation */}
      {moveAsk && (
        <div id="family-move-ask" className="mt-3 rounded-2xl border-2 border-amber-200 bg-amber-50 p-3">
          <p className="flex items-center gap-1.5 text-sm font-extrabold text-amber-700">
            <ArrowLeftRight className="h-4 w-4" /> الكود <span dir="ltr" className="font-mono">{moveAsk.code}</span> موجود في عائلة «{moveAsk.other.name}»
          </p>
          <p className="mt-1 text-xs font-bold text-amber-600">الشخص ينتمي لعائلة واحدة فقط — هل تريد نقله إلى «{family.name}»؟</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button id="family-move-confirm" type="button" onClick={() => { const c = moveAsk.code; setMoveAsk(null); add(c, true); }}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 py-2 text-sm font-extrabold text-white shadow active:scale-95">
              <ArrowLeftRight className="h-4 w-4" /> نقل إلى هنا
            </button>
            <button type="button" onClick={() => setMoveAsk(null)} className="btn-secondary !py-2 text-sm">إلغاء</button>
          </div>
        </div>
      )}

      {/* current members */}
      <div className="mt-4">
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-extrabold text-slate-500">
          <UsersRound className="h-4 w-4" /> أفراد العائلة الآن <span className="badge bg-teal-100 text-teal-700">{members.length}</span>
        </h4>
        {members.length === 0 ? (
          <p className="rounded-2xl bg-slate-50 py-4 text-center text-xs font-bold text-slate-400">لا يوجد أفراد بعد — امسح أول كود</p>
        ) : (
          <ul className="space-y-1.5">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
                <PersonAvatar name={m.person.name} imageUrl={m.person.image_url} size={32} />
                <span className="min-w-0 flex-1 truncate text-sm font-bold">{m.person.name}</span>
                {m.relation && <span className="badge bg-teal-100 text-teal-700">{relationLabel(m.relation)}</span>}
                <span className="font-mono text-[10px] font-bold text-slate-400" dir="ltr">{m.person.national_id}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* session log */}
      {log.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-2 text-xs font-extrabold text-slate-500">سجل المسح في هذه الجلسة</h4>
          <ul className="card !p-0 divide-y divide-slate-100 overflow-hidden">
            {log.map((l) => (
              <li key={l.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                  l.kind === 'ok' ? 'bg-emerald-100 text-emerald-600' : l.kind === 'moved' ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-500'}`}>
                  {l.kind === 'err' ? <X className="h-4 w-4" /> : l.kind === 'moved' ? <ArrowLeftRight className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-extrabold">{l.name}</span>
                  <span className="block truncate text-[10px] font-bold text-slate-400">{l.detail}</span>
                </span>
                <span className="font-mono text-[10px] text-slate-400" dir="ltr">{l.code}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
