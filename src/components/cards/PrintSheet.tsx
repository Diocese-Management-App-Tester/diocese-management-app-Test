'use client';

// ============================================================
// Shared page renderers for every card print tab:
//   · <BackPrintSettings/>  — the «ظهر الكارت» + «قلب الصفحة» controls
//   · <PagePreview/>        — first-page preview (front, and the back page in
//                             separate mode) at screen scale
//   · <PrintSheet/>         — the hidden mm-exact sheet (portal to body)
// Every item carries its own design (bound printing prints several designs
// in one grid) — the single-template tabs simply pass the same design.
// ============================================================

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FlipHorizontal2, FlipVertical2, Layers, Columns2, Rows2, Ban } from 'lucide-react';
import type { BackPrintMode, CardDesign, CardPrintSettings, DuplexMirror } from '@/lib/card-types';
import { BACK_MODE_LABELS, DUPLEX_MIRROR_LABELS, hasBack } from '@/lib/card-types';
import { MM_TO_PX, effectiveBackMode, pageFlipTransform, type PageLayout } from '@/lib/card-layout';
import { CardUnit, CardUnitPlaceholder, type CardConstantsData, type CardPersonData } from './CardCanvas';

export interface SheetItem {
  key: string;
  person: CardPersonData;
  constants: CardConstantsData;
  design: CardDesign;
}

// ---------- settings panel ----------
export function BackPrintSettings({
  settings, onChange, design, accent = 'primary',
}: {
  settings: CardPrintSettings;
  onChange: (patch: Partial<CardPrintSettings>) => void;
  /** the design being printed (null / many designs → show the controls anyway) */
  design?: CardDesign | null;
  accent?: 'primary' | 'emerald' | 'pink';
}) {
  const on = `border-${accent}-300 bg-${accent}-50 text-${accent}-700`;
  const off = 'border-slate-200 text-slate-400 hover:bg-slate-50';
  const mode = settings.backMode ?? 'separate';
  const noBack = design !== undefined && !hasBack(design);
  const ICONS: Record<BackPrintMode, React.ReactNode> = {
    none: <Ban className="h-4 w-4" />,
    separate: <Layers className="h-4 w-4" />,
    beside: <Columns2 className="h-4 w-4" />,
    below: <Rows2 className="h-4 w-4" />,
  };
  return (
    <section className="card">
      <h3 className="mb-2 text-sm font-extrabold text-slate-600">ظهر الكارت</h3>
      {noBack && (
        <p className="mb-2 rounded-xl bg-slate-50 p-2.5 text-[11px] font-bold text-slate-400">
          هذا التصميم بلا ظهر — فعّل «إضافة ظهر للكارت» في تبويب التصميم. الإعدادات هنا تُحفظ وتعمل حين يُضاف الظهر.
        </p>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        {(['separate', 'beside', 'below', 'none'] as BackPrintMode[]).map((m) => (
          <button
            key={m}
            onClick={() => onChange({ backMode: m })}
            className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-[11px] font-extrabold transition ${mode === m ? on : off}`}
          >
            {ICONS[m]} {BACK_MODE_LABELS[m]}
          </button>
        ))}
      </div>
      {mode === 'separate' && (
        <div className="mt-3 rounded-xl bg-indigo-50/60 p-3">
          <p className="mb-1.5 text-[11px] font-extrabold text-slate-500">
            صفحة الوجوه ثم صفحة الظهور — اتجاه الانعكاس حسب طريقة قلب الطابعة للورقة
          </p>
          <div className="flex flex-col gap-1">
            {(['horizontal', 'vertical', 'none'] as DuplexMirror[]).map((d) => (
              <button
                key={d}
                onClick={() => onChange({ duplexMirror: d })}
                className={`rounded-xl border py-2 text-[11px] font-extrabold transition ${(settings.duplexMirror ?? 'horizontal') === d ? on : off}`}
              >
                {DUPLEX_MIRROR_LABELS[d]}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] font-bold text-slate-400">
            الأفقي هو المعتاد للورق الطولي (يقلب على الحافة الطويلة). لو ظهر الكارت خرج في المكان المعاكس اختر الرأسي.
          </p>
        </div>
      )}
      {(mode === 'beside' || mode === 'below') && (
        <label className="mt-3 block">
          <span className="mb-0.5 block text-[11px] font-bold text-slate-500">المسافة بين الوجه والظهر <span className="text-slate-300">(مم)</span></span>
          <input
            type="number"
            className="input-field !py-2 !px-2.5 !text-sm"
            value={settings.backGap ?? 4}
            min={0} max={100} step={0.5}
            onChange={(e) => onChange({ backGap: Math.max(0, Number(e.target.value)) })}
            dir="ltr"
          />
          <span className="mt-1 block text-[10px] font-bold text-slate-400">
            0 = ملتصقان (يُطويان معاً بعد القص). في «بجانب» يُطبع الوجه يميناً والظهر يساره.
          </span>
        </label>
      )}

      {/* whole-page flip */}
      <div className="mt-3 border-t border-indigo-50 pt-3">
        <p className="mb-1.5 text-[11px] font-extrabold text-slate-500">قلب الصفحة كاملة (انعكاس كل ما يُطبع)</p>
        <div className="flex gap-1.5">
          <button
            onClick={() => onChange({ flipPageH: !settings.flipPageH })}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-extrabold transition ${settings.flipPageH ? on : off}`}
          >
            <FlipHorizontal2 className="h-4 w-4" /> قلب أفقي
          </button>
          <button
            onClick={() => onChange({ flipPageV: !settings.flipPageV })}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-extrabold transition ${settings.flipPageV ? on : off}`}
          >
            <FlipVertical2 className="h-4 w-4" /> قلب رأسي
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------- one rendered page (preview or print) ----------
// side 'back' → the mirrored back page of `separate` mode
function PageBody({
  items, layout, settings, scale, side, phDesign, unit, itemKey,
}: {
  items: (SheetItem | undefined)[];
  layout: PageLayout;
  settings: CardPrintSettings;
  scale: number;
  side: 'front' | 'back';
  /** design used to draw dashed placeholders in empty cells (undefined → skip empty cells) */
  phDesign?: CardDesign;
  unit: 'px' | 'mm';
  itemKey: (i: number) => string;
}) {
  const pos = (v: number) => (unit === 'mm' ? `${v}mm` : v * scale);
  const separateBack = side === 'back';
  return (
    <>
      {settings.centerLineV && (
        <div
          className={unit === 'mm' ? 'card-print-centerline' : 'absolute z-10 border-l border-dashed border-pink-400'}
          style={unit === 'mm'
            ? { left: `${layout.paper.w / 2}mm`, top: 0, width: '0.2mm', height: `${layout.paper.h}mm` }
            : { left: (layout.paper.w / 2) * scale, top: 0, bottom: 0 }}
        />
      )}
      {settings.centerLineH && (
        <div
          className={unit === 'mm' ? 'card-print-centerline' : 'absolute z-10 border-t border-dashed border-pink-400'}
          style={unit === 'mm'
            ? { top: `${layout.paper.h / 2}mm`, left: 0, height: '0.2mm', width: `${layout.paper.w}mm` }
            : { top: (layout.paper.h / 2) * scale, left: 0, right: 0 }}
        />
      )}
      {items.map((item, i) => {
        if (!item && !phDesign) return null;
        const col = i % layout.cols;
        const row = Math.floor(i / layout.cols);
        const left = separateBack ? layout.backCellLeft(col) : layout.cellLeft(col);
        const top = separateBack ? layout.backCellTop(row) : layout.cellTop(row);
        // a smaller design is centred inside the shared cell (bound printing)
        const d = item?.design;
        const inW = d ? (separateBack ? d.width : Math.min(layout.unitW, unitWidthOf(d, settings))) : layout.unitW;
        const inH = d ? (separateBack ? d.height : Math.min(layout.unitH, unitHeightOf(d, settings))) : layout.unitH;
        const dx = (layout.unitW - inW) / 2;
        const dy = (layout.unitH - inH) / 2;
        return (
          <div
            key={itemKey(i)}
            className={unit === 'mm' ? 'card-print-cell' : 'absolute'}
            style={{ left: pos(left + dx), top: pos(top + dy) }}
          >
            {item ? (
              <CardUnit
                design={item.design}
                settings={settings}
                scale={scale}
                person={item.person}
                constants={item.constants}
                side={separateBack ? 'back' : undefined}
                cutMarks={settings.cutMarks}
              />
            ) : (
              <CardUnitPlaceholder design={phDesign!} settings={settings} scale={scale} side={separateBack ? 'back' : undefined} />
            )}
          </div>
        );
      })}
    </>
  );
}

const unitWidthOf = (d: CardDesign, s: CardPrintSettings) => {
  const m = effectiveBackMode(d, s);
  return m === 'beside' ? d.width * 2 + (s.backGap ?? 4) : d.width;
};
const unitHeightOf = (d: CardDesign, s: CardPrintSettings) => {
  const m = effectiveBackMode(d, s);
  return m === 'below' ? d.height * 2 + (s.backGap ?? 4) : d.height;
};

// ---------- screen preview of the first page(s) ----------
export function PagePreview({
  items, layout, settings, previewScale, placeholderDesign, showBackPage, title,
}: {
  items: SheetItem[]; // the first page's items
  layout: PageLayout;
  settings: CardPrintSettings;
  previewScale: number;
  placeholderDesign?: CardDesign; // dashed boxes for empty cells
  showBackPage: boolean; // separate mode with a back → show the 2nd page too
  title?: React.ReactNode;
}) {
  const cells: (SheetItem | undefined)[] = Array.from({ length: layout.perPage }, (_, i) => items[i]);
  const phDesign = placeholderDesign ?? items[0]?.design;
  const flip = pageFlipTransform(settings);
  const page = (side: 'front' | 'back') => (
    <div
      className="relative bg-white shadow-lg ring-1 ring-slate-200"
      style={{ width: layout.paper.w * previewScale, height: layout.paper.h * previewScale, transform: flip, flexShrink: 0 }}
    >
      {/* margin guides */}
      <div
        className="absolute border border-dashed border-indigo-200"
        style={{
          top: settings.marginTop * previewScale,
          bottom: settings.marginBottom * previewScale,
          left: settings.marginLeft * previewScale,
          right: settings.marginRight * previewScale,
        }}
      />
      <PageBody
        items={cells}
        layout={layout}
        settings={settings}
        scale={previewScale}
        side={side}
        phDesign={phDesign}
        unit="px"
        itemKey={(i) => String(i)}
      />
    </div>
  );
  return (
    <section className="card !p-3 sticky top-[76px] z-30 !shadow-lg order-first">
      {title && <p className="mb-2 text-xs font-extrabold text-slate-400">{title}</p>}
      <div className="flex items-start justify-center gap-3 overflow-x-auto py-1" dir="ltr">
        <div className="flex flex-col items-center gap-1">
          {showBackPage && <span className="badge bg-primary-50 text-primary-600 !py-0">الصفحة ١ — الوجوه</span>}
          {page('front')}
        </div>
        {showBackPage && (
          <div className="flex flex-col items-center gap-1">
            <span className="badge bg-violet-50 text-violet-600 !py-0">الصفحة ٢ — الظهور (معكوسة)</span>
            {page('back')}
          </div>
        )}
      </div>
      {(settings.flipPageH || settings.flipPageV) && (
        <p className="mt-1.5 text-center text-[11px] font-extrabold text-amber-600">
          ⇄ الصفحة تُطبع مقلوبة ({settings.flipPageH ? 'أفقياً' : ''}{settings.flipPageH && settings.flipPageV ? ' و' : ''}{settings.flipPageV ? 'رأسياً' : ''})
        </p>
      )}
    </section>
  );
}

// ---------- hidden mm-exact sheet ----------
export function PrintSheet({
  pages, layout, settings, rootId = 'card-print-root', mounted = true, backPages, hide = 'none',
}: {
  pages: SheetItem[][];
  layout: PageLayout;
  settings: CardPrintSettings;
  rootId?: string;
  mounted?: boolean; // false → not rendered at all (large sets mount only while printing)
  backPages: boolean; // separate mode → add a mirrored back page after every front page
  /** how the sheet is hidden on screen: display none, or laid out off-screen (images render while waiting) */
  hide?: 'none' | 'offscreen';
}) {
  // portal only after hydration (server HTML has no sheet)
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  if (!mounted || !ready) return null;
  const flip = pageFlipTransform(settings);
  const cls = rootId;
  return createPortal(
    <div id={rootId} dir="rtl">
      <style>{`
        #${cls} { ${hide === 'offscreen' ? 'position: fixed; left: -100000px; top: 0;' : 'display: none;'} }
        @media print {
          body > *:not(#${cls}) { display: none !important; }
          #${cls} { display: block !important; position: static !important; left: 0 !important; }
          @page { size: ${layout.paper.w}mm ${layout.paper.h}mm; margin: 0; }
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
          .card-print-page {
            width: ${layout.paper.w}mm;
            height: ${layout.paper.h}mm;
            position: relative;
            overflow: hidden;
            page-break-after: always;
            break-after: page;
            ${flip ? `transform: ${flip};` : ''}
          }
          .card-print-page:last-child { page-break-after: auto; break-after: auto; }
          .card-print-cell { position: absolute; }
          .card-print-centerline { position: absolute; background: #94a3b8; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
      {pages.map((pageItems, pi) => (
        <div key={pi} className="contents">
          <div className="card-print-page">
            <PageBody
              items={pageItems}
              layout={layout}
              settings={settings}
              scale={MM_TO_PX}
              side="front"
              unit="mm"
              itemKey={(i) => pageItems[i]?.key ?? String(i)}
            />
          </div>
          {backPages && (
            <div className="card-print-page">
              <PageBody
                items={pageItems}
                layout={layout}
                settings={settings}
                scale={MM_TO_PX}
                side="back"
                  unit="mm"
                itemKey={(i) => `b-${pageItems[i]?.key ?? i}`}
              />
            </div>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}
