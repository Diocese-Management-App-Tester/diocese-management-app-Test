'use client';

// ---------- إعادة تعيين كلمة المرور (migration 0042) ----------
// Collapsible section reused by:
//   * EditPersonModal  — child  → RPC admin_set_child_password (kills sessions)
//   * EditPersonModal  — servant mirror row / ServantsPanel → /api/servants/account
// `onReset(password)` performs the actual call and returns an error text or null.

import { useState } from 'react';
import { KeyRound, Loader2, Eye, EyeOff, CheckCircle2, Wand2, ChevronDown } from 'lucide-react';

const genPassword = () => {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  const arr = new Uint32Array(8);
  crypto.getRandomValues(arr);
  arr.forEach((n) => { out += chars[n % chars.length]; });
  return out;
};

export default function ResetPasswordSection({
  title = 'إعادة تعيين كلمة المرور',
  hint,
  idPrefix = 'reset-pw',
  onReset,
}: {
  title?: string;
  hint?: string;
  idPrefix?: string;
  onReset: (password: string) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const submit = async () => {
    setError('');
    setDone('');
    if (pw.length < 6) return setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
    if (!confirm(`سيتم تعيين كلمة المرور الجديدة وإغلاق كل الجلسات المفتوحة.\n\nهل أنت متأكد؟`)) return;
    setBusy(true);
    const err = await onReset(pw);
    setBusy(false);
    if (err) return setError(err);
    setDone(pw);
    setPw('');
  };

  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/60">
      <button
        id={`${idPrefix}-toggle`}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-right"
        aria-expanded={open}
      >
        <KeyRound className="h-4 w-4 text-primary-500" />
        <span className="flex-1 text-xs font-extrabold text-slate-600">{title}</span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-slate-100 px-3 py-3">
          {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                id={`${idPrefix}-input`}
                type={show ? 'text' : 'password'}
                dir="ltr"
                className="input-field pl-10"
                placeholder="كلمة المرور الجديدة"
                value={pw}
                autoComplete="new-password"
                onChange={(e) => setPw(e.target.value)}
              />
              <button type="button" aria-label="إظهار" onClick={() => setShow((s) => !s)} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <button
              id={`${idPrefix}-generate`}
              type="button"
              onClick={() => { setPw(genPassword()); setShow(true); }}
              aria-label="توليد كلمة مرور"
              title="توليد كلمة مرور"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow hover:bg-primary-700 active:scale-95"
            >
              <Wand2 className="h-5 w-5" />
            </button>
          </div>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
          {done && (
            <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>تم التعيين — كلمة المرور الجديدة: <b dir="ltr">{done}</b> (أبلغها له)</span>
            </p>
          )}
          <button
            id={`${idPrefix}-submit`}
            type="button"
            onClick={submit}
            disabled={busy}
            className="btn-secondary w-full flex items-center justify-center gap-2 !py-2.5 text-sm"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            تعيين كلمة المرور
          </button>
        </div>
      )}
    </div>
  );
}
