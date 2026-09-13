'use client';

// ---------- Person data modals (البيانات job on the children page) ----------
// ViewPersonModal   — عرض البيانات: full person data + QR + all enrollments
// EditPersonModal   — تعديل البيانات: edits the persons table (identity data)
// DeletePersonModal — حذف الطفل: choose between removing THIS enrollment only
//                     (from class/service/church) or deleting the person
//                     COMPLETELY from the database (cascade via RPC).

import { useEffect, useState } from 'react';
import Image from 'next/image';
import QRCode from 'qrcode';
import {
  X, User, Phone, MapPin, StickyNote, IdCard, CalendarDays, Star,
  CalendarCheck, School, Loader2, Save, Trash2, AlertTriangle, Upload,
  Church as ChurchIcon, Layers, Pencil, Wand2, ScanLine, Check, ShieldAlert,
  UserCheck,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { uploadPhoto } from '@/lib/upload';
import { generatePersonCode } from '@/lib/codes';
import QrScanner from '@/components/store/QrScanner';
import {
  GENDER_LABELS, PHONE_PREFIX, PHONE_LOCAL_LENGTH,
  type Gender, type EnrollmentWithPerson, type Enrollment,
  type Church, type Service, type ClassRoom,
} from '@/lib/types';

// ---------- Shared helpers ----------

const scopeName = (
  id: string,
  list: { id: string; name: string }[],
  fallback: string
) => list.find((x) => x.id === id)?.name ?? fallback;

/** Normalize a raw phone into +2XXXXXXXXXXX or null; undefined = invalid */
const normalizePhone = (raw: string): string | null | undefined => {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  let local = digits;
  if (local.startsWith('20') && local.length === 13) local = local.slice(2);
  else if (local.startsWith('2') && local.length === 12) local = local.slice(1);
  if (local.length === PHONE_LOCAL_LENGTH - 1 && local.startsWith('1')) local = `0${local}`;
  if (local.length !== PHONE_LOCAL_LENGTH) return undefined;
  return `${PHONE_PREFIX}${local}`;
};

export function ModalFrame({
  title, icon, onClose, children,
}: {
  title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md max-h-[90vh] overflow-y-auto no-scrollbar rounded-t-3xl sm:rounded-3xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-extrabold">{icon}{title}</h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// =====================================================================
// 1. VIEW — عرض البيانات
// =====================================================================
export function ViewPersonModal({
  enrollment, churches, services, classes, onClose,
}: {
  enrollment: EnrollmentWithPerson;
  churches: Church[];
  services: Service[];
  classes: ClassRoom[];
  onClose: () => void;
}) {
  const supabase = createClient();
  const person = enrollment.person;
  const [allEnrollments, setAllEnrollments] = useState<Enrollment[] | null>(null);
  const [qrUrl, setQrUrl] = useState<string>('');

  // All enrollments of this person (RLS shows only what the user may see)
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('enrollments')
        .select('*')
        .eq('person_id', person.id);
      setAllEnrollments((data ?? []) as Enrollment[]);
    })();
  }, [supabase, person.id]);

  // QR image of the national id
  useEffect(() => {
    QRCode.toDataURL(person.national_id, { width: 220, margin: 1 })
      .then(setQrUrl)
      .catch(() => setQrUrl(''));
  }, [person.national_id]);

  const rows: { icon: React.ReactNode; label: string; value: string | null }[] = [
    { icon: <IdCard className="h-4 w-4 text-primary-600" />, label: 'الرقم القومي / الكود', value: person.national_id },
    { icon: <User className="h-4 w-4 text-primary-600" />, label: 'النوع', value: person.gender ? GENDER_LABELS[person.gender] : null },
    { icon: <CalendarDays className="h-4 w-4 text-primary-600" />, label: 'تاريخ الميلاد', value: person.birthdate },
    { icon: <Phone className="h-4 w-4 text-primary-600" />, label: 'الهاتف', value: person.phone },
    { icon: <MapPin className="h-4 w-4 text-primary-600" />, label: 'العنوان', value: person.address },
    { icon: <StickyNote className="h-4 w-4 text-primary-600" />, label: 'ملاحظات', value: person.notes },
  ];

  return (
    <ModalFrame title="عرض البيانات" icon={<User className="h-5 w-5 text-primary-600" />} onClose={onClose}>
      {/* Identity header */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-primary-600 to-accent-600 text-white">
          {person.image_url ? (
            <Image src={person.image_url} alt={person.name} fill sizes="64px" className="object-cover" />
          ) : (
            <User className="h-8 w-8" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-extrabold">{person.name}</p>
          <div className="mt-1.5 flex gap-2">
            <span className="badge bg-emerald-100 text-emerald-700">
              <CalendarCheck className="h-3 w-3" /> {enrollment.attendance_count}
            </span>
            <span className="badge bg-gold-100 text-gold-600">
              <Star className="h-3 w-3" /> {enrollment.points}
            </span>
          </div>
        </div>
      </div>

      {/* QR code */}
      {qrUrl && (
        <div className="mb-4 flex justify-center rounded-2xl border border-indigo-50 bg-slate-50 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img id="person-qr" src={qrUrl} alt="QR" className="h-36 w-36" />
        </div>
      )}

      {/* Data rows */}
      <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden mb-4">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3 px-4 py-2.5">
            <span className="rounded-xl bg-slate-50 p-2">{r.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-bold text-slate-400">{r.label}</span>
              <span className="block text-sm font-bold break-words" dir={r.label === 'الهاتف' ? 'ltr' : undefined}>
                {r.value || '—'}
              </span>
            </span>
          </div>
        ))}
      </div>

      {/* Enrollments across the diocese */}
      <p className="mb-2 text-xs font-extrabold text-slate-500">التسجيلات (الكنيسة ← الخدمة ← الفصل)</p>
      {allEnrollments === null ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-primary-500" />
        </div>
      ) : (
        <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
          {allEnrollments.map((en) => (
            <div key={en.id} className={`px-4 py-2.5 ${en.id === enrollment.id ? 'bg-primary-50/50' : ''}`}>
              <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-bold text-slate-700">
                <ChurchIcon className="h-3.5 w-3.5 text-gold-500" />
                {scopeName(en.church_id, churches, 'كنيسة')}
                <span className="text-slate-300">←</span>
                <Layers className="h-3.5 w-3.5 text-accent-600" />
                {scopeName(en.service_id, services, 'خدمة')}
                <span className="text-slate-300">←</span>
                <School className="h-3.5 w-3.5 text-sky-600" />
                {scopeName(en.class_id, classes, 'فصل')}
              </p>
              <div className="mt-1.5 flex gap-2">
                <span className="badge bg-gold-100 text-gold-600">
                  <Star className="h-3 w-3" /> {en.points}
                </span>
                <span className="badge bg-emerald-100 text-emerald-700">
                  <CalendarCheck className="h-3 w-3" /> {en.attendance_count}
                </span>
                {en.id === enrollment.id && (
                  <span className="badge bg-primary-100 text-primary-700">الحالي</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </ModalFrame>
  );
}

// =====================================================================
// 2. EDIT — تعديل البيانات (persons table)
// =====================================================================
export function EditPersonModal({
  enrollment, onSaved, onClose,
}: {
  enrollment: EnrollmentWithPerson;
  onSaved: () => void;
  onClose: () => void;
}) {
  const supabase = createClient();
  const person = enrollment.person;

  const [name, setName] = useState(person.name);
  const [gender, setGender] = useState<Gender | ''>(person.gender ?? '');
  const [birthdate, setBirthdate] = useState(person.birthdate ?? '');
  const [phone, setPhone] = useState(person.phone ?? '');
  const [address, setAddress] = useState(person.address ?? '');
  const [notes, setNotes] = useState(person.notes ?? '');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // ---- Code (national id / QR) — shown disabled, edited only through
  //      a confirmed flow: confirm → modal (generate / scan) → confirm ----
  const [code, setCode] = useState(person.national_id);
  const [codeModal, setCodeModal] = useState(false);
  const codeChanged = code !== person.national_id;

  const startCodeEdit = () => {
    const ok = confirm(
      `⚠️ تعديل الكود (الرقم القومي)\n\nالكود هو هوية «${person.name}» في كل التسجيلات، وهو ما يُطبع على بطاقة الـ QR ويُستخدم للحضور والنقاط ودخول بوابة المخدوم.\n\nتغييره يجعل البطاقة القديمة غير صالحة.\n\nهل تريد المتابعة إلى تعديل الكود؟`
    );
    if (ok) setCodeModal(true);
  };

  const save = async () => {
    if (!name.trim()) return setError('الاسم مطلوب');
    const normPhone = normalizePhone(phone);
    if (normPhone === undefined) return setError(`رقم الهاتف يجب أن يكون ${PHONE_LOCAL_LENGTH} رقمًا (01xxxxxxxxx)`);
    const newCode = code.trim();
    if (!newCode) return setError('الكود (الرقم القومي) مطلوب');

    // Final confirmation before persisting a changed code
    if (codeChanged) {
      const ok = confirm(
        `تأكيد تغيير الكود\n\nمن: ${person.national_id}\nإلى: ${newCode}\n\nسيسري التغيير على «${person.name}» في كل تسجيلاته، وستحتاج البطاقة القديمة إلى إعادة طباعة.\n\nهل أنت متأكد؟`
      );
      if (!ok) return;
    }

    setBusy(true);
    setError('');

    let image_url = person.image_url;
    if (photoFile) {
      try {
        image_url = await uploadPhoto(supabase, 'persons', photoFile);
      } catch {
        setBusy(false);
        return setError('تعذر رفع الصورة');
      }
    }

    const { error: err } = await supabase
      .from('persons')
      .update({
        name: name.trim(),
        gender: gender || null,
        birthdate: birthdate || null,
        phone: normPhone,
        address: address.trim() || null,
        notes: notes.trim() || null,
        image_url,
        ...(codeChanged ? { national_id: newCode } : {}),
      })
      .eq('id', person.id);

    setBusy(false);
    if (err) {
      if (codeChanged && (err.code === '23505' || /duplicate|unique/i.test(err.message ?? ''))) {
        return setError('هذا الكود مستخدم بالفعل لشخص آخر — اختر كودًا مختلفًا');
      }
      return setError('تعذر حفظ التعديلات، حاول مجددًا');
    }
    onSaved();
    onClose();
  };

  return (
    <ModalFrame title="تعديل البيانات" icon={<Save className="h-5 w-5 text-amber-600" />} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">الاسم *</label>
          <input id="edit-person-name" className="input-field" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">النوع</label>
            <select
              id="edit-person-gender"
              className="input-field appearance-none"
              value={gender}
              onChange={(e) => setGender(e.target.value as Gender | '')}
            >
              <option value="">—</option>
              {(Object.keys(GENDER_LABELS) as Gender[]).map((g) => (
                <option key={g} value={g}>{GENDER_LABELS[g]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">تاريخ الميلاد</label>
            <input
              id="edit-person-birthdate"
              type="date"
              className="input-field"
              value={birthdate}
              onChange={(e) => setBirthdate(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">رقم الهاتف</label>
          <input
            id="edit-person-phone"
            className="input-field"
            dir="ltr"
            placeholder="01xxxxxxxxx"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">العنوان</label>
          <input id="edit-person-address" className="input-field" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">ملاحظات</label>
          <textarea id="edit-person-notes" className="input-field" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-primary-300 bg-primary-50/50 px-4 py-3 text-sm font-bold text-primary-600">
          <Upload className="h-4 w-4" />
          {photoFile ? photoFile.name : person.image_url ? 'تغيير الصورة' : 'إضافة صورة (اختياري)'}
          <input type="file" accept="image/*" className="hidden"
            onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} />
        </label>

        {/* Code (national id / QR) — disabled field + confirmed edit button */}
        <div>
          <label className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500">
            <IdCard className="h-3.5 w-3.5 text-primary-500" />
            الكود (الرقم القومي / QR)
          </label>
          <div className="flex gap-2">
            <input
              id="edit-person-code"
              className={`input-field flex-1 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 ${codeChanged ? '!border-amber-300 !bg-amber-50 !text-amber-800' : ''}`}
              dir="ltr"
              value={code}
              disabled
              readOnly
            />
            <button
              id="edit-person-code-edit"
              type="button"
              onClick={startCodeEdit}
              disabled={busy}
              aria-label="تعديل الكود"
              title="تعديل الكود"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow transition hover:bg-amber-600 active:scale-95 disabled:opacity-60"
            >
              <Pencil className="h-5 w-5" />
            </button>
          </div>
          {codeChanged ? (
            <p className="mt-1 flex items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700">
              <span>
                سيتغير الكود من <span dir="ltr">{person.national_id}</span> إلى <span dir="ltr">{code}</span> عند الحفظ
              </span>
              <button
                id="edit-person-code-revert"
                type="button"
                onClick={() => setCode(person.national_id)}
                className="shrink-0 rounded-lg bg-white px-2 py-1 text-amber-700 hover:bg-amber-100"
              >
                تراجع
              </button>
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-slate-400">
              الكود معطّل للحماية — اضغط زر التعديل لتغييره (توليد أو مسح كود)
            </p>
          )}
        </div>

        <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          التعديل يسري على بيانات الشخص في كل تسجيلاته (كل الكنائس والخدمات والفصول)
        </p>

        {error && (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>
        )}

        <button
          id="edit-person-save"
          onClick={save}
          disabled={busy}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
          {busy ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
        </button>
      </div>

      {codeModal && (
        <EditCodeModal
          personId={person.id}
          currentCode={person.national_id}
          initialCode={code}
          onConfirm={(c) => { setCode(c); setCodeModal(false); }}
          onClose={() => setCodeModal(false)}
        />
      )}
    </ModalFrame>
  );
}

// =====================================================================
// 2b. EDIT CODE — تعديل الكود (generate / scan → confirm)
// The chosen code is only staged into the parent form here; it is
// persisted when the user saves the edit form (after a final confirm).
// =====================================================================
function EditCodeModal({
  personId, currentCode, initialCode, onConfirm, onClose,
}: {
  personId: string;
  currentCode: string;
  initialCode: string;
  onConfirm: (code: string) => void;
  onClose: () => void;
}) {
  const supabase = createClient();
  const [value, setValue] = useState(initialCode);
  const [scanning, setScanning] = useState(false);
  const [qrUrl, setQrUrl] = useState('');
  const [checking, setChecking] = useState(false);
  const [takenBy, setTakenBy] = useState<string | null>(null);

  const trimmed = value.trim();
  const changed = trimmed !== currentCode;

  // QR preview of the candidate code
  useEffect(() => {
    if (!trimmed) { setQrUrl(''); return; }
    QRCode.toDataURL(trimmed, { width: 240, margin: 1 })
      .then(setQrUrl)
      .catch(() => setQrUrl(''));
  }, [trimmed]);

  // Is this code already used by ANOTHER person? (debounced lookup)
  useEffect(() => {
    setTakenBy(null);
    if (!trimmed || trimmed === currentCode) return;
    setChecking(true);
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('find_person_by_national_id', { p_national_id: trimmed });
      const found = (Array.isArray(data) ? data[0] : data) as { id: string; name: string } | null | undefined;
      setTakenBy(found && found.id !== personId ? found.name : null);
      setChecking(false);
    }, 400);
    return () => { clearTimeout(t); setChecking(false); };
  }, [trimmed, currentCode, personId, supabase]);

  const onScanned = (v: string) => {
    const s = v.trim();
    if (!s) return;
    setValue(s);
    setScanning(false);
  };

  const confirmCode = () => {
    if (!trimmed || takenBy || checking) return;
    if (!changed) return onClose();
    const ok = confirm(
      `اعتماد الكود الجديد؟\n\nمن: ${currentCode}\nإلى: ${trimmed}\n\nسيتم وضعه في نموذج التعديل، ولن يُحفظ إلا بعد ضغط «حفظ التعديلات».`
    );
    if (ok) onConfirm(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm max-h-[90vh] overflow-y-auto no-scrollbar rounded-3xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-extrabold">
            <IdCard className="h-5 w-5 text-amber-600" />
            تعديل الكود
          </h3>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          الكود الحالي: <span dir="ltr" className="font-extrabold">{currentCode}</span>
        </p>

        {scanning ? (
          <>
            <QrScanner
              onCode={onScanned}
              idPrefix="edit-person-code-scan"
              autoStart
              hint="شغّل الكاميرا لمسح الكود الجديد"
            />
            <button
              type="button"
              onClick={() => setScanning(false)}
              className="btn-secondary mt-3 w-full"
            >
              رجوع
            </button>
          </>
        ) : (
          <div className="space-y-3">
            {/* Candidate code */}
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">الكود الجديد</label>
              <div className="flex gap-2">
                <input
                  id="edit-code-value"
                  className="input-field flex-1"
                  dir="ltr"
                  placeholder="اكتب الرقم القومي أو ولّد / امسح كودًا"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
                <button
                  id="edit-code-generate"
                  type="button"
                  onClick={() => setValue(generatePersonCode())}
                  aria-label="توليد كود تلقائي"
                  title="توليد كود تلقائي"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow transition hover:bg-primary-700 active:scale-95"
                >
                  <Wand2 className="h-5 w-5" />
                </button>
                <button
                  id="edit-code-scan"
                  type="button"
                  onClick={() => setScanning(true)}
                  aria-label="مسح الكود بالكاميرا"
                  title="مسح الكود بالكاميرا"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-white shadow transition hover:bg-orange-600 active:scale-95"
                >
                  <ScanLine className="h-5 w-5" />
                </button>
              </div>
              {checking && (
                <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-slate-400">
                  <Loader2 className="h-3 w-3 animate-spin" /> جارٍ التحقق من الكود...
                </p>
              )}
              {takenBy && (
                <p className="mt-1 flex items-center gap-1 rounded-xl bg-red-50 px-3 py-2 text-[11px] font-bold text-red-600">
                  <UserCheck className="h-4 w-4" />
                  هذا الكود مستخدم بالفعل لـ «{takenBy}» — اختر كودًا مختلفًا
                </p>
              )}
              {!checking && !takenBy && changed && trimmed && (
                <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-emerald-600">
                  <Check className="h-3.5 w-3.5" /> الكود متاح
                </p>
              )}
            </div>

            {/* QR preview */}
            {qrUrl && (
              <div className="flex flex-col items-center rounded-2xl border border-indigo-50 bg-slate-50 py-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrUrl} alt="QR" className="h-32 w-32" />
                <p className="mt-1 text-sm font-extrabold tracking-widest" dir="ltr">{trimmed}</p>
              </div>
            )}

            <button
              id="edit-code-confirm"
              type="button"
              onClick={confirmCode}
              disabled={!trimmed || !!takenBy || checking || !changed}
              className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <Check className="h-5 w-5" />
              تأكيد الكود الجديد
            </button>
            <button type="button" onClick={onClose} className="btn-secondary w-full">
              إلغاء
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// 3. DELETE — حذف الطفل (enrollment only OR full cascade)
// =====================================================================
export function DeletePersonModal({
  enrollment, churches, services, classes, onDeleted, onClose,
}: {
  enrollment: EnrollmentWithPerson;
  churches: Church[];
  services: Service[];
  classes: ClassRoom[];
  onDeleted: () => void;
  onClose: () => void;
}) {
  const supabase = createClient();
  const person = enrollment.person;
  const [busy, setBusy] = useState<'enrollment' | 'full' | null>(null);
  const [error, setError] = useState('');

  const churchName = scopeName(enrollment.church_id, churches, 'الكنيسة');
  const serviceName = scopeName(enrollment.service_id, services, 'الخدمة');
  const className = scopeName(enrollment.class_id, classes, 'الفصل');

  // Option 1: remove THIS enrollment only (class + service + church binding).
  // FK cascade wipes the enrollment's attendance & points logs.
  const deleteEnrollment = async () => {
    const ok = confirm(
      `سيتم حذف «${person.name}» من:\n${className} — ${serviceName} — ${churchName}\n\nمع حذف كل حضوره ونقاطه في هذا التسجيل فقط.\nبياناته الشخصية وتسجيلاته الأخرى تبقى كما هي.\n\nهل أنت متأكد؟`
    );
    if (!ok) return;
    setBusy('enrollment');
    setError('');
    const { error: err } = await supabase.from('enrollments').delete().eq('id', enrollment.id);
    setBusy(null);
    if (err) return setError('تعذر الحذف — تأكد من صلاحياتك ثم حاول مجددًا');
    onDeleted();
    onClose();
  };

  // Option 2: delete the person COMPLETELY — cascade wipes every
  // enrollment and every attendance / points log in all tables.
  const deleteFull = async () => {
    const ok = confirm(
      `⚠️ حذف نهائي!\n\nسيتم حذف «${person.name}» تمامًا من قاعدة البيانات:\n• بياناته الشخصية\n• كل تسجيلاته في كل الكنائس والخدمات والفصول\n• كل سجلات الحضور والنقاط الخاصة به\n\nلا يمكن التراجع عن هذه الخطوة.\n\nهل أنت متأكد؟`
    );
    if (!ok) return;
    setBusy('full');
    setError('');
    const { error: err } = await supabase.rpc('delete_person_cascade', { p_person: person.id });
    setBusy(null);
    if (err) {
      return setError(
        err.message?.includes('no_access')
          ? 'لا تملك صلاحية الحذف النهائي — لهذا الشخص تسجيلات خارج نطاقك'
          : 'تعذر الحذف النهائي — حاول مجددًا'
      );
    }
    onDeleted();
    onClose();
  };

  return (
    <ModalFrame title="حذف الطفل" icon={<Trash2 className="h-5 w-5 text-red-600" />} onClose={onClose}>
      <div className="mb-4 flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
        <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-primary-600 to-accent-600 text-white">
          {person.image_url ? (
            <Image src={person.image_url} alt={person.name} fill sizes="48px" className="object-cover" />
          ) : (
            <User className="h-6 w-6" />
          )}
        </div>
        <div className="min-w-0">
          <p className="font-extrabold truncate">{person.name}</p>
          <p className="text-xs text-slate-400 truncate">
            {className} — {serviceName} — {churchName}
          </p>
        </div>
      </div>

      <p className="mb-3 text-sm font-bold text-slate-600">كيف تريد حذف هذا الطفل؟</p>

      <div className="space-y-3">
        {/* Option 1: enrollment only */}
        <button
          id="delete-enrollment-btn"
          onClick={deleteEnrollment}
          disabled={busy !== null}
          className="w-full rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 text-right transition hover:bg-amber-100 active:scale-[0.98] disabled:opacity-60"
        >
          <span className="flex items-center gap-2 font-extrabold text-amber-700">
            {busy === 'enrollment' ? <Loader2 className="h-5 w-5 animate-spin" /> : <School className="h-5 w-5" />}
            حذف من الفصل والخدمة والكنيسة
          </span>
          <span className="mt-1 block text-xs font-bold text-amber-600/80">
            يُحذف هذا التسجيل فقط مع حضوره ونقاطه — البيانات الشخصية والتسجيلات الأخرى تبقى محفوظة
          </span>
        </button>

        {/* Option 2: full cascade */}
        <button
          id="delete-person-full-btn"
          onClick={deleteFull}
          disabled={busy !== null}
          className="w-full rounded-2xl border-2 border-red-200 bg-red-50 p-4 text-right transition hover:bg-red-100 active:scale-[0.98] disabled:opacity-60"
        >
          <span className="flex items-center gap-2 font-extrabold text-red-700">
            {busy === 'full' ? <Loader2 className="h-5 w-5 animate-spin" /> : <AlertTriangle className="h-5 w-5" />}
            حذف الطفل تمامًا من قاعدة البيانات
          </span>
          <span className="mt-1 block text-xs font-bold text-red-600/80">
            حذف نهائي متسلسل (Cascade): البيانات الشخصية + كل التسجيلات + كل سجلات الحضور والنقاط في جميع الجداول
          </span>
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>
      )}

      <button
        onClick={onClose}
        disabled={busy !== null}
        className="btn-secondary mt-4 w-full"
      >
        إلغاء
      </button>
    </ModalFrame>
  );
}
