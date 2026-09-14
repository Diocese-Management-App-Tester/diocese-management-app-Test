'use client';

// ---------- OWNER MODULE → تخصيص التطبيق (hub) ----------
// Owner-only. Four tools: TASKBAR (5 bottom slots) · HEADER icons ·
// HOME WIDGETS · NAMES of pages/modules (applied everywhere).

import Link from 'next/link';
import {
  Paintbrush, ChevronLeft, PanelBottom, PanelTop, LayoutGrid, Type, Sparkles, Check, type LucideIcon,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { OwnerGate } from '@/components/ModuleGate';
import { useCustomization } from '@/lib/customization-context';
import { HEADER_WIDGET_BY_KEY, isLinkItem, linkTarget } from '@/lib/navigation';
import { WIDGET_BY_KEY } from '@/lib/widgets';
import { EditorHeader } from '@/components/customize/shared';

function Tool({
  id, href, icon: Icon, tone, title, desc, summary,
}: {
  id: string; href: string; icon: LucideIcon; tone: string; title: string; desc: string; summary: string;
}) {
  return (
    <Link id={id} href={href} className="flex items-center gap-3 px-4 py-3.5 hover:bg-indigo-50/50 transition">
      <span className="rounded-xl bg-slate-50 p-2">
        <Icon className={`h-5 w-5 ${tone}`} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-bold text-sm">{title}</span>
        <span className="block text-xs text-slate-400 truncate">{desc}</span>
        <span className={`mt-1 block text-[11px] font-bold truncate ${tone}`}>{summary}</span>
      </span>
      <ChevronLeft className="h-4 w-4 text-slate-300" />
    </Link>
  );
}

export default function CustomizeHubPage() {
  const { navigation, customized, widgetsConfig, widgetsCustomized, names, label } = useCustomization();

  const taskbarSummary = navigation.taskbar.map((s) => label(s.key)).join(' · ');
  const headerSummary = navigation.header.length === 0
    ? 'لا توجد أيقونات — زر القائمة فقط'
    : navigation.header
        .map((h) => (isLinkItem(h.key) ? label(linkTarget(h.key)) : HEADER_WIDGET_BY_KEY[h.key]?.label ?? h.key))
        .join(' · ');
  const widgetsSummary = widgetsConfig.items.length === 0
    ? 'الرئيسية فارغة'
    : `${widgetsConfig.items.length} ودجة — ${widgetsConfig.items
        .slice(0, 4)
        .map((w) => w.title ?? WIDGET_BY_KEY[w.key]?.label ?? w.key)
        .join(' · ')}${widgetsConfig.items.length > 4 ? ' …' : ''}`;
  const namesCount = Object.keys(names).length;
  const namesSummary = namesCount === 0
    ? 'كل الأسماء افتراضية'
    : `${namesCount} اسم مخصص — ${Object.entries(names).slice(0, 3).map(([, v]) => v).join(' · ')}${namesCount > 3 ? ' …' : ''}`;

  const anyCustom = customized || widgetsCustomized || namesCount > 0;

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
            <Tool
              id="customize-taskbar-link"
              href="/owner/customize/taskbar"
              icon={PanelBottom}
              tone="text-primary-600"
              title="شريط المهام"
              desc="الخمس أيقونات في الشريط السفلي — الباقي في القائمة الجانبية"
              summary={taskbarSummary}
            />
            <Tool
              id="customize-header-link"
              href="/owner/customize/header"
              icon={PanelTop}
              tone="text-accent-600"
              title="أيقونات الهيدر"
              desc="التاريخ · الرسائل · الإشعارات · روابط سريعة لأي صفحة — بالترتيب الذي تريده"
              summary={headerSummary}
            />
            <Tool
              id="customize-widgets-link"
              href="/owner/customize/widgets"
              icon={LayoutGrid}
              tone="text-emerald-600"
              title="ودجات الرئيسية"
              desc="اختر ما يظهر في الصفحة الرئيسية: النبض اليومي · الحدث القادم · المتابعة · الآية … وترتيبها وحجمها"
              summary={widgetsSummary}
            />
            <Tool
              id="customize-names-link"
              href="/owner/customize/names"
              icon={Type}
              tone="text-gold-600"
              title="أسماء الصفحات والوحدات"
              desc="غيّر اسم أي صفحة أو وحدة — يظهر الاسم الجديد في عنوان الصفحة والقوائم والشريط"
              summary={namesSummary}
            />
          </div>
        </section>

        <p className="flex items-center gap-2 px-1 text-xs font-bold text-slate-400">
          {anyCustom ? (
            <><Check className="h-3.5 w-3.5 text-emerald-500" /> تخصيص محفوظ — يعمل على كل الأجهزة</>
          ) : (
            <><Sparkles className="h-3.5 w-3.5" /> التطبيق على الشكل الافتراضي</>
          )}
        </p>
      </OwnerGate>
    </AppShell>
  );
}
