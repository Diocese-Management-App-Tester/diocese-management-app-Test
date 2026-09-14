// ---------- HOME WIDGETS REGISTRY (ودجات الرئيسية) ----------
// The home page (الرئيسية) is a GRID OF WIDGETS. Every widget is declared
// once here (key · label · description · icon · default size · the module
// it depends on, if any). The OWNER decides which widgets show, their order,
// size and heading from وحدة المالك → تخصيص التطبيق → ودجات الرئيسية; the
// layout is stored in `app_settings.key = 'widgets'` (migration 0036) and
// resolved per user by `customization-context.tsx`:
//   • a widget bound to a module hidden from the caller is skipped;
//   • a widget restricted to some roles is skipped for the others.
// The React component of each widget lives in `src/components/widgets/`.

import {
  Sparkles, Gauge, CalendarClock, Flame, Trophy, PhoneCall, Cake, Tent, Video, GraduationCap,
  MessageCircle, Bell, ShoppingBag, UserCheck, Zap, BookOpenText, Activity, Award, TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import type { AppRole } from '@/lib/types';

export type WidgetKey =
  | 'welcome' | 'today_pulse' | 'counters' | 'quick_actions' | 'next_event' | 'attendance_trend'
  | 'weekly_streak' | 'leaderboard' | 'follow_up' | 'pending_approvals' | 'birthdays' | 'occasions'
  | 'online_live' | 'exams_open' | 'messages_inbox' | 'notifications' | 'store_recent'
  | 'achievements_feed' | 'verse';

export type WidgetSize = 'full' | 'half';

export interface WidgetDef {
  key: WidgetKey;
  label: string;
  desc: string;
  icon: LucideIcon;
  color: string;
  size: WidgetSize;
  resizable: boolean;
  module?: string;
  roles?: AppRole[];
  /** default heading drawn on the card (undefined = the widget draws its own look) */
  heading?: string;
}

export const WIDGETS: WidgetDef[] = [
  { key: 'welcome', label: 'الترحيب', icon: Sparkles, color: 'text-gold-500', size: 'full', resizable: false,
    desc: 'بطاقة ترحيب باسم الخادم ودوره، تاريخ اليوم بالميلادي والقبطي، وآية اليوم' },
  { key: 'today_pulse', label: 'نبض اليوم', icon: Gauge, color: 'text-emerald-600', size: 'full', resizable: true, heading: 'نبض اليوم',
    desc: 'حلقة تُظهر نسبة حضور اليوم من مخدومي نطاقك، مع عدد الحاضرين ونقاط اليوم — تتحدث لحظياً مع كل مسح' },
  { key: 'counters', label: 'العدّادات', icon: Activity, color: 'text-primary-600', size: 'full', resizable: false,
    desc: 'بطاقات الأرقام: الأشخاص · التسجيلات · حضور اليوم · الفصول · الخدمات · الكنائس (حسب الدور)' },
  { key: 'quick_actions', label: 'إجراءات سريعة', icon: Zap, color: 'text-accent-600', size: 'full', resizable: false, heading: 'إجراءات سريعة',
    desc: 'أزرار كبيرة للوجهات الأكثر استخداماً: الماسح · إضافة مخدوم · المخدومين · الإحصائيات · وأول الوحدات المفعّلة' },
  { key: 'next_event', label: 'المناسبة الآن', icon: CalendarClock, color: 'text-violet-600', size: 'full', resizable: true, heading: 'المناسبة',
    desc: 'المناسبة الجارية الآن (مع الوقت المتبقي) أو القادمة (مع عدّاد تنازلي)، وعدد من حضرها حتى الآن، وزر مباشر للماسح' },
  { key: 'attendance_trend', label: 'اتجاه الحضور', icon: TrendingUp, color: 'text-sky-600', size: 'full', resizable: false, heading: 'اتجاه الحضور — ١٤ يوماً',
    desc: 'أعمدة صغيرة لحضور آخر ١٤ يوماً مع مقارنة هذا الأسبوع بالسابق (▲ ▼)' },
  { key: 'weekly_streak', label: 'أسبوع الخدمة', icon: Flame, color: 'text-orange-600', size: 'half', resizable: true, heading: 'أسبوع الخدمة',
    desc: 'الأيام السبعة الأخيرة — كل يوم سُجّل فيه حضور يضيء، مع عدد أيام النشاط المتتالية' },
  { key: 'leaderboard', label: 'لوحة الشرف', icon: Trophy, color: 'text-amber-600', size: 'half', resizable: true, heading: 'لوحة الشرف',
    desc: 'أعلى المخدومين في النقاط داخل نطاقك — بصورهم ومراكزهم 🥇🥈🥉' },
  { key: 'follow_up', label: 'الافتقاد', icon: PhoneCall, color: 'text-teal-600', size: 'full', resizable: true, heading: 'الافتقاد',
    desc: 'من غاب عن آخر مناسبة ولم يُفتقد بعد — أزرار اتصال مباشرة ورابط للمخدومين' },
  { key: 'pending_approvals', label: 'طلبات معلقة', icon: UserCheck, color: 'text-red-600', size: 'half', resizable: true, heading: 'طلبات معلقة',
    roles: ['owner', 'church_manager', 'service_manager'],
    desc: 'طلبات انضمام الخدام وطلبات تعديل بيانات المخدومين التي تنتظر موافقتك (للمسؤولين)' },
  { key: 'birthdays', label: 'أعياد الميلاد', icon: Cake, color: 'text-pink-600', size: 'full', resizable: false, module: 'birthdays',
    desc: 'من عيد ميلاده اليوم والأسبوع القادم مع اتصال وواتساب' },
  { key: 'occasions', label: 'الفعاليات القادمة', icon: Tent, color: 'text-cyan-600', size: 'full', resizable: true, module: 'occasions', heading: 'الفعاليات القادمة',
    desc: 'أقرب الفعاليات المنشورة مع الموعد والمكان وعدد المسجّلين' },
  { key: 'online_live', label: 'الفصول الأونلاين', icon: Video, color: 'text-red-600', size: 'full', resizable: true, module: 'online', heading: 'الفصول الأونلاين',
    desc: 'الفصل المباشر الآن (🔴) أو القادم — مع زر غرفة التحكم' },
  { key: 'exams_open', label: 'الامتحانات المفتوحة', icon: GraduationCap, color: 'text-violet-600', size: 'half', resizable: true, module: 'exams', heading: 'الامتحانات',
    desc: 'الامتحانات المتاحة حالياً وعدد من حلّوها' },
  { key: 'messages_inbox', label: 'الرسائل', icon: MessageCircle, color: 'text-sky-600', size: 'half', resizable: true, module: 'messages', heading: 'الرسائل',
    desc: 'المحادثات غير المقروءة وآخر رسالة' },
  { key: 'notifications', label: 'الإشعارات', icon: Bell, color: 'text-indigo-600', size: 'half', resizable: true, module: 'notifications', heading: 'الإشعارات',
    desc: 'آخر الإشعارات الواردة إليك' },
  { key: 'store_recent', label: 'إستبدال النقاط', icon: ShoppingBag, color: 'text-orange-600', size: 'half', resizable: true, module: 'store', heading: 'إستبدال النقاط',
    desc: 'فواتير اليوم: عددها ومجموع النقاط المستبدلة وآخر الفواتير' },
  { key: 'achievements_feed', label: 'آخر الإنجازات', icon: Award, color: 'text-amber-600', size: 'half', resizable: true, module: 'achievements', heading: 'آخر الإنجازات',
    desc: 'آخر الإنجازات الممنوحة للمخدومين في نطاقك' },
  { key: 'verse', label: 'آية اليوم', icon: BookOpenText, color: 'text-primary-600', size: 'full', resizable: true,
    desc: 'آية من الكتاب المقدس تتغير كل يوم (مستقلة عن بطاقة الترحيب)' },
];

export const WIDGET_BY_KEY: Record<string, WidgetDef> = Object.fromEntries(WIDGETS.map((w) => [w.key, w]));

// ---------- stored layout ----------
export interface WidgetItem {
  key: string;
  size?: WidgetSize;
  title?: string;
}

export interface WidgetsConfig {
  version: 1;
  items: WidgetItem[];
}

export const WIDGETS_SETTING_KEY = 'widgets';
export const MAX_WIDGETS = 40;
export const MAX_WIDGET_TITLE = 30;

/** The default home page — what every fresh install shows. */
export const DEFAULT_WIDGETS: WidgetsConfig = {
  version: 1,
  items: [
    { key: 'welcome' },
    { key: 'today_pulse' },
    { key: 'next_event' },
    { key: 'counters' },
    { key: 'pending_approvals' },
    { key: 'weekly_streak' },
    { key: 'birthdays' },
    { key: 'follow_up' },
    { key: 'attendance_trend' },
    { key: 'leaderboard' },
    { key: 'messages_inbox' },
    { key: 'online_live' },
    { key: 'occasions' },
    { key: 'quick_actions' },
  ],
};

export function normalizeWidgets(raw: unknown): WidgetsConfig {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Partial<WidgetsConfig>;
  const seen = new Set<string>();
  const items: WidgetItem[] = [];
  for (const it of Array.isArray(obj.items) ? obj.items : []) {
    if (!it || typeof it !== 'object') continue;
    const key = String((it as WidgetItem).key ?? '');
    const def = WIDGET_BY_KEY[key];
    if (!def || seen.has(key)) continue;
    seen.add(key);
    const item: WidgetItem = { key };
    const size = (it as WidgetItem).size;
    if (def.resizable && (size === 'full' || size === 'half') && size !== def.size) item.size = size;
    const title = (it as WidgetItem).title;
    if (typeof title === 'string' && title.trim()) item.title = title.trim().slice(0, MAX_WIDGET_TITLE);
    items.push(item);
    if (items.length >= MAX_WIDGETS) break;
  }
  return { version: 1, items };
}

// ---------- resolution for a given user ----------
export interface ResolvedWidget {
  key: WidgetKey;
  def: WidgetDef;
  size: WidgetSize;
  title: string | undefined;
}

export function resolveWidgets(config: WidgetsConfig, allowedModules: Set<string>, role: AppRole | undefined): ResolvedWidget[] {
  const out: ResolvedWidget[] = [];
  for (const it of config.items) {
    const def = WIDGET_BY_KEY[it.key];
    if (!def) continue;
    if (def.module && !allowedModules.has(def.module)) continue;
    if (def.roles && (!role || !def.roles.includes(role))) continue;
    out.push({ key: def.key, def, size: def.resizable ? (it.size ?? def.size) : def.size, title: it.title ?? def.heading });
  }
  return out;
}
