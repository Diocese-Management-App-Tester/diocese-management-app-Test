'use client';

// ---------- Priest portal — الافتقاد ----------
// The confessors ordered by the period since the LAST CONFESSION (longest
// first) with call · WhatsApp · SMS on every row; the overdue ones (more than
// `reminder_days`, default 40) are highlighted. A tap opens the details sheet
// (history · record a confession · book an appointment).

import { useMemo, useState } from 'react';
import { PhoneCall, AlertTriangle, Settings2, Check, Loader2 } from 'lucide-react';
import PriestShell, { PriestTitle } from '@/components/priest/PriestShell';
import { usePriest } from '@/lib/priest-context';
import { ConfessorCard, sortConfessors } from '@/components/priest/ConfessorBits';
import ConfessorModal from '@/components/priest/ConfessorModal';
import { createClient } from '@/lib/supabase/client';
import { setPriestReminderDays, priestErrorMessage, type Confessor } from '@/lib/priest-portal';

export default function FollowupPage() {
  return <PriestShell><Followup /></PriestShell>;
}

function Followup() {
  const { token, profile, confessors, reloadAll, refresh } = usePriest();
  const [supabase] = useState(() => createClient());
  const [open, setOpen] = useState<Confessor | null>(null);
  const [onlyOverdue, setOnlyOverdue] = useState(true);
  const [editDays, setEditDays] = useState(false);
  const [days, setDays] = useState(String(profile?.priest.reminder_days ?? 40));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const reminder = profile?.priest.reminder_days ?? 40;
  const list = useMemo(() => sortConfessors((confessors ?? []).filter((c) => !onlyOverdue || c.overdue), 'days_desc'), [confessors, onlyOverdue]);
  const overdueCount = (confessors ?? []).filter((c) => c.overdue).length;
  const current = open ? (confessors ?? []).find((c) => c.id === open.id) ?? open : null;

  const saveDays = async () => {
    const n = Number(days);
    if (!token || !Number.isInteger(n) || n < 1 || n > 365) { setErr('عدد الأيام بين 1 و365'); return; }
    setSaving(true); setErr('');
    try { await setPriestReminderDays(supabase, token, n); await refresh(); reloadAll(); setEditDays(false); }
    catch (e) { setErr(priestErrorMessage(e)); } finally { setSaving(false); }
  };

  return (
    <>
      <PriestTitle icon={<PhoneCall className="h-5 w-5 text-violet-600" />} title="الافتقاد" sub="مرتبون من الأطول غيابًا عن الاعتراف — اتصل أو أرسل رسالة ويُسجَّل الافتقاد تلقائيًا"
        action={<button type="button" onClick={() => setEditDays((v) => !v)} aria-label="إعداد التذكير" className="rounded-xl bg-slate-100 p-2 text-slate-600"><Settings2 className="h-5 w-5" /></button>} />

      {editDays && (
        <div className="card mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-bold text-slate-600">تذكير بعد</span>
          <input type="number" min={1} max={365} className="input-field !w-24 text-center" value={days} onChange={(e) => setDays(e.target.value)} />
          <span className="font-bold text-slate-600">يومًا بلا اعتراف</span>
          <button type="button" disabled={saving} onClick={saveDays} className="btn-primary flex items-center gap-1 !px-3 !py-1.5 !bg-gradient-to-br !from-violet-600 !to-violet-800">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} حفظ</button>
          {err && <span className="text-xs font-bold text-red-600">{err}</span>}
        </div>
      )}

      <div className={`mb-3 flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-extrabold ${overdueCount ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
        <AlertTriangle className="h-5 w-5" />
        {overdueCount ? `${overdueCount} معترف لم يعترف منذ أكثر من ${reminder} يومًا` : `لا أحد تجاوز ${reminder} يومًا بلا اعتراف 🙏`}
      </div>

      <div role="tablist" className="mb-3 grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
        <button role="tab" aria-selected={onlyOverdue} onClick={() => setOnlyOverdue(true)} className={`rounded-xl py-2 text-xs font-extrabold ${onlyOverdue ? 'bg-white text-rose-700 shadow' : 'text-slate-500'}`}>المتأخرون فقط ({overdueCount})</button>
        <button role="tab" aria-selected={!onlyOverdue} onClick={() => setOnlyOverdue(false)} className={`rounded-xl py-2 text-xs font-extrabold ${!onlyOverdue ? 'bg-white text-violet-700 shadow' : 'text-slate-500'}`}>كل المعترفين ({confessors?.length ?? 0})</button>
      </div>

      {confessors === null ? <div className="card py-8 text-center text-xs text-slate-400">جارٍ التحميل...</div>
        : list.length === 0 ? <div className="card py-10 text-center text-sm font-bold text-slate-400">لا أحد هنا</div>
        : <ul className="space-y-2">{list.map((c) => <ConfessorCard key={c.id} c={c} reminderDays={reminder} onOpen={setOpen} onChanged={reloadAll} />)}</ul>}
      {current && <ConfessorModal c={current} onClose={() => setOpen(null)} onChanged={reloadAll} />}
    </>
  );
}
