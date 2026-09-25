'use client';

// ---------- Shared bits for the customization editors ----------

import Link from 'next/link';
import { ArrowRight, Save, RotateCcw, Loader2, Check, type LucideIcon } from 'lucide-react';
import InfoTip from '@/components/InfoTip';

export function EditorHeader({
  back, icon: Icon, title, badge, info,
}: { back: string; icon: LucideIcon; title: string; badge?: string; info?: React.ReactNode }) {
  return (
    <section className="mb-4 flex items-center gap-2">
      <Link href={back} aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
        <ArrowRight className="h-5 w-5" />
      </Link>
      <h2 className="flex items-center gap-2 text-lg font-extrabold">
        <Icon className="h-5 w-5 text-primary-600" />
        {title}
        {badge && <span className="badge bg-primary-100 text-primary-700">{badge}</span>}
        {info && <InfoTip title={title}>{info}</InfoTip>}
      </h2>
    </section>
  );
}

/** Sticky save / reset bar shown above the bottom nav */
export function SaveBar({
  dirty, saving, saved, customized, onSave, onReset, error,
}: {
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  customized: boolean;
  onSave: () => void;
  onReset: () => void;
  error: string;
}) {
  return (
    <div
      id="customize-save-bar"
      className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 mt-5 rounded-2xl border border-indigo-100 bg-white/95 p-3 shadow-card backdrop-blur"
    >
      {error && <p className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          id="customize-save"
          onClick={onSave}
          disabled={!dirty || saving}
          className="btn-primary flex flex-1 items-center justify-center gap-1.5 !py-2.5 text-sm"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved && !dirty ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {saved && !dirty ? 'تم الحفظ' : 'حفظ التغييرات'}
        </button>
        <button
          id="customize-reset"
          onClick={onReset}
          disabled={saving || (!customized && !dirty)}
          className="btn-secondary flex items-center gap-1.5 !py-2.5 text-sm disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" />
          الافتراضي
        </button>
      </div>
      {dirty && (
        <p className="mt-2 text-center text-[11px] font-bold text-amber-600">
          لديك تغييرات غير محفوظة — تُطبَّق على كل الأجهزة فور الحفظ
        </p>
      )}
    </div>
  );
}

export const KIND_LABEL: Record<'core' | 'module' | 'owner', string> = {
  core: 'صفحة أساسية',
  module: 'وحدة',
  owner: 'وحدة المالك',
};
