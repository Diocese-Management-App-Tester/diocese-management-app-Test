'use client';

// ---------- INFO TIP (ⓘ) ----------
// A tiny round "i" button that shows its explanation ONLY when tapped.
// Replaces the long always-visible info banners that crowded every page.
// Opens a small sheet (mobile) / card (desktop) rendered in a portal so it
// is never clipped by overflow containers; closes on tap outside / Esc.

import { useEffect, useId, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Info, X } from 'lucide-react';

type Size = 'xs' | 'sm' | 'md';

const SIZE: Record<Size, { btn: string; icon: string }> = {
  xs: { btn: 'h-5 w-5', icon: 'h-3 w-3' },
  sm: { btn: 'h-6 w-6', icon: 'h-3.5 w-3.5' },
  md: { btn: 'h-7 w-7', icon: 'h-4 w-4' },
};

export default function InfoTip({
  children, title = 'معلومات', size = 'sm', tone = 'text-slate-400 hover:bg-slate-100 hover:text-primary-600', className = '', id,
}: {
  children: ReactNode;
  /** Sheet heading */
  title?: string;
  size?: Size;
  /** Tailwind color classes for the idle icon button */
  tone?: string;
  className?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const uid = useId();
  const s = SIZE[size];

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        id={id}
        type="button"
        aria-label={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? uid : undefined}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(true); }}
        className={`inline-flex shrink-0 items-center justify-center rounded-full transition active:scale-95 ${s.btn} ${tone} ${className}`}
      >
        <Info className={s.icon} />
      </button>

      {mounted && open && createPortal(
        <div
          className="fixed inset-0 z-[95] flex items-end justify-center bg-black/35 sm:items-center sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            id={uid}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            dir="rtl"
            className="w-full max-w-md rounded-t-3xl bg-white p-4 pb-6 shadow-2xl sm:rounded-3xl sm:pb-4"
            style={{ animation: 'slideUp .2s ease-out' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-extrabold text-slate-800">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-50 text-primary-600"><Info className="h-4 w-4" /></span>
                {title}
              </h3>
              <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="text-[13px] font-bold leading-relaxed text-slate-600">{children}</div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
