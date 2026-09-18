'use client';

// ---------- إضافة خدام — جماعي (Excel / لصق) — migration 0041 ----------
// Same UX as «إضافة مخدومين → إضافة جماعية»: import → map columns → options
// → preview → import. Every row becomes an APPROVED servant with a login
// (code + password). Passwords come from a column or are generated; the
// final credentials sheet is exported to Excel so the manager can hand them out.

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  FileSpreadsheet, ClipboardPaste, Upload, Trash2, Check, X, Loader2, Wand2, KeyRound, Download, MapPin, Pencil, SkipForward,
} from 'lucide-react';
import BulkRowEditModal from '@/components/BulkRowEditModal';
import { usePermissions } from '@/lib/permissions-context';
import { useCodeGenerator } from '@/lib/customization-context';
import { monotonicClock } from '@/lib/code-templates';
import {
  normalizePhone, parseFullDate, parseSplitDate, parseGender, parsePastedTable, readSpreadsheet,
  toLatinDigits, generatePassword, phoneToLocalDigits, findRepeatedCodes,
  type DateOrder, type BulkRowEdits, type BulkRowStatus,
} from '@/lib/bulk-import';
import { DEFAULT_PASSWORD, codeToUserId } from '@/lib/types';
import { useServantScope, RoleScopeFields, ProfileChips, postAddServants, outcomeLabel } from '@/components/servants/AddServantBits';
import {
  PHONE_LOCAL_LENGTH, ROLE_LABELS,
  type Church, type Service, type ClassRoom, type Gender, type ServantEnrollment, type AddServantInput, type AddServantOutcome,
} from '@/lib/types';

type BulkField =
  | 'name' | 'gender' | 'phone' | 'birthdate' | 'birth_day' | 'birth_month' | 'birth_year'
  | 'address' | 'notes' | 'code' | 'password' | 'skip';

const BULK_FIELDS: { value: BulkField; label: string }[] = [
  { value: 'skip', label: '— تجاهل —' },
  { value: 'name', label: 'الاسم' },
  { value: 'code', label: 'الكود (اسم الدخول)' },
  { value: 'password', label: 'كلمة المرور' },
  { value: 'gender', label: 'النوع' },
  { value: 'phone', label: 'رقم الهاتف' },
  { value: 'birthdate', label: 'تاريخ الميلاد (كامل)' },
  { value: 'birth_day', label: 'يوم الميلاد' },
  { value: 'birth_month', label: 'شهر الميلاد' },
  { value: 'birth_year', label: 'سنة الميلاد' },
  { value: 'address', label: 'العنوان' },
  { value: 'notes', label: 'ملاحظات' },
];

const guessField = (header: string): BulkField => {
  const h = header.trim().toLowerCase();
  if (/كلمة|مرور|pass|pwd/.test(h)) return 'password';
  if (/اسم|name/.test(h)) return 'name';
  if (/نوع|جنس|gender|sex/.test(h)) return 'gender';
  if (/هاتف|موبايل|تليفون|phone|mobile|tel/.test(h)) return 'phone';
  if (/يوم|day/.test(h)) return 'birth_day';
  if (/شهر|month/.test(h)) return 'birth_month';
  if (/سنة|عام|year/.test(h)) return 'birth_year';
  if (/ميلاد|تاريخ|birth|date|dob/.test(h)) return 'birthdate';
  if (/عنوان|address/.test(h)) return 'address';
  if (/ملاحظ|note/.test(h)) return 'notes';
  if (/قومي|كود|دخول|national|code|qr|login|user/.test(h)) return 'code';
  return 'skip';
};

interface BulkRow {
  key: number;
  cells: string[];
  genderOverride?: Gender | null;
  edits?: BulkRowEdits;             // manual corrections from the edit modal (win over cells)
  status: BulkRowStatus;            // skipped = not added (duplicate code …) — reported at the end
  message?: string;
  /** filled after a successful import (for the credentials export) */
  cred?: { name: string; code: string; password: string };
}

interface Resolved {
  row: BulkRow;
  name: string;
  gender: Gender | null;
  code: string;            // '' | 'AUTO' | value
  password: string;        // '' | 'AUTO' | value
  birthdate: string | null;
  birthdateRaw: string;
  phone: string | null | undefined;   // undefined = invalid (→ added WITHOUT phone, flagged)
  phoneRaw: string;
  address: string;
  notes: string;
  duplicateInBatch: boolean;          // same login code appeared in an earlier row → skipped
}

export default function BulkAddServants({
  approver, churches, services, classes, onAdded,
}: {
  approver: ServantEnrollment; churches: Church[]; services: Service[]; classes: ClassRoom[]; onAdded?: () => void;
}) {
  const { profiles: permissionProfiles, reload: reloadPermissions } = usePermissions();
  const scope = useServantScope(approver, churches, services, classes);
  const genCode = useCodeGenerator('servant');

  const [rows, setRows] = useState<BulkRow[]>([]);
  const [mapping, setMapping] = useState<BulkField[]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState<{ ok: number; fail: number; skipped: number } | null>(null);
  const [editingKey, setEditingKey] = useState<number | null>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);

  // options
  const [defaultGender, setDefaultGender] = useState<Gender | ''>('');
  const [autoCodes, setAutoCodes] = useState(true);
  const [autoPasswords, setAutoPasswords] = useState(true);
  // 0043: rows without a password get the DEFAULT (000000) or a random one
  const [pwMode, setPwMode] = useState<'default' | 'random'>('default');
  const [dateOrder, setDateOrder] = useState<DateOrder>('auto');
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);

  const colCount = rows.length ? Math.max(...rows.map((r) => r.cells.length)) : 0;

  const applyData = useCallback((matrix: string[][]) => {
    const clean = matrix.map((r) => r.map((c) => String(c ?? '').trim())).filter((r) => r.some((c) => c !== ''));
    if (!clean.length) { setError('لا توجد بيانات'); return; }
    setError(''); setDone(null);
    setRows(clean.map((cells, i) => ({ key: i, cells, status: 'pending' })));
    const cols = Math.max(...clean.map((r) => r.length));
    const guessed: BulkField[] = Array.from({ length: cols }, (_, i) => guessField(clean[0][i] ?? ''));
    if (!guessed.includes('name') && cols > 0) guessed[0] = 'name';
    setMapping(guessed);
  }, []);

  const onExcelFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try { applyData(await readSpreadsheet(file)); } catch { setError('تعذر قراءة ملف الإكسل'); }
  };
  const applyPaste = () => { applyData(parsePastedTable(pasteText)); setPasteOpen(false); setPasteText(''); };

  const setColMapping = (i: number, f: BulkField) =>
    setMapping((m) => {
      const next = [...m];
      if (f !== 'skip') for (let j = 0; j < next.length; j++) if (next[j] === f) next[j] = 'skip';
      next[i] = f;
      return next;
    });

  const dataRows = useMemo(() => (hasHeader ? rows.slice(1) : rows), [rows, hasHeader]);
  const col = useCallback((f: BulkField) => mapping.indexOf(f), [mapping]);
  const cellOf = useCallback((row: BulkRow, f: BulkField) => { const i = col(f); return i === -1 ? '' : (row.cells[i] ?? '').trim(); }, [col]);

  const hasGenderData = col('gender') !== -1;
  const hasCodeCol = col('code') !== -1;
  const hasPasswordCol = col('password') !== -1;
  const hasFullDate = col('birthdate') !== -1;
  const hasSplitDate = col('birth_day') !== -1 || col('birth_month') !== -1 || col('birth_year') !== -1;

  // Manual edits (row.edits) win over the parsed cells for every field.
  const resolved: Resolved[] = useMemo(() => {
    const list: Resolved[] = dataRows.map((row) => {
      const ed = row.edits ?? {};
      let gender: Gender | null = null;
      if (ed.gender !== undefined) gender = ed.gender;
      else if (row.genderOverride !== undefined) gender = row.genderOverride;
      else { gender = hasGenderData ? parseGender(cellOf(row, 'gender')) : null; if (!gender && defaultGender) gender = defaultGender; }

      let code = (ed.code !== undefined ? ed.code : cellOf(row, 'code')).trim();
      if (!code && autoCodes) code = 'AUTO';
      let password = ed.password !== undefined ? ed.password : cellOf(row, 'password');
      if (!password && autoPasswords) password = pwMode === 'default' ? DEFAULT_PASSWORD : 'AUTO';

      let birthdate: string | null = null, birthdateRaw = '';
      if (ed.birthdate !== undefined) birthdate = ed.birthdate;
      else if (hasFullDate) { birthdateRaw = cellOf(row, 'birthdate'); birthdate = parseFullDate(birthdateRaw, dateOrder); }
      else if (hasSplitDate) {
        const d = toLatinDigits(cellOf(row, 'birth_day')), m = cellOf(row, 'birth_month'), y = toLatinDigits(cellOf(row, 'birth_year'));
        birthdateRaw = [d, m, y].filter(Boolean).join(' / ');
        birthdate = parseSplitDate(d, m, y);
      }
      const phoneRaw = ed.phone !== undefined ? ed.phone : cellOf(row, 'phone');
      return {
        row, name: (ed.name !== undefined ? ed.name : cellOf(row, 'name')).trim(), gender, code, password, birthdate, birthdateRaw,
        phone: normalizePhone(phoneRaw), phoneRaw,
        address: ed.address !== undefined ? ed.address : cellOf(row, 'address'),
        notes: ed.notes !== undefined ? ed.notes : cellOf(row, 'notes'),
        duplicateInBatch: false,
      };
    });
    // same LOGIN (code_to_user_id) twice in the file: first row wins, the rest are skipped
    const repeats = findRepeatedCodes(list.map((r) => (r.row.status === 'ok' ? null : r.code)), codeToUserId);
    repeats.forEach((i) => { list[i].duplicateInBatch = true; });
    return list;
  }, [dataRows, cellOf, hasGenderData, defaultGender, autoCodes, autoPasswords, pwMode, hasFullDate, hasSplitDate, dateOrder]);

  const cycleGender = (key: number) =>
    setRows((rs) => rs.map((r) => {
      if (r.key !== key) return r;
      const current = r.genderOverride !== undefined ? r.genderOverride
        : (hasGenderData ? parseGender(cellOf(r, 'gender')) : null) || (defaultGender || null);
      return { ...r, genderOverride: current === null ? 'male' : current === 'male' ? 'female' : null };
    }));
  const removeRow = (key: number) => { setRows((rs) => rs.filter((r) => r.key !== key)); setEditingKey(null); };

  // Save the edit-modal patch on a row (clears an old error / skip so it can be retried)
  const saveEdits = (key: number, edits: BulkRowEdits) => {
    setRows((rs) => rs.map((r) => (r.key === key
      ? { ...r, edits: { ...(r.edits ?? {}), ...edits }, genderOverride: undefined, status: r.status === 'ok' ? 'ok' : 'pending', message: undefined }
      : r)));
    setEditingKey(null);
  };
  const editing = editingKey === null ? null : resolved.find((r) => r.row.key === editingKey) ?? null;
  const editingIndex = editing ? resolved.indexOf(editing) + 1 : 0;

  const nameCol = col('name');
  const notDone = (r: Resolved) => r.row.status !== 'ok';
  const invalidPhones = resolved.filter((r) => notDone(r) && r.phone === undefined).length;
  const unparsedDates = resolved.filter((r) => notDone(r) && r.birthdateRaw && !r.birthdate).length;
  const missingCodes = resolved.filter((r) => notDone(r) && !r.code).length;
  const missingPw = resolved.filter((r) => notDone(r) && (!r.password || (r.password !== 'AUTO' && r.password.length < 6))).length;
  const duplicateCodes = resolved.filter((r) => notDone(r) && r.duplicateInBatch).length;
  const pendingCount = resolved.filter(notDone).length;
  const willImportCount = resolved.filter((r) =>
    notDone(r) && r.name && r.code && !r.duplicateInBatch && r.password && (r.password === 'AUTO' || r.password.length >= 6)).length;

  // ---------- Import (chunks of 25 → the server route) ----------
  // Never stops on a bad row: an invalid phone / date → the servant is added
  // WITHOUT that value; a duplicated / taken code → the row is SKIPPED.
  // Everything is reported at the end.
  const doImport = async () => {
    setError('');
    const scopeErr = scope.validate();
    if (scopeErr) return setError(scopeErr);
    if (nameCol === -1) return setError('حدد عمود الاسم');
    if (!resolved.length) return setError('لا توجد صفوف للاستيراد');

    setImporting(true); setProgress(0); setDone(null);
    const tick = monotonicClock();
    const setStatus = (key: number, status: BulkRow['status'], message?: string, cred?: BulkRow['cred']) =>
      setRows((rs) => rs.map((x) => (x.key === key ? { ...x, status, message, cred: cred ?? x.cred } : x)));

    // 1) local validation → payloads (bad rows are SKIPPED, not failed)
    const queue: { r: Resolved; item: AddServantInput; notes: string[] }[] = [];
    let ok = 0, fail = 0, skipped = 0;
    for (const r of resolved) {
      if (r.row.status === 'ok') continue;
      const skip = (msg: string) => { setStatus(r.row.key, 'skipped', msg); skipped++; };
      if (!r.name) { skip('الاسم مفقود'); continue; }
      if (!r.code) { skip('الكود مفقود'); continue; }
      if (r.duplicateInBatch) { skip(`الكود ${r.code} مكرر في الملف`); continue; }
      if (!r.password) { skip('كلمة المرور مفقودة'); continue; }
      if (r.password !== 'AUTO' && r.password.length < 6) { skip('كلمة المرور أقل من 6 أحرف'); continue; }
      const code = r.code === 'AUTO' ? genCode({ churchId: scope.churchId, serviceId: scope.serviceId, classId: scope.classId, now: tick() }) : r.code;
      const password = r.password === 'AUTO' ? generatePassword() : r.password;
      const notes: string[] = [];
      if (r.phone === undefined) notes.push('أُضيف بدون هاتف (رقم غير صالح)');
      if (r.birthdateRaw && !r.birthdate) notes.push('أُضيف بدون تاريخ ميلاد (صيغة غير مفهومة)');
      queue.push({
        r, notes,
        item: {
          code, full_name: r.name, password, role: scope.role, ...scope.payloadScope,
          gender: r.gender, birthdate: r.birthdate, phone: r.phone ?? null,
          address: r.address || null, notes: r.notes || null, image_url: null, profile_ids: selectedProfiles,
        },
      });
    }

    // 2) send in chunks so one slow account never blocks the whole batch
    const CHUNK = 25;
    let sent = 0;
    for (let i = 0; i < queue.length; i += CHUNK) {
      const part = queue.slice(i, i + CHUNK);
      const outcomes: AddServantOutcome[] = await postAddServants(part.map((p) => p.item));
      part.forEach((p, j) => {
        const o = outcomes[j] ?? { ok: false as const, error: 'failed' as const };
        if (o.ok) {
          ok++;
          setStatus(p.r.row.key, 'ok', p.notes.join(' · ') || undefined, { name: p.item.full_name, code: o.national_id, password: p.item.password });
        } else if (o.error === 'code_taken' || o.error === 'already_registered' || o.error === 'duplicate_in_batch') {
          // a duplicated code is NOT an error — the row is simply not added
          skipped++;
          setStatus(p.r.row.key, 'skipped', `الكود ${p.item.code} — ${outcomeLabel(o)}`);
        } else {
          fail++;
          setStatus(p.r.row.key, 'error', outcomeLabel(o));
        }
      });
      sent += part.length;
      setProgress(Math.round((sent / Math.max(1, queue.length)) * 100));
    }

    setImporting(false);
    setDone({ ok, fail, skipped });
    if (ok > 0) { await reloadPermissions(); onAdded?.(); }
  };

  // ---------- credentials export ----------
  const creds = useMemo(() => rows.filter((r) => r.status === 'ok' && r.cred).map((r) => r.cred!), [rows]);
  const exportCreds = async () => {
    if (!creds.length) return;
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(creds.map((c) => ({ 'الاسم': c.name, 'الكود (اسم الدخول)': c.code, 'كلمة المرور': c.password })));
    ws['!cols'] = [{ wch: 30 }, { wch: 24 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws, 'بيانات الدخول');
    XLSX.writeFile(wb, `بيانات_دخول_الخدام_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const reset = () => {
    setRows([]); setMapping([]); setDone(null); setError(''); setProgress(0); setEditingKey(null);
    setDefaultGender(''); setAutoCodes(true); setAutoPasswords(true); setDateOrder('auto');
  };

  const optBtn = (on: boolean, cls: string, off = 'bg-slate-100 text-slate-500') =>
    `rounded-xl py-2 text-xs font-extrabold transition active:scale-95 ${on ? cls : off}`;

  return (
    <div className="space-y-4">
      {/* scope */}
      <div className="card space-y-3">
        <p className="flex items-center gap-1.5 text-sm font-extrabold text-slate-600">
          <MapPin className="h-4 w-4 text-primary-500" /> الدور ومكان الخدمة <span className="text-xs font-normal text-slate-400">(لكل الصفوف)</span>
        </p>
        <RoleScopeFields scope={scope} approver={approver} churches={churches} idPrefix="bulk-srv" />
      </div>

      {rows.length === 0 && (
        <div className="grid grid-cols-2 gap-3">
          <button id="bulk-srv-excel-btn" type="button" onClick={() => excelInputRef.current?.click()}
            className="card flex aspect-square flex-col items-center justify-center gap-2 !p-3 transition active:scale-95">
            <FileSpreadsheet className="h-10 w-10 text-emerald-500" />
            <span className="text-xs font-extrabold text-slate-500">استيراد من إكسل</span>
            <span className="text-[10px] text-slate-400" dir="ltr">.xlsx / .xls / .csv</span>
          </button>
          <button id="bulk-srv-paste-btn" type="button" onClick={() => setPasteOpen(true)}
            className="card flex aspect-square flex-col items-center justify-center gap-2 !p-3 transition active:scale-95">
            <ClipboardPaste className="h-10 w-10 text-primary-500" />
            <span className="text-xs font-extrabold text-slate-500">لصق البيانات</span>
            <span className="text-[10px] text-slate-400">من جدول أو نص</span>
          </button>
          <input ref={excelInputRef} id="bulk-srv-excel-input" type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onExcelFile} />
          <p className="col-span-2 rounded-xl bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-500">
            الأعمدة المقترحة: الاسم · الكود · كلمة المرور · النوع · الهاتف · تاريخ الميلاد · العنوان · ملاحظات — الاسم فقط إلزامي، والباقي يُولَّد تلقائيًا.
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <>
          {/* 1 — mapping */}
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-700">١· تحديد الأعمدة</h3>
              <button id="bulk-srv-reset" type="button" onClick={reset} className="flex items-center gap-1 text-xs font-bold text-red-500">
                <Trash2 className="h-3.5 w-3.5" /> مسح البيانات
              </button>
            </div>
            <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
              <input id="bulk-srv-has-header" type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} className="h-4 w-4 accent-primary-600" />
              الصف الأول عناوين (يتم تجاهله)
            </label>
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full min-w-max text-xs">
                <thead><tr>
                  {Array.from({ length: colCount }, (_, i) => (
                    <th key={i} className="p-1">
                      <select id={`bulk-srv-map-${i}`} aria-label={`عمود ${i + 1}`}
                        className={`input-field !w-36 !px-2 !py-1.5 !text-xs font-extrabold ${(mapping[i] ?? 'skip') !== 'skip' ? '!border-primary-300 !bg-primary-50' : ''}`}
                        value={mapping[i] ?? 'skip'} onChange={(e) => setColMapping(i, e.target.value as BulkField)}>
                        {BULK_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                    </th>
                  ))}
                </tr></thead>
                <tbody>
                  {dataRows.slice(0, 5).map((row, ri) => (
                    <tr key={row.key} className={ri % 2 ? 'bg-slate-50' : ''}>
                      {Array.from({ length: colCount }, (_, ci) => (
                        <td key={ci} className="max-w-[130px] truncate border-t border-indigo-50 p-1.5 font-bold text-slate-600">{row.cells[ci] ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] font-bold text-slate-400">معاينة أول 5 صفوف — إجمالي {dataRows.length} صفًا</p>
          </div>

          {/* 2 — options */}
          <div className="card space-y-4">
            <h3 className="text-sm font-extrabold text-slate-700">٢· خيارات الاستيراد</h3>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500">
                النوع {hasGenderData ? '— يُقرأ من العمود، ويمكن تعديل كل صف من المعاينة' : '— لا يوجد عمود نوع، اختر للجميع:'}
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button id="bulk-srv-gender-none" type="button" aria-pressed={defaultGender === ''} onClick={() => setDefaultGender('')}
                  className={optBtn(defaultGender === '', 'bg-slate-600 text-white shadow')}>{hasGenderData ? 'من العمود' : 'بدون'}</button>
                <button id="bulk-srv-gender-male" type="button" aria-pressed={defaultGender === 'male'} onClick={() => setDefaultGender(defaultGender === 'male' ? '' : 'male')}
                  className={optBtn(defaultGender === 'male', 'bg-primary-600 text-white shadow', 'bg-primary-50 text-primary-600')}>الكل ذكور</button>
                <button id="bulk-srv-gender-female" type="button" aria-pressed={defaultGender === 'female'} onClick={() => setDefaultGender(defaultGender === 'female' ? '' : 'female')}
                  className={optBtn(defaultGender === 'female', 'bg-pink-500 text-white shadow', 'bg-pink-50 text-pink-500')}>الكل إناث</button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                <input id="bulk-srv-auto-codes" type="checkbox" checked={autoCodes} onChange={(e) => setAutoCodes(e.target.checked)} className="h-4 w-4 accent-primary-600" />
                <Wand2 className="h-4 w-4 text-primary-500" />
                توليد كود تلقائي {hasCodeCol ? 'للصفوف التي بلا كود' : 'لكل الخدام'} <span className="font-normal text-slate-400">(حسب نظام الأكواد)</span>
              </label>
              <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                <input id="bulk-srv-auto-pw" type="checkbox" checked={autoPasswords} onChange={(e) => setAutoPasswords(e.target.checked)} className="h-4 w-4 accent-primary-600" />
                <KeyRound className="h-4 w-4 text-violet-500" />
                كلمة مرور تلقائية {hasPasswordCol ? 'للصفوف التي بلا كلمة مرور' : 'لكل الخدام'}
              </label>
              {autoPasswords && (
                <div className="mr-6 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1" role="group" aria-label="نوع كلمة المرور التلقائية">
                  <button id="bulk-srv-pw-default" type="button" aria-pressed={pwMode === 'default'} onClick={() => setPwMode('default')}
                    className={`h-8 rounded-lg text-[11px] font-extrabold transition ${pwMode === 'default' ? 'bg-white text-primary-700 shadow' : 'text-slate-500'}`}>
                    الافتراضية <span dir="ltr">{DEFAULT_PASSWORD}</span>
                  </button>
                  <button id="bulk-srv-pw-random" type="button" aria-pressed={pwMode === 'random'} onClick={() => setPwMode('random')}
                    className={`h-8 rounded-lg text-[11px] font-extrabold transition ${pwMode === 'random' ? 'bg-white text-primary-700 shadow' : 'text-slate-500'}`}>
                    عشوائية (8 أحرف)
                  </button>
                </div>
              )}
              {(missingCodes > 0 || missingPw > 0) && (
                <p className="text-[11px] font-bold text-amber-600">
                  ⚠ {missingCodes > 0 ? `${missingCodes} صف بلا كود` : ''}{missingCodes > 0 && missingPw > 0 ? ' · ' : ''}{missingPw > 0 ? `${missingPw} صف بلا كلمة مرور صالحة (6 أحرف+)` : ''} — لن تُضاف (عدّلها من المعاينة أو فعّل التوليد التلقائي)
                </p>
              )}
            </div>

            {(hasFullDate || hasSplitDate) && (
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-500">تاريخ الميلاد</label>
                {hasFullDate ? (
                  <div className="grid grid-cols-3 gap-2">
                    <button type="button" aria-pressed={dateOrder === 'auto'} onClick={() => setDateOrder('auto')} className={optBtn(dateOrder === 'auto', 'bg-slate-600 text-white shadow')}>تلقائي</button>
                    <button type="button" aria-pressed={dateOrder === 'dmy'} onClick={() => setDateOrder('dmy')} dir="ltr" className={optBtn(dateOrder === 'dmy', 'bg-primary-600 text-white shadow', 'bg-primary-50 text-primary-600')}>dd/mm/yyyy</button>
                    <button type="button" aria-pressed={dateOrder === 'mdy'} onClick={() => setDateOrder('mdy')} dir="ltr" className={optBtn(dateOrder === 'mdy', 'bg-primary-600 text-white shadow', 'bg-primary-50 text-primary-600')}>mm/dd/yyyy</button>
                  </div>
                ) : (
                  <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-500">التاريخ من 3 أعمدة (يوم/شهر/سنة) — الشهر يُقبل رقمًا أو اسمًا</p>
                )}
                {unparsedDates > 0 && <p className="mt-1 text-[11px] font-bold text-amber-600">⚠ {unparsedDates} تاريخ لم يُفهم — عدّله من المعاينة أو سيُحفظ الخادم بدون تاريخ</p>}
              </div>
            )}

            <ProfileChips profiles={permissionProfiles} selected={selectedProfiles} idPrefix="bulk-srv"
              onToggle={(id) => setSelectedProfiles((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))} />
          </div>

          {/* 3 — preview */}
          <div className="card space-y-2">
            <h3 className="text-sm font-extrabold text-slate-700">٣· المعاينة النهائية <span className="text-xs font-normal text-slate-400">— {ROLE_LABELS[scope.role]}</span></h3>
            <p className="text-[11px] font-bold text-slate-400">اضغط على الاسم أو زر التعديل لتصحيح أي بيان قبل الإضافة — وعلى النوع لتبديله</p>
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full min-w-max text-xs">
                <thead><tr className="text-right text-[11px] font-extrabold text-slate-400">
                  <th className="p-1.5">الاسم</th><th className="p-1.5">النوع</th><th className="p-1.5">الكود</th>
                  <th className="p-1.5">كلمة المرور</th><th className="p-1.5">الميلاد</th><th className="p-1.5">الهاتف</th><th className="p-1.5 w-16" />
                </tr></thead>
                <tbody>
                  {resolved.slice(0, 100).map((r) => (
                    <tr key={r.row.key} className={r.row.status === 'ok' ? 'bg-emerald-50' : r.row.status === 'error' ? 'bg-red-50' : r.row.status === 'skipped' || r.duplicateInBatch ? 'bg-amber-50' : ''}>
                      <td className="max-w-[120px] truncate border-t border-indigo-50 p-1.5 font-extrabold text-slate-700">
                        {r.row.status === 'ok' ? r.name : (
                          <button type="button" onClick={() => setEditingKey(r.row.key)} className="max-w-full truncate text-right hover:text-primary-600" title="تعديل الصف">
                            {r.name || <span className="text-red-500">؟ بلا اسم</span>}
                            {r.row.edits && <span className="mr-1 text-[10px] text-primary-500">✎</span>}
                          </button>
                        )}
                      </td>
                      <td className="border-t border-indigo-50 p-1">
                        <button type="button" aria-label="تبديل النوع" onClick={() => cycleGender(r.row.key)}
                          className={`rounded-lg px-2 py-1 text-[11px] font-extrabold transition active:scale-95 ${r.gender === 'male' ? 'bg-primary-100 text-primary-700' : r.gender === 'female' ? 'bg-pink-100 text-pink-600' : 'bg-slate-100 text-slate-400'}`}>
                          {r.gender === 'male' ? 'ذكر' : r.gender === 'female' ? 'أنثى' : '—'}
                        </button>
                      </td>
                      <td className="border-t border-indigo-50 p-1.5 font-bold text-slate-500" dir="ltr">
                        {r.row.cred ? r.row.cred.code : r.code === 'AUTO' ? <span className="text-primary-500">تلقائي ✨</span> : r.code || <span className="text-red-500">✗</span>}
                        {r.duplicateInBatch && r.row.status !== 'ok' && <span className="ml-1 text-amber-600" title="كود مكرر في الملف — لن يُضاف">⚠ مكرر</span>}
                      </td>
                      <td className="border-t border-indigo-50 p-1.5 font-mono font-bold text-slate-500" dir="ltr">
                        {r.row.cred ? r.row.cred.password : r.password === 'AUTO' ? <span className="text-violet-500">تلقائي ✨</span>
                          : r.password ? (r.password.length < 6 ? <span className="text-red-500">✗ قصيرة</span> : '••••••') : <span className="text-red-500">✗</span>}
                      </td>
                      <td className="border-t border-indigo-50 p-1.5 font-bold" dir="ltr">
                        {r.birthdate ? <span className="text-slate-600">{r.birthdate.split('-').reverse().join('/')}</span>
                          : r.birthdateRaw ? <button type="button" onClick={() => setEditingKey(r.row.key)} className="text-amber-500 underline decoration-dotted" title={`${r.birthdateRaw} — اضغط للتعديل`}>⚠ {r.birthdateRaw}</button> : '—'}
                      </td>
                      <td className="border-t border-indigo-50 p-1.5 font-bold" dir="ltr">
                        {r.phone === undefined ? <button type="button" onClick={() => setEditingKey(r.row.key)} className="text-amber-500 underline decoration-dotted" title={`${r.phoneRaw} — اضغط للتعديل`}>⚠ {r.phoneRaw}</button>
                          : r.phone ? <span className="text-slate-600">{r.phone}</span> : '—'}
                      </td>
                      <td className="border-t border-indigo-50 p-1">
                        {r.row.status === 'ok' ? <span title={r.row.message}><Check className="h-4 w-4 text-emerald-500" /></span>
                          : r.row.status === 'error' ? <span title={r.row.message}><X className="h-4 w-4 text-red-500" /></span>
                          : r.row.status === 'skipped' ? <span title={r.row.message}><SkipForward className="h-4 w-4 text-amber-500" /></span>
                          : (
                            <div className="flex items-center gap-1">
                              <button type="button" aria-label="تعديل الصف" onClick={() => setEditingKey(r.row.key)} className="text-slate-300 hover:text-primary-500"><Pencil className="h-4 w-4" /></button>
                              <button type="button" aria-label="حذف الصف" onClick={() => removeRow(r.row.key)} className="text-slate-300 hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
                            </div>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {resolved.length > 100 && <p className="text-[11px] font-bold text-slate-400">يتم عرض أول 100 صف — سيتم استيراد الكل ({resolved.length})</p>}
          </div>

          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p>}
          {importing && (
            <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-primary-500 transition-all" style={{ width: `${progress}%` }} /></div>
          )}

          {/* ---------- Result summary (after the import) ---------- */}
          {done && (
            <div className="space-y-2">
              <div className="space-y-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">
                <p>
                  ✓ تمت إضافة {done.ok} خادمًا واعتمادهم
                  {done.skipped > 0 ? ` · لم يُضف ${done.skipped}` : ''}
                  {done.fail > 0 ? ` · فشل ${done.fail}` : ''}
                </p>
                {creds.length > 0 && (
                  <button id="bulk-srv-export" type="button" onClick={exportCreds}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-white py-2 text-xs font-extrabold text-emerald-700 ring-1 ring-emerald-200">
                    <Download className="h-4 w-4" /> تصدير بيانات الدخول (Excel) — {creds.length}
                  </button>
                )}
                {creds.length > 0 && <p className="text-[11px] font-bold text-emerald-600">كلمات المرور تظهر هنا مرة واحدة — صدّرها الآن وسلّمها للخدام.</p>}
              </div>
              {resolved.some((r) => r.row.status === 'skipped') && (
                <div className="rounded-xl bg-amber-50 p-2 text-[11px] font-bold text-amber-700">
                  <p className="mb-1 flex items-center gap-1"><SkipForward className="h-3.5 w-3.5" /> لم يُضافوا (كود مكرر أو بيان ناقص):</p>
                  <ul className="space-y-0.5">
                    {resolved.map((r, i) => r.row.status === 'skipped' ? <li key={r.row.key}>صف {i + 1}: {r.name || 'بلا اسم'} — {r.row.message}</li> : null)}
                  </ul>
                </div>
              )}
              {resolved.some((r) => r.row.status === 'error') && (
                <div className="rounded-xl bg-red-50 p-2 text-[11px] font-bold text-red-600">
                  <p className="mb-1">فشل الحفظ (عدّل الصف وأعد المحاولة):</p>
                  <ul className="space-y-0.5">
                    {resolved.map((r, i) => r.row.status === 'error' ? <li key={r.row.key}>صف {i + 1}: {r.name} — {r.row.message}</li> : null)}
                  </ul>
                </div>
              )}
              {resolved.some((r) => r.row.status === 'ok' && r.row.message) && (
                <div className="rounded-xl bg-slate-50 p-2 text-[11px] font-bold text-slate-600">
                  <p className="mb-1">أُضيفوا مع ملاحظة:</p>
                  <ul className="space-y-0.5">
                    {resolved.map((r, i) => r.row.status === 'ok' && r.row.message ? <li key={r.row.key}>صف {i + 1}: {r.name} — {r.row.message}</li> : null)}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* ---------- Pre-import warnings (nothing blocks; everything can be edited) ---------- */}
          {!done && (invalidPhones > 0 || duplicateCodes > 0) && (
            <div className="space-y-1 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-600">
              {invalidPhones > 0 && <p>⚠ {invalidPhones} رقم هاتف غير صالح (يجب {PHONE_LOCAL_LENGTH} رقمًا) — اضغط عليه لتصحيحه، أو سيُضاف الخادم بدون هاتف</p>}
              {duplicateCodes > 0 && <p>⚠ {duplicateCodes} كود مكرر في الملف — سيُضاف الأول فقط ويُتجاوز الباقي (عدّل الكود لإضافته)</p>}
            </div>
          )}

          <button id="bulk-srv-import" type="button" onClick={doImport}
            disabled={importing || nameCol === -1 || !scope.churchId || pendingCount === 0}
            className="btn-primary w-full flex items-center justify-center gap-2">
            {importing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
            إضافة {willImportCount} خادمًا واعتمادهم{willImportCount !== pendingCount ? ` (من ${pendingCount})` : ''}
          </button>
        </>
      )}

      {/* Row edit modal */}
      {editing && (
        <BulkRowEditModal
          title="تعديل بيانات الخادم"
          rowNumber={editingIndex}
          codeLabel="الكود (اسم الدخول)"
          showPassword
          values={{
            name: editing.name,
            gender: editing.gender,
            code: editing.code,
            password: editing.password,
            birthdate: editing.birthdate,
            birthdateRaw: editing.birthdateRaw,
            phoneLocal: phoneToLocalDigits(editing.phoneRaw),
            phoneRaw: editing.phoneRaw,
            address: editing.address,
            notes: editing.notes,
          }}
          onSave={(edits) => saveEdits(editing.row.key, edits)}
          onClose={() => setEditingKey(null)}
          onRemove={() => removeRow(editing.row.key)}
        />
      )}

      {pasteOpen && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6">
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-extrabold">لصق البيانات</h3>
              <button type="button" onClick={() => setPasteOpen(false)} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <textarea id="bulk-srv-paste-textarea" className="input-field font-mono !text-xs" rows={8} dir="auto"
              placeholder={'الصق هنا من إكسل أو جوجل شيت...\nكل صف في سطر، الأعمدة مفصولة بـ Tab أو فاصلة'}
              value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
            <button id="bulk-srv-paste-apply" type="button" onClick={applyPaste} disabled={!pasteText.trim()}
              className="btn-primary mt-3 w-full flex items-center justify-center gap-2"><Check className="h-5 w-5" /> معاينة البيانات</button>
          </div>
        </div>
      )}
    </div>
  );
}
