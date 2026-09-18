'use client';

// ---------- طلبات انضمام الخدام — approvals (architecture 0037) ----------
// A pending request is a `servant_enrollments` row (status = pending) bound
// to a person. The approver sets role + PLACES (0045: one or many, through
// ScopePicker → RPC set_servant_scopes) and may attach permission profiles
// right away.

import { useEffect, useState, useCallback, useMemo } from 'react';
import Image from 'next/image';
import {
  UserCheck, Check, X, Phone, Loader2, ArrowRight, ShieldQuestion, IdCard, User, KeyRound, Cake, MapPin,
} from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { usePermissions } from '@/lib/permissions-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { ScopeGroups, ScopeGroupFilters, useScopeGroups, toLookups } from '@/components/ScopeGroups';
import ScopePicker, { scopeLabel, clampScope, type ScopeDepth } from '@/components/ScopePicker';
import type { ServantEnrollment, Church, Service, ClassRoom, AppRole, Person, ScopeRef, ServantScope } from '@/lib/types';
import { ROLE_LABELS, SERVANTS_TABLE, SERVANT_SCOPES_TABLE, GENDER_LABELS, allScopesOf } from '@/lib/types';

type Request = ServantEnrollment & { person: Person | null; extra_scopes?: ServantScope[] };

/** How deep a place goes for a role. */
export const roleDepth = (r: AppRole): ScopeDepth => r === 'church_manager' ? 'church' : r === 'service_manager' ? 'service' : 'class';

/** Churches / services the approver may grant (mirror of SQL scope_grantable). */
export function grantableLocks(approver: ServantEnrollment, approverScopes: ScopeRef[]) {
  if (approver.role === 'owner') return { allowedChurches: undefined as string[] | undefined, lockService: null as string | null };
  const churches = Array.from(new Set(approverScopes.map((s) => s.church_id)));
  // a service manager bound to exactly one service (and nothing wider) is locked to it
  const wholeChurch = approverScopes.some((s) => !s.service_id);
  const services = Array.from(new Set(approverScopes.map((s) => s.service_id).filter(Boolean))) as string[];
  const lockService = approver.role === 'service_manager' && !wholeChurch && services.length === 1 ? services[0] : null;
  return { allowedChurches: churches.length ? churches : [approver.church_id ?? ''], lockService };
}

export default function ApprovalsPanel() {
  const { profile } = useAuth();
  const supabase = createClient();
  const [pending, setPending] = useState<Request[]>([]);
  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [loading, setLoading] = useState(true);

  // requests grouped church → service → class (the scope the servant asked for)
  const lookups = useMemo(() => toLookups(churches, services, classes), [churches, services, classes]);
  const { scope, setScope, search, setSearch, visible } = useScopeGroups(
    pending,
    (p, q) => (p.full_name ?? '').toLowerCase().includes(q) || (p.user_id ?? '').toLowerCase().includes(q) || (p.phone ?? '').includes(q),
  );

  const load = useCallback(async () => {
    const [{ data: p }, { data: ch }, { data: sv }, { data: cl }] = await Promise.all([
      supabase.from(SERVANTS_TABLE).select('*, person:persons!servant_enrollments_person_id_fkey(*)').eq('status', 'pending').order('created_at'),
      supabase.from('churches').select('*').order('name'),
      supabase.from('services').select('*').order('name'),
      supabase.from('classes').select('*').order('name'),
    ]);
    const reqs = (p ?? []) as Request[];
    // 0045: the other places each request asked for
    if (reqs.length) {
      const { data: xs } = await supabase.from(SERVANT_SCOPES_TABLE).select('*').in('servant_id', reqs.map((r) => r.id));
      const by = new Map<string, ServantScope[]>();
      for (const x of (xs ?? []) as ServantScope[]) by.set(x.servant_id, [...(by.get(x.servant_id) ?? []), x]);
      reqs.forEach((r) => { r.extra_scopes = by.get(r.id) ?? []; });
    }
    setPending(reqs);
    setChurches(ch ?? []);
    setServices(sv ?? []);
    setClasses(cl ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (profile?.status === 'approved') load();
  }, [profile?.status, load]);

  useDebouncedRealtime(supabase, 'approvals-page', [{ table: SERVANTS_TABLE }, { table: SERVANT_SCOPES_TABLE }], load, { enabled: !!profile });

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
        <>
        <ScopeGroupFilters idPrefix="approvals" scope={scope} onScope={setScope} lookups={lookups}
          search={search} onSearch={setSearch} placeholder="بحث بالاسم أو الكود أو الهاتف..." />
        <ScopeGroups
          idPrefix="approvals"
          rows={visible}
          lookups={lookups}
          tone="emerald"
          itemName={null}
          emptyText="لا توجد طلبات مطابقة"
          renderItem={(p) => (
            <ApprovalCard
              key={p.id}
              request={p}
              approver={profile!}
              churches={churches}
              services={services}
              classes={classes}
              onDone={load}
            />
          )}
        />
        </>
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
  const { scopes: approverScopes } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [role, setRole] = useState<AppRole>('class_servant');
  // 0045: the places — what the servant asked for (primary + extras), or the approver's own place
  const requested = useMemo(() => allScopesOf(request, request.extra_scopes ?? []), [request]);
  const [scopes, setScopes] = useState<ScopeRef[]>(
    requested.length ? requested : approver.church_id ? [{ church_id: approver.church_id, service_id: approver.service_id, class_id: null }] : []
  );
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);
  const lookups = useMemo(() => ({ churches, services, classes }), [churches, services, classes]);
  const depth = roleDepth(role);
  const locks = grantableLocks(approver, approverScopes);

  const grantableRoles: AppRole[] =
    approver.role === 'owner'
      ? ['church_manager', 'service_manager', 'class_servant']
      : approver.role === 'church_manager'
      ? ['service_manager', 'class_servant']
      : ['class_servant'];

  // the role decides the depth — clamp + dedupe the places when it changes
  const onRole = (r: AppRole) => {
    setRole(r);
    const d = roleDepth(r);
    const seen = new Set<string>();
    setScopes((list) => list.map((s) => clampScope(s, d)).filter((s) => {
      const k = `${s.church_id}|${s.service_id ?? ''}|${s.class_id ?? ''}`;
      if (seen.has(k)) return false; seen.add(k); return true;
    }));
  };

  const approve = async () => {
    setError('');
    if (scopes.length === 0) return setError('اختر مكان الخدمة (الكنيسة على الأقل)');

    setBusy(true);
    const primary = clampScope(scopes[0], depth);
    const { error: err } = await supabase
      .from(SERVANTS_TABLE)
      .update({
        status: 'approved',
        role,
        church_id: primary.church_id,
        service_id: primary.service_id,
        class_id: primary.class_id,
        approved_by: approver.id,
        approved_at: new Date().toISOString(),
      })
      .eq('id', request.id);
    if (err) { setBusy(false); return setError('تعذر الاعتماد، حاول مجدداً'); }

    // 0045: every place (replaces the requested list; the primary is scopes[0])
    const { error: se } = await supabase.rpc('set_servant_scopes', {
      p_servant: request.id,
      p_scopes: scopes.map((s) => clampScope(s, depth)),
    });
    if (se) {
      setBusy(false);
      return setError(se.message?.includes('scope_not_allowed')
        ? 'أحد الأماكن خارج نطاق إدارتك — تم الاعتماد بالمكان الأساسي فقط'
        : 'تم الاعتماد لكن تعذر حفظ باقي الأماكن (حدّث قاعدة البيانات 0045)');
    }

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
          {requested.length > 0 && (
            <div className="mt-1.5 rounded-lg bg-primary-50 px-2 py-1 text-xs font-bold text-primary-600">
              <p>طلب الانضمام إلى{requested.length > 1 ? ` (${requested.length} أماكن)` : ''}:</p>
              <ul className="mt-0.5 space-y-0.5">
                {requested.map((s, i) => <li key={i}>• {scopeLabel(s, lookups)}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="mb-3 space-y-2">
        <select className="input-field" value={role} onChange={(e) => onRole(e.target.value as AppRole)}>
          {grantableRoles.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>

        {/* 0045: one or many places (the first is the primary) */}
        <ScopePicker
          idPrefix={`approve-${request.id}`}
          title="أماكن الخدمة"
          value={scopes}
          onChange={setScopes}
          lookups={lookups}
          depth={depth}
          allowedChurches={locks.allowedChurches}
          lockService={locks.lockService}
          emptyText="اختر مكان الخدمة"
        />

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
