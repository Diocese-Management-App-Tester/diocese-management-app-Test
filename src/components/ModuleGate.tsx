'use client';

// ---------- Access gates ----------
// <ModuleGate module="cards">  — renders children only when the module is
//   granted to the caller's scope (owner always passes).
// <OwnerGate>                  — renders children only for role = owner.
// Both render a friendly "not available" card otherwise. They are UI guards
// on top of the RLS in migration 0024 — the database is the real wall.

import { type ReactNode } from 'react';
import Link from 'next/link';
import { Lock, Loader2, Crown, ArrowRight } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { useModuleVisible } from '@/lib/modules-context';
import { type ModuleKey } from '@/lib/modules';
import { useCustomization } from '@/lib/customization-context';

function Blocked({ title, desc, icon }: { title: string; desc: string; icon: ReactNode }) {
  return (
    <div id="access-blocked" className="card py-12 text-center">
      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
        {icon}
      </div>
      <p className="font-extrabold text-slate-700">{title}</p>
      <p className="mt-1 text-xs font-bold text-slate-400">{desc}</p>
      <Link href="/settings" className="btn-primary mt-5 inline-flex items-center gap-1 !py-2 !px-4 text-sm">
        <ArrowRight className="h-4 w-4" /> رجوع إلى الإعدادات
      </Link>
    </div>
  );
}

/**
 * `shell` — wrap the loading / blocked states in <AppShell>. Use it when the
 * gate sits in a route layout (the pages render their own AppShell when
 * they are allowed through).
 */
export function ModuleGate({
  module, children, shell = false,
}: { module: ModuleKey; children: ReactNode; shell?: boolean }) {
  const visible = useModuleVisible(module);
  const { label } = useCustomization();
  const wrap = (node: ReactNode) => (shell ? <AppShell>{node}</AppShell> : <>{node}</>);
  if (visible === null) {
    return wrap(
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }
  if (!visible) {
    return wrap(
      <Blocked
        title={`وحدة «${label(module)}» غير مفعّلة لنطاقك`}
        desc="مالك التطبيق يحدد الكنائس والخدمات والفصول التي تظهر لها هذه الوحدة"
        icon={<Lock className="h-7 w-7" />}
      />
    );
  }
  return <>{children}</>;
}

export function OwnerGate({ children }: { children: ReactNode }) {
  const { profile, loading } = useAuth();
  const { label } = useCustomization();
  if (loading || !profile) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }
  if (profile.role !== 'owner') {
    return (
      <Blocked
        title={`${label('owner')} خاصة بمالك التطبيق`}
        desc="هذه الصفحة لا تظهر إلا لحساب المالك"
        icon={<Crown className="h-7 w-7" />}
      />
    );
  }
  return <>{children}</>;
}
