'use client';

// ---------- طلبات انضمام الخدام — approvals (architecture 0037) ----------
// A pending request is a `servant_enrollments` row (status = pending) bound
// to a person. The approver sets role + scope and may attach permission
// profiles right away.

import { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import {
  UserCheck, Check, X, Phone, Loader2, ArrowRight, ShieldQuestion, IdCard, User, KeyRound, Cake, MapPin,
} from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { usePermissions } from '@/lib/permissions-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import type { ServantEnrollment, Church, Service, ClassRoom, AppRole, Person } from '@/lib/types';
import { ROLE_LABELS, SERVANTS_TABLE, GENDER_LABELS } from '@/lib/types';

type Request = ServantEnrollment & { person: Person | null };

export default function ApprovalsPanel() {
  const { profile } = useAuth();
  const supabase = createClient();
  const [pending, setPending] = useState<Request[]>([]);
  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data: p }, { data: ch }, { data: sv }, { data: cl }] = await Promise.all([
      supabase.from(SERVANTS_TABLE).select('*, person:persons!servant_enrollments_person_id_fkey(*)').eq('status', 'pending').order('created_at'),
      supabase.from('churches').select('*').order('name'),
      supabase.from('services').select('*').order('name'),
      supabase.from('classes').select('*').order('name'),
    ]);
    setPending((p ?? []) as Request[]);
    setChurches(ch ?? []);
    setServices(sv ?? []);
    setClasses(cl ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (profile?.status === 'approved') load();
  }, [profile?.status, load]);

  useDebouncedRealtime(supabase, 'approvals-page', [{ table: SERVANTS_TABLE }], load, { enabled: !!profile });

  const isManager =
    profile && ['owner', 'church_manager', 'service_manager'].includes(profile.role);

  if (profile && !isManager) {
    return (
      <>
        <div className="card py-12 text-center text-slate-400">
          <ShieldQuestion className="mx-auto mb-3 h-10 w-10" />
          <p className="font-bold">هذه الصفحة متاحة للمسؤولين فقط</p>
        </div>
      </>
    );
  }

  return (
    <>
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
        </div>
      ) : pending.length === 0 ? (
        <div className="card py-12 text-center text-slate-400">
          <UserCheck className="mx-auto mb-3 h-10 w-10" />
          <p className="font-bold">لا توجد طلبات معلقة 🎉</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {pending.map((p) => (
            <ApprovalCard
              key={p.id}
              request={p}
              approver={profile!}
              churches={churches}
              services={services}
              classes={classes}
              onDone={load}
            />
          ))}
        </ul>
      )}
    </>
  );
}

const fmtDate = (d: string | null) => {
  if (!d) return null;
  const [y, m, day] = d.split('-');
  return `${Number(day)}/${Number(m)}/${y}`;
};

function ApprovalCard({
  request, approver, churches, services, classes, onDone,
}: {
  request: Request;
  approver: ServantEnrollment;
  churches: Church[];
  services: Service[];
  classes: ClassRoom[];
  onDone: () => void;
}) {
  const supabase = createClient();
  const { profiles: permissionProfiles } = usePermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [role, setRole] = useState<AppRole>('class_servant');
  const [churchId, setChurchId] = useState(request.church_id ?? approver.church_id ?? '');
  const [serviceId, setServiceId] = useState(request.service_id ?? approver.service_id ?? '');
  const [classId, setClassId] = useState(request.class_id ?? '');
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);

  const grantableRoles: AppRole[] =
    approver.role === 'owner'
      ? ['church_manager', 'service_manager', 'class_servant']
      : approver.role === 'church_manager'
      ? ['service_manager', 'class_servant']
      : ['class_servant'];

  const scopedServices = services.filter((s) => !churchId || s.church_id === churchId);
  const scopedClasses = classes.filter((c) => !serviceId || c.service_id === serviceId);

  const needService = role === 'service_manager' || role === 'class_servant';
  const needClass = role === 'class_servant';

  const approve = async () => {
    setError('');
    if (!churchId) return setError('اختر الكنيسة');

    setBusy(true);
    const { error: err } = await supabase
      .from(SERVANTS_TABLE)
      .update({
        status: 'approved',
        role,
        church_id: churchId,
        service_id: needService ? (serviceId || null) : null,
        class_id: needClass ? (classId || null) : null,
        approved_by: approver.id,
        approved_at: new Date().toISOString(),
      })
      .eq('id', request.id);
    if (err) { setBusy(false); return setError('تعذر الاعتماد، حاول مجدداً'); }

    if (selectedProfiles.length) {
      await supabase.from('permissions').insert(
        selectedProfiles.map((pid) => ({ servant_id: request.id, permission_profile_id: pid }))
      );
    }
    setBusy(false);
    onDone();
  };

  const reject = async () => {
    setBusy(true);
    await supabase.from(SERVANTS_TABLE).update({ status: 'rejected' }).eq('id', request.id);
    setBusy(false);
    onDone();
  };

  const person = request.person;
  const photo = person?.image_url ?? request.photo_url;

  return (
    <li className="card">
      <div className="mb-3 flex items-start gap-3">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-emerald-50 ring-2 ring-emerald-100 flex items-center justify-center">
          {photo ? (
            <Image src={photo} alt={request.full_name} fill sizes="56px" className="object-cover" />
          ) : (
            <User className="h-7 w-7 text-emerald-400" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-extrabold">{request.full_name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
            <span className="flex items-center gap-1" dir="ltr">
              <IdCard className="h-3 w-3" /> {person?.national_id ?? request.user_id}
            </span>
            <span className="flex items-center gap-1" dir="ltr">
              <Phone className="h-3 w-3" /> {person?.phone ?? request.phone}
            </span>
            {person?.gender && <span>{GENDER_LABELS[person.gender]}</span>}
            {person?.birthdate && (
              <span className="flex items-center gap-1"><Cake className="h-3 w-3" /> {fmtDate(person.birthdate)}</span>
            )}
          </p>
          {person?.address && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400"><MapPin className="h-3 w-3" /> {person.address}</p>
          )}
          {person?.notes && <p className="mt-0.5 text-xs text-slate-400">📝 {person.notes}</p>}
          {(request.church_id || request.service_id || request.class_id) && (
            <p className="mt-1.5 inline-block rounded-lg bg-primary-50 px-2 py-1 text-xs font-bold text-primary-600">
              طلب الانضمام إلى: {churches.find((c) => c.id === request.church_id)?.name ?? '—'}
              {request.service_id ? ` ← ${services.find((s) => s.id === request.service_id)?.name ?? ''}` : ''}
              {request.class_id ? ` ← ${classes.find((c) => c.id === request.class_id)?.name ?? ''}` : ''}
            </p>
          )}
        </div>
      </div>

      <div className="mb-3 space-y-2">
        <select className="input-field" value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
          {grantableRoles.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>

        <select
          className="input-field"
          value={churchId}
          onChange={(e) => { setChurchId(e.target.value); setServiceId(''); setClassId(''); }}
          disabled={approver.role !== 'owner'}
        >
          <option value="">اختر الكنيسة</option>
          {churches.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {needService && (
          <select
            className="input-field"
            value={serviceId}
            onChange={(e) => { setServiceId(e.target.value); setClassId(''); }}
            disabled={approver.role === 'service_manager'}
          >
            <option value="">كل الخدمات (بدون تحديد)</option>
            {scopedServices.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}

        {needClass && (
          <select className="input-field" value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">كل الفصول (بدون تحديد)</option>
            {scopedClasses.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}

        {/* permission profiles (0037) */}
        {permissionProfiles.length > 0 && (
          <div className="rounded-xl bg-slate-50 p-2.5">
            <p className="mb-1.5 flex items-center gap-1 text-xs font-extrabold text-slate-500">
              <KeyRound className="h-3.5 w-3.5 text-primary-500" /> ملفات الصلاحيات <span className="font-normal">(اختياري)</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {permissionProfiles.map((pp) => {
                const on = selectedProfiles.includes(pp.id);
                return (
                  <button
                    key={pp.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setSelectedProfiles((s) => (on ? s.filter((x) => x !== pp.id) : [...s, pp.id]))}
                    className={`rounded-full px-3 py-1 text-xs font-bold transition ${on ? 'text-white shadow' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}
                    style={on ? { backgroundColor: pp.color } : undefined}
                  >
                    {pp.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>
      )}

      <div className="flex gap-2">
        <button onClick={approve} disabled={busy}
          className="btn-primary flex-1 !py-2.5 flex items-center justify-center gap-1 text-sm">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          اعتماد
        </button>
        <button onClick={reject} disabled={busy}
          className="flex-1 rounded-xl border border-red-200 bg-white py-2.5 text-sm font-bold text-red-600 hover:bg-red-50 transition flex items-center justify-center gap-1">
          <X className="h-4 w-4" />
          رفض
        </button>
      </div>
    </li>
  );
}
