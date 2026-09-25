'use client';

// ---------- MESSAGES MODULE — INBOX (الرسائل) ----------
// Every conversation the servant can see (children of his tenant + direct
// staff chats), the announcements bucket on top, unread counts, search and
// a filter (all / children / staff). «رسالة جديدة» opens the composer.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Plus, Search, Loader2, Megaphone, Users, UserCog, ChevronLeft, Image as ImageIcon } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { MessagesHeader, ChatAvatar, UnreadDot, EmptyChat } from '@/components/messages/ChatBits';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { ROLE_LABELS } from '@/lib/types';
import {
  fetchInbox, fmtChatTime, isMessagesMigrationMissing, MESSAGES_MIGRATION_HINT,
  type ChatInbox, type ChatConversation,
} from '@/lib/chat';

type Filter = 'all' | 'child' | 'staff';

export default function MessagesInboxPage() {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';

  const [inbox, setInbox] = useState<ChatInbox | null>(null);
  const [loading, setLoading] = useState(true);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    try {
      setInbox(await fetchInbox(supabase));
      setMigrationMissing(false);
    } catch (e) {
      if (isMessagesMigrationMissing(e)) setMigrationMissing(true);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { if (approved) load(); }, [approved, load]);
  useDebouncedRealtime(
    supabase, 'messages-inbox', [{ table: 'chat_messages' }, { table: 'chat_read_state' }], load,
    { enabled: approved, delayMs: 600 }
  );

  const visible = useMemo(() => {
    const list = inbox?.conversations ?? [];
    const s = search.trim().toLowerCase();
    return list.filter((c) => {
      if (filter !== 'all' && c.kind !== filter) return false;
      if (!s) return true;
      const hay = [c.person_name, c.other_name, c.class_name, c.service_name, c.church_name, c.last_body].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(s);
    });
  }, [inbox, search, filter]);

  const counts = useMemo(() => {
    const list = inbox?.conversations ?? [];
    const child = list.filter((c) => c.kind === 'child');
    const staff = list.filter((c) => c.kind === 'staff');
    return {
      child: child.length,
      staff: staff.length,
      unreadChild: child.reduce((a, c) => a + c.unread, 0),
      unreadStaff: staff.reduce((a, c) => a + c.unread, 0),
    };
  }, [inbox]);

  const filters: { k: Filter; label: string; icon: ReactNode; n: number }[] = [
    { k: 'all', label: 'الكل', icon: null, n: counts.unreadChild + counts.unreadStaff },
    { k: 'child', label: `المخدومين (${counts.child})`, icon: <Users className="h-4 w-4" />, n: counts.unreadChild },
    { k: 'staff', label: `الخدام (${counts.staff})`, icon: <UserCog className="h-4 w-4" />, n: counts.unreadStaff },
  ];

  return (
    <AppShell>
      <MessagesHeader
        back="/settings"
        badge={inbox && inbox.total_unread > 0 ? <UnreadDot n={inbox.total_unread} /> : undefined}
        info="المخدوم يكتب من بوابته فتظهر رسالته هنا لكل خدام فصله وخدمته وكنيسته. أنت ترسل لمخدوم أو لمجموعة أو لفصل / خدمة / كنيسة كاملة حسب صلاحيتك، وللخدام التابعين لك."
        actions={
          <Link id="msg-new" href="/messages/new" className="btn-primary flex items-center gap-1.5 !py-2 !px-3 text-sm !from-sky-600 !to-sky-500">
            <Plus className="h-4 w-4" /> رسالة جديدة
          </Link>
        }
      />

      {migrationMissing && (
        <p className="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">⚠️ {MESSAGES_MIGRATION_HINT}</p>
      )}

      {/* Announcements bucket */}
      <Link id="msg-broadcasts" href="/messages/b" className="card mb-3 flex items-center gap-3 !p-3 transition hover:bg-violet-50/60">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow">
          <Megaphone className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-extrabold text-slate-800">
            الإعلانات
            {inbox && inbox.broadcasts_unread > 0 && <UnreadDot n={inbox.broadcasts_unread} />}
          </p>
          <p className="truncate text-xs font-bold text-slate-500">
            {inbox?.broadcasts_last ? (
              <>
                <span className="text-violet-600">{inbox.broadcasts_last.sender_name ?? '—'}</span>
                {' · '}{inbox.broadcasts_last.body || (inbox.broadcasts_last.image_url ? '📷 صورة' : '')}
              </>
            ) : 'إعلانات الفصل والخدمة والكنيسة والإيبارشية تظهر هنا'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-[10px] font-bold text-slate-400">
          {inbox?.broadcasts_last && <span>{fmtChatTime(inbox.broadcasts_last.created_at)}</span>}
          <ChevronLeft className="h-4 w-4" />
        </div>
      </Link>

      {/* Search + filters */}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          id="msg-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث بالاسم أو الفصل أو النص…"
          className="input-field !py-2.5 !pr-9"
        />
      </div>
      <div id="msg-filter" className="mb-3 grid grid-cols-3 gap-2">
        {filters.map((f) => (
          <button
            key={f.k}
            type="button"
            onClick={() => setFilter(f.k)}
            aria-pressed={filter === f.k}
            className={`flex h-10 items-center justify-center gap-1.5 rounded-xl text-xs font-extrabold transition active:scale-95 ${
              filter === f.k ? 'bg-sky-600 text-white shadow ring-2 ring-sky-300' : 'border border-slate-200 bg-white text-slate-600'
            }`}
          >
            {f.icon}{f.label}
            {f.n > 0 && <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${filter === f.k ? 'bg-white/25' : 'bg-sky-100 text-sky-700'}`}>{f.n}</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-sky-500" /></div>
      ) : visible.length === 0 ? (
        <EmptyChat
          text={search ? 'لا توجد محادثات مطابقة' : 'لا توجد محادثات بعد'}
          sub={search ? undefined : 'عندما يكتب مخدوم من بوابته أو ترسل أنت رسالة تظهر المحادثة هنا'}
        />
      ) : (
        <ul id="msg-list" className="space-y-2">
          {visible.map((c) => <ConversationRow key={c.bucket} c={c} />)}
        </ul>
      )}
    </AppShell>
  );
}

function ConversationRow({ c }: { c: ChatConversation }) {
  const isChild = c.kind === 'child';
  const name = isChild ? c.person_name : c.other_name;
  const sub = isChild
    ? [c.class_name, c.service_name, c.church_name].filter(Boolean).join(' · ')
    : [c.other_role ? ROLE_LABELS[c.other_role] : null, c.class_name ?? c.service_name ?? c.church_name].filter(Boolean).join(' · ');
  const showSender = !c.last_is_me && isChild && c.last_sender_name && c.last_sender_name !== c.person_name;
  return (
    <li>
      <Link
        href={`/messages/${encodeURIComponent(c.bucket)}`}
        className={`card flex items-center gap-3 !p-3 transition hover:bg-sky-50/60 ${c.unread > 0 ? 'ring-1 ring-sky-200' : ''}`}
      >
        <ChatAvatar url={isChild ? c.person_image : c.other_photo} name={name} size={48} tone={isChild ? 'emerald' : 'sky'} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            <span className="truncate font-extrabold text-slate-800">{name ?? '—'}</span>
            <span className={`badge !px-1.5 !py-0 text-[10px] ${isChild ? 'bg-emerald-50 text-emerald-700' : 'bg-sky-50 text-sky-700'}`}>{isChild ? 'مخدوم' : 'خادم'}</span>
          </p>
          <p className="truncate text-[11px] font-bold text-slate-400">{sub}</p>
          <p className={`mt-0.5 flex items-center gap-1 truncate text-xs ${c.unread > 0 ? 'font-extrabold text-slate-700' : 'font-bold text-slate-500'}`}>
            {c.last_is_me && <span className="text-slate-400">أنت:</span>}
            {showSender && <span className="text-sky-600">{c.last_sender_name}:</span>}
            {c.last_image && <ImageIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
            <span className="truncate">{c.last_body || (c.last_image ? 'صورة' : '')}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className="text-[10px] font-bold text-slate-400 tabular-nums">{fmtChatTime(c.last_at)}</span>
          <UnreadDot n={c.unread} />
        </div>
      </Link>
    </li>
  );
}
