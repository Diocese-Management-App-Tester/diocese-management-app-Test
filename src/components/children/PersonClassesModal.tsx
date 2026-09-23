'use client';

// ---------- PersonClassesModal — «الفصول»: one child → many classes (0045) ----------
// Opened from إدارة المخدومين → المخدومين → «الفصول». Lists EVERY class the
// person is enrolled in (across churches / services) and lets the manager:
//   * add him to more classes at once (ScopePicker, class required) →
//     RPC add_person_and_enroll per class (person upsert by code — the
//     enrollment gets its own attendance / points counters)
//   * remove ONE enrollment (✕) — attendance + points of THAT class go with it
// Servant mirror rows (kind = servant) are listed read-only: they follow the
// servant's places from إدارة الخدام.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { School, Loader2, Plus, Trash2, Church as ChurchIcon, Layers, Ban, ShieldCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { ModalFrame } from '@/components/PersonDataModals';
import ScopePicker from '@/components/ScopePicker';
import type { Church, Service, ClassRoom, Enrollment, Person, ScopeRef } from '@/lib/types';

export default function PersonClassesModal({
  person, churches, services, classes, onChanged, onClose, allowLast = false,
}: {
  person: Person;
  churches: Church[];
  services: Service[];
  classes: ClassRoom[];
  onChanged: () => void;
  onClose: () => void;
  /** إدارة الأفراد (owner): the last class may go too — the person then simply has no enrollments */
  allowLast?: boolean;
}) {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [toAdd, setToAdd] = useState<ScopeRef[]>([]);
  const lookups = useMemo(() => ({ churches, services, classes }), [churches, services, classes]);

  const load = useCallback(async () => {
    const { data } = await supabase.from('enrollments').select('*').eq('person_id', person.id).order('created_at');
    setRows((data ?? []) as Enrollment[]);
    setLoading(false);
  }, [supabase, person.id]);
  useEffect(() => { load(); }, [load]);

  const nameOf = (list: { id: string; name: string }[], id: string) => list.find((x) => x.id === id)?.name ?? '—';
  const enrolledClassIds = useMemo(() => new Set(rows.map((r) => r.class_id)), [rows]);
  // classes he is already in cannot be picked again
  const pickableClasses = useMemo(() => classes.filter((c) => !enrolledClassIds.has(c.id)), [classes, enrolledClassIds]);
  const pickLookups = useMemo(() => ({ churches, services, classes: pickableClasses }), [churches, services, pickableClasses]);

  const addAll = async () => {
    if (toAdd.length === 0) return;
    setError(''); setOk('');
    setBusy('add');
    let added = 0; const failed: string[] = [];
    for (const s of toAdd) {
      if (!s.class_id || !s.service_id) continue;
      const { error: err } = await supabase.rpc('add_person_and_enroll', {
        p_church: s.church_id, p_service: s.service_id, p_class: s.class_id,
        p_name: person.name, p_national_id: person.national_id,
        p_gender: person.gender, p_birthdate: person.birthdate, p_phone: person.phone,
        p_address: person.address, p_notes: person.notes, p_image_url: person.image_url,
        p_points: 0, p_password: null,
      });
      if (err) failed.push(nameOf(classes, s.class_id)); else added++;
    }
    setBusy(null);
    setToAdd([]);
    await load();
    onChanged();
    if (failed.length) setError(`تعذر الإضافة إلى: ${failed.join('، ')} — تأكد من صلاحياتك على هذه الفصول`);
    if (added) setOk(`تمت إضافة «${person.name}» إلى ${added} ${added === 1 ? 'فصل' : 'فصول'}`);
  };

  const remove = async (e: Enrollment) => {
    if (!allowLast && rows.filter((r) => r.kind === 'child').length <= 1) {
      return setError('هذا آخر فصل للمخدوم — لحذفه نهائيًا استخدم «حذف»');
    }
    const ok1 = confirm(
      `حذف «${person.name}» من ${nameOf(classes, e.class_id)} — ${nameOf(services, e.service_id)}؟\n\nيُحذف حضوره ونقاطه في هذا الفصل فقط؛ باقي فصوله وبياناته تبقى.`
    );
    if (!ok1) return;
    setError(''); setOk('');
    setBusy(e.id);
    const { error: err } = await supabase.from('enrollments').delete().eq('id', e.id);
    setBusy(null);
    if (err) return setError('تعذر الحذف — تأكد من صلاحياتك');
    await load();
    onChanged();
    setOk(`تم حذف «${person.name}» من ${nameOf(classes, e.class_id)}`);
  };

  return (
    <ModalFrame title={`فصول ${person.name}`} icon={<School className="h-5 w-5 text-primary-600" />} onClose={onClose}>
      <p className="mb-3 text-xs text-slate-400">
        المخدوم شخص واحد يمكن تسجيله في أكثر من فصل أو خدمة أو كنيسة — لكل فصل حضوره ونقاطه.
      </p>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary-500" /></div>
      ) : (
        <ul id="person-classes-list" className="space-y-1.5">
          {rows.length === 0 && <li className="rounded-xl bg-slate-50 px-3 py-2 text-center text-xs font-bold text-slate-400">غير مسجّل في أي فصل</li>}
          {rows.map((e) => {
            const isServant = e.kind === 'servant';
            return (
              <li key={e.id} id={`person-class-${e.id}`}
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ring-1 ${isServant ? 'bg-emerald-50 ring-emerald-100' : e.status === 'stopped' ? 'bg-slate-100 ring-slate-200' : 'bg-white ring-slate-100'}`}>
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isServant ? 'bg-white text-emerald-500' : 'bg-primary-50 text-primary-500'}`}>
                  {isServant ? <ShieldCheck className="h-4 w-4" /> : <School className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-extrabold text-slate-700">{nameOf(classes, e.class_id)}</span>
                  <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400">
                    <span className="flex items-center gap-0.5"><Layers className="h-3 w-3" /> {nameOf(services, e.service_id)}</span>
                    <span className="flex items-center gap-0.5"><ChurchIcon className="h-3 w-3" /> {nameOf(churches, e.church_id)}</span>
                    {e.status === 'stopped' && <span className="badge bg-slate-200 text-slate-600"><Ban className="h-3 w-3" /> موقوف</span>}
                    {isServant && <span className="badge bg-emerald-100 text-emerald-700">كخادم</span>}
                  </span>
                  <span className="block text-[11px] text-slate-400">حضور {e.attendance_count} · نقاط {e.points}</span>
                </span>
                {!isServant && (
                  <button type="button" id={`person-class-remove-${e.id}`} onClick={() => remove(e)} disabled={busy !== null}
                    aria-label="حذف من هذا الفصل" title="حذف من هذا الفصل"
                    className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-500 disabled:opacity-50">
                    {busy === e.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {rows.some((r) => r.kind === 'servant') && (
        <p className="mt-2 text-[11px] text-slate-400">
          صفوف «كخادم» تتبع أماكن خدمته وتُدار من <Link href="/servants" className="font-bold text-primary-600 underline">إدارة الخدام</Link>.
        </p>
      )}

      <div className="mt-4 rounded-2xl border border-primary-100 bg-primary-50/30 p-3">
        <ScopePicker
          idPrefix="person-classes-add"
          title="إضافة إلى فصول أخرى"
          value={toAdd}
          onChange={setToAdd}
          lookups={pickLookups}
          depth="class"
          requireLeaf
          primaryLabel={null}
          emptyText="اختر الفصول التي تريد إضافته إليها"
          addLabel="اختيار فصل"
        />
        {toAdd.length > 0 && (
          <button type="button" id="person-classes-add-btn" onClick={addAll} disabled={busy !== null}
            className="btn-primary mt-3 flex w-full items-center justify-center gap-2">
            {busy === 'add' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            إضافة إلى {toAdd.length} {toAdd.length === 1 ? 'فصل' : 'فصول'}
          </button>
        )}
      </div>

      {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}
      {ok && <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">{ok}</p>}
      <button onClick={onClose} className="btn-secondary mt-4 w-full">إغلاق</button>
    </ModalFrame>
  );
}
