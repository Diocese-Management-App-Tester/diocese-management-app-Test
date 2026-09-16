'use client';

// ---------- /child/login → unified login (دخول المخدوم) ----------
// Since migration 0042 the child signs in with code + password on the shared
// /login page (tab «دخول المخدوم»). This route only redirects so old links,
// bookmarks and the PWA shortcut keep working.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useChild } from '@/lib/child-context';

export default function ChildLoginRedirect() {
  const router = useRouter();
  const { token, loading } = useChild();

  useEffect(() => {
    if (loading) return;
    router.replace(token ? '/child' : '/login?as=child');
  }, [loading, token, router]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-gold-500" />
    </main>
  );
}
