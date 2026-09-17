'use client';

// ---------- إدارة المخدومين — one module page with 4 tabs (migrations 0042 + 0043) ----------
//   المخدومين         → ManagePeoplePanel  (edit · move · stop · delete children,
//                        grouped church → service → class; stop a whole scope)
//   إضافة             → AddChildrenPanel   (single / bulk — moved here from /children/add)
//   الطلبات           → ChildRequestsPanel (child signups awaiting approval, badge = count)
//   دعوة مخدوم (QR)   → ChildInvitePanel   (scoped invite link + QR → /child/signup)
// URL: /children/manage?tab=people|add|requests|invite — linked from Settings → الإدارة.
// Any approved servant can use it (a class servant manages HIS class; RLS
// scopes the requests, the add RPC checks the class access).

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, GraduationCap, UserCheck, UserPlus, QrCode, Loader2, UserCog } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import AddChildrenPanel from '@/components/children/AddChildrenPanel';
import ChildRequestsPanel from '@/components/children/ChildRequestsPanel';
import ChildInvitePanel from '@/components/children/ChildInvitePanel';
import ManagePeoplePanel from '@/components/children/ManagePeoplePanel';

type Tab = 'people' | 'add' | 'requests' | 'invite';
const TABS: { key: Tab; label: string; icon: typeof UserCog; color: string }[] = [
  { key: 'people', label: 'المخدومين', icon: UserCog, color: 'text-amber-600' },
  { key: 'add', label: 'إضافة', icon: UserPlus, color: 'text-violet-600' },
  { key: 'requests', label: 'الطلبات', icon: UserCheck, color: 'text-red-600' },
  { key: 'invite', label: 'دعوة (QR)', icon: QrCode, color: 'text-primary-600' },
];

export default function ChildrenManagePage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>}>
        <ChildrenManageModule />
      </Suspense>
    </AppShell>
  );
}

function ChildrenManageModule() {
  const { profile } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [supabase] = useState(() => createClient());
  const raw = params.get('tab');
  const tab: Tab = raw === 'requests' || raw === 'invite' || raw === 'add' ? raw : 'people';
  const [pendingCount, setPendingCount] = useState(0);

  const loadCount = useCallback(async () => {
    const { data } = await supabase.rpc('pending_child_join_requests_count');
    setPendingCount(Number(data ?? 0));
  }, [supabase]);
  useEffect(() => { if (profile?.status === 'approved') loadCount(); }, [profile?.status, loadCount]);
  useDebouncedRealtime(supabase, 'children-manage-count', [{ table: 'child_join_requests' }], loadCount, { enabled: !!profile });

  const setTab = (t: Tab) => router.replace(t === 'people' ? '/children/manage' : `/children/manage?tab=${t}`);

  return (
    <>
      <section className="mb-4 flex items-center gap-2">
        <Link href="/settings" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
          <ArrowRight className="h-5 w-5" />
        </Link>
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <GraduationCap className="h-5 w-5 text-gold-600" />
          إدارة المخدومين
        </h2>
      </section>

      <div id="children-manage-tabs" className="mb-4 grid grid-cols-4 gap-1 rounded-2xl bg-indigo-50 p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              id={`children-manage-tab-${t.key}`}
              onClick={() => setTab(t.key)}
              aria-pressed={active}
              className={`relative flex items-center justify-center gap-1 rounded-xl px-1 py-2.5 text-[11px] sm:text-sm font-extrabold transition ${
                active ? 'bg-white text-primary-700 shadow' : 'text-slate-500'
              }`}
            >
              <Icon className={`h-4 w-4 ${active ? t.color : ''}`} />
              {t.label}
              {t.key === 'requests' && pendingCount > 0 && (
                <span className="absolute -top-1 -left-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-extrabold text-white shadow">
                  {pendingCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === 'people' && <ManagePeoplePanel />}
      {tab === 'add' && <AddChildrenPanel />}
      {tab === 'requests' && <ChildRequestsPanel />}
      {tab === 'invite' && <ChildInvitePanel />}
    </>
  );
}
