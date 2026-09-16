'use client';

// ---------- OWNER MODULE HUB (وحدة المالك) ----------
// A unique module visible ONLY to role = owner. Owner-only controls are
// added here step by step; the first one is module access control.

import Link from 'next/link';
import { Crown, Layers, ChevronLeft, ArrowRight, Sparkles, Paintbrush, KeyRound } from 'lucide-react';
import { usePermissions } from '@/lib/permissions-context';
import AppShell from '@/components/AppShell';
import { OwnerGate } from '@/components/ModuleGate';
import { useModules } from '@/lib/modules-context';
import { MODULES } from '@/lib/modules';
import { useCustomization } from '@/lib/customization-context';

export default function OwnerHubPage() {
  const { grants } = useModules();
  const { customized, widgetsCustomized, names, label, codesCustomized } = useCustomization();
  const anyCustom = customized || widgetsCustomized || Object.keys(names).length > 0 || codesCustomized;
  const { profiles: permissionProfiles } = usePermissions();

  return (
    <AppShell>
      <OwnerGate>
        <section className="mb-4 flex items-center gap-2">
          <Link href="/settings" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
            <ArrowRight className="h-5 w-5" />
          </Link>
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <Crown className="h-5 w-5 text-gold-500" />
            {label('owner')}
          </h2>
        </section>

        <p className="mb-4 rounded-2xl bg-gold-50 px-4 py-3 text-xs font-bold text-gold-700">
          وحدة خاصة بمالك التطبيق فقط — لا تظهر لأي خادم أو مدير. تُبنى خطوة بخطوة؛
          كل أداة تحكم جديدة تُضاف هنا.
        </p>

        <section id="owner-tools" className="mb-5">
          <h3 className="mb-2 text-sm font-extrabold text-slate-500">أدوات التحكم</h3>
          <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
            <Link
              id="owner-modules-link"
              href="/owner/modules"
              className="flex items-center gap-3 px-4 py-3.5 hover:bg-indigo-50/50 transition"
            >
              <span className="rounded-xl bg-slate-50 p-2">
                <Layers className="h-5 w-5 text-primary-600" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-bold text-sm">صلاحيات الوحدات</span>
                <span className="block text-xs text-slate-400 truncate">
                  حدد أي كنيسة / خدمة / فصل يرى كل وحدة
                </span>
              </span>
              <span className="badge bg-primary-100 text-primary-700 tabular-nums">
                {MODULES.length} وحدة · {grants.length} صلاحية
              </span>
              <ChevronLeft className="h-4 w-4 text-slate-300" />
            </Link>

            <Link
              id="owner-permissions-link"
              href="/owner/permissions"
              className="flex items-center gap-3 px-4 py-3.5 hover:bg-indigo-50/50 transition"
            >
              <span className="rounded-xl bg-slate-50 p-2">
                <KeyRound className="h-5 w-5 text-violet-600" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-bold text-sm">ملفات الصلاحيات</span>
                <span className="block text-xs text-slate-400 truncate">
                  مجموعات صلاحيات باسم — يربط بها المديرون تسجيلات الخدام
                </span>
              </span>
              <span className="badge bg-violet-100 text-violet-700 tabular-nums">
                {permissionProfiles.length} ملف
              </span>
              <ChevronLeft className="h-4 w-4 text-slate-300" />
            </Link>

            <Link
              id="owner-customize-link"
              href="/owner/customize"
              className="flex items-center gap-3 px-4 py-3.5 hover:bg-indigo-50/50 transition"
            >
              <span className="rounded-xl bg-slate-50 p-2">
                <Paintbrush className="h-5 w-5 text-accent-600" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-bold text-sm">تخصيص التطبيق</span>
                <span className="block text-xs text-slate-400 truncate">
                  شريط المهام · أيقونات الهيدر · ودجات الرئيسية · أسماء الصفحات · نظام الأكواد
                </span>
              </span>
              <span className={`badge ${anyCustom ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {anyCustom ? 'مخصص' : 'افتراضي'}
              </span>
              <ChevronLeft className="h-4 w-4 text-slate-300" />
            </Link>
          </div>
        </section>

        <p className="flex items-center gap-2 px-1 text-xs font-bold text-slate-400">
          <Sparkles className="h-3.5 w-3.5" />
          المزيد من أدوات المالك قادمة
        </p>
      </OwnerGate>
    </AppShell>
  );
}
