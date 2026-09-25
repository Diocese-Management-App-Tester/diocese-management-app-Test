'use client';

// ---------- ACCESS MODULE (التحكم في الدخول) ----------
// Tabs:
//   البوابة   → pick the access event, scan / search a person → مسموح / مرفوض
//               with name · photo · attendance · points · every rule's status
//   الإعداد   → events list (create · edit · enable/disable · delete) — open
//               one to manage its RULES (kinds, AND / OR groups, enable /
//               disable), its ALLOWED LIST (persons · class · service ·
//               church) and read its LOG; «عرض الإعداد الكامل» shows the
//               whole configuration at once.
// URL: /access?tab=door|admin[&event=<id>][&sub=rules|allowed|log]

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  DoorOpen, ScanLine, Settings2, Plus, Loader2, ArrowRight, Pencil, Trash2, Power, ListChecks, Users, History,
  Lock, Search, CheckCircle2, XCircle, Layers, Eye, ChevronLeft, Info,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { useNavLabel } from '@/lib/customization-context';
import { cachedLookup } from '@/lib/queries';
import { PersonAvatar } from '@/components/CallFeedback';
import type { Church, Service, ClassRoom, AppEvent } from '@/lib/types';
import {
  fetchAccessEvents, fetchAccessPermissions, fetchAccessConfig, fetchAccessLog, deleteAccessEvent, saveAccessEvent,
  setRuleEnabled, deleteAccessRule, rulesSummary, OP_LABELS, DENY_REASON_LABELS, MIGRATION_HINT,
  type AccessEvent, type AccessPermissions, type AccessConfig, type AccessRule, type AccessRuleGroup, type AccessLogRow, type RuleLookups,
} from '@/lib/access';
import { EventPicker, RuleTree, HintBox, fmtDateTime } from '@/components/access/AccessBits';
import CheckPanel from '@/components/access/CheckPanel';
import { EventFormModal, RuleFormModal, GroupFormModal, type ScopeLookups } from '@/components/access/AccessForms';
import AllowedPanel from '@/components/access/AllowedPanel';

type Tab = 'door' | 'admin';
type Sub = 'rules' | 'allowed' | 'log' | 'all';

export default function AccessPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>}>
        <AccessModule />
      </Suspense>
    </AppShell>
  );
}

function AccessModule() {
  const pageName = useNavLabel('access');
  const { profile } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [supabase] = useState(() => createClient());

  const tab: Tab = params.get('tab') === 'admin' ? 'admin' : 'door';
  const eventId = params.get('event') ?? '';
  const sub: Sub = (['rules', 'allowed', 'log', 'all'].includes(params.get('sub') ?? '') ? params.get('sub') : 'rules') as Sub;
  const go = (t: Tab, ev?: string, s?: Sub) => {
    const q = new URLSearchParams();
    if (t === 'admin') q.set('tab', 'admin');
    if (ev) q.set('event', ev);
    if (s && s !== 'rules') q.set('sub', s);
    const str = q.toString();
    router.replace(str ? `/access?${str}` : '/access');
  };

  // ---------- data ----------
  const [perms, setPerms] = useState<AccessPermissions>({ check: false, manage: false });
  const [events, setEvents] = useState<AccessEvent[]>([]);
  const [scope, setScope] = useState<ScopeLookups>({ churches: [], services: [], classes: [] });
  const [lookups, setLookups] = useState<RuleLookups>({});
  const [loading, setLoading] = useState(true);
  const [dbMissing, setDbMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, evs] = await Promise.all([fetchAccessPermissions(supabase), fetchAccessEvents(supabase)]);
      setPerms(p);
      setEvents(evs);
      setDbMissing(false);
    } catch {
      setDbMissing(true);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { if (profile?.status === 'approved') load(); }, [profile?.status, load]);
  useDebouncedRealtime(supabase, 'access-module', [{ table: 'access_events' }], load, { enabled: profile?.status === 'approved', delayMs: 600 });

  // lookups (scope + rule references) — best effort, each optional
  useEffect(() => {
    if (profile?.status !== 'approved') return;
    (async () => {
      const [churches, services, classes, appEvents] = await Promise.all([
        cachedLookup<Church>(supabase, 'churches'),
        cachedLookup<Service>(supabase, 'services'),
        cachedLookup<ClassRoom>(supabase, 'classes'),
        cachedLookup<AppEvent>(supabase, 'events'),
      ]);
      setScope({ churches, services, classes });
      const safe = async (table: string, cols: string) => {
        try { const { data } = await supabase.from(table).select(cols).limit(300); return (data ?? []) as unknown as { id: string; name?: string; title?: string }[]; } catch { return []; }
      };
      const [exams, achievements, occasions] = await Promise.all([safe('exams', 'id, title'), safe('achievements', 'id, name'), safe('occasions', 'id, title')]);
      setLookups({ churches, services, classes, events: appEvents, exams, achievements, occasions });
    })();
  }, [supabase, profile?.status]);

  const scopeLabel = useCallback((e: AccessEvent) => {
    const c = scope.churches.find((x) => x.id === e.church_id)?.name;
    const s = e.service_id ? scope.services.find((x) => x.id === e.service_id)?.name : null;
    const k = e.class_id ? scope.classes.find((x) => x.id === e.class_id)?.name : null;
    return [scope.churches.length > 1 ? c : null, s ?? 'كل الخدمات', k].filter(Boolean).join(' ← ');
  }, [scope]);

  const selected = events.find((e) => e.id === eventId) ?? null;

  // ---------- admin state ----------
  const [form, setForm] = useState<{ open: boolean; item: AccessEvent | null }>({ open: false, item: null });
  const [deleteFor, setDeleteFor] = useState<AccessEvent | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState('');

  const onEventSaved = (e: AccessEvent) => {
    setEvents((prev) => {
      const i = prev.findIndex((x) => x.id === e.id);
      return i >= 0 ? prev.map((x) => (x.id === e.id ? e : x)) : [...prev, e];
    });
    setForm({ open: false, item: null });
    if (!eventId) go('admin', e.id);
  };
  const toggleActive = async (e: AccessEvent) => {
    const saved = await saveAccessEvent(supabase, {
      church_id: e.church_id, service_id: e.service_id, class_id: e.class_id, name: e.name, description: e.description,
      is_active: !e.is_active, allow_all: e.allow_all, root_op: e.root_op, starts_at: e.starts_at, ends_at: e.ends_at,
    }, e.id);
    setEvents((prev) => prev.map((x) => (x.id === e.id ? saved : x)));
  };
  const doDelete = async () => {
    if (!deleteFor) return;
    setDeleting(true);
    try {
      await deleteAccessEvent(supabase, deleteFor.id);
      setEvents((prev) => prev.filter((x) => x.id !== deleteFor.id));
      if (eventId === deleteFor.id) go('admin');
    } finally { setDeleting(false); setDeleteFor(null); }
  };

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? events.filter((e) => e.name.toLowerCase().includes(q) || (e.description ?? '').toLowerCase().includes(q)) : events;
  }, [events, search]);

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>;

  return (
    <>
      <section className="mb-4 flex items-center gap-2">
        <Link href="/settings" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100"><ArrowRight className="h-5 w-5" /></Link>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-lg font-extrabold"><DoorOpen className="h-5 w-5 text-emerald-700" /> {pageName}</h2>
          <p className="mt-0.5 text-xs text-slate-500">امسح الكود أو ابحث عن الشخص عند البوابة — مسموح أو مرفوض حسب القواعد وقائمة المسموح لهم</p>
        </div>
      </section>

      {dbMissing && <p className="mb-4 rounded-2xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">{MIGRATION_HINT}</p>}

      {/* tabs */}
      <div id="access-tabs" className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-emerald-50 p-1">
        {([{ key: 'door' as Tab, label: 'البوابة', icon: ScanLine }, { key: 'admin' as Tab, label: 'الإعداد', icon: Settings2 }]).map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button key={t.key} id={`access-tab-${t.key}`} onClick={() => go(t.key, eventId || undefined)} aria-pressed={active}
              className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-sm font-extrabold transition ${active ? 'bg-white text-emerald-700 shadow' : 'text-slate-500'}`}>
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {/* ================= DOOR ================= */}
      {tab === 'door' && (
        !perms.check ? (
          <div className="card py-10 text-center"><Lock className="mx-auto mb-2 h-10 w-10 text-slate-300" /><p className="font-bold text-slate-500">التحقق يحتاج صلاحية «التحقق عند البوابة»</p></div>
        ) : events.length === 0 ? (
          <div className="card py-10 text-center">
            <DoorOpen className="mx-auto mb-2 h-10 w-10 text-slate-300" />
            <p className="font-bold text-slate-500">لا توجد بوابات دخول في نطاقك</p>
            {perms.manage && (
              <button type="button" onClick={() => { go('admin'); setForm({ open: true, item: null }); }} className="btn-primary mt-4 inline-flex items-center gap-1.5 !py-2 !px-4 text-sm"><Plus className="h-4 w-4" /> أنشئ أول بوابة</button>
            )}
          </div>
        ) : (
          <>
            <label className="mb-1 block text-xs font-bold text-slate-500">بوابة الدخول</label>
            <div className="mb-3 flex gap-2">
              <div className="flex-1"><EventPicker events={events} value={eventId} onChange={(id) => go('door', id || undefined)} scopeLabel={scopeLabel} /></div>
              {perms.manage && selected && (
                <button type="button" onClick={() => go('admin', selected.id)} className="btn-secondary flex items-center gap-1 !px-3 text-xs" title="إعداد هذه البوابة"><Settings2 className="h-4 w-4" /></button>
              )}
            </div>
            {selected ? (
              <>
                {!selected.is_active && <p className="mb-3 rounded-2xl bg-red-50 px-3 py-2 text-xs font-extrabold text-red-600">هذه البوابة متوقفة — كل عملية تحقق ستُرفض</p>}
                <CheckPanel key={selected.id} event={selected} lookups={lookups} />
              </>
            ) : (
              <div className="card py-10 text-center"><Info className="mx-auto mb-2 h-8 w-8 text-emerald-300" /><p className="text-sm font-bold text-slate-500">اختر بوابة الدخول ثم امسح كود الشخص أو ابحث عنه</p></div>
            )}
          </>
        )
      )}

      {/* ================= ADMIN ================= */}
      {tab === 'admin' && (
        !perms.manage ? (
          <div className="card py-10 text-center"><Lock className="mx-auto mb-2 h-10 w-10 text-slate-300" /><p className="font-bold text-slate-500">إعداد بوابات الدخول يحتاج صلاحية «إدارة بوابات الدخول»</p></div>
        ) : selected ? (
          <EventAdmin
            key={selected.id}
            event={selected}
            sub={sub}
            onSub={(s) => go('admin', selected.id, s)}
            onBack={() => go('admin')}
            onEdit={() => setForm({ open: true, item: selected })}
            scope={scope}
            lookups={lookups}
            scopeLabel={scopeLabel(selected)}
            canManage={perms.manage}
          />
        ) : (
          <>
            <div className="mb-3 flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input id="access-events-search" className="input-field pr-9" placeholder="ابحث باسم البوابة…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <button id="access-event-new" type="button" onClick={() => setForm({ open: true, item: null })} className="btn-primary flex items-center gap-1.5 !px-4"><Plus className="h-4 w-4" /> بوابة</button>
            </div>
            {filteredEvents.length === 0 ? (
              <div className="card py-10 text-center"><DoorOpen className="mx-auto mb-2 h-10 w-10 text-slate-300" /><p className="font-bold text-slate-500">{events.length === 0 ? 'لا توجد بوابات دخول بعد' : 'لا نتائج'}</p></div>
            ) : (
              <ul id="access-events-list" className="space-y-2.5">
                {filteredEvents.map((e) => (
                  <li key={e.id} id={`access-event-${e.id}`} className={`card !py-3 !border-2 ${e.is_active ? '!border-emerald-100' : '!border-slate-200 opacity-80'}`}>
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={() => go('admin', e.id)} className="flex min-w-0 flex-1 items-center gap-3 text-right">
                        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm ${e.is_active ? 'bg-gradient-to-br from-emerald-600 to-teal-500' : 'bg-slate-400'}`}><DoorOpen className="h-5 w-5" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-extrabold">{e.name}</span>
                          <span className="mt-0.5 block truncate text-[11px] font-bold text-slate-400">
                            {scopeLabel(e)} · {e.is_active ? 'تعمل' : 'متوقفة'} · {e.allow_all ? 'مفتوحة للجميع' : 'بقائمة مسموح لهم'} · {OP_LABELS[e.root_op]}
                          </span>
                        </span>
                        <ChevronLeft className="h-4 w-4 text-slate-300" />
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        <button type="button" onClick={() => toggleActive(e)} aria-label={e.is_active ? 'إيقاف' : 'تشغيل'} title={e.is_active ? 'إيقاف البوابة' : 'تشغيل البوابة'}
                          className={`rounded-xl p-2 transition active:scale-95 ${e.is_active ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}><Power className="h-4 w-4" /></button>
                        <button type="button" onClick={() => setForm({ open: true, item: e })} aria-label="تعديل" className="rounded-xl bg-amber-50 p-2 text-amber-600 transition hover:bg-amber-100 active:scale-95"><Pencil className="h-4 w-4" /></button>
                        <button type="button" onClick={() => setDeleteFor(e)} aria-label="حذف" className="rounded-xl bg-red-50 p-2 text-red-500 transition hover:bg-red-100 active:scale-95"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )
      )}

      {/* ---------- modals ---------- */}
      {form.open && <EventFormModal item={form.item} lookups={scope} onSaved={onEventSaved} onClose={() => setForm({ open: false, item: null })} />}
      {deleteFor && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => setDeleteFor(null)}>
          <div className="w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-sm sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 flex items-center gap-2 text-lg font-extrabold text-red-600"><Trash2 className="h-5 w-5" /> حذف بوابة الدخول</h3>
            <p className="mb-4 text-sm font-bold text-slate-600">حذف «{deleteFor.name}» يحذف قواعدها وقائمة المسموح لهم وسجل الدخول الخاص بها.</p>
            <div className="grid grid-cols-2 gap-2">
              <button id="access-event-delete-confirm" type="button" onClick={doDelete} disabled={deleting} className="flex items-center justify-center gap-1.5 rounded-xl bg-red-500 py-2.5 font-extrabold text-white shadow active:scale-95 disabled:opacity-50">
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} حذف
              </button>
              <button type="button" onClick={() => setDeleteFor(null)} className="btn-secondary">إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// =====================================================================
// EventAdmin — one event's rules · allowed · log · full config
// =====================================================================
function EventAdmin({
  event, sub, onSub, onBack, onEdit, scope, lookups, scopeLabel, canManage,
}: {
  event: AccessEvent; sub: Sub; onSub: (s: Sub) => void; onBack: () => void; onEdit: () => void;
  scope: ScopeLookups; lookups: RuleLookups; scopeLabel: string; canManage: boolean;
}) {
  const [supabase] = useState(() => createClient());
  const [cfg, setCfg] = useState<AccessConfig>({ rules: [], groups: [], allowed: [] });
  const [log, setLog] = useState<AccessLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [ruleForm, setRuleForm] = useState<{ open: boolean; rule: AccessRule | null; groupId: string | null }>({ open: false, rule: null, groupId: null });
  const [groupForm, setGroupForm] = useState<{ open: boolean; group: AccessRuleGroup | null; parentId: string | null }>({ open: false, group: null, parentId: null });
  const [busyRule, setBusyRule] = useState<string | null>(null);
  const [confirmRule, setConfirmRule] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, l] = await Promise.all([fetchAccessConfig(supabase, event.id), fetchAccessLog(supabase, event.id, 100)]);
      setCfg(c); setLog(l);
    } finally { setLoading(false); }
  }, [supabase, event.id]);
  useEffect(() => { load(); }, [load]);
  useDebouncedRealtime(supabase, `access-event-${event.id}`, [
    { table: 'access_rules', filter: `event_id=eq.${event.id}` },
    { table: 'access_rule_groups', filter: `event_id=eq.${event.id}` },
    { table: 'access_allowed', filter: `event_id=eq.${event.id}` },
    { table: 'access_log', filter: `event_id=eq.${event.id}` },
  ], load, { delayMs: 800 });

  const toggleRule = async (r: AccessRule) => {
    setBusyRule(r.id);
    try { await setRuleEnabled(supabase, r.id, !r.enabled); setCfg((c) => ({ ...c, rules: c.rules.map((x) => (x.id === r.id ? { ...x, enabled: !r.enabled } : x)) })); }
    finally { setBusyRule(null); }
  };
  const removeRule = async (id: string) => {
    setBusyRule(id);
    try { await deleteAccessRule(supabase, id); setCfg((c) => ({ ...c, rules: c.rules.filter((x) => x.id !== id) })); }
    finally { setBusyRule(null); setConfirmRule(null); }
  };

  const ruleActions = (r: { id: string; enabled: boolean }) => {
    const full = cfg.rules.find((x) => x.id === r.id);
    if (!full || !canManage) return null;
    const busy = busyRule === r.id;
    return (
      <>
        <button type="button" onClick={() => toggleRule(full)} disabled={busy} aria-label={full.enabled ? 'إيقاف القاعدة' : 'تفعيل القاعدة'} title={full.enabled ? 'إيقاف' : 'تفعيل'}
          className={`rounded-lg p-1.5 ${full.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
        </button>
        <button type="button" onClick={() => setRuleForm({ open: true, rule: full, groupId: full.group_id })} aria-label="تعديل القاعدة" className="rounded-lg bg-amber-50 p-1.5 text-amber-600"><Pencil className="h-3.5 w-3.5" /></button>
        {confirmRule === r.id ? (
          <button type="button" onClick={() => removeRule(r.id)} disabled={busy} className="rounded-lg bg-red-500 px-2 py-1 text-[10px] font-extrabold text-white">تأكيد</button>
        ) : (
          <button type="button" onClick={() => setConfirmRule(r.id)} aria-label="حذف القاعدة" className="rounded-lg bg-red-50 p-1.5 text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
        )}
      </>
    );
  };
  const groupActions = (g: { id: string }) => {
    const full = cfg.groups.find((x) => x.id === g.id);
    if (!full || !canManage) return null;
    return <button type="button" onClick={() => setGroupForm({ open: true, group: full, parentId: full.parent_id })} aria-label="تعديل المجموعة" className="rounded-lg bg-white p-1.5 text-indigo-600 ring-1 ring-indigo-200"><Pencil className="h-3.5 w-3.5" /></button>;
  };

  const subs: { key: Sub; label: string; icon: typeof ListChecks; count?: number }[] = [
    { key: 'rules', label: 'القواعد', icon: ListChecks, count: cfg.rules.length },
    { key: 'allowed', label: 'المسموح لهم', icon: Users, count: cfg.allowed.length },
    { key: 'log', label: 'السجل', icon: History, count: log.length },
    { key: 'all', label: 'الإعداد الكامل', icon: Eye },
  ];

  return (
    <>
      {/* header */}
      <div className="card mb-3 !border-2 !border-emerald-100 !py-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} aria-label="رجوع للقائمة" className="rounded-full p-1.5 hover:bg-slate-100"><ArrowRight className="h-5 w-5" /></button>
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm ${event.is_active ? 'bg-gradient-to-br from-emerald-600 to-teal-500' : 'bg-slate-400'}`}><DoorOpen className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-extrabold">{event.name}</p>
            <p className="truncate text-[11px] font-bold text-slate-400">{scopeLabel} · {event.is_active ? 'تعمل' : 'متوقفة'} · {event.allow_all ? 'مفتوحة للجميع' : 'بقائمة مسموح لهم'} · {OP_LABELS[event.root_op]}</p>
          </div>
          <Link href={`/access?event=${event.id}`} className="btn-secondary flex items-center gap-1 !px-3 !py-2 text-xs" title="اذهب للبوابة"><ScanLine className="h-4 w-4" /></Link>
          {canManage && <button type="button" onClick={onEdit} aria-label="تعديل البوابة" className="rounded-xl bg-amber-50 p-2 text-amber-600 hover:bg-amber-100"><Pencil className="h-4 w-4" /></button>}
        </div>
        {event.description && <p className="mt-2 text-xs font-bold text-slate-500">{event.description}</p>}
      </div>

      {/* sub tabs */}
      <div className="mb-3 grid grid-cols-4 gap-1 rounded-2xl bg-slate-100 p-1">
        {subs.map((s) => {
          const Icon = s.icon;
          const active = sub === s.key;
          return (
            <button key={s.key} id={`access-sub-${s.key}`} type="button" onClick={() => onSub(s.key)} aria-pressed={active}
              className={`flex flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] font-extrabold transition ${active ? 'bg-white text-primary-700 shadow' : 'text-slate-500'}`}>
              <Icon className="h-4 w-4" />
              <span>{s.label}{s.count !== undefined ? ` (${s.count})` : ''}</span>
            </button>
          );
        })}
      </div>

      {loading ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary-500" /></div> : (
        <>
          {(sub === 'rules' || sub === 'all') && (
            <section id="access-rules-section" className="card mb-3 !p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-sm font-extrabold"><ListChecks className="h-4 w-4 text-primary-600" /> القواعد <span className="text-xs font-bold text-slate-400">— {rulesSummary(cfg.rules)}</span>
                  <HintBox title="القواعد">
                كل قاعدة شرط واحد. المستوى الأعلى يربط القواعد والمجموعات بـ <b>{event.root_op === 'and' ? 'و' : 'أو'}</b> (يُغيَّر من تعديل البوابة).
                أضف <b>مجموعة</b> لربط عدة شروط بـ «أو» داخل «و» أو العكس — والمجموعات تتداخل. القاعدة المتوقفة تُهمل.
                  </HintBox>
                </h3>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold text-slate-600">المستوى الأعلى: {OP_LABELS[event.root_op]}</span>
              </div>
              <div className="mt-3">
                <RuleTree
                  rules={cfg.rules} groups={cfg.groups} rootOp={event.root_op} lookups={lookups} showStatus={false} idPrefix="cfg"
                  renderRuleActions={ruleActions} renderGroupActions={groupActions}
                  onAddRule={canManage ? (gid) => setRuleForm({ open: true, rule: null, groupId: gid }) : undefined}
                  onAddGroup={canManage ? (pid) => setGroupForm({ open: true, group: null, parentId: pid }) : undefined}
                />
              </div>
            </section>
          )}

          {(sub === 'allowed' || sub === 'all') && (
            <section id="access-allowed-section" className="mb-3">
              {sub === 'all' && <h3 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold"><Users className="h-4 w-4 text-primary-600" /> المسموح لهم ({cfg.allowed.length})</h3>}
              <AllowedPanel event={event} allowed={cfg.allowed} scope={scope} lookups={lookups} canManage={canManage} onChanged={(next) => setCfg((c) => ({ ...c, allowed: next }))} />
            </section>
          )}

          {(sub === 'log' || sub === 'all') && (
            <section id="access-log-section" className="card !p-3">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold"><History className="h-4 w-4 text-primary-600" /> سجل الدخول <span className="text-xs font-bold text-slate-400">— آخر {log.length}</span></h3>
              {log.length === 0 ? <p className="py-4 text-center text-xs font-bold text-slate-400">لا توجد عمليات تحقق بعد</p> : (
                <ul className="space-y-1">
                  {log.map((l) => (
                    <li key={l.id} className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${l.granted ? 'bg-emerald-50' : 'bg-red-50'}`}>
                      {l.granted ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="h-4 w-4 shrink-0 text-red-500" />}
                      {l.person ? <PersonAvatar name={l.person.name} imageUrl={l.person.image_url} size={28} /> : null}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-extrabold">{l.person?.name ?? <span className="font-mono" dir="ltr">{l.code}</span>}</span>
                        <span className="block truncate text-[10px] font-bold text-slate-500">{fmtDateTime(l.created_at)}{!l.granted && l.reason ? ` · ${DENY_REASON_LABELS[l.reason]}` : ''}</span>
                      </span>
                      <span className={`text-[10px] font-extrabold ${l.granted ? 'text-emerald-700' : 'text-red-600'}`}>{l.granted ? 'دخل' : 'رُفض'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {sub === 'all' && (
            <div className="mt-3 rounded-2xl bg-indigo-50 px-3 py-2 text-[11px] font-bold text-indigo-700">
              <Layers className="mr-1 inline h-3.5 w-3.5" /> القرار النهائي = البوابة تعمل <b>و</b> الشخص ضمن المسموح لهم (أو البوابة مفتوحة للجميع) <b>و</b> شجرة القواعد تحققت.
            </div>
          )}
        </>
      )}

      {ruleForm.open && (
        <RuleFormModal event={event} rule={ruleForm.rule} groupId={ruleForm.groupId} lookups={lookups} scope={scope}
          onSaved={(r) => { setCfg((c) => { const i = c.rules.findIndex((x) => x.id === r.id); return { ...c, rules: i >= 0 ? c.rules.map((x) => (x.id === r.id ? r : x)) : [...c.rules, r] }; }); setRuleForm({ open: false, rule: null, groupId: null }); }}
          onClose={() => setRuleForm({ open: false, rule: null, groupId: null })} />
      )}
      {groupForm.open && (
        <GroupFormModal event={event} group={groupForm.group} parentId={groupForm.parentId}
          onSaved={(g) => { setCfg((c) => { const i = c.groups.findIndex((x) => x.id === g.id); return { ...c, groups: i >= 0 ? c.groups.map((x) => (x.id === g.id ? g : x)) : [...c.groups, g] }; }); setGroupForm({ open: false, group: null, parentId: null }); }}
          onDeleted={(id) => { load(); setGroupForm({ open: false, group: null, parentId: null }); void id; }}
          onClose={() => setGroupForm({ open: false, group: null, parentId: null })} />
      )}
    </>
  );
}
