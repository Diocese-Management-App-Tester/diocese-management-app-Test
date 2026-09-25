'use client';

// ---------- MESSAGES MODULE — THREAD ----------
// bucket = 'e:<enrollment>' (a child's conversation — all servants of the
// tenant + the child), 's:<profile>' (direct chat with a servant) or 'b'
// (announcements I received / sent). Realtime, paged upwards, marks read.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Megaphone, Phone, ChevronUp, Users, Plus } from 'lucide-react';
import AppShell from '@/components/AppShell';
import InfoTip from '@/components/InfoTip';
import {
  MessagesHeader, ChatAvatar, MessageBubble, DayDivider, Composer, ImageViewer, Toast, EmptyChat,
} from '@/components/messages/ChatBits';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { ROLE_LABELS } from '@/lib/types';
import {
  fetchThread, sendMessage, markRead, deleteMessage, chatErrorMessage, groupByDay,
  type ChatThread, type ChatMessage,
} from '@/lib/chat';

export default function MessageThreadPage() {
  const params = useParams<{ bucket: string }>();
  const bucket = decodeURIComponent(params.bucket ?? '');
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const approved = profile?.status === 'approved';

  const [thread, setThread] = useState<ChatThread | null>(null);
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2800); };

  const load = useCallback(async () => {
    try {
      const t = await fetchThread(supabase, bucket);
      setThread(t);
      setError(null);
      // reading the thread = read
      markRead(supabase, bucket).catch(() => {});
    } catch (e) {
      setError(chatErrorMessage(e, 'تعذر تحميل المحادثة'));
    } finally {
      setLoading(false);
    }
  }, [supabase, bucket]);

  useEffect(() => { if (approved && bucket) load(); }, [approved, bucket, load]);
  useDebouncedRealtime(
    supabase, `messages-thread-${bucket}`, [{ table: 'chat_messages' }], load,
    { enabled: approved, delayMs: 400 }
  );

  const all = useMemo(() => [...older, ...(thread?.messages ?? [])], [older, thread]);
  const groups = useMemo(() => groupByDay(all), [all]);

  useEffect(() => {
    if (stickToBottom.current) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [all.length]);

  const loadMore = async () => {
    const first = all[0];
    if (!first || loadingMore) return;
    setLoadingMore(true);
    stickToBottom.current = false;
    try {
      const t = await fetchThread(supabase, bucket, { before: first.created_at });
      setOlder((o) => [...t.messages, ...o]);
      if (t.messages.length === 0 && thread) setThread({ ...thread, has_more: false });
    } catch (e) {
      flash(chatErrorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  };

  const header = thread?.header;
  const kind = header?.kind ?? (bucket.startsWith('e:') ? 'child' : bucket.startsWith('s:') ? 'staff' : 'broadcast');

  const onSend = async (body: string, imageUrl: string | null) => {
    stickToBottom.current = true;
    if (kind === 'child' && header?.enrollment_id) {
      await sendMessage(supabase, { target: 'children', enrollment_ids: [header.enrollment_id], body, image_url: imageUrl });
    } else if (kind === 'staff' && header?.other_profile_id) {
      await sendMessage(supabase, { target: 'staff', profile_ids: [header.other_profile_id], body, image_url: imageUrl });
    } else {
      throw new Error('الإعلانات تُرسَل من «رسالة جديدة»');
    }
    await load();
  };

  const onDelete = async (m: ChatMessage) => {
    if (!confirm('حذف هذه الرسالة؟')) return;
    try {
      const ok = await deleteMessage(supabase, m.id);
      if (!ok) flash('ليس لديك صلاحية حذف هذه الرسالة');
      else await load();
    } catch (e) {
      flash(chatErrorMessage(e, 'تعذر الحذف'));
    }
  };

  // ---------- header ----------
  const title = kind === 'child' ? header?.person_name ?? 'مخدوم'
    : kind === 'staff' ? header?.other_name ?? 'خادم'
    : 'الإعلانات';
  const sub = kind === 'child'
    ? [header?.class_name, header?.service_name, header?.church_name].filter(Boolean).join(' · ')
    : kind === 'staff'
      ? [header?.other_role ? ROLE_LABELS[header.other_role] : null, header?.class_name ?? header?.service_name ?? header?.church_name].filter(Boolean).join(' · ')
      : 'إعلانات الفصل والخدمة والكنيسة والإيبارشية — وإعلاناتك للخدام';
  const phone = kind === 'child' ? header?.person_phone : kind === 'staff' ? header?.other_phone : null;
  const canWrite = kind === 'child' ? true : kind === 'staff' ? header?.can_write !== false : false;

  return (
    <AppShell>
      <MessagesHeader
        title={title}
        sub={sub}
        icon={
          kind === 'broadcast'
            ? <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow"><Megaphone className="h-5 w-5" /></span>
            : <ChatAvatar url={kind === 'child' ? header?.person_image : header?.other_photo} name={title} size={40} tone={kind === 'child' ? 'emerald' : 'sky'} />
        }
        actions={
          <div className="flex items-center gap-1">
            {phone && (
              <a href={`tel:${phone}`} aria-label="اتصال" className="rounded-full bg-emerald-50 p-2 text-emerald-600 hover:bg-emerald-100">
                <Phone className="h-5 w-5" />
              </a>
            )}
            {kind === 'broadcast' && (
              <Link href="/messages/new" className="btn-primary flex items-center gap-1 !py-2 !px-3 text-xs !from-violet-600 !to-violet-500">
                <Plus className="h-4 w-4" /> إعلان
              </Link>
            )}
          </div>
        }
      />

      {kind === 'child' && (
        <p className="mb-2 flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-800">
          <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          هذه المحادثة يراها المخدوم وكل الخدام المسموح لهم على فصله — والإعلانات التي وصلته تظهر فيها أيضاً.
        </p>
      )}
      {kind === 'staff' && header && header.can_write === false && (
        <p className="mb-2 flex items-center justify-center gap-1 text-[11px] font-bold text-amber-700">
          للقراءة فقط <InfoTip size="xs" title="للقراءة فقط" tone="text-amber-600 hover:bg-amber-50">يمكنك القراءة فقط — هذا الخادم ليس تابعاً لك ولم يراسلك.</InfoTip>
        </p>
      )}

      {error && <div className="card mb-3 text-center text-sm font-bold text-red-600">{error}</div>}

      <section id="chat-thread" className="min-h-[50vh]">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-sky-500" /></div>
        ) : all.length === 0 ? (
          <EmptyChat
            text={kind === 'broadcast' ? 'لا توجد إعلانات بعد' : 'ابدأ المحادثة'}
            sub={kind === 'broadcast' ? 'أرسل إعلاناً لفصل أو خدمة أو كنيسة من «رسالة جديدة»' : 'اكتب رسالتك في الأسفل'}
          />
        ) : (
          <>
            {thread?.has_more && (
              <div className="mb-2 flex justify-center">
                <button type="button" onClick={loadMore} disabled={loadingMore} className="btn-secondary flex items-center gap-1 !py-1.5 !px-3 text-xs">
                  {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronUp className="h-4 w-4" />} رسائل أقدم
                </button>
              </div>
            )}
            {groups.map((g) => (
              <div key={g.key}>
                <DayDivider label={g.heading} />
                <div className="space-y-2">
                  {g.items.map((m) => (
                    <MessageBubble key={m.id} m={m} showSender={kind !== 'staff'} onDelete={onDelete} onImage={setViewer} />
                  ))}
                </div>
              </div>
            ))}
            <div ref={bottomRef} className="h-2" />
          </>
        )}
      </section>

      {kind !== 'broadcast' && (
        <Composer supabase={supabase} folder="messages" onSend={onSend} disabled={!canWrite || loading} autoFocus />
      )}

      <ImageViewer url={viewer} onClose={() => setViewer(null)} />
      <Toast msg={toast} />
    </AppShell>
  );
}
