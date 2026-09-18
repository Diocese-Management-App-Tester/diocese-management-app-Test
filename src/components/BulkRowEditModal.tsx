'use client';

// ---------- تعديل صف قبل الاستيراد الجماعي ----------
// Shared by «إضافة مخدومين → إضافة جماعية» and «إدارة الخدام → إضافة → جماعي».
// Opens for one preview row and lets the manager correct EVERY value (name,
// gender, code, password, birthdate, phone, address, notes, points) before
// the import runs. Saves a `BulkRowEdits` patch — the caller merges it over
// the parsed cells. A bad phone / date can be fixed here or CLEARED, so a
// single bad entry never blocks the whole row.

import { useEffect, useMemo, useState } from 'react';
import { X, Check, Pencil, Trash2, Eraser } from 'lucide-react';
import { PHONE_PREFIX, PHONE_LOCAL_LENGTH, GENDER_LABELS, type Gender } from '@/lib/types';
import type { BulkRowEdits } from '@/lib/bulk-import';

const MONTHS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

/** The row values as they will be imported (already merged with previous edits) */
export interface BulkRowEditValues {
  name: string;
  gender: Gender | null;
  code: string;                  // '' | 'AUTO' | value
  password?: string;             // servants: '' | 'AUTO' | value
  birthdate: string | null;      // YYYY-MM-DD
  birthdateRaw: string;          // what the sheet said (shown when unparsed)
  phoneLocal: string;            // digits after +2 (may be invalid length)
  phoneRaw: string;              // what the sheet said
  address: string;
  notes: string;
  points?: number;               // children
}

export default function BulkRowEditModal({
  title, rowNumber, values, showPassword = false, showPoints = false, codeLabel = 'الكود',
  onSave, onClose, onRemove,
}: {
  title?: string;
  rowNumber: number;
  values: BulkRowEditValues;
  showPassword?: boolean;
  showPoints?: boolean;
  codeLabel?: string;
  onSave: (edits: BulkRowEdits) => void;
  onClose: () => void;
  onRemove?: () => void;
}) {
  const [name, setName] = useState(values.name);
  const [gender, setGender] = useState<Gender | ''>(values.gender ?? '');
  const [code, setCode] = useState(values.code === 'AUTO' ? '' : values.code);
  const [password, setPassword] = useState(values.password === 'AUTO' ? '' : (values.password ?? ''));
  const [phoneLocal, setPhoneLocal] = useState(values.phoneLocal);
  const [address, setAddress] = useState(values.address);
  const [notes, setNotes] = useState(values.notes);
  const [points, setPoints] = useState(String(values.points ?? 0));

  // birthdate as day / month / year
  const [bDay, setBDay] = useState('');
  const [bMonth, setBMonth] = useState('');
  const [bYear, setBYear] = useState('');
  useEffect(() => {
    if (values.birthdate) {
      const [y, m, d] = values.birthdate.split('-');
      setBYear(String(Number(y))); setBMonth(String(Number(m))); setBDay(String(Number(d)));
    } else { setBYear(''); setBMonth(''); setBDay(''); }
  }, [values.birthdate]);

  const currentYear = new Date().getFullYear();
  const years = useMemo(() => Array.from({ length: 100 }, (_, i) => currentYear - i), [currentYear]);
  const daysInMonth = useMemo(() => {
    if (!bMonth) return 31;
    return new Date(Number(bYear) || 2000, Number(bMonth), 0).getDate();
  }, [bMonth, bYear]);
  useEffect(() => { if (bDay && Number(bDay) > daysInMonth) setBDay(String(daysInMonth)); }, [daysInMonth, bDay]);

  const phoneOk = phoneLocal === '' || phoneLocal.length === PHONE_LOCAL_LENGTH;
  const dateComplete = !!(bDay && bMonth && bYear);
  const datePartial = !dateComplete && !!(bDay || bMonth || bYear);
  const pwOk = !showPassword || password === '' || password.length >= 6;
  const canSave = name.trim() !== '' && phoneOk && !datePartial && pwOk;

  const save = () => {
    if (!canSave) return;
    const edits: BulkRowEdits = {
      name: name.trim(),
      gender: gender || null,
      code: code.trim(),
      birthdate: dateComplete ? `${bYear}-${String(bMonth).padStart(2, '0')}-${String(bDay).padStart(2, '0')}` : null,
      phone: phoneLocal,
      address: address.trim(),
      notes: notes.trim(),
    };
    if (showPassword) edits.password = password;
    if (showPoints) edits.points = Math.max(0, Math.floor(Number(points) || 0));
    onSave(edits);
  };

  const field = (label: string, node: React.ReactNode, hint?: React.ReactNode) => (
    <div>
      <label className="mb-1 block text-xs font-bold text-slate-500">{label}</label>
      {node}
      {hint}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-base font-extrabold text-slate-800">
            <Pencil className="h-4 w-4 text-primary-500" />
            {title ?? 'تعديل الصف'} <span className="text-xs font-bold text-slate-400">— صف {rowNumber}</span>
          </h3>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3">
          {field('الاسم *',
            <input id="bulk-edit-name" className="input-field" value={name} onChange={(e) => setName(e.target.value)} />,
            !name.trim() && <p className="mt-1 text-[11px] font-bold text-red-500">الاسم مطلوب</p>)}

          {field('النوع',
            <div className="grid grid-cols-3 gap-2">
              {([['', '—'], ['male', GENDER_LABELS.male], ['female', GENDER_LABELS.female]] as [Gender | '', string][]).map(([v, l]) => (
                <button key={v || 'none'} type="button" aria-pressed={gender === v} onClick={() => setGender(v)}
                  className={`rounded-xl py-2 text-xs font-extrabold transition active:scale-95 ${
                    gender === v
                      ? v === 'male' ? 'bg-primary-600 text-white shadow' : v === 'female' ? 'bg-pink-500 text-white shadow' : 'bg-slate-600 text-white shadow'
                      : 'bg-slate-100 text-slate-500'
                  }`}>
                  {l}
                </button>
              ))}
            </div>)}

          {field(codeLabel,
            <input id="bulk-edit-code" className="input-field" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)}
              placeholder={values.code === 'AUTO' ? 'فارغ = توليد تلقائي' : ''} autoComplete="off" />)}

          {showPassword && field('كلمة المرور',
            <input id="bulk-edit-password" className="input-field" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder={values.password === 'AUTO' ? 'فارغة = توليد تلقائي' : '6 أحرف على الأقل'} autoComplete="off" />,
            !pwOk && <p className="mt-1 text-[11px] font-bold text-red-500">كلمة المرور أقل من 6 أحرف</p>)}

          {field('تاريخ الميلاد',
            <div className="space-y-1">
              <div className="grid grid-cols-3 gap-2">
                <select id="bulk-edit-bday" className="input-field !px-2" value={bDay} onChange={(e) => setBDay(e.target.value)} aria-label="اليوم">
                  <option value="">يوم</option>
                  {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <select id="bulk-edit-bmonth" className="input-field !px-2" value={bMonth} onChange={(e) => setBMonth(e.target.value)} aria-label="الشهر">
                  <option value="">شهر</option>
                  {MONTHS_AR.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
                <select id="bulk-edit-byear" className="input-field !px-2" value={bYear} onChange={(e) => setBYear(e.target.value)} aria-label="السنة">
                  <option value="">سنة</option>
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              {(bDay || bMonth || bYear) && (
                <button type="button" onClick={() => { setBDay(''); setBMonth(''); setBYear(''); }}
                  className="flex items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-red-400">
                  <Eraser className="h-3 w-3" /> بدون تاريخ
                </button>
              )}
            </div>,
            <>
              {values.birthdateRaw && !values.birthdate && (
                <p className="mt-1 text-[11px] font-bold text-amber-600" dir="auto">⚠ القيمة في الملف: <span dir="ltr">{values.birthdateRaw}</span> — لم تُفهم</p>
              )}
              {datePartial && <p className="mt-1 text-[11px] font-bold text-red-500">أكمل اليوم والشهر والسنة أو امسح التاريخ</p>}
            </>)}

          {field('رقم الهاتف',
            <div className="flex items-center gap-2" dir="ltr">
              <span className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm font-extrabold text-slate-500">{PHONE_PREFIX}</span>
              <input id="bulk-edit-phone" className="input-field flex-1" inputMode="numeric" dir="ltr" value={phoneLocal}
                onChange={(e) => setPhoneLocal(e.target.value.replace(/\D/g, '').slice(0, PHONE_LOCAL_LENGTH))}
                placeholder="01xxxxxxxxx" autoComplete="off" />
              {phoneLocal && (
                <button type="button" onClick={() => setPhoneLocal('')} aria-label="مسح الهاتف" className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-400">
                  <Eraser className="h-4 w-4" />
                </button>
              )}
            </div>,
            <>
              {values.phoneRaw && !phoneOk && (
                <p className="mt-1 text-[11px] font-bold text-amber-600">⚠ القيمة في الملف: <span dir="ltr">{values.phoneRaw}</span></p>
              )}
              {!phoneOk && <p className="mt-1 text-[11px] font-bold text-red-500">يجب {PHONE_LOCAL_LENGTH} رقمًا أو امسحه ليُحفظ الصف بدون هاتف</p>}
            </>)}

          {field('العنوان',
            <input id="bulk-edit-address" className="input-field" value={address} onChange={(e) => setAddress(e.target.value)} />)}

          {field('ملاحظات',
            <textarea id="bulk-edit-notes" className="input-field" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />)}

          {showPoints && field('نقاط',
            <input id="bulk-edit-points" type="number" min={0} className="input-field !w-28" value={points} onChange={(e) => setPoints(e.target.value)} />)}
        </div>

        <div className="mt-4 flex gap-2">
          {onRemove && (
            <button type="button" onClick={onRemove} className="flex items-center justify-center gap-1 rounded-xl bg-red-50 px-3 py-2.5 text-xs font-extrabold text-red-600">
              <Trash2 className="h-4 w-4" /> حذف الصف
            </button>
          )}
          <button id="bulk-edit-save" type="button" onClick={save} disabled={!canSave}
            className="btn-primary flex flex-1 items-center justify-center gap-2">
            <Check className="h-5 w-5" /> حفظ التعديل
          </button>
        </div>
      </div>
    </div>
  );
}
