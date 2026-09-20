'use client';

// ---------- Step 2 — الحقول والمعاينة ----------
// Left: available fields grouped (tap = add/remove). Right: the chosen
// columns in order — drag handle (↑ ↓), rename, width, align, remove.
// Below: row filters · sort rules · LIVE preview table (first 100 rows) +
// quick Excel export of exactly what is shown.

import { useMemo, useState } from 'react';
import {
  Columns3, ListFilter, ArrowDownUp, Eye, Plus, X, ChevronUp, ChevronDown, Trash2, Search, FileSpreadsheet, CheckSquare, Square, GripVertical, RotateCcw,
} from 'lucide-react';
import type { FieldDef, ReportQuery, ReportRow, RowFilter, SelectedField, SortRule, FilterOp } from '@/lib/reports/types';
import { FILTER_OP_LABELS, uid } from '@/lib/reports/types';
import { formatCell } from '@/lib/reports/engine';
import { Section, Seg } from './ReportBits';

const OPS_TEXT: FilterOp[] = ['contains', 'not_contains', 'eq', 'neq', 'empty', 'not_empty'];
const OPS_NUM: FilterOp[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'empty', 'not_empty'];

export function FieldsStep({
  query, onChange, fieldDefs, rows, previewRows, totalRows, onExportExcel, search, onSearch,
}: {
  query: ReportQuery;
  onChange: (patch: Partial<ReportQuery>) => void;
  fieldDefs: FieldDef[];
  rows: ReportRow[];        // loaded (unfiltered)
  previewRows: ReportRow[]; // after row filters + sort
  totalRows: number;
  onExportExcel: () => void;
  search: string;
  onSearch: (s: string) => void;
}) {
  const defs = useMemo(() => new Map(fieldDefs.map((f) => [f.key, f])), [fieldDefs]);
  const groups = useMemo(() => {
    const g = new Map<string, FieldDef[]>();
    for (const f of fieldDefs) g.set(f.group, [...(g.get(f.group) ?? []), f]);
    return Array.from(g.entries());
  }, [fieldDefs]);
  const selectedKeys = useMemo(() => new Set(query.fields.map((f) => f.key)), [query.fields]);
  const [editing, setEditing] = useState<string | null>(null);

  const setFields = (fields: SelectedField[]) => onChange({ fields });
  const toggle = (key: string) => {
    if (selectedKeys.has(key)) setFields(query.fields.filter((f) => f.key !== key));
    else setFields([...query.fields, { key }]);
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d; if (j < 0 || j >= query.fields.length) return;
    const next = [...query.fields]; const [x] = next.splice(i, 1); next.splice(j, 0, x); setFields(next);
  };
  const patchField = (i: number, patch: Partial<SelectedField>) => setFields(query.fields.map((f, k) => (k === i ? { ...f, ...patch } : f)));
  const selectAll = () => setFields(fieldDefs.filter((f) => f.type !== 'image').map((f) => ({ key: f.key })));
  const selectDefaults = () => setFields(fieldDefs.filter((f) => f.defaultOn).map((f) => ({ key: f.key })));
  const clear = () => setFields([]);

  // ---- row filters ----
  const addFilter = () => onChange({ rowFilters: [...query.rowFilters, { id: uid(), field: query.fields[0]?.key ?? fieldDefs[0]?.key ?? '', op: 'contains', value: '' }] });
  const patchFilter = (id: string, patch: Partial<RowFilter>) => onChange({ rowFilters: query.rowFilters.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
  const removeFilter = (id: string) => onChange({ rowFilters: query.rowFilters.filter((f) => f.id !== id) });

  // ---- sort ----
  const addSort = () => onChange({ sort: [...query.sort, { field: query.fields[0]?.key ?? '', dir: 'asc' }] });
  const patchSort = (i: number, patch: Partial<SortRule>) => onChange({ sort: query.sort.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const removeSort = (i: number) => onChange({ sort: query.sort.filter((_, k) => k !== i) });

  const selectCls = 'input-field !py-1.5 !px-2 !text-xs';
  const previewSlice = previewRows.slice(0, 100);

  return (
    <div className="space-y-3">
      {/* ---------- field picker ---------- */}
      <Section title={`الحقول (${query.fields.length} من ${fieldDefs.length})`} icon={<Columns3 className="h-4 w-4" />} id="report-fields"
        right={
          <div className="flex gap-1">
            <button type="button" onClick={selectDefaults} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600" title="الافتراضية"><RotateCcw className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={selectAll} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600">الكل</button>
            <button type="button" onClick={clear} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600">مسح</button>
          </div>
        }>
        <div className="space-y-2">
          {groups.map(([g, list]) => (
            <div key={g}>
              <p className="mb-1 text-[11px] font-extrabold text-slate-400">{g}</p>
              <div className="flex flex-wrap gap-1.5">
                {list.map((f) => {
                  const on = selectedKeys.has(f.key);
                  return (
                    <button key={f.key} id={`report-field-${f.key.replace(/[^a-z0-9_]/gi, '_')}`} type="button" onClick={() => toggle(f.key)}
                      className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-bold transition active:scale-95 ${on ? 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                      {on ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5 text-slate-300" />}
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* ---------- chosen columns (order · title · width · align) ---------- */}
        {query.fields.length > 0 && (
          <div className="mt-2 rounded-xl border border-slate-100 bg-slate-50/60 p-2">
            <p className="mb-1.5 text-[11px] font-extrabold text-slate-500">ترتيب الأعمدة وعناوينها — اضغط على العمود لتعديله</p>
            <ul id="report-columns" className="space-y-1">
              {query.fields.map((f, i) => {
                const def = defs.get(f.key);
                const isEd = editing === f.key;
                return (
                  <li key={f.key} className="rounded-lg bg-white ring-1 ring-slate-100">
                    <div className="flex items-center gap-1 px-1.5 py-1">
                      <GripVertical className="h-4 w-4 shrink-0 text-slate-300" />
                      <span className="w-5 shrink-0 text-center text-[10px] font-bold text-slate-400">{i + 1}</span>
                      <button type="button" onClick={() => setEditing(isEd ? null : f.key)} className="min-w-0 flex-1 truncate text-start text-xs font-extrabold text-slate-700">
                        {f.title?.trim() || def?.label || f.key}
                        {f.title?.trim() && f.title.trim() !== def?.label && <span className="ms-1 text-[10px] font-bold text-slate-400">({def?.label})</span>}
                      </button>
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30" aria-label="أعلى"><ChevronUp className="h-4 w-4" /></button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === query.fields.length - 1} className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30" aria-label="أسفل"><ChevronDown className="h-4 w-4" /></button>
                      <button type="button" onClick={() => toggle(f.key)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500" aria-label="إزالة"><X className="h-4 w-4" /></button>
                    </div>
                    {isEd && (
                      <div className="grid grid-cols-1 gap-2 border-t border-slate-100 p-2 sm:grid-cols-3">
                        <label className="block sm:col-span-1">
                          <span className="mb-0.5 block text-[10px] font-bold text-slate-500">عنوان العمود</span>
                          <input className={selectCls} value={f.title ?? ''} placeholder={def?.label} onChange={(e) => patchField(i, { title: e.target.value })} />
                        </label>
                        <label className="block">
                          <span className="mb-0.5 block text-[10px] font-bold text-slate-500">العرض النسبي</span>
                          <input type="number" dir="ltr" step={0.1} min={0.3} max={5} className={selectCls} value={f.width ?? def?.width ?? 1} onChange={(e) => patchField(i, { width: Number(e.target.value) || 1 })} />
                        </label>
                        <div>
                          <span className="mb-0.5 block text-[10px] font-bold text-slate-500">المحاذاة</span>
                          <Seg size="xs" value={f.align ?? (def?.type === 'number' || def?.type === 'date' || def?.type === 'datetime' ? 'center' : 'right')}
                            onChange={(v) => patchField(i, { align: v })}
                            options={[{ value: 'right', label: 'يمين' }, { value: 'center', label: 'وسط' }, { value: 'left', label: 'يسار' }]} />
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Section>

      {/* ---------- row filters ---------- */}
      <Section title={`تصفية السجلات${query.rowFilters.length ? ` (${query.rowFilters.length})` : ''}`} icon={<ListFilter className="h-4 w-4" />} id="report-rowfilters"
        right={<button type="button" onClick={addFilter} className="flex items-center gap-1 rounded-lg bg-fuchsia-50 px-2 py-1 text-[11px] font-extrabold text-fuchsia-700"><Plus className="h-3.5 w-3.5" /> شرط</button>}>
        {query.rowFilters.length === 0 ? (
          <p className="text-center text-[11px] font-bold text-slate-400">كل السجلات — أضف شرطاً لتصفيتها (مثال: الحضور أكبر من ٣)</p>
        ) : (
          <ul className="space-y-1.5">
            {query.rowFilters.map((f) => {
              const def = defs.get(f.field);
              const ops = def?.type === 'number' || def?.type === 'date' || def?.type === 'datetime' ? OPS_NUM : OPS_TEXT;
              const needsValue = f.op !== 'empty' && f.op !== 'not_empty';
              return (
                <li key={f.id} className="grid grid-cols-[1fr_auto] gap-1.5 sm:grid-cols-[1.2fr_1fr_1.2fr_auto]">
                  <select className={selectCls} value={f.field} onChange={(e) => patchFilter(f.id, { field: e.target.value, op: 'contains', value: '' })}>
                    {fieldDefs.filter((d) => d.type !== 'image').map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                  </select>
                  <button type="button" onClick={() => removeFilter(f.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 sm:order-last" aria-label="حذف"><Trash2 className="h-4 w-4" /></button>
                  <select className={selectCls} value={f.op} onChange={(e) => patchFilter(f.id, { op: e.target.value as FilterOp })}>
                    {ops.map((o) => <option key={o} value={o}>{FILTER_OP_LABELS[o]}</option>)}
                  </select>
                  <input className={selectCls} disabled={!needsValue} type={def?.type === 'date' ? 'date' : def?.type === 'number' ? 'number' : 'text'} dir={def?.type === 'number' || def?.type === 'date' ? 'ltr' : undefined}
                    placeholder={needsValue ? 'القيمة' : '—'} value={f.value} onChange={(e) => patchFilter(f.id, { value: e.target.value })} />
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* ---------- sort ---------- */}
      <Section title="الترتيب" icon={<ArrowDownUp className="h-4 w-4" />} id="report-sort"
        right={<button type="button" onClick={addSort} className="flex items-center gap-1 rounded-lg bg-fuchsia-50 px-2 py-1 text-[11px] font-extrabold text-fuchsia-700"><Plus className="h-3.5 w-3.5" /> قاعدة</button>}>
        {query.sort.length === 0 ? (
          <p className="text-center text-[11px] font-bold text-slate-400">الترتيب الافتراضي للمصدر</p>
        ) : (
          <ul className="space-y-1.5">
            {query.sort.map((s, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <span className="w-5 text-center text-[10px] font-bold text-slate-400">{i + 1}</span>
                <select className={`${selectCls} flex-1`} value={s.field} onChange={(e) => patchSort(i, { field: e.target.value })}>
                  {fieldDefs.filter((d) => d.type !== 'image').map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
                <div className="w-36">
                  <Seg size="xs" value={s.dir} onChange={(v) => patchSort(i, { dir: v })} options={[{ value: 'asc', label: 'تصاعدي' }, { value: 'desc', label: 'تنازلي' }]} />
                </div>
                <button type="button" onClick={() => removeSort(i)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500" aria-label="حذف"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ---------- live preview ---------- */}
      <Section title="معاينة البيانات" icon={<Eye className="h-4 w-4" />} id="report-preview"
        right={
          <span className="badge bg-fuchsia-100 text-fuchsia-700 tabular-nums">
            {previewRows.length.toLocaleString('ar-EG')}{previewRows.length !== totalRows ? ` / ${totalRows.toLocaleString('ar-EG')}` : ''} سجل
          </span>
        }>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute end-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input id="report-preview-search" className="input-field !py-2 !pe-8 !text-sm" placeholder="بحث سريع في كل الحقول…" value={search} onChange={(e) => onSearch(e.target.value)} />
          </div>
          <button id="report-preview-excel" type="button" onClick={onExportExcel} disabled={query.fields.length === 0 || previewRows.length === 0}
            className="btn-secondary flex items-center gap-1 !px-3 !py-2 text-xs disabled:opacity-50" title="تصدير هذه البيانات إلى Excel">
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Excel
          </button>
        </div>
        {query.fields.length === 0 ? (
          <p className="py-6 text-center text-xs font-bold text-slate-400">اختر حقلاً واحداً على الأقل لعرض المعاينة</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-xs font-bold text-slate-400">لا بيانات — عد إلى الخطوة الأولى وحمّل البيانات</p>
        ) : (
          <div className="no-scrollbar -mx-3 overflow-x-auto px-3">
            <table className="w-full min-w-max text-xs">
              <thead>
                <tr className="bg-fuchsia-600 text-white">
                  <th className="px-2 py-1.5 text-center font-extrabold">#</th>
                  {query.fields.map((f) => <th key={f.key} className="px-2 py-1.5 text-start font-extrabold">{f.title?.trim() || defs.get(f.key)?.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {previewSlice.map((r, i) => (
                  <tr key={String(r._id ?? i)} className={i % 2 ? 'bg-slate-50' : 'bg-white'}>
                    <td className="px-2 py-1 text-center tabular-nums text-slate-400">{i + 1}</td>
                    {query.fields.map((f) => {
                      const def = defs.get(f.key);
                      const v = r[f.key];
                      return (
                        <td key={f.key} className={`px-2 py-1 font-bold text-slate-700 ${def?.type === 'number' ? 'text-center tabular-nums' : ''}`}>
                          {def?.type === 'image' ? (v ? <img src={String(v)} alt="" className="h-7 w-7 rounded-full object-cover" /> : '—') : formatCell(v, def)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {previewRows.length > 100 && <p className="mt-1 text-center text-[10px] font-bold text-slate-400">تُعرض أول ١٠٠ سجل فقط في المعاينة — التصدير يشمل الكل</p>}
          </div>
        )}
      </Section>
    </div>
  );
}
