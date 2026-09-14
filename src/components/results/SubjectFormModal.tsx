'use client';

// ---------- Add / edit a subject of a results exam ----------
// name · code · full degree · pass degree · weight (optional) · bonus flag.
// «حفظ وإضافة أخرى» keeps the modal open for fast subject entry.

import { useState } from 'react';
import { Save, Loader2, BookOpen, Plus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Field, Toggle, ModalFrame } from '@/components/results/ResultBits';
import { createSubject, updateSubject, resultErrorMessage, type ResultSubject, type SubjectInput } from '@/lib/results';

export default function SubjectFormModal({
  examId, subject, nextOrder, onClose, onSaved,
}: {
  examId: string; subject: ResultSubject | null; nextOrder: number;
  onClose: () => void; onSaved: (s: ResultSubject, keepOpen: boolean) => void;
}) {
  const [supabase] = useState(() => createClient());
  const blank = (): SubjectInput => ({ name: '', code: null, full_degree: 100, pass_degree: 50, weight: null, is_bonus: false });
  const [form, setForm] = useState<SubjectInput>(subject
    ? { name: subject.name, code: subject.code, full_degree: subject.full_degree, pass_degree: subject.pass_degree, weight: subject.weight, is_bonus: subject.is_bonus }
    : blank());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState(nextOrder);
  const set = <K extends keyof SubjectInput>(k: K, v: SubjectInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (keepOpen: boolean) => {
    if (!form.name.trim()) { setError('اكتب اسم المادة'); return; }
    if (!(form.full_degree > 0)) { setError('الدرجة الكاملة يجب أن تكون أكبر من صفر'); return; }
    if (form.pass_degree < 0 || form.pass_degree > form.full_degree) { setError('درجة النجاح بين 0 والدرجة الكاملة'); return; }
    setSaving(true); setError(null);
    try {
      const payload: SubjectInput = { ...form, name: form.name.trim(), code: form.code?.trim() || null };
      const saved = subject ? await updateSubject(supabase, subject.id, payload) : await createSubject(supabase, examId, payload, order);
      onSaved(saved, keepOpen);
      if (keepOpen) { setForm(blank()); setOrder((o) => o + 1); }
    } catch (err) {
      setError(resultErrorMessage(err, 'تعذر الحفظ'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalFrame title={subject ? 'تعديل المادة' : 'مادة جديدة'} icon={<BookOpen className="h-5 w-5 text-emerald-600" />} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); save(false); }} className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Field label="اسم المادة *" className="col-span-2">
            <input id="rs-name" className="input-field" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="مثال: الكتاب المقدس" autoFocus />
          </Field>
          <Field label="الكود">
            <input id="rs-code" className="input-field" value={form.code ?? ''} onChange={(e) => set('code', e.target.value)} placeholder="BIB" dir="ltr" />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field label="الدرجة الكاملة *">
            <input id="rs-full" type="number" min={1} step="0.5" inputMode="decimal" className="input-field text-center text-lg font-extrabold" value={form.full_degree}
              onChange={(e) => set('full_degree', Number(e.target.value))} />
          </Field>
          <Field label="درجة النجاح *">
            <input id="rs-pass" type="number" min={0} step="0.5" inputMode="decimal" className="input-field text-center text-lg font-extrabold" value={form.pass_degree}
              onChange={(e) => set('pass_degree', Number(e.target.value))} />
          </Field>
          <Field label="الوزن" hint="اختياري">
            <input id="rs-weight" type="number" min={0} step="0.5" inputMode="decimal" className="input-field text-center" value={form.weight ?? ''}
              onChange={(e) => set('weight', e.target.value === '' ? null : Number(e.target.value))} placeholder="—" />
          </Field>
        </div>
        <p className="text-[11px] font-bold text-slate-400">
          النجاح عند {form.full_degree > 0 ? Math.round((form.pass_degree / form.full_degree) * 1000) / 10 : 0}٪ من المادة · الوزن يُستخدم فقط عندما تحدده لكل المواد
        </p>
        <Toggle id="rs-bonus" checked={form.is_bonus} onChange={(v) => set('is_bonus', v)} label="مادة إضافية (Bonus)" desc="تُضاف درجتها إلى المجموع دون أن تُضاف إلى الدرجة الكاملة" />

        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}

        <div className="flex gap-2">
          <button id="rs-save" type="submit" disabled={saving} className="btn-primary flex flex-1 items-center justify-center gap-2 !from-emerald-600 !to-emerald-500">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} حفظ
          </button>
          {!subject && (
            <button id="rs-save-more" type="button" disabled={saving} onClick={() => save(true)} className="btn-secondary flex items-center gap-1 !border-emerald-200 !text-emerald-700">
              <Plus className="h-4 w-4" /> حفظ وإضافة أخرى
            </button>
          )}
        </div>
      </form>
    </ModalFrame>
  );
}
