'use client';

// Data sources for the Bulk Print tab: generate codes · paste a table · import
// Excel. Each source produces a BulkDataset (or, for codes, a column of values)
// and hands it back — nothing here touches the database.

import { useMemo, useRef, useState } from 'react';
import {
  Hash, ClipboardPaste, FileSpreadsheet, Upload, Loader2, Sparkles, X, AlertTriangle, ArrowRight,
} from 'lucide-react';
import {
  type BulkDataset, type CodeGenOptions, type ExcelSheet, type CodeKind, type RandomCharset,
  DEFAULT_CODE_OPTIONS, MAX_GENERATED, generateCodes, previewCodes, parsePastedText, matrixToDataset,
  readExcelFile, datasetFromMatrix,
} from '@/lib/bulk-print';
import type { ReactNode } from 'react';

type Source = 'generate' | 'paste' | 'excel' | null;

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
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-bold text-slate-500">{label}</span>
      <input className="input-field !py-2 !px-2.5 !text-sm" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} dir="ltr" />
    </label>
  );
}

const pill = (on: boolean) =>
  `rounded-xl border py-2 text-xs font-extrabold transition ${on ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-400 hover:bg-slate-50'}`;

// small read-only preview grid of a matrix (first rows)
function MatrixPreview({ headers, rows, max = 6 }: { headers: string[]; rows: string[][]; max?: number }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-100">
      <table className="w-full border-collapse text-[11px]">
        <thead className="bg-slate-50">
          <tr>
            <th className="border-b border-slate-100 p-1.5 text-[10px] text-slate-400">#</th>
            {headers.map((h, i) => <th key={i} className="whitespace-nowrap border-b border-slate-100 p-1.5 text-start font-mono font-extrabold text-slate-700" dir="ltr">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, max).map((r, i) => (
            <tr key={i} className={i % 2 ? 'bg-slate-50/40' : ''}>
              <td className="border-b border-slate-50 p-1.5 text-center text-[10px] text-slate-400">{i + 1}</td>
              {headers.map((_, j) => <td key={j} className="whitespace-nowrap border-b border-slate-50 p-1.5 font-bold text-slate-600" dir="auto">{r[j] ?? ''}</td>)}
            </tr>
          ))}
          {rows.length > max && (
            <tr><td colSpan={headers.length + 1} className="p-1.5 text-center text-[10px] font-bold text-slate-400">… و{rows.length - max} صف آخر</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
export default function BulkSourcePanel({
  source, setSource, hasData, dataset, onReplace, onAppend, onFillColumn,
}: {
  source: Source;
  setSource: (s: Source) => void;
  hasData: boolean;
  dataset: BulkDataset;
  onReplace: (d: BulkDataset) => void;
  onAppend: (d: BulkDataset) => void;
  /** write generated codes into an existing column (colId) or a new one (null + key) */
  onFillColumn: (colId: string | null, values: string[], createKey?: string) => void;
}) {
  // ----- generate -----
  const [gen, setGen] = useState<CodeGenOptions>(DEFAULT_CODE_OPTIONS);
  const [genKey, setGenKey] = useState('code');
  const [genTarget, setGenTarget] = useState<string>('__new__'); // column id | __new__ | __replace__
  const setG = (p: Partial<CodeGenOptions>) => setGen((g) => ({ ...g, ...p }));
  const genPreview = useMemo(() => previewCodes(gen, 3), [gen]);

  // ----- paste -----
  const [pasteText, setPasteText] = useState('');
  const [pasteHeader, setPasteHeader] = useState(true);
  const pasteMatrix = useMemo(() => parsePastedText(pasteText), [pasteText]);
  const pasteDs = useMemo(() => matrixToDataset(pasteMatrix, pasteHeader && pasteMatrix.length > 1), [pasteMatrix, pasteHeader]);

  // ----- excel -----
  const fileRef = useRef<HTMLInputElement>(null);
  const [sheets, setSheets] = useState<ExcelSheet[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [xlHeader, setXlHeader] = useState(true);
  const [xlName, setXlName] = useState('');
  const [reading, setReading] = useState(false);
  const [xlError, setXlError] = useState('');
  const sheet = sheets[sheetIdx];
  const xlDs = useMemo(() => (sheet ? matrixToDataset(sheet.matrix, xlHeader && sheet.matrix.length > 1) : null), [sheet, xlHeader]);

  const readFile = async (file: File) => {
    setReading(true); setXlError(''); setSheets([]); setXlName(file.name);
    try {
      const s = await readExcelFile(file);
      const nonEmpty = s.filter((x) => x.matrix.length);
      if (!nonEmpty.length) { setXlError('الملف لا يحتوي على بيانات'); return; }
      setSheets(nonEmpty);
      setSheetIdx(0);
    } catch {
      setXlError('تعذّر قراءة الملف — تأكد أنه Excel (xlsx / xls) أو CSV');
    } finally { setReading(false); }
  };

  const dsPreview = (d: BulkDataset) => ({
    headers: d.columns.map((c) => c.key),
    rows: d.rows.map((r) => d.columns.map((c) => r.cells[c.id] ?? '')),
  });

  const applyGenerate = () => {
    const codes = generateCodes(gen);
    if (!codes.length) return;
    if (!hasData || genTarget === '__replace__') {
      onReplace(datasetFromMatrix([genKey || 'code'], codes.map((c) => [c])));
      return;
    }
    if (genTarget === '__new__') onFillColumn(null, codes, genKey || 'code');
    else onFillColumn(genTarget, codes);
  };

  // ----- chooser -----
  if (!source) {
    return (
      <section className="card">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-extrabold text-slate-600">
          <Sparkles className="h-4 w-4 text-emerald-600" /> مصدر البيانات
        </h3>
        <p className="mb-3 text-[11px] font-bold text-slate-400">كل صف = كارت واحد بنفس التصميم وببياناته الخاصة. اختر كيف تُنشئ البيانات:</p>
        <div className="grid grid-cols-3 gap-2">
          <button onClick={() => setSource('generate')} className="flex flex-col items-center gap-2 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 text-center transition hover:bg-emerald-50 active:scale-95">
            <Hash className="h-7 w-7 text-emerald-600" />
            <span className="text-sm font-extrabold text-slate-700">توليد أكواد</span>
            <span className="text-[10px] font-bold text-slate-400">تسلسلي أو عشوائي · بادئة · طول</span>
          </button>
          <button onClick={() => setSource('paste')} className="flex flex-col items-center gap-2 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 text-center transition hover:bg-indigo-50 active:scale-95">
            <ClipboardPaste className="h-7 w-7 text-indigo-600" />
            <span className="text-sm font-extrabold text-slate-700">لصق بيانات</span>
            <span className="text-[10px] font-bold text-slate-400">من Excel / جداول Google · عدة أعمدة</span>
          </button>
          <button onClick={() => setSource('excel')} className="flex flex-col items-center gap-2 rounded-2xl border border-amber-100 bg-amber-50/60 p-4 text-center transition hover:bg-amber-50 active:scale-95">
            <FileSpreadsheet className="h-7 w-7 text-amber-600" />
            <span className="text-sm font-extrabold text-slate-700">استيراد Excel</span>
            <span className="text-[10px] font-bold text-slate-400">xlsx · xls · csv — اكتشاف الأعمدة تلقائياً</span>
          </button>
        </div>
      </section>
    );
  }

  const header = (icon: ReactNode, title: string) => (
    <div className="mb-3 flex items-center justify-between">
      <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-600">{icon} {title}</h3>
      <button onClick={() => setSource(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" title="إغلاق"><X className="h-4 w-4" /></button>
    </div>
  );

  // ----- generate -----
  if (source === 'generate') {
    return (
      <section className="card">
        {header(<Hash className="h-4 w-4 text-emerald-600" />, 'توليد أكواد')}
        <div className="grid grid-cols-2 gap-2">
          <Num label="عدد الأكواد" value={gen.count} min={1} max={MAX_GENERATED} onChange={(v) => setG({ count: Math.max(1, Math.min(MAX_GENERATED, v)) })} />
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-bold text-slate-500">نوع الكود</span>
            <div className="flex gap-1">
              {(['sequential', 'random'] as CodeKind[]).map((k) => (
                <button key={k} onClick={() => setG({ kind: k, length: k === 'random' && gen.length < 4 ? 6 : gen.length })} className={`flex-1 ${pill(gen.kind === k)}`}>
                  {k === 'sequential' ? '🔢 تسلسلي' : '🎲 عشوائي'}
                </button>
              ))}
            </div>
          </label>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Text label="بادئة (اختياري)" value={gen.prefix} onChange={(v) => setG({ prefix: v })} placeholder="مثال: A-" />
          <Num label={gen.kind === 'sequential' ? 'عدد الخانات' : 'طول الكود'} value={gen.length} min={1} max={32} onChange={(v) => setG({ length: Math.max(1, Math.min(32, v)) })} />
          <Text label="لاحقة (اختياري)" value={gen.suffix} onChange={(v) => setG({ suffix: v })} placeholder="" />
        </div>
        {gen.kind === 'sequential' ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Num label="يبدأ من" value={gen.start} min={-1000000} onChange={(v) => setG({ start: v })} />
            <Num label="الخطوة" value={gen.step} min={-1000} max={1000} onChange={(v) => setG({ step: v })} />
          </div>
        ) : (
          <label className="mt-2 block">
            <span className="mb-0.5 block text-[11px] font-bold text-slate-500">الحروف المستخدمة</span>
            <div className="flex gap-1">
              {([['alnum', 'حروف + أرقام'], ['digits', 'أرقام فقط'], ['letters', 'حروف فقط']] as [RandomCharset, string][]).map(([c, l]) => (
                <button key={c} onClick={() => setG({ charset: c })} className={`flex-1 ${pill(gen.charset === c)}`}>{l}</button>
              ))}
            </div>
            <p className="mt-1 text-[10px] font-bold text-slate-400">بدون 0 / O / 1 / I لتجنّب الالتباس عند القراءة · الأكواد فريدة</p>
          </label>
        )}
        <div className="mt-3 rounded-xl bg-emerald-50/70 p-2.5 text-xs font-bold text-slate-600">
          مثال: <span className="font-mono text-emerald-800" dir="ltr">{genPreview}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Text label="اسم العمود (الحقل)" value={genKey} onChange={(v) => setGenKey(v.replace(/[{}\s]/g, '_'))} placeholder="code" />
          {hasData && (
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-bold text-slate-500">أين تُوضع؟</span>
              <select className="input-field !py-2 !px-2.5 !text-sm" value={genTarget} onChange={(e) => setGenTarget(e.target.value)}>
                <option value="__new__">عمود جديد (للصفوف الحالية + إضافة صفوف عند الحاجة)</option>
                {dataset.columns.map((c) => <option key={c.id} value={c.id}>تعبئة العمود «{c.key}»</option>)}
                <option value="__replace__">استبدال كل الجدول</option>
              </select>
            </label>
          )}
        </div>
        <button onClick={applyGenerate} className="btn-primary mt-3 w-full !py-2.5 flex items-center justify-center gap-2 text-sm !from-emerald-600 !to-emerald-500">
          <Sparkles className="h-4 w-4" /> توليد {gen.count} كود
        </button>
      </section>
    );
  }

  // ----- paste -----
  if (source === 'paste') {
    const prev = dsPreview(pasteDs);
    return (
      <section className="card">
        {header(<ClipboardPaste className="h-4 w-4 text-indigo-600" />, 'لصق بيانات')}
        <p className="mb-2 text-[11px] font-bold text-slate-400">
          انسخ الخلايا من Excel / جداول Google والصقها هنا — الأعمدة تُفصل بـ Tab أو فاصلة (,) أو (;) · أو سطر لكل قيمة.
        </p>
        <textarea
          className="input-field !py-2 !text-xs font-mono"
          rows={7}
          dir="auto"
          placeholder={'code\tname\tclass\n001\tمينا جرجس\tأولى ابتدائي\n002\tمريم يوسف\tثانية ابتدائي'}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
        />
        <label className="mt-2 flex items-center gap-2 text-xs font-extrabold text-slate-600">
          <input type="checkbox" checked={pasteHeader} onChange={(e) => setPasteHeader(e.target.checked)} className="h-4 w-4 accent-indigo-600" />
          الصف الأول = أسماء الأعمدة (الحقول)
        </label>
        {pasteDs.rows.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-[11px] font-extrabold text-slate-500">معاينة: {pasteDs.rows.length} صف · {pasteDs.columns.length} عمود</p>
            <MatrixPreview headers={prev.headers} rows={prev.rows} />
          </div>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2">
          {hasData && (
            <button onClick={() => onAppend(pasteDs)} disabled={!pasteDs.rows.length} className="btn-secondary !py-2.5 text-sm">إضافة للجدول الحالي</button>
          )}
          <button onClick={() => onReplace(pasteDs)} disabled={!pasteDs.rows.length} className={`btn-primary !py-2.5 flex items-center justify-center gap-2 text-sm !from-indigo-600 !to-indigo-500 ${hasData ? '' : 'col-span-2'}`}>
            <ArrowRight className="h-4 w-4" /> {hasData ? 'استبدال الجدول' : 'استخدام هذه البيانات'}
          </button>
        </div>
      </section>
    );
  }

  // ----- excel -----
  const xlPrev = xlDs ? dsPreview(xlDs) : null;
  return (
    <section className="card">
      {header(<FileSpreadsheet className="h-4 w-4 text-amber-600" />, 'استيراد Excel')}
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ''; }}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={reading}
        className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-amber-200 bg-amber-50/40 p-6 text-center transition hover:bg-amber-50"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) readFile(f); }}
      >
        {reading ? <Loader2 className="h-7 w-7 animate-spin text-amber-500" /> : <Upload className="h-7 w-7 text-amber-500" />}
        <span className="text-sm font-extrabold text-slate-700">{xlName || 'اختر ملف Excel أو اسحبه هنا'}</span>
        <span className="text-[10px] font-bold text-slate-400">xlsx · xls · csv — يُكتشف رأس الأعمدة تلقائياً</span>
      </button>
      {xlError && <p className="mt-2 flex items-center gap-1 text-xs font-bold text-red-500"><AlertTriangle className="h-3.5 w-3.5" /> {xlError}</p>}

      {sheets.length > 0 && xlDs && xlPrev && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {sheets.length > 1 && (
              <label className="block">
                <span className="mb-0.5 block text-[11px] font-bold text-slate-500">الورقة</span>
                <select className="input-field !py-2 !px-2.5 !text-sm" value={sheetIdx} onChange={(e) => setSheetIdx(Number(e.target.value))}>
                  {sheets.map((s, i) => <option key={i} value={i}>{s.name} ({Math.max(0, s.matrix.length - (xlHeader ? 1 : 0))} صف)</option>)}
                </select>
              </label>
            )}
            <label className="flex items-center gap-2 self-end pb-2 text-xs font-extrabold text-slate-600">
              <input type="checkbox" checked={xlHeader} onChange={(e) => setXlHeader(e.target.checked)} className="h-4 w-4 accent-amber-600" />
              الصف الأول = أسماء الأعمدة
            </label>
          </div>
          <p className="text-[11px] font-extrabold text-slate-500">
            تم اكتشاف {xlDs.columns.length} عمود · {xlDs.rows.length} صف
          </p>
          <MatrixPreview headers={xlPrev.headers} rows={xlPrev.rows} />
          <div className="grid grid-cols-2 gap-2">
            {hasData && (
              <button onClick={() => onAppend(xlDs)} disabled={!xlDs.rows.length} className="btn-secondary !py-2.5 text-sm">إضافة للجدول الحالي</button>
            )}
            <button onClick={() => onReplace(xlDs)} disabled={!xlDs.rows.length} className={`btn-primary !py-2.5 flex items-center justify-center gap-2 text-sm !from-amber-600 !to-amber-500 ${hasData ? '' : 'col-span-2'}`}>
              <ArrowRight className="h-4 w-4" /> {hasData ? 'استبدال الجدول' : 'استخدام هذه البيانات'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
