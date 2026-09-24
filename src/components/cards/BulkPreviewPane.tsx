'use client';

// Card-by-card preview for the Bulk Print tab: «كارت 15 من 100», browse with
// arrows / jump to a number / keyboard, and the row's data shown next to the
// card so every {{field}} can be checked against its value.

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, ChevronLeft, ChevronsRight, ChevronsLeft, Printer, ZoomIn, ZoomOut } from 'lucide-react';
import type { CardDesign } from '@/lib/card-types';
import { hasBack, faceDesign, CARD_SIDE_LABELS } from '@/lib/card-types';
import type { CardConstantsData, CardPersonData } from './CardCanvas';
import CardCanvas from './CardCanvas';
import type { BulkColumn, BulkRow } from '@/lib/bulk-print';

export default function BulkPreviewPane({
  design, row, index, total, onIndex, cardFor, columns, onNext,
}: {
  design: CardDesign;
  row: BulkRow | undefined;
  index: number;
  total: number;
  onIndex: (i: number) => void;
  cardFor: (row: BulkRow) => { person: CardPersonData; constants: CardConstantsData };
  columns: BulkColumn[];
  onNext: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [jump, setJump] = useState(String(index + 1));
  useEffect(() => { setJump(String(index + 1)); }, [index]);

  const baseScale = useMemo(() => Math.min(340 / design.width, 220 / design.height), [design.width, design.height]);
  const scale = baseScale * zoom;

  const go = (i: number) => onIndex(Math.max(0, Math.min(total - 1, i)));

  // keyboard: ← → Home End (RTL page: right arrow = previous card)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.key === 'ArrowRight') onIndex(Math.max(0, index - 1));
      else if (e.key === 'ArrowLeft') onIndex(Math.min(total - 1, index + 1));
      else if (e.key === 'Home') onIndex(0);
      else if (e.key === 'End') onIndex(Math.max(0, total - 1));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [index, total, onIndex]);

  if (!row) return null;
  const data = cardFor(row);

  const navBtn = 'rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 disabled:opacity-30';

  return (
    <>
      <section className="card !p-3 sticky top-[76px] z-30 !shadow-lg">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-extrabold text-slate-700">
            كارت <span className="text-emerald-700">{index + 1}</span> من {total}
          </p>
          <div className="flex items-center gap-1">
            <button onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} disabled={zoom <= 0.5} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30" title="تصغير"><ZoomOut className="h-4 w-4" /></button>
            <span className="w-10 text-center text-[11px] font-extrabold text-slate-400" dir="ltr">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((z) => Math.min(3, z + 0.25))} disabled={zoom >= 3} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30" title="تكبير"><ZoomIn className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="flex flex-wrap items-start justify-center gap-3 overflow-auto py-2" dir="rtl" style={{ maxHeight: 420 }}>
          <div className="flex flex-col items-center gap-1">
            {hasBack(design) && <span className="badge bg-slate-100 text-slate-500 !py-0">{CARD_SIDE_LABELS.front}</span>}
            <div className="shadow-lg ring-1 ring-slate-200" style={{ borderRadius: design.cornerRadius * scale }} dir="ltr">
              <CardCanvas design={design} scale={scale} person={data.person} constants={data.constants} />
            </div>
          </div>
          {hasBack(design) && (
            <div className="flex flex-col items-center gap-1">
              <span className="badge bg-slate-100 text-slate-500 !py-0">{CARD_SIDE_LABELS.back}</span>
              <div className="shadow-lg ring-1 ring-slate-200" style={{ borderRadius: design.cornerRadius * scale }} dir="ltr">
                <CardCanvas design={faceDesign(design, 'back')} scale={scale} person={data.person} constants={data.constants} />
              </div>
            </div>
          )}
        </div>

        {/* navigation */}
        <div className="mt-2 flex items-center justify-center gap-1.5" dir="rtl">
          <button onClick={() => go(0)} disabled={index === 0} className={navBtn} title="الأول"><ChevronsRight className="h-4 w-4" /></button>
          <button onClick={() => go(index - 1)} disabled={index === 0} className={navBtn} title="السابق"><ChevronRight className="h-4 w-4" /></button>
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => { e.preventDefault(); const n = Number(jump); if (Number.isFinite(n) && n >= 1) go(n - 1); }}
          >
            <input
              className="input-field !w-20 !py-1.5 !px-2 text-center !text-sm"
              value={jump}
              onChange={(e) => setJump(e.target.value.replace(/[^\d]/g, ''))}
              onBlur={() => { const n = Number(jump); if (Number.isFinite(n) && n >= 1) go(n - 1); else setJump(String(index + 1)); }}
              inputMode="numeric"
              dir="ltr"
              aria-label="رقم الكارت"
            />
            <span className="text-xs font-bold text-slate-400">/ {total}</span>
          </form>
          <button onClick={() => go(index + 1)} disabled={index >= total - 1} className={navBtn} title="التالي"><ChevronLeft className="h-4 w-4" /></button>
          <button onClick={() => go(total - 1)} disabled={index >= total - 1} className={navBtn} title="الأخير"><ChevronsLeft className="h-4 w-4" /></button>
        </div>
        <input
          type="range"
          min={1}
          max={Math.max(1, total)}
          value={index + 1}
          onChange={(e) => go(Number(e.target.value) - 1)}
          className="mt-2 w-full accent-emerald-600"
          dir="ltr"
          aria-label="تصفح الكروت"
        />
      </section>

      {/* this row's data */}
      <section className="card">
        <h3 className="mb-2 text-sm font-extrabold text-slate-600">بيانات هذا الكارت</h3>
        <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {columns.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
              <dt className="shrink-0 font-mono text-[11px] font-extrabold text-emerald-700" dir="ltr">{`{{${c.key}}}`}</dt>
              <dd className="min-w-0 flex-1 truncate text-end text-xs font-bold text-slate-700" dir="auto">{row.cells[c.id] || <span className="text-slate-300">—</span>}</dd>
            </div>
          ))}
          {columns.length === 0 && <p className="text-xs font-bold text-slate-300">لا توجد أعمدة مفعّلة</p>}
        </dl>
        <p className="mt-2 text-[10px] font-bold text-slate-400">استخدم الأسهم ← → في لوحة المفاتيح للتنقل بين الكروت.</p>
      </section>

      <button onClick={onNext} className="btn-primary w-full !py-2.5 flex items-center justify-center gap-2 text-sm !from-emerald-600 !to-emerald-500">
        <Printer className="h-4 w-4" /> التالي: الطباعة
      </button>
    </>
  );
}
