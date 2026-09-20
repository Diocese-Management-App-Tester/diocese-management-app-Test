// ---------- PERMISSIONS REGISTRY (الصلاحيات) — migration 0037 ----------
// A permission is an app-code KEY. The owner groups keys into *permission
// profiles* (`permission_profiles`, ملفات الصلاحيات) from the owner module,
// and a servant enrollment is connected to one or more profiles through the
// `permissions` table. `usePermissions()` resolves the keys of the signed-in
// servant (owner ⇒ everything) and `has(key)` answers instantly.
//
// To add a permission later: add one entry here. Nothing else to change —
// the owner module lists the registry, and pages/guards call `has(key)`.

import type { LucideIcon } from 'lucide-react';
import {
  Users, UserPlus, Pencil, Trash2, ScanLine, Star, Phone, MessageSquare, IdCard,
  Church, Layers, School, CalendarDays, Coins, PhoneCall, UserCheck, ShieldCheck,
  QrCode, BarChart3, FileSpreadsheet, ClipboardList, KeyRound, ClipboardCheck, ListOrdered, Percent, Lock, FileUp, FileDown, PieChart,
  Library, BookOpen, History, Eye, Cog, FileBarChart2, LayoutTemplate, Printer,
} from 'lucide-react';

export interface PermissionGroup {
  key: string;
  label: string;
  icon: LucideIcon;
  color: string;
}

export interface PermissionDef {
  key: string;
  group: string;      // PermissionGroup.key
  label: string;
  desc: string;
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  { key: 'children', label: 'المخدومين', icon: Users, color: 'text-primary-600' },
  { key: 'scanner', label: 'الماسح', icon: ScanLine, color: 'text-orange-600' },
  { key: 'stats', label: 'الإحصائيات', icon: BarChart3, color: 'text-violet-600' },
  { key: 'structure', label: 'البنية (كنائس · خدمات · فصول)', icon: Church, color: 'text-emerald-600' },
  { key: 'activity', label: 'المناسبات والأسباب ونتائج الافتقاد', icon: CalendarDays, color: 'text-cyan-600' },
  { key: 'servants', label: 'الخدام', icon: ShieldCheck, color: 'text-rose-600' },
  { key: 'results', label: 'نتائج الامتحانات', icon: ClipboardCheck, color: 'text-emerald-600' },
  { key: 'library', label: 'المكتبة', icon: Library, color: 'text-lime-700' },
  { key: 'activity', label: 'سجل النشاط', icon: History, color: 'text-slate-700' },
  { key: 'reports', label: 'تقارير وجداول', icon: FileBarChart2, color: 'text-fuchsia-600' },
];

export const PERMISSIONS: PermissionDef[] = [
  // ---- المخدومين ----
  { key: 'children.view', group: 'children', label: 'عرض المخدومين', desc: 'رؤية قائمة المخدومين وبياناتهم في نطاقه' },
  { key: 'children.add', group: 'children', label: 'إضافة مخدوم', desc: 'إضافة فردية وجماعية' },
  { key: 'children.edit', group: 'children', label: 'تعديل بيانات المخدوم', desc: 'الاسم · النوع · الهاتف · تاريخ الميلاد · العنوان · الصورة · الكود' },
  { key: 'children.delete', group: 'children', label: 'حذف مخدوم', desc: 'إزالة التسجيل أو الشخص' },
  { key: 'children.attendance', group: 'children', label: 'تسجيل الحضور', desc: 'تسجيل / إزالة حضور مناسبة' },
  { key: 'children.points', group: 'children', label: 'النقاط', desc: 'إضافة وخصم النقاط' },
  { key: 'children.call', group: 'children', label: 'الاتصال ونتيجة الافتقاد', desc: 'مكالمات المتابعة وتسجيل نتيجتها' },
  { key: 'children.message', group: 'children', label: 'الرسائل', desc: 'واتساب · SMS · رسالة داخلية' },
  { key: 'children.print_card', group: 'children', label: 'طلب طباعة كارت', desc: 'إرسال الكارت إلى قائمة الطباعة' },
  { key: 'children.export', group: 'children', label: 'تصدير Excel', desc: 'تصدير بيانات المخدومين' },

  // ---- الماسح ----
  { key: 'scanner.use', group: 'scanner', label: 'استخدام الماسح', desc: 'مسح QR وتشغيل المهام (حضور · نقاط · بيانات)' },

  // ---- الإحصائيات ----
  { key: 'stats.view', group: 'stats', label: 'عرض الإحصائيات', desc: 'لوحة الإحصائيات وتصدير Excel' },

  // ---- البنية ----
  { key: 'structure.churches', group: 'structure', label: 'إدارة الكنائس', desc: 'إضافة وتعديل وحذف الكنائس' },
  { key: 'structure.services', group: 'structure', label: 'إدارة الخدمات', desc: 'إضافة وتعديل وحذف الخدمات' },
  { key: 'structure.classes', group: 'structure', label: 'إدارة الفصول', desc: 'إضافة وتعديل وحذف الفصول' },

  // ---- المناسبات · الأسباب · نتائج الافتقاد ----
  { key: 'activity.events', group: 'activity', label: 'إدارة المناسبات', desc: 'المناسبات وجداولها ونقاطها' },
  { key: 'activity.causes', group: 'activity', label: 'إدارة أسباب النقاط', desc: 'أسباب إضافة / خصم النقاط' },
  { key: 'activity.feedbacks', group: 'activity', label: 'إدارة نتائج الافتقاد', desc: 'نتائج مكالمات المتابعة' },
  { key: 'activity.data_requests', group: 'activity', label: 'طلبات تعديل البيانات', desc: 'قبول / رفض طلبات المخدومين' },

  // ---- الخدام ----
  { key: 'servants.view', group: 'servants', label: 'عرض الخدام', desc: 'قائمة الخدام في نطاقه' },
  { key: 'servants.approve', group: 'servants', label: 'قبول طلبات الانضمام', desc: 'اعتماد أو رفض الخدام الجدد' },
  { key: 'servants.manage', group: 'servants', label: 'إدارة الخدام', desc: 'تعديل · إيقاف · حذف' },
  { key: 'servants.add', group: 'servants', label: 'إضافة خدام', desc: 'إضافة خدام معتمدين مباشرة — فردي أو جماعي (Excel)' },
  { key: 'servants.invite', group: 'servants', label: 'دعوة خادم', desc: 'رابط / QR دعوة بنطاق' },
  { key: 'servants.permissions', group: 'servants', label: 'منح الصلاحيات', desc: 'ربط الخدام بملفات الصلاحيات في نطاقه' },

  // ---- نتائج الامتحانات (0038) — managers hold them all; class servants
  // view & see statistics by default and need a profile for the rest ----
  { key: 'results.view', group: 'results', label: 'عرض النتائج', desc: 'رؤية الامتحانات والنتائج في نطاقه (افتراضي لكل خادم)' },
  { key: 'results.enter', group: 'results', label: 'إدخال النتائج', desc: 'إدخال درجات جديدة (فردي · جماعي) وتعديل مسوداته' },
  { key: 'results.edit', group: 'results', label: 'تعديل النتائج', desc: 'تعديل وحذف نتائج مُدخلة' },
  { key: 'results.import', group: 'results', label: 'استيراد من Excel', desc: 'استيراد النتائج من ملف Excel بعد المعاينة' },
  { key: 'results.export', group: 'results', label: 'تصدير النتائج', desc: 'تصدير النتائج والتقارير إلى Excel' },
  { key: 'results.manage_exams', group: 'results', label: 'إدارة الامتحانات', desc: 'إنشاء وتعديل وحذف الامتحانات ونشرها' },
  { key: 'results.manage_subjects', group: 'results', label: 'إدارة المواد', desc: 'مواد الامتحان ودرجاتها وترتيبها' },
  { key: 'results.manage_grading', group: 'results', label: 'إدارة أنظمة التقدير', desc: 'التقديرات ونسبها وألوانها' },
  { key: 'results.lock', group: 'results', label: 'قفل النتائج', desc: 'قفل / فتح نتائج الامتحان — والكتابة بعد القفل' },
  { key: 'results.stats', group: 'results', label: 'عرض الإحصائيات', desc: 'لوحة الامتحان والتقارير (افتراضي لكل خادم)' },

  // ---- المكتبة (0039) — managers hold them all; class servants browse by
  // default and need a profile to manage content ----
  { key: 'library.view', group: 'library', label: 'تصفح المكتبة', desc: 'رؤية المواضيع والكتب والمحاضرات المتاحة له (افتراضي لكل خادم)' },
  { key: 'library.manage', group: 'library', label: 'إدارة المكتبة', desc: 'إضافة وتعديل وحذف المواضيع والكتب والمحاضرات في نطاقه' },

  // ---- سجل النشاط (0047) — owner + church managers see everything in
  // their church by default; service managers see their service; class
  // servants need `activity.view` ----
  { key: 'activity.view', group: 'activity', label: 'عرض سجل النشاط', desc: 'رؤية العمليات في نطاقه (خادم الفصل يحتاجها؛ المديرون يملكونها)' },
  { key: 'activity.view_all', group: 'activity', label: 'عرض سجل الكنيسة كاملاً', desc: 'مسؤول الخدمة / خادم الفصل يرى كل عمليات كنيسته لا نطاقه فقط' },

  // ---- تقارير وجداول (0050) — every servant who sees the module can build
  // and export reports of HIS scope (RLS bounds the data); saving templates
  // for a whole service / church follows `can_access` ----
  { key: 'reports.build', group: 'reports', label: 'إنشاء وتصدير التقارير', desc: 'اختيار البيانات والحقول وتصميم التقرير وتصديره PDF / Excel / طباعة (افتراضي لكل خادم يرى الوحدة)' },
  { key: 'reports.templates', group: 'reports', label: 'إدارة القوالب', desc: 'حفظ وتعديل وحذف قوالب التقارير في نطاقه' },
];

export const PERMISSION_BY_KEY: Record<string, PermissionDef> = Object.fromEntries(
  PERMISSIONS.map((p) => [p.key, p])
);

export const permissionsOfGroup = (group: string) => PERMISSIONS.filter((p) => p.group === group);

// A few icons the owner module can use per permission key (fallback per group)
export const PERMISSION_ICONS: Record<string, LucideIcon> = {
  'children.view': Users,
  'children.add': UserPlus,
  'children.edit': Pencil,
  'children.delete': Trash2,
  'children.attendance': UserCheck,
  'children.points': Star,
  'children.call': Phone,
  'children.message': MessageSquare,
  'children.print_card': IdCard,
  'children.export': FileSpreadsheet,
  'scanner.use': QrCode,
  'stats.view': BarChart3,
  'structure.churches': Church,
  'structure.services': Layers,
  'structure.classes': School,
  'activity.events': CalendarDays,
  'activity.causes': Coins,
  'activity.feedbacks': PhoneCall,
  'activity.data_requests': ClipboardList,
  'servants.view': Users,
  'servants.approve': UserCheck,
  'servants.manage': ShieldCheck,
  'servants.add': UserPlus,
  'servants.invite': QrCode,
  'servants.permissions': KeyRound,
  'results.view': ClipboardCheck,
  'results.enter': Pencil,
  'results.edit': Pencil,
  'results.import': FileUp,
  'results.export': FileDown,
  'results.manage_exams': ClipboardList,
  'results.manage_subjects': ListOrdered,
  'results.manage_grading': Percent,
  'results.lock': Lock,
  'results.stats': PieChart,
  'library.view': BookOpen,
  'library.manage': Library,
  'activity.view': Eye,
  'activity.view_all': Cog,
  'reports.build': Printer,
  'reports.templates': LayoutTemplate,
};

/** Resolve the key set from the grant rows + the profiles (owner ⇒ '*'). */
export function resolvePermissionKeys(
  role: string | null | undefined,
  grants: { permission_profile_id: string }[],
  profiles: { id: string; permissions: string[] }[]
): Set<string> {
  const out = new Set<string>();
  if (role === 'owner') { out.add('*'); return out; }
  const byId = new Map(profiles.map((p) => [p.id, p]));
  for (const g of grants) {
    const p = byId.get(g.permission_profile_id);
    p?.permissions.forEach((k) => out.add(k));
  }
  return out;
}

export const hasKey = (keys: Set<string>, key: string) => keys.has('*') || keys.has(key);
