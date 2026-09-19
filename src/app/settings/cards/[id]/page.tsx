'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowRight, Loader2, Save, Palette, Printer, IdCard } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import type { CardTemplate, CardDesign, CardPrintSettings } from '@/lib/card-types';
import { normalizeDesign, normalizePrint, GOOGLE_FONTS } from '@/lib/card-types';
import type { CardConstantsData } from '@/components/cards/CardCanvas';
import DesignTab from '@/components/cards/DesignTab';
import PrintTab from '@/components/cards/PrintTab';

type Tab = 'design' | 'print';

// Load all designer Google fonts once so previews render correctly
function FontsLoader() {
  const href = useMemo(() => {
    const families = GOOGLE_FONTS.map(
      (f) => `family=${f.replace(/ /g, '+')}:wght@400;700;800`
    ).join('&');
    return `https://fonts.googleapis.com/css2?${families}&display=swap`;
  }, []);
  // eslint-disable-next-line @next/next/no-page-custom-font
  return <link rel="stylesheet" href={href} />;
}

export default function CardDesignerPage() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const supabase = createClient();

  const [template, setTemplate] = useState<CardTemplate | null>(null);
  const [design, setDesign] = useState<CardDesign | null>(null);
  const [print, setPrint] = useState<CardPrintSettings | null>(null);
  const [constants, setConstants] = useState<CardConstantsData>({
    church_name: '', service_name: '', class_name: '', church_logo_url: null,
  });
  const [tab, setTab] = useState<Tab>('design');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  // ---------- load template + scope constants ----------
  const load = useCallback(async () => {
    const { data: t } = await supabase.from('card_templates').select('*').eq('id', id).single();
    if (!t) { setLoading(false); return; }
    const tpl = t as CardTemplate;
    setTemplate(tpl);
    setDesign(normalizeDesign(tpl.design));
    setPrint(normalizePrint(tpl.print_settings));

    const [{ data: church }, svc, cls] = await Promise.all([
      supabase.from('churches').select('name, logo_url').eq('id', tpl.church_id).single(),
      tpl.service_id
        ? supabase.from('services').select('name, photo_url').eq('id', tpl.service_id).single()
        : Promise.resolve({ data: null }),
      tpl.class_id
        ? supabase.from('classes').select('name, photo_url').eq('id', tpl.class_id).single()
        : Promise.resolve({ data: null }),
    ]);
    const svcRow = svc.data as { name: string; photo_url: string | null } | null;
    const clsRow = cls.data as { name: string; photo_url: string | null } | null;
    setConstants({
      church_name: church?.name ?? '',
      service_name: svcRow?.name ?? 'كل الخدمات',
      class_name: clsRow?.name ?? 'كل الفصول',
      church_logo_url: church?.logo_url ?? null,
      service_logo_url: svcRow?.photo_url ?? null,
      class_logo_url: clsRow?.photo_url ?? null,
    });
    setLoading(false);
  }, [supabase, id]);

  useEffect(() => {
    if (profile?.status === 'approved') load();
  }, [profile, load]);

  // ---------- change handlers (mark dirty) ----------
  const updateDesign = (d: CardDesign) => { setDesign(d); setDirty(true); };
  const updatePrint = (p: CardPrintSettings) => { setPrint(p); setDirty(true); };

  // ---------- save ----------
  const save = async () => {
    if (!template || !design || !print) return;
    setSaving(true);
    const { error } = await supabase
      .from('card_templates')
      .update({ design, print_settings: print, edited_by: profile?.id })
      .eq('id', template.id);
    setSaving(false);
    if (!error) {
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    }
  };

  // warn on leaving with unsaved changes
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  if (loading) {
    return (
      <AppShell>
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>
      </AppShell>
    );
  }

  if (!template || !design || !print) {
    return (
      <AppShell>
        <div className="card py-12 text-center text-slate-400 font-bold">القالب غير موجود</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <FontsLoader />

      {/* header */}
      <section className="mb-3 flex items-center justify-between gap-2 print:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/settings/cards" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
            <ArrowRight className="h-5 w-5" />
          </Link>
          <h2 className="flex min-w-0 items-center gap-2 text-lg font-extrabold">
            <IdCard className="h-5 w-5 shrink-0 text-primary-600" />
            <span className="truncate">{template.name}</span>
          </h2>
        </div>
        <button
          onClick={save}
          disabled={saving || !dirty}
          className={`btn-primary !py-2 !px-4 flex items-center gap-1.5 text-sm ${savedFlash ? '!from-emerald-600 !to-emerald-500' : ''}`}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {savedFlash ? 'تم الحفظ ✓' : dirty ? 'حفظ' : 'محفوظ'}
        </button>
      </section>

      {/* tabs */}
      <div className="mb-4 flex rounded-2xl bg-white p-1 shadow-card border border-indigo-50 print:hidden">
        <button
          onClick={() => setTab('design')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-extrabold transition ${
            tab === 'design' ? 'bg-primary-600 text-white shadow' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          <Palette className="h-4 w-4" /> التصميم
        </button>
        <button
          onClick={() => setTab('print')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-extrabold transition ${
            tab === 'print' ? 'bg-primary-600 text-white shadow' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          <Printer className="h-4 w-4" /> الطباعة
        </button>
      </div>

      {tab === 'design' ? (
        <DesignTab design={design} onChange={updateDesign} constants={constants} />
      ) : (
        <PrintTab
          design={design}
          settings={print}
          onChange={updatePrint}
          constants={constants}
          template={template}
        />
      )}
    </AppShell>
  );
}
