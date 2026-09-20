'use client';

// ---------- Step 3 — تصميم التقرير ----------
// Pages strip (add · delete · reorder · orientation) → toolbar (add element)
// → canvas (drag to move · corner handle to resize · tap to select) →
// properties panel of the selected element / page setup (paper · margins ·
// header · footer · page numbers).

import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import {
  Plus, Trash2, ChevronRight, ChevronLeft, Copy, Type, AlignLeft, Image as ImageIcon, Landmark, Table2, PieChart, Minus, Square,
  RectangleVertical, RectangleHorizontal, Settings2, Layers, ArrowUp, ArrowDown, Upload, Loader2, MoveHorizontal, Braces,
} from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { uploadPhoto } from '@/lib/upload';
import type {
  ChartConfig, ChartKind, ElementType, FieldDef, ReportDesign, ReportElement, ReportPage, ReportRow, TextStyle, PaperKey, Orientation, TableConfig,
} from '@/lib/reports/types';
import {
  DEFAULT_CHART, DEFAULT_TABLE, DEFAULT_TEXT_STYLE, ELEMENT_LABELS, PAPERS, CHART_KIND_LABELS, AGGREGATE_LABELS, pageSize, uid,
} from '@/lib/reports/types';
import { type VariableBag, VARIABLES, clamp, round1, layoutPages } from '@/lib/reports/engine';
import { ReportPageView } from './ReportPageView';
import { ColorInput, Field, Num, Seg, Section, Toggle } from './ReportBits';

interface Drag { kind: 'move' | 'resize'; id: string; startX: number; startY: number; ox: number; oy: number; ow: number; oh: number }

export function DesignStep({
  design, onChange, rows, defs, vars, fields, logoUrl, supabase, flash,
}: {
  design: ReportDesign;
  onChange: (d: ReportDesign) => void;
  rows: ReportRow[];
  defs: Map<string, FieldDef>;
  vars: VariableBag;
  fields: { key: string; title?: string; width?: number; align?: 'right' | 'center' | 'left' }[];
  logoUrl: string | null;
  supabase: SupabaseClient;
  flash: (m: string) => void;
}) {
  const [pageIdx, setPageIdx] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<'element' | 'page' | 'vars'>('element');
  const [scale, setScale] = useState(2);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const page = design.pages[Math.min(pageIdx, design.pages.length - 1)];
  const size = pageSize(design, page);
  const selected = page?.elements.find((e) => e.id === selectedId) ?? null;

  // fit the page to the container width
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const fit = () => setScale(Math.max(0.8, Math.min(3, (el.clientWidth - 8) / size.w)));
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, [size.w]);

  useEffect(() => { if (pageIdx >= design.pages.length) setPageIdx(Math.max(0, design.pages.length - 1)); }, [design.pages.length, pageIdx]);

  // ---------- design mutations ----------
  const setDesign = (patch: Partial<ReportDesign>) => onChange({ ...design, ...patch });
  const setPages = (pages: ReportPage[]) => setDesign({ pages });
  const patchPage = (i: number, patch: Partial<ReportPage>) => setPages(design.pages.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  const setElements = (elements: ReportElement[]) => patchPage(pageIdx, { elements });
  const updateEl = (id: string, patch: Partial<ReportElement>) => setElements(page.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const removeEl = (id: string) => { setElements(page.elements.filter((e) => e.id !== id)); setSelectedId(null); };
  const duplicateEl = (el: ReportElement) => { const c = { ...el, id: uid(), x: el.x + 5, y: el.y + 5 }; setElements([...page.elements, c]); setSelectedId(c.id); };
  const zMove = (el: ReportElement, d: 1 | -1) => updateEl(el.id, { z: (el.z ?? 0) + d });

  const addEl = (type: ElementType) => {
    const cw = size.w - design.margins.left - design.margins.right;
    const x = design.margins.left;
    const y = design.margins.top + (design.header.enabled ? design.header.height : 0) + 4;
    const base: ReportElement = { id: uid(), type, x, y, w: cw, h: 12 };
    let el: ReportElement = base;
    switch (type) {
      case 'title': el = { ...base, h: 14, text: 'عنوان جديد', style: { ...DEFAULT_TEXT_STYLE, fontSize: 18, bold: true, align: 'center', color: '#312e81' } }; break;
      case 'text': el = { ...base, h: 10, text: 'نص — يمكنك استخدام المتغيرات مثل {church_name} و {count}', style: { ...DEFAULT_TEXT_STYLE } }; break;
      case 'image': el = { ...base, w: 40, h: 30, imageFit: 'contain' }; break;
      case 'logo': el = { ...base, x: x + cw - 30, w: 30, h: 30 }; break;
      case 'table': el = { ...base, h: 120, table: { ...DEFAULT_TABLE } }; break;
      case 'chart': {
        const numeric = Array.from(defs.values()).find((d) => d.numeric)?.key ?? '';
        const cat = fields.find((f) => defs.get(f.key)?.type === 'text')?.key ?? '';
        el = { ...base, h: 70, chart: { ...DEFAULT_CHART, categoryField: cat, valueField: numeric ? '' : '', aggregate: 'count' } };
        break;
      }
      case 'line': el = { ...base, h: 3, color: '#94a3b8', thickness: 0.5 }; break;
      case 'rect': el = { ...base, h: 30, color: '#eef2ff', thickness: 0, style: { ...DEFAULT_TEXT_STYLE, radius: 2, borderColor: '#c7d2fe' }, z: -1 }; break;
    }
    setElements([...page.elements, el]);
    setSelectedId(el.id);
    setPanel('element');
  };

  // ---------- pages ----------
  const addPage = () => { const p: ReportPage = { id: uid(), orientation: null, elements: [] }; setPages([...design.pages, p]); setPageIdx(design.pages.length); setSelectedId(null); };
  const duplicatePage = () => { const p: ReportPage = { ...page, id: uid(), elements: page.elements.map((e) => ({ ...e, id: uid() })) }; const next = [...design.pages]; next.splice(pageIdx + 1, 0, p); setPages(next); setPageIdx(pageIdx + 1); };
  const deletePage = () => { if (design.pages.length <= 1) return flash('لا يمكن حذف الصفحة الوحيدة'); if (!confirm('حذف هذه الصفحة وكل عناصرها؟')) return; setPages(design.pages.filter((_, i) => i !== pageIdx)); setPageIdx(Math.max(0, pageIdx - 1)); setSelectedId(null); };
  const movePage = (d: -1 | 1) => { const j = pageIdx + d; if (j < 0 || j >= design.pages.length) return; const next = [...design.pages]; const [x] = next.splice(pageIdx, 1); next.splice(j, 0, x); setPages(next); setPageIdx(j); };

  // ---------- drag / resize ----------
  const onDownEl = (e: RPointerEvent, el: ReportElement) => {
    dragRef.current = { kind: 'move', id: el.id, startX: e.clientX, startY: e.clientY, ox: el.x, oy: el.y, ow: el.w, oh: el.h };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onDownResize = (e: RPointerEvent, el: ReportElement) => {
    dragRef.current = { kind: 'resize', id: el.id, startX: e.clientX, startY: e.clientY, ox: el.x, oy: el.y, ow: el.w, oh: el.h };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: RPointerEvent) => {
    const d = dragRef.current; if (!d) return;
    const dx = (e.clientX - d.startX) / scale, dy = (e.clientY - d.startY) / scale;
    if (d.kind === 'move') {
      updateEl(d.id, { x: round1(clamp(d.ox + dx, -5, size.w - 5)), y: round1(clamp(d.oy + dy, -5, size.h - 5)) });
    } else {
      // handle sits bottom-LEFT (RTL): dragging left grows the width
      updateEl(d.id, { w: round1(clamp(d.ow - dx, 5, size.w + 10)), x: round1(d.ox + Math.min(dx, d.ow - 5)), h: round1(clamp(d.oh + dy, 3, size.h + 10)) });
    }
  };
  const onUp = () => { dragRef.current = null; };

  const layout = useMemo(() => layoutPages(design, rows.length), [design, rows.length]);
  const lp = layout.find((l) => l.pageIndex === pageIdx && !l.continuation) ?? layout[0];
  const contPages = layout.filter((l) => l.pageIndex === pageIdx && l.continuation).length;

  const uploadImage = async (f: File) => {
    if (!selected) return;
    setUploading(true);
    try { const url = await uploadPhoto(supabase, 'cards', f); updateEl(selected.id, { imageUrl: url }); }
    catch { flash('فشل رفع الصورة'); }
    finally { setUploading(false); }
  };

  const TOOLS: { type: ElementType; icon: typeof Type }[] = [
    { type: 'title', icon: Type }, { type: 'text', icon: AlignLeft }, { type: 'table', icon: Table2 }, { type: 'chart', icon: PieChart },
    { type: 'logo', icon: Landmark }, { type: 'image', icon: ImageIcon }, { type: 'line', icon: Minus }, { type: 'rect', icon: Square },
  ];

  return (
    <div className="space-y-3">
      {/* ---------- pages strip ---------- */}
      <div id="report-pages" className="card !p-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        <span className="shrink-0 text-[11px] font-extrabold text-slate-500 flex items-center gap-1"><Layers className="h-3.5 w-3.5" /> الصفحات</span>
        {design.pages.map((p, i) => {
          const s = pageSize(design, p);
          return (
            <button key={p.id} id={`report-page-${i}`} type="button" onClick={() => { setPageIdx(i); setSelectedId(null); }}
              className={`relative shrink-0 rounded-lg border bg-white transition ${i === pageIdx ? 'border-fuchsia-500 ring-2 ring-fuchsia-200' : 'border-slate-200'}`}
              style={{ width: s.w > s.h ? 40 : 30, height: s.w > s.h ? 30 : 40 }}>
              <span className="absolute inset-0 flex items-center justify-center text-xs font-extrabold text-slate-500">{i + 1}</span>
            </button>
          );
        })}
        <button type="button" onClick={addPage} className="flex h-10 w-8 shrink-0 items-center justify-center rounded-lg border border-dashed border-fuchsia-300 text-fuchsia-600" aria-label="إضافة صفحة"><Plus className="h-4 w-4" /></button>
        <span className="flex-1" />
        <button type="button" onClick={() => movePage(-1)} disabled={pageIdx === 0} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label="نقل يميناً"><ChevronRight className="h-4 w-4" /></button>
        <button type="button" onClick={() => movePage(1)} disabled={pageIdx === design.pages.length - 1} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label="نقل يساراً"><ChevronLeft className="h-4 w-4" /></button>
        <button type="button" onClick={duplicatePage} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="تكرار الصفحة"><Copy className="h-4 w-4" /></button>
        <button type="button" onClick={() => patchPage(pageIdx, { orientation: size.orientation === 'portrait' ? 'landscape' : 'portrait' })} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="تدوير الصفحة" title={size.orientation === 'portrait' ? 'طولي → عرضي' : 'عرضي → طولي'}>
          {size.orientation === 'portrait' ? <RectangleVertical className="h-4 w-4" /> : <RectangleHorizontal className="h-4 w-4" />}
        </button>
        <button type="button" onClick={deletePage} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500" aria-label="حذف الصفحة"><Trash2 className="h-4 w-4" /></button>
      </div>

      {/* ---------- toolbar ---------- */}
      <div id="report-tools" className="card !p-2 flex items-center gap-1 overflow-x-auto no-scrollbar">
        <span className="shrink-0 text-[11px] font-extrabold text-slate-500">إضافة:</span>
        {TOOLS.map((t) => (
          <button key={t.type} id={`report-add-${t.type}`} type="button" onClick={() => addEl(t.type)}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-bold text-slate-600 hover:border-fuchsia-300 hover:bg-fuchsia-50 hover:text-fuchsia-700 active:scale-95">
            <t.icon className="h-3.5 w-3.5" /> {ELEMENT_LABELS[t.type]}
          </button>
        ))}
        <span className="flex-1" />
        <button type="button" onClick={() => { setPanel('page'); setSelectedId(null); }} className={`shrink-0 rounded-lg p-1.5 ${panel === 'page' ? 'bg-fuchsia-100 text-fuchsia-700' : 'text-slate-500 hover:bg-slate-100'}`} aria-label="إعداد الصفحة" title="إعداد الصفحة"><Settings2 className="h-4 w-4" /></button>
        <button type="button" onClick={() => setPanel('vars')} className={`shrink-0 rounded-lg p-1.5 ${panel === 'vars' ? 'bg-fuchsia-100 text-fuchsia-700' : 'text-slate-500 hover:bg-slate-100'}`} aria-label="المتغيرات" title="المتغيرات"><Braces className="h-4 w-4" /></button>
      </div>

      {/* ---------- canvas ---------- */}
      <div ref={wrapRef} id="report-canvas" className="rounded-2xl bg-slate-200/70 p-1 overflow-hidden" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div className="mx-auto shadow-lg" style={{ width: size.w * scale }}>
          {lp && (
            <ReportPageView
              design={design} lp={lp} pageNo={layout.indexOf(lp) + 1} pagesTotal={layout.length}
              rows={rows} defs={defs} vars={vars} fields={fields} logoUrl={logoUrl} scale={scale}
              selectedId={selectedId} onSelect={(id) => { setSelectedId(id); if (id) setPanel('element'); }}
              onPointerDownElement={onDownEl} onPointerDownResize={onDownResize} showGuides
            />
          )}
        </div>
        <p className="mt-1 text-center text-[10px] font-bold text-slate-500">
          {PAPERS[design.paper].label} · {size.orientation === 'portrait' ? 'طولي' : 'عرضي'} · {size.w}×{size.h} مم
          {contPages > 0 && <> · الجدول يمتد على <span className="text-fuchsia-700">{contPages + 1}</span> صفحات ({rows.length.toLocaleString('ar-EG')} سجل)</>}
        </p>
      </div>

      {/* ---------- properties ---------- */}
      {panel === 'element' && selected && (
        <ElementPanel el={selected} update={(p) => updateEl(selected.id, p)} remove={() => removeEl(selected.id)} duplicate={() => duplicateEl(selected)}
          zUp={() => zMove(selected, 1)} zDown={() => zMove(selected, -1)} defs={defs} fields={fields} size={size} design={design}
          onUpload={() => fileRef.current?.click()} uploading={uploading} />
      )}
      {panel === 'element' && !selected && (
        <p className="card py-4 text-center text-xs font-bold text-slate-400">اضغط على عنصر في الصفحة لتعديله · اسحبه لتحريكه · اسحب الدائرة في ركنه لتغيير حجمه</p>
      )}
      {panel === 'page' && <PagePanel design={design} setDesign={setDesign} page={page} patchPage={(p) => patchPage(pageIdx, p)} />}
      {panel === 'vars' && <VarsPanel vars={vars} defs={defs} />}

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = ''; }} />
    </div>
  );
}

// ===================================================================
// Element properties
// ===================================================================
function ElementPanel({ el, update, remove, duplicate, zUp, zDown, defs, fields, size, onUpload, uploading }: {
  el: ReportElement; update: (p: Partial<ReportElement>) => void; remove: () => void; duplicate: () => void; zUp: () => void; zDown: () => void;
  defs: Map<string, FieldDef>; fields: { key: string }[]; size: { w: number; h: number }; design: ReportDesign; onUpload: () => void; uploading: boolean;
}) {
  const style = el.style ?? DEFAULT_TEXT_STYLE;
  const setStyle = (p: Partial<TextStyle>) => update({ style: { ...style, ...p } });
  const table = el.table ?? DEFAULT_TABLE;
  const setTable = (p: Partial<TableConfig>) => update({ table: { ...table, ...p } });
  const chart = el.chart ?? DEFAULT_CHART;
  const setChart = (p: Partial<ChartConfig>) => update({ chart: { ...chart, ...p } });
  const selectCls = 'input-field !py-1.5 !px-2 !text-xs';
  const allDefs = Array.from(defs.values()).filter((d) => d.type !== 'image');
  const numericDefs = allDefs.filter((d) => d.numeric);
  const isText = el.type === 'title' || el.type === 'text';

  return (
    <Section id="report-el-panel" title={ELEMENT_LABELS[el.type]} icon={<Settings2 className="h-4 w-4" />}
      right={
        <div className="flex gap-1">
          <button type="button" onClick={zDown} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title="إلى الخلف"><ArrowDown className="h-4 w-4" /></button>
          <button type="button" onClick={zUp} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title="إلى الأمام"><ArrowUp className="h-4 w-4" /></button>
          <button type="button" onClick={duplicate} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title="تكرار"><Copy className="h-4 w-4" /></button>
          <button type="button" onClick={remove} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500" title="حذف"><Trash2 className="h-4 w-4" /></button>
        </div>
      }>
      {/* position & size */}
      <div className="grid grid-cols-4 gap-2">
        <Num label="س" suffix="مم" value={el.x} min={-50} max={size.w + 50} onChange={(v) => update({ x: v })} />
        <Num label="ع" suffix="مم" value={el.y} min={-50} max={size.h + 50} onChange={(v) => update({ y: v })} />
        <Num label="العرض" suffix="مم" value={el.w} min={3} max={size.w + 50} onChange={(v) => update({ w: v })} />
        <Num label="الارتفاع" suffix="مم" value={el.h} min={2} max={size.h + 50} onChange={(v) => update({ h: v })} />
      </div>
      <div className="flex gap-1">
        <button type="button" onClick={() => update({ x: round1((size.w - el.w) / 2) })} className="flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600"><MoveHorizontal className="h-3.5 w-3.5" /> توسيط أفقي</button>
        <button type="button" onClick={() => update({ x: 12, w: size.w - 24 })} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600">بعرض الصفحة</button>
      </div>

      {/* text */}
      {isText && (
        <>
          <Field label="النص — استخدم {المتغيرات} من زر { } أعلى">
            <textarea className={`${selectCls} min-h-[60px]`} value={el.text ?? ''} onChange={(e) => update({ text: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Num label="حجم الخط" suffix="pt" value={style.fontSize} min={5} max={72} step={1} onChange={(v) => setStyle({ fontSize: v })} />
            <ColorInput label="اللون" value={style.color} onChange={(v) => setStyle({ color: v })} />
            <ColorInput label="الخلفية" value={style.bg ?? ''} onChange={(v) => setStyle({ bg: v })} allowNone />
            <ColorInput label="الإطار" value={style.borderColor ?? ''} onChange={(v) => setStyle({ borderColor: v })} allowNone />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Seg size="xs" value={style.align} onChange={(v) => setStyle({ align: v })} options={[{ value: 'right', label: 'يمين' }, { value: 'center', label: 'وسط' }, { value: 'left', label: 'يسار' }]} />
            <div className="flex gap-1">
              <button type="button" onClick={() => setStyle({ bold: !style.bold })} className={`flex-1 rounded-lg border px-2 py-1 text-xs font-extrabold ${style.bold ? 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700' : 'border-slate-200 text-slate-500'}`}>غامق</button>
              <button type="button" onClick={() => setStyle({ italic: !style.italic })} className={`flex-1 rounded-lg border px-2 py-1 text-xs italic ${style.italic ? 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700' : 'border-slate-200 text-slate-500'}`}>مائل</button>
            </div>
          </div>
        </>
      )}

      {/* image */}
      {el.type === 'image' && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input className={`${selectCls} flex-1`} dir="ltr" placeholder="https://… رابط الصورة" value={el.imageUrl ?? ''} onChange={(e) => update({ imageUrl: e.target.value })} />
            <button type="button" onClick={onUpload} disabled={uploading} className="btn-secondary flex items-center gap-1 !px-3 !py-1.5 text-xs">{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} رفع</button>
          </div>
          <Seg size="xs" value={el.imageFit ?? 'contain'} onChange={(v) => update({ imageFit: v })} options={[{ value: 'contain', label: 'احتواء' }, { value: 'cover', label: 'ملء' }, { value: 'stretch', label: 'تمديد' }]} />
        </div>
      )}
      {el.type === 'logo' && (
        <Seg size="xs" value={el.imageFit ?? 'contain'} onChange={(v) => update({ imageFit: v })} options={[{ value: 'contain', label: 'احتواء' }, { value: 'cover', label: 'ملء' }, { value: 'stretch', label: 'تمديد' }]} />
      )}

      {/* line / rect */}
      {(el.type === 'line' || el.type === 'rect') && (
        <div className="grid grid-cols-3 gap-2">
          <ColorInput label={el.type === 'line' ? 'لون الخط' : 'لون التعبئة'} value={el.color ?? '#94a3b8'} onChange={(v) => update({ color: v })} />
          <Num label={el.type === 'line' ? 'السُمك' : 'سُمك الإطار'} suffix="مم" value={el.thickness ?? 0.5} min={0} max={10} step={0.1} onChange={(v) => update({ thickness: v })} />
          {el.type === 'rect' && <ColorInput label="لون الإطار" value={style.borderColor ?? '#c7d2fe'} onChange={(v) => setStyle({ borderColor: v })} />}
          {el.type === 'rect' && <Num label="استدارة" suffix="مم" value={style.radius ?? 2} min={0} max={30} step={0.5} onChange={(v) => setStyle({ radius: v })} />}
        </div>
      )}

      {/* table */}
      {el.type === 'table' && (
        <div className="space-y-2">
          <p className="text-[11px] font-bold text-slate-400">الأعمدة = الحقول المختارة في الخطوة ٢ ({fields.length} عمود)</p>
          <div className="grid grid-cols-3 gap-2">
            <Num label="حجم الخط" suffix="pt" value={table.fontSize} min={5} max={20} step={0.5} onChange={(v) => setTable({ fontSize: v })} />
            <Num label="ارتفاع الصف" suffix="مم" value={table.rowHeight} min={4} max={30} onChange={(v) => setTable({ rowHeight: v })} />
            <Num label="ارتفاع الرأس" suffix="مم" value={table.headerHeight} min={4} max={30} onChange={(v) => setTable({ headerHeight: v })} />
            <ColorInput label="خلفية الرأس" value={table.headerBg} onChange={(v) => setTable({ headerBg: v })} />
            <ColorInput label="لون نص الرأس" value={table.headerColor} onChange={(v) => setTable({ headerColor: v })} />
            <ColorInput label="لون الحدود" value={table.borderColor} onChange={(v) => setTable({ borderColor: v })} />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Toggle label="عمود الترقيم #" checked={table.showIndex} onChange={(v) => setTable({ showIndex: v })} />
            <Toggle label="صفوف متبادلة اللون" checked={table.striped} onChange={(v) => setTable({ striped: v })} />
            <Toggle label="حدود الخلايا" checked={table.borders} onChange={(v) => setTable({ borders: v })} />
            <Toggle label="صف الإجمالي (للأرقام)" checked={table.showTotals} onChange={(v) => setTable({ showTotals: v })} />
            <Toggle label="يمتد على صفحات إضافية" checked={table.flow} onChange={(v) => setTable({ flow: v })} />
          </div>
        </div>
      )}

      {/* chart */}
      {el.type === 'chart' && (
        <div className="space-y-2">
          <Field label="عنوان الرسم (اختياري)"><input className={selectCls} value={chart.title ?? ''} onChange={(e) => setChart({ title: e.target.value })} /></Field>
          <Seg size="xs" value={chart.kind} onChange={(v) => setChart({ kind: v as ChartKind })}
            options={(Object.keys(CHART_KIND_LABELS) as ChartKind[]).map((k) => ({ value: k, label: CHART_KIND_LABELS[k] }))} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Field label="التجميع حسب (الفئة)">
              <select className={selectCls} value={chart.categoryField} onChange={(e) => setChart({ categoryField: e.target.value })}>
                <option value="">— بدون (قيمة واحدة)</option>
                {allDefs.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
            </Field>
            <Field label="القيمة">
              <select className={selectCls} value={chart.valueField} onChange={(e) => setChart({ valueField: e.target.value, aggregate: e.target.value ? (chart.aggregate === 'count' ? 'sum' : chart.aggregate) : 'count' })}>
                <option value="">عدد السجلات</option>
                {numericDefs.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
            </Field>
            <Field label="الحساب">
              <select className={selectCls} value={chart.aggregate} disabled={!chart.valueField} onChange={(e) => setChart({ aggregate: e.target.value as ChartConfig['aggregate'] })}>
                {(Object.keys(AGGREGATE_LABELS) as ChartConfig['aggregate'][]).map((a) => <option key={a} value={a}>{AGGREGATE_LABELS[a]}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Num label="أكبر N فئة (0 = الكل)" value={chart.topN} min={0} max={50} step={1} onChange={(v) => setChart({ topN: v })} />
            <Toggle label="إظهار القيم" checked={chart.showValues} onChange={(v) => setChart({ showValues: v })} />
            <Toggle label="مفتاح الألوان" checked={chart.showLegend} onChange={(v) => setChart({ showLegend: v })} />
          </div>
        </div>
      )}
    </Section>
  );
}

// ===================================================================
// Page setup
// ===================================================================
function PagePanel({ design, setDesign, page, patchPage }: { design: ReportDesign; setDesign: (p: Partial<ReportDesign>) => void; page: ReportPage; patchPage: (p: Partial<ReportPage>) => void }) {
  const selectCls = 'input-field !py-1.5 !px-2 !text-xs';
  const hf = (key: 'header' | 'footer') => {
    const v = design[key];
    const set = (p: Partial<typeof v>) => setDesign({ [key]: { ...v, ...p } } as Partial<ReportDesign>);
    return (
      <div className="rounded-xl border border-slate-100 p-2 space-y-2">
        <Toggle label={key === 'header' ? 'رأس الصفحة' : 'تذييل الصفحة'} checked={v.enabled} onChange={(x) => set({ enabled: x })} />
        {v.enabled && (
          <>
            <Field label="النص — يقبل المتغيرات مثل {church_name} · {page} · {pages}">
              <input className={selectCls} value={v.text} onChange={(e) => set({ text: e.target.value })} />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Num label="الارتفاع" suffix="مم" value={v.height} min={4} max={60} onChange={(x) => set({ height: x })} />
              <Num label="حجم الخط" suffix="pt" value={v.style.fontSize} min={5} max={30} step={1} onChange={(x) => set({ style: { ...v.style, fontSize: x } })} />
              <ColorInput label="اللون" value={v.style.color} onChange={(x) => set({ style: { ...v.style, color: x } })} />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <Seg size="xs" value={v.style.align} onChange={(x) => set({ style: { ...v.style, align: x } })} options={[{ value: 'right', label: 'يمين' }, { value: 'center', label: 'وسط' }, { value: 'left', label: 'يسار' }]} />
              <Toggle label="خط فاصل" checked={v.showLine} onChange={(x) => set({ showLine: x })} />
              {key === 'header' && <Toggle label="شعار الكنيسة" checked={!!v.showLogo} onChange={(x) => set({ showLogo: x })} />}
              <Toggle label="غامق" checked={v.style.bold} onChange={(x) => set({ style: { ...v.style, bold: x } })} />
            </div>
          </>
        )}
      </div>
    );
  };
  return (
    <Section id="report-page-panel" title="إعداد الصفحات" icon={<Settings2 className="h-4 w-4" />}>
      <Field label="عنوان التقرير — المتغير {report_title}">
        <input id="report-title" className={selectCls} value={design.title} onChange={(e) => setDesign({ title: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="مقاس الورق">
          <select className={selectCls} value={design.paper} onChange={(e) => setDesign({ paper: e.target.value as PaperKey })}>
            {(Object.keys(PAPERS) as PaperKey[]).map((k) => <option key={k} value={k}>{PAPERS[k].label} ({PAPERS[k].w}×{PAPERS[k].h})</option>)}
          </select>
        </Field>
        <Field label="الاتجاه الافتراضي">
          <Seg size="xs" value={design.orientation} onChange={(v) => setDesign({ orientation: v as Orientation })} options={[{ value: 'portrait', label: 'طولي' }, { value: 'landscape', label: 'عرضي' }]} />
        </Field>
      </div>
      <Field label="اتجاه هذه الصفحة">
        <Seg size="xs" value={page.orientation ?? 'default'} onChange={(v) => patchPage({ orientation: v === 'default' ? null : (v as Orientation) })}
          options={[{ value: 'default', label: 'الافتراضي' }, { value: 'portrait', label: 'طولي' }, { value: 'landscape', label: 'عرضي' }]} />
      </Field>
      <div className="grid grid-cols-4 gap-2">
        <Num label="هامش أعلى" suffix="مم" value={design.margins.top} max={60} onChange={(v) => setDesign({ margins: { ...design.margins, top: v } })} />
        <Num label="أسفل" suffix="مم" value={design.margins.bottom} max={60} onChange={(v) => setDesign({ margins: { ...design.margins, bottom: v } })} />
        <Num label="يمين" suffix="مم" value={design.margins.right} max={60} onChange={(v) => setDesign({ margins: { ...design.margins, right: v } })} />
        <Num label="يسار" suffix="مم" value={design.margins.left} max={60} onChange={(v) => setDesign({ margins: { ...design.margins, left: v } })} />
      </div>
      {hf('header')}
      {hf('footer')}
      <div className="rounded-xl border border-slate-100 p-2 space-y-2">
        <Toggle label="أرقام الصفحات" checked={design.pageNumbers.enabled} onChange={(v) => setDesign({ pageNumbers: { ...design.pageNumbers, enabled: v } })} />
        {design.pageNumbers.enabled && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="الصيغة"><input className={selectCls} value={design.pageNumbers.format} onChange={(e) => setDesign({ pageNumbers: { ...design.pageNumbers, format: e.target.value } })} /></Field>
            <Field label="الموضع">
              <Seg size="xs" value={design.pageNumbers.align} onChange={(v) => setDesign({ pageNumbers: { ...design.pageNumbers, align: v } })} options={[{ value: 'right', label: 'يمين' }, { value: 'center', label: 'وسط' }, { value: 'left', label: 'يسار' }]} />
            </Field>
          </div>
        )}
      </div>
    </Section>
  );
}

// ===================================================================
// Variables cheat-sheet
// ===================================================================
function VarsPanel({ vars, defs }: { vars: VariableBag; defs: Map<string, FieldDef> }) {
  const numeric = Array.from(defs.values()).filter((d) => d.numeric);
  const copy = (s: string) => { navigator.clipboard?.writeText(s).catch(() => {}); };
  return (
    <Section id="report-vars-panel" title="المتغيرات — اكتبها داخل أي نص أو رأس أو تذييل" icon={<Braces className="h-4 w-4" />}>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {VARIABLES.map((v) => (
          <li key={v.key}>
            <button type="button" onClick={() => copy(`{${v.key}}`)} className="flex w-full items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1.5 text-start hover:bg-fuchsia-50">
              <span className="text-xs font-bold text-slate-600">{v.label}</span>
              <span className="truncate text-[10px] text-slate-400">{vars[v.key] ?? ''}</span>
              <code className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[10px] font-extrabold text-fuchsia-700 ring-1 ring-fuchsia-100" dir="ltr">{`{${v.key}}`}</code>
            </button>
          </li>
        ))}
      </ul>
      {numeric.length > 0 && (
        <>
          <p className="mt-2 text-[11px] font-extrabold text-slate-500">حسابات على الأعمدة الرقمية: {'{sum:الحقل}'} · {'{avg:الحقل}'} · {'{min:الحقل}'} · {'{max:الحقل}'}</p>
          <ul className="flex flex-wrap gap-1">
            {numeric.map((d) => (
              <li key={d.key}>
                <button type="button" onClick={() => copy(`{sum:${d.key}}`)} className="rounded-lg bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-fuchsia-50">
                  {d.label} <code className="text-fuchsia-700" dir="ltr">{`{sum:${d.key}}`}</code>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-[10px] text-slate-400">الضغط على متغير ينسخه — ثم الصقه داخل نص العنصر.</p>
    </Section>
  );
}
