'use client';

// ---------- إدارة الأفراد → bulk modals ----------
// BulkEnrollModal    — add the selected persons to one or more classes
//                      (ScopePicker, class required) → owner_bulk_enroll
// BulkUnenrollModal  — remove the selected persons from a church / service /
//                      class (nulls = everything under) → owner_bulk_unenroll
// BulkDeleteModal    — delete the selected persons completely (cascade)
//                      → owner_bulk_delete_persons (servant accounts skipped)

import { useMemo, useState } from 'react';
import { Loader2, Plus, Trash2, AlertTriangle, UserMinus, ShieldCheck, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { ModalFrame } from '@/components/PersonDataModals';
import ScopePicker from '@/components/ScopePicker';
import { bulkEnroll, bulkUnenroll, bulkDeletePersons, ownerPersonsError, type OwnerPersonRow } from '@/lib/owner-persons';
import type { Church, Service, ClassRoom, ScopeRef } from '@/lib/types';

interface Lookups { churches: Church[]; services: Service[]; classes: ClassRoom[] }

function SelectedSummary({ rows }: { rows: OwnerPersonRow[] }) {
  const shown = rows.slice(0, 6);
  return (
    <div className="mb-3 rounded-2xl bg-slate-50 px-3 py-2">
      <p className="flex items-center gap-1.5 text-xs font-extrabold text-slate-600">
        <Users className="h-4 w-4 text-primary-500" /> {rows.length} {rows.length === 1 ? 'شخص' : 'أشخاص'} محددون
      </p>
      <p className="mt-1 text-[11px] text-slate-500 truncate">
        {shown.map((r) => r.name).join('، ')}{rows.length > shown.length ? ` و${rows.length - shown.length} آخرين` : ''}
      </p>
    </div>
  );
}

// =====================================================================
// 1. Add to classes
// =====================================================================
export function BulkEnrollModal({ rows, lookups, onDone, onClose }: {
  rows: OwnerPersonRow[]; lookups: Lookups; onDone: (msg: string) => void; onClose: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const [scopes, setScopes] = useState<ScopeRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const single = rows.length === 1;

  // one person: hide classes he is already in
  const pickLookups = useMemo(() => {
    if (!single) return lookups;
    const inIds = new Set(rows[0].enrollments.map((e) => e.class_id));
    return { ...lookups, classes: lookups.classes.filter((c) => !inIds.has(c.id)) };
  }, [single, rows, lookups]);

  const run = async () => {
    if (scopes.length === 0) return;
    setBusy(true); setError('');
    try {
      const r = await bulkEnroll(supabase, rows.map((x) => x.id), scopes);
      onDone(`تمت إضافة ${r.added} ${r.added === 1 ? 'تسجيل' : 'تسجيلات'} (${r.persons} ${r.persons === 1 ? 'شخص' : 'أشخاص'} × ${r.scopes} ${r.scopes === 1 ? 'فصل' : 'فصول'})${r.skipped ? ` — ${r.skipped} كانت موجودة بالفعل` : ''}`);
      onClose();
    } catch (e) {
      setError(ownerPersonsError(e, 'تعذرت الإضافة'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalFrame title={single ? `إضافة «${rows[0].name}» إلى فصول` : 'إضافة المحددين إلى فصول'} icon={<Plus className="h-5 w-5 text-violet-600" />} onClose={onClose}>
      <SelectedSummary rows={rows} />
      <p className="mb-3 text-xs text-slate-400">
        يُسجَّل كل شخص في كل فصل مختار (كنيسة ← خدمة ← فصل) — لكل تسجيل حضوره ونقاطه. التسجيلات الموجودة بالفعل تُتخطى.
      </p>
      <ScopePicker
        idPrefix="op-bulk-enroll"
        title="الفصول"
        value={scopes}
        onChange={setScopes}
        lookups={pickLookups}
        depth="class"
        requireLeaf
        primaryLabel={null}
        emptyText="اختر الفصول التي تريد الإضافة إليها"
        addLabel="اختيار فصل"
      />
      {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}
      <button id="op-bulk-enroll-run" type="button" onClick={run} disabled={busy || scopes.length === 0}
        className="btn-primary mt-4 flex w-full items-center justify-center gap-2 disabled:opacity-60">
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
        إضافة {rows.length} إلى {scopes.length} {scopes.length === 1 ? 'فصل' : 'فصول'}
      </button>
      <button type="button" onClick={onClose} className="btn-secondary mt-2 w-full">إلغاء</button>
    </ModalFrame>
  );
}

// =====================================================================
// 2. Remove from a scope
// =====================================================================
export function BulkUnenrollModal({ rows, lookups, onDone, onClose }: {
  rows: OwnerPersonRow[]; lookups: Lookups; onDone: (msg: string) => void; onClose: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const [church, setChurch] = useState('');
  const [service, setService] = useState('');
  const [cls, setCls] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // only scopes where at least one selected person has a CHILD enrollment
  const childEnrollments = useMemo(() => rows.flatMap((r) => r.enrollments.filter((e) => e.kind === 'child')), [rows]);
  const churchIds = useMemo(() => new Set(childEnrollments.map((e) => e.church_id)), [childEnrollments]);
  const serviceIds = useMemo(() => new Set(childEnrollments.filter((e) => !church || e.church_id === church).map((e) => e.service_id)), [childEnrollments, church]);
  const classIds = useMemo(() => new Set(childEnrollments.filter((e) => (!church || e.church_id === church) && (!service || e.service_id === service)).map((e) => e.class_id)), [childEnrollments, church, service]);

  const churches = lookups.churches.filter((c) => churchIds.has(c.id));
  const services = lookups.services.filter((s) => s.church_id === church && serviceIds.has(s.id));
  const classes = lookups.classes.filter((c) => c.service_id === service && classIds.has(c.id));

  const affected = childEnrollments.filter((e) => e.church_id === church && (!service || e.service_id === service) && (!cls || e.class_id === cls)).length;
  const level = cls ? 'الفصل' : service ? 'الخدمة' : 'الكنيسة';
  const scopeName = cls ? lookups.classes.find((c) => c.id === cls)?.name : service ? lookups.services.find((s) => s.id === service)?.name : lookups.churches.find((c) => c.id === church)?.name;

  const run = async () => {
    if (!church) return;
    if (!confirm(`حذف ${affected} ${affected === 1 ? 'تسجيل' : 'تسجيلات'} من ${level} «${scopeName}»؟\n\nيُحذف معها الحضور والنقاط في هذا النطاق فقط. البيانات الشخصية وباقي التسجيلات تبقى.`)) return;
    setBusy(true); setError('');
    try {
      const r = await bulkUnenroll(supabase, rows.map((x) => x.id), { church_id: church, service_id: service || null, class_id: cls || null });
      onDone(`تم حذف ${r.removed} ${r.removed === 1 ? 'تسجيل' : 'تسجيلات'} من ${level} «${scopeName}»`);
      onClose();
    } catch (e) {
      setError(ownerPersonsError(e, 'تعذر الحذف من النطاق'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalFrame title="حذف المحددين من نطاق" icon={<UserMinus className="h-5 w-5 text-amber-600" />} onClose={onClose}>
      <SelectedSummary rows={rows} />
      {childEnrollments.length === 0 ? (
        <p className="rounded-xl bg-amber-50 px-3 py-3 text-sm font-bold text-amber-700">لا يوجد للمحددين أي تسجيل كمخدومين يمكن حذفه.</p>
      ) : (
        <>
          <p className="mb-3 text-xs text-slate-400">اختر المستوى: كنيسة كاملة، أو خدمة، أو فصل — تُحذف تسجيلات المحددين داخله فقط (صفوف الخدام تُدار من إدارة الخدام).</p>
          <div className="space-y-2">
            <select id="op-unenroll-church" className="input-field" value={church} onChange={(e) => { setChurch(e.target.value); setService(''); setCls(''); }}>
              <option value="">الكنيسة *</option>
              {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select id="op-unenroll-service" className="input-field" value={service} disabled={!church} onChange={(e) => { setService(e.target.value); setCls(''); }}>
              <option value="">كل الخدمات</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select id="op-unenroll-class" className="input-field" value={cls} disabled={!service} onChange={(e) => setCls(e.target.value)}>
              <option value="">كل الفصول</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {church && (
            <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              سيُحذف {affected} {affected === 1 ? 'تسجيل' : 'تسجيلات'} مع حضورها ونقاطها.
            </p>
          )}
          {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}
          <button id="op-unenroll-run" type="button" onClick={run} disabled={busy || !church || affected === 0}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-3 font-bold text-white shadow transition hover:bg-amber-600 disabled:opacity-60">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <UserMinus className="h-5 w-5" />}
            حذف من {level}
          </button>
        </>
      )}
      <button type="button" onClick={onClose} className="btn-secondary mt-2 w-full">إلغاء</button>
    </ModalFrame>
  );
}

// =====================================================================
// 3. Delete completely
// =====================================================================
export function BulkDeleteModal({ rows, onDone, onClose }: {
  rows: OwnerPersonRow[]; onDone: (msg: string) => void; onClose: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [typed, setTyped] = useState('');
  const servants = rows.filter((r) => r.servant);
  const deletable = rows.length - servants.length;
  const enrollCount = rows.filter((r) => !r.servant).reduce((s, r) => s + r.enrollments.length, 0);
  const needConfirmWord = deletable >= 5;
  const canRun = deletable > 0 && (!needConfirmWord || typed.trim() === 'حذف');

  const run = async () => {
    if (!canRun) return;
    if (!confirm(`⚠️ حذف نهائي!\n\nسيتم حذف ${deletable} ${deletable === 1 ? 'شخص' : 'أشخاص'} تمامًا من قاعدة البيانات مع ${enrollCount} ${enrollCount === 1 ? 'تسجيل' : 'تسجيلات'} وكل سجلات الحضور والنقاط.\n\nلا يمكن التراجع. هل أنت متأكد؟`)) return;
    setBusy(true); setError('');
    try {
      const r = await bulkDeletePersons(supabase, rows.map((x) => x.id));
      onDone(`تم حذف ${r.deleted} ${r.deleted === 1 ? 'شخص' : 'أشخاص'} نهائيًا${r.skipped_servants ? ` — ${r.skipped_servants} من الخدام تُركوا (يُحذفون من إدارة الخدام)` : ''}`);
      onClose();
    } catch (e) {
      setError(ownerPersonsError(e, 'تعذر الحذف النهائي'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalFrame title="حذف نهائي للمحددين" icon={<Trash2 className="h-5 w-5 text-red-600" />} onClose={onClose}>
      <SelectedSummary rows={rows} />
      <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-4 text-sm">
        <p className="flex items-center gap-2 font-extrabold text-red-700"><AlertTriangle className="h-5 w-5" /> حذف متسلسل (Cascade)</p>
        <p className="mt-1 text-xs font-bold text-red-600/80">
          البيانات الشخصية + كل التسجيلات ({enrollCount}) + كل سجلات الحضور والنقاط والرسائل والإنجازات في جميع الجداول — لا يمكن التراجع.
        </p>
      </div>
      {servants.length > 0 && (
        <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-700">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {servants.length} من المحددين لهم حساب خادم — يُتخطَّون هنا ويُحذفون من «إدارة الخدام».
        </p>
      )}
      {needConfirmWord && deletable > 0 && (
        <div className="mt-3">
          <label className="mb-1 block text-xs font-bold text-slate-500">اكتب «حذف» للتأكيد ({deletable} أشخاص)</label>
          <input id="op-delete-confirm" className="input-field" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="حذف" />
        </div>
      )}
      {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}
      <button id="op-delete-run" type="button" onClick={run} disabled={busy || !canRun}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 py-3 font-bold text-white shadow transition hover:bg-red-700 disabled:opacity-60">
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Trash2 className="h-5 w-5" />}
        حذف {deletable} نهائيًا
      </button>
      <button type="button" onClick={onClose} className="btn-secondary mt-2 w-full">إلغاء</button>
    </ModalFrame>
  );
}
