// ---------- Card Designer types (JSONB schema of card_templates) ----------
// All positions & sizes are in MILLIMETERS (converted to px on screen).

// ----- element kinds -----
// Variables — filled per person at print time.
export type CardVariableField =
  | 'name'
  | 'age'
  | 'birthdate'
  | 'phone'
  | 'national_id'
  | 'address'
  // ----- birthday-card variables (module أعياد الميلاد) -----
  | 'first_name'      // الاسم الأول
  | 'turns_age'       // السن التي يتمها في عيد الميلاد (سنة الكارت)
  | 'birthday_day'    // يوم الميلاد (رقم)
  | 'birthday_month'  // شهر الميلاد (اسم عربي)
  | 'birthday_date'   // يوم + شهر (مثلاً «5 مارس»)
  | 'birthday_year'   // سنة العيد
  | 'gift_points';    // نقاط الهدية

// Constants — fixed values bound to the template scope.
export type CardConstantField = 'church_name' | 'service_name' | 'class_name';

export type CardElementType =
  | 'variable' // person text field
  | 'photo' // person photo
  | 'qr' // QR code of national_id
  | 'constant' // church / service / class name
  | 'text' // free constant text
  | 'logo' // church logo
  | 'service_logo' // service picture / logo (services.photo_url)
  | 'class_logo' // class picture / logo (classes.photo_url)
  | 'image'; // uploaded constant image

// element types that render an image bound to the person's scope
export const SCOPE_LOGO_TYPES: readonly CardElementType[] = ['logo', 'service_logo', 'class_logo'];
export const isImageElement = (t: CardElementType): boolean =>
  t === 'photo' || t === 'image' || SCOPE_LOGO_TYPES.includes(t);

export type ImageFit = 'cover' | 'contain' | 'stretch' | 'tile';
export type TextAlign = 'right' | 'center' | 'left';

export interface CardTextStyle {
  fontFamily: string;
  fontSize: number; // pt
  color: string;
  bold: boolean;
  italic: boolean;
  align: TextAlign;
}

export interface CardElement {
  id: string;
  type: CardElementType;
  field?: CardVariableField | CardConstantField; // for variable / constant
  text?: string; // for free text
  label?: string; // optional prefix shown before variable (e.g. "الاسم:")
  imageUrl?: string; // for image type
  x: number; // mm from left
  y: number; // mm from top
  w: number; // mm
  h: number; // mm
  rotation: number; // degrees
  style: CardTextStyle; // text elements
  imageFit: ImageFit; // photo / logo / image
  borderRadius: number; // mm — round corners of the element box (all types)
  opacity: number; // 0..1 — whole element
  // per-element box background
  bgEnabled: boolean;
  bgColor: string;
  bgOpacity: number; // 0..1 — background only
  // per-element stroke (border) around the box, follows borderRadius
  strokeEnabled: boolean;
  strokeColor: string;
  strokeWidth: number; // mm
  // keep width/height ratio while resizing
  lockAspect: boolean;
}

// ----- background -----
// Free transform: 'custom' fit uses zoom + offset (pan/crop) chosen visually.
export interface CardBackground {
  color: string;
  imageUrl: string | null;
  imageFit: ImageFit | 'custom';
  imageOpacity: number; // 0..1
  // custom transform (used when imageFit = 'custom'):
  zoom: number; // 1 = image covers the card exactly; 2 = 200% ...
  offsetX: number; // % of card width: 0 = centered, +right / -left
  offsetY: number; // % of card height: 0 = centered, +down / -up
}

// ----- whole design -----
export interface CardDesign {
  version: 1;
  width: number; // mm
  height: number; // mm
  cornerRadius: number; // mm
  background: CardBackground;
  border: { enabled: boolean; color: string; width: number }; // width mm
  elements: CardElement[];
}

// ----- print settings -----
export type PaperSize = 'A4' | 'A3' | 'A5' | 'Letter' | 'custom';
export type PaperOrientation = 'portrait' | 'landscape';

// How the grid of cards sits inside the printable area (inside margins)
export type HAlign = 'right' | 'center' | 'left';
export type VAlign = 'top' | 'center' | 'bottom';

export const H_ALIGN_LABELS: Record<HAlign, string> = {
  right: 'يمين',
  center: 'وسط',
  left: 'يسار',
};
export const V_ALIGN_LABELS: Record<VAlign, string> = {
  top: 'أعلى',
  center: 'وسط',
  bottom: 'أسفل',
};

export interface CardPrintSettings {
  version: 1;
  paper: PaperSize;
  // page center guide lines (previewed AND printed)
  centerLineV: boolean; // vertical center line of the page
  centerLineH: boolean; // horizontal center line of the page
  customWidth: number; // mm (paper = custom)
  customHeight: number; // mm
  orientation: PaperOrientation;
  marginTop: number; // mm
  marginBottom: number;
  marginRight: number;
  marginLeft: number;
  gapX: number; // horizontal space between cards (mm)
  gapY: number; // vertical space between cards (mm)
  cutMarks: boolean;
  alignH: HAlign; // grid horizontal alignment inside printable area
  alignV: VAlign; // grid vertical alignment inside printable area
}

// ----- print profile (ملف طباعة محفوظ) — migration 0049 -----
// A NAMED, reusable set of print settings (paper · margins · gaps · alignment
// · cut marks · center lines). Saved once, applied to any template / to the
// bound print page. Scoped church → service → class like the templates
// (church_id NULL = shared with everyone who can see the module).
export interface CardPrintProfile {
  id: string;
  church_id: string | null;
  service_id: string | null;
  class_id: string | null;
  name: string;
  settings: CardPrintSettings;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

// ----- DB row -----
export interface CardTemplate {
  id: string;
  church_id: string;
  service_id: string | null;
  class_id: string | null;
  name: string;
  design: CardDesign;
  print_settings: CardPrintSettings;
  created_at: string;
  created_by: string | null;
  edited_at: string;
  edited_by: string | null;
}

// ---------- labels ----------
export const VARIABLE_FIELDS: { value: CardVariableField; label: string }[] = [
  { value: 'name', label: 'الاسم' },
  { value: 'age', label: 'السن' },
  { value: 'birthdate', label: 'تاريخ الميلاد' },
  { value: 'phone', label: 'الهاتف' },
  { value: 'national_id', label: 'الرقم القومي' },
  { value: 'address', label: 'العنوان' },
];

// Extra variables offered by the BIRTHDAY card designer (in addition to the
// list above). Kept separate so the ID-card designer stays unchanged.
export const BIRTHDAY_VARIABLE_FIELDS: { value: CardVariableField; label: string }[] = [
  { value: 'first_name', label: 'الاسم الأول' },
  { value: 'turns_age', label: 'السن الجديدة (يتمّ … سنة)' },
  { value: 'birthday_date', label: 'يوم وشهر العيد' },
  { value: 'birthday_day', label: 'يوم العيد (رقم)' },
  { value: 'birthday_month', label: 'شهر العيد' },
  { value: 'birthday_year', label: 'سنة العيد' },
  { value: 'gift_points', label: 'نقاط الهدية' },
];

export const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

export const CONSTANT_FIELDS: { value: CardConstantField; label: string }[] = [
  { value: 'church_name', label: 'اسم الكنيسة' },
  { value: 'service_name', label: 'اسم الخدمة' },
  { value: 'class_name', label: 'اسم الفصل' },
];

export const ELEMENT_TYPE_LABELS: Record<CardElementType, string> = {
  variable: 'بيان متغير',
  photo: 'صورة المخدوم',
  qr: 'رمز QR',
  constant: 'بيان ثابت',
  text: 'نص ثابت',
  logo: 'شعار الكنيسة',
  service_logo: 'شعار الخدمة',
  class_logo: 'شعار الفصل',
  image: 'صورة / شعار مرفوع',
};

export const IMAGE_FIT_LABELS: Record<ImageFit, string> = {
  cover: 'قص (يملأ)',
  contain: 'احتواء (زووم للداخل)',
  stretch: 'تمديد',
  tile: 'تكرار',
};

export const FONT_FAMILIES: { value: string; label: string }[] = [
  { value: 'Cairo', label: 'Cairo — القاهرة' },
  { value: 'Amiri', label: 'Amiri — أميري' },
  { value: 'Tajawal', label: 'Tajawal — تجوّل' },
  { value: 'El Messiri', label: 'El Messiri — المسيري' },
  { value: 'Reem Kufi', label: 'Reem Kufi — ريم كوفي' },
  { value: 'Noto Naskh Arabic', label: 'Noto Naskh — نسخ' },
  { value: 'Lateef', label: 'Lateef — لطيف' },
  { value: 'Changa', label: 'Changa — تشانجا' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Times New Roman', label: 'Times New Roman' },
];

// Google-font families (need a <link> to load)
export const GOOGLE_FONTS = [
  'Cairo', 'Amiri', 'Tajawal', 'El Messiri', 'Reem Kufi', 'Noto Naskh Arabic', 'Lateef', 'Changa',
];

export const PAPER_SIZES: Record<Exclude<PaperSize, 'custom'>, { w: number; h: number; label: string }> = {
  A4: { w: 210, h: 297, label: 'A4 — ‏210×297 مم' },
  A3: { w: 297, h: 420, label: 'A3 — ‏297×420 مم' },
  A5: { w: 148, h: 210, label: 'A5 — ‏148×210 مم' },
  Letter: { w: 216, h: 279, label: 'Letter — ‏216×279 مم' },
};

// ---------- defaults ----------
export const DEFAULT_TEXT_STYLE: CardTextStyle = {
  fontFamily: 'Cairo',
  fontSize: 12,
  color: '#1e293b',
  bold: true,
  italic: false,
  align: 'center',
};

export const newElement = (type: CardElementType, partial?: Partial<CardElement>): CardElement => ({
  id: `el_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  type,
  x: 5,
  y: 5,
  w: type === 'qr' || isImageElement(type) ? 20 : 50,
  h: type === 'qr' || isImageElement(type) ? 20 : 10,
  rotation: 0,
  style: { ...DEFAULT_TEXT_STYLE },
  imageFit: 'cover',
  borderRadius: type === 'qr' ? 0 : 2,
  opacity: 1,
  bgEnabled: false,
  bgColor: '#ffffff',
  bgOpacity: 1,
  strokeEnabled: false,
  strokeColor: '#1e3a8a',
  strokeWidth: 0.3,
  lockAspect: type === 'qr',
  ...partial,
});

// Standard CR80 ID-card size (like a credit card)
export const DEFAULT_DESIGN: CardDesign = {
  version: 1,
  width: 85.6,
  height: 54,
  cornerRadius: 3,
  background: {
    color: '#ffffff', imageUrl: null, imageFit: 'cover', imageOpacity: 1,
    zoom: 1, offsetX: 0, offsetY: 0,
  },
  border: { enabled: true, color: '#1e3a8a', width: 0.5 },
  elements: [
    newElement('logo', { x: 3, y: 3, w: 12, h: 12, borderRadius: 6 }),
    newElement('constant', {
      field: 'church_name', x: 17, y: 3, w: 52, h: 7,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 10, color: '#1e3a8a' },
    }),
    newElement('constant', {
      field: 'service_name', x: 17, y: 10, w: 52, h: 5,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 7, bold: false, color: '#64748b' },
    }),
    newElement('photo', { x: 62, y: 17, w: 20, h: 24, borderRadius: 2 }),
    newElement('variable', {
      field: 'name', x: 4, y: 19, w: 55, h: 8,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 13, align: 'right' },
    }),
    newElement('variable', {
      field: 'phone', label: 'الهاتف:', x: 4, y: 28, w: 55, h: 6,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 8, bold: false, align: 'right' },
    }),
    newElement('constant', {
      field: 'class_name', label: 'الفصل:', x: 4, y: 34, w: 55, h: 6,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 8, bold: false, align: 'right' },
    }),
    newElement('qr', { x: 3, y: 41, w: 11, h: 11, borderRadius: 0 }),
  ],
};

// Birthday greeting card — A6 landscape (148×105 mm), festive default.
export const DEFAULT_BIRTHDAY_DESIGN: CardDesign = {
  version: 1,
  width: 148,
  height: 105,
  cornerRadius: 4,
  background: {
    color: '#fff1f7', imageUrl: null, imageFit: 'cover', imageOpacity: 1,
    zoom: 1, offsetX: 0, offsetY: 0,
  },
  border: { enabled: true, color: '#db2777', width: 0.8 },
  elements: [
    newElement('logo', { x: 4, y: 4, w: 16, h: 16, borderRadius: 8 }),
    newElement('constant', {
      field: 'church_name', x: 22, y: 5, w: 90, h: 7,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 10, color: '#9d174d', align: 'right' },
    }),
    newElement('constant', {
      field: 'class_name', label: 'أسرة', x: 22, y: 12, w: 90, h: 6,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 8, bold: false, color: '#be185d', align: 'right' },
    }),
    newElement('text', {
      text: '🎂 كل سنة وأنت طيب 🎉', x: 10, y: 24, w: 128, h: 14,
      style: { ...DEFAULT_TEXT_STYLE, fontFamily: 'El Messiri', fontSize: 24, color: '#db2777' },
    }),
    newElement('photo', { x: 108, y: 42, w: 32, h: 40, borderRadius: 16, strokeEnabled: true, strokeColor: '#f472b6', strokeWidth: 0.8 }),
    newElement('variable', {
      field: 'name', x: 8, y: 44, w: 96, h: 12,
      style: { ...DEFAULT_TEXT_STYLE, fontFamily: 'Cairo', fontSize: 18, color: '#1e293b', align: 'center' },
    }),
    newElement('variable', {
      field: 'turns_age', label: 'أتممت', x: 8, y: 58, w: 96, h: 9,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 12, bold: false, color: '#475569', align: 'center' },
    }),
    newElement('variable', {
      field: 'birthday_date', x: 8, y: 67, w: 96, h: 8,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 11, color: '#9d174d', align: 'center' },
    }),
    newElement('text', {
      text: 'ربنا يفرّح قلبك ويكمّل سنينك بالخير والبركة ✨', x: 8, y: 84, w: 132, h: 9,
      style: { ...DEFAULT_TEXT_STYLE, fontFamily: 'Amiri', fontSize: 12, bold: false, color: '#475569' },
    }),
    newElement('constant', {
      field: 'service_name', x: 8, y: 95, w: 132, h: 6,
      style: { ...DEFAULT_TEXT_STYLE, fontSize: 8, bold: false, color: '#94a3b8' },
    }),
  ],
};

export const DEFAULT_PRINT_SETTINGS: CardPrintSettings = {
  version: 1,
  paper: 'A4',
  centerLineV: false,
  centerLineH: false,
  customWidth: 210,
  customHeight: 297,
  orientation: 'portrait',
  marginTop: 10,
  marginBottom: 10,
  marginRight: 10,
  marginLeft: 10,
  gapX: 4,
  gapY: 4,
  cutMarks: false,
  alignH: 'center',
  alignV: 'top',
};

// merge stored JSON (may be partial / old) over defaults
export const normalizeDesign = (d: Partial<CardDesign> | null | undefined): CardDesign => ({
  ...DEFAULT_DESIGN,
  ...d,
  background: { ...DEFAULT_DESIGN.background, ...(d?.background ?? {}) },
  border: { ...DEFAULT_DESIGN.border, ...(d?.border ?? {}) },
  elements: (d?.elements ?? DEFAULT_DESIGN.elements).map((el) => ({
    ...newElement(el.type ?? 'text'),
    ...el,
    style: { ...DEFAULT_TEXT_STYLE, ...(el.style ?? {}) },
  })),
});

export const normalizePrint = (p: Partial<CardPrintSettings> | null | undefined): CardPrintSettings => ({
  ...DEFAULT_PRINT_SETTINGS,
  ...p,
});

// Do two print settings describe the same page layout? (used to show which
// saved profile is currently «active» and whether it has unsaved changes)
export const printSettingsEqual = (a: CardPrintSettings, b: CardPrintSettings): boolean => {
  const na = normalizePrint(a);
  const nb = normalizePrint(b);
  return (Object.keys(DEFAULT_PRINT_SETTINGS) as (keyof CardPrintSettings)[])
    .every((k) => na[k] === nb[k]);
};

// short human summary of a print profile: «A4 طولي · 2×5 · هوامش 10»
export const describePrintSettings = (s: CardPrintSettings, card?: { width: number; height: number }): string => {
  const paper = s.paper === 'custom' ? `${s.customWidth}×${s.customHeight} مم` : s.paper;
  const orient = s.orientation === 'landscape' ? 'عرضي' : 'طولي';
  const parts = [`${paper} ${orient}`];
  if (card) {
    const dims = paperDims(s);
    const usableW = dims.w - s.marginRight - s.marginLeft;
    const usableH = dims.h - s.marginTop - s.marginBottom;
    const cols = Math.max(0, Math.floor((usableW + s.gapX) / (card.width + s.gapX)));
    const rows = Math.max(0, Math.floor((usableH + s.gapY) / (card.height + s.gapY)));
    parts.push(`${cols}×${rows}`);
  }
  const m = [s.marginTop, s.marginBottom, s.marginRight, s.marginLeft];
  parts.push(m.every((v) => v === m[0]) ? `هوامش ${m[0]}` : `هوامش ${m.join('/')}`);
  if (s.gapX || s.gapY) parts.push(`فراغ ${s.gapX}×${s.gapY}`);
  if (s.cutMarks) parts.push('قص');
  if (s.centerLineV || s.centerLineH) parts.push('منتصف');
  return parts.join(' · ');
};

// paper size in mm honoring orientation
export const paperDims = (s: CardPrintSettings): { w: number; h: number } => {
  const base = s.paper === 'custom'
    ? { w: s.customWidth, h: s.customHeight }
    : { w: PAPER_SIZES[s.paper].w, h: PAPER_SIZES[s.paper].h };
  return s.orientation === 'landscape' ? { w: base.h, h: base.w } : base;
};

// age in years from birthdate string
export const ageFromBirthdate = (birthdate: string | null): string => {
  if (!birthdate) return '—';
  const b = new Date(birthdate);
  if (isNaN(b.getTime())) return '—';
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return String(age);
};
