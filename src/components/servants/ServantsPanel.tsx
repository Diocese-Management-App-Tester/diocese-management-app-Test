'use client';

// ---------- إدارة الخدام → الخدام — servant enrollments (architecture 0037) ----------
// One card per servant enrollment (person + role + scope). Managers edit the
// person data (mirrored into the enrollment by DB triggers), the role /
// scope (church → service → class), suspend / delete, and connect the
// servant to PERMISSION PROFILES (`permissions` rows) within their level.
//
// Twin of إدارة المخدومين → المخدومين (ManagePeoplePanel) — SAME shared
// pieces (ScopeTree.tsx): search · كنيسة → خدمة → فصل filters · الكل / يعمل /
// موقوف tabs · nested church → service → class grouping with ⏸ إيقاف الكل /
// ▶ تفعيل الكل per node · «إيقاف / تفعيل نطاق كامل» card.

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Loader2, X, Pencil, Save, Upload, IdCard, Phone, ShieldCheck, PauseCircle, PlayCircle, Trash2, KeyRound, Check,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { usePermissions } from '@/lib/permissions-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { uploadPhoto } from '@/lib/upload';
import { ALL } from '@/lib/queries';
import ResetPasswordSection from '@/components/ResetPasswordSection';
import { EditCodeModal } from '@/components/PersonDataModals';
import { changeServantCode, resetServantPassword, servantAccountMessage } from '@/lib/servant-account';
import {
  ScopeFilters, ScopeTreeView, PersonCard, BulkScopeStatusCard, PanelNotice, buildScopeTree,
  type StatusFilter, type ScopeSelection, type ScopeNode,
} from '@/components/ScopeTree';
import type { ServantEnrollment, Church, Service, ClassRoom, AppRole, Person, PermissionProfile } from '@/lib/types';
import { ROLE_LABELS, SERVANTS_TABLE, GENDER_LABELS, PHONE_PREFIX, PHONE_LOCAL_LENGTH, type Gender } from '@/lib/types';

export type Servant = ServantEnrollment & { person: Person | null };

/** Who may edit / suspend / delete this servant (mirror of the RLS + can_manage_servant). */
export const canManageServant = (profile: ServantEnrollment | null | undefined, p: ServantEnrollment): boolean => {
  if (!profile || p.id === profile.id) return false;
  if (profile.role === 'owner') return true;
  if (profile.role === 'church_manager') return p.church_id === profile.church_id && p.role !== 'owner';
  if (profile.role === 'service_manager')
    return p.role === 'class_servant' && (p.service_id === profile.service_id || (profile.service_id === null && p.church_id === profile.church_id));
  return false;
};

export default function ServantsPanel() {
  const { profile } = useAuth();
  const { profiles: permissionProfiles, grants, reload: reloadPermissions } = usePermissions();
  const [supabase] = useState(() => createClient());
  const [servants, setServants] = useState<Servant[]>([]);
  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [editing, setEditing] = useState<Servant | null>(null);
  const [permsFor, setPermsFor] = useState<Servant | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  // filters — same as إدارة المخدومين
  const [scope, setScope] = useState<ScopeSelection>({ church: ALL, service: ALL, class: ALL });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [q, setQ] = useState('');

  const isManager = profile && ['owner', 'church_manager', 'service_manager'].includes(profile.role);

  const canManage = (p: ServantEnrollment) => canManageServant(profile, p);

  const load = useCallback(async () => {
    const [{ data: pr }, { data: ch }, { data: sv }, { data: cl }] = await Promise.all([
      supabase.from(SERVANTS_TABLE).select('*, person:persons!servant_enrollments_person_id_fkey(*)').in('status', ['approved', 'suspended']).order('full_name'),
      supabase.from('churches').select('*').order('name'),
      supabase.from('services').select('*').order('name'),
      supabase.from('classes').select('*').order('name'),
    ]);
    setServants((pr ?? []) as Servant[]);
    setChurches(ch ?? []);
    setServices(sv ?? []);
    setClasses(cl ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (profile?.status === 'approved') load();
  }, [profile?.status, load]);

  useDebouncedRealtime(supabase, 'servants-page', [{ table: SERVANTS_TABLE }, { table: 'persons' }], load, { enabled: !!profile });

  const lookups = useMemo(() => ({ churches, services, classes }), [churches, services, classes]);

  // permission profiles per servant (from the grants the caller may see)
  const profilesOf = useMemo(() => {
    const byId = new Map(permissionProfiles.map((p) => [p.id, p]));
    const out = new Map<string, PermissionProfile[]>();
    for (const g of grants) {
      const pp = byId.get(g.permission_profile_id);
      if (!pp) continue;
      out.set(g.servant_id, [...(out.get(g.servant_id) ?? []), pp]);
    }
    return out;
  }, [grants, permissionProfiles]);

  // scope + search (status kept separate so the tab counters stay right)
  const scoped = useMemo(() => {
    const t = q.trim().toLowerCase();
    return servants.filter((s) =>
      (scope.church === ALL || s.church_id === scope.church)
      && (scope.service === ALL || s.service_id === scope.service)
      && (scope.class === ALL || s.class_id === scope.class)
      && (!t
        || s.full_name.toLowerCase().includes(t)
        || (s.person?.national_id ?? s.user_id).toLowerCase().includes(t)
        || (s.person?.phone ?? s.phone ?? '').includes(t))
    );
  }, [servants, q, scope]);

  const counts = useMemo(() => {
    const stopped = scoped.filter((s) => s.status === 'suspended').length;
    return { all: scoped.length, active: scoped.length - stopped, stopped };
  }, [scoped]);

  const visible = useMemo(
    () => statusFilter === 'all' ? scoped : scoped.filter((s) => (statusFilter === 'stopped') === (s.status === 'suspended')),
    [scoped, statusFilter]
  );

  const tree = useMemo(() => buildScopeTree(visible, lookups, (s) => s.full_name), [visible, lookups]);

  const flash = (tone: 'ok' | 'err', text: string) => {
    setNotice({ tone, text });
    setTimeout(() => setNotice(null), 4000);
  };

  // ---------- per-row ----------
  const toggleSuspend = async (p: ServantEnrollment) => {
    const next = p.status === 'suspended' ? 'approved' : 'suspended';
    if (next === 'suspended' && !confirm(`إيقاف الخادم «${p.full_name}»؟\n\nلن يستطيع الدخول إلى التطبيق حتى تعيد تفعيله. بياناته وصلاحياته تبقى كما هي.`)) return;
    setBusy(p.id);
    const { error } = await supabase.from(SERVANTS_TABLE).update({ status: next }).eq('id', p.id);
    setBusy(null);
    if (error) return flash('err', 'تعذر تغيير حالة الخادم — تأكد من صلاحياتك');
    setServants((ss) => ss.map((s) => (s.id === p.id ? { ...s, status: next } : s)));
    flash('ok', next === 'suspended' ? `تم إيقاف ${p.full_name}` : `تم تفعيل ${p.full_name}`);
  };

  const remove = async (p: ServantEnrollment) => {
    if (!window.confirm(`هل أنت متأكد من حذف الخادم «${p.full_name}» وحسابه؟ لا يمكن التراجع.`)) return;
    setBusy(p.id);
    const { error } = await supabase.from(SERVANTS_TABLE).delete().eq('id', p.id);
    setBusy(null);
    if (error) return flash('err', 'تعذر حذف الخادم — تأكد من صلاحياتك');
    flash('ok', `تم حذف ${p.full_name}`);
    load();
  };

  // ---------- node (scope) — RPC set_enrollments_status(kind = servant) ----------
  const setNodeStatus = async (n: ScopeNode<Servant>, status: 'active' | 'stopped') => {
    if (!n.scope.church) return;
    const verb = status === 'stopped' ? 'إيقاف' : 'تفعيل';
    if (!confirm(`${verb} كل الخدام في «${n.name}» (${n.rows.length})؟`)) return;
    setBusy(`node:${n.key}`);
    const { data, error } = await supabase.rpc('set_enrollments_status', {
      p_status: status, p_church: n.scope.church, p_service: n.scope.service, p_class: n.scope.class, p_kind: 'servant',
    });
    setBusy(null);
    if (error) return flash('err', 'تعذر تنفيذ العملية — تأكد من صلاحياتك على هذا النطاق وتحديث قاعدة البيانات (0043)');
    const r = (data ?? {}) as { servants?: number };
    flash('ok', `تم ${verb} ${r.servants ?? 0} — ${n.name}`);
    load();
  };

  if (!isManager) {
    return (
      <div className="card py-12 text-center text-slate-400 font-bold">
        هذه الصفحة متاحة للمديرين فقط
      </div>
    );
  }

  return (
    <>
      <ScopeFilters
        idPrefix="servants"
        search={q} onSearch={setQ} placeholder="بحث بالاسم أو الكود أو الهاتف..."
        scope={scope} onScope={setScope}
        status={statusFilter} onStatus={setStatusFilter}
        lookups={lookups} counts={counts}
      />

      <BulkScopeStatusCard kind="servant" lookups={lookups} initial={scope} stoppedCount={counts.stopped}
        onDone={(msg, ok) => { flash(ok ? 'ok' : 'err', msg); if (ok) load(); }} />

      <PanelNotice notice={notice} />

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>
      ) : visible.length === 0 ? (
        <div className="card py-12 text-center text-slate-400 font-bold">
          {q ? 'لا نتائج' : statusFilter === 'stopped' ? 'لا يوجد خدام موقوفون في هذا النطاق' : 'لا يوجد خدام في هذا النطاق'}
        </div>
      ) : (
        <ScopeTreeView
          nodes={tree}
          kind="servant"
          idPrefix="servants"
          nodeAction={(n) => n.scope.church && n.rows.some(canManage) ? {
            allStopped: n.rows.every((r) => r.status === 'suspended'),
            busy: busy === `node:${n.key}`,
            onToggle: () => setNodeStatus(n, n.rows.every((r) => r.status === 'suspended') ? 'active' : 'stopped'),
          } : null}
          renderRow={(p) => {
            const pps = profilesOf.get(p.id) ?? [];
            const stopped = p.status === 'suspended';
            const rowBusy = busy === p.id;
            const manageable = canManage(p);
            return (
              <PersonCard
                key={p.id}
                id={`servant-row-${p.id}`}
                kind="servant"
                name={p.full_name}
                photo={p.person?.image_url ?? p.photo_url}
                stopped={stopped}
                badges={
                  <span className="badge bg-primary-100 text-primary-700">
                    <ShieldCheck className="h-3 w-3" /> {ROLE_LABELS[p.role]}
                  </span>
                }
                meta={
                  <>
                    <span className="flex items-center gap-1" dir="ltr"><IdCard className="h-3 w-3" /> {p.person?.national_id ?? p.user_id}</span>
                    {(p.person?.phone ?? p.phone) && (
                      <span className="flex items-center gap-1" dir="ltr"><Phone className="h-3 w-3" /> {p.person?.phone ?? p.phone}</span>
                    )}
                  </>
                }
                extra={p.role !== 'owner' ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <KeyRound className="h-3 w-3 text-slate-400" />
                    {pps.length === 0 ? (
                      <span className="text-[11px] font-bold text-slate-400">بدون ملف صلاحيات</span>
                    ) : pps.map((pp) => (
                      <span key={pp.id} className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style={{ backgroundColor: pp.color }}>
                        {pp.name}
                      </span>
                    ))}
                  </div>
                ) : undefined}
                actions={manageable ? [
                  { id: `edit-${p.id}`, tone: 'primary', icon: <Pencil className="h-3.5 w-3.5" />, label: 'تعديل', onClick: () => setEditing(p), disabled: rowBusy },
                  { id: `perms-${p.id}`, tone: 'violet', icon: <KeyRound className="h-3.5 w-3.5" />, label: 'الصلاحيات', onClick: () => setPermsFor(p), disabled: rowBusy },
                  { id: `stop-${p.id}`, tone: stopped ? 'emerald' : 'amber', busy: rowBusy,
                    icon: stopped ? <PlayCircle className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />,
                    label: stopped ? 'تفعيل' : 'إيقاف', onClick: () => toggleSuspend(p) },
                  { id: `delete-${p.id}`, tone: 'red', icon: <Trash2 className="h-3.5 w-3.5" />, label: 'حذف', onClick: () => remove(p), disabled: rowBusy },
                ] : undefined}
                note={!manageable ? (p.id === profile?.id ? 'هذا حسابك — عدّله من الإعدادات ← تعديل بياناتي' : 'خارج نطاق إدارتك') : undefined}
              />
            );
          }}
        />
      )}

      {editing && profile && (
        <EditServantModal
          servant={editing}
          approver={profile}
          churches={churches}
          services={services}
          classes={classes}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {permsFor && (
        <PermissionsModal
          servant={permsFor}
          profiles={permissionProfiles}
          current={(profilesOf.get(permsFor.id) ?? []).map((p) => p.id)}
          onClose={() => setPermsFor(null)}
          onSaved={async () => { setPermsFor(null); await reloadPermissions(); }}
        />
      )}
    </>
  );
}

// ---------- Edit modal: person data + role + scope ----------
export function EditServantModal({
  servant, approver, churches, services, classes, onClose, onSaved,
}: {
  servant: Servant;
  approver: ServantEnrollment;
  churches: Church[];
  services: Service[];
  classes: ClassRoom[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const person = servant.person;
  const [fullName, setFullName] = useState(servant.full_name);
  const [phoneLocal, setPhoneLocal] = useState((person?.phone ?? servant.phone ?? '').replace(/^\+2/, '').replace(/\D/g, '').slice(0, PHONE_LOCAL_LENGTH));
  const [gender, setGender] = useState<Gender | ''>(person?.gender ?? '');
  const [birthdate, setBirthdate] = useState(person?.birthdate ?? '');
  const [address, setAddress] = useState(person?.address ?? '');
  const [notes, setNotes] = useState(person?.notes ?? '');
  const [role, setRole] = useState<AppRole>(servant.role);
  const [churchId, setChurchId] = useState(servant.church_id ?? '');
  const [serviceId, setServiceId] = useState(servant.service_id ?? '');
  const [classId, setClassId] = useState(servant.class_id ?? '');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // 0042: the code (= login name) is editable through the same confirmed
  // flow as for children (generate / scan / type) → service-role API updates
  // the auth account + servant row + person.
  const currentCode = person?.national_id ?? servant.user_id;
  const [code, setCode] = useState(currentCode);
  const [codeModal, setCodeModal] = useState(false);
  const codeChanged = code.trim() !== currentCode;
  const startCodeEdit = () => {
    const ok = confirm(
      `⚠️ تعديل كود الخادم\n\nالكود هو اسم دخول «${servant.full_name}» للتطبيق وهويته في كل التسجيلات وما يُطبع على بطاقته.\n\nتغييره يجعل البطاقة القديمة غير صالحة ويلزمه الدخول بالكود الجديد.\n\nهل تريد المتابعة؟`
    );
    if (ok) setCodeModal(true);
  };

  const grantableRoles: AppRole[] =
    approver.role === 'owner'
      ? ['church_manager', 'service_manager', 'class_servant']
      : approver.role === 'church_manager'
      ? ['service_manager', 'class_servant']
      : ['class_servant'];

  const churchLocked = approver.role !== 'owner';
  const serviceLocked = approver.role === 'service_manager';

  const scopedServices = services.filter((s) => !churchId || s.church_id === churchId);
  const scopedClasses = classes.filter((c) => !serviceId || c.service_id === serviceId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (phoneLocal && phoneLocal.length !== PHONE_LOCAL_LENGTH) {
      return setError(`رقم الهاتف يجب أن يكون ${PHONE_LOCAL_LENGTH} رقمًا بعد ${PHONE_PREFIX}`);
    }
    setSaving(true);

    let photo_url = person?.image_url ?? servant.photo_url ?? null;
    if (photoFile) {
      try {
        photo_url = await uploadPhoto(supabase, 'servants', photoFile);
      } catch {
        setError('تعذر رفع الصورة');
        setSaving(false);
        return;
      }
    }
    const phone = phoneLocal ? `${PHONE_PREFIX}${phoneLocal}` : '';

    // 0) code → login account + user_id + persons.national_id (service role)
    if (codeChanged) {
      const ok = confirm(
        `تأكيد تغيير الكود\n\nمن: ${currentCode}\nإلى: ${code.trim()}\n\nسيدخل الخادم بالكود الجديد من الآن.\n\nهل أنت متأكد؟`
      );
      if (!ok) { setSaving(false); return; }
      const r = await changeServantCode(servant.id, code.trim());
      if (!r.ok) { setError(servantAccountMessage(r.error)); setSaving(false); return; }
    }

    // 1) person data (mirrored to the enrollment by trigger)
    if (servant.person_id) {
      const { error: pe } = await supabase.from('persons').update({
        name: fullName.trim(),
        phone: phone || null,
        gender: gender || null,
        birthdate: birthdate || null,
        address: address.trim() || null,
        notes: notes.trim() || null,
        image_url: photo_url,
      }).eq('id', servant.person_id);
      if (pe) { setError('تعذر حفظ بيانات الشخص'); setSaving(false); return; }
    }

    // 2) the enrollment: role + scope (+ mirrors for safety)
    const { error: err } = await supabase
      .from(SERVANTS_TABLE)
      .update({
        full_name: fullName.trim(),
        phone,
        role,
        church_id: churchId || null,
        service_id: serviceId || null,
        class_id: classId || null,
        photo_url,
      })
      .eq('id', servant.id);

    if (err) {
      setError('تعذر الحفظ، تأكد من الصلاحيات');
      setSaving(false);
      return;
    }
    onSaved();
  };

  const lockCls = (locked: boolean) =>
    `input-field ${locked ? 'bg-primary-50 pointer-events-none opacity-80' : ''}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5 max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-extrabold">تعديل الخادم</h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {/* code (login name) — disabled + confirmed edit (0042) */}
          <div>
            <div className="flex gap-2">
              <input
                id="edit-servant-code"
                className={`input-field flex-1 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 ${codeChanged ? '!border-amber-300 !bg-amber-50 !text-amber-800' : ''}`}
                dir="ltr"
                value={code}
                disabled
                readOnly
                aria-label="الكود"
              />
              <button
                id="edit-servant-code-edit"
                type="button"
                onClick={startCodeEdit}
                disabled={saving}
                aria-label="تعديل الكود"
                title="تعديل الكود"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow transition hover:bg-amber-600 active:scale-95 disabled:opacity-60"
              >
                <Pencil className="h-5 w-5" />
              </button>
            </div>
            {codeChanged ? (
              <p className="mt-1 flex items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700">
                <span>سيتغير الكود من <span dir="ltr">{currentCode}</span> إلى <span dir="ltr">{code}</span> عند الحفظ</span>
                <button type="button" onClick={() => setCode(currentCode)} className="shrink-0 rounded-lg bg-white px-2 py-1 text-amber-700 hover:bg-amber-100">تراجع</button>
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-slate-400"><IdCard className="inline h-3 w-3" /> الكود = اسم الدخول — اضغط زر التعديل لتغييره (توليد أو مسح كود)</p>
            )}
          </div>
          <input className="input-field" placeholder="الاسم الكامل *" value={fullName}
            onChange={(e) => setFullName(e.target.value)} required />

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

          <div className="flex items-stretch overflow-hidden rounded-xl border border-indigo-100 bg-white focus-within:ring-2 focus-within:ring-primary-300" dir="ltr">
            <span className="flex items-center bg-indigo-50 px-3 text-sm font-extrabold text-primary-700">{PHONE_PREFIX}</span>
            <input type="tel" inputMode="numeric" className="w-full px-3 py-2.5 text-sm font-bold outline-none" placeholder="01xxxxxxxxx"
              value={phoneLocal} maxLength={PHONE_LOCAL_LENGTH}
              onChange={(e) => setPhoneLocal(e.target.value.replace(/\D/g, '').slice(0, PHONE_LOCAL_LENGTH))} />
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">تاريخ الميلاد</label>
            <input type="date" className="input-field" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} dir="ltr" />
          </div>
          <input className="input-field" placeholder="العنوان" value={address} onChange={(e) => setAddress(e.target.value)} />
          <textarea className="input-field min-h-[60px]" placeholder="ملاحظات" value={notes} onChange={(e) => setNotes(e.target.value)} />

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">الدور</label>
            <select className="input-field" value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
              {grantableRoles.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">الكنيسة</label>
            <select className={lockCls(churchLocked)} value={churchId}
              onChange={(e) => { setChurchId(e.target.value); setServiceId(''); setClassId(''); }}>
              <option value="">كل الكنائس (بدون تحديد)</option>
              {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">الخدمة</label>
            <select className={lockCls(serviceLocked)} value={serviceId}
              onChange={(e) => { setServiceId(e.target.value); setClassId(''); }}>
              <option value="">كل الخدمات (بدون تحديد)</option>
              {scopedServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-500">الفصل</label>
            <select className="input-field" value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">كل الفصول (بدون تحديد)</option>
              {scopedClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/50 px-4 py-3 text-sm font-bold text-emerald-600">
            <Upload className="h-4 w-4" />
            {photoFile ? photoFile.name : (person?.image_url ?? servant.photo_url) ? 'تغيير صورة الخادم' : 'إضافة صورة الخادم (اختياري)'}
            <input type="file" accept="image/*" className="hidden"
              onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} />
          </label>

          {/* 0042: reset the servant's login password */}
          <ResetPasswordSection
            idPrefix="edit-servant-pw"
            title="إعادة تعيين كلمة المرور"
            hint="كلمة دخول الخادم للتطبيق — تُغلق جلساته الحالية ويدخل بالجديدة"
            onReset={async (pw) => {
              const r = await resetServantPassword(servant.id, pw);
              return r.ok ? null : servantAccountMessage(r.error);
            }}
          />

          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}
          <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
            حفظ التعديلات
          </button>
        </form>
      </div>

      {codeModal && (
        <EditCodeModal
          personId={servant.person_id ?? servant.id}
          currentCode={currentCode}
          initialCode={code}
          codeKind="servant"
          scope={{ churchId: churchId || undefined, serviceId: serviceId || undefined, classId: classId || undefined }}
          onConfirm={(c) => { setCode(c); setCodeModal(false); }}
          onClose={() => setCodeModal(false)}
        />
      )}
    </div>
  );
}

// ---------- Permissions modal: connect the servant to permission profiles ----------
function PermissionsModal({
  servant, profiles, current, onClose, onSaved,
}: {
  servant: Servant;
  profiles: PermissionProfile[];
  current: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [selected, setSelected] = useState<string[]>(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const save = async () => {
    setError('');
    setSaving(true);
    const add = selected.filter((id) => !current.includes(id));
    const del = current.filter((id) => !selected.includes(id));
    if (add.length) {
      const { error: e1 } = await supabase.from('permissions').insert(add.map((pid) => ({ servant_id: servant.id, permission_profile_id: pid })));
      if (e1) { setError('تعذر منح الصلاحيات — تأكد من صلاحياتك'); setSaving(false); return; }
    }
    if (del.length) {
      const { error: e2 } = await supabase.from('permissions').delete().eq('servant_id', servant.id).in('permission_profile_id', del);
      if (e2) { setError('تعذر إزالة الصلاحيات'); setSaving(false); return; }
    }
    setSaving(false);
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-extrabold">
            <KeyRound className="h-5 w-5 text-violet-600" /> صلاحيات الخادم
          </h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-3 text-sm font-bold text-slate-500">{servant.full_name}</p>

        {profiles.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-3 py-6 text-center text-sm font-bold text-slate-400">
            لا توجد ملفات صلاحيات بعد — يصنعها المالك من وحدة المالك ← ملفات الصلاحيات
          </p>
        ) : (
          <ul className="space-y-2">
            {profiles.map((pp) => {
              const on = selected.includes(pp.id);
              return (
                <li key={pp.id}>
                  <button type="button" onClick={() => toggle(pp.id)} aria-pressed={on}
                    className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-right transition ${on ? 'border-transparent bg-violet-50 ring-2 ring-violet-300' : 'border-slate-100 bg-white hover:bg-slate-50'}`}>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white" style={{ backgroundColor: pp.color }}>
                      {on ? <Check className="h-5 w-5" /> : <KeyRound className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-extrabold">{pp.name}</span>
                      <span className="block truncate text-[11px] text-slate-400">
                        {pp.description || `${pp.permissions.length} صلاحية`}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}
        <button onClick={save} disabled={saving || profiles.length === 0} className="btn-primary mt-4 w-full flex items-center justify-center gap-2">
          {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
          حفظ الصلاحيات
        </button>
      </div>
    </div>
  );
}
