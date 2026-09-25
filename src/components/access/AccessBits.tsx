'use client';

// ---------- Access module shared pieces (التحكم في الدخول) ----------
//   DecisionCard   — the big مسموح / مرفوض answer with the person header
//   RuleTree       — every rule with ✔ مستوفى / ✘ غير مستوفى, grouped by
//                    AND / OR groups (works for the check result AND for the
//                    admin config view — pass `statuses` only on the door)
//   HistoryList    — attendance history rows (event · day · time)
//   EventPicker    — select the access event (بوابة الدخول)
//   Small helpers  — fmtDateTime, RuleStatusPill

import { useMemo } from 'react';
import {
  CheckCircle2, XCircle, ShieldCheck, ShieldX, Hash, Star, CalendarCheck, Clock, DoorOpen, Ban, Power,
  ListChecks, Users, Layers, MinusCircle, ChevronDown,
} from 'lucide-react';
import { PersonAvatar } from '@/components/CallFeedback';
import InfoTip from '@/components/InfoTip';
import { GENDER_LABELS } from '@/lib/types';
import {
  describeActual, describeRule, ruleKindLabel, DENY_REASON_LABELS, OP_SHORT, OP_LABELS,
  type AccessCheckResult, type AccessEvent, type AccessRule, type AccessRuleGroup, type BoolOp,
  type CheckGroupStatus, type CheckRuleStatus, type RuleLookups,
} from '@/lib/access';

// ---------- format ----------
export const fmtDateTime = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
};
export const fmtDay = (ymd: string | null | undefined) => {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('ar-EG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(y, m - 1, d));
};
export const fmtTime = (iso: string | null | undefined) => {
  if (!iso) return '';
  return new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
};

// =====================================================================
// EventPicker
// =====================================================================
export function EventPicker({
  events, value, onChange, id = 'access-event', scopeLabel,
}: {
  events: AccessEvent[];
  value: string;
  onChange: (id: string) => void;
  id?: string;
  scopeLabel?: (e: AccessEvent) => string;
}) {
  return (
    <div className="relative">
      <select id={id} aria-label="بوابة الدخول" className="input-field appearance-none pl-9 text-sm font-bold" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">اختر بوابة الدخول *</option>
        {events.map((e) => (
          <option key={e.id} value={e.id}>
            {e.is_active ? '' : '⏸ '}{e.name}{scopeLabel ? ` — ${scopeLabel(e)}` : ''}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

// =====================================================================
// RuleStatusPill
// =====================================================================
export function RuleStatusPill({ fulfilled, enabled = true, size = 'sm' }: { fulfilled: boolean | null | undefined; enabled?: boolean; size?: 'sm' | 'md' }) {
  const cls = size === 'md' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[10px]';
  if (!enabled) {
    return <span className={`inline-flex items-center gap-1 rounded-full bg-slate-100 font-extrabold text-slate-500 ${cls}`}><Power className="h-3 w-3" /> متوقفة</span>;
  }
  if (fulfilled === null || fulfilled === undefined) {
    return <span className={`inline-flex items-center gap-1 rounded-full bg-slate-100 font-extrabold text-slate-500 ${cls}`}><MinusCircle className="h-3 w-3" /> —</span>;
  }
  return fulfilled ? (
    <span className={`inline-flex items-center gap-1 rounded-full bg-emerald-100 font-extrabold text-emerald-700 ${cls}`}><CheckCircle2 className="h-3 w-3" /> مستوفى</span>
  ) : (
    <span className={`inline-flex items-center gap-1 rounded-full bg-red-100 font-extrabold text-red-600 ${cls}`}><XCircle className="h-3 w-3" /> غير مستوفى</span>
  );
}

// =====================================================================
// RuleTree — renders rules + nested groups
// =====================================================================
type TreeRule = Pick<AccessRule, 'id' | 'group_id' | 'name' | 'kind' | 'params' | 'enabled' | 'sort_order'> & Partial<Pick<CheckRuleStatus, 'fulfilled' | 'actual' | 'error'>>;
type TreeGroup = Pick<AccessRuleGroup, 'id' | 'parent_id' | 'name' | 'op' | 'sort_order'> & Partial<Pick<CheckGroupStatus, 'ok' | 'empty'>>;

export function RuleTree({
  rules, groups, rootOp, lookups = {}, showStatus, renderRuleActions, renderGroupActions, onAddRule, onAddGroup, idPrefix = 'rt',
}: {
  rules: TreeRule[];
  groups: TreeGroup[];
  rootOp: BoolOp;
  lookups?: RuleLookups;
  /** door mode: show fulfilled / actual per rule and ok per group */
  showStatus: boolean;
  renderRuleActions?: (r: TreeRule) => React.ReactNode;
  renderGroupActions?: (g: TreeGroup) => React.ReactNode;
  onAddRule?: (groupId: string | null) => void;
  onAddGroup?: (parentId: string | null) => void;
  idPrefix?: string;
}) {
  const rulesByGroup = useMemo(() => {
    const m = new Map<string | null, TreeRule[]>();
    [...rules].sort((a, b) => a.sort_order - b.sort_order).forEach((r) => {
      const k = r.group_id ?? null;
      (m.get(k) ?? m.set(k, []).get(k)!).push(r);
    });
    return m;
  }, [rules]);
  const groupsByParent = useMemo(() => {
    const m = new Map<string | null, TreeGroup[]>();
    [...groups].sort((a, b) => a.sort_order - b.sort_order).forEach((g) => {
      const k = g.parent_id ?? null;
      (m.get(k) ?? m.set(k, []).get(k)!).push(g);
    });
    return m;
  }, [groups]);

  const renderLevel = (parent: string | null, op: BoolOp, depth: number): React.ReactNode => {
    const rs = rulesByGroup.get(parent) ?? [];
    const gs = groupsByParent.get(parent) ?? [];
    const items: React.ReactNode[] = [];
    rs.forEach((r) => items.push(<RuleRow key={r.id} rule={r} lookups={lookups} showStatus={showStatus} actions={renderRuleActions?.(r)} idPrefix={idPrefix} />));
    gs.forEach((g) => items.push(
      <div key={g.id} id={`${idPrefix}-group-${g.id}`} className={`rounded-2xl border-2 p-2.5 ${showStatus && g.empty === false ? (g.ok ? 'border-emerald-200 bg-emerald-50/40' : 'border-red-200 bg-red-50/40') : 'border-indigo-100 bg-indigo-50/40'}`}>
        <div className="mb-2 flex items-center gap-2">
          <Layers className="h-4 w-4 text-indigo-500" />
          <span className="min-w-0 flex-1 truncate text-xs font-extrabold text-indigo-800">
            {g.name || 'مجموعة'} <span className="font-bold text-indigo-500">— {OP_LABELS[g.op]}</span>
          </span>
          {showStatus && g.empty === false && (
            g.ok
              ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold text-emerald-700"><CheckCircle2 className="h-3 w-3" /> تحققت</span>
              : <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-extrabold text-red-600"><XCircle className="h-3 w-3" /> لم تتحقق</span>
          )}
          {renderGroupActions?.(g)}
        </div>
        {renderLevel(g.id, g.op, depth + 1)}
      </div>,
    ));

    return (
      <div className="space-y-2">
        {items.length === 0 && (
          <p className="rounded-xl bg-white/70 px-3 py-2 text-center text-[11px] font-bold text-slate-400">
            {parent === null ? 'لا توجد قواعد — الدخول يعتمد على قائمة المسموح لهم فقط' : 'مجموعة فارغة — لا تؤثر على القرار'}
          </p>
        )}
        {items.map((it, i) => (
          <div key={i}>
            {i > 0 && (
              <div className="my-1 flex items-center gap-2 px-2">
                <span className="h-px flex-1 bg-slate-200" />
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${op === 'and' ? 'bg-slate-200 text-slate-600' : 'bg-amber-100 text-amber-700'}`}>{OP_SHORT[op]}</span>
                <span className="h-px flex-1 bg-slate-200" />
              </div>
            )}
            {it}
          </div>
        ))}
        {(onAddRule || onAddGroup) && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {onAddRule && (
              <button type="button" id={`${idPrefix}-add-rule-${parent ?? 'root'}`} onClick={() => onAddRule(parent)} className="rounded-xl bg-white px-2.5 py-1.5 text-[11px] font-extrabold text-primary-700 ring-1 ring-primary-200 hover:bg-primary-50">
                + قاعدة
              </button>
            )}
            {onAddGroup && depth < 3 && (
              <button type="button" id={`${idPrefix}-add-group-${parent ?? 'root'}`} onClick={() => onAddGroup(parent)} className="rounded-xl bg-white px-2.5 py-1.5 text-[11px] font-extrabold text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50">
                + مجموعة (و / أو)
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return <div id={`${idPrefix}-root`}>{renderLevel(null, rootOp, 0)}</div>;
}

function RuleRow({ rule, lookups, showStatus, actions, idPrefix }: { rule: TreeRule; lookups: RuleLookups; showStatus: boolean; actions?: React.ReactNode; idPrefix: string }) {
  const tone = !rule.enabled ? 'border-slate-200 bg-slate-50 opacity-70'
    : !showStatus ? 'border-slate-200 bg-white'
    : rule.fulfilled ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50';
  return (
    <div id={`${idPrefix}-rule-${rule.id}`} className={`flex items-start gap-2.5 rounded-2xl border-2 px-3 py-2.5 ${tone}`}>
      <span className="mt-0.5 shrink-0">
        {!rule.enabled ? <Power className="h-5 w-5 text-slate-400" />
          : !showStatus ? <ListChecks className="h-5 w-5 text-slate-500" />
          : rule.fulfilled ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <XCircle className="h-5 w-5 text-red-500" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-extrabold text-sm">{rule.name}</span>
          <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">{ruleKindLabel(rule.kind)}</span>
          <RuleStatusPill fulfilled={rule.fulfilled} enabled={rule.enabled} />
        </div>
        <p className="mt-0.5 text-[11px] font-bold text-slate-600">{describeRule(rule, lookups)}</p>
        {showStatus && rule.enabled && (
          <p className={`mt-0.5 text-[11px] font-extrabold ${rule.fulfilled ? 'text-emerald-700' : 'text-red-600'}`}>
            الفعلي: {describeActual(rule, rule.actual)}{rule.error ? ` · خطأ: ${rule.error}` : ''}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}

// =====================================================================
// DecisionCard — the door answer
// =====================================================================
export function DecisionCard({ result, lookups = {}, onClose }: { result: AccessCheckResult; lookups?: RuleLookups; onClose?: () => void }) {
  const { person, summary } = result;
  const granted = result.granted;

  return (
    <section id="access-decision" className={`overflow-hidden rounded-3xl border-4 shadow-lg ${granted ? 'border-emerald-500 bg-emerald-50' : 'border-red-500 bg-red-50'}`} aria-live="polite">
      {/* verdict banner */}
      <div className={`flex items-center justify-between gap-3 px-4 py-3 text-white ${granted ? 'bg-gradient-to-l from-emerald-600 to-emerald-500' : 'bg-gradient-to-l from-red-600 to-red-500'}`}>
        <div className="flex items-center gap-2">
          {granted ? <ShieldCheck className="h-8 w-8" /> : <ShieldX className="h-8 w-8" />}
          <div>
            <p id="access-verdict" className="text-2xl font-black leading-tight">{granted ? 'مسموح بالدخول' : 'مرفوض'}</p>
            {!granted && result.reason && <p className="text-xs font-bold text-white/90">{DENY_REASON_LABELS[result.reason]}</p>}
            {granted && summary && summary.entered_today > 0 && <p className="text-xs font-bold text-white/90">دخل اليوم من قبل {summary.entered_today} مرة</p>}
          </div>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="rounded-xl bg-white/20 px-3 py-1.5 text-xs font-extrabold hover:bg-white/30">التالي</button>
        )}
      </div>

      <div className="space-y-3 p-3">
        {/* person */}
        {person ? (
          <div className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm">
            <PersonAvatar name={person.name} imageUrl={person.image_url} size={72} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-black">{person.name}</p>
              <p className="flex flex-wrap items-center gap-x-2 text-[11px] font-bold text-slate-500">
                <span className="inline-flex items-center gap-0.5 font-mono" dir="ltr"><Hash className="h-3 w-3" />{person.national_id}</span>
                {person.gender && <span>· {GENDER_LABELS[person.gender]}</span>}
                {person.birthdate && <span>· {fmtDay(person.birthdate)}</span>}
              </p>
              {result.enrollments.length > 0 && (
                <p className="mt-1 truncate text-[11px] font-bold text-slate-600">
                  {result.enrollments.filter((e) => e.in_scope).slice(0, 2).map((e) => [e.service_name, e.class_name].filter(Boolean).join(' ← ')).join(' · ') || result.enrollments[0] && [result.enrollments[0].service_name, result.enrollments[0].class_name].filter(Boolean).join(' ← ')}
                  {summary && !summary.in_scope && <span className="mr-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">خارج نطاق البوابة</span>}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm">
            <Ban className="h-10 w-10 text-red-400" />
            <div>
              <p className="font-extrabold">كود غير معروف</p>
              <p className="font-mono text-xs text-slate-500" dir="ltr">{result.code}</p>
            </div>
          </div>
        )}

        {/* summary chips */}
        {summary && (
          <div className="grid grid-cols-3 gap-2">
            <Stat icon={Star} label="النقاط" value={String(summary.points)} tone="amber" />
            <Stat icon={CalendarCheck} label="مرات الحضور" value={String(summary.attendance_count)} tone="sky" />
            <Stat icon={Clock} label="آخر حضور" value={summary.last_attended_on ? fmtDay(summary.last_attended_on) : '—'} tone="slate" small />
          </div>
        )}

        {/* allowed list */}
        {person && (
          <div className={`flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-extrabold ${result.allowed ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'}`}>
            <Users className="h-4 w-4 shrink-0" />
            {result.event.allow_all ? 'البوابة مفتوحة للجميع (بدون قائمة مسموح لهم)'
              : result.allowed ? `ضمن المسموح لهم (${result.allowed_by.map((a) => a.person_id ? 'بالاسم' : a.class_id ? 'عبر الفصل' : a.service_id ? 'عبر الخدمة' : 'عبر الكنيسة').filter((v, i, arr) => arr.indexOf(v) === i).join(' · ')})`
              : 'ليس ضمن المسموح لهم — يُرفض حتى لو تحققت كل القواعد'}
          </div>
        )}

        {/* rules */}
        {person && result.rules && (
          <div className="rounded-2xl bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="flex items-center gap-1.5 text-sm font-extrabold"><ListChecks className="h-4 w-4 text-primary-600" /> القواعد</h4>
              {!result.rules.empty && (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${result.rules.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                  {result.rules.ok ? 'كل الشروط تحققت' : 'الشروط لم تتحقق'} · {OP_LABELS[result.rules.root_op]}
                </span>
              )}
            </div>
            <RuleTree rules={result.rules.rules} groups={result.rules.groups} rootOp={result.rules.root_op} lookups={lookups} showStatus idPrefix="door" />
          </div>
        )}

        {/* history */}
        {person && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-white p-3 shadow-sm">
              <h4 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold"><CalendarCheck className="h-4 w-4 text-sky-600" /> سجل الحضور</h4>
              <HistoryList rows={result.history} />
            </div>
            <div className="rounded-2xl bg-white p-3 shadow-sm">
              <h4 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold"><DoorOpen className="h-4 w-4 text-emerald-600" /> مرات المرور من هذه البوابة</h4>
              {result.visits.length === 0 ? (
                <p className="py-2 text-center text-[11px] font-bold text-slate-400">أول مرة</p>
              ) : (
                <ul className="space-y-1">
                  {result.visits.map((v) => (
                    <li key={v.id} className="flex items-center gap-2 text-[11px] font-bold">
                      {v.granted ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <XCircle className="h-3.5 w-3.5 text-red-500" />}
                      <span className="flex-1 truncate text-slate-600">{fmtDateTime(v.created_at)}{v.checked_by_name ? ` · ${v.checked_by_name}` : ''}</span>
                      <span className={v.granted ? 'text-emerald-700' : 'text-red-600'}>{v.granted ? 'دخل' : 'رُفض'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ icon: Icon, label, value, tone, small }: { icon: typeof Star; label: string; value: string; tone: 'amber' | 'sky' | 'slate'; small?: boolean }) {
  const t = { amber: 'bg-amber-50 text-amber-700', sky: 'bg-sky-50 text-sky-700', slate: 'bg-slate-100 text-slate-700' }[tone];
  return (
    <div className={`rounded-2xl px-2 py-2 text-center ${t}`}>
      <Icon className="mx-auto h-4 w-4" />
      <p className={`${small ? 'text-xs' : 'text-xl'} font-black leading-tight`}>{value}</p>
      <p className="text-[10px] font-bold opacity-80">{label}</p>
    </div>
  );
}

export function HistoryList({ rows }: { rows: AccessCheckResult['history'] }) {
  if (rows.length === 0) return <p className="py-2 text-center text-[11px] font-bold text-slate-400">لا يوجد حضور مسجل</p>;
  return (
    <ul className="max-h-48 space-y-1 overflow-y-auto no-scrollbar">
      {rows.map((h) => (
        <li key={h.id} className="flex items-center gap-2 text-[11px] font-bold">
          <CalendarCheck className="h-3.5 w-3.5 shrink-0 text-sky-500" />
          <span className="min-w-0 flex-1 truncate text-slate-700">{h.event_name ?? 'حضور'}{h.class_name ? ` · ${h.class_name}` : ''}</span>
          <span className="shrink-0 text-slate-500">{fmtDay(h.attended_on)} {fmtTime(h.created_at)}</span>
        </li>
      ))}
    </ul>
  );
}

// =====================================================================
// Info hint box
// =====================================================================
export function HintBox({ children, title = 'توضيح' }: { children: React.ReactNode; title?: string }) {
  return <InfoTip title={title}>{children}</InfoTip>;
}
