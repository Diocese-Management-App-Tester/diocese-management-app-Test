// ---------- NAVIGATION REGISTRY (تخصيص التطبيق → شريط المهام والهيدر) ----------
// Declares every DESTINATION the app can navigate to (the 5 core pages, every
// module and the owner module), every HEADER WIDGET, and the pickable ICON
// LIBRARY. The owner arranges these from وحدة المالك → تخصيص التطبيق; the
// chosen layout is stored in `app_settings.key = 'navigation'` (migration
// 0035) and resolved for each signed-in user by `customization-context.tsx`.
//
// Rules of the layout:
//   • the TASKBAR (bottom bar) has exactly 5 slots — each slot is a destination
//   • the SIDE MENU shows the same 5 first, then EVERY other destination the
//     user may see (core pages moved out of the bar, the owner module, modules)
//   • the HEADER shows the chosen widgets in order (date · messages ·
//     notifications · quick-links); the menu button is fixed at the end.

import {
  Home, Users, ScanLine, BarChart3, Settings, IdCard, HeartHandshake, ShoppingBag, GraduationCap,
  Cake, MessageCircle, Video, Trophy, Tent, Bell, Crown, CalendarDays, Calendar, Clock, Star, Heart,
  Bookmark, Book, BookOpen, Church, School, Layers, Gift, Sparkles, Flag, MapPin, Camera, Image as ImageIcon,
  QrCode, Search, Plus, Send, Mail, Phone, PhoneCall, UserPlus, UserCheck, Award, Medal, Target, Zap,
  Flame, Sun, Moon, Cloud, Music, Mic, Headphones, Tv, Monitor, Smartphone, Wallet, Coins, CreditCard,
  Package, Box, Archive, Folder, FileText, ClipboardList, ListChecks, CheckCircle2, Megaphone, Globe,
  Compass, Map, Bus, Car, Plane, Ship, Bike, Footprints, Baby, Smile, PartyPopper, Cross, Shield,
  ShieldCheck, Lock, Key, LayoutGrid, LayoutDashboard, Grid3x3, Inbox, Pencil, Palette, Printer,
  Download, Upload, Share2, Link as LinkIcon, Bolt, Activity, TrendingUp, PieChart, LineChart, Table,
  Database, Boxes, Store, Ticket, Hand, HandHeart, Handshake, Lightbulb, Rocket, Puzzle, Gamepad2,
  Dices, Brush, Wrench, Cog, SlidersHorizontal, Eye, ThumbsUp, BellRing, MessageSquare, MessagesSquare,
  Contact, UsersRound, UserRound, CircleUser, BadgeCheck, Notebook, NotebookPen, Newspaper, Radio, Film,
  Presentation, Building, Building2, Landmark, Trees, Leaf, Flower2, Bird, Fish, Apple, Pizza, Coffee,
  Utensils, Timer, Hourglass, AlarmClock, CalendarCheck, CalendarHeart, CalendarClock, History, Repeat,
  Navigation, Route, Backpack, Wand2, Stars, Sunrise, Rainbow, Droplets, Snowflake, Umbrella, Tag, Tags,
  Percent, HandCoins, PiggyBank, Receipt, ScrollText, BookMarked, Library, Pen, Highlighter, Languages,
  Volume2, Play, Mountain, Waves, Sailboat, Anchor,
  type LucideIcon,
} from 'lucide-react';
import { MODULES, OWNER_MODULE, type AppModule } from '@/lib/modules';

// ---------- destinations ----------
export type CorePageKey = 'home' | 'children' | 'scanner' | 'stats' | 'settings';

export interface NavDestination {
  key: string;           // 'home' | 'children' | … | module key | 'owner'
  label: string;
  href: string;
  icon: LucideIcon;
  /** default icon name (library key) so the editor can show "الافتراضي" */
  iconName: string;
  kind: 'core' | 'module' | 'owner';
  color?: string;
}

export const CORE_PAGES: NavDestination[] = [
  { key: 'home',     label: 'الرئيسية',   href: '/',         icon: Home,      iconName: 'Home',      kind: 'core' },
  { key: 'children', label: 'المخدومين',  href: '/children', icon: Users,     iconName: 'Users',     kind: 'core' },
  { key: 'scanner',  label: 'الماسح',     href: '/scanner',  icon: ScanLine,  iconName: 'ScanLine',  kind: 'core' },
  { key: 'stats',    label: 'الإحصائيات', href: '/stats',    icon: BarChart3, iconName: 'BarChart3', kind: 'core' },
  { key: 'settings', label: 'الإعدادات',  href: '/settings', icon: Settings,  iconName: 'Settings',  kind: 'core' },
];

export const CORE_KEYS: CorePageKey[] = ['home', 'children', 'scanner', 'stats', 'settings'];

const MODULE_ICON_NAMES: Record<string, string> = {
  cards: 'IdCard', shepherds: 'HeartHandshake', store: 'ShoppingBag', exams: 'GraduationCap',
  birthdays: 'Cake', messages: 'MessageCircle', online: 'Video', achievements: 'Trophy',
  occasions: 'Tent', notifications: 'Bell',
};

const moduleDest = (m: AppModule): NavDestination => ({
  key: m.key, label: m.label, href: m.href, icon: m.icon,
  iconName: MODULE_ICON_NAMES[m.key] ?? 'Layers', kind: 'module', color: m.color,
});

export const OWNER_DEST: NavDestination = {
  key: OWNER_MODULE.key, label: OWNER_MODULE.label, href: OWNER_MODULE.href,
  icon: OWNER_MODULE.icon, iconName: 'Crown', kind: 'owner', color: OWNER_MODULE.color,
};

/** every destination in canonical order: core → owner → modules */
export const ALL_DESTINATIONS: NavDestination[] = [
  ...CORE_PAGES,
  OWNER_DEST,
  ...MODULES.map(moduleDest),
];

export const DEST_BY_KEY: Record<string, NavDestination> = Object.fromEntries(
  ALL_DESTINATIONS.map((d) => [d.key, d])
);

// ---------- icon library (pickable by the owner) ----------
export const ICON_LIBRARY: Record<string, LucideIcon> = {
  Home, Users, ScanLine, BarChart3, Settings, IdCard, HeartHandshake, ShoppingBag, GraduationCap,
  Cake, MessageCircle, Video, Trophy, Tent, Bell, Crown, CalendarDays, Calendar, Clock, Star, Heart,
  Bookmark, Book, BookOpen, Church, School, Layers, Gift, Sparkles, Flag, MapPin, Camera, Image: ImageIcon,
  QrCode, Search, Plus, Send, Mail, Phone, PhoneCall, UserPlus, UserCheck, Award, Medal, Target, Zap,
  Flame, Sun, Moon, Cloud, Music, Mic, Headphones, Tv, Monitor, Smartphone, Wallet, Coins, CreditCard,
  Package, Box, Archive, Folder, FileText, ClipboardList, ListChecks, CheckCircle2, Megaphone, Globe,
  Compass, Map, Bus, Car, Plane, Ship, Bike, Footprints, Baby, Smile, PartyPopper, Cross, Shield,
  ShieldCheck, Lock, Key, LayoutGrid, LayoutDashboard, Grid3x3, Inbox, Pencil, Palette, Printer,
  Download, Upload, Share2, Link: LinkIcon, Bolt, Activity, TrendingUp, PieChart, LineChart, Table,
  Database, Boxes, Store, Ticket, Hand, HandHeart, Handshake, Lightbulb, Rocket, Puzzle, Gamepad2,
  Dices, Brush, Wrench, Cog, SlidersHorizontal, Eye, ThumbsUp, BellRing, MessageSquare, MessagesSquare,
  Contact, UsersRound, UserRound, CircleUser, BadgeCheck, Notebook, NotebookPen, Newspaper, Radio, Film,
  Presentation, Building, Building2, Landmark, Trees, Leaf, Flower2, Bird, Fish, Apple, Pizza, Coffee,
  Utensils, Timer, Hourglass, AlarmClock, CalendarCheck, CalendarHeart, CalendarClock, History, Repeat,
  Navigation, Route, Backpack, Wand2, Stars, Sunrise, Rainbow, Droplets, Snowflake, Umbrella, Tag, Tags,
  Percent, HandCoins, PiggyBank, Receipt, ScrollText, BookMarked, Library, Pen, Highlighter, Languages,
  Volume2, Play, Mountain, Waves, Sailboat, Anchor,
};

export const ICON_NAMES = Object.keys(ICON_LIBRARY);

export function resolveIcon(name: string | undefined | null, fallback: LucideIcon): LucideIcon {
  if (!name) return fallback;
  return ICON_LIBRARY[name] ?? fallback;
}

// ---------- header widgets ----------
export type HeaderWidgetKey = 'date' | 'messages' | 'notifications';

export interface HeaderWidgetDef {
  key: HeaderWidgetKey;
  label: string;
  desc: string;
  icon: LucideIcon;
  iconName: string;
  /** module that must be granted for the widget to show (undefined = always) */
  module?: string;
}

export const HEADER_WIDGETS: HeaderWidgetDef[] = [
  { key: 'date', label: 'تاريخ العمل', desc: 'زر التاريخ — يفتح نافذة تغيير تاريخ ووقت العمل', icon: CalendarDays, iconName: 'CalendarDays' },
  { key: 'messages', label: 'الرسائل', desc: 'جرس الرسائل غير المقروءة (يظهر فقط لمن لديه وحدة الرسائل)', icon: MessageCircle, iconName: 'MessageCircle', module: 'messages' },
  { key: 'notifications', label: 'الإشعارات', desc: 'جرس الإشعارات غير المقروءة (يظهر فقط لمن لديه وحدة الإشعارات)', icon: Bell, iconName: 'Bell', module: 'notifications' },
];

export const HEADER_WIDGET_BY_KEY: Record<string, HeaderWidgetDef> = Object.fromEntries(
  HEADER_WIDGETS.map((w) => [w.key, w])
);

// ---------- stored layout ----------
export interface TaskbarSlot {
  key: string;        // destination key
  icon?: string;      // icon library name (override)
  label?: string;     // label override
}

export interface HeaderItem {
  /** 'date' | 'messages' | 'notifications' | 'link:<destination key>' */
  key: string;
  icon?: string;
}

export interface NavigationConfig {
  version: 1;
  taskbar: TaskbarSlot[];   // exactly 5
  header: HeaderItem[];
}

export const NAVIGATION_SETTING_KEY = 'navigation';
export const TASKBAR_SIZE = 5;

export const DEFAULT_NAVIGATION: NavigationConfig = {
  version: 1,
  taskbar: CORE_KEYS.map((k) => ({ key: k })),
  header: [{ key: 'date' }, { key: 'messages' }, { key: 'notifications' }],
};

export const isLinkItem = (key: string) => key.startsWith('link:');
export const linkTarget = (key: string) => key.slice(5);

// ---------- custom display names (أسماء الوجهات, migration 0036) ----------
// `app_settings.key = 'names'` → { <destination key>: <label> }. ONE source of
// truth for what every page / module is CALLED everywhere in the app: the
// taskbar, the side menu, the settings hub, the module headers and the page
// titles. Editing the label of a taskbar slot writes here too, so renaming a
// module in the bar renames it on its page and in every menu.
export type NamesConfig = Record<string, string>;
export const NAMES_SETTING_KEY = 'names';
export const MAX_NAME_LENGTH = 30;

export function normalizeNames(raw: unknown): NamesConfig {
  const obj = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out: NamesConfig = {};
  for (const [k, v] of Object.entries(obj)) {
    const d = DEST_BY_KEY[k];
    if (!d || typeof v !== 'string') continue;
    const s = v.trim().slice(0, MAX_NAME_LENGTH);
    if (s && s !== d.label) out[k] = s;
  }
  return out;
}

/** Display name of a destination for the current names config. */
export function destLabel(key: string, names: NamesConfig): string {
  return names[key] ?? DEST_BY_KEY[key]?.label ?? key;
}

/** Sanitize a stored JSON value: unknown keys dropped, taskbar padded to 5 unique slots. */
export function normalizeNavigation(raw: unknown): NavigationConfig {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Partial<NavigationConfig>;

  const seen = new Set<string>();
  const taskbar: TaskbarSlot[] = [];
  for (const s of Array.isArray(obj.taskbar) ? obj.taskbar : []) {
    if (!s || typeof s !== 'object') continue;
    const key = String((s as TaskbarSlot).key ?? '');
    if (!DEST_BY_KEY[key] || seen.has(key)) continue;
    seen.add(key);
    const slot: TaskbarSlot = { key };
    const icon = (s as TaskbarSlot).icon;
    if (icon && ICON_LIBRARY[icon]) slot.icon = icon;
    const label = (s as TaskbarSlot).label;
    if (typeof label === 'string' && label.trim()) slot.label = label.trim().slice(0, MAX_NAME_LENGTH);
    taskbar.push(slot);
    if (taskbar.length === TASKBAR_SIZE) break;
  }
  // pad with default core pages not yet used
  for (const k of CORE_KEYS) {
    if (taskbar.length >= TASKBAR_SIZE) break;
    if (!seen.has(k)) { seen.add(k); taskbar.push({ key: k }); }
  }

  const hseen = new Set<string>();
  const header: HeaderItem[] = [];
  for (const h of Array.isArray(obj.header) ? obj.header : []) {
    if (!h || typeof h !== 'object') continue;
    const key = String((h as HeaderItem).key ?? '');
    const valid = HEADER_WIDGET_BY_KEY[key] || (isLinkItem(key) && DEST_BY_KEY[linkTarget(key)]);
    if (!valid || hseen.has(key)) continue;
    hseen.add(key);
    const item: HeaderItem = { key };
    const icon = (h as HeaderItem).icon;
    if (icon && ICON_LIBRARY[icon]) item.icon = icon;
    header.push(item);
    if (header.length >= 6) break;
  }

  return { version: 1, taskbar, header };
}

// ---------- resolution for a given user ----------
export interface ResolvedNavItem {
  key: string;
  href: string;
  label: string;
  icon: LucideIcon;
  kind: NavDestination['kind'];
  color?: string;
}

/**
 * Resolve the 5 taskbar slots for a user who may see `allowed` destination
 * keys. A slot whose destination is hidden from the user is replaced (in
 * place) by the first default core page not already in the bar, so the bar
 * is always full and the visible slots keep their positions.
 */
export function resolveTaskbar(config: NavigationConfig, allowed: Set<string>, names: NamesConfig = {}): ResolvedNavItem[] {
  const used = new Set<string>();
  // pass 1 — keep valid slots in their positions
  const slots: (ResolvedNavItem | null)[] = config.taskbar.slice(0, TASKBAR_SIZE).map((slot) => {
    const d = DEST_BY_KEY[slot.key];
    if (!d || !allowed.has(d.key) || used.has(d.key)) return null;
    used.add(d.key);
    return {
      key: d.key, href: d.href, kind: d.kind, color: d.color,
      // slot label (legacy per-slot override) → global custom name → default
      label: slot.label ?? destLabel(d.key, names),
      icon: resolveIcon(slot.icon, d.icon),
    };
  });
  while (slots.length < TASKBAR_SIZE) slots.push(null);
  // pass 2 — fill holes with default core pages (in order) not already in the bar
  const spare = CORE_PAGES.filter((c) => !used.has(c.key));
  return slots.map((s) => {
    if (s) return s;
    const c = spare.shift();
    if (!c) return null;
    return { key: c.key, href: c.href, kind: c.kind, label: destLabel(c.key, names), icon: c.icon };
  }).filter((s): s is ResolvedNavItem => s !== null);
}

/** Everything the user may see that is NOT in the taskbar — side-menu section 2. */
export function resolveMenuRest(taskbar: ResolvedNavItem[], allowed: Set<string>, names: NamesConfig = {}): ResolvedNavItem[] {
  const inBar = new Set(taskbar.map((t) => t.key));
  return ALL_DESTINATIONS
    .filter((d) => allowed.has(d.key) && !inBar.has(d.key))
    .map((d) => ({ key: d.key, href: d.href, kind: d.kind, color: d.color, label: destLabel(d.key, names), icon: d.icon }));
}

export interface ResolvedHeaderItem {
  key: string;
  widget?: HeaderWidgetKey;      // built-in widget
  link?: ResolvedNavItem;        // quick link
  icon?: string;                 // icon override (library name)
}

export function resolveHeader(config: NavigationConfig, allowed: Set<string>, names: NamesConfig = {}): ResolvedHeaderItem[] {
  const out: ResolvedHeaderItem[] = [];
  for (const h of config.header) {
    if (isLinkItem(h.key)) {
      const d = DEST_BY_KEY[linkTarget(h.key)];
      if (!d || !allowed.has(d.key)) continue;
      out.push({ key: h.key, icon: h.icon, link: { key: d.key, href: d.href, kind: d.kind, color: d.color, label: destLabel(d.key, names), icon: resolveIcon(h.icon, d.icon) } });
    } else {
      const w = HEADER_WIDGET_BY_KEY[h.key];
      if (!w) continue;
      if (w.module && !allowed.has(w.module)) continue;
      out.push({ key: h.key, widget: w.key, icon: h.icon });
    }
  }
  return out;
}
