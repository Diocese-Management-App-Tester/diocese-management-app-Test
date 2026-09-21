'use client';

// ============================================================
// BULK PRINT TAB — الطباعة الجماعية
// Data (generate / paste / Excel) → editable table → connect columns to the
// template (mapping + {{placeholders}}) → browse a preview → print all /
// a range / the checked rows on mm-exact pages. Uses the template's design
// and print settings as they are; the Card Designer itself is untouched.
// ============================================================

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Hash, ClipboardPaste, FileSpreadsheet, Table2, Link2, Eye, Printer, Plus, Trash2, X,
  ChevronRight, ChevronLeft, ChevronsRight, ChevronsLeft, CheckSquare, Square, Copy, Check,
  Wand2, Loader2, AlertTriangle, Braces, RotateCcw, Type, Columns3,
} from 'lucide-react';
import type { CardDesign, CardPrintSettings, CardTemplate, PaperSize, PaperOrientation } from '@/lib/card-types';
import { PAPER_SIZES, paperDims, newElement, DEFAULT_TEXT_STYLE, normalizePrint } from '@/lib/card-types';
import CardCanvas, { type CardConstantsData } from './CardCanvas';
import SourcePanel from './BulkSourcePanel';
import PreviewPane from './BulkPreviewPane';
import {
  type BulkDataset, type BulkColumn, type BulkRow, type BulkMapping,
  EMPTY_DATASET, MAPPABLE_FIELDS,
  uid, normalizeKey, uniqueKeys, autoMap, pruneMapping, rowToCardData, placeholdersInDesign, missingPlaceholders, parseRange,
  loadBulkState, saveBulkState, clearBulkState,
} from '@/lib/bulk-print';

// CSS defines 1in = 96px and 1in = 25.4mm → exact physical scale for print
const MM_TO_PX = 96 / 25.4;
const PAGE_SIZE = 50; // table rows per page

type Step = 'data' | 'connect' | 'preview' | 'print';
type Source = 'generate' | 'paste' | 'excel' | null;
type PrintMode = 'all' | 'range' | 'selected';

// ---------- tiny UI helpers ----------
function Num({
  label, value, onChange, min = 0, max = 100000, step = 1, suffix,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; suffix?: string;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-bold text-slate-500">
        {label}{suffix && <span className="text-slate-300"> ({suffix})</span>}
      </span>
      <input
        type="number"
        className="input-field !py-2 !px-2.5 !text-sm"
        value={value} min={min} max={max} step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        dir="ltr"
      />
    </label>
  );
}

function Text({
  label, value, onChange, placeholder, ltr = true,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; ltr?: boolean }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-bold text-slate-500">{label}</span>
      <input
        className="input-field !py-2 !px-2.5 !text-sm"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        dir={ltr ? 'ltr' : 'rtl'}
      />
    </label>
  );
}

const pill = (on: boolean, onCls = 'border-primary-300 bg-primary-50 text-primary-700') =>
  `rounded-xl border py-2 text-xs font-extrabold transition ${on ? onCls : 'border-slate-200 text-slate-400 hover:bg-slate-50'}`;

function CopyChip({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
    setDone(true);
    setTimeout(() => setDone(false), 1200);
  };
  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1 rounded-lg border border-indigo-100 bg-indigo-50/70 px-2 py-1 font-mono text-[11px] font-bold text-indigo-700 hover:bg-indigo-100"
      title="نسخ"
      dir="ltr"
    >
      {done ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
      {text}
    </button>
  );
}

// ============================================================
export default function BulkPrintTab({
  design, settings, constants, template, onDesignChange,
}: {
  design: CardDesign;
  settings: CardPrintSettings;         // the template's print settings (page layout)
  constants: CardConstantsData;        // template-scope constants (fallbacks)
  template: CardTemplate;
  /** optional: lets «أضف للتصميم» drop a {{placeholder}} text element into the design */
  onDesignChange?: (d: CardDesign) => void;
}) {
  // ---------- state ----------
  const [step, setStep] = useState<Step>('data');
  const [dataset, setDataset] = useState<BulkDataset>(EMPTY_DATASET);
  const [mapping, setMapping] = useState<BulkMapping>({});
  const [selected, setSelected] = useState<Set<string>>(new Set()); // row ids
  const [source, setSource] = useState<Source>(null);
  const [page, setPage] = useState(0);
  const [cur, setCur] = useState(0); // preview index
  const [printMode, setPrintMode] = useState<PrintMode>('all');
  const [rangeText, setRangeText] = useState('1-50');
  const [perPageLimit, setPerPageLimit] = useState<number | null>(null);
  const [localPrint, setLocalPrint] = useState<CardPrintSettings>(() => normalizePrint(settings));
  const [printing, setPrinting] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // ---------- restore / persist per template (browser only) ----------
  useEffect(() => {
    const saved = loadBulkState(template.id);
    if (saved) {
      setDataset(saved.dataset);
      setMapping(saved.mapping ?? {});
      if (saved.dataset.rows.length) setRangeText(`1-${Math.min(50, saved.dataset.rows.length)}`);
    }
    setHydrated(true);
  }, [template.id]);

  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => saveBulkState(template.id, { dataset, mapping }), 400);
    return () => clearTimeout(t);
  }, [dataset, mapping, hydrated, template.id]);

  // keep the page layout in sync when the designer's print tab changes it
  useEffect(() => { setLocalPrint(normalizePrint(settings)); }, [settings]);

  // ---------- derived ----------
  const rows = dataset.rows;
  const columns = dataset.columns;
  const total = rows.length;
  const enabledCols = useMemo(() => columns.filter((c) => c.enabled), [columns]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageRows = useMemo(() => rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [rows, page]);
  useEffect(() => { if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1)); }, [page, pageCount]);
  useEffect(() => { if (cur > total - 1) setCur(Math.max(0, total - 1)); }, [cur, total]);

  const cardFor = useCallback(
    (row: BulkRow) => rowToCardData(row, columns, mapping, constants),
    [columns, mapping, constants],
  );

  const usedPlaceholders = useMemo(() => placeholdersInDesign(design), [design]);
  const missing = useMemo(() => missingPlaceholders(design, columns), [design, columns]);

  // ---------- dataset mutators ----------
  const replaceDataset = (d: BulkDataset) => {
    setDataset(d);
    setMapping((m) => autoMap(d.columns, pruneMapping(m, d.columns)));
    setSelected(new Set());
    setPage(0);
    setCur(0);
    setRangeText(`1-${Math.min(50, d.rows.length) || 1}`);
    setSource(null);
  };

  // append rows of another dataset — columns matched by key, new keys become new columns
  const appendDataset = (d: BulkDataset) => {
    setDataset((prev) => {
      const cols = [...prev.columns];
      const keyToId = new Map(cols.map((c) => [c.key.toLowerCase(), c.id]));
      const map = new Map<string, string>(); // incoming colId → our colId
      d.columns.forEach((c) => {
        const ex = keyToId.get(c.key.toLowerCase());
        if (ex) map.set(c.id, ex);
        else { const nc: BulkColumn = { id: uid('c'), key: c.key, enabled: true }; cols.push(nc); keyToId.set(c.key.toLowerCase(), nc.id); map.set(c.id, nc.id); }
      });
      const newRows: BulkRow[] = d.rows.map((r) => {
        const cells: Record<string, string> = {};
        cols.forEach((c) => { cells[c.id] = ''; });
        Object.entries(r.cells).forEach(([cid, v]) => { const ours = map.get(cid); if (ours) cells[ours] = v; });
        return { id: uid('r'), cells };
      });
      // back-fill new columns in the old rows
      const oldRows = prev.rows.map((r) => { const cells = { ...r.cells }; cols.forEach((c) => { if (!(c.id in cells)) cells[c.id] = ''; }); return { ...r, cells }; });
      const next = { columns: cols, rows: [...oldRows, ...newRows] };
      setMapping((m) => autoMap(next.columns, pruneMapping(m, next.columns)));
      return next;
    });
    setSource(null);
  };

  const updateCell = (rowId: string, colId: string, value: string) =>
    setDataset((d) => ({ ...d, rows: d.rows.map((r) => (r.id === rowId ? { ...r, cells: { ...r.cells, [colId]: value } } : r)) }));

  const addRow = () => {
    const cells: Record<string, string> = {};
    columns.forEach((c) => { cells[c.id] = ''; });
    const r: BulkRow = { id: uid('r'), cells };
    setDataset((d) => ({ ...d, rows: [...d.rows, r] }));
    setPage(Math.floor(total / PAGE_SIZE));
  };
  const deleteRow = (rowId: string) => {
    setDataset((d) => ({ ...d, rows: d.rows.filter((r) => r.id !== rowId) }));
    setSelected((s) => { const n = new Set(s); n.delete(rowId); return n; });
  };
  const deleteSelectedRows = () => {
    if (!selected.size) return;
    if (!confirm(`حذف ${selected.size} صف؟`)) return;
    setDataset((d) => ({ ...d, rows: d.rows.filter((r) => !selected.has(r.id)) }));
    setSelected(new Set());
  };
  const clearAll = () => {
    if (!confirm('مسح كل البيانات من هذا الجدول؟ (التصميم لا يتأثر)')) return;
    setDataset(EMPTY_DATASET);
    setMapping({});
    setSelected(new Set());
    clearBulkState(template.id);
    setSource(null);
  };

  const addColumn = () => {
    const key = uniqueKeys([...columns.map((c) => c.key), `col${columns.length + 1}`]).pop()!;
    const c: BulkColumn = { id: uid('c'), key, enabled: true };
    setDataset((d) => ({ columns: [...d.columns, c], rows: d.rows.map((r) => ({ ...r, cells: { ...r.cells, [c.id]: '' } })) }));
  };
  const renameColumn = (colId: string, raw: string) => {
    setDataset((d) => {
      const others = d.columns.filter((c) => c.id !== colId).map((c) => c.key.toLowerCase());
      let key = normalizeKey(raw, d.columns.findIndex((c) => c.id === colId));
      let n = 2;
      const base = key;
      while (others.includes(key.toLowerCase())) key = `${base}_${n++}`;
      return { ...d, columns: d.columns.map((c) => (c.id === colId ? { ...c, key } : c)) };
    });
  };
  const toggleColumn = (colId: string) => {
    setDataset((d) => {
      const next = { ...d, columns: d.columns.map((c) => (c.id === colId ? { ...c, enabled: !c.enabled } : c)) };
      setMapping((m) => pruneMapping(m, next.columns));
      return next;
    });
  };
  const deleteColumn = (colId: string) => {
    if (!confirm('حذف هذا العمود وكل قيمه؟')) return;
    setDataset((d) => {
      const next = {
        columns: d.columns.filter((c) => c.id !== colId),
        rows: d.rows.map((r) => { const cells = { ...r.cells }; delete cells[colId]; return { ...r, cells }; }),
      };
      setMapping((m) => pruneMapping(m, next.columns));
      return next;
    });
  };

  // ---------- selection ----------
  const toggleRow = (id: string) =>
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  const togglePage = () =>
    setSelected((s) => { const n = new Set(s); if (allPageSelected) pageRows.forEach((r) => n.delete(r.id)); else pageRows.forEach((r) => n.add(r.id)); return n; });
  const selectAll = () => setSelected(new Set(rows.map((r) => r.id)));
  const selectNone = () => setSelected(new Set());

  // ---------- add a {{placeholder}} text element to the design ----------
  const addPlaceholderToDesign = (key: string) => {
    if (!onDesignChange) return;
    const el = newElement('text', {
      text: `{{${key}}}`,
      x: Math.max(2, design.width / 2 - 20),
      y: Math.max(2, design.height / 2 - 4),
      w: 40,
      h: 8,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 11 },
    });
    onDesignChange({ ...design, elements: [...design.elements, el] });
  };

  // ---------- print set ----------
  const printRows = useMemo<BulkRow[]>(() => {
    if (printMode === 'all') return rows;
    if (printMode === 'selected') return rows.filter((r) => selected.has(r.id));
    const idx = parseRange(rangeText, total);
    return idx.map((i) => rows[i - 1]).filter(Boolean);
  }, [printMode, rows, selected, rangeText, total]);

  // ---------- page layout math (same formulas as the designer's print tab) ----------
  const paper = paperDims(localPrint);
  const usableW = paper.w - localPrint.marginRight - localPrint.marginLeft;
  const usableH = paper.h - localPrint.marginTop - localPrint.marginBottom;
  const cols = Math.max(0, Math.floor((usableW + localPrint.gapX) / (design.width + localPrint.gapX)));
  const rowsPerPage = Math.max(0, Math.floor((usableH + localPrint.gapY) / (design.height + localPrint.gapY)));
  const maxPerPage = cols * rowsPerPage;
  const perPage = maxPerPage > 0 ? Math.min(maxPerPage, Math.max(1, perPageLimit ?? maxPerPage)) : 0;
  const printCount = printRows.length;
  const pages = perPage > 0 ? Math.ceil(printCount / perPage) : 0;

  const gridW = cols > 0 ? cols * design.width + (cols - 1) * localPrint.gapX : 0;
  const gridH = rowsPerPage > 0 ? rowsPerPage * design.height + (rowsPerPage - 1) * localPrint.gapY : 0;
  const alignH = localPrint.alignH ?? 'center';
  const alignV = localPrint.alignV ?? 'top';
  const offsetX = alignH === 'left' ? 0 : alignH === 'center' ? (usableW - gridW) / 2 : usableW - gridW;
  const offsetY = alignV === 'top' ? 0 : alignV === 'center' ? (usableH - gridH) / 2 : usableH - gridH;
  const cellLeft = (col: number) => localPrint.marginLeft + offsetX + col * (design.width + localPrint.gapX);
  const cellTop = (row: number) => localPrint.marginTop + offsetY + row * (design.height + localPrint.gapY);
  const previewScale = Math.min(300 / paper.w, 380 / paper.h);

  const printPages = useMemo(() => {
    if (perPage === 0) return [] as BulkRow[][];
    const out: BulkRow[][] = [];
    for (let i = 0; i < printRows.length; i += perPage) out.push(printRows.slice(i, i + perPage));
    return out;
  }, [printRows, perPage]);

  const doPrint = () => {
    if (!printCount || !perPage) return;
    setPrinting(true);
    // the hidden sheet mounts only now — give QR codes / images time to render
    const wait = Math.min(8000, 900 + printCount * 6);
    setTimeout(() => {
      window.print();
      setTimeout(() => setPrinting(false), 500);
    }, wait);
  };

  const setP = (patch: Partial<CardPrintSettings>) => setLocalPrint((p) => ({ ...p, ...patch }));

  // ---------- render ----------
  const steps: { id: Step; label: string; icon: ReactNode; badge?: string }[] = [
    { id: 'data', label: 'البيانات', icon: <Table2 className="h-4 w-4" />, badge: total ? String(total) : undefined },
    { id: 'connect', label: 'الربط', icon: <Link2 className="h-4 w-4" />, badge: missing.length ? '!' : undefined },
    { id: 'preview', label: 'المعاينة', icon: <Eye className="h-4 w-4" /> },
    { id: 'print', label: 'الطباعة', icon: <Printer className="h-4 w-4" /> },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- sub-steps ---------- */}
      <div className="grid grid-cols-4 gap-1 rounded-2xl bg-white p-1 shadow-card border border-indigo-50">
        {steps.map((s) => (
          <button
            key={s.id}
            onClick={() => setStep(s.id)}
            className={`relative flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-extrabold transition ${
              step === s.id ? 'bg-emerald-600 text-white shadow' : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            {s.icon} {s.label}
            {s.badge && (
              <span className={`absolute -top-1.5 left-1 rounded-full px-1.5 text-[9px] font-extrabold ${s.badge === '!' ? 'bg-amber-400 text-amber-950' : 'bg-emerald-100 text-emerald-800'}`}>
                {s.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ======================= DATA ======================= */}
      {step === 'data' && (
        <>
          {(total === 0 || source) ? (
            <SourcePanel
              source={source}
              setSource={setSource}
              hasData={total > 0}
              dataset={dataset}
              onReplace={replaceDataset}
              onAppend={appendDataset}
              onFillColumn={(colId, values, createKey) => {
                setDataset((d) => {
                  let cols = d.columns;
                  let id = colId;
                  if (!id) {
                    const key = uniqueKeys([...cols.map((c) => c.key), createKey || 'code']).pop()!;
                    const c: BulkColumn = { id: uid('c'), key, enabled: true };
                    cols = [...cols, c];
                    id = c.id;
                  }
                  const rowsNext = d.rows.map((r, i) => ({ ...r, cells: { ...r.cells, [id!]: values[i] ?? r.cells[id!] ?? '' } }));
                  // more codes than rows → append rows
                  for (let i = d.rows.length; i < values.length; i++) {
                    const cells: Record<string, string> = {};
                    cols.forEach((c) => { cells[c.id] = ''; });
                    cells[id!] = values[i];
                    rowsNext.push({ id: uid('r'), cells });
                  }
                  const next = { columns: cols, rows: rowsNext };
                  setMapping((m) => autoMap(next.columns, pruneMapping(m, next.columns)));
                  return next;
                });
                setSource(null);
              }}
            />
          ) : null}

          {total > 0 && !source && (
            <section className="card !p-3">
              {/* toolbar */}
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-600">
                  <Table2 className="h-4 w-4 text-emerald-600" />
                  جدول البيانات
                  <span className="badge bg-emerald-100 text-emerald-800">{total} كارت</span>
                  <span className="badge bg-slate-100 text-slate-500">{enabledCols.length} / {columns.length} عمود</span>
                </h3>
                <div className="flex flex-wrap items-center gap-1">
                  <button onClick={() => setSource('generate')} className="btn-secondary !py-1.5 !px-2.5 flex items-center gap-1 text-xs"><Hash className="h-3.5 w-3.5" /> أكواد</button>
                  <button onClick={() => setSource('paste')} className="btn-secondary !py-1.5 !px-2.5 flex items-center gap-1 text-xs"><ClipboardPaste className="h-3.5 w-3.5" /> لصق</button>
                  <button onClick={() => setSource('excel')} className="btn-secondary !py-1.5 !px-2.5 flex items-center gap-1 text-xs"><FileSpreadsheet className="h-3.5 w-3.5" /> Excel</button>
                  <button onClick={clearAll} className="flex items-center gap-1 rounded-xl border border-red-100 px-2.5 py-1.5 text-xs font-extrabold text-red-500 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /> مسح</button>
                </div>
              </div>

              <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-500">
                <button onClick={addRow} className="flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-emerald-700 hover:bg-emerald-100"><Plus className="h-3.5 w-3.5" /> صف</button>
                <button onClick={addColumn} className="flex items-center gap-1 rounded-lg bg-indigo-50 px-2 py-1 text-indigo-700 hover:bg-indigo-100"><Columns3 className="h-3.5 w-3.5" /> عمود</button>
                <span className="mx-1 text-slate-200">|</span>
                <button onClick={selectAll} className="hover:underline">تحديد الكل</button>
                <button onClick={selectNone} className="hover:underline">إلغاء التحديد</button>
                <button onClick={deleteSelectedRows} disabled={!selected.size} className="flex items-center gap-1 text-red-500 hover:underline disabled:opacity-30">
                  <Trash2 className="h-3.5 w-3.5" /> حذف المحدد ({selected.size})
                </button>
                <span className="ms-auto text-slate-400">☑ في رأس العمود = متاح للتصميم كـ {'{{'}اسم_العمود{'}}'}</span>
              </div>

              {/* table */}
              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full min-w-[520px] border-collapse text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="w-8 border-b border-slate-100 p-1.5">
                        <button onClick={togglePage} className="text-slate-400" title="تحديد صفوف هذه الصفحة">
                          {allPageSelected ? <CheckSquare className="h-4 w-4 text-emerald-600" /> : <Square className="h-4 w-4" />}
                        </button>
                      </th>
                      <th className="w-10 border-b border-slate-100 p-1.5 text-[10px] font-extrabold text-slate-400">#</th>
                      {columns.map((c) => (
                        <th key={c.id} className={`min-w-[120px] border-b border-slate-100 p-1 text-start ${c.enabled ? '' : 'opacity-50'}`}>
                          <div className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={c.enabled}
                              onChange={() => toggleColumn(c.id)}
                              className="h-3.5 w-3.5 shrink-0 accent-emerald-600"
                              title="متاح للتصميم"
                            />
                            <input
                              className="w-full min-w-0 rounded-md border border-transparent bg-transparent px-1 py-0.5 font-mono text-[11px] font-extrabold text-slate-700 hover:border-slate-200 focus:border-emerald-300 focus:bg-white focus:outline-none"
                              defaultValue={c.key}
                              key={c.key}
                              onBlur={(e) => { if (e.target.value !== c.key) renameColumn(c.id, e.target.value); }}
                              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                              dir="ltr"
                            />
                            <button onClick={() => deleteColumn(c.id)} className="shrink-0 rounded p-0.5 text-slate-300 hover:bg-red-50 hover:text-red-500" title="حذف العمود">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </th>
                      ))}
                      <th className="w-8 border-b border-slate-100 p-1.5">
                        <button onClick={addColumn} className="rounded p-0.5 text-indigo-400 hover:bg-indigo-50" title="إضافة عمود"><Plus className="h-4 w-4" /></button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r, i) => {
                      const n = page * PAGE_SIZE + i + 1;
                      const sel = selected.has(r.id);
                      return (
                        <tr key={r.id} className={`${sel ? 'bg-emerald-50/60' : i % 2 ? 'bg-slate-50/40' : ''} hover:bg-indigo-50/30`}>
                          <td className="border-b border-slate-50 p-1.5 text-center">
                            <button onClick={() => toggleRow(r.id)} className="text-slate-300">
                              {sel ? <CheckSquare className="h-4 w-4 text-emerald-600" /> : <Square className="h-4 w-4" />}
                            </button>
                          </td>
                          <td className="border-b border-slate-50 p-1.5 text-center text-[10px] font-extrabold tabular-nums text-slate-400">
                            <button onClick={() => { setCur(n - 1); setStep('preview'); }} className="hover:text-emerald-700 hover:underline" title="معاينة هذا الكارت">{n}</button>
                          </td>
                          {columns.map((c) => (
                            <td key={c.id} className={`border-b border-slate-50 p-0.5 ${c.enabled ? '' : 'opacity-40'}`}>
                              <input
                                className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-xs font-bold text-slate-700 hover:border-slate-200 focus:border-emerald-300 focus:bg-white focus:outline-none"
                                value={r.cells[c.id] ?? ''}
                                onChange={(e) => updateCell(r.id, c.id, e.target.value)}
                                dir="auto"
                              />
                            </td>
                          ))}
                          <td className="border-b border-slate-50 p-1 text-center">
                            <button onClick={() => deleteRow(r.id)} className="rounded p-0.5 text-slate-300 hover:bg-red-50 hover:text-red-500" title="حذف الصف"><X className="h-3.5 w-3.5" /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* pagination */}
              {pageCount > 1 && (
                <div className="mt-2 flex items-center justify-center gap-2 text-xs font-extrabold text-slate-500" dir="rtl">
                  <button onClick={() => setPage(0)} disabled={page === 0} className="rounded-lg p-1 hover:bg-slate-100 disabled:opacity-30"><ChevronsRight className="h-4 w-4" /></button>
                  <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="rounded-lg p-1 hover:bg-slate-100 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
                  <span>صفحة {page + 1} من {pageCount} · الصفوف {page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)}</span>
                  <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1} className="rounded-lg p-1 hover:bg-slate-100 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
                  <button onClick={() => setPage(pageCount - 1)} disabled={page >= pageCount - 1} className="rounded-lg p-1 hover:bg-slate-100 disabled:opacity-30"><ChevronsLeft className="h-4 w-4" /></button>
                </div>
              )}

              <button onClick={() => setStep('connect')} className="btn-primary mt-3 w-full !py-2.5 flex items-center justify-center gap-2 text-sm !from-emerald-600 !to-emerald-500">
                <Link2 className="h-4 w-4" /> التالي: ربط البيانات بالتصميم
              </button>
            </section>
          )}
        </>
      )}

      {/* ======================= CONNECT ======================= */}
      {step === 'connect' && (
        <>
          {total === 0 && (
            <div className="card py-8 text-center text-sm font-bold text-slate-400">
              أضف البيانات أولاً من تبويب «البيانات».
            </div>
          )}
          {total > 0 && (
            <>
              {/* placeholders */}
              <section className="card">
                <h3 className="mb-1 flex items-center gap-1.5 text-sm font-extrabold text-slate-600">
                  <Braces className="h-4 w-4 text-emerald-600" /> الحقول الديناميكية
                </h3>
                <p className="mb-2 text-[11px] font-bold text-slate-400">
                  اكتب أي حقل بهذا الشكل داخل عنصر «نص ثابت» (أو في «نص قبل القيمة») في تبويب التصميم — يُستبدل ببيانات كل صف تلقائياً. يمكن الجمع: <span className="font-mono" dir="ltr">{'{{name}} — {{class}}'}</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {enabledCols.map((c) => (
                    <div key={c.id} className="flex items-center gap-0.5">
                      <CopyChip text={`{{${c.key}}}`} />
                      {onDesignChange && (
                        <button
                          onClick={() => addPlaceholderToDesign(c.key)}
                          className="rounded-lg border border-emerald-100 bg-emerald-50 p-1 text-emerald-700 hover:bg-emerald-100"
                          title="إضافة كعنصر نص في التصميم"
                        >
                          <Type className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  {enabledCols.length === 0 && <span className="text-xs font-bold text-amber-600">لا توجد أعمدة مفعّلة — فعّل ☑ في رأس العمود.</span>}
                </div>
                {onDesignChange && <p className="mt-1.5 text-[10px] font-bold text-slate-400">الزر <Type className="inline h-3 w-3" /> يضيف الحقل كعنصر نص في وسط الكارت — انتقل لتبويب «التصميم» لتحريكه وتنسيقه ثم احفظ.</p>}

                {/* what the design uses */}
                <div className="mt-3 rounded-xl bg-slate-50 p-2.5 text-[11px] font-bold text-slate-500">
                  {usedPlaceholders.length ? (
                    <>
                      <span className="text-slate-600">الحقول المستخدمة في التصميم الآن:</span>{' '}
                      {usedPlaceholders.map((p) => (
                        <span key={p} className={`me-1 inline-block rounded-md px-1.5 font-mono ${missing.includes(p) ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`} dir="ltr">{`{{${p}}}`}</span>
                      ))}
                    </>
                  ) : (
                    <>التصميم لا يحتوي على حقول <span className="font-mono" dir="ltr">{'{{…}}'}</span> بعد — العناصر القياسية (الاسم · الهاتف · QR …) تُملأ من الربط أدناه.</>
                  )}
                  {missing.length > 0 && (
                    <p className="mt-1 flex items-start gap-1 text-amber-700">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      حقول في التصميم بلا عمود مطابق (ستُطبع فارغة): {missing.map((m) => `{{${m}}}`).join(' · ')} — أعد تسمية العمود بنفس الاسم أو صحّح التصميم.
                    </p>
                  )}
                </div>
              </section>

              {/* mapping */}
              <section className="card">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-600">
                    <Link2 className="h-4 w-4 text-emerald-600" /> ربط الأعمدة بعناصر القالب
                  </h3>
                  <button onClick={() => setMapping(autoMap(columns, {}))} className="flex items-center gap-1 text-xs font-extrabold text-emerald-700 hover:underline">
                    <Wand2 className="h-3.5 w-3.5" /> ربط تلقائي
                  </button>
                </div>
                <p className="mb-2 text-[11px] font-bold text-slate-400">
                  عناصر القالب الجاهزة (الاسم · الهاتف · الرقم القومي/QR · الصورة · الثوابت) تقرأ كل منها عموداً من الجدول. غير المربوط يبقى فارغاً (والثوابت تحتفظ بقيم القالب).
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {MAPPABLE_FIELDS.map((f) => (
                    <label key={f.value} className="block">
                      <span className="mb-0.5 block text-[11px] font-bold text-slate-500">{f.label} <span className="text-slate-300">— {f.hint}</span></span>
                      <select
                        className="input-field !py-2 !px-2.5 !text-sm"
                        value={mapping[f.value] ?? ''}
                        onChange={(e) => setMapping((m) => { const n = { ...m }; if (e.target.value) n[f.value] = e.target.value; else delete n[f.value]; return n; })}
                      >
                        <option value="">— بدون —</option>
                        {enabledCols.map((c) => <option key={c.id} value={c.id}>{c.key}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
                {!mapping.national_id && enabledCols[0] && (
                  <p className="mt-2 text-[11px] font-bold text-slate-400">
                    بدون ربط «الكود / QR»: يُستخدم أول عمود مفعّل (<span className="font-mono" dir="ltr">{enabledCols[0].key}</span>) لرمز QR والرقم القومي.
                  </p>
                )}
              </section>

              <button onClick={() => setStep('preview')} className="btn-primary w-full !py-2.5 flex items-center justify-center gap-2 text-sm !from-emerald-600 !to-emerald-500">
                <Eye className="h-4 w-4" /> التالي: معاينة الكروت
              </button>
            </>
          )}
        </>
      )}

      {/* ======================= PREVIEW ======================= */}
      {step === 'preview' && (
        <>
          {total === 0 ? (
            <div className="card py-8 text-center text-sm font-bold text-slate-400">لا توجد بيانات للمعاينة.</div>
          ) : (
            <PreviewPane
              design={design}
              row={rows[cur]}
              index={cur}
              total={total}
              onIndex={setCur}
              cardFor={cardFor}
              columns={enabledCols}
              onNext={() => setStep('print')}
            />
          )}
        </>
      )}

      {/* ======================= PRINT ======================= */}
      {step === 'print' && (
        <>
          {total === 0 ? (
            <div className="card py-8 text-center text-sm font-bold text-slate-400">لا توجد بيانات للطباعة.</div>
          ) : (
            <>
              {/* what to print */}
              <section className="card">
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-slate-600">
                  <Printer className="h-4 w-4 text-emerald-600" /> ماذا تطبع؟
                </h3>
                <div className="grid grid-cols-3 gap-1">
                  <button onClick={() => setPrintMode('all')} className={pill(printMode === 'all', 'border-emerald-300 bg-emerald-50 text-emerald-700')}>كل الكروت ({total})</button>
                  <button onClick={() => setPrintMode('range')} className={pill(printMode === 'range', 'border-emerald-300 bg-emerald-50 text-emerald-700')}>نطاق</button>
                  <button onClick={() => setPrintMode('selected')} className={pill(printMode === 'selected', 'border-emerald-300 bg-emerald-50 text-emerald-700')}>المحدد ({selected.size})</button>
                </div>
                {printMode === 'range' && (
                  <div className="mt-2">
                    <Text label={`النطاق (1 – ${total}) — مثال: 1-50 أو 3, 7, 20-30`} value={rangeText} onChange={setRangeText} placeholder="1-50" />
                    <p className="mt-1 text-[11px] font-bold text-slate-400">{printCount} كارت في هذا النطاق</p>
                  </div>
                )}
                {printMode === 'selected' && selected.size === 0 && (
                  <p className="mt-2 text-[11px] font-bold text-amber-600">لم تحدد صفوفاً — حدّدها من ☑ في جدول البيانات.</p>
                )}
              </section>

              {/* page layout */}
              <section className="card">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-extrabold text-slate-600">تخطيط الصفحة</h3>
                  <button onClick={() => { setLocalPrint(normalizePrint(settings)); setPerPageLimit(null); }} className="flex items-center gap-1 text-xs font-extrabold text-slate-500 hover:underline">
                    <RotateCcw className="h-3.5 w-3.5" /> إعدادات القالب
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-0.5 block text-[11px] font-bold text-slate-500">مقاس الورق</span>
                    <select className="input-field !py-2 !px-2.5 !text-sm" value={localPrint.paper} onChange={(e) => setP({ paper: e.target.value as PaperSize })}>
                      {Object.entries(PAPER_SIZES).map(([v, p]) => <option key={v} value={v}>{p.label}</option>)}
                      <option value="custom">مخصص…</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-[11px] font-bold text-slate-500">الاتجاه</span>
                    <div className="flex gap-1">
                      {(['portrait', 'landscape'] as PaperOrientation[]).map((o) => (
                        <button key={o} onClick={() => setP({ orientation: o })} className={`flex-1 ${pill(localPrint.orientation === o, 'border-emerald-300 bg-emerald-50 text-emerald-700')} !py-2.5`}>
                          {o === 'portrait' ? '↕ طولي' : '↔ عرضي'}
                        </button>
                      ))}
                    </div>
                  </label>
                </div>
                {localPrint.paper === 'custom' && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Num label="عرض الورقة" suffix="مم" value={localPrint.customWidth} min={50} max={2000} onChange={(v) => setP({ customWidth: v })} />
                    <Num label="طول الورقة" suffix="مم" value={localPrint.customHeight} min={50} max={2000} onChange={(v) => setP({ customHeight: v })} />
                  </div>
                )}
                <div className="mt-2 grid grid-cols-4 gap-2">
                  <Num label="هامش أعلى" suffix="مم" value={localPrint.marginTop} max={100} onChange={(v) => setP({ marginTop: v })} />
                  <Num label="هامش أسفل" suffix="مم" value={localPrint.marginBottom} max={100} onChange={(v) => setP({ marginBottom: v })} />
                  <Num label="هامش يمين" suffix="مم" value={localPrint.marginRight} max={100} onChange={(v) => setP({ marginRight: v })} />
                  <Num label="هامش يسار" suffix="مم" value={localPrint.marginLeft} max={100} onChange={(v) => setP({ marginLeft: v })} />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Num label="مسافة أفقية" suffix="مم" value={localPrint.gapX} max={100} onChange={(v) => setP({ gapX: v })} />
                  <Num label="مسافة رأسية" suffix="مم" value={localPrint.gapY} max={100} onChange={(v) => setP({ gapY: v })} />
                  <Num
                    label="كارت في الصفحة"
                    suffix={`حد ${maxPerPage}`}
                    value={perPage}
                    min={1}
                    max={Math.max(1, maxPerPage)}
                    onChange={(v) => setPerPageLimit(Math.max(1, Math.min(maxPerPage, Math.floor(v) || 1)))}
                  />
                </div>
                <label className="mt-2 flex items-center gap-2 text-xs font-extrabold text-slate-600">
                  <input type="checkbox" checked={localPrint.cutMarks} onChange={(e) => setP({ cutMarks: e.target.checked })} className="h-4 w-4 accent-emerald-600" />
                  خطوط القص حول كل كارت
                </label>
                <div className="mt-3 rounded-xl bg-emerald-50/70 p-3 text-xs font-bold text-slate-600">
                  مقاس الكارت <span className="text-emerald-800" dir="ltr">{design.width}×{design.height} مم</span> (من القالب، لا يتغير) ·
                  التخطيط <span className="text-emerald-800">{cols} × {rowsPerPage}</span> = {perPage} كارت/صفحة
                  {printCount > 0 && perPage > 0 && <> · <span className="text-emerald-800">{printCount} كارت ← {pages} صفحة</span></>}
                  {maxPerPage === 0 && <span className="text-red-500"> — الكارت أكبر من مساحة الورقة!</span>}
                </div>
              </section>

              {/* first page preview */}
              <section className="card !p-3">
                <p className="mb-2 text-xs font-extrabold text-slate-400">معاينة الصفحة الأولى من {pages}</p>
                <div className="flex justify-center overflow-x-auto py-1" dir="ltr">
                  <div className="relative bg-white shadow-lg ring-1 ring-slate-200" style={{ width: paper.w * previewScale, height: paper.h * previewScale }}>
                    <div
                      className="absolute border border-dashed border-indigo-200"
                      style={{
                        top: localPrint.marginTop * previewScale, bottom: localPrint.marginBottom * previewScale,
                        left: localPrint.marginLeft * previewScale, right: localPrint.marginRight * previewScale,
                      }}
                    />
                    {perPage > 0 && Array.from({ length: maxPerPage }).map((_, i) => {
                      const col = i % cols;
                      const row = Math.floor(i / cols);
                      const r = i < perPage ? printRows[i] : undefined;
                      const data = r ? cardFor(r) : null;
                      return (
                        <div key={i} className="absolute" style={{ left: cellLeft(col) * previewScale, top: cellTop(row) * previewScale }}>
                          {data ? (
                            <CardCanvas design={design} scale={previewScale} person={data.person} constants={data.constants} />
                          ) : (
                            <div className="border border-dashed border-slate-200 bg-slate-50/60" style={{ width: design.width * previewScale, height: design.height * previewScale, borderRadius: design.cornerRadius * previewScale }} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>

              <button
                onClick={doPrint}
                disabled={printCount === 0 || perPage === 0 || printing}
                className="btn-primary w-full flex items-center justify-center gap-2 !from-emerald-600 !to-emerald-500"
              >
                {printing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Printer className="h-5 w-5" />}
                {printing ? 'جارٍ تجهيز الصفحات…' : `طباعة ${printCount > 0 ? `(${printCount} كارت — ${pages} صفحة)` : ''}`}
              </button>
              <p className="pb-2 text-center text-[11px] font-bold text-slate-400">
                في نافذة الطباعة: اختر نفس مقاس الورق ({localPrint.paper === 'custom' ? 'مخصص' : localPrint.paper}) واضبط الهوامش على «بلا / None» والمقياس على 100%.
                {printCount > 300 && ' · الأعداد الكبيرة تحتاج ثوانٍ لتجهيز رموز QR.'}
              </p>
            </>
          )}
        </>
      )}

      {/* ---------- hidden print sheet (mounted only while printing) ---------- */}
      {printing && typeof document !== 'undefined' && createPortal(
        <div id="bulk-print-root" dir="rtl">
          <style>{`
            #bulk-print-root { position: fixed; left: -100000px; top: 0; }
            @media print {
              body > *:not(#bulk-print-root) { display: none !important; }
              #bulk-print-root { display: block !important; position: static !important; left: 0 !important; }
              @page { size: ${paper.w}mm ${paper.h}mm; margin: 0; }
              html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
              .bulk-print-page {
                width: ${paper.w}mm; height: ${paper.h}mm; position: relative; overflow: hidden;
                page-break-after: always; break-after: page;
              }
              .bulk-print-page:last-child { page-break-after: auto; break-after: auto; }
              .bulk-print-cell { position: absolute; }
              .bulk-print-centerline { position: absolute; background: #94a3b8; }
              * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
            }
          `}</style>
          {printPages.map((pageRowsP, pi) => (
            <div key={pi} className="bulk-print-page">
              {localPrint.centerLineV && <div className="bulk-print-centerline" style={{ left: `${paper.w / 2}mm`, top: 0, width: '0.2mm', height: `${paper.h}mm` }} />}
              {localPrint.centerLineH && <div className="bulk-print-centerline" style={{ top: `${paper.h / 2}mm`, left: 0, height: '0.2mm', width: `${paper.w}mm` }} />}
              {pageRowsP.map((r, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                const data = cardFor(r);
                return (
                  <div
                    key={r.id}
                    className="bulk-print-cell"
                    style={{
                      left: `${cellLeft(col)}mm`, top: `${cellTop(row)}mm`,
                      width: `${design.width}mm`, height: `${design.height}mm`,
                      outline: localPrint.cutMarks ? '0.2mm solid #cbd5e1' : undefined,
                    }}
                  >
                    <CardCanvas design={design} scale={MM_TO_PX} person={data.person} constants={data.constants} />
                  </div>
                );
              })}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
