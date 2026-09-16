// ---------- Bulk import helpers (Excel / pasted table → typed values) ----------
// Shared by «إضافة مخدومين → إضافة جماعية» and «إدارة الخدام → إضافة → جماعي».
// Pure functions — no React, no Supabase.

import { PHONE_PREFIX, PHONE_LOCAL_LENGTH, type Gender } from '@/lib/types';

/** Normalize a raw phone into +2XXXXXXXXXXX (11 local digits) or null; returns undefined when invalid */
export const normalizePhone = (raw: string): string | null | undefined => {
  const digits = toLatinDigits(raw).replace(/\D/g, '');
  if (!digits) return null;
  let local = digits;
  if (local.startsWith('20') && local.length === 13) local = local.slice(2);
  else if (local.startsWith('2') && local.length === 12) local = local.slice(1);
  // Excel often strips the leading 0 from Egyptian mobiles (01xxxxxxxxx →
  // 1xxxxxxxxx). If we got 10 digits starting with 1, restore the 0.
  if (local.length === PHONE_LOCAL_LENGTH - 1 && local.startsWith('1')) local = `0${local}`;
  if (local.length !== PHONE_LOCAL_LENGTH) return undefined;
  return `${PHONE_PREFIX}${local}`;
};

export type DateOrder = 'dmy' | 'mdy' | 'auto';

export const MONTH_NAMES: Record<string, number> = {
  // English
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  // Arabic (standard)
  'يناير': 1, 'فبراير': 2, 'مارس': 3, 'أبريل': 4, 'ابريل': 4, 'مايو': 5, 'يونيو': 6, 'يونيه': 6,
  'يوليو': 7, 'يوليه': 7, 'أغسطس': 8, 'اغسطس': 8, 'سبتمبر': 9, 'أكتوبر': 10, 'اكتوبر': 10,
  'نوفمبر': 11, 'ديسمبر': 12,
  // Arabic (levant)
  'كانون الثاني': 1, 'شباط': 2, 'آذار': 3, 'اذار': 3, 'نيسان': 4, 'أيار': 5, 'ايار': 5,
  'حزيران': 6, 'تموز': 7, 'آب': 8, 'اب': 8, 'أيلول': 9, 'ايلول': 9,
  'تشرين الأول': 10, 'تشرين الاول': 10, 'تشرين الثاني': 11, 'كانون الأول': 12, 'كانون الاول': 12,
};

/** Arabic-indic digits → latin */
export const toLatinDigits = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
   .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

/** Parse a month cell: number, or Arabic/English month name */
export const parseMonth = (v: string): number | null => {
  const s = toLatinDigits(String(v ?? '').trim().toLowerCase());
  if (!s) return null;
  const n = Number(s);
  if (Number.isInteger(n) && n >= 1 && n <= 12) return n;
  if (MONTH_NAMES[s] != null) return MONTH_NAMES[s];
  // partial match (e.g. "شهر يناير")
  for (const [name, num] of Object.entries(MONTH_NAMES)) {
    if (s.includes(name)) return num;
  }
  return null;
};

export const validDate = (y: number, m: number, d: number): string | null => {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  if (d > new Date(y, m, 0).getDate()) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/** Parse a full-date cell with an explicit day/month order preference */
export const parseFullDate = (raw: string, order: DateOrder): string | null => {
  const s = toLatinDigits(String(raw ?? '').trim());
  if (!s) return null;

  // Excel serial number
  const asNum = Number(s);
  if (Number.isFinite(asNum) && asNum > 20000 && asNum < 60000 && /^\d+(\.\d+)?$/.test(s)) {
    const d = new Date(Math.round((asNum - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }

  // ISO yyyy-mm-dd (unambiguous)
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return validDate(+m[1], +m[2], +m[3]);

  // a/b/yyyy — order decided by the user
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const a = +m[1], b = +m[2];
    let y = +m[3];
    if (y < 100) y += y > 30 ? 1900 : 2000;
    if (order === 'mdy') return validDate(y, a, b);
    if (order === 'dmy') return validDate(y, b, a);
    // auto: self-resolve when one side can't be a month
    if (a > 12) return validDate(y, b, a);      // a is the day → dmy
    if (b > 12) return validDate(y, a, b);      // b is the day → mdy
    return validDate(y, b, a);                  // ambiguous → assume dd/mm
  }

  // "12 يناير 2015" style
  m = s.match(/^(\d{1,2})\s+(\S+)\s+(\d{4})/);
  if (m) {
    const mo = parseMonth(m[2]);
    if (mo) return validDate(+m[3], mo, +m[1]);
  }
  return null;
};

/** Compose a date from split day / month / year cells */
export const parseSplitDate = (dRaw: string, mRaw: string, yRaw: string): string | null => {
  const d = Number(toLatinDigits(dRaw)), mo = parseMonth(mRaw);
  let y = Number(toLatinDigits(yRaw));
  if (y > 0 && y < 100) y += y > 30 ? 1900 : 2000;
  if (d && mo && y) return validDate(y, mo, d);
  return null;
};

export const parseGender = (v: unknown): Gender | null => {
  const s = String(v ?? '').trim().toLowerCase();
  if (/^(ولد|ذكر|رجل|boy|male|man|m|بنين)$/.test(s)) return 'male';
  if (/^(بنت|أنثى|انثى|سيدة|girl|female|woman|f|بنات)$/.test(s)) return 'female';
  return null;
};

/** Split a pasted text block (Tab / comma / semicolon separated) into a matrix */
export const parsePastedTable = (text: string): string[][] => {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return lines.map((l) => (l.includes('\t') ? l.split('\t') : l.split(/[,;]/)));
};

/** Read the first sheet of an Excel / CSV file into a string matrix */
export const readSpreadsheet = async (file: File): Promise<string[][]> => {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' })
    .map((r) => (r as unknown[]).map((c) => String(c ?? '')));
};

/** Random readable password (no ambiguous chars) — default 8 */
export const generatePassword = (length = 8): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
};
