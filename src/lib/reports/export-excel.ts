'use client';

// ---------- Excel export — EXACTLY the columns the user picked, in his order,
// with his titles; numbers stay numbers, dates stay dates. RTL sheet. ----------

import type { FieldDef, ReportRow, SelectedField } from './types';
import { excelValue } from './engine';

export const safeFile = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'report';

export interface ExcelOptions {
  fileName: string;
  sheetName?: string;
  /** an extra title block above the table ({report_title} · scope · period) */
  headerLines?: string[];
  showIndex?: boolean;
  totals?: boolean;
}

export async function exportExcel(rows: ReportRow[], fields: SelectedField[], defs: Map<string, FieldDef>, opts: ExcelOptions) {
  const XLSX = await import('xlsx');
  const cols = fields.map((f) => ({ key: f.key, title: f.title?.trim() || defs.get(f.key)?.label || f.key, def: defs.get(f.key) }));

  const aoa: (string | number | Date | null)[][] = [];
  const headerLines = opts.headerLines ?? [];
  for (const l of headerLines) aoa.push([l]);
  if (headerLines.length) aoa.push([]);

  const head: string[] = [];
  if (opts.showIndex) head.push('#');
  head.push(...cols.map((c) => c.title));
  aoa.push(head);

  rows.forEach((r, i) => {
    const line: (string | number | Date | null)[] = [];
    if (opts.showIndex) line.push(i + 1);
    for (const c of cols) line.push(excelValue(r[c.key], c.def));
    aoa.push(line);
  });

  if (opts.totals) {
    const line: (string | number | Date | null)[] = [];
    if (opts.showIndex) line.push('الإجمالي');
    cols.forEach((c, i) => {
      if (c.def?.numeric) {
        const sum = rows.reduce((a, r) => a + (typeof r[c.key] === 'number' ? (r[c.key] as number) : 0), 0);
        line.push(Math.round(sum * 100) / 100);
      } else line.push(i === 0 && !opts.showIndex ? 'الإجمالي' : null);
    });
    aoa.push(line);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  // column widths (chars) from the field weights
  ws['!cols'] = [
    ...(opts.showIndex ? [{ wch: 5 }] : []),
    ...cols.map((c) => ({ wch: Math.max(8, Math.round((c.def?.width ?? 1) * 14)) })),
  ];
  // RTL sheet
  ws['!views'] = [{ rightToLeft: true }] as unknown as typeof ws['!views'];
  // date format
  const startRow = headerLines.length ? headerLines.length + 2 : 1;
  cols.forEach((c, ci) => {
    if (c.def?.type !== 'date' && c.def?.type !== 'datetime') return;
    const col = ci + (opts.showIndex ? 1 : 0);
    for (let r = startRow; r < startRow + rows.length; r++) {
      const addr = XLSX.utils.encode_cell({ r, c: col });
      if (ws[addr]) ws[addr].z = c.def.type === 'date' ? 'dd/mm/yyyy' : 'dd/mm/yyyy hh:mm';
    }
  });

  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, (opts.sheetName ?? 'البيانات').slice(0, 31));
  XLSX.writeFile(wb, `${safeFile(opts.fileName)}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
