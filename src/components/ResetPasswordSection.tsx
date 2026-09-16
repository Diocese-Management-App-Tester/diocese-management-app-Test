'use client';

// ---------- كلمة المرور (migrations 0042 + 0043) ----------
// Collapsible section reused by:
//   * EditPersonModal / ManagePeoplePanel — child → RPC admin_set_child_password
//   * EditServantModal (superior)           → /api/servants/account reset_password
//   * EditProfileModal (the servant himself) → requireCurrent: OLD + NEW + CONFIRM
//
// Two modes:
//   requireCurrent = false (default) — a SUPERIOR resets: new password only
//     (generate / «الافتراضية 000000» / typed). `onReset(newPw)`.
//   requireCurrent = true — the OWNER of the account changes it: old password,
//     new password, confirmation. `onReset(newPw, oldPw)`.

import { useState } from 'react';
import { KeyRound, Loader2, Eye, EyeOff, CheckCircle2, Wand2, ChevronDown, RotateCcw } from 'lucide-react';
import { DEFAULT_PASSWORD } from '@/lib/types';

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
  requireCurrent = false,
  showDefault = true,
  defaultOpen = false,
  onReset,
}: {
  title?: string;
  hint?: string;
  idPrefix?: string;
  /** the account owner changes his own password → old + new + confirm */
  requireCurrent?: boolean;
  /** offer the one-tap «الافتراضية 000000» button (superior mode only) */
  showDefault?: boolean;
  defaultOpen?: boolean;
  onReset: (password: string, currentPassword?: string) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [show, setShow] = useState(!requireCurrent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const submit = async () => {
    setError('');
    setDone('');
    if (requireCurrent && !current) return setError('أدخل كلمة المرور القديمة');
    if (pw.length < 6) return setError('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل');
    if (requireCurrent) {
      if (pw !== confirmPw) return setError('تأكيد كلمة المرور غير مطابق');
      if (pw === current) return setError('اختر كلمة مرور مختلفة عن القديمة');
    } else if (!confirm(`سيتم تعيين كلمة المرور الجديدة وإغلاق كل الجلسات المفتوحة.\n\nهل أنت متأكد؟`)) {
      return;
    }
    setBusy(true);
    const err = await onReset(pw, requireCurrent ? current : undefined);
    setBusy(false);
    if (err) return setError(err);
    setDone(requireCurrent ? 'تم تغيير كلمة المرور' : pw);
    setPw('');
    setConfirmPw('');
    setCurrent('');
  };

  const eye = (
    <button type="button" aria-label={show ? 'إخفاء' : 'إظهار'} onClick={() => setShow((s) => !s)} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );

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

          {requireCurrent ? (
            <>
              <div className="relative">
                <input
                  id={`${idPrefix}-current`}
                  type={show ? 'text' : 'password'}
                  dir="ltr"
                  className="input-field pl-10"
                  placeholder="كلمة المرور القديمة"
                  value={current}
                  autoComplete="current-password"
                  onChange={(e) => setCurrent(e.target.value)}
                />
                {eye}
              </div>
              <div className="relative">
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
                {eye}
              </div>
              <div className="relative">
                <input
                  id={`${idPrefix}-confirm`}
                  type={show ? 'text' : 'password'}
                  dir="ltr"
                  className={`input-field pl-10 ${confirmPw && confirmPw !== pw ? '!border-red-300 !bg-red-50' : ''}`}
                  placeholder="تأكيد كلمة المرور الجديدة"
                  value={confirmPw}
                  autoComplete="new-password"
                  onChange={(e) => setConfirmPw(e.target.value)}
                />
                {eye}
              </div>
              <p className="text-[11px] text-slate-400">
                لا تذكر كلمتك القديمة؟ اطلب من مسؤولك (مدير الكنيسة / مسؤول الخدمة) إعادة تعيينها — هو وحده يستطيع ذلك دون معرفة القديمة.
              </p>
            </>
          ) : (
            <>
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
                  {eye}
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
              {showDefault && (
                <button
                  id={`${idPrefix}-default`}
                  type="button"
                  onClick={() => { setPw(DEFAULT_PASSWORD); setShow(true); }}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-extrabold text-slate-600 hover:bg-slate-200 active:scale-[0.98]"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  الكلمة الافتراضية <b dir="ltr">{DEFAULT_PASSWORD}</b>
                </button>
              )}
            </>
          )}

          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
          {done && (
            <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {requireCurrent
                ? <span>{done}</span>
                : <span>تم التعيين — كلمة المرور الجديدة: <b dir="ltr">{done}</b> (أبلغها له)</span>}
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
            {requireCurrent ? 'تغيير كلمة المرور' : 'تعيين كلمة المرور'}
          </button>
        </div>
      )}
    </div>
  );
}
