'use client';

// ---------- OWNER MODULE → تخصيص التطبيق (hub) ----------
// Owner-only. Each customization tool is a sub-page; the first two are the
// TASKBAR (the 5 bottom-bar slots) and the HEADER icons.

import Link from 'next/link';
import { Paintbrush, ChevronLeft, PanelBottom, PanelTop, Sparkles, Check } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { OwnerGate } from '@/components/ModuleGate';
import { useCustomization } from '@/lib/customization-context';
import { DEST_BY_KEY, HEADER_WIDGET_BY_KEY, isLinkItem, linkTarget } from '@/lib/navigation';
import { EditorHeader } from '@/components/customize/shared';

export default function CustomizeHubPage() {
  const { navigation, customized } = useCustomization();

  const taskbarSummary = navigation.taskbar.map((s) => s.label ?? DEST_BY_KEY[s.key]?.label ?? s.key).join(' · ');
  const headerSummary = navigation.header.length === 0
    ? 'لا توجد أيقونات — زر القائمة فقط'
    : navigation.header
        .map((h) => (isLinkItem(h.key) ? DEST_BY_KEY[linkTarget(h.key)]?.label : HEADER_WIDGET_BY_KEY[h.key]?.label) ?? h.key)
        .join(' · ');

  return (
    <AppShell>
      <OwnerGate>
        <EditorHeader back="/owner" icon={Paintbrush} title="تخصيص التطبيق" />

        <p className="mb-4 rounded-2xl bg-indigo-50 px-4 py-3 text-xs font-bold text-indigo-700">
          هنا تتحكم في شكل التطبيق لكل الخدام. التغييرات تُحفظ في قاعدة البيانات وتُطبَّق فوراً على كل
          الأجهزة. الوحدات غير المفعّلة لنطاق خادم لا تظهر له مهما كان الترتيب.
        </p>

        <section id="customize-tools" className="mb-5">
          <div className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
            <Link
              id="customize-taskbar-link"
              href="/owner/customize/taskbar"
              className="flex items-center gap-3 px-4 py-3.5 hover:bg-indigo-50/50 transition"
            >
              <span className="rounded-xl bg-slate-50 p-2">
                <PanelBottom className="h-5 w-5 text-primary-600" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-bold text-sm">شريط المهام</span>
                <span className="block text-xs text-slate-400 truncate">
                  الخمس أيقونات في الشريط السفلي — الباقي في القائمة الجانبية
                </span>
                <span className="mt-1 block text-[11px] font-bold text-primary-600 truncate">{taskbarSummary}</span>
              </span>
              <ChevronLeft className="h-4 w-4 text-slate-300" />
            </Link>

            <Link
              id="customize-header-link"
              href="/owner/customize/header"
              className="flex items-center gap-3 px-4 py-3.5 hover:bg-indigo-50/50 transition"
            >
              <span className="rounded-xl bg-slate-50 p-2">
                <PanelTop className="h-5 w-5 text-accent-600" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-bold text-sm">أيقونات الهيدر</span>
                <span className="block text-xs text-slate-400 truncate">
                  التاريخ · الرسائل · الإشعارات · روابط سريعة لأي صفحة — بالترتيب الذي تريده
                </span>
                <span className="mt-1 block text-[11px] font-bold text-accent-600 truncate">{headerSummary}</span>
              </span>
              <ChevronLeft className="h-4 w-4 text-slate-300" />
            </Link>
          </div>
        </section>

        <p className="flex items-center gap-2 px-1 text-xs font-bold text-slate-400">
          {customized ? (
            <><Check className="h-3.5 w-3.5 text-emerald-500" /> تخصيص محفوظ — يعمل على كل الأجهزة</>
          ) : (
            <><Sparkles className="h-3.5 w-3.5" /> التطبيق على الشكل الافتراضي</>
          )}
        </p>
      </OwnerGate>
    </AppShell>
  );
}
