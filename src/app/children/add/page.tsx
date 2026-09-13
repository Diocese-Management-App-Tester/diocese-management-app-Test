'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import {
  UserPlus, Users, X, Check, Loader2, QrCode, Camera, Wand2, ScanLine,
  ArrowRight, FileSpreadsheet, ClipboardPaste, Upload, Trash2, Star, IdCard, UserCheck,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import PhotoCropModal from '@/components/PhotoCropModal';
import QrScanner from '@/components/store/QrScanner';
import { generatePersonCode } from '@/lib/codes';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { uploadPhoto } from '@/lib/upload';
import {
  PHONE_PREFIX, PHONE_LOCAL_LENGTH, GENDER_LABELS,
  type Gender, type Church, type Service, type ClassRoom,
  type Person, type AddPersonResult,
} from '@/lib/types';

// ---------- Helpers ----------

const MONTHS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

/** Random readable national id (used when the person has no real one), e.g. P-4F7K9Q2M */
const generateCode = generatePersonCode;

/** Compose YYYY-MM-DD from separate day/month/year, or null */
const composeBirthdate = (d: string, m: string, y: string): string | null => {
  if (!d || !m || !y) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/** Normalize a raw phone into +2XXXXXXXXXXX (11 local digits) or null; returns undefined when invalid */
const normalizePhone = (raw: string): string | null | undefined => {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  let local = digits;
  if (local.startsWith('20') && local.length === 13) local = local.slice(2);
  else if (local.startsWith('2') && local.length === 12) local = local.slice(1);
  // Excel often strips the leading 0 from Egyptian mobiles (01xxxxxxxxx →
  // 1xxxxxxxxx). If we got 10 digits starting with 1, restore the 0.
  if (local.length === PHONE_LOCAL_LENGTH - 1 && local.startsWith('1')) local = `0${local}`;
  if (local.length !== PHONE_LOCAL_LENGTH) return undefined;
  return `${PHONE_PREFIX}${local}`;
};

// ---------- Page ----------

type Tab = 'single' | 'bulk';

export default function AddChildPage() {
  const { profile } = useAuth();
  const supabase = createClient();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>('single');
  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile?.status !== 'approved') return;
    (async () => {
      const [{ data: chs }, { data: svs }, { data: cls }] = await Promise.all([
        supabase.from('churches').select('*').order('name'),
        supabase.from('services').select('*').order('name'),
        supabase.from('classes').select('*').order('name'),
      ]);
      setChurches(chs ?? []);
      setServices(svs ?? []);
      setClasses(cls ?? []);
      setLoading(false);
    })();
  }, [profile, supabase]);

  return (
    <AppShell>
      <section className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <UserPlus className="h-5 w-5 text-primary-600" />
          إضافة مخدومين
        </h2>
        <button
          id="back-to-children"
          onClick={() => router.push('/children')}
          className="btn-secondary !py-2 !px-3 flex items-center gap-1 text-sm"
        >
          <ArrowRight className="h-4 w-4" />
          المخدومين
        </button>
      </section>

      {/* ---------- Tabs ---------- */}
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-indigo-50 p-1">
        <button
          id="tab-single"
          onClick={() => setTab('single')}
          aria-pressed={tab === 'single'}
          className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-extrabold transition ${
            tab === 'single' ? 'bg-white text-primary-700 shadow' : 'text-slate-500'
          }`}
        >
          <UserPlus className="h-4 w-4" />
          إضافة فردية
        </button>
        <button
          id="tab-bulk"
          onClick={() => setTab('bulk')}
          aria-pressed={tab === 'bulk'}
          className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-extrabold transition ${
            tab === 'bulk' ? 'bg-white text-primary-700 shadow' : 'text-slate-500'
          }`}
        >
          <Users className="h-4 w-4" />
          إضافة جماعية
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
        </div>
      ) : tab === 'single' ? (
        <SingleAddTab churches={churches} services={services} classes={classes} />
      ) : (
        <BulkAddTab churches={churches} services={services} classes={classes} />
      )}
    </AppShell>
  );
}

// ---------- Shared: church → service → class cascading selectors ----------

function useScope(churches: Church[], services: Service[], classes: ClassRoom[]) {
  const { profile } = useAuth();
  const [churchId, setChurchId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [classId, setClassId] = useState('');

  // Default from profile scope once data arrives
  useEffect(() => {
    if (!profile) return;
    if (profile.church_id && churches.some((c) => c.id === profile.church_id)) setChurchId(profile.church_id);
    else if (churches.length === 1) setChurchId(churches[0].id);
    if (profile.service_id && services.some((s) => s.id === profile.service_id)) setServiceId(profile.service_id);
    if (profile.class_id && classes.some((c) => c.id === profile.class_id)) setClassId(profile.class_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, churches.length, services.length, classes.length]);

  const visibleServices = useMemo(
    () => services.filter((s) => !churchId || s.church_id === churchId),
    [services, churchId]
  );
  const visibleClasses = useMemo(
    () =>
      classes.filter(
        (c) => (!churchId || c.church_id === churchId) && (!serviceId || c.service_id === serviceId)
      ),
    [classes, churchId, serviceId]
  );

  // Auto-select single options
  useEffect(() => {
    if (!serviceId && visibleServices.length === 1) setServiceId(visibleServices[0].id);
  }, [visibleServices, serviceId]);
  useEffect(() => {
    if (!classId && visibleClasses.length === 1) setClassId(visibleClasses[0].id);
  }, [visibleClasses, classId]);

  const onChurch = (v: string) => { setChurchId(v); setServiceId(''); setClassId(''); };
  const onService = (v: string) => { setServiceId(v); setClassId(''); };

  const selectedClass = classes.find((c) => c.id === classId) ?? null;

  return { churchId, serviceId, classId, visibleServices, visibleClasses, onChurch, onService, setClassId, selectedClass };
}

function ScopeSelectors({
  scope, churches, idPrefix,
}: {
  scope: ReturnType<typeof useScope>; churches: Church[]; idPrefix: string;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-500">الكنيسة *</label>
        <select
          id={`${idPrefix}-church`}
          className="input-field"
          value={scope.churchId}
          onChange={(e) => scope.onChurch(e.target.value)}
          required
        >
          <option value="">اختر الكنيسة</option>
          {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-500">الخدمة *</label>
        <select
          id={`${idPrefix}-service`}
          className="input-field"
          value={scope.serviceId}
          onChange={(e) => scope.onService(e.target.value)}
          disabled={!scope.churchId}
          required
        >
          <option value="">اختر الخدمة</option>
          {scope.visibleServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-500">الفصل *</label>
        <select
          id={`${idPrefix}-class`}
          className="input-field"
          value={scope.classId}
          onChange={(e) => scope.setClassId(e.target.value)}
          disabled={!scope.serviceId}
          required
        >
          <option value="">اختر الفصل</option>
          {scope.visibleClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
    </div>
  );
}

// =====================================================================
// TAB 1 — Single add
// =====================================================================

function SingleAddTab({
  churches, services, classes,
}: {
  churches: Church[]; services: Service[]; classes: ClassRoom[];
}) {
  const supabase = createClient();
  const scope = useScope(churches, services, classes);

  // ---- National ID (the QR code) + QR square ----
  const [code, setCode] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [showQr, setShowQr] = useState(false);

  // Existing person found for the typed national id (cross-scope lookup)
  const [existingPerson, setExistingPerson] = useState<Person | null>(null);
  const [checkingId, setCheckingId] = useState(false);

  useEffect(() => {
    if (!code.trim()) { setQrDataUrl(''); return; }
    QRCode.toDataURL(code.trim(), { width: 320, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [code]);

  // Look up the person by national id (debounced) — one person may be
  // in many churches/services/classes, so we reuse his identity row.
  useEffect(() => {
    const nid = code.trim();
    setExistingPerson(null);
    if (!nid) return;
    setCheckingId(true);
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('find_person_by_national_id', { p_national_id: nid });
      const person = Array.isArray(data) ? (data[0] as Person | undefined) : (data as Person | null);
      setExistingPerson(person ?? null);
      setCheckingId(false);
    }, 450);
    return () => { clearTimeout(t); setCheckingId(false); };
  }, [code, supabase]);

  // Autofill the form from the existing person
  const fillFromPerson = (p: Person) => {
    setName(p.name);
    setGender(p.gender ?? '');
    setPhoneLocal(p.phone ? p.phone.replace(/^\+2/, '') : '');
    if (p.birthdate) {
      const [y, m, d] = p.birthdate.split('-');
      setBYear(String(Number(y))); setBMonth(String(Number(m))); setBDay(String(Number(d)));
    }
    setAddress(p.address ?? '');
    setNotes(p.notes ?? '');
  };

  const generateAndShow = () => {
    const c = code.trim() || generateCode();
    setCode(c);
    setShowQr(true);
  };

  // ---- Scan an existing code (national id / printed QR card) with the camera ----
  const [showScan, setShowScan] = useState(false);
  const onScanned = (value: string) => {
    const v = value.trim();
    if (!v) return;
    setCode(v);
    setShowScan(false);
  };

  // ---- Photo square ----
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rawImage, setRawImage] = useState('');        // object URL for cropper
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setRawImage(URL.createObjectURL(file));
  };

  const onCropped = (blob: Blob) => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoBlob(blob);
    setPhotoPreview(URL.createObjectURL(blob));
    URL.revokeObjectURL(rawImage);
    setRawImage('');
  };

  // ---- Form fields ----
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [phoneLocal, setPhoneLocal] = useState('');   // 11 digits after +2
  const [bDay, setBDay] = useState('');
  const [bMonth, setBMonth] = useState('');
  const [bYear, setBYear] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [startPoints, setStartPoints] = useState('0');

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedName, setSavedName] = useState('');

  const currentYear = new Date().getFullYear();
  const years = useMemo(
    () => Array.from({ length: 40 }, (_, i) => currentYear - i),
    [currentYear]
  );
  const daysInMonth = useMemo(() => {
    if (!bMonth) return 31;
    const y = Number(bYear) || 2000;
    return new Date(y, Number(bMonth), 0).getDate();
  }, [bMonth, bYear]);

  // Clamp day if month/year change shrinks it
  useEffect(() => {
    if (bDay && Number(bDay) > daysInMonth) setBDay(String(daysInMonth));
  }, [daysInMonth, bDay]);

  const phoneValid = phoneLocal === '' || phoneLocal.length === PHONE_LOCAL_LENGTH;

  const resetForm = () => {
    setCode(''); setShowQr(false);
    setExistingPerson(null);
    setPhotoBlob(null);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview('');
    setName(''); setGender(''); setPhoneLocal('');
    setBDay(''); setBMonth(''); setBYear('');
    setAddress(''); setNotes(''); setStartPoints('0');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSavedName('');

    const cls = scope.selectedClass;
    if (!cls) { setError('اختر الكنيسة والخدمة والفصل'); return; }
    if (!name.trim()) { setError('اكتب اسم المخدوم'); return; }
    if (phoneLocal && phoneLocal.length !== PHONE_LOCAL_LENGTH) {
      setError(`رقم الهاتف يجب أن يكون ${PHONE_LOCAL_LENGTH} رقمًا بعد ${PHONE_PREFIX}`);
      return;
    }

    setSaving(true);
    try {
      // Upload photo first (if any)
      let photoUrl: string | null = null;
      if (photoBlob) {
        photoUrl = await uploadPhoto(supabase, 'persons', photoBlob, 'person.webp');
      }

      const points = Math.max(0, Math.floor(Number(startPoints) || 0));

      // Person-centric flow: the person data goes to the persons table
      // (upsert by national id), then he is registered as an enrollment
      // in this church + service + class — all in one RPC.
      const { data, error: err } = await supabase.rpc('add_person_and_enroll', {
        p_church: cls.church_id,
        p_service: cls.service_id,
        p_class: cls.id,
        p_name: name.trim(),
        p_national_id: code.trim() || null,
        p_gender: gender || null,
        p_birthdate: composeBirthdate(bDay, bMonth, bYear),
        p_phone: phoneLocal ? `${PHONE_PREFIX}${phoneLocal}` : null,
        p_address: address.trim() || null,
        p_notes: notes.trim() || null,
        p_image_url: photoUrl,
        p_points: points,
      });

      if (err) {
        setError('تعذر الحفظ، تأكد من الصلاحيات وحاول مجددًا');
        setSaving(false);
        return;
      }
      const result = data as AddPersonResult;
      if (result?.already_enrolled) {
        setError(`"${name.trim()}" مسجّل بالفعل في هذا الفصل`);
        setSaving(false);
        return;
      }
      setSavedName(
        result?.person_created
          ? name.trim()
          : `${name.trim()} (شخص موجود — تم تسجيله في الفصل)`
      );
      resetForm();
      setSaving(false);
    } catch {
      setError('حدث خطأ أثناء رفع الصورة أو الحفظ');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 pb-6">
      {/* ---------- Upper part: two squares (QR / Photo) ---------- */}
      <div className="grid grid-cols-2 gap-3">
        {/* QR square */}
        <button
          id="qr-square"
          type="button"
          onClick={generateAndShow}
          className="card flex aspect-square flex-col items-center justify-center gap-2 !p-3 transition active:scale-95"
        >
          {qrDataUrl && code ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrDataUrl} alt="QR" className="h-full w-full rounded-xl object-contain" />
          ) : (
            <>
              <QrCode className="h-10 w-10 text-primary-500" />
              <span className="text-xs font-extrabold text-slate-500">توليد الكود و QR</span>
            </>
          )}
        </button>

        {/* Photo square */}
        <button
          id="photo-square"
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="card flex aspect-square flex-col items-center justify-center gap-2 !p-3 overflow-hidden transition active:scale-95"
        >
          {photoPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoPreview} alt="صورة المخدوم" className="h-full w-full rounded-xl object-cover" />
          ) : (
            <>
              <Camera className="h-10 w-10 text-primary-500" />
              <span className="text-xs font-extrabold text-slate-500">صورة المخدوم</span>
            </>
          )}
        </button>
        <input
          ref={fileInputRef}
          id="photo-input"
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={onPickFile}
        />
      </div>

      {photoPreview && (
        <button
          id="photo-remove"
          type="button"
          onClick={() => {
            setPhotoBlob(null);
            URL.revokeObjectURL(photoPreview);
            setPhotoPreview('');
          }}
          className="flex items-center gap-1 text-xs font-bold text-red-500"
        >
          <Trash2 className="h-3.5 w-3.5" /> إزالة الصورة
        </button>
      )}

      {/* ---------- Scope ---------- */}
      <div className="card space-y-3">
        <ScopeSelectors scope={scope} churches={churches} idPrefix="single" />

        {/* National ID (the QR code) */}
        <div>
          <label className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500">
            <IdCard className="h-3.5 w-3.5 text-primary-500" />
            الرقم القومي (كود الـ QR)
          </label>
          <div className="flex gap-2">
            <input
              id="single-code"
              className="input-field flex-1"
              dir="ltr"
              placeholder="اكتب الرقم القومي أو ولّد كودًا مؤقتًا"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button
              id="single-code-generate"
              type="button"
              onClick={() => setCode(generateCode())}
              aria-label="توليد كود تلقائي"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow transition hover:bg-primary-700 active:scale-95"
            >
              <Wand2 className="h-5 w-5" />
            </button>
            <button
              id="single-code-scan"
              type="button"
              onClick={() => setShowScan(true)}
              aria-label="مسح الكود بالكاميرا"
              title="مسح الكود بالكاميرا"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-white shadow transition hover:bg-orange-600 active:scale-95"
            >
              <ScanLine className="h-5 w-5" />
            </button>
          </div>
          {checkingId && (
            <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-slate-400">
              <Loader2 className="h-3 w-3 animate-spin" /> جارٍ التحقق من الرقم...
            </p>
          )}
          {existingPerson && (
            <div className="mt-2 rounded-xl bg-emerald-50 px-3 py-2">
              <p className="flex items-center gap-1 text-xs font-extrabold text-emerald-700">
                <UserCheck className="h-4 w-4" />
                شخص مسجّل بالفعل: {existingPerson.name}
              </p>
              <p className="mt-0.5 text-[11px] font-bold text-emerald-600">
                سيتم ربط نفس الشخص بهذا الفصل دون تكرار بياناته
              </p>
              <button
                type="button"
                onClick={() => fillFromPerson(existingPerson)}
                className="mt-1.5 rounded-lg bg-emerald-600 px-3 py-1 text-[11px] font-extrabold text-white transition active:scale-95"
              >
                تعبئة بياناته في النموذج
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ---------- Personal data ---------- */}
      <div className="card space-y-3">
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">الاسم *</label>
          <input
            id="single-name"
            className="input-field"
            placeholder="اسم المخدوم"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        {/* Gender */}
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">النوع</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              id="gender-male"
              type="button"
              aria-pressed={gender === 'male'}
              onClick={() => setGender(gender === 'male' ? '' : 'male')}
              className={`rounded-xl py-2.5 text-sm font-extrabold transition active:scale-95 ${
                gender === 'male'
                  ? 'bg-primary-600 text-white shadow ring-2 ring-primary-300'
                  : 'bg-primary-50 text-primary-600'
              }`}
            >
              {GENDER_LABELS.male} 👦
            </button>
            <button
              id="gender-female"
              type="button"
              aria-pressed={gender === 'female'}
              onClick={() => setGender(gender === 'female' ? '' : 'female')}
              className={`rounded-xl py-2.5 text-sm font-extrabold transition active:scale-95 ${
                gender === 'female'
                  ? 'bg-pink-500 text-white shadow ring-2 ring-pink-300'
                  : 'bg-pink-50 text-pink-500'
              }`}
            >
              {GENDER_LABELS.female} 👧
            </button>
          </div>
        </div>

        {/* Phone with fixed +2 prefix */}
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">رقم الهاتف</label>
          <div className="flex items-stretch overflow-hidden rounded-xl border border-indigo-100 bg-white focus-within:ring-2 focus-within:ring-primary-300" dir="ltr">
            <span className="flex items-center bg-indigo-50 px-3 text-sm font-extrabold text-primary-700">
              {PHONE_PREFIX}
            </span>
            <input
              id="single-phone"
              type="tel"
              inputMode="numeric"
              className="w-full px-3 py-2.5 text-sm font-bold outline-none"
              placeholder="01xxxxxxxxx"
              value={phoneLocal}
              maxLength={PHONE_LOCAL_LENGTH}
              onChange={(e) => setPhoneLocal(e.target.value.replace(/\D/g, '').slice(0, PHONE_LOCAL_LENGTH))}
            />
          </div>
          {!phoneValid && (
            <p className="mt-1 text-[11px] font-bold text-red-500">
              الرقم يجب أن يكون {PHONE_LOCAL_LENGTH} رقمًا ({phoneLocal.length}/{PHONE_LOCAL_LENGTH})
            </p>
          )}
          {phoneLocal.length === PHONE_LOCAL_LENGTH && (
            <p className="mt-1 text-[11px] font-bold text-emerald-600" dir="ltr">
              ✓ {PHONE_PREFIX}{phoneLocal}
            </p>
          )}
        </div>

        {/* Birthdate: day / month / year pickers */}
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">تاريخ الميلاد</label>
          <div className="grid grid-cols-3 gap-2">
            <select
              id="birth-day"
              aria-label="اليوم"
              className="input-field !px-2 text-center"
              value={bDay}
              onChange={(e) => setBDay(e.target.value)}
            >
              <option value="">اليوم</option>
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <select
              id="birth-month"
              aria-label="الشهر"
              className="input-field !px-2 text-center"
              value={bMonth}
              onChange={(e) => setBMonth(e.target.value)}
            >
              <option value="">الشهر</option>
              {MONTHS_AR.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
            <select
              id="birth-year"
              aria-label="السنة"
              className="input-field !px-2 text-center"
              value={bYear}
              onChange={(e) => setBYear(e.target.value)}
            >
              <option value="">السنة</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">العنوان</label>
          <input
            id="single-address"
            className="input-field"
            placeholder="العنوان"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold text-slate-500">ملاحظات</label>
          <textarea
            id="single-notes"
            className="input-field"
            rows={2}
            placeholder="ملاحظات"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500">
            <Star className="h-3.5 w-3.5 text-gold-500" /> نقاط البداية
          </label>
          <input
            id="single-start-points"
            type="number"
            min={0}
            className="input-field"
            value={startPoints}
            onChange={(e) => setStartPoints(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>
      )}
      {savedName && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">
          ✓ تم حفظ &quot;{savedName}&quot; بنجاح — يمكنك إضافة مخدوم آخر
        </p>
      )}

      <button
        id="single-save"
        type="submit"
        disabled={saving || !phoneValid}
        className="btn-primary w-full flex items-center justify-center gap-2"
      >
        {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
        حفظ المخدوم
      </button>

      {/* QR fullscreen modal */}
      {showQr && qrDataUrl && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6" onClick={() => setShowQr(false)}>
          <div className="w-full max-w-xs rounded-3xl bg-white p-5 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-extrabold">الرقم القومي — كود الـ QR</h3>
              <button type="button" onClick={() => setShowQr(false)} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt="QR" className="mx-auto w-full rounded-xl" />
            <p className="mt-2 text-lg font-extrabold tracking-widest" dir="ltr">{code}</p>
          </div>
        </div>
      )}

      {/* Scan-code modal (camera / gallery) */}
      {showScan && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6" onClick={() => setShowScan(false)}>
          <div className="w-full max-w-xs rounded-3xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-base font-extrabold">
                <ScanLine className="h-5 w-5 text-orange-500" />
                مسح الكود بالكاميرا
              </h3>
              <button type="button" onClick={() => setShowScan(false)} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <QrScanner onCode={onScanned} idPrefix="add-person-scan" autoStart hint="شغّل الكاميرا لمسح كود المخدوم" />
            <p className="mt-3 text-center text-[11px] font-bold text-slate-400">
              سيتم وضع الكود الممسوح في خانة الرقم القومي مباشرة
            </p>
          </div>
        </div>
      )}

      {/* Crop modal */}
      {rawImage && (
        <PhotoCropModal
          src={rawImage}
          onDone={onCropped}
          onClose={() => { URL.revokeObjectURL(rawImage); setRawImage(''); }}
        />
      )}
    </form>
  );
}

// =====================================================================
// TAB 2 — Bulk add (Excel import or pasted data + column mapping)
// =====================================================================

type BulkField =
  | 'name' | 'gender' | 'phone'
  | 'birthdate' | 'birth_day' | 'birth_month' | 'birth_year'
  | 'address' | 'notes' | 'points' | 'code' | 'skip';

const BULK_FIELDS: { value: BulkField; label: string }[] = [
  { value: 'skip', label: '— تجاهل —' },
  { value: 'name', label: 'الاسم' },
  { value: 'gender', label: 'النوع' },
  { value: 'phone', label: 'رقم الهاتف' },
  { value: 'birthdate', label: 'تاريخ الميلاد (كامل)' },
  { value: 'birth_day', label: 'يوم الميلاد' },
  { value: 'birth_month', label: 'شهر الميلاد' },
  { value: 'birth_year', label: 'سنة الميلاد' },
  { value: 'address', label: 'العنوان' },
  { value: 'notes', label: 'ملاحظات' },
  { value: 'points', label: 'نقاط' },
  { value: 'code', label: 'الرقم القومي' },
];

/** Guess mapping from a header cell text */
const guessField = (header: string): BulkField => {
  const h = header.trim().toLowerCase();
  if (/اسم|name/.test(h)) return 'name';
  if (/نوع|جنس|gender|sex/.test(h)) return 'gender';
  if (/هاتف|موبايل|تليفون|phone|mobile|tel/.test(h)) return 'phone';
  if (/يوم|day/.test(h)) return 'birth_day';
  if (/شهر|month/.test(h)) return 'birth_month';
  if (/سنة|عام|year/.test(h)) return 'birth_year';
  if (/ميلاد|تاريخ|birth|date|dob/.test(h)) return 'birthdate';
  if (/عنوان|address/.test(h)) return 'address';
  if (/ملاحظ|note/.test(h)) return 'notes';
  if (/نقاط|point/.test(h)) return 'points';
  if (/قومي|كود|national|code|qr/.test(h)) return 'code';
  return 'skip';
};

// ---------- Date parsing ----------

type DateOrder = 'dmy' | 'mdy' | 'auto';

const MONTH_NAMES: Record<string, number> = {
  // English
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  // Arabic (standard)
  'يناير': 1, 'فبراير': 2, 'مارس': 3, 'أبريل': 4, 'ابريل': 4, 'مايو': 5, 'يونيو': 6, 'يونيه': 6,
  'يوليو': 7, 'يوليه': 7, 'أغسطس': 8, 'اغسطس': 8, 'سبتمبر': 9, 'أكتوبر': 10, 'اكتوبر': 10,
  'نوفمبر': 11, 'ديسمبر': 12,
  // Arabic (levant)
  'كانون الثاني': 1, 'شباط': 2, 'آذار': 3, 'اذار': 3, 'نيسان': 4, 'أيار': 5, 'ايار': 5,
  'حزيران': 6, 'تموز': 7, 'آب': 8, 'اب': 8, 'أيلول': 9, 'ايلول': 9,
  'تشرين الأول': 10, 'تشرين الاول': 10, 'تشرين الثاني': 11, 'كانون الأول': 12, 'كانون الاول': 12,
};

/** Arabic-indic digits → latin */
const toLatinDigits = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
   .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

/** Parse a month cell: number, or Arabic/English month name */
const parseMonth = (v: string): number | null => {
  const s = toLatinDigits(String(v ?? '').trim().toLowerCase());
  if (!s) return null;
  const n = Number(s);
  if (Number.isInteger(n) && n >= 1 && n <= 12) return n;
  if (MONTH_NAMES[s] != null) return MONTH_NAMES[s];
  // partial match (e.g. "شهر يناير")
  for (const [name, num] of Object.entries(MONTH_NAMES)) {
    if (s.includes(name)) return num;
  }
  return null;
};

const validDate = (y: number, m: number, d: number): string | null => {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  if (d > new Date(y, m, 0).getDate()) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/** Parse a full-date cell with an explicit day/month order preference */
const parseFullDate = (raw: string, order: DateOrder): string | null => {
  const s = toLatinDigits(String(raw ?? '').trim());
  if (!s) return null;

  // Excel serial number
  const asNum = Number(s);
  if (Number.isFinite(asNum) && asNum > 20000 && asNum < 60000 && /^\d+(\.\d+)?$/.test(s)) {
    const d = new Date(Math.round((asNum - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }

  // ISO yyyy-mm-dd (unambiguous)
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return validDate(+m[1], +m[2], +m[3]);

  // a/b/yyyy — order decided by the user
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const a = +m[1], b = +m[2];
    let y = +m[3];
    if (y < 100) y += y > 30 ? 1900 : 2000;
    if (order === 'mdy') return validDate(y, a, b);
    if (order === 'dmy') return validDate(y, b, a);
    // auto: self-resolve when one side can't be a month
    if (a > 12) return validDate(y, b, a);      // a is the day → dmy
    if (b > 12) return validDate(y, a, b);      // b is the day → mdy
    return validDate(y, b, a);                  // ambiguous → assume dd/mm
  }

  // "12 يناير 2015" style
  m = s.match(/^(\d{1,2})\s+(\S+)\s+(\d{4})/);
  if (m) {
    const mo = parseMonth(m[2]);
    if (mo) return validDate(+m[3], mo, +m[1]);
  }
  return null;
};

const parseGender = (v: unknown): Gender | null => {
  const s = String(v ?? '').trim().toLowerCase();
  if (/^(ولد|ذكر|boy|male|m|بنين)$/.test(s)) return 'male';
  if (/^(بنت|أنثى|انثى|girl|female|f|بنات)$/.test(s)) return 'female';
  return null;
};

interface BulkRow {
  key: number;
  cells: string[];
  genderOverride?: Gender | null;   // per-row manual gender (wins over everything)
  status: 'pending' | 'ok' | 'error';
  message?: string;
}

function BulkAddTab({
  churches, services, classes,
}: {
  churches: Church[]; services: Service[]; classes: ClassRoom[];
}) {
  const supabase = createClient();
  const scope = useScope(churches, services, classes);

  const [rows, setRows] = useState<BulkRow[]>([]);
  const [mapping, setMapping] = useState<BulkField[]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<{ ok: number; fail: number } | null>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);

  // ---- Import options ----
  const [defaultGender, setDefaultGender] = useState<Gender | ''>('');   // all boys / all girls
  const [autoCodes, setAutoCodes] = useState(false);                     // generate codes
  const [dateOrder, setDateOrder] = useState<DateOrder>('auto');         // dd/mm vs mm/dd
  const [defaultPoints, setDefaultPoints] = useState('0');               // points for every child

  const colCount = rows.length ? Math.max(...rows.map((r) => r.cells.length)) : 0;

  const applyData = useCallback((matrix: string[][]) => {
    const clean = matrix
      .map((r) => r.map((c) => String(c ?? '').trim()))
      .filter((r) => r.some((c) => c !== ''));
    if (!clean.length) { setError('لا توجد بيانات'); return; }
    setError('');
    setDone(null);
    setRows(clean.map((cells, i) => ({ key: i, cells, status: 'pending' })));
    const cols = Math.max(...clean.map((r) => r.length));
    const guessed: BulkField[] = Array.from({ length: cols }, (_, i) => guessField(clean[0][i] ?? ''));
    if (!guessed.includes('name') && cols > 0) guessed[0] = 'name';
    setMapping(guessed);
  }, []);

  // ---- Excel import ----
  const onExcelFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' })
        .map((r) => (r as unknown[]).map((c) => String(c ?? '')));
      applyData(matrix);
    } catch {
      setError('تعذر قراءة ملف الإكسل');
    }
  };

  // ---- Paste import ----
  const applyPaste = () => {
    const lines = pasteText.split(/\r?\n/).filter((l) => l.trim());
    const matrix = lines.map((l) => (l.includes('\t') ? l.split('\t') : l.split(/[,;]/)));
    applyData(matrix);
    setPasteOpen(false);
    setPasteText('');
  };

  const setColMapping = (i: number, f: BulkField) =>
    setMapping((m) => {
      const next = [...m];
      if (f !== 'skip') {
        for (let j = 0; j < next.length; j++) if (next[j] === f) next[j] = 'skip';
      }
      next[i] = f;
      return next;
    });

  const dataRows = useMemo(() => (hasHeader ? rows.slice(1) : rows), [rows, hasHeader]);

  const col = useCallback((f: BulkField) => mapping.indexOf(f), [mapping]);
  const cellOf = useCallback(
    (row: BulkRow, f: BulkField) => {
      const idx = col(f);
      return idx === -1 ? '' : (row.cells[idx] ?? '').trim();
    },
    [col]
  );

  const hasGenderData = col('gender') !== -1;
  const hasCodeCol = col('code') !== -1;
  const hasFullDate = col('birthdate') !== -1;
  const hasSplitDate = col('birth_day') !== -1 || col('birth_month') !== -1 || col('birth_year') !== -1;
  const hasPointsCol = col('points') !== -1;

  // ---------- Resolve each row into final values (live preview) ----------
  interface Resolved {
    row: BulkRow;
    name: string;
    gender: Gender | null;
    code: string;
    birthdate: string | null;
    birthdateRaw: string;
    phone: string | null | undefined;   // undefined = invalid
    points: number;
    address: string;
    notes: string;
  }

  const resolved: Resolved[] = useMemo(() => {
    const fallbackPoints = Math.max(0, Math.floor(Number(defaultPoints) || 0));
    return dataRows.map((row) => {
      // gender: per-row override > cell value > global default
      let gender: Gender | null = null;
      if (row.genderOverride !== undefined) gender = row.genderOverride;
      else {
        gender = hasGenderData ? parseGender(cellOf(row, 'gender')) : null;
        if (!gender && defaultGender) gender = defaultGender;
      }

      // code: cell value; else auto-generated when enabled
      let code = cellOf(row, 'code');
      if (!code && autoCodes) code = 'AUTO';   // placeholder — real code generated at import

      // birthdate
      let birthdate: string | null = null;
      let birthdateRaw = '';
      if (hasFullDate) {
        birthdateRaw = cellOf(row, 'birthdate');
        birthdate = parseFullDate(birthdateRaw, dateOrder);
      } else if (hasSplitDate) {
        const dRaw = toLatinDigits(cellOf(row, 'birth_day'));
        const mRaw = cellOf(row, 'birth_month');
        const yRaw = toLatinDigits(cellOf(row, 'birth_year'));
        birthdateRaw = [dRaw, mRaw, yRaw].filter(Boolean).join(' / ');
        const d = Number(dRaw), mo = parseMonth(mRaw);
        let y = Number(yRaw);
        if (y > 0 && y < 100) y += y > 30 ? 1900 : 2000;
        if (d && mo && y) birthdate = validDate(y, mo, d);
      }

      const rowPoints = hasPointsCol ? cellOf(row, 'points') : '';
      const points = rowPoints !== '' && !Number.isNaN(Number(rowPoints))
        ? Math.max(0, Math.floor(Number(rowPoints)))
        : fallbackPoints;

      return {
        row,
        name: cellOf(row, 'name'),
        gender,
        code,
        birthdate,
        birthdateRaw,
        phone: normalizePhone(cellOf(row, 'phone')),
        points,
        address: cellOf(row, 'address'),
        notes: cellOf(row, 'notes'),
      };
    });
  }, [dataRows, cellOf, hasGenderData, defaultGender, autoCodes, hasFullDate, hasSplitDate, dateOrder, hasPointsCol, defaultPoints]);

  // Cycle a row's gender: null → boy → girl → null
  const cycleGender = (key: number) =>
    setRows((rs) =>
      rs.map((r) => {
        if (r.key !== key) return r;
        const current =
          r.genderOverride !== undefined
            ? r.genderOverride
            : (hasGenderData ? parseGender(cellOf(r, 'gender')) : null) || (defaultGender || null);
        const next: Gender | null = current === null ? 'male' : current === 'male' ? 'female' : null;
        return { ...r, genderOverride: next };
      })
    );

  const removeRow = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));

  const nameCol = col('name');
  const invalidPhones = resolved.filter((r) => r.phone === undefined).length;
  const unparsedDates = resolved.filter((r) => r.birthdateRaw && !r.birthdate).length;

  // ---------- Import ----------
  const doImport = async () => {
    setError('');
    const cls = scope.selectedClass;
    if (!cls) { setError('اختر الكنيسة والخدمة والفصل أولًا'); return; }
    if (nameCol === -1) { setError('حدد عمود الاسم'); return; }
    if (!resolved.length) { setError('لا توجد صفوف للاستيراد'); return; }

    setImporting(true);
    let ok = 0, fail = 0;

    for (const r of resolved) {
      if (r.row.status === 'ok') continue;   // already imported in a previous run

      const setStatus = (status: BulkRow['status'], message?: string) =>
        setRows((rs) => rs.map((x) => (x.key === r.row.key ? { ...x, status, message } : x)));

      if (!r.name) { setStatus('error', 'الاسم مفقود'); fail++; continue; }
      if (r.phone === undefined) { setStatus('error', 'رقم هاتف غير صالح'); fail++; continue; }

      const codeVal = r.code === 'AUTO' ? generateCode() : r.code;

      // Person-centric flow: upsert the person by national id, then
      // register him as an enrollment in this church/service/class.
      const { data, error: err } = await supabase.rpc('add_person_and_enroll', {
        p_church: cls.church_id,
        p_service: cls.service_id,
        p_class: cls.id,
        p_name: r.name,
        p_national_id: codeVal || null,
        p_gender: r.gender,
        p_birthdate: r.birthdate,
        p_phone: r.phone,
        p_address: r.address || null,
        p_notes: r.notes || null,
        p_points: r.points,
      });
      const result = data as AddPersonResult | null;
      if (err) {
        setStatus('error', 'فشل الحفظ');
        fail++;
      } else if (result?.already_enrolled) {
        setStatus('error', 'مسجّل بالفعل في الفصل');
        fail++;
      } else {
        setStatus('ok');
        ok++;
      }
    }
    setImporting(false);
    setDone({ ok, fail });
  };

  const reset = () => {
    setRows([]); setMapping([]); setDone(null); setError('');
    setDefaultGender(''); setAutoCodes(false); setDateOrder('auto'); setDefaultPoints('0');
  };

  const pendingCount = resolved.filter((r) => r.row.status !== 'ok').length;

  return (
    <div className="space-y-4 pb-6">
      {/* Scope */}
      <div className="card space-y-3">
        <ScopeSelectors scope={scope} churches={churches} idPrefix="bulk" />
      </div>

      {/* Import sources */}
      {rows.length === 0 && (
        <div className="grid grid-cols-2 gap-3">
          <button
            id="bulk-excel-btn"
            type="button"
            onClick={() => excelInputRef.current?.click()}
            className="card flex aspect-square flex-col items-center justify-center gap-2 !p-3 transition active:scale-95"
          >
            <FileSpreadsheet className="h-10 w-10 text-emerald-500" />
            <span className="text-xs font-extrabold text-slate-500">استيراد من إكسل</span>
            <span className="text-[10px] text-slate-400" dir="ltr">.xlsx / .xls / .csv</span>
          </button>
          <button
            id="bulk-paste-btn"
            type="button"
            onClick={() => setPasteOpen(true)}
            className="card flex aspect-square flex-col items-center justify-center gap-2 !p-3 transition active:scale-95"
          >
            <ClipboardPaste className="h-10 w-10 text-primary-500" />
            <span className="text-xs font-extrabold text-slate-500">لصق البيانات</span>
            <span className="text-[10px] text-slate-400">من جدول أو نص</span>
          </button>
          <input
            ref={excelInputRef}
            id="bulk-excel-input"
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={onExcelFile}
          />
        </div>
      )}

      {rows.length > 0 && (
        <>
          {/* ---------- Column mapping ---------- */}
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-700">١· تحديد الأعمدة</h3>
              <button
                id="bulk-reset"
                type="button"
                onClick={reset}
                className="flex items-center gap-1 text-xs font-bold text-red-500"
              >
                <Trash2 className="h-3.5 w-3.5" /> مسح البيانات
              </button>
            </div>

            <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
              <input
                id="bulk-has-header"
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => setHasHeader(e.target.checked)}
                className="h-4 w-4 accent-primary-600"
              />
              الصف الأول عناوين (يتم تجاهله)
            </label>

            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full min-w-max text-xs">
                <thead>
                  <tr>
                    {Array.from({ length: colCount }, (_, i) => (
                      <th key={i} className="p-1">
                        <select
                          id={`bulk-map-${i}`}
                          aria-label={`عمود ${i + 1}`}
                          className={`input-field !w-32 !px-2 !py-1.5 !text-xs font-extrabold ${
                            (mapping[i] ?? 'skip') !== 'skip' ? '!border-primary-300 !bg-primary-50' : ''
                          }`}
                          value={mapping[i] ?? 'skip'}
                          onChange={(e) => setColMapping(i, e.target.value as BulkField)}
                        >
                          {BULK_FIELDS.map((f) => (
                            <option key={f.value} value={f.value}>{f.label}</option>
                          ))}
                        </select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dataRows.slice(0, 5).map((row, ri) => (
                    <tr key={row.key} className={ri % 2 ? 'bg-slate-50' : ''}>
                      {Array.from({ length: colCount }, (_, ci) => (
                        <td key={ci} className="max-w-[130px] truncate border-t border-indigo-50 p-1.5 font-bold text-slate-600">
                          {row.cells[ci] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] font-bold text-slate-400">معاينة أول 5 صفوف — إجمالي {dataRows.length} صفًا</p>
          </div>

          {/* ---------- Import options ---------- */}
          <div className="card space-y-4">
            <h3 className="text-sm font-extrabold text-slate-700">٢· خيارات الاستيراد</h3>

            {/* Gender */}
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">
                النوع {hasGenderData ? '— يُقرأ من العمود، ويمكن تعديل كل صف من المعاينة' : '— لا يوجد عمود نوع، اختر للجميع:'}
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  id="bulk-gender-none"
                  type="button"
                  aria-pressed={defaultGender === ''}
                  onClick={() => setDefaultGender('')}
                  className={`rounded-xl py-2 text-xs font-extrabold transition active:scale-95 ${
                    defaultGender === '' ? 'bg-slate-600 text-white shadow' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {hasGenderData ? 'من العمود' : 'بدون'}
                </button>
                <button
                  id="bulk-gender-boys"
                  type="button"
                  aria-pressed={defaultGender === 'male'}
                  onClick={() => setDefaultGender(defaultGender === 'male' ? '' : 'male')}
                  className={`rounded-xl py-2 text-xs font-extrabold transition active:scale-95 ${
                    defaultGender === 'male' ? 'bg-primary-600 text-white shadow' : 'bg-primary-50 text-primary-600'
                  }`}
                >
                  الكل ذكور 👦
                </button>
                <button
                  id="bulk-gender-girls"
                  type="button"
                  aria-pressed={defaultGender === 'female'}
                  onClick={() => setDefaultGender(defaultGender === 'female' ? '' : 'female')}
                  className={`rounded-xl py-2 text-xs font-extrabold transition active:scale-95 ${
                    defaultGender === 'female' ? 'bg-pink-500 text-white shadow' : 'bg-pink-50 text-pink-500'
                  }`}
                >
                  الكل إناث 👧
                </button>
              </div>
              {hasGenderData && defaultGender && (
                <p className="mt-1 text-[11px] font-bold text-amber-600">
                  سيُطبق على الصفوف التي لا يوجد بها نوع صريح فقط
                </p>
              )}
            </div>

            {/* Codes */}
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">الأكواد</label>
              <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                <input
                  id="bulk-auto-codes"
                  type="checkbox"
                  checked={autoCodes}
                  onChange={(e) => setAutoCodes(e.target.checked)}
                  className="h-4 w-4 accent-primary-600"
                />
                <Wand2 className="h-4 w-4 text-primary-500" />
                توليد رقم مؤقت تلقائي (P-XXXXXXXX) {hasCodeCol ? 'للصفوف التي بلا كود' : 'لكل المخدومين'}
              </label>
            </div>

            {/* Date format */}
            {(hasFullDate || hasSplitDate) && (
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-500">تاريخ الميلاد</label>
                {hasFullDate ? (
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      id="bulk-date-auto"
                      type="button"
                      aria-pressed={dateOrder === 'auto'}
                      onClick={() => setDateOrder('auto')}
                      className={`rounded-xl py-2 text-xs font-extrabold transition active:scale-95 ${
                        dateOrder === 'auto' ? 'bg-slate-600 text-white shadow' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      تلقائي
                    </button>
                    <button
                      id="bulk-date-dmy"
                      type="button"
                      aria-pressed={dateOrder === 'dmy'}
                      onClick={() => setDateOrder('dmy')}
                      className={`rounded-xl py-2 text-xs font-extrabold transition active:scale-95 ${
                        dateOrder === 'dmy' ? 'bg-primary-600 text-white shadow' : 'bg-primary-50 text-primary-600'
                      }`}
                      dir="ltr"
                    >
                      dd/mm/yyyy
                    </button>
                    <button
                      id="bulk-date-mdy"
                      type="button"
                      aria-pressed={dateOrder === 'mdy'}
                      onClick={() => setDateOrder('mdy')}
                      className={`rounded-xl py-2 text-xs font-extrabold transition active:scale-95 ${
                        dateOrder === 'mdy' ? 'bg-primary-600 text-white shadow' : 'bg-primary-50 text-primary-600'
                      }`}
                      dir="ltr"
                    >
                      mm/dd/yyyy
                    </button>
                  </div>
                ) : (
                  <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-500">
                    التاريخ من 3 أعمدة (يوم/شهر/سنة) — الشهر يُقبل رقمًا أو اسمًا (يناير، January...)
                  </p>
                )}
                {unparsedDates > 0 && (
                  <p className="mt-1 text-[11px] font-bold text-amber-600">
                    ⚠ {unparsedDates} تاريخ لم يُفهم — راجع الصيغة أو ستُحفظ بدون تاريخ
                  </p>
                )}
              </div>
            )}

            {/* Points */}
            <div>
              <label className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500">
                <Star className="h-3.5 w-3.5 text-gold-500" />
                نقاط لكل مخدوم {hasPointsCol && '(عمود النقاط له الأولوية)'}
              </label>
              <input
                id="bulk-default-points"
                type="number"
                min={0}
                className="input-field !w-28"
                value={defaultPoints}
                onChange={(e) => setDefaultPoints(e.target.value)}
              />
            </div>
          </div>

          {/* ---------- Resolved preview ---------- */}
          <div className="card space-y-2">
            <h3 className="text-sm font-extrabold text-slate-700">٣· المعاينة النهائية</h3>
            <p className="text-[11px] font-bold text-slate-400">اضغط على النوع لتغييره لكل صف على حدة</p>
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full min-w-max text-xs">
                <thead>
                  <tr className="text-right text-[11px] font-extrabold text-slate-400">
                    <th className="p-1.5">الاسم</th>
                    <th className="p-1.5">النوع</th>
                    <th className="p-1.5">الكود</th>
                    <th className="p-1.5">الميلاد</th>
                    <th className="p-1.5">الهاتف</th>
                    <th className="p-1.5">نقاط</th>
                    <th className="p-1.5 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {resolved.slice(0, 100).map((r) => (
                    <tr
                      key={r.row.key}
                      className={
                        r.row.status === 'ok' ? 'bg-emerald-50'
                        : r.row.status === 'error' ? 'bg-red-50'
                        : ''
                      }
                    >
                      <td className="max-w-[120px] truncate border-t border-indigo-50 p-1.5 font-extrabold text-slate-700">
                        {r.name || <span className="text-red-500">؟</span>}
                      </td>
                      <td className="border-t border-indigo-50 p-1">
                        <button
                          type="button"
                          aria-label="تبديل النوع"
                          onClick={() => cycleGender(r.row.key)}
                          className={`rounded-lg px-2 py-1 text-[11px] font-extrabold transition active:scale-95 ${
                            r.gender === 'male' ? 'bg-primary-100 text-primary-700'
                            : r.gender === 'female' ? 'bg-pink-100 text-pink-600'
                            : 'bg-slate-100 text-slate-400'
                          }`}
                        >
                          {r.gender === 'male' ? '👦 ذكر' : r.gender === 'female' ? '👧 أنثى' : '—'}
                        </button>
                      </td>
                      <td className="border-t border-indigo-50 p-1.5 font-bold text-slate-500" dir="ltr">
                        {r.code === 'AUTO' ? <span className="text-primary-500">تلقائي ✨</span> : r.code || '—'}
                      </td>
                      <td className="border-t border-indigo-50 p-1.5 font-bold" dir="ltr">
                        {r.birthdate ? (
                          <span className="text-slate-600">{r.birthdate.split('-').reverse().join('/')}</span>
                        ) : r.birthdateRaw ? (
                          <span className="text-amber-500" title={r.birthdateRaw}>⚠ {r.birthdateRaw}</span>
                        ) : '—'}
                      </td>
                      <td className="border-t border-indigo-50 p-1.5 font-bold" dir="ltr">
                        {r.phone === undefined ? (
                          <span className="text-red-500">✗ غير صالح</span>
                        ) : r.phone ? (
                          <span className="text-slate-600">{r.phone}</span>
                        ) : '—'}
                      </td>
                      <td className="border-t border-indigo-50 p-1.5 font-extrabold text-gold-600">{r.points}</td>
                      <td className="border-t border-indigo-50 p-1">
                        {r.row.status === 'ok' ? (
                          <Check className="h-4 w-4 text-emerald-500" />
                        ) : r.row.status === 'error' ? (
                          <span title={r.row.message}><X className="h-4 w-4 text-red-500" /></span>
                        ) : (
                          <button
                            type="button"
                            aria-label="حذف الصف"
                            onClick={() => removeRow(r.row.key)}
                            className="text-slate-300 hover:text-red-400"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {resolved.length > 100 && (
              <p className="text-[11px] font-bold text-slate-400">
                يتم عرض أول 100 صف — سيتم استيراد الكل ({resolved.length})
              </p>
            )}

            {dataRows.some((r) => r.status === 'error') && (
              <ul className="space-y-1 rounded-xl bg-red-50 p-2 text-[11px] font-bold text-red-600">
                {resolved.map((r, i) =>
                  r.row.status === 'error' ? (
                    <li key={r.row.key}>صف {i + 1}: {r.row.message} — {r.name}</li>
                  ) : null
                )}
              </ul>
            )}
          </div>

          {error && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>
          )}
          {done && (
            <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">
              ✓ تم استيراد {done.ok} مخدومًا{done.fail > 0 ? ` — فشل ${done.fail}` : ''}
            </p>
          )}
          {invalidPhones > 0 && !done && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-600">
              ⚠ {invalidPhones} رقم هاتف غير صالح (يجب {PHONE_LOCAL_LENGTH} رقمًا) — هذه الصفوف لن تُستورد
            </p>
          )}

          <button
            id="bulk-import"
            type="button"
            onClick={doImport}
            disabled={importing || nameCol === -1 || !scope.classId || pendingCount === 0}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {importing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
            استيراد {pendingCount} مخدومًا
          </button>
        </>
      )}

      {/* Paste modal */}
      {pasteOpen && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-extrabold">لصق البيانات</h3>
              <button type="button" onClick={() => setPasteOpen(false)} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <textarea
              id="bulk-paste-textarea"
              className="input-field font-mono !text-xs"
              rows={8}
              dir="auto"
              placeholder={'الصق هنا من إكسل أو جوجل شيت...\nكل صف في سطر، الأعمدة مفصولة بـ Tab أو فاصلة'}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
            <button
              id="bulk-paste-apply"
              type="button"
              onClick={applyPaste}
              disabled={!pasteText.trim()}
              className="btn-primary mt-3 w-full flex items-center justify-center gap-2"
            >
              <Check className="h-5 w-5" />
              معاينة البيانات
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
