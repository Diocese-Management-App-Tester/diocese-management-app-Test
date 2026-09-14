'use client';

// ---------- الرئيسية — a grid of WIDGETS decided by the owner ----------
// The layout (which widgets · order · size · heading) comes from تخصيص
// التطبيق → ودجات الرئيسية (app_settings.widgets, migration 0036) resolved
// for the signed-in user: widgets bound to a module he doesn't have, or to
// roles he doesn't hold, are skipped. Half-size widgets pair up in a
// 2-column grid; full-size ones span the row. Realtime → the page re-lays
// the moment the owner saves.

import Link from 'next/link';
import { LayoutGrid, Loader2, Paintbrush } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { useCustomization } from '@/lib/customization-context';
import { RenderWidget } from '@/components/widgets/WidgetRenderer';

export default function HomePage() {
  const { profile } = useAuth();
  const { widgets, loading } = useCustomization();
  const isOwner = profile?.role === 'owner';

  return (
    <AppShell>
      {loading && widgets.length === 0 ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>
      ) : widgets.length === 0 ? (
        <div id="home-empty" className="card py-12 text-center">
          <LayoutGrid className="mx-auto mb-3 h-10 w-10 text-slate-200" />
          <p className="font-extrabold text-slate-600">الرئيسية فارغة</p>
          <p className="mt-1 text-xs font-bold text-slate-400">لا توجد ودجات مفعّلة لنطاقك</p>
          {isOwner && (
            <Link href="/owner/customize/widgets" className="btn-primary mt-4 inline-flex items-center gap-1.5 !px-4 !py-2 text-sm">
              <Paintbrush className="h-4 w-4" /> ودجات الرئيسية
            </Link>
          )}
        </div>
      ) : (
        <div id="home-widgets" className="grid grid-cols-2 gap-3">
          {widgets.map((w) => (
            <div key={w.key} className={w.size === 'full' ? 'col-span-2' : 'col-span-1'}>
              <RenderWidget widgetKey={w.key} title={w.title} size={w.size} />
            </div>
          ))}
        </div>
      )}

      {isOwner && widgets.length > 0 && (
        <p className="mt-5 text-center">
          <Link href="/owner/customize/widgets" className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-primary-600">
            <Paintbrush className="h-3.5 w-3.5" /> تخصيص ودجات الرئيسية
          </Link>
        </p>
      )}
    </AppShell>
  );
}
