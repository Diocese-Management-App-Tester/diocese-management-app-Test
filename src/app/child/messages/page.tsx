'use client';

// ---------- Child portal — الرسائل ----------
// One conversation per enrollment (his class): the child writes to his
// servants, every servant allowed on that class / service / church can read
// and reply, and the announcements sent to his scope appear inside too.
// Visible only where the owner granted the `messages` module.

import Link from 'next/link';
import Image from 'next/image';
import { MessageCircle, ChevronLeft, Church, Image as ImageIcon } from 'lucide-react';
import ChildShell, { useChildMessages } from '@/components/child/ChildShell';
import { EmptyState, PageTitle } from '@/components/child/ChildBits';
import { UnreadDot } from '@/components/messages/ChatBits';
import { fmtChatTime } from '@/lib/chat';

export default function ChildMessagesPage() {
  return (
    <ChildShell>
      <MessagesContent />
    </ChildShell>
  );
}

function MessagesContent() {
  const { conversations, unread } = useChildMessages();

  return (
    <>
      <PageTitle
        icon={<MessageCircle className="h-5 w-5 text-sky-600" />}
        title="الرسائل"
        info="اكتب لخدامك — يقرأ رسالتك كل خدام فصلك ويردّون عليك هنا. لكل فصل مسجَّل فيه محادثة واحدة. إعلانات الفصل والخدمة والكنيسة تظهر داخل المحادثة أيضاً."
      />

      {conversations === null && <div className="card py-10 text-center text-sm font-bold text-slate-400">جارٍ التحميل…</div>}
      {conversations && conversations.length === 0 && (
        <EmptyState text="الرسائل غير مفعّلة لفصلك بعد" />
      )}

      {conversations && conversations.length > 0 && (
        <ul id="child-msg-list" className="space-y-2">
          {conversations.map((c) => (
            <li key={c.enrollment_id}>
              <Link
                href={`/child/messages/${c.enrollment_id}`}
                className={`card flex items-center gap-3 !p-3 transition hover:bg-sky-50/60 ${c.unread > 0 ? 'ring-1 ring-sky-200' : ''}`}
              >
                <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-white ring-2 ring-sky-200">
                  {c.church_logo ? (
                    <Image src={c.church_logo} alt={c.church_name} fill sizes="48px" className="object-cover" />
                  ) : (
                    <Church className="absolute inset-0 m-auto h-6 w-6 text-sky-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-extrabold text-slate-800">{c.class_name} · {c.service_name}</p>
                  <p className="truncate text-[11px] font-bold text-slate-400">{c.church_name}</p>
                  <p className={`mt-0.5 flex items-center gap-1 truncate text-xs ${c.unread > 0 ? 'font-extrabold text-slate-700' : 'font-bold text-slate-500'}`}>
                    {c.last_at ? (
                      <>
                        <span className={c.last_is_me ? 'text-slate-400' : 'text-sky-600'}>{c.last_is_me ? 'أنت' : c.last_sender_name ?? 'خادم'}:</span>
                        {c.last_image && <ImageIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                        <span className="truncate">{c.last_body || (c.last_image ? 'صورة' : '')}</span>
                      </>
                    ) : (
                      <span className="text-slate-400">ابدأ المحادثة مع خدامك</span>
                    )}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <span className="text-[10px] font-bold text-slate-400 tabular-nums">{fmtChatTime(c.last_at)}</span>
                  {c.unread > 0 ? <UnreadDot n={c.unread} /> : <ChevronLeft className="h-4 w-4 text-slate-300" />}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {unread > 0 && <p className="mt-3 text-center text-[11px] font-bold text-slate-400">{unread} رسائل غير مقروءة</p>}
    </>
  );
}
