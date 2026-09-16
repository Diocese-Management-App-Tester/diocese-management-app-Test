'use client';

// ---------- تعديل بياناتي — the servant edits his own PERSON (0037) ----------
// Name / phone / photo / gender / birthdate / address live on the servant's
// `persons` row; DB triggers mirror name · phone · photo into his
// servant enrollment. Falls back to the enrollment when no person is bound.

import { useState } from 'react';
import { X, Save, User, Phone, Upload, IdCard, Cake, MapPin } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { uploadPhoto } from '@/lib/upload';
import { SERVANTS_TABLE, GENDER_LABELS, PHONE_PREFIX, PHONE_LOCAL_LENGTH, type Gender } from '@/lib/types';
import ResetPasswordSection from '@/components/ResetPasswordSection';

export default function EditProfileModal({ onClose }: { onClose: () => void }) {
  const { profile, person, refresh } = useAuth();
  const supabase = createClient();

  const [fullName, setFullName] = useState(person?.name ?? profile?.full_name ?? '');
  const [phoneLocal, setPhoneLocal] = useState(
    (person?.phone ?? profile?.phone ?? '').replace(/^\+2/, '').replace(/\D/g, '').slice(0, PHONE_LOCAL_LENGTH)
  );
  const [gender, setGender] = useState<Gender | ''>(person?.gender ?? '');
  const [birthdate, setBirthdate] = useState(person?.birthdate ?? '');
  const [address, setAddress] = useState(person?.address ?? '');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!profile) return;
    if (!fullName.trim()) return setError('الاسم مطلوب');
    if (phoneLocal && phoneLocal.length !== PHONE_LOCAL_LENGTH) {
      return setError(`رقم الهاتف يجب أن يكون ${PHONE_LOCAL_LENGTH} رقمًا بعد ${PHONE_PREFIX}`);
    }
    setBusy(true);
    setError('');

    let photo_url = person?.image_url ?? profile.photo_url ?? null;
    if (photoFile) {
      try {
        photo_url = await uploadPhoto(supabase, 'servants', photoFile);
      } catch {
        setBusy(false);
        return setError('تعذر رفع الصورة');
      }
    }
    const phone = phoneLocal ? `${PHONE_PREFIX}${phoneLocal}` : '';

    let err = null;
    if (person) {
      ({ error: err } = await supabase.from('persons').update({
        name: fullName.trim(),
        phone: phone || null,
        gender: gender || null,
        birthdate: birthdate || null,
        address: address.trim() || null,
        image_url: photo_url,
      }).eq('id', person.id));
    } else {
      ({ error: err } = await supabase
        .from(SERVANTS_TABLE)
        .update({ full_name: fullName.trim(), phone, photo_url })
        .eq('id', profile.id));
    }
    setBusy(false);
    if (err) return setError('تعذر حفظ التعديلات، حاول مجدداً');
    await refresh();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5 shadow-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-gray-800">تعديل بياناتي</h2>
          <button onClick={onClose} className="rounded-xl bg-gray-100 p-2">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="space-y-3">
          <p className="flex items-center gap-1 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <IdCard className="h-3.5 w-3.5" /> الكود / اسم الدخول:
            <b dir="ltr" className="text-slate-700">{person?.national_id ?? profile?.user_id}</b>
          </p>

          <div>
            <label className="mb-1 flex items-center gap-1 text-xs font-bold text-gray-500">
              <User className="h-3.5 w-3.5" /> الاسم الكامل
            </label>
            <input className="input-field" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="الاسم الكامل" />
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-gray-500">النوع</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" aria-pressed={gender === 'male'} onClick={() => setGender(gender === 'male' ? '' : 'male')}
                className={`rounded-xl py-2 text-sm font-extrabold transition ${gender === 'male' ? 'bg-primary-600 text-white' : 'bg-primary-50 text-primary-600'}`}>
                {GENDER_LABELS.male}
              </button>
              <button type="button" aria-pressed={gender === 'female'} onClick={() => setGender(gender === 'female' ? '' : 'female')}
                className={`rounded-xl py-2 text-sm font-extrabold transition ${gender === 'female' ? 'bg-pink-500 text-white' : 'bg-pink-50 text-pink-500'}`}>
                {GENDER_LABELS.female}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 flex items-center gap-1 text-xs font-bold text-gray-500">
              <Phone className="h-3.5 w-3.5" /> رقم الهاتف
            </label>
            <div className="flex items-stretch overflow-hidden rounded-xl border border-indigo-100 bg-white focus-within:ring-2 focus-within:ring-primary-300" dir="ltr">
              <span className="flex items-center bg-indigo-50 px-3 text-sm font-extrabold text-primary-700">{PHONE_PREFIX}</span>
              <input type="tel" inputMode="numeric" className="w-full px-3 py-2.5 text-sm font-bold outline-none" placeholder="01xxxxxxxxx"
                value={phoneLocal} maxLength={PHONE_LOCAL_LENGTH}
                onChange={(e) => setPhoneLocal(e.target.value.replace(/\D/g, '').slice(0, PHONE_LOCAL_LENGTH))} />
            </div>
          </div>

          <div>
            <label className="mb-1 flex items-center gap-1 text-xs font-bold text-gray-500">
              <Cake className="h-3.5 w-3.5" /> تاريخ الميلاد
            </label>
            <input type="date" className="input-field" dir="ltr" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} />
          </div>

          <div>
            <label className="mb-1 flex items-center gap-1 text-xs font-bold text-gray-500">
              <MapPin className="h-3.5 w-3.5" /> العنوان
            </label>
            <input className="input-field" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="العنوان" />
          </div>

          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-primary-300 bg-primary-50/50 px-4 py-3 text-sm font-bold text-primary-600">
            <Upload className="h-4 w-4" />
            {photoFile ? photoFile.name : (person?.image_url ?? profile?.photo_url) ? 'تغيير صورتي الشخصية' : 'إضافة صورتي الشخصية (اختياري)'}
            <input type="file" accept="image/*" className="hidden"
              onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} />
          </label>

          {/* 0042: change MY login password (Supabase Auth, current session) */}
          <ResetPasswordSection
            idPrefix="my-pw"
            title="تغيير كلمة المرور"
            hint="كلمة دخولك للتطبيق — 6 أحرف على الأقل"
            onReset={async (pw) => {
              const { error: e } = await supabase.auth.updateUser({ password: pw });
              if (!e) return null;
              const m = (e.message ?? '').toLowerCase();
              return m.includes('same') || m.includes('different')
                ? 'اختر كلمة مرور مختلفة عن الحالية'
                : m.includes('weak') || m.includes('at least')
                ? 'كلمة المرور ضعيفة — 6 أحرف على الأقل'
                : 'تعذر تغيير كلمة المرور، حاول مجددًا';
            }}
          />

          {error && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>
          )}

          <button onClick={save} disabled={busy} className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60">
            <Save className="h-4 w-4" />
            {busy ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
          </button>
        </div>
      </div>
    </div>
  );
}
