'use client';

// ---------- Scanner: family picker (العائلة عند المسح) ----------
// Opened by the scanner when the scanned code belongs to a person with a
// family (or is a family code). Two steps:
//   1. أفراد العائلة — every code / person of the family; the servant taps
//      the person the operation is meant for. Members outside the selected
//      scope (or with no enrollment the servant can reach) are shown greyed.
//   2. الخدمة — only when that person is enrolled in 2+ places inside the
//      scope: the servant picks the enrollment. The service he ALREADY
//      attended today is recognised (badge «حضر اليوم هنا»); with the
//      «التعرف على الخدمة تلقائياً» switch on, a single recognised service is
//      chosen without asking.
// The chosen enrollment is handed back through `onPick` and the scanner
// runs the selected job on it exactly as for a single scan.

import { useEffect, useMemo, useState } from 'react';
import {
  UsersRound, School, CheckCircle2, ArrowRight, Sparkles, Ban, CircleDashed, UserCheck, Hash, Loader2,
} from 'lucide-react';
import { ModalFrame } from '@/components/PersonDataModals';
import { PersonAvatar } from '@/components/CallFeedback';
import { relationLabel, type FamilyLookup, type FamilyLookupEnrollment, type FamilyLookupMember } from '@/lib/families';
import type { EnrollmentWithPerson } from '@/lib/types';

const AUTO_KEY = 'scanner.family.autoService';

/** Persisted «التعرف على الخدمة تلقائياً» switch (default ON). */
export function useAutoServiceSetting(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(true);
  useEffect(() => {
    try { const v = localStorage.getItem(AUTO_KEY); if (v !== null) setOn(v === '1'); } catch { /* noop */ }
  }, []);
  const set = (v: boolean) => { setOn(v); try { localStorage.setItem(AUTO_KEY, v ? '1' : '0'); } catch { /* noop */ } };
  return [on, set];
}

export default function FamilyScanPicker({
  lookup, inScope, scopeLabel, serviceName, autoService, onAutoServiceChange, busyId, onPick, onClose,
}: {
  lookup: FamilyLookup;
  /** the scanner's church / service / class selectors */
  inScope: (e: { church_id: string; service_id: string; class_id: string }) => boolean;
  scopeLabel: (e: EnrollmentWithPerson) => string;
  serviceName: (id: string) => string;
  autoService: boolean;
  onAutoServiceChange: (v: boolean) => void;
  busyId: string | null;
  onPick: (e: EnrollmentWithPerson) => void | Promise<void>;
  onClose: () => void;
}) {
  const [step, setStep] = useState<{ member: FamilyLookupMember; options: FamilyLookupEnrollment[] } | null>(null);
  const [autoNote, setAutoNote] = useState('');

  const scannedId = lookup.person?.id ?? null;
  const familyName = lookup.family?.name ?? 'بدون عائلة';

  // in-scope enrollments per member (what the servant can act on right now)
  const optionsOf = useMemo(() => {
    const m = new Map<string, FamilyLookupEnrollment[]>();
    lookup.members.forEach((x) => m.set(x.person.id, x.enrollments.filter(inScope)));
    return m;
  }, [lookup.members, inScope]);

  const attendedServices = (mem: FamilyLookupMember) => {
    const ids = Array.from(new Set(mem.enrollments.filter((e) => e.attended_today).map((e) => e.service_id)));
    return ids.map(serviceName);
  };

  const pickMember = (mem: FamilyLookupMember) => {
    const opts = optionsOf.get(mem.person.id) ?? [];
    if (opts.length === 0) return;
    if (opts.length === 1) { onPick(opts[0]); return; }
    // 2+ services / classes — recognise the one he already attended today
    const attended = opts.filter((e) => e.attended_today);
    if (autoService && attended.length === 1) {
      setAutoNote(`تم التعرف على الخدمة: ${serviceName(attended[0].service_id)} (حضر اليوم فيها)`);
      onPick(attended[0]);
      return;
    }
    setStep({ member: mem, options: opts });
  };

  const title = step ? `اختر الخدمة — ${step.member.person.name}` : `عائلة ${familyName}`;

  return (
    <ModalFrame title={title} icon={<UsersRound className="h-5 w-5 text-teal-600" />} onClose={onClose}>
      {!step ? (
        <>
          <div className="mb-3 flex items-center justify-between gap-2 rounded-2xl bg-teal-50 px-3 py-2">
            <p className="text-xs font-bold text-teal-700">
              {lookup.matched === 'family'
                ? 'تم مسح كود العائلة — اختر الفرد المطلوب'
                : <>تم مسح كود <span className="font-extrabold">{lookup.person?.name}</span> — اختر الفرد الذي تُنفَّذ عليه العملية</>}
            </p>
            {lookup.family && (
              <span className="inline-flex shrink-0 items-center gap-0.5 font-mono text-[10px] font-bold text-teal-600" dir="ltr">
                <Hash className="h-3 w-3" />{lookup.family.code}
              </span>
            )}
          </div>

          <ul id="family-scan-members" className="space-y-2">
            {lookup.members.map((mem) => {
              const opts = optionsOf.get(mem.person.id) ?? [];
              const disabled = opts.length === 0;
              const attended = attendedServices(mem);
              const isScanned = mem.person.id === scannedId;
              const stopped = opts.length > 0 && opts.every((e) => e.status === 'stopped');
              return (
                <li key={mem.person.id}>
                  <button
                    id={`family-scan-member-${mem.person.id}`}
                    type="button"
                    disabled={disabled || busyId !== null}
                    onClick={() => pickMember(mem)}
                    className={`flex w-full items-center gap-3 rounded-2xl border-2 px-3 py-2.5 text-right transition active:scale-[0.99] ${
                      disabled
                        ? 'cursor-not-allowed border-slate-100 bg-slate-50 opacity-60'
                        : isScanned
                          ? 'border-teal-400 bg-teal-50 hover:bg-teal-100'
                          : 'border-slate-100 bg-white hover:border-teal-200 hover:bg-teal-50/40'
                    }`}
                  >
                    <PersonAvatar name={mem.person.name} imageUrl={mem.person.image_url} size={44} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-extrabold">{mem.person.name}</span>
                        {mem.relation && <span className="badge bg-teal-100 text-teal-700">{relationLabel(mem.relation)}</span>}
                        {isScanned && <span className="badge bg-primary-100 text-primary-700">الممسوح</span>}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[11px] font-bold text-slate-400" dir="ltr">{mem.person.national_id}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1">
                        {disabled ? (
                          <span className="badge bg-slate-100 text-slate-500"><Ban className="h-3 w-3" /> خارج النطاق المختار</span>
                        ) : stopped ? (
                          <span className="badge bg-red-100 text-red-600"><Ban className="h-3 w-3" /> موقوف</span>
                        ) : (
                          <span className="badge bg-indigo-50 text-indigo-600"><School className="h-3 w-3" /> {opts.length === 1 ? serviceName(opts[0].service_id) : `${opts.length} خدمات / فصول`}</span>
                        )}
                        {attended.length > 0 ? (
                          <span className="badge bg-emerald-100 text-emerald-700"><UserCheck className="h-3 w-3" /> حضر اليوم: {attended.join(' · ')}</span>
                        ) : (
                          !disabled && <span className="badge bg-slate-100 text-slate-500"><CircleDashed className="h-3 w-3" /> لم يحضر اليوم</span>
                        )}
                      </span>
                    </span>
                    {busyId && opts.some((e) => e.id === busyId)
                      ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-teal-500" />
                      : !disabled && <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />}
                  </button>
                </li>
              );
            })}
          </ul>

          {/* recognise-the-service switch */}
          <label className="mt-3 flex cursor-pointer items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-2.5">
            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
              <Sparkles className="h-4 w-4 text-gold-500" /> التعرف على الخدمة تلقائياً
              <span className="block text-[10px] font-bold text-slate-400">عند تعدد الخدمات تُختار الخدمة التي حضر فيها اليوم دون سؤال</span>
            </span>
            <input
              id="family-scan-auto-service"
              type="checkbox"
              className="h-5 w-5 accent-teal-600"
              checked={autoService}
              onChange={(e) => onAutoServiceChange(e.target.checked)}
            />
          </label>
          {autoNote && <p className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">{autoNote}</p>}
          <button type="button" onClick={onClose} className="mt-3 w-full text-xs font-bold text-slate-400">إلغاء</button>
        </>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-2">
            <PersonAvatar name={step.member.person.name} imageUrl={step.member.person.image_url} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-extrabold">{step.member.person.name}</p>
              <p className="text-[11px] font-bold text-slate-500">مسجل في {step.options.length} أماكن — اختر الخدمة المطلوبة</p>
            </div>
          </div>
          <ul id="family-scan-services" className="space-y-2">
            {step.options.map((e) => {
              const recognised = e.attended_today;
              const stopped = e.status === 'stopped';
              return (
                <li key={e.id}>
                  <button
                    id={`family-scan-service-${e.id}`}
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => onPick(e)}
                    className={`flex w-full items-center justify-between gap-2 rounded-2xl border-2 px-3 py-2.5 text-right transition active:scale-[0.99] ${
                      recognised ? 'border-emerald-400 bg-emerald-50 hover:bg-emerald-100' : 'border-slate-100 bg-white hover:border-teal-200'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <School className={`h-4 w-4 shrink-0 ${recognised ? 'text-emerald-600' : 'text-primary-600'}`} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-extrabold">{serviceName(e.service_id)}</span>
                        <span className="block truncate text-[11px] font-bold text-slate-400">{scopeLabel(e)}</span>
                        <span className="mt-0.5 flex flex-wrap gap-1">
                          {recognised && <span className="badge bg-emerald-500 text-white !ring-emerald-600/20"><UserCheck className="h-3 w-3" /> حضر اليوم هنا</span>}
                          {stopped && <span className="badge bg-red-100 text-red-600"><Ban className="h-3 w-3" /> موقوف</span>}
                        </span>
                      </span>
                    </span>
                    {busyId === e.id ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-teal-500" /> : <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <button type="button" onClick={() => setStep(null)} className="btn-secondary mt-3 flex w-full items-center justify-center gap-1.5 !py-2 text-sm">
            <ArrowRight className="h-4 w-4" /> رجوع إلى أفراد العائلة
          </button>
        </>
      )}
    </ModalFrame>
  );
}
