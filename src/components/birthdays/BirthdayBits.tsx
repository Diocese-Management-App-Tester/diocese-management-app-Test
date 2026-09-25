'use client';

// ---------- Birthdays module — shared UI bits ----------
// BirthdayHeader : back arrow + title + the module tabs (الشهر · الكروت · الإعدادات)
// PersonAvatar   : child picture / placeholder
// WhatsAppIcon   : brand glyph (lucide has none)
// GreetingChips  : the small icons showing which greetings were done this year

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  ArrowRight, Cake, CalendarDays, IdCard, Settings, User, Phone, MessageSquare, Printer, Send, Gift, StickyNote,
} from 'lucide-react';
import type { BirthdayGreeting, GreetingKind } from '@/lib/birthdays';
import { GREETING_LABELS } from '@/lib/birthdays';
import { useNavLabel } from '@/lib/customization-context';
import InfoTip from '@/components/InfoTip';

const TABS = [
  { href: '/birthdays', label: 'الشهر', icon: CalendarDays, id: 'bd-tab-month', exact: true },
  { href: '/birthdays/cards', label: 'كروت التهنئة', icon: IdCard, id: 'bd-tab-cards', exact: false },
  { href: '/birthdays/settings', label: 'الإعدادات', icon: Settings, id: 'bd-tab-settings', exact: false },
];

export function BirthdayHeader({ title, badge, hideTabs = false, info }: { title?: string; badge?: React.ReactNode; hideTabs?: boolean; info?: React.ReactNode }) {
  const path = usePathname();
  const name = useNavLabel('birthdays');
  return (
    <>
      <section className="mb-3 flex items-center gap-2 print:hidden">
        <Link href="/settings" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
          <ArrowRight className="h-5 w-5" />
        </Link>
        <h2 className="flex min-w-0 items-center gap-2 text-lg font-extrabold">
          <Cake className="h-5 w-5 shrink-0 text-pink-600" />
          {name}
          {title && <span className="truncate text-sm font-bold text-slate-400">· {title}</span>}
          {badge}
          {info && <InfoTip title={title ? `${name} · ${title}` : name}>{info}</InfoTip>}
        </h2>
      </section>
      {!hideTabs && (
        <nav id="bd-tabs" className="mb-3 grid grid-cols-3 gap-2 print:hidden">
          {TABS.map((t) => {
            const active = t.exact ? path === t.href : path?.startsWith(t.href);
            const Icon = t.icon;
            return (
              <Link
                key={t.href} id={t.id} href={t.href} aria-current={active ? 'page' : undefined}
                className={`flex h-11 items-center justify-center gap-1.5 rounded-xl text-sm font-extrabold transition active:scale-95 ${
                  active ? 'bg-pink-600 text-white shadow ring-2 ring-pink-300' : 'border border-slate-200 bg-white text-slate-600'
                }`}
              >
                <Icon className="h-4 w-4" /> {t.label}
              </Link>
            );
          })}
        </nav>
      )}
    </>
  );
}

export function PersonAvatar({ url, name, size = 48, className = '' }: { url: string | null; name: string; size?: number; className?: string }) {
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-full bg-pink-50 text-pink-300 ring-2 ring-pink-100 ${className}`}
      style={{ width: size, height: size }}
    >
      {url ? (
        <Image src={url} alt={name} fill sizes={`${size}px`} className="object-cover" />
      ) : (
        <User className="absolute inset-0 m-auto" style={{ width: size * 0.5, height: size * 0.5 }} />
      )}
    </div>
  );
}

export function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

export const GREETING_ICON: Record<GreetingKind, React.ComponentType<{ className?: string }>> = {
  call: Phone,
  whatsapp: WhatsAppIcon,
  sms: MessageSquare,
  card_printed: Printer,
  card_shared: Send,
  gift: Gift,
  note: StickyNote,
};

export const GREETING_COLOR: Record<GreetingKind, string> = {
  call: 'bg-sky-100 text-sky-700',
  whatsapp: 'bg-emerald-100 text-emerald-700',
  sms: 'bg-indigo-100 text-indigo-700',
  card_printed: 'bg-violet-100 text-violet-700',
  card_shared: 'bg-fuchsia-100 text-fuchsia-700',
  gift: 'bg-amber-100 text-amber-700',
  note: 'bg-slate-100 text-slate-600',
};

/** compact chips: one per DISTINCT kind done this year (count if > 1) */
export function GreetingChips({ greetings, onClick }: { greetings: BirthdayGreeting[]; onClick?: () => void }) {
  if (greetings.length === 0) {
    return (
      <button type="button" onClick={onClick} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-400">
        لم يُهنَّأ بعد
      </button>
    );
  }
  const counts = new Map<GreetingKind, number>();
  greetings.forEach((g) => counts.set(g.kind, (counts.get(g.kind) ?? 0) + 1));
  return (
    <button type="button" onClick={onClick} className="flex flex-wrap items-center gap-1">
      {Array.from(counts.entries()).map(([kind, n]) => {
        const Icon = GREETING_ICON[kind];
        return (
          <span key={kind} title={GREETING_LABELS[kind]} className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-extrabold ${GREETING_COLOR[kind]}`}>
            <Icon className="h-3 w-3" />
            {kind === 'gift' ? `+${greetings.find((g) => g.kind === 'gift')?.points ?? ''}` : n > 1 ? n : null}
          </span>
        );
      })}
    </button>
  );
}

export function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div id="bd-toast" role="status" className="fixed inset-x-4 bottom-24 z-[70] mx-auto max-w-md rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm font-bold text-white shadow-xl">
      {msg}
    </div>
  );
}
