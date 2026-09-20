// ---------- REPORT ENGINE (pure functions, no React / no Supabase) ----------
// filterRows · sortRows · formatCell · aggregate · resolveVariables ·
// layoutTable (rows → pages). Used by the preview, the PDF / print renderer
// and the Excel exporter alike so every output shows the SAME data.

import type {
  Aggregate, ChartConfig, FieldDef, ReportContext, ReportDesign, ReportElement, ReportPage, ReportQuery, ReportRow,
  RowFilter, SelectedField, SortRule, TableConfig,
} from './types';
import { pageSize } from './types';

// ===================================================================
// Formatting
// ===================================================================
const nf = (digits = 0) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const nfLatin = (digits = 0) => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export const fmtDate = (v: unknown): string => {
  if (!v) return '';
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo' });
};

export const fmtDateTime = (v: unknown): string => {
  if (!v) return '';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

/** text shown in a cell (preview · PDF · print). Excel gets raw values — see `excelValue`. */
export function formatCell(value: unknown, def: FieldDef | undefined, opts: { latinDigits?: boolean } = {}): string {
  if (value === null || value === undefined || value === '') return '';
  const t = def?.type ?? (typeof value === 'number' ? 'number' : 'text');
  switch (t) {
    case 'number': {
      if (typeof value !== 'number') return String(value);
      return (opts.latinDigits ? nfLatin : nf)(def?.digits ?? 2).format(value);
    }
    case 'date': return fmtDate(value);
    case 'datetime': return fmtDateTime(value);
    case 'bool': return value ? 'نعم' : 'لا';
    case 'image': return value ? '🖼' : '';
    default: return String(value);
  }
}

/** value written into an Excel cell — keeps numbers numeric and dates as Date */
export function excelValue(value: unknown, def: FieldDef | undefined): string | number | Date | null {
  if (value === null || value === undefined || value === '') return null;
  const t = def?.type ?? 'text';
  if (t === 'number') return typeof value === 'number' ? value : Number(value) || String(value);
  if (t === 'date' || t === 'datetime') { const d = new Date(String(value)); return Number.isNaN(d.getTime()) ? String(value) : d; }
  if (t === 'bool') return value ? 'نعم' : 'لا';
  if (t === 'image') return value ? String(value) : null;
  return String(value);
}

// ===================================================================
// Filtering & sorting
// ===================================================================
const norm = (v: unknown) => String(v ?? '').toLowerCase().trim();
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isNaN(n) ? null : n;
};

function matches(row: ReportRow, f: RowFilter, def: FieldDef | undefined): boolean {
  const v = row[f.field];
  const isNumeric = def?.type === 'number';
  const isDate = def?.type === 'date' || def?.type === 'datetime';
  switch (f.op) {
    case 'empty': return v === null || v === undefined || v === '';
    case 'not_empty': return !(v === null || v === undefined || v === '');
    case 'contains': return norm(v).includes(norm(f.value));
    case 'not_contains': return !norm(v).includes(norm(f.value));
    case 'eq': return isNumeric ? num(v) === num(f.value) : norm(v) === norm(f.value);
    case 'neq': return isNumeric ? num(v) !== num(f.value) : norm(v) !== norm(f.value);
    case 'gt': case 'gte': case 'lt': case 'lte': {
      let a: number | null, b: number | null;
      if (isDate) { a = v ? new Date(String(v)).getTime() : null; b = f.value ? new Date(f.value).getTime() : null; }
      else { a = num(v); b = num(f.value); }
      if (a === null || b === null || Number.isNaN(a) || Number.isNaN(b)) return false;
      return f.op === 'gt' ? a > b : f.op === 'gte' ? a >= b : f.op === 'lt' ? a < b : a <= b;
    }
    default: return true;
  }
}

export function filterRows(rows: ReportRow[], filters: RowFilter[], defs: Map<string, FieldDef>, search = ''): ReportRow[] {
  const active = filters.filter((f) => f.field && (f.op === 'empty' || f.op === 'not_empty' || f.value !== ''));
  const s = norm(search);
  return rows.filter((r) => {
    if (s && !Object.values(r).some((v) => norm(v).includes(s))) return false;
    return active.every((f) => matches(r, f, defs.get(f.field)));
  });
}

const collator = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' });

export function sortRows(rows: ReportRow[], sort: SortRule[], defs: Map<string, FieldDef>): ReportRow[] {
  if (sort.length === 0) return rows;
  const out = [...rows];
  out.sort((a, b) => {
    for (const s of sort) {
      const def = defs.get(s.field);
      const va = a[s.field], vb = b[s.field];
      const ea = va === null || va === undefined || va === '', eb = vb === null || vb === undefined || vb === '';
      if (ea && eb) continue;
      if (ea) return 1; if (eb) return -1;   // empties last regardless of direction
      let c = 0;
      if (def?.type === 'number') c = (num(va) ?? 0) - (num(vb) ?? 0);
      else if (def?.type === 'date' || def?.type === 'datetime') c = new Date(String(va)).getTime() - new Date(String(vb)).getTime();
      else c = collator.compare(String(va), String(vb));
      if (c !== 0) return s.dir === 'asc' ? c : -c;
    }
    return 0;
  });
  return out;
}

/** the full pipeline of the query on already-loaded rows */
export function applyQuery(rows: ReportRow[], q: ReportQuery, defs: Map<string, FieldDef>, search = ''): ReportRow[] {
  return sortRows(filterRows(rows, q.rowFilters, defs, search), q.sort, defs);
}

// ===================================================================
// Aggregation (totals row · charts · variables)
// ===================================================================
export function aggregate(values: unknown[], agg: Aggregate): number {
  const nums = values.map(num).filter((n): n is number => n !== null);
  switch (agg) {
    case 'count': return values.length;
    case 'sum': return nums.reduce((a, b) => a + b, 0);
    case 'avg': return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    case 'min': return nums.length ? Math.min(...nums) : 0;
    case 'max': return nums.length ? Math.max(...nums) : 0;
  }
}

export interface ChartDatum { label: string; value: number; color: string }

export function chartData(rows: ReportRow[], cfg: ChartConfig, colors: string[]): ChartDatum[] {
  if (!cfg.categoryField) {
    // no category → a single value
    const v = cfg.valueField ? aggregate(rows.map((r) => r[cfg.valueField]), cfg.aggregate) : rows.length;
    return [{ label: cfg.title || 'الكل', value: v, color: colors[0] }];
  }
  const groups = new Map<string, unknown[]>();
  for (const r of rows) {
    const k = String(r[cfg.categoryField] ?? '') || '—';
    const arr = groups.get(k) ?? [];
    arr.push(cfg.valueField ? r[cfg.valueField] : 1);
    groups.set(k, arr);
  }
  let data = Array.from(groups.entries()).map(([label, vals]) => ({
    label, value: cfg.valueField ? aggregate(vals, cfg.aggregate) : vals.length, color: '',
  }));
  data.sort((a, b) => b.value - a.value);
  if (cfg.topN > 0 && data.length > cfg.topN) {
    const rest = data.slice(cfg.topN);
    data = data.slice(0, cfg.topN);
    if (rest.length) data.push({ label: `أخرى (${rest.length})`, value: rest.reduce((a, b) => a + b.value, 0), color: '' });
  }
  return data.map((d, i) => ({ ...d, color: colors[i % colors.length] }));
}

// ===================================================================
// Variables  {church_name} {service_name} {class_name} {count} {today}
//            {report_title} {scope_label} {period_label} {source} {user}
//            {sum:field} {avg:field} {min:field} {max:field}
//            {page} {pages}  (resolved by the renderer per page)
// ===================================================================
export interface VariableBag { [key: string]: string }

export const VARIABLES: { key: string; label: string }[] = [
  { key: 'report_title', label: 'عنوان التقرير' },
  { key: 'church_name', label: 'اسم الكنيسة' },
  { key: 'service_name', label: 'اسم الخدمة' },
  { key: 'class_name', label: 'اسم الفصل' },
  { key: 'scope_label', label: 'النطاق كاملاً' },
  { key: 'period_label', label: 'الفترة' },
  { key: 'event_name', label: 'اسم المناسبة' },
  { key: 'exam_name', label: 'اسم الامتحان' },
  { key: 'count', label: 'عدد السجلات' },
  { key: 'source', label: 'مصدر البيانات' },
  { key: 'today', label: 'تاريخ اليوم' },
  { key: 'now', label: 'الوقت الآن' },
  { key: 'user', label: 'اسم المستخدم' },
  { key: 'page', label: 'رقم الصفحة' },
  { key: 'pages', label: 'عدد الصفحات' },
];

export function buildVariables(q: ReportQuery, design: ReportDesign, rows: ReportRow[], ctx: ReportContext): VariableBag {
  const period = q.filters.from || q.filters.to
    ? `من ${q.filters.from ? fmtDate(q.filters.from) : 'البداية'} إلى ${q.filters.to ? fmtDate(q.filters.to) : 'اليوم'}`
    : 'كل الفترة';
  const scopeParts = [ctx.churchName || 'كل الكنائس', ctx.serviceName || 'كل الخدمات', ctx.className || 'كل الفصول'];
  const now = new Date();
  return {
    report_title: design.title || 'تقرير',
    church_name: ctx.churchName || 'كل الكنائس',
    service_name: ctx.serviceName || 'كل الخدمات',
    class_name: ctx.className || 'كل الفصول',
    scope_label: scopeParts.join(' ← '),
    period_label: period,
    event_name: ctx.eventName ?? 'كل المناسبات',
    exam_name: ctx.examName ?? '',
    count: nf(0).format(rows.length),
    source: ctx.sourceLabel,
    today: now.toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo' }),
    now: now.toLocaleTimeString('ar-EG', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' }),
    user: ctx.userName ?? '',
  };
}

export function resolveText(text: string | undefined, vars: VariableBag, rows: ReportRow[], defs: Map<string, FieldDef>, page?: { page: number; pages: number }): string {
  if (!text) return '';
  return text.replace(/\{([a-z_]+)(?::([^}]+))?\}/gi, (m, key: string, arg?: string) => {
    const k = key.toLowerCase();
    if (k === 'page') return page ? nf(0).format(page.page) : '1';
    if (k === 'pages') return page ? nf(0).format(page.pages) : '1';
    if ((k === 'sum' || k === 'avg' || k === 'min' || k === 'max' || k === 'count') && arg) {
      const def = defs.get(arg);
      const v = aggregate(rows.map((r) => r[arg]), k as Aggregate);
      return nf(def?.digits ?? 2).format(v);
    }
    return vars[k] ?? m;
  });
}

// ===================================================================
// Table layout — split rows over pages
// ===================================================================
export interface TableColumn { field: SelectedField; def: FieldDef | undefined; title: string; width: number /* mm */; align: 'right' | 'center' | 'left' }

export function tableColumns(fields: SelectedField[], defs: Map<string, FieldDef>, totalWidth: number, cfg: TableConfig): TableColumn[] {
  const indexW = cfg.showIndex ? 8 : 0;
  const weights = fields.map((f) => f.width ?? defs.get(f.key)?.width ?? 1);
  const sumW = weights.reduce((a, b) => a + b, 0) || 1;
  const avail = Math.max(10, totalWidth - indexW);
  return fields.map((f, i) => {
    const def = defs.get(f.key);
    return {
      field: f, def,
      title: f.title?.trim() || def?.label || f.key,
      width: (weights[i] / sumW) * avail,
      align: f.align ?? (def?.type === 'number' ? 'center' : def?.type === 'date' || def?.type === 'datetime' ? 'center' : 'right'),
    };
  });
}

/**
 * How many body rows fit in a table element of height `h` (mm).
 * The header repeats on every page; the totals row (if any) only on the last.
 */
export function rowsPerTable(cfg: TableConfig, h: number): number {
  return Math.max(1, Math.floor((h - cfg.headerHeight) / cfg.rowHeight));
}

export interface LaidOutPage {
  /** the source design page */
  page: ReportPage;
  pageIndex: number;
  /** for flowing tables: which slice of rows each table element shows */
  tableSlices: Record<string, { from: number; to: number; last: boolean }>;
  /** true = a continuation page (only the flowing table + header / footer are drawn) */
  continuation: boolean;
}

/**
 * Expand the design pages into physical pages. A `table` element with
 * `flow` set that has more rows than fit continues on extra pages that
 * repeat the same element box (and the header / footer) until every row is
 * placed. Non-flowing tables just show what fits.
 */
export function layoutPages(design: ReportDesign, rowsCount: number): LaidOutPage[] {
  const out: LaidOutPage[] = [];
  design.pages.forEach((page, pageIndex) => {
    const tables = page.elements.filter((e) => e.type === 'table');
    const slices: Record<string, { from: number; to: number; last: boolean }> = {};
    let maxExtra = 0;
    const perPage: Record<string, number> = {};
    for (const t of tables) {
      const cfg = t.table!;
      const n = rowsPerTable(cfg, t.h);
      perPage[t.id] = n;
      const firstTo = Math.min(rowsCount, n);
      const needsExtra = cfg.flow && rowsCount > n;
      slices[t.id] = { from: 0, to: firstTo, last: !needsExtra };
      if (needsExtra) maxExtra = Math.max(maxExtra, Math.ceil((rowsCount - n) / n));
    }
    out.push({ page, pageIndex, tableSlices: slices, continuation: false });
    for (let k = 1; k <= maxExtra; k++) {
      const s: Record<string, { from: number; to: number; last: boolean }> = {};
      for (const t of tables) {
        const cfg = t.table!;
        if (!cfg.flow) continue;
        const n = perPage[t.id];
        const from = k * n;
        if (from >= rowsCount) continue;
        const to = Math.min(rowsCount, from + n);
        s[t.id] = { from, to, last: to >= rowsCount };
      }
      out.push({ page, pageIndex, tableSlices: s, continuation: true });
    }
  });
  return out;
}

/** elements drawn on a laid-out page (continuation pages only keep flowing tables) */
export function elementsOf(lp: LaidOutPage): ReportElement[] {
  const els = lp.continuation
    ? lp.page.elements.filter((e) => e.type === 'table' && e.table?.flow && lp.tableSlices[e.id])
    : lp.page.elements;
  return [...els].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
}

/** content box of a page (inside margins, below header, above footer) in mm */
export function contentBox(design: ReportDesign, page: ReportPage) {
  const { w, h } = pageSize(design, page);
  const top = design.margins.top + (design.header.enabled ? design.header.height : 0);
  const bottom = design.margins.bottom + (design.footer.enabled ? design.footer.height : 0);
  return { x: design.margins.left, y: top, w: w - design.margins.left - design.margins.right, h: h - top - bottom, pageW: w, pageH: h };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const round1 = (v: number) => Math.round(v * 10) / 10;
