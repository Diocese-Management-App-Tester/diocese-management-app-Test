'use client';

// ---------- Step 4 — المعاينة والتصدير ----------
// Every physical page (design pages + table continuations) is rendered
// with the SAME ReportPageView used by the designer:
//   * on-screen preview (scaled to the card width)
//   * PDF   — each page rasterized at 200 dpi (modern-screenshot) → jsPDF
//             (image pages ⇒ perfect Arabic shaping / RTL, no font embedding)
//   * Print — hidden portal at 1 mm = 1 mm with `@page` per size; the
//             browser's print dialog does the rest (or «save as PDF»)
//   * Excel — exactly the chosen columns (export-excel.ts)

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileDown, FileSpreadsheet, Printer, Loader2, Save, ChevronLeft, ChevronRight } from 'lucide-react';
import type { FieldDef, ReportDefinition, ReportRow } from '@/lib/reports/types';
import { pageSize } from '@/lib/reports/types';
import { type VariableBag, layoutPages } from '@/lib/reports/engine';
import { exportExcel, safeFile } from '@/lib/reports/export-excel';
import { ReportPageView, MM_TO_PX } from './ReportPageView';
import { Section } from './ReportBits';

export function ExportStep({
  def, rows, defs, vars, logoUrl, onSaveTemplate, canSaveTemplate, flash, excelHeader,
}: {
  def: ReportDefinition;
  rows: ReportRow[];
  defs: Map<string, FieldDef>;
  vars: VariableBag;
  logoUrl: string | null;
  onSaveTemplate: () => void;
  canSaveTemplate: boolean;
  flash: (m: string) => void;
  excelHeader: string[];
}) {
  const { design, query } = def;
  const layout = useMemo(() => layoutPages(design, rows.length), [design, rows.length]);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState<'pdf' | 'print' | 'excel' | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1.5);
  const lp = layout[Math.min(idx, layout.length - 1)];
  const size = pageSize(design, lp.page);

  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const fit = () => setScale(Math.max(0.5, Math.min(3, (el.clientWidth - 8) / size.w)));
    fit(); const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, [size.w]);
  useEffect(() => { if (idx >= layout.length) setIdx(0); }, [layout.length, idx]);

  const fileBase = safeFile(design.title || 'report');

  // ---------- Excel ----------
  const doExcel = async () => {
    if (query.fields.length === 0) return flash('اختر حقلاً واحداً على الأقل');
    setBusy('excel');
    try {
      const tbl = design.pages.flatMap((p) => p.elements).find((e) => e.type === 'table')?.table;
      await exportExcel(rows, query.fields, defs, { fileName: fileBase, sheetName: design.title || 'البيانات', headerLines: excelHeader, showIndex: tbl?.showIndex ?? true, totals: tbl?.showTotals ?? false });
    } catch (e) { flash(`فشل التصدير: ${(e as Error).message}`); }
    finally { setBusy(null); }
  };

  // ---------- PDF ----------
  const doPdf = async () => {
    setBusy('pdf');
    try {
      const [{ domToCanvas }, { jsPDF }] = await Promise.all([import('modern-screenshot'), import('jspdf')]);
      const root = document.getElementById('report-print-root');
      if (!root) throw new Error('no print root');
      const nodes = Array.from(root.querySelectorAll<HTMLElement>('.report-print-page'));
      if (nodes.length === 0) throw new Error('no pages');
      // temporarily show the portal off-screen so it can be rasterized
      root.classList.add('report-rasterizing');
      await new Promise((r) => setTimeout(r, 120));
      const first = pageSize(design, layout[0].page);
      const pdf = new jsPDF({ unit: 'mm', format: [first.w, first.h], orientation: first.w > first.h ? 'landscape' : 'portrait', compress: true });
      const dpi = 200;
      for (let i = 0; i < nodes.length; i++) {
        const ps = pageSize(design, layout[i].page);
        if (i > 0) pdf.addPage([ps.w, ps.h], ps.w > ps.h ? 'landscape' : 'portrait');
        const canvas = await domToCanvas(nodes[i], {
          scale: (dpi / 25.4) / MM_TO_PX, backgroundColor: '#ffffff',
          fetch: { requestInit: { mode: 'cors', cache: 'no-cache' } },
        });
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, ps.w, ps.h, undefined, 'FAST');
      }
      root.classList.remove('report-rasterizing');
      pdf.save(`${fileBase}_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
      document.getElementById('report-print-root')?.classList.remove('report-rasterizing');
      flash(`فشل إنشاء PDF: ${(e as Error).message}`);
    } finally { setBusy(null); }
  };

  // ---------- Print ----------
  const doPrint = () => {
    setBusy('print');
    setTimeout(() => { window.print(); setBusy(null); }, 150);
  };

  // all pages share the first page's size in @page (mixed orientations: browsers honour per-page `size` only partially — we set it per page anyway)
  const pageCss = layout.map((l, i) => { const s = pageSize(design, l.page); return `.report-print-page:nth-child(${i + 1}) { page: p${i}; } @page p${i} { size: ${s.w}mm ${s.h}mm; margin: 0; }`; }).join('\n');

  return (
    <div className="space-y-3">
      {/* ---------- actions ---------- */}
      <div id="report-export-actions" className="grid grid-cols-3 gap-2">
        <button id="report-export-pdf" type="button" onClick={doPdf} disabled={busy !== null}
          className="btn-primary flex flex-col items-center justify-center gap-1 !from-rose-600 !to-rose-500 !py-3 text-xs">
          {busy === 'pdf' ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileDown className="h-5 w-5" />} PDF
        </button>
        <button id="report-export-excel" type="button" onClick={doExcel} disabled={busy !== null || query.fields.length === 0}
          className="btn-primary flex flex-col items-center justify-center gap-1 !from-emerald-600 !to-emerald-500 !py-3 text-xs">
          {busy === 'excel' ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileSpreadsheet className="h-5 w-5" />} Excel
        </button>
        <button id="report-export-print" type="button" onClick={doPrint} disabled={busy !== null}
          className="btn-primary flex flex-col items-center justify-center gap-1 !from-slate-700 !to-slate-600 !py-3 text-xs">
          {busy === 'print' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Printer className="h-5 w-5" />} طباعة
        </button>
      </div>
      {canSaveTemplate && (
        <button id="report-save-template" type="button" onClick={onSaveTemplate} className="btn-secondary flex w-full items-center justify-center gap-2 !py-2.5 text-sm">
          <Save className="h-4 w-4" /> حفظ التصميم كقالب لإعادة استخدامه
        </button>
      )}

      {/* ---------- preview ---------- */}
      <Section title={`المعاينة — ${layout.length.toLocaleString('ar-EG')} صفحة · ${rows.length.toLocaleString('ar-EG')} سجل`} icon={<Printer className="h-4 w-4" />} id="report-final-preview"
        right={
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label="السابقة"><ChevronRight className="h-4 w-4" /></button>
            <span className="text-xs font-extrabold tabular-nums text-slate-600">{(idx + 1).toLocaleString('ar-EG')} / {layout.length.toLocaleString('ar-EG')}</span>
            <button type="button" onClick={() => setIdx((i) => Math.min(layout.length - 1, i + 1))} disabled={idx >= layout.length - 1} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label="التالية"><ChevronLeft className="h-4 w-4" /></button>
          </div>
        }>
        <div ref={wrapRef} className="rounded-xl bg-slate-200/70 p-1">
          <div className="mx-auto shadow-lg" style={{ width: size.w * scale }}>
            <ReportPageView design={design} lp={lp} pageNo={idx + 1} pagesTotal={layout.length} rows={rows} defs={defs} vars={vars} fields={query.fields} logoUrl={logoUrl} scale={scale} />
          </div>
        </div>
        <p className="text-center text-[10px] font-bold text-slate-400">في نافذة الطباعة: الهوامش «بلا / None» والمقياس 100٪ — أو اختر «حفظ كـ PDF».</p>
      </Section>

      {/* ---------- hidden print / raster portal ---------- */}
      {typeof document !== 'undefined' && createPortal(
        <div id="report-print-root" dir="rtl">
          <style>{`
            #report-print-root { display: none; }
            #report-print-root.report-rasterizing { display: block; position: fixed; left: -10000px; top: 0; z-index: -1; }
            .report-print-page { position: relative; overflow: hidden; background: #fff; }
            @media print {
              body > *:not(#report-print-root) { display: none !important; }
              #report-print-root { display: block !important; position: static !important; left: auto !important; }
              html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
              .report-print-page { page-break-after: always; break-after: page; }
              .report-print-page:last-child { page-break-after: auto; break-after: auto; }
              * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
              ${pageCss}
            }
          `}</style>
          {layout.map((l, i) => {
            const s = pageSize(design, l.page);
            return (
              <div key={`${l.page.id}-${i}`} className="report-print-page" style={{ width: `${s.w}mm`, height: `${s.h}mm` }}>
                <ReportPageView design={design} lp={l} pageNo={i + 1} pagesTotal={layout.length} rows={rows} defs={defs} vars={vars} fields={query.fields} logoUrl={logoUrl} scale={MM_TO_PX} />
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
