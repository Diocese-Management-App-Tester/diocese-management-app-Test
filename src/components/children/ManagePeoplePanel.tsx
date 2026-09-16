'use client';

// ---------- إدارة المخدومين → المخدومين (migration 0043) ----------
// THE place where people are edited / deleted / stopped. The children page
// and the scanner only VIEW data now.
//
//   * المخدومين | الخدام switch — children (enrollments kind = child) and
//     servants (their mirror enrollments → managed through their ACCOUNT).
//   * Scope selectors (كنيسة → خدمة → فصل) + search, and «ترتيب حسب»
//     الكنيسة / الخدمة / الفصل — every group gets a sticky header with a
//     ⏸ إيقاف الكل / ▶ تفعيل الكل button for THAT scope.
//   * Per person: تعديل · إيقاف/تفعيل · حذف
//       child   → EditPersonModal / set_enrollments_status / DeletePersonModal
//       servant → EditServantModal / servant_enrollments.status / delete account
//   * «إيقاف نطاق كامل» card: stop / activate a whole church, service or
//     class — children, servants or both — RPC set_enrollments_status.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import {
  Loader2, Search, Pencil, Trash2, PauseCircle, PlayCircle, User, GraduationCap, Users,
  Ban, Church as ChurchIcon, Layers, School, IdCard, Phone, ShieldCheck, AlertTriangle, ChevronDown,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { fetchEnrollmentsPage, cachedLookup, ALL, type EnrollmentKind } from '@/lib/queries';
import { EditPersonModal, DeletePersonModal } from '@/components/PersonDataModals';
import { EditServantModal, canManageServant, type Servant } from '@/components/servants/ServantsPanel';
import ScopeOrganizer, { organize, type OrganizeBy, type OrganizeDir } from '@/components/ScopeOrganizer';
import {
  SERVANTS_TABLE, ROLE_LABELS,
  type EnrollmentWithPerson, type Church, type Service, type ClassRoom, type ServantEnrollment,
} from '@/lib/types';

type Kind = Exclude<EnrollmentKind, 'all'>;
type StatusFilter = 'all' | 'active' | 'stopped';

export default function ManagePeoplePanel() {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());

  const [kind, setKind] = useState<Kind>('child');
  const [rows, setRows] = useState<EnrollmentWithPerson[]>([]);
  const [servants, setServants] = useState<Map<string, ServantEnrollment>>(new Map());
  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  // scope + search
  const [churchFilter, setChurchFilter] = useState(ALL);
  const [serviceFilter, setServiceFilter] = useState(ALL);
  const [classFilter, setClassFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [searchQ, setSearchQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearchQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // organize
  const [orgBy, setOrgBy] = useState<OrganizeBy>('class');
  const [orgDir, setOrgDir] = useState<OrganizeDir>('asc');

  // modals
  const [editChild, setEditChild] = useState<EnrollmentWithPerson | null>(null);
  const [deleteChild, setDeleteChild] = useState<EnrollmentWithPerson | null>(null);
  const [editServant, setEditServant] = useState<Servant | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const isManager = !!profile && ['owner', 'church_manager', 'service_manager'].includes(profile.role);

  const loadLookups = useCallback(async (force = false) => {
    const [chs, svs, cls] = await Promise.all([
      cachedLookup<Church>(supabase, 'churches', { column: 'name' }, force),
      cachedLookup<Service>(supabase, 'services', { column: 'name' }, force),
      cachedLookup<ClassRoom>(supabase, 'classes', { column: 'name' }, force),
    ]);
    setChurches(chs); setServices(svs); setClasses(cls);
  }, [supabase]);

  const load = useCallback(async () => {
    try {
      const scope = { church: churchFilter, service: serviceFilter, class: classFilter };
      // up to 5 pages (1000 rows) — a management screen, still bounded
      const out: EnrollmentWithPerson[] = [];
      let page = 0; let more = false;
      do {
        const r = await fetchEnrollmentsPage(supabase, scope, { page, search: searchQ, kind, status: statusFilter });
        out.push(...r.rows); more = r.hasMore; page++;
      } while (more && page < 5);
      setRows(out);
      setHasMore(more);
      if (kind === 'servant') {
        const ids = Array.from(new Set(out.map((e) => e.servant_id).filter((x): x is string => !!x)));
        const map = new Map<string, ServantEnrollment>();
        for (let i = 0; i < ids.length; i += 100) {
          const { data } = await supabase.from(SERVANTS_TABLE).select('*').in('id', ids.slice(i, i + 100));
          ((data ?? []) as ServantEnrollment[]).forEach((s) => map.set(s.id, s));
        }
        setServants(map);
      }
    } catch (err) {
      console.error('manage people load failed', err);
    } finally {
      setLoading(false);
    }
  }, [supabase, churchFilter, serviceFilter, classFilter, searchQ, kind, statusFilter]);

  useEffect(() => { if (profile?.status === 'approved') loadLookups(); }, [profile?.status, loadLookups]);
  useEffect(() => {
    if (profile?.status !== 'approved') return;
    setLoading(true);
    load();
  }, [profile?.status, load]);
  useDebouncedRealtime(
    supabase, 'manage-people',
    [{ table: 'enrollments' }, { table: 'persons' }, { table: SERVANTS_TABLE }],
    load,
    { enabled: profile?.status === 'approved' }
  );

  const visibleServices = useMemo(() => services.filter((s) => churchFilter === ALL || s.church_id === churchFilter), [services, churchFilter]);
  const visibleClasses = useMemo(
    () => classes.filter((c) => (churchFilter === ALL || c.church_id === churchFilter) && (serviceFilter === ALL || c.service_id === serviceFilter)),
    [classes, churchFilter, serviceFilter]
  );

  const groups = useMemo(
    () => organize(rows, orgBy, orgDir, { churches, services, classes }, (e) => e.person.name),
    [rows, orgBy, orgDir, churches, services, classes]
  );

  const flash = (tone: 'ok' | 'err', text: string) => {
    setNotice({ tone, text });
    setTimeout(() => setNotice(null), 4000);
  };

  // ---------- per-row actions ----------
  const toggleChild = async (e: EnrollmentWithPerson) => {
    const next = e.status === 'stopped' ? 'active' : 'stopped';
    if (next === 'stopped' && !confirm(`إيقاف «${e.person.name}»؟\n\nلن يُسجَّل له حضور أو نقاط ولن يدخل بوابته حتى تعيد تفعيله. بياناته وسجلاته تبقى كما هي.`)) return;
    setBusy(e.id);
    const { error } = await supabase.rpc('set_enrollments_status', { p_status: next, p_enrollment_ids: [e.id] });
    setBusy(null);
    if (error) return flash('err', 'تعذر تغيير الحالة — تأكد من صلاحياتك وتحديث قاعدة البيانات (0043)');
    setRows((rs) => rs.map((r) => (r.id === e.id ? { ...r, status: next } : r)));
    flash('ok', next === 'stopped' ? `تم إيقاف ${e.person.name}` : `تم تفعيل ${e.person.name}`);
  };

  const servantOf = (e: EnrollmentWithPerson): Servant | null => {
    const s = e.servant_id ? servants.get(e.servant_id) : null;
    return s ? { ...s, person: e.person } : null;
  };

  const toggleServant = async (e: EnrollmentWithPerson) => {
    const s = servantOf(e);
    if (!s) return;
    const next = s.status === 'suspended' ? 'approved' : 'suspended';
    if (next === 'suspended' && !confirm(`إيقاف الخادم «${s.full_name}»؟\n\nلن يستطيع الدخول إلى التطبيق حتى تعيد تفعيله.`)) return;
    setBusy(e.id);
    const { error } = await supabase.from(SERVANTS_TABLE).update({ status: next }).eq('id', s.id);
    setBusy(null);
    if (error) return flash('err', 'تعذر تغيير حالة الخادم — تأكد من صلاحياتك');
    flash('ok', next === 'suspended' ? `تم إيقاف ${s.full_name}` : `تم تفعيل ${s.full_name}`);
    load();
  };

  const removeServant = async (e: EnrollmentWithPerson) => {
    const s = servantOf(e);
    if (!s) return;
    if (!confirm(`هل أنت متأكد من حذف الخادم «${s.full_name}» وحسابه؟ لا يمكن التراجع.`)) return;
    setBusy(e.id);
    const { error } = await supabase.from(SERVANTS_TABLE).delete().eq('id', s.id);
    setBusy(null);
    if (error) return flash('err', 'تعذر حذف الخادم — تأكد من صلاحياتك');
    flash('ok', `تم حذف ${s.full_name}`);
    load();
  };

  // ---------- group (scope) actions ----------
  const groupScope = (g: { rows: EnrollmentWithPerson[] }) => {
    const first = g.rows[0];
    if (!first) return null;
    return {
      p_church: first.church_id,
      p_service: orgBy === 'service' || orgBy === 'class' ? first.service_id : null,
      p_class: orgBy === 'class' ? first.class_id : null,
    };
  };

  const setGroupStatus = async (g: { key: string; title: string; rows: EnrollmentWithPerson[] }, status: 'active' | 'stopped') => {
    const sc = groupScope(g);
    if (!sc) return;
    const verb = status === 'stopped' ? 'إيقاف' : 'تفعيل';
    const who = kind === 'child' ? 'المخدومين' : 'الخدام';
    if (!confirm(`${verb} كل ${who} في «${g.title}» (${g.rows.length})؟`)) return;
    setBusy(`group:${g.key}`);
    const { data, error } = await supabase.rpc('set_enrollments_status', { p_status: status, ...sc, p_kind: kind });
    setBusy(null);
    if (error) return flash('err', 'تعذر تنفيذ العملية — تأكد من صلاحياتك على هذا النطاق');
    const r = (data ?? {}) as { children?: number; servants?: number };
    flash('ok', `تم ${verb} ${(r.children ?? 0) + (r.servants ?? 0)} — ${g.title}`);
    load();
  };

  const stoppedCount = rows.filter((r) => r.status === 'stopped').length;

  return (
    <>
      {/* kind switch */}
      <div id="people-kind-switch" role="tablist" className="mb-3 grid grid-cols-2 gap-0.5 rounded-xl bg-indigo-50 p-0.5">
        <button id="people-kind-child" role="tab" aria-selected={kind === 'child'} onClick={() => setKind('child')}
          className={`flex items-center justify-center gap-1 rounded-lg px-2.5 py-2 text-xs font-extrabold transition ${kind === 'child' ? 'bg-white text-primary-700 shadow' : 'text-slate-500'}`}>
          <GraduationCap className="h-3.5 w-3.5" /> المخدومين
        </button>
        <button id="people-kind-servant" role="tab" aria-selected={kind === 'servant'} onClick={() => setKind('servant')}
          className={`flex items-center justify-center gap-1 rounded-lg px-2.5 py-2 text-xs font-extrabold transition ${kind === 'servant' ? 'bg-white text-emerald-700 shadow' : 'text-slate-500'}`}>
          <Users className="h-3.5 w-3.5" /> الخدام
        </button>
      </div>

      {/* search + scope */}
      <div className="mb-3 space-y-2">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input id="people-search" className="input-field pr-9" placeholder="بحث بالاسم أو الهاتف أو الكود..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <ScopeSelect id="people-church" icon={<ChurchIcon className="h-3.5 w-3.5 text-gold-500" />} value={churchFilter}
            onChange={(v) => { setChurchFilter(v); setServiceFilter(ALL); setClassFilter(ALL); }} all="كل الكنائس" options={churches} />
          <ScopeSelect id="people-service" icon={<Layers className="h-3.5 w-3.5 text-accent-600" />} value={serviceFilter}
            onChange={(v) => { setServiceFilter(v); setClassFilter(ALL); }} all="كل الخدمات" options={visibleServices} />
          <ScopeSelect id="people-class" icon={<School className="h-3.5 w-3.5 text-sky-600" />} value={classFilter}
            onChange={setClassFilter} all="كل الفصول" options={visibleClasses} />
        </div>
        <div id="people-status-filter" role="group" aria-label="الحالة" className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
          {([['all', 'الكل'], ['active', 'يعمل'], ['stopped', 'موقوف']] as [StatusFilter, string][]).map(([v, l]) => (
            <button key={v} type="button" aria-pressed={statusFilter === v} onClick={() => setStatusFilter(v)}
              className={`h-8 rounded-lg text-[11px] font-extrabold transition ${statusFilter === v ? 'bg-white text-primary-700 shadow' : 'text-slate-500'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <ScopeOrganizer idPrefix="people-organize" by={orgBy} dir={orgDir} onBy={setOrgBy} onDir={setOrgDir} total={rows.length} />

      {/* bulk stop card */}
      <div className="card mb-3 !p-0 overflow-hidden">
        <button id="bulk-stop-toggle" type="button" onClick={() => setBulkOpen((o) => !o)} aria-expanded={bulkOpen}
          className="flex w-full items-center gap-2 px-4 py-3 text-right">
          <Ban className="h-4 w-4 text-red-500" />
          <span className="flex-1 text-sm font-extrabold text-slate-700">إيقاف / تفعيل نطاق كامل</span>
          {stoppedCount > 0 && <span className="badge bg-slate-200 text-slate-600">{stoppedCount} موقوف</span>}
          <ChevronDown className={`h-4 w-4 text-slate-400 transition ${bulkOpen ? 'rotate-180' : ''}`} />
        </button>
        {bulkOpen && (
          <BulkStopForm
            churches={churches} services={services} classes={classes}
            initial={{ church: churchFilter, service: serviceFilter, class: classFilter }}
            onDone={(msg, ok) => { flash(ok ? 'ok' : 'err', msg); if (ok) load(); }}
          />
        )}
      </div>

      {notice && (
        <p id="people-notice" className={`mb-3 rounded-xl px-3 py-2 text-xs font-bold ${notice.tone === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
          {notice.text}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>
      ) : rows.length === 0 ? (
        <div className="card py-12 text-center text-sm font-bold text-slate-400">
          {searchQ ? 'لا نتائج' : kind === 'child' ? 'لا يوجد مخدومون في هذا النطاق' : 'لا يوجد خدام بفصل محدد في هذا النطاق'}
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const groupStopped = g.rows.every((r) => r.status === 'stopped');
            const sc = groupScope(g);
            return (
              <section key={g.key} id={`people-group-${g.key}`}>
                {g.title && (
                  <h3 className={`sticky top-[71px] z-10 mb-2 flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-extrabold backdrop-blur ${
                    kind === 'child' ? 'bg-indigo-50/95 text-indigo-800' : 'bg-emerald-50/95 text-emerald-800'}`}>
                    <span className="min-w-0 flex-1 truncate">{g.title}</span>
                    <span className="badge bg-white text-slate-600">{g.rows.length}</span>
                    {sc && (kind === 'child' || isManager) && (
                      <button
                        id={`group-stop-${g.key}`}
                        type="button"
                        disabled={busy === `group:${g.key}`}
                        onClick={() => setGroupStatus(g, groupStopped ? 'active' : 'stopped')}
                        className={`flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-extrabold transition active:scale-95 disabled:opacity-60 ${
                          groupStopped ? 'bg-emerald-500 text-white' : 'bg-white text-red-600 hover:bg-red-50'}`}
                        title={groupStopped ? 'تفعيل الكل في هذا النطاق' : 'إيقاف الكل في هذا النطاق'}
                      >
                        {busy === `group:${g.key}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : groupStopped ? <PlayCircle className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}
                        {groupStopped ? 'تفعيل الكل' : 'إيقاف الكل'}
                      </button>
                    )}
                  </h3>
                )}
                <ul className="space-y-2">
                  {g.rows.map((e) => {
                    const stopped = e.status === 'stopped';
                    const srv = kind === 'servant' ? servantOf(e) : null;
                    const canServant = !!srv && canManageServant(profile, srv);
                    const rowBusy = busy === e.id;
                    return (
                      <li key={e.id} id={`person-row-${e.id}`} className={`card !p-3 ${stopped ? 'bg-slate-100/80' : ''}`}>
                        <div className="flex items-center gap-3">
                          <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-50 ring-2 ring-primary-100">
                            {e.person.image_url ? (
                              <Image src={e.person.image_url} alt={e.person.name} fill sizes="48px" className={`object-cover ${stopped ? 'grayscale' : ''}`} />
                            ) : (
                              <User className="h-6 w-6 text-primary-300" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className={`truncate font-extrabold ${stopped ? 'text-slate-400 line-through decoration-slate-300' : ''}`}>{e.person.name}</p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
                              {stopped && <span className="badge bg-slate-200 text-slate-600"><Ban className="h-3 w-3" /> موقوف</span>}
                              {srv && <span className="badge bg-primary-100 text-primary-700"><ShieldCheck className="h-3 w-3" /> {ROLE_LABELS[srv.role]}</span>}
                              <span className="flex items-center gap-1" dir="ltr"><IdCard className="h-3 w-3" /> {e.person.national_id}</span>
                              {e.person.phone && <span className="flex items-center gap-1" dir="ltr"><Phone className="h-3 w-3" /> {e.person.phone}</span>}
                            </p>
                            {orgBy !== 'class' && (
                              <p className="mt-0.5 truncate text-[11px] text-slate-500">
                                {[churches.find((c) => c.id === e.church_id)?.name, services.find((s) => s.id === e.service_id)?.name, classes.find((c) => c.id === e.class_id)?.name]
                                  .filter(Boolean).join(' ← ')}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* actions */}
                        {kind === 'child' ? (
                          <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-slate-100 pt-2.5">
                            <ActionBtn id={`edit-${e.id}`} tone="primary" icon={<Pencil className="h-3.5 w-3.5" />} label="تعديل" onClick={() => setEditChild(e)} disabled={rowBusy} />
                            <ActionBtn id={`stop-${e.id}`} tone={stopped ? 'emerald' : 'amber'} busy={rowBusy}
                              icon={stopped ? <PlayCircle className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}
                              label={stopped ? 'تفعيل' : 'إيقاف'} onClick={() => toggleChild(e)} />
                            <ActionBtn id={`delete-${e.id}`} tone="red" icon={<Trash2 className="h-3.5 w-3.5" />} label="حذف" onClick={() => setDeleteChild(e)} disabled={rowBusy} />
                          </div>
                        ) : canServant ? (
                          <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-slate-100 pt-2.5">
                            <ActionBtn id={`edit-${e.id}`} tone="primary" icon={<Pencil className="h-3.5 w-3.5" />} label="تعديل" onClick={() => srv && setEditServant(srv)} disabled={rowBusy} />
                            <ActionBtn id={`stop-${e.id}`} tone={stopped ? 'emerald' : 'amber'} busy={rowBusy}
                              icon={stopped ? <PlayCircle className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}
                              label={stopped ? 'تفعيل' : 'إيقاف'} onClick={() => toggleServant(e)} />
                            <ActionBtn id={`delete-${e.id}`} tone="red" icon={<Trash2 className="h-3.5 w-3.5" />} label="حذف" onClick={() => removeServant(e)} disabled={rowBusy} />
                          </div>
                        ) : (
                          <p className="mt-2 text-[11px] font-bold text-slate-400">
                            {srv?.id === profile?.id ? 'هذا حسابك — عدّله من الإعدادات ← تعديل بياناتي' : 'خارج نطاق إدارتك'}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          {hasMore && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-center text-xs font-bold text-amber-700">
              تُعرض أول 1000 فقط — ضيّق النطاق أو ابحث بالاسم
            </p>
          )}
        </div>
      )}

      {editChild && (
        <EditPersonModal enrollment={editChild} onSaved={load} onClose={() => setEditChild(null)} />
      )}
      {deleteChild && (
        <DeletePersonModal enrollment={deleteChild} churches={churches} services={services} classes={classes}
          onDeleted={load} onClose={() => setDeleteChild(null)} />
      )}
      {editServant && profile && (
        <EditServantModal servant={editServant} approver={profile} churches={churches} services={services} classes={classes}
          onClose={() => setEditServant(null)} onSaved={() => { setEditServant(null); load(); }} />
      )}
    </>
  );
}

// ---------- bits ----------
function ScopeSelect({ id, icon, value, onChange, all, options }: {
  id: string; icon: React.ReactNode; value: string; onChange: (v: string) => void; all: string; options: { id: string; name: string }[];
}) {
  return (
    <label className="relative block">
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">{icon}</span>
      <select id={id} className="input-field appearance-none !pr-7 !text-xs" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value={ALL}>{all}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  );
}

const TONES = {
  primary: 'bg-primary-50 text-primary-600 hover:bg-primary-100',
  amber: 'bg-amber-50 text-amber-600 hover:bg-amber-100',
  emerald: 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100',
  red: 'bg-red-50 text-red-600 hover:bg-red-100',
};
function ActionBtn({ id, tone, icon, label, onClick, disabled, busy }: {
  id: string; tone: keyof typeof TONES; icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; busy?: boolean;
}) {
  return (
    <button id={id} type="button" onClick={onClick} disabled={disabled || busy}
      className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition disabled:opacity-60 ${TONES[tone]}`}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon} {label}
    </button>
  );
}

// ---------- «إيقاف / تفعيل نطاق كامل» ----------
function BulkStopForm({ churches, services, classes, initial, onDone }: {
  churches: Church[]; services: Service[]; classes: ClassRoom[];
  initial: { church: string; service: string; class: string };
  onDone: (msg: string, ok: boolean) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [church, setChurch] = useState(initial.church === ALL ? '' : initial.church);
  const [service, setService] = useState(initial.service === ALL ? '' : initial.service);
  const [cls, setCls] = useState(initial.class === ALL ? '' : initial.class);
  const [who, setWho] = useState<EnrollmentKind>('child');
  const [busy, setBusy] = useState<'stopped' | 'active' | null>(null);

  const scopedServices = services.filter((s) => !church || s.church_id === church);
  const scopedClasses = classes.filter((c) => (!church || c.church_id === church) && (!service || c.service_id === service));

  const level = cls ? 'الفصل' : service ? 'الخدمة' : church ? 'الكنيسة' : '';
  const whoLabel = who === 'child' ? 'المخدومين' : who === 'servant' ? 'الخدام' : 'المخدومين والخدام';
  const scopeName = cls ? classes.find((c) => c.id === cls)?.name : service ? services.find((s) => s.id === service)?.name : churches.find((c) => c.id === church)?.name;

  const run = async (status: 'stopped' | 'active') => {
    if (!church) return onDone('اختر الكنيسة أولاً', false);
    const verb = status === 'stopped' ? 'إيقاف' : 'تفعيل';
    if (!confirm(`${verb} كل ${whoLabel} في ${level} «${scopeName}»؟\n\n${status === 'stopped' ? 'لن يُسجَّل لهم حضور أو نقاط ولن يدخلوا حتى تعيد تفعيلهم.' : 'سيعودون للعمل فورًا.'}`)) return;
    setBusy(status);
    const { data, error } = await supabase.rpc('set_enrollments_status', {
      p_status: status, p_church: church, p_service: service || null, p_class: cls || null, p_kind: who,
    });
    setBusy(null);
    if (error) return onDone('تعذر تنفيذ العملية — تأكد من صلاحياتك على هذا النطاق وتحديث قاعدة البيانات (0043)', false);
    const r = (data ?? {}) as { children?: number; servants?: number };
    onDone(`تم ${verb}: ${r.children ?? 0} مخدوم · ${r.servants ?? 0} خادم — ${level} «${scopeName}»`, true);
  };

  return (
    <div className="space-y-2 border-t border-slate-100 px-4 py-3">
      <p className="flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        اختر المستوى: كنيسة كاملة، أو خدمة، أو فصل — ثم من يشمله الإيقاف. الموقوف يحتفظ ببياناته وسجلاته ويمكن تفعيله في أي وقت.
      </p>
      <div className="grid grid-cols-3 gap-2">
        <select id="bulk-church" className="input-field !text-xs" value={church} onChange={(e) => { setChurch(e.target.value); setService(''); setCls(''); }}>
          <option value="">الكنيسة *</option>
          {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select id="bulk-service" className="input-field !text-xs" value={service} disabled={!church} onChange={(e) => { setService(e.target.value); setCls(''); }}>
          <option value="">كل الخدمات</option>
          {scopedServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select id="bulk-class" className="input-field !text-xs" value={cls} disabled={!service} onChange={(e) => setCls(e.target.value)}>
          <option value="">كل الفصول</option>
          {scopedClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div id="bulk-who" role="group" aria-label="من يشمله" className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
        {([['child', 'المخدومين'], ['servant', 'الخدام'], ['all', 'الجميع']] as [EnrollmentKind, string][]).map(([v, l]) => (
          <button key={v} type="button" aria-pressed={who === v} onClick={() => setWho(v)}
            className={`h-8 rounded-lg text-[11px] font-extrabold transition ${who === v ? 'bg-white text-primary-700 shadow' : 'text-slate-500'}`}>
            {l}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button id="bulk-stop-run" type="button" disabled={!church || busy !== null} onClick={() => run('stopped')}
          className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-red-500 text-sm font-extrabold text-white shadow transition hover:bg-red-600 active:scale-95 disabled:opacity-50">
          {busy === 'stopped' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PauseCircle className="h-4 w-4" />}
          إيقاف {level || 'النطاق'}
        </button>
        <button id="bulk-activate-run" type="button" disabled={!church || busy !== null} onClick={() => run('active')}
          className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 text-sm font-extrabold text-white shadow transition hover:bg-emerald-600 active:scale-95 disabled:opacity-50">
          {busy === 'active' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
          تفعيل {level || 'النطاق'}
        </button>
      </div>
    </div>
  );
}
