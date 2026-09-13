'use client';

// ---------- Header bell — unread messages (وحدة الرسائل) ----------
// Rendered in the app header only when the `messages` module is granted to
// the caller. Realtime on chat_messages / chat_read_state (debounced); the
// count comes from chat_unread_total() so it is exactly what the inbox shows.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageCircle, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { useModuleVisible } from '@/lib/modules-context';
import { fetchUnreadTotal } from '@/lib/chat';

export default function MessagesBell({ icon: Icon = MessageCircle }: { icon?: LucideIcon } = {}) {
  const { profile } = useAuth();
  const visible = useModuleVisible('messages');
  const [supabase] = useState(() => createClient());
  const [n, setN] = useState(0);
  const enabled = !!visible && profile?.status === 'approved';

  const load = useCallback(async () => {
    if (!enabled) return;
    try { setN(await fetchUnreadTotal(supabase)); } catch { /* migration missing → silent */ }
  }, [supabase, enabled]);

  useEffect(() => { load(); }, [load]);
  useDebouncedRealtime(
    supabase, 'messages-bell', [{ table: 'chat_messages' }, { table: 'chat_read_state' }], load,
    { enabled, delayMs: 800 }
  );

  if (!visible) return null;
  return (
    <Link
      id="messages-bell"
      href="/messages"
      aria-label={n > 0 ? `${n} رسائل غير مقروءة` : 'الرسائل'}
      className="relative rounded-full p-2 transition hover:bg-white/15"
    >
      <Icon className="h-6 w-6" />
      {n > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-extrabold text-white ring-2 ring-primary-700 tabular-nums">
          {n > 99 ? '99+' : n}
        </span>
      )}
    </Link>
  );
}
