// ---------- Bulk Print (الطباعة الجماعية) — data model & pure helpers ----------
// A dataset is a small in-memory spreadsheet: ordered columns + rows of string
// cells. Every row becomes ONE card rendered with the template design; the
// {{key}} placeholders in the design's free-text elements (and the standard
// variable / constant elements through the mapping) are filled from the row.
// Nothing here touches the database — the Card Designer itself is unchanged.

import type { CardConstantsData, CardPersonData } from '@/components/cards/CardCanvas';
import type { CardDesign } from '@/lib/card-types';

// ----- dataset -----
export interface BulkColumn {
  id: string;
  key: string;      // placeholder name → {{key}}
  enabled: boolean; // available to the card design (mapping + placeholders)
}

export interface BulkRow {
  id: string;
  cells: Record<string, string>; // columnId → value
}

export interface BulkDataset {
  columns: BulkColumn[];
  rows: BulkRow[];
}

export const EMPTY_DATASET: BulkDataset = { columns: [], rows: [] };

let seq = 0;
export const uid = (p = 'b'): string => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

// Turn a header text into a placeholder key: trimmed, spaces → "_", braces
// removed. Arabic (or any script) is kept as is → {{الاسم}} works too.
export const normalizeKey = (raw: string, fallbackIndex = 0): string => {
  const k = String(raw ?? '')
    .replace(/[{}]/g, '')
    .trim()
    .replace(/\s+/g, '_');
  return k || `col${fallbackIndex + 1}`;
};

// make keys unique inside a dataset (code, code_2, code_3 …)
export const uniqueKeys = (keys: string[]): string[] => {
  const seen = new Map<string, number>();
  return keys.map((k) => {
    const base = k.toLowerCase();
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? k : `${k}_${n + 1}`;
  });
};

export const makeColumns = (headers: string[]): BulkColumn[] =>
  uniqueKeys(headers.map((h, i) => normalizeKey(h, i))).map((key) => ({ id: uid('c'), key, enabled: true }));

// build a dataset from a header list + a matrix of cell values
export const datasetFromMatrix = (headers: string[], matrix: string[][]): BulkDataset => {
  const columns = makeColumns(headers);
  const rows: BulkRow[] = matrix.map((r) => {
    const cells: Record<string, string> = {};
    columns.forEach((c, i) => { cells[c.id] = String(r[i] ?? '').trim(); });
    return { id: uid('r'), cells };
  });
  return { columns, rows };
};

// ----- code generation -----
export type CodeKind = 'sequential' | 'random';
export type RandomCharset = 'alnum' | 'digits' | 'letters';

export interface CodeGenOptions {
  count: number;
  kind: CodeKind;
  length: number;        // digits (sequential, zero-padded) / characters (random)
  prefix: string;
  suffix: string;
  start: number;         // sequential only
  step: number;          // sequential only
  charset: RandomCharset; // random only
}

export const DEFAULT_CODE_OPTIONS: CodeGenOptions = {
  count: 100,
  kind: 'sequential',
  length: 3,
  prefix: '',
  suffix: '',
  start: 1,
  step: 1,
  charset: 'alnum',
};

// no 0/O/1/I to keep printed codes unambiguous
const CHARSETS: Record<RandomCharset, string> = {
  alnum: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  digits: '0123456789',
  letters: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
};

const randomInt = (n: number): number => {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] % n;
  }
  return Math.floor(Math.random() * n);
};

export const MAX_GENERATED = 20000;

export const generateCodes = (o: CodeGenOptions): string[] => {
  const count = Math.max(0, Math.min(MAX_GENERATED, Math.floor(o.count || 0)));
  const length = Math.max(1, Math.min(32, Math.floor(o.length || 1)));
  const out: string[] = [];
  if (o.kind === 'sequential') {
    const step = o.step === 0 ? 1 : Math.floor(o.step);
    for (let i = 0; i < count; i++) {
      const n = Math.floor(o.start) + i * step;
      const body = String(Math.abs(n)).padStart(length, '0');
      out.push(`${o.prefix}${n < 0 ? '-' : ''}${body}${o.suffix}`);
    }
    return out;
  }
  const chars = CHARSETS[o.charset] ?? CHARSETS.alnum;
  const used = new Set<string>();
  // give up on uniqueness only when the space is exhausted (tiny lengths)
  const space = Math.pow(chars.length, length);
  let guard = 0;
  while (out.length < count && guard < count * 50) {
    guard++;
    let s = '';
    for (let i = 0; i < length; i++) s += chars[randomInt(chars.length)];
    if (used.has(s) && used.size < space) continue;
    used.add(s);
    out.push(`${o.prefix}${s}${o.suffix}`);
  }
  return out;
};

// preview text for the generator UI: «001, 002, 003 …»
export const previewCodes = (o: CodeGenOptions, n = 3): string => {
  const sample = generateCodes({ ...o, count: Math.min(n, o.count || n) });
  return sample.length ? `${sample.join(' · ')}${(o.count ?? 0) > n ? ' …' : ''}` : '—';
};

// ----- pasted text → matrix -----
// Accepts spreadsheet paste (TAB separated), CSV (comma / semicolon) or one
// value per line. Quoted CSV fields are honoured.
export const detectDelimiter = (text: string): string => {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  const score = (d: string) => lines.reduce((s, l) => s + (l.split(d).length - 1), 0);
  const tab = score('\t');
  if (tab > 0) return '\t';
  const comma = score(',');
  const semi = score(';');
  if (semi > comma) return ';';
  if (comma > 0) return ',';
  return '\n'; // single column
};

const splitCsvLine = (line: string, d: string): string[] => {
  if (d === '\n') return [line];
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
};

export const parsePastedText = (text: string): string[][] => {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim().length > 0);
  if (!lines.length) return [];
  const d = detectDelimiter(text);
  const matrix = lines.map((l) => splitCsvLine(l, d).map((c) => c.trim()));
  const width = Math.max(...matrix.map((r) => r.length));
  return matrix.map((r) => { const c = [...r]; while (c.length < width) c.push(''); return c; });
};

// first row → headers (or generated col1…colN when there is no header row)
export const matrixToDataset = (matrix: string[][], firstRowIsHeader: boolean): BulkDataset => {
  if (!matrix.length) return EMPTY_DATASET;
  const width = Math.max(...matrix.map((r) => r.length));
  const headers = firstRowIsHeader
    ? matrix[0].map((h, i) => normalizeKey(h, i))
    : Array.from({ length: width }, (_, i) => `col${i + 1}`);
  const body = firstRowIsHeader ? matrix.slice(1) : matrix;
  return datasetFromMatrix(headers, body);
};

// ----- Excel → matrix (xlsx loaded lazily by the caller) -----
export interface ExcelSheet { name: string; matrix: string[][] }

export const readExcelFile = async (file: File): Promise<ExcelSheet[]> => {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: false, blankrows: false });
    const matrix = rows
      .map((r) => (Array.isArray(r) ? r.map((c) => (c == null ? '' : String(c).trim())) : []))
      .filter((r) => r.some((c) => c !== ''));
    const width = matrix.length ? Math.max(...matrix.map((r) => r.length)) : 0;
    return { name, matrix: matrix.map((r) => { const c = [...r]; while (c.length < width) c.push(''); return c; }) };
  });
};

// ----- mapping dataset columns → the standard card elements -----
// The template's variable elements (الاسم · الهاتف · الرقم القومي/QR …),
// its photo and its constants (اسم الكنيسة / الخدمة / الفصل) each read ONE
// column of the dataset. Unmapped constants keep the template's own values.
export type MappableField =
  | 'name' | 'national_id' | 'phone' | 'address' | 'birthdate' | 'image_url'
  | 'church_name' | 'service_name' | 'class_name';

export type BulkMapping = Partial<Record<MappableField, string>>; // field → columnId

export const MAPPABLE_FIELDS: { value: MappableField; label: string; hint: string }[] = [
  { value: 'national_id', label: 'الكود / الرقم القومي + QR', hint: 'يُستخدم لعنصر «الرقم القومي» ورمز QR' },
  { value: 'name', label: 'الاسم', hint: 'عنصر «الاسم»' },
  { value: 'phone', label: 'الهاتف', hint: 'عنصر «الهاتف»' },
  { value: 'birthdate', label: 'تاريخ الميلاد', hint: 'عنصرا «تاريخ الميلاد» و«السن» (YYYY-MM-DD)' },
  { value: 'address', label: 'العنوان', hint: 'عنصر «العنوان»' },
  { value: 'image_url', label: 'رابط الصورة', hint: 'عنصر «صورة المخدوم» (رابط صورة)' },
  { value: 'church_name', label: 'اسم الكنيسة', hint: 'يستبدل ثابت «اسم الكنيسة»' },
  { value: 'service_name', label: 'اسم الخدمة', hint: 'يستبدل ثابت «اسم الخدمة»' },
  { value: 'class_name', label: 'اسم الفصل', hint: 'يستبدل ثابت «اسم الفصل»' },
];

// header synonyms used by the auto-mapper (lower-cased, spaces → _)
const SYNONYMS: Record<MappableField, string[]> = {
  national_id: ['code', 'كود', 'الكود', 'id', 'national_id', 'nationalid', 'الرقم_القومي', 'رقم_قومي', 'الرقم', 'رقم', 'qr', 'serial', 'number', 'no'],
  name: ['name', 'الاسم', 'اسم', 'full_name', 'fullname', 'student', 'الطالب', 'المخدوم'],
  phone: ['phone', 'الهاتف', 'هاتف', 'mobile', 'الموبايل', 'موبايل', 'tel', 'رقم_الهاتف', 'تليفون'],
  address: ['address', 'العنوان', 'عنوان'],
  birthdate: ['birthdate', 'birthday', 'dob', 'تاريخ_الميلاد', 'الميلاد'],
  image_url: ['image', 'image_url', 'photo', 'photo_url', 'الصورة', 'صورة', 'picture', 'img'],
  church_name: ['church', 'الكنيسة', 'كنيسة'],
  service_name: ['service', 'الخدمة', 'خدمة'],
  class_name: ['class', 'الفصل', 'فصل', 'grade', 'الصف', 'group', 'المجموعة'],
};

export const autoMap = (columns: BulkColumn[], current: BulkMapping = {}): BulkMapping => {
  const next: BulkMapping = { ...current };
  const taken = new Set(Object.values(next).filter(Boolean) as string[]);
  (Object.keys(SYNONYMS) as MappableField[]).forEach((field) => {
    if (next[field] && columns.some((c) => c.id === next[field])) return;
    delete next[field];
    const col = columns.find((c) => c.enabled && !taken.has(c.id) && SYNONYMS[field].includes(c.key.toLowerCase()));
    if (col) { next[field] = col.id; taken.add(col.id); }
  });
  return next;
};

// drop mapping entries that point at deleted / disabled columns
export const pruneMapping = (m: BulkMapping, columns: BulkColumn[]): BulkMapping => {
  const ok = new Set(columns.filter((c) => c.enabled).map((c) => c.id));
  const out: BulkMapping = {};
  (Object.keys(m) as MappableField[]).forEach((f) => { const id = m[f]; if (id && ok.has(id)) out[f] = id; });
  return out;
};

// ----- row → card data -----
export const rowFields = (row: BulkRow, columns: BulkColumn[]): Record<string, string> => {
  const f: Record<string, string> = {};
  columns.forEach((c) => { if (c.enabled) f[c.key] = row.cells[c.id] ?? ''; });
  return f;
};

export const rowToCardData = (
  row: BulkRow,
  columns: BulkColumn[],
  mapping: BulkMapping,
  templateConstants: CardConstantsData,
): { person: CardPersonData; constants: CardConstantsData } => {
  const get = (f: MappableField): string | null => {
    const id = mapping[f];
    if (!id) return null;
    const v = row.cells[id];
    return v == null ? null : String(v);
  };
  const fields = rowFields(row, columns);
  // no mapping → the first enabled column feeds the QR / national id so a
  // plain «codes only» dataset works without any setup
  const firstCol = columns.find((c) => c.enabled);
  const national = get('national_id') ?? (firstCol ? row.cells[firstCol.id] ?? '' : '');
  const person: CardPersonData = {
    name: get('name') ?? '',
    national_id: national,
    birthdate: get('birthdate') || null,
    phone: get('phone'),
    address: get('address'),
    image_url: get('image_url') || null,
    fields,
  };
  const constants: CardConstantsData = {
    ...templateConstants,
    church_name: get('church_name') ?? templateConstants.church_name,
    service_name: get('service_name') ?? templateConstants.service_name,
    class_name: get('class_name') ?? templateConstants.class_name,
  };
  return { person, constants };
};

// ----- placeholders used by the design -----
export const PLACEHOLDER_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

export const placeholdersInDesign = (design: CardDesign): string[] => {
  const found = new Set<string>();
  design.elements.forEach((el) => {
    [el.text ?? '', el.label ?? ''].forEach((s) => {
      const re = new RegExp(PLACEHOLDER_RE.source, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(s)) !== null) found.add(m[1].trim());
    });
  });
  return Array.from(found);
};

// placeholders written in the design that no enabled column provides
export const missingPlaceholders = (design: CardDesign, columns: BulkColumn[]): string[] => {
  const keys = new Set(columns.filter((c) => c.enabled).map((c) => c.key.toLowerCase()));
  return placeholdersInDesign(design).filter((p) => !keys.has(p.toLowerCase()));
};

// ----- range parsing «1-50, 60, 70-75» → sorted unique 1-based indices -----
export const parseRange = (text: string, max: number): number[] => {
  const out = new Set<number>();
  text
    .replace(/[–—]/g, '-')
    .split(/[,\s،]+/)
    .filter(Boolean)
    .forEach((part) => {
      const m = part.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) return;
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : a;
      const lo = Math.max(1, Math.min(a, b));
      const hi = Math.min(max, Math.max(a, b));
      for (let i = lo; i <= hi; i++) out.add(i);
    });
  return Array.from(out).sort((x, y) => x - y);
};

// ----- persistence (per template, browser only) -----
export interface BulkState {
  dataset: BulkDataset;
  mapping: BulkMapping;
}

const storageKey = (templateId: string) => `bulk-print:${templateId}`;

export const loadBulkState = (templateId: string): BulkState | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(templateId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BulkState;
    if (!parsed?.dataset?.columns || !parsed?.dataset?.rows) return null;
    return parsed;
  } catch { return null; }
};

export const saveBulkState = (templateId: string, state: BulkState): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(templateId), JSON.stringify(state));
  } catch { /* quota exceeded on huge datasets — keep working in memory */ }
};

export const clearBulkState = (templateId: string): void => {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(storageKey(templateId)); } catch { /* ignore */ }
};
