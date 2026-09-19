'use client';

// ---------- Birthdays — print tab of a birthday card template ----------
// Same mm-exact print engine as the ID-card module (hidden sheet portal,
// @page sized paper, computed cols × rows), but "who to print" is the
// children whose birthday falls in the SELECTED MONTH (year + month
// navigator, church → service → class narrowing, select all / some). After
// printing, a `card_printed` greeting is logged for each child.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, ChevronLeft, Loader2, Printer, Check, Square, CheckSquare, Cake } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import CardCanvas, { type CardConstantsData } from '@/components/cards/CardCanvas';
import PrintProfilesBar from '@/components/cards/PrintProfilesBar';
import type { CardDesign, CardPrintSettings, PaperSize, PaperOrientation } from '@/lib/card-types';
import { PAPER_SIZES, paperDims, ARABIC_MONTHS } from '@/lib/card-types';
import { ScopeSelectors, useScopeState, useStoreLookups } from '@/components/store/StoreBits';
import { PersonAvatar, GreetingChips } from './BirthdayBits';
import {
  type BirthdayRow, type BirthdayCardTemplate, fetchBirthdaysInMonth, logGreeting, rowToCardPerson, hasGreeting,
} from '@/lib/birthdays';

const MM_TO_PX = 96 / 25.4;

function Num({ label, value, onChange, min = 0, max = 500, step = 0.5 }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-bold text-slate-500">{label} <span className="text-slate-300">(مم)</span></span>
      <input type="number" className="input-field !py-2 !px-2.5 !text-sm" value={value} min={min} max={max} step={step} dir="ltr"
        onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export default function BirthdayPrintTab({
  supabase, design, settings, onChange, template, initialYear, initialMonth, initialScope, currentUserId, onPrinted,
}: {
  supabase: SupabaseClient;
  design: CardDesign;
  settings: CardPrintSettings;
  onChange: (s: CardPrintSettings) => void;
  template: BirthdayCardTemplate;
  initialYear: number; initialMonth: number;
  initialScope?: { church?: string; service?: string; class?: string };
  currentUserId?: string;
  onPrinted: (msg: string) => void;
}) {
  const set = (patch: Partial<CardPrintSettings>) => onChange({ ...settings, ...patch });

  // ---------- month + scope ----------
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);
  const prevMonth = () => { if (month === 1) { setMonth(12); setYear((y) => y - 1); } else setMonth((m) => m - 1); };
  const nextMonth = () => { if (month === 12) { setMonth(1); setYear((y) => y + 1); } else setMonth((m) => m + 1); };
  const scope = useScopeState();
  const [scopeSeeded, setScopeSeeded] = useState(false);
  useEffect(() => {
    if (scopeSeeded) return;
    // seed from the template scope, overridden by the query passed from the month view
    scope.setChurch(initialScope?.church ?? template.church_id);
    if (initialScope?.service ?? template.service_id) scope.setService(initialScope?.service ?? template.service_id!);
    if (initialScope?.class ?? template.class_id) scope.setClass(initialScope?.class ?? template.class_id!);
    setScopeSeeded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { churches, services, classes } = useStoreLookups(supabase, true);

  // ---------- children of the month ----------
  const [rows, setRows] = useState<BirthdayRow[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const load = useCallback(async () => {
    if (!scopeSeeded) return;
    setRows(null);
    try {
      const r = await fetchBirthdaysInMonth(supabase, year, month, { church: scope.church, service: scope.service, class: scope.class });
      // only children this template applies to
      const fit = r.filter((x) => x.church_id === template.church_id &&
        (template.service_id === null || template.service_id === x.service_id) &&
        (template.class_id === null || template.class_id === x.class_id));
      setRows(fit);
      setSelected(new Set(fit.map((x) => x.person_id)));
    } catch { setRows([]); }
  }, [supabase, year, month, scope.church, scope.service, scope.class, scopeSeeded, template]);
  useEffect(() => { load(); }, [load]);

  const toggle = (id: string) => setSelected((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allSelected = !!rows?.length && rows.every((r) => selected.has(r.person_id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set((rows ?? []).map((r) => r.person_id)));
  const selectNotPrinted = () => setSelected(new Set((rows ?? []).filter((r) => !hasGreeting(r, ['card_printed'])).map((r) => r.person_id)));

  const constantsFor = useCallback((r: BirthdayRow): CardConstantsData => {
    const ch = churches.find((c) => c.id === r.church_id);
    const sv = services.find((s) => s.id === r.service_id);
    const cl = classes.find((c) => c.id === r.class_id);
    return {
      church_name: ch?.name ?? '', church_logo_url: ch?.logo_url ?? null,
      service_name: sv?.name ?? '', service_logo_url: sv?.photo_url ?? null,
      class_name: cl?.name ?? '', class_logo_url: cl?.photo_url ?? null,
    };
  }, [churches, services, classes]);

  const printItems = useMemo(() => (rows ?? []).filter((r) => selected.has(r.person_id)), [rows, selected]);

  // ---------- layout math ----------
  const paper = paperDims(settings);
  const usableW = paper.w - settings.marginRight - settings.marginLeft;
  const usableH = paper.h - settings.marginTop - settings.marginBottom;
  const cols = Math.max(0, Math.floor((usableW + settings.gapX) / (design.width + settings.gapX)));
  const rowsPer = Math.max(0, Math.floor((usableH + settings.gapY) / (design.height + settings.gapY)));
  const perPage = cols * rowsPer;
  const pages = perPage > 0 ? Math.ceil(Math.max(printItems.length, 1) / perPage) : 0;
  const gridW = cols > 0 ? cols * design.width + (cols - 1) * settings.gapX : 0;
  const gridH = rowsPer > 0 ? rowsPer * design.height + (rowsPer - 1) * settings.gapY : 0;
  const alignH = settings.alignH ?? 'center';
  const alignV = settings.alignV ?? 'top';
  const offsetX = alignH === 'left' ? 0 : alignH === 'center' ? (usableW - gridW) / 2 : usableW - gridW;
  const offsetY = alignV === 'top' ? 0 : alignV === 'center' ? (usableH - gridH) / 2 : usableH - gridH;
  const cellLeft = (col: number) => settings.marginLeft + offsetX + col * (design.width + settings.gapX);
  const cellTop = (row: number) => settings.marginTop + offsetY + row * (design.height + settings.gapY);
  const previewScale = Math.min(330 / paper.w, 420 / paper.h);

  const printPages = useMemo(() => {
    if (perPage === 0) return [] as BirthdayRow[][];
    const out: BirthdayRow[][] = [];
    for (let i = 0; i < printItems.length; i += perPage) out.push(printItems.slice(i, i + perPage));
    return out;
  }, [printItems, perPage]);

  const [printing, setPrinting] = useState(false);
  const doPrint = () => {
    if (printItems.length === 0) return;
    setPrinting(true);
    setTimeout(async () => {
      window.print();
      setPrinting(false);
      await Promise.all(printItems.map((r) => logGreeting(supabase, r, year, 'card_printed', template.name, currentUserId).catch(() => {})));
      onPrinted(`تمت طباعة ${printItems.length} كارت ✓`);
      load();
    }, 800);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- who ---------- */}
      <section className="card">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-extrabold text-slate-600"><Cake className="h-4 w-4 text-pink-500" /> من تريد طباعة كارته؟ — مواليد الشهر</h3>
        <div className="mb-2 flex items-center justify-between rounded-2xl bg-pink-50 px-2 py-1">
          <button onClick={prevMonth} aria-label="الشهر السابق" className="rounded-xl p-1.5 hover:bg-white"><ChevronRight className="h-5 w-5 text-pink-600" /></button>
          <p className="text-sm font-extrabold text-pink-800">{ARABIC_MONTHS[month - 1]} <span className="tabular-nums">{year}</span></p>
          <button onClick={nextMonth} aria-label="الشهر التالي" className="rounded-xl p-1.5 hover:bg-white"><ChevronLeft className="h-5 w-5 text-pink-600" /></button>
        </div>
        <ScopeSelectors idPrefix="bd-print" scope={scope} churches={churches} services={services} classes={classes} />

        {rows === null ? (
          <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-pink-500" /></div>
        ) : rows.length === 0 ? (
          <p className="rounded-2xl bg-slate-50 py-6 text-center text-xs font-bold text-slate-400">لا يوجد مواليد في هذا الشهر ينطبق عليهم هذا القالب</p>
        ) : (
          <>
            <div className="mb-2 flex items-center gap-2 text-xs font-extrabold">
              <button onClick={toggleAll} className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-slate-600">
                {allSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />} الكل ({rows.length})
              </button>
              <button onClick={selectNotPrinted} className="rounded-full bg-violet-50 px-3 py-1 text-violet-700">غير المطبوعين فقط</button>
              <span className="mr-auto text-slate-400">{selected.size} مختار</span>
            </div>
            <ul className="max-h-72 divide-y divide-pink-50 overflow-y-auto rounded-2xl border border-pink-50">
              {rows.map((r) => (
                <li key={r.person_id} onClick={() => toggle(r.person_id)} className={`flex cursor-pointer items-center gap-2 px-3 py-2 ${selected.has(r.person_id) ? 'bg-pink-50/60' : ''}`}>
                  {selected.has(r.person_id) ? <CheckSquare className="h-5 w-5 shrink-0 text-pink-600" /> : <Square className="h-5 w-5 shrink-0 text-slate-300" />}
                  <PersonAvatar url={r.image_url} name={r.name} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-extrabold">{r.name}</span>
                    <span className="block text-[10px] font-bold text-slate-400">{r.birth_day} {ARABIC_MONTHS[month - 1]} · يتمّ {r.turns_age} سنة</span>
                  </span>
                  <GreetingChips greetings={r.greetings} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* ---------- saved print profiles (shared with the ID-card module) ---------- */}
      <PrintProfilesBar
        settings={settings}
        onApply={(s) => onChange(s)}
        card={{ width: design.width, height: design.height }}
        defaultScope={{ church_id: template.church_id, service_id: template.service_id, class_id: template.class_id }}
      />

      {/* ---------- paper ---------- */}
      <section className="card">
        <h3 className="mb-2 text-sm font-extrabold text-slate-600">الورقة</h3>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-bold text-slate-500">مقاس الورق</span>
            <select className="input-field !py-2 !px-2.5 !text-sm" value={settings.paper} onChange={(e) => set({ paper: e.target.value as PaperSize })}>
              {Object.entries(PAPER_SIZES).map(([v, p]) => <option key={v} value={v}>{p.label}</option>)}
              <option value="custom">مخصص…</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-bold text-slate-500">الاتجاه</span>
            <div className="flex gap-1">
              {(['portrait', 'landscape'] as PaperOrientation[]).map((o) => (
                <button key={o} onClick={() => set({ orientation: o })}
                  className={`flex-1 rounded-xl border py-2.5 text-xs font-extrabold transition ${settings.orientation === o ? 'border-pink-300 bg-pink-50 text-pink-700' : 'border-slate-200 text-slate-400'}`}>
                  {o === 'portrait' ? '↕ طولي' : '↔ عرضي'}
                </button>
              ))}
            </div>
          </label>
        </div>
        {settings.paper === 'custom' && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Num label="عرض الورقة" value={settings.customWidth} min={50} max={2000} onChange={(v) => set({ customWidth: v })} />
            <Num label="طول الورقة" value={settings.customHeight} min={50} max={2000} onChange={(v) => set({ customHeight: v })} />
          </div>
        )}
        <div className="mt-2 grid grid-cols-4 gap-2">
          <Num label="هامش أعلى" value={settings.marginTop} max={100} onChange={(v) => set({ marginTop: v })} />
          <Num label="هامش أسفل" value={settings.marginBottom} max={100} onChange={(v) => set({ marginBottom: v })} />
          <Num label="هامش يمين" value={settings.marginRight} max={100} onChange={(v) => set({ marginRight: v })} />
          <Num label="هامش يسار" value={settings.marginLeft} max={100} onChange={(v) => set({ marginLeft: v })} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Num label="مسافة أفقية" value={settings.gapX} max={100} onChange={(v) => set({ gapX: v })} />
          <Num label="مسافة رأسية" value={settings.gapY} max={100} onChange={(v) => set({ gapY: v })} />
        </div>
        <div className="mt-3 flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-xs font-extrabold text-slate-600">
            <input type="checkbox" checked={settings.cutMarks} onChange={(e) => set({ cutMarks: e.target.checked })} className="h-4 w-4 accent-pink-600" /> خطوط القص
          </label>
          <label className="flex items-center gap-2 text-xs font-extrabold text-slate-600">
            <input type="checkbox" checked={settings.centerLineV ?? false} onChange={(e) => set({ centerLineV: e.target.checked })} className="h-4 w-4 accent-pink-500" /> خط منتصف رأسي
          </label>
          <label className="flex items-center gap-2 text-xs font-extrabold text-slate-600">
            <input type="checkbox" checked={settings.centerLineH ?? false} onChange={(e) => set({ centerLineH: e.target.checked })} className="h-4 w-4 accent-pink-500" /> خط منتصف أفقي
          </label>
        </div>
        <p className="mt-2 text-[11px] font-bold text-slate-400">
          {cols} × {rowsPer} = {perPage} كارت في الصفحة · {printItems.length} كارت → {pages} صفحة
        </p>
      </section>

      {/* ---------- preview ---------- */}
      <section className="card flex flex-col items-center">
        <h3 className="mb-2 self-start text-sm font-extrabold text-slate-600">معاينة الصفحة الأولى</h3>
        <div className="relative bg-white shadow-lg" style={{ width: paper.w * previewScale, height: paper.h * previewScale }}>
          {settings.centerLineV && <div className="absolute bg-slate-300" style={{ left: (paper.w / 2) * previewScale, top: 0, width: 1, height: '100%' }} />}
          {settings.centerLineH && <div className="absolute bg-slate-300" style={{ top: (paper.h / 2) * previewScale, left: 0, height: 1, width: '100%' }} />}
          {(printPages[0] ?? []).map((r, i) => {
            const col = i % cols; const row = Math.floor(i / cols);
            return (
              <div key={r.person_id} className="absolute overflow-hidden" style={{ left: cellLeft(col) * previewScale, top: cellTop(row) * previewScale, width: design.width * previewScale, height: design.height * previewScale, outline: settings.cutMarks ? '1px solid #cbd5e1' : undefined }}>
                <CardCanvas design={design} scale={previewScale} person={rowToCardPerson(r, year)} constants={constantsFor(r)} />
              </div>
            );
          })}
          {printItems.length === 0 && <p className="absolute inset-0 flex items-center justify-center text-xs font-bold text-slate-300">اختر مخدومين للطباعة</p>}
        </div>
      </section>

      <button id="bd-print-btn" onClick={doPrint} disabled={printing || printItems.length === 0}
        className="btn-primary flex items-center justify-center gap-2 !bg-gradient-to-l !from-pink-600 !to-rose-500 !py-3.5 text-base disabled:opacity-40">
        {printing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Printer className="h-5 w-5" />}
        طباعة {printItems.length > 0 ? `(${printItems.length} كارت — ${pages} صفحة)` : ''}
      </button>
      <p className="pb-2 text-center text-[11px] font-bold text-slate-400">
        <Check className="mr-1 inline h-3 w-3" /> في نافذة الطباعة: نفس مقاس الورق ({settings.paper === 'custom' ? 'مخصص' : settings.paper})، الهوامش «بلا»، المقياس 100%. تُسجَّل «كارت مطبوع» لكل مخدوم بعد الطباعة.
      </p>

      {/* ---------- hidden print sheet ---------- */}
      {typeof document !== 'undefined' && createPortal(
        <div id="bd-cards-print-root" dir="rtl">
          <style>{`
            #bd-cards-print-root { display: none; }
            @media print {
              body > *:not(#bd-cards-print-root) { display: none !important; }
              #bd-cards-print-root { display: block !important; }
              @page { size: ${paper.w}mm ${paper.h}mm; margin: 0; }
              html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
              .bd-print-page { width: ${paper.w}mm; height: ${paper.h}mm; position: relative; overflow: hidden; page-break-after: always; break-after: page; }
              .bd-print-page:last-child { page-break-after: auto; break-after: auto; }
              .bd-print-cell { position: absolute; }
              .bd-print-centerline { position: absolute; background: #94a3b8; }
              * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
            }
          `}</style>
          {printPages.map((pageItems, pi) => (
            <div key={pi} className="bd-print-page">
              {settings.centerLineV && <div className="bd-print-centerline" style={{ left: `${paper.w / 2}mm`, top: 0, width: '0.2mm', height: `${paper.h}mm` }} />}
              {settings.centerLineH && <div className="bd-print-centerline" style={{ top: `${paper.h / 2}mm`, left: 0, height: '0.2mm', width: `${paper.w}mm` }} />}
              {pageItems.map((r, i) => {
                const col = i % cols; const row = Math.floor(i / cols);
                return (
                  <div key={r.person_id} className="bd-print-cell" style={{ left: `${cellLeft(col)}mm`, top: `${cellTop(row)}mm`, width: `${design.width}mm`, height: `${design.height}mm`, outline: settings.cutMarks ? '0.2mm solid #cbd5e1' : undefined }}>
                    <CardCanvas design={design} scale={MM_TO_PX} person={rowToCardPerson(r, year)} constants={constantsFor(r)} />
                  </div>
                );
              })}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
