'use client';

// ---------- تقارير وجداول — shared UI bits ----------
// ReportHeader · Stepper · Toast · Num · ColorInput · Field · Seg · Empty

import { type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, FileBarChart2, Check } from 'lucide-react';
import { useNavLabel } from '@/lib/customization-context';

export function ReportHeader({ title, badge, back = '/settings', right }: {
  title?: string; badge?: ReactNode; back?: string; right?: ReactNode;
}) {
  const name = useNavLabel('reports');
  return (
    <section className="mb-3 flex items-center gap-2 print:hidden">
      <Link href={back} aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
        <ArrowRight className="h-5 w-5" />
      </Link>
      <h2 className="flex min-w-0 flex-1 items-center gap-2 text-lg font-extrabold">
        <FileBarChart2 className="h-5 w-5 shrink-0 text-fuchsia-600" />
        <span className="truncate">{name}</span>
        {title && <span className="truncate text-sm font-bold text-slate-400">· {title}</span>}
        {badge}
      </h2>
      {right}
    </section>
  );
}

export type StepKey = 'data' | 'fields' | 'design' | 'export';
export const STEPS: { key: StepKey; label: string; short: string }[] = [
  { key: 'data', label: 'اختيار البيانات', short: 'البيانات' },
  { key: 'fields', label: 'الحقول والمعاينة', short: 'الحقول' },
  { key: 'design', label: 'تصميم التقرير', short: 'التصميم' },
  { key: 'export', label: 'المعاينة والتصدير', short: 'التصدير' },
];

export function Stepper({ step, onStep, enabled }: { step: StepKey; onStep: (s: StepKey) => void; enabled: Record<StepKey, boolean> }) {
  const idx = STEPS.findIndex((s) => s.key === step);
  return (
    <nav id="report-stepper" className="mb-3 grid grid-cols-4 gap-1.5 print:hidden">
      {STEPS.map((s, i) => {
        const active = s.key === step;
        const done = i < idx;
        const can = enabled[s.key];
        return (
          <button key={s.key} id={`report-step-${s.key}`} type="button" disabled={!can} onClick={() => onStep(s.key)}
            aria-current={active ? 'step' : undefined}
            className={`flex h-11 items-center justify-center gap-1.5 rounded-xl text-xs font-extrabold transition active:scale-95 disabled:opacity-40 ${
              active ? 'bg-fuchsia-600 text-white shadow ring-2 ring-fuchsia-300' : done ? 'bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200' : 'bg-white text-slate-600 border border-slate-200'
            }`}>
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${active ? 'bg-white/20' : done ? 'bg-fuchsia-600 text-white' : 'bg-slate-100'}`}>
              {done ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span className="hidden xs:inline">{s.short}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function Toast({ msg, tone = 'dark' }: { msg: string | null; tone?: 'dark' | 'error' }) {
  if (!msg) return null;
  return (
    <div id="report-toast" className={`fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-xl px-4 py-2 text-sm font-bold text-white shadow-lg ${tone === 'error' ? 'bg-red-600' : 'bg-slate-800'}`}>
      {msg}
    </div>
  );
}

export function Num({ label, value, onChange, min = 0, max = 500, step = 0.5, suffix, id }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string; id?: string;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-bold text-slate-500">
        {label}{suffix && <span className="text-slate-300"> ({suffix})</span>}
      </span>
      <input id={id} type="number" className="input-field !py-1.5 !px-2 !text-sm" value={Number.isFinite(value) ? value : 0} min={min} max={max} step={step}
        onChange={(e) => onChange(Number(e.target.value))} dir="ltr" />
    </label>
  );
}

export function ColorInput({ label, value, onChange, allowNone = false }: { label: string; value: string; onChange: (v: string) => void; allowNone?: boolean }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-bold text-slate-500">{label}</span>
      <span className="flex items-center gap-1.5">
        <input type="color" className="h-8 w-10 cursor-pointer rounded-lg border border-slate-200 bg-white p-0.5" value={value || '#ffffff'} onChange={(e) => onChange(e.target.value)} />
        {allowNone && (
          <button type="button" onClick={() => onChange('')} className={`rounded-lg border px-2 py-1 text-[11px] font-bold ${!value ? 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700' : 'border-slate-200 text-slate-500'}`}>بلا</button>
        )}
      </span>
    </label>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-bold text-slate-500">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[10px] text-slate-400">{hint}</span>}
    </label>
  );
}

export function Seg<T extends string>({ value, onChange, options, id, size = 'sm' }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; title?: string }[]; id?: string; size?: 'sm' | 'xs';
}) {
  return (
    <div id={id} className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
      {options.map((o) => (
        <button key={o.value} type="button" title={o.title} onClick={() => onChange(o.value)}
          className={`flex-1 rounded-lg px-2 ${size === 'xs' ? 'py-1 text-[11px]' : 'py-1.5 text-xs'} font-extrabold transition ${
            value === o.value ? 'bg-white text-fuchsia-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ label, checked, onChange, id }: { label: string; checked: boolean; onChange: (v: boolean) => void; id?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
      <span>{label}</span>
      <input id={id} type="checkbox" className="h-4 w-4 accent-fuchsia-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Empty({ icon, title, desc }: { icon: ReactNode; title: string; desc?: string }) {
  return (
    <div className="card py-10 text-center">
      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">{icon}</div>
      <p className="font-extrabold text-slate-700">{title}</p>
      {desc && <p className="mt-1 text-xs font-bold text-slate-400">{desc}</p>}
    </div>
  );
}

export function Section({ title, icon, children, right, id }: { title: string; icon?: ReactNode; children: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <section id={id} className="card !p-3 space-y-2">
      <header className="flex items-center gap-2">
        {icon && <span className="text-fuchsia-600">{icon}</span>}
        <h3 className="flex-1 text-sm font-extrabold text-slate-700">{title}</h3>
        {right}
      </header>
      {children}
    </section>
  );
}
