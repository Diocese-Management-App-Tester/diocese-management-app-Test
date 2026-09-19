'use client';

// ---------- BIRTHDAYS — one card template: design + print ----------
// Design tab = the shared card designer (variant 'birthday' → extra
// variables), preview on a sample child. Print tab = BirthdayPrintTab
// (month's children). Query ?tab=print&year&month&church&service&class
// comes from the month view's «طباعة الكروت».

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { ArrowRight, Loader2, Save, Palette, Printer, Cake } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useAppDate } from '@/lib/app-date-context';
import { cairoParts } from '@/lib/time';
import type { CardDesign, CardPrintSettings } from '@/lib/card-types';
import { normalizeDesign, normalizePrint } from '@/lib/card-types';
import type { CardConstantsData } from '@/components/cards/CardCanvas';
import DesignTab from '@/components/cards/DesignTab';
import BirthdayPrintTab from '@/components/birthdays/BirthdayPrintTab';
import { FontsLoader } from '@/components/birthdays/BirthdayModals';
import { Toast } from '@/components/birthdays/BirthdayBits';
import { type BirthdayCardTemplate, SAMPLE_BIRTHDAY_PERSON, birthdayErrorMessage } from '@/lib/birthdays';

type Tab = 'design' | 'print';

export default function BirthdayCardDesignerPage() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const { now } = useAppDate();
  const today = cairoParts(now());

  const [template, setTemplate] = useState<BirthdayCardTemplate | null>(null);
  const [design, setDesign] = useState<CardDesign | null>(null);
  const [print, setPrint] = useState<CardPrintSettings | null>(null);
  const [constants, setConstants] = useState<CardConstantsData>({ church_name: '', service_name: '', class_name: '', church_logo_url: null });
  const [tab, setTab] = useState<Tab>(params.get('tab') === 'print' ? 'print' : 'design');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600); };

  const load = useCallback(async () => {
    const { data: t } = await supabase.from('birthday_card_templates').select('*').eq('id', id).single();
    if (!t) { setLoading(false); return; }
    const tpl = t as BirthdayCardTemplate;
    setTemplate(tpl);
    setDesign(normalizeDesign(tpl.design));
    setPrint(normalizePrint(tpl.print_settings));
    const [{ data: church }, svc, cls] = await Promise.all([
      supabase.from('churches').select('name, logo_url').eq('id', tpl.church_id).single(),
      tpl.service_id ? supabase.from('services').select('name, photo_url').eq('id', tpl.service_id).single() : Promise.resolve({ data: null }),
      tpl.class_id ? supabase.from('classes').select('name, photo_url').eq('id', tpl.class_id).single() : Promise.resolve({ data: null }),
    ]);
    const svcRow = svc.data as { name: string; photo_url: string | null } | null;
    const clsRow = cls.data as { name: string; photo_url: string | null } | null;
    setConstants({
      church_name: church?.name ?? '',
      service_name: svcRow?.name ?? 'مدارس الأحد',
      class_name: clsRow?.name ?? 'فصل المخدوم',
      church_logo_url: church?.logo_url ?? null,
      service_logo_url: svcRow?.photo_url ?? null,
      class_logo_url: clsRow?.photo_url ?? null,
    });
    setLoading(false);
  }, [supabase, id]);
  useEffect(() => { if (profile?.status === 'approved') load(); }, [profile, load]);

  const updateDesign = (d: CardDesign) => { setDesign(d); setDirty(true); };
  const updatePrint = (p: CardPrintSettings) => { setPrint(p); setDirty(true); };

  const save = async () => {
    if (!template || !design || !print) return;
    setSaving(true);
    const { error } = await supabase.from('birthday_card_templates')
      .update({ design, print_settings: print, edited_by: profile?.id }).eq('id', template.id);
    setSaving(false);
    if (error) { flash(birthdayErrorMessage(error)); return; }
    setDirty(false); setSavedFlash(true); setTimeout(() => setSavedFlash(false), 2000);
  };

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const initialYear = Number(params.get('year')) || today.year;
  const initialMonth = Number(params.get('month')) || today.month;
  const initialScope = useMemo(() => ({
    church: params.get('church') ?? undefined, service: params.get('service') ?? undefined, class: params.get('class') ?? undefined,
  }), [params]);

  if (loading) {
    return <AppShell><div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-pink-500" /></div></AppShell>;
  }
  if (!template || !design || !print) {
    return <AppShell><div className="card py-12 text-center font-bold text-slate-400">القالب غير موجود</div></AppShell>;
  }

  return (
    <AppShell>
      <FontsLoader />
      <section className="mb-3 flex items-center justify-between gap-2 print:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/birthdays/cards" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100"><ArrowRight className="h-5 w-5" /></Link>
          <h2 className="flex min-w-0 items-center gap-2 text-lg font-extrabold">
            <Cake className="h-5 w-5 shrink-0 text-pink-600" />
            <span className="truncate">{template.name}</span>
          </h2>
        </div>
        <button onClick={save} disabled={saving || !dirty}
          className={`btn-primary flex items-center gap-1.5 !px-4 !py-2 text-sm ${savedFlash ? '!from-emerald-600 !to-emerald-500' : ''}`}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {savedFlash ? 'تم الحفظ ✓' : dirty ? 'حفظ' : 'محفوظ'}
        </button>
      </section>

      <div className="mb-4 flex rounded-2xl border border-pink-50 bg-white p-1 shadow-card print:hidden">
        {(['design', 'print'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-extrabold transition ${tab === t ? 'bg-pink-600 text-white shadow' : 'text-slate-500 hover:bg-slate-50'}`}>
            {t === 'design' ? <><Palette className="h-4 w-4" /> التصميم</> : <><Printer className="h-4 w-4" /> الطباعة</>}
          </button>
        ))}
      </div>

      {tab === 'design' ? (
        <DesignTab design={design} onChange={updateDesign} constants={constants} variant="birthday" samplePerson={SAMPLE_BIRTHDAY_PERSON} />
      ) : (
        <BirthdayPrintTab
          supabase={supabase} design={design} settings={print} onChange={updatePrint} template={template}
          initialYear={initialYear} initialMonth={initialMonth} initialScope={initialScope}
          currentUserId={profile?.id} onPrinted={flash}
        />
      )}
      <Toast msg={toast} />
    </AppShell>
  );
}
