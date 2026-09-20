'use client';

// ---------- ReportPageView — draws ONE physical page ----------
// Used three times with the same code path so what you see is what you
// print: the designer canvas (interactive, scaled), the print portal (1 mm =
// 1 mm) and the PDF rasterizer (modern-screenshot → jsPDF). Everything is
// positioned in mm; `scale` = px per mm.

import { type CSSProperties, type ReactNode } from 'react';
import { Landmark, ImageIcon } from 'lucide-react';
import type { FieldDef, ReportDesign, ReportElement, ReportRow, TextStyle } from '@/lib/reports/types';
import { CHART_COLORS, pageSize } from '@/lib/reports/types';
import {
  type LaidOutPage, type VariableBag, elementsOf, resolveText, tableColumns, formatCell, chartData, aggregate,
} from '@/lib/reports/engine';
import { ReportChart } from './ReportChart';

export const MM_TO_PX = 96 / 25.4;

export interface PageRenderProps {
  design: ReportDesign;
  lp: LaidOutPage;
  pageNo: number;
  pagesTotal: number;
  rows: ReportRow[];
  defs: Map<string, FieldDef>;
  vars: VariableBag;
  fields: { key: string; title?: string; width?: number; align?: 'right' | 'center' | 'left' }[];
  logoUrl: string | null;
  scale: number;
  /** designer hooks */
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onPointerDownElement?: (e: React.PointerEvent, el: ReportElement) => void;
  onPointerDownResize?: (e: React.PointerEvent, el: ReportElement) => void;
  showGuides?: boolean;
  children?: ReactNode;
}

const textStyleCss = (s: TextStyle | undefined, scale: number): CSSProperties => ({
  fontSize: `${((s?.fontSize ?? 11) * 25.4 / 72) * scale}px`,   // pt → mm → px
  fontWeight: s?.bold ? 800 : 500,
  fontStyle: s?.italic ? 'italic' : 'normal',
  color: s?.color ?? '#1e293b',
  textAlign: s?.align ?? 'right',
  backgroundColor: s?.bg || 'transparent',
  border: s?.borderColor ? `${0.3 * scale}px solid ${s.borderColor}` : undefined,
  borderRadius: s?.radius ? `${s.radius * scale}px` : undefined,
  lineHeight: 1.35,
});

const mm = (v: number, scale: number) => `${v * scale}px`;

export function ReportPageView(p: PageRenderProps) {
  const { design, lp, pageNo, pagesTotal, rows, defs, vars, logoUrl, scale } = p;
  const size = pageSize(design, lp.page);
  const els = elementsOf(lp);
  const pageInfo = { page: pageNo, pages: pagesTotal };
  const m = design.margins;
  const contentW = size.w - m.left - m.right;

  return (
    <div
      dir="rtl"
      className="report-page relative overflow-hidden bg-white"
      style={{ width: mm(size.w, scale), height: mm(size.h, scale), fontFamily: `${design.fontFamily}, Cairo, Tajawal, sans-serif` }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) p.onSelect?.(null); }}
    >
      {/* margins guide */}
      {p.showGuides && (
        <div className="pointer-events-none absolute border border-dashed border-sky-300/70"
          style={{ left: mm(m.left, scale), top: mm(m.top, scale), width: mm(contentW, scale), height: mm(size.h - m.top - m.bottom, scale) }} />
      )}

      {/* header */}
      {design.header.enabled && (
        <div className="absolute flex items-center gap-2" style={{ left: mm(m.left, scale), top: mm(m.top, scale), width: mm(contentW, scale), height: mm(design.header.height, scale) }}>
          {design.header.showLogo && (
            logoUrl
              ? <img src={logoUrl} alt="" crossOrigin="anonymous" className="h-full shrink-0 object-contain" style={{ maxWidth: mm(design.header.height * 1.6, scale) }} />
              : <span className="flex h-full shrink-0 items-center justify-center text-slate-300" style={{ width: mm(design.header.height, scale) }}><Landmark className="h-3/5 w-3/5" /></span>
          )}
          <div className="min-w-0 flex-1 whitespace-pre-wrap" style={textStyleCss(design.header.style, scale)}>
            {resolveText(design.header.text, vars, rows, defs, pageInfo)}
          </div>
          {design.header.showLine && <div className="absolute bottom-0 left-0 right-0 bg-slate-300" style={{ height: mm(0.3, scale) }} />}
        </div>
      )}

      {/* footer */}
      {design.footer.enabled && (
        <div className="absolute" style={{ left: mm(m.left, scale), top: mm(size.h - m.bottom - design.footer.height, scale), width: mm(contentW, scale), height: mm(design.footer.height, scale) }}>
          {design.footer.showLine && <div className="absolute left-0 right-0 top-0 bg-slate-300" style={{ height: mm(0.3, scale) }} />}
          <div className="flex h-full items-center whitespace-pre-wrap" style={textStyleCss(design.footer.style, scale)}>
            <span className="flex-1">{resolveText(design.footer.text, vars, rows, defs, pageInfo)}</span>
          </div>
        </div>
      )}

      {/* page number */}
      {design.pageNumbers.enabled && (
        <div className="absolute flex items-center text-slate-500" style={{
          left: mm(m.left, scale), width: mm(contentW, scale), top: mm(size.h - m.bottom - 5, scale), height: mm(5, scale),
          fontSize: `${8 * 25.4 / 72 * scale}px`, justifyContent: design.pageNumbers.align === 'center' ? 'center' : design.pageNumbers.align === 'left' ? 'flex-end' : 'flex-start', fontWeight: 700,
        }}>
          {resolveText(design.pageNumbers.format, vars, rows, defs, pageInfo)}
        </div>
      )}

      {/* elements */}
      {els.map((el) => (
        <ElementView key={el.id} el={el} {...p} pageInfo={pageInfo} />
      ))}

      {p.children}
    </div>
  );
}

function ElementView({ el, lp, rows, defs, vars, fields, logoUrl, scale, selectedId, onSelect, onPointerDownElement, onPointerDownResize, pageInfo }:
  PageRenderProps & { el: ReportElement; pageInfo: { page: number; pages: number } }) {
  const selected = selectedId === el.id;
  const interactive = !!onPointerDownElement && !lp.continuation;
  const box: CSSProperties = {
    position: 'absolute', left: mm(el.x, scale), top: mm(el.y, scale), width: mm(el.w, scale), height: mm(el.h, scale),
    zIndex: (el.z ?? 0) + 1, cursor: interactive ? 'move' : undefined, touchAction: interactive ? 'none' : undefined,
  };

  let inner: ReactNode = null;
  switch (el.type) {
    case 'title':
    case 'text':
      inner = (
        <div className="h-full w-full overflow-hidden whitespace-pre-wrap break-words px-[2px]" style={{ ...textStyleCss(el.style, scale), display: 'flex', alignItems: el.type === 'title' ? 'center' : 'flex-start' }}>
          <span className="w-full">{resolveText(el.text, vars, rows, defs, pageInfo) || (interactive ? <span className="text-slate-300">نص…</span> : '')}</span>
        </div>
      );
      break;
    case 'logo':
    case 'image': {
      const url = el.type === 'logo' ? logoUrl : el.imageUrl ?? null;
      inner = url
        ? <img src={url} alt="" crossOrigin="anonymous" className="h-full w-full" style={{ objectFit: el.imageFit === 'stretch' ? 'fill' : el.imageFit ?? 'contain' }} />
        : <div className="flex h-full w-full items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-slate-300">{el.type === 'logo' ? <Landmark className="h-1/2 w-1/2" /> : <ImageIcon className="h-1/2 w-1/2" />}</div>;
      break;
    }
    case 'line':
      inner = <div className="w-full" style={{ height: mm(el.thickness ?? 0.5, scale), backgroundColor: el.color ?? '#94a3b8', marginTop: mm(Math.max(0, (el.h - (el.thickness ?? 0.5)) / 2), scale) }} />;
      break;
    case 'rect':
      inner = <div className="h-full w-full" style={{ backgroundColor: el.color ?? '#eef2ff', border: el.thickness ? `${mm(el.thickness, scale)} solid ${el.style?.borderColor || '#c7d2fe'}` : undefined, borderRadius: mm(el.style?.radius ?? 2, scale) }} />;
      break;
    case 'table':
      inner = <TableView el={el} rows={rows} defs={defs} fields={fields} scale={scale} slice={lp.tableSlices[el.id]} />;
      break;
    case 'chart': {
      const cfg = el.chart;
      const data = cfg ? chartData(rows, cfg, cfg.colors?.length ? cfg.colors : CHART_COLORS) : [];
      inner = cfg
        ? <ReportChart cfg={cfg} data={data} w={el.w * scale} h={el.h * scale} scale={scale} title={cfg.title ? resolveText(cfg.title, vars, rows, defs, pageInfo) : ''} />
        : <div className="flex h-full w-full items-center justify-center text-xs text-slate-300">رسم بياني</div>;
      break;
    }
  }

  return (
    <div
      id={interactive ? `report-el-${el.id}` : undefined}
      style={box}
      className={interactive ? `${selected ? 'ring-2 ring-fuchsia-500' : 'hover:ring-1 hover:ring-fuchsia-300'} select-none` : undefined}
      onPointerDown={interactive ? (e) => { e.stopPropagation(); onSelect?.(el.id); onPointerDownElement?.(e, el); } : undefined}
    >
      {inner}
      {interactive && selected && onPointerDownResize && (
        <div
          role="presentation"
          onPointerDown={(e) => { e.stopPropagation(); onPointerDownResize(e, el); }}
          className="absolute -bottom-1.5 -left-1.5 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-white bg-fuchsia-600 shadow"
          style={{ touchAction: 'none' }}
        />
      )}
    </div>
  );
}

function TableView({ el, rows, defs, fields, scale, slice }: {
  el: ReportElement; rows: ReportRow[]; defs: Map<string, FieldDef>; scale: number;
  fields: PageRenderProps['fields']; slice?: { from: number; to: number; last: boolean };
}) {
  const cfg = el.table!;
  const cols = tableColumns(fields, defs, el.w, cfg);
  const s = slice ?? { from: 0, to: Math.min(rows.length, Math.max(1, Math.floor((el.h - cfg.headerHeight) / cfg.rowHeight))), last: true };
  const body = rows.slice(s.from, s.to);
  const fs = `${cfg.fontSize * 25.4 / 72 * scale}px`;
  const border = cfg.borders ? `${Math.max(0.5, 0.2 * scale)}px solid ${cfg.borderColor}` : 'none';
  const indexW = cfg.showIndex ? 8 : 0;
  const cell = (w: number, align: string, extra?: CSSProperties): CSSProperties => ({
    width: mm(w, scale), minWidth: mm(w, scale), maxWidth: mm(w, scale), textAlign: align as CSSProperties['textAlign'],
    padding: `0 ${mm(1, scale)}`, border, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...extra,
  });

  if (fields.length === 0) {
    return <div className="flex h-full w-full items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-slate-400" style={{ fontSize: fs }}>الجدول — اختر الحقول في الخطوة ٢</div>;
  }

  return (
    <table dir="rtl" className="border-collapse" style={{ fontSize: fs, tableLayout: 'fixed', width: mm(el.w, scale), lineHeight: 1.2 }}>
      <thead>
        <tr style={{ height: mm(cfg.headerHeight, scale), backgroundColor: cfg.headerBg, color: cfg.headerColor, fontWeight: 800 }}>
          {cfg.showIndex && <th style={cell(indexW, 'center')}>#</th>}
          {cols.map((c) => <th key={c.field.key} style={cell(c.width, c.align)}>{c.title}</th>)}
        </tr>
      </thead>
      <tbody>
        {body.map((r, i) => (
          <tr key={String(r._id ?? i)} style={{ height: mm(cfg.rowHeight, scale), backgroundColor: cfg.striped && i % 2 ? '#f8fafc' : '#ffffff', color: '#1e293b' }}>
            {cfg.showIndex && <td style={cell(indexW, 'center', { color: '#64748b' })}>{s.from + i + 1}</td>}
            {cols.map((c) => {
              const v = r[c.field.key];
              return (
                <td key={c.field.key} style={cell(c.width, c.align, { fontWeight: 600 })}>
                  {c.def?.type === 'image'
                    ? (v ? <img src={String(v)} alt="" crossOrigin="anonymous" style={{ height: mm(cfg.rowHeight - 1, scale), width: mm(cfg.rowHeight - 1, scale), borderRadius: '50%', objectFit: 'cover', display: 'inline-block' }} /> : '')
                    : formatCell(v, c.def)}
                </td>
              );
            })}
          </tr>
        ))}
        {cfg.showTotals && s.last && (
          <tr style={{ height: mm(cfg.rowHeight, scale), backgroundColor: '#eef2ff', fontWeight: 800, color: '#312e81' }}>
            {cfg.showIndex && <td style={cell(indexW, 'center')}>Σ</td>}
            {cols.map((c, i) => (
              <td key={c.field.key} style={cell(c.width, c.align)}>
                {c.def?.numeric ? formatCell(aggregate(rows.map((r) => r[c.field.key]), 'sum'), c.def) : i === 0 && !cfg.showIndex ? 'الإجمالي' : ''}
              </td>
            ))}
          </tr>
        )}
      </tbody>
    </table>
  );
}
