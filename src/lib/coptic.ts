// ---------- Coptic calendar (التقويم القبطي) ----------
// Pure arithmetic Gregorian → Coptic (Anno Martyrum) conversion used by the
// welcome widget. Julian Day Number of the Gregorian date, then the fixed
// Coptic epoch (1 Tout 1 AM = JDN 1825030). Verified: 11 Sep 2024 = 1 Tout
// 1741 · 7 Jan 2025 = 29 Kiahk 1741 · 12 Sep 2023 = 1 Tout 1740.

export const COPTIC_MONTHS: string[] = [
  'توت', 'بابه', 'هاتور', 'كيهك', 'طوبه', 'أمشير', 'برمهات', 'برموده', 'بشنس', 'بؤونه', 'أبيب', 'مسرى', 'نسيء',
];

export interface CopticDate { year: number; month: number; day: number }

const COPTIC_EPOCH_JDN = 1825030;

function gregorianJDN(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

export function toCoptic(y: number, m: number, d: number): CopticDate {
  const jd = gregorianJDN(y, m, d);
  const c = jd - COPTIC_EPOCH_JDN;
  const year = Math.floor((4 * c + 1463) / 1461);
  const yearStart = COPTIC_EPOCH_JDN + 365 * (year - 1) + Math.floor(year / 4);
  const month = Math.floor((jd - yearStart) / 30) + 1;
  const day = jd - yearStart - 30 * (month - 1) + 1;
  return { year, month, day };
}

/** Coptic date of a 'YYYY-MM-DD' calendar day. */
export function copticOf(ymd: string): CopticDate {
  const [y, m, d] = ymd.split('-').map(Number);
  return toCoptic(y, m, d);
}

/** «١٢ هاتور ١٧٤٣ ش» */
export function formatCoptic(c: CopticDate): string {
  const num = (n: number) => new Intl.NumberFormat('ar-EG', { useGrouping: false }).format(n);
  return `${num(c.day)} ${COPTIC_MONTHS[c.month - 1]} ${num(c.year)} ش`;
}
