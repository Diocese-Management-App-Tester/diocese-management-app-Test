'use client';

// ---------- Notifications module — shared UI bits ----------
// NotifHeader      : back arrow + title + the 3 module tabs (السجل · إرسال · تلقائي)
// StatusBadge      : sent / scheduled / failed / cancelled pill
// NotifCard        : one inbox row (servant + child use the same look)
// PushToggle       : «تفعيل إشعارات الجهاز» card (permission + registration)
// Toast            : bottom toast

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { ArrowRight, Bell, BellOff, BellRing, History, Send, Zap, Smartphone, Loader2, ExternalLink, Check } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NOTIF_STATUS_CLASSES, NOTIF_STATUS_LABELS, fmtRelative, type InboxItem, type NotifStatus } from '@/lib/notifications';
import { PUSH_REASON_LABELS, currentSubscription, disablePush, enablePush, pushSupport, syncPushRegistration, type PushSupport } from '@/lib/push';
import { useNavLabel } from '@/lib/customization-context';

const TABS = [
  { href: '/notifications', label: 'السجل', icon: History, id: 'notif-tab-history', exact: true },
  { href: '/notifications/new', label: 'إرسال', icon: Send, id: 'notif-tab-new' },
  { href: '/notifications/automations', label: 'تلقائي', icon: Zap, id: 'notif-tab-automations' },
];

export function NotifHeader({ title, badge, back = '/settings' }: { title?: string; badge?: ReactNode; back?: string }) {
  const path = usePathname();
  const name = useNavLabel('notifications');
  return (
    <>
      <section className="mb-3 flex items-center gap-2">
        <Link href={back} aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
          <ArrowRight className="h-5 w-5" />
        </Link>
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <Bell className="h-5 w-5 text-indigo-600" />
          {name}
          {title && <span className="text-sm font-bold text-slate-400">· {title}</span>}
          {badge}
        </h2>
        <Link id="notif-inbox-link" href="/notifications/inbox" className="mr-auto flex items-center gap-1 rounded-xl bg-indigo-50 px-3 py-1.5 text-xs font-extrabold text-indigo-700 hover:bg-indigo-100">
          <BellRing className="h-4 w-4" /> الواردة
        </Link>
      </section>
      <nav id="notif-tabs" className="mb-3 grid grid-cols-3 gap-2">
        {TABS.map((t) => {
          const active = t.exact ? path === t.href : path?.startsWith(t.href);
          const Icon = t.icon;
          return (
            <Link
              key={t.href} id={t.id} href={t.href} aria-current={active ? 'page' : undefined}
              className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-extrabold transition active:scale-95 ${
                active ? 'bg-indigo-600 text-white shadow ring-2 ring-indigo-300' : 'border border-slate-200 bg-white text-slate-600'
              }`}
            >
              <Icon className="h-4 w-4" /> {t.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

export function StatusBadge({ status }: { status: NotifStatus }) {
  return <span className={`badge ${NOTIF_STATUS_CLASSES[status]}`}>{NOTIF_STATUS_LABELS[status]}</span>;
}

export function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div id="notif-toast" role="status" className="fixed inset-x-4 bottom-24 z-[70] mx-auto max-w-md rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm font-bold text-white shadow-xl">
      {msg}
    </div>
  );
}

/** Whether a link is an in-app path the recipient can open */
export const isInternalLink = (u: string | null) => !!u && u.startsWith('/');

/** One inbox row. `onOpen` marks it read and navigates (handled by the caller). */
export function NotifCard({ item, onOpen }: { item: InboxItem; onOpen: (item: InboxItem) => void }) {
  const unread = !item.read_at;
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className={`flex w-full items-start gap-3 rounded-2xl border p-3 text-right transition active:scale-[0.99] ${
        unread ? 'border-indigo-200 bg-indigo-50/70 shadow-sm' : 'border-slate-100 bg-white'
      }`}
    >
      <span className={`mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${unread ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
        {item.source === 'automation' ? <Zap className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          <span className={`block flex-1 truncate text-sm ${unread ? 'font-extrabold text-slate-900' : 'font-bold text-slate-700'}`}>{item.title}</span>
          {unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-600" />}
        </span>
        {item.body && <span className="mt-0.5 block whitespace-pre-line text-xs leading-relaxed text-slate-600 line-clamp-3">{item.body}</span>}
        {item.image_url && (
          <span className="relative mt-2 block h-28 w-full overflow-hidden rounded-xl ring-1 ring-slate-200">
            <Image src={item.image_url} alt="" fill sizes="400px" className="object-cover" />
          </span>
        )}
        <span className="mt-1.5 flex items-center gap-2 text-[11px] font-bold text-slate-400">
          <span>{fmtRelative(item.created_at)}</span>
          {item.sender_name && <span>· {item.sender_name}</span>}
          {item.link_url && <span className="mr-auto flex items-center gap-0.5 text-indigo-600"><ExternalLink className="h-3 w-3" /> فتح</span>}
        </span>
      </span>
    </button>
  );
}

/**
 * «إشعارات الجهاز» card — shows the current state and lets the user grant
 * permission + register this device. Works for the servant (session) and
 * the child (token).
 */
export function PushToggle({ supabase, owner, compact = false }: {
  supabase: SupabaseClient;
  owner: { kind: 'servant' } | { kind: 'child'; token: string };
  compact?: boolean;
}) {
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const s = pushSupport();
    setSupport(s);
    const sub = await currentSubscription();
    setEnabled(!!sub && Notification.permission === 'granted');
    if (sub && Notification.permission === 'granted') syncPushRegistration(supabase, owner);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, owner.kind, (owner as { token?: string }).token]);

  useEffect(() => { refresh(); }, [refresh]);

  const enable = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await enablePush(supabase, owner);
      if (r.ok) { setEnabled(true); setMsg('تم تفعيل إشعارات الجهاز ✅'); }
      else setMsg(PUSH_REASON_LABELS[r.reason ?? ''] ?? r.reason ?? 'تعذر التفعيل');
    } finally { setBusy(false); refresh(); }
  };
  const disable = async () => {
    setBusy(true); setMsg(null);
    try { await disablePush(supabase, owner); setEnabled(false); setMsg('تم إيقاف إشعارات هذا الجهاز'); }
    finally { setBusy(false); refresh(); }
  };

  if (support === null || enabled === null) return null;
  const blocked = support !== 'ok' && !enabled;

  if (compact && enabled) return null;

  return (
    <section id="push-toggle" className={`card mb-3 !p-3 ${enabled ? 'border-emerald-100' : 'border-indigo-100'}`}>
      <div className="flex items-center gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'}`}>
          {enabled ? <BellRing className="h-6 w-6" /> : blocked ? <BellOff className="h-6 w-6" /> : <Smartphone className="h-6 w-6" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-slate-800">{enabled ? 'إشعارات الجهاز مفعّلة' : 'إشعارات الجهاز'}</p>
          <p className="text-[11px] font-bold leading-relaxed text-slate-500">
            {enabled
              ? 'ستصلك الإشعارات على هذا الجهاز حتى والتطبيق مغلق'
              : blocked ? (PUSH_REASON_LABELS[support] ?? '') : 'اسمح بالإشعارات لتصلك على هذا الجهاز حتى والتطبيق مغلق'}
          </p>
        </div>
        {enabled ? (
          <button id="push-disable" type="button" onClick={disable} disabled={busy} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-extrabold text-slate-600 hover:bg-slate-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'إيقاف'}
          </button>
        ) : !blocked ? (
          <button id="push-enable" type="button" onClick={enable} disabled={busy} className="btn-primary flex items-center gap-1 !py-2 !px-3 text-xs">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} تفعيل
          </button>
        ) : null}
      </div>
      {msg && <p className="mt-2 text-[11px] font-bold text-indigo-700">{msg}</p>}
    </section>
  );
}
