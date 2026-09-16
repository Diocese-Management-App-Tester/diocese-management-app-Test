'use client';

// ---------- Code TEMPLATE editor (نظام الأكواد) ----------
// Visual builder for ONE template: live preview on top (each part rendered as
// a colored chip, separators between), then the parts list (type · options ·
// reorder · remove), an «إضافة جزء» row, separator + letter-case controls and
// quick presets. Used for the default system and for every generator's own
// design. Pure/controlled: `value` in → `onChange(next)` out.

import { useMemo } from 'react';
import {
  ChevronUp, ChevronDown, Trash2, Plus, Type, Clock, CalendarDays, Dices, Church, Layers, School, Wand2,
  type LucideIcon,
} from 'lucide-react';
import {
  type CodeTemplate, type CodePart, type PartType, type DateFormat, type RandomCharset, type CodeCase,
  type ScopeAbbreviations, type CodeContext,
  PART_TYPE_LABELS, PART_TYPE_HINTS, DATE_FORMAT_LABELS, RANDOM_CHARSET_LABELS, CASE_LABELS, TEMPLATE_PRESETS,
  MAX_PARTS, MAX_TEXT_LENGTH, MAX_SEPARATOR_LENGTH, MAX_ABBREVIATION_LENGTH, MIN_RANDOM, MAX_RANDOM,
  newPart, sanitizeSegment, renderPart, applyCase, isScopePart,
} from '@/lib/code-templates';

export const PART_ICONS: Record<PartType, LucideIcon> = {
  text: Type, timestamp: Clock, date: CalendarDays, random: Dices, church: Church, service: Layers, class: School,
};

/** chip colors per part type — same in the preview and in the list */
export const PART_TONES: Record<PartType, { chip: string; icon: string }> = {
  text:      { chip: 'bg-slate-100 text-slate-700 border-slate-200',        icon: 'text-slate-500' },
  timestamp: { chip: 'bg-primary-50 text-primary-700 border-primary-200',   icon: 'text-primary-600' },
  date:      { chip: 'bg-sky-50 text-sky-700 border-sky-200',               icon: 'text-sky-600' },
  random:    { chip: 'bg-violet-50 text-violet-700 border-violet-200',      icon: 'text-violet-600' },
  church:    { chip: 'bg-amber-50 text-amber-700 border-amber-200',         icon: 'text-amber-600' },
  service:   { chip: 'bg-emerald-50 text-emerald-700 border-emerald-200',   icon: 'text-emerald-600' },
  class:     { chip: 'bg-rose-50 text-rose-700 border-rose-200',            icon: 'text-rose-600' },
};

const PART_TYPES: PartType[] = ['text', 'timestamp', 'date', 'random', 'church', 'service', 'class'];
const DATE_FORMATS = Object.keys(DATE_FORMAT_LABELS) as DateFormat[];
const CHARSETS = Object.keys(RANDOM_CHARSET_LABELS) as RandomCharset[];
const CASES = Object.keys(CASE_LABELS) as CodeCase[];

const SAMPLE_SCOPES: ScopeAbbreviations = { churches: { s: 'STM' }, services: { s: 'SS' }, classes: { s: 'C1' } };
const SAMPLE_CTX: CodeContext = { churchId: 's', serviceId: 's', classId: 's', now: 1702655732293 };

/** deterministic sample text of one part for the preview */
function samplePart(p: CodePart, scopes: ScopeAbbreviations, ctx: CodeContext): string {
  if (p.type === 'random') {
    const alphabet = p.charset === 'digits' ? '0123456789' : p.charset === 'hex' ? '0123456789ABCDEF'
      : p.charset === 'letters' ? 'ABCDEFGHJKLMNPQRSTUVWXYZ' : 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < p.length; i++) s += alphabet[(i * 7 + 3) % alphabet.length];
    return s;
  }
  return renderPart(p, ctx, scopes);
}

/** Live preview: colored chips + separators */
export function TemplatePreview({
  template, scopes, ctx, id, compact,
}: { template: CodeTemplate; scopes?: ScopeAbbreviations; ctx?: CodeContext; id?: string; compact?: boolean }) {
  const sc = scopes ?? SAMPLE_SCOPES;
  const cx = { ...SAMPLE_CTX, ...(ctx ?? {}) };
  const segs = template.parts
    .map((p) => ({ p, s: applyCase(samplePart(p, sc, cx), template.case) }))
    .filter((x) => x.s.length > 0);
  if (segs.length === 0) {
    return <p id={id} className="text-center text-xs font-bold text-slate-400">أضف جزءاً واحداً على الأقل</p>;
  }
  return (
    <div id={id} dir="ltr" className={`flex flex-wrap items-center gap-y-1 ${compact ? 'text-xs' : 'justify-center text-sm'}`}>
      {segs.map((x, i) => (
        <span key={i} className="flex items-center">
          {i > 0 && template.separator && (
            <span className="px-0.5 font-mono font-extrabold text-slate-400">{template.separator}</span>
          )}
          <span className={`rounded-lg border px-1.5 py-0.5 font-mono font-extrabold ${PART_TONES[x.p.type].chip}`}>
            {x.s}
          </span>
        </span>
      ))}
    </div>
  );
}

/** the owner's first real abbreviations (for a realistic preview) — undefined when he has none */
function previewScopesOf(scopes?: ScopeAbbreviations): { scopes: ScopeAbbreviations; ctx: CodeContext } | undefined {
  if (!scopes) return undefined;
  const first = (m: Record<string, string>) => Object.entries(m)[0];
  const c = first(scopes.churches), s = first(scopes.services), k = first(scopes.classes);
  if (!c && !s && !k) return undefined;
  return {
    scopes: {
      churches: c ? { [c[0]]: c[1] } : SAMPLE_SCOPES.churches,
      services: s ? { [s[0]]: s[1] } : SAMPLE_SCOPES.services,
      classes: k ? { [k[0]]: k[1] } : SAMPLE_SCOPES.classes,
    },
    ctx: { churchId: c ? c[0] : 's', serviceId: s ? s[0] : 's', classId: k ? k[0] : 's' },
  };
}

function PartRow({
  part: p, index: i, count, idPrefix, onPatch, onMove, onRemove,
}: {
  part: CodePart; index: number; count: number; idPrefix: string;
  onPatch: (p: CodePart) => void; onMove: (dir: -1 | 1) => void; onRemove: () => void;
}) {
  const Icon = PART_ICONS[p.type];
  const tone = PART_TONES[p.type];
  return (
    <li id={`${idPrefix}-part-${i}`} className="rounded-2xl border border-indigo-100 bg-white p-2.5">
      <div className="flex items-center gap-2">
        <span className={`shrink-0 rounded-xl border p-1.5 ${tone.chip}`}>
          <Icon className={`h-4 w-4 ${tone.icon}`} />
        </span>
        <select
          aria-label="نوع الجزء"
          className="input-field !py-1.5 !px-2 flex-1 text-xs font-bold"
          value={p.type}
          onChange={(e) => onPatch(newPart(e.target.value as PartType))}
        >
          {PART_TYPES.map((t) => <option key={t} value={t}>{PART_TYPE_LABELS[t]}</option>)}
        </select>
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" onClick={() => onMove(-1)} disabled={i === 0} aria-label="لأعلى"
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30">
            <ChevronUp className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={i === count - 1} aria-label="لأسفل"
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30">
            <ChevronDown className="h-4 w-4" />
          </button>
          <button type="button" onClick={onRemove} aria-label="حذف الجزء" className="rounded-lg p-1 text-red-500 hover:bg-red-50">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* per-type options */}
      <div className="mt-2 flex flex-wrap items-center gap-2 pr-9">
        {p.type === 'text' && (
          <input
            dir="ltr"
            aria-label="النص"
            className="input-field !py-1.5 !px-2 w-40 font-mono text-sm font-extrabold"
            value={p.value}
            maxLength={MAX_TEXT_LENGTH}
            placeholder="P"
            onChange={(e) => onPatch({ type: 'text', value: sanitizeSegment(e.target.value, MAX_TEXT_LENGTH) })}
          />
        )}
        {p.type === 'date' && (
          <select aria-label="صيغة التاريخ" className="input-field !py-1.5 !px-2 flex-1 text-xs font-bold" value={p.format}
            onChange={(e) => onPatch({ type: 'date', format: e.target.value as DateFormat })}>
            {DATE_FORMATS.map((f) => <option key={f} value={f}>{DATE_FORMAT_LABELS[f]}</option>)}
          </select>
        )}
        {p.type === 'random' && (
          <>
            <label className="flex items-center gap-1 text-xs font-bold text-slate-500">
              الطول
              <input
                type="number" inputMode="numeric" aria-label="طول الجزء العشوائي"
                className="input-field !py-1.5 !px-2 w-16 text-center text-sm font-extrabold"
                min={MIN_RANDOM} max={MAX_RANDOM} value={p.length}
                onChange={(e) => {
                  const n = Math.min(MAX_RANDOM, Math.max(MIN_RANDOM, Math.round(Number(e.target.value) || MIN_RANDOM)));
                  onPatch({ ...p, length: n });
                }}
              />
            </label>
            <select aria-label="نوع الحروف" className="input-field !py-1.5 !px-2 flex-1 text-xs font-bold" value={p.charset}
              onChange={(e) => onPatch({ ...p, charset: e.target.value as RandomCharset })}>
              {CHARSETS.map((c) => <option key={c} value={c}>{RANDOM_CHARSET_LABELS[c]}</option>)}
            </select>
          </>
        )}
        {isScopePart(p) && (
          <label className="flex flex-1 items-center gap-1.5 text-xs font-bold text-slate-500">
            <span className="shrink-0">إن لم يوجد اختصار:</span>
            <input
              dir="ltr"
              aria-label="نص بديل"
              className="input-field !py-1.5 !px-2 flex-1 font-mono text-sm font-extrabold"
              value={p.fallback}
              maxLength={MAX_ABBREVIATION_LENGTH}
              placeholder="يُحذف الجزء"
              onChange={(e) => onPatch({ ...p, fallback: sanitizeSegment(e.target.value, MAX_ABBREVIATION_LENGTH) })}
            />
          </label>
        )}
        <span className="basis-full text-[10px] font-bold text-slate-400">{PART_TYPE_HINTS[p.type]}</span>
      </div>
    </li>
  );
}

export default function TemplateEditor({
  value, onChange, idPrefix = 'tpl', scopes, showPresets = true,
}: {
  value: CodeTemplate;
  onChange: (next: CodeTemplate) => void;
  idPrefix?: string;
  /** real abbreviations (so the preview shows the owner's own) — sample when omitted */
  scopes?: ScopeAbbreviations;
  showPresets?: boolean;
}) {
  const parts = value.parts;
  const setParts = (next: CodePart[]) => onChange({ ...value, parts: next });
  const patchPart = (i: number, p: CodePart) => setParts(parts.map((x, k) => (k === i ? p : x)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= parts.length) return;
    const n = [...parts]; [n[i], n[j]] = [n[j], n[i]]; setParts(n);
  };
  const remove = (i: number) => setParts(parts.filter((_, k) => k !== i));
  const add = (type: PartType) => { if (parts.length < MAX_PARTS) setParts([...parts, newPart(type)]); };

  const preview = useMemo(() => previewScopesOf(scopes), [scopes]);
  const hasScopeParts = parts.some(isScopePart);

  return (
    <div className="space-y-3">
      {/* ---- preview ---- */}
      <div className="rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/40 px-3 py-3">
        <p className="mb-2 text-center text-[11px] font-bold text-slate-400">مثال على الكود الناتج</p>
        <TemplatePreview id={`${idPrefix}-preview`} template={value} scopes={preview?.scopes} ctx={preview?.ctx} />
        {hasScopeParts && !preview && (
          <p className="mt-2 text-center text-[10px] font-bold text-amber-600">
            STM · SS · C1 أمثلة — حدّد الاختصارات الحقيقية في قسم «اختصارات الكنائس والخدمات والفصول»
          </p>
        )}
      </div>

      {/* ---- parts ---- */}
      <ul id={`${idPrefix}-parts`} className="space-y-2">
        {parts.map((p, i) => (
          <PartRow
            key={i} part={p} index={i} count={parts.length} idPrefix={idPrefix}
            onPatch={(np) => patchPart(i, np)} onMove={(d) => move(i, d)} onRemove={() => remove(i)}
          />
        ))}
      </ul>

      {/* ---- add part ---- */}
      <div>
        <p className="mb-1.5 flex items-center gap-1 text-[11px] font-bold text-slate-500">
          <Plus className="h-3.5 w-3.5" /> إضافة جزء
          {parts.length >= MAX_PARTS && <span className="text-amber-600">— الحد الأقصى {MAX_PARTS} أجزاء</span>}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {PART_TYPES.map((t) => {
            const Icon = PART_ICONS[t];
            return (
              <button
                key={t}
                id={`${idPrefix}-add-${t}`}
                type="button"
                disabled={parts.length >= MAX_PARTS}
                onClick={() => add(t)}
                className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-extrabold transition hover:brightness-95 disabled:opacity-40 ${PART_TONES[t].chip}`}
              >
                <Icon className="h-3.5 w-3.5" /> {PART_TYPE_LABELS[t]}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- separator + case ---- */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className="mb-1 block text-[11px] font-bold text-slate-500">الفاصل بين الأجزاء</span>
          <div className="flex gap-1">
            {['-', '_', '.', ''].map((s) => (
              <button
                key={s || 'none'}
                id={`${idPrefix}-sep-${s || 'none'}`}
                type="button"
                onClick={() => onChange({ ...value, separator: s })}
                className={`h-9 flex-1 rounded-xl border font-mono text-sm font-extrabold ${
                  value.separator === s ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-500'
                }`}
              >
                {s || 'بدون'}
              </button>
            ))}
            <input
              dir="ltr"
              aria-label="فاصل مخصص"
              className="input-field !py-1.5 !px-2 w-12 text-center font-mono text-sm font-extrabold"
              value={value.separator}
              maxLength={MAX_SEPARATOR_LENGTH}
              onChange={(e) => onChange({ ...value, separator: sanitizeSegment(e.target.value, MAX_SEPARATOR_LENGTH) })}
            />
          </div>
        </div>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold text-slate-500">حالة الحروف</span>
          <select className="input-field !py-2 text-xs font-bold" value={value.case}
            onChange={(e) => onChange({ ...value, case: e.target.value as CodeCase })}>
            {CASES.map((c) => <option key={c} value={c}>{CASE_LABELS[c]}</option>)}
          </select>
        </label>
      </div>

      {/* ---- presets ---- */}
      {showPresets && (
        <div>
          <p className="mb-1.5 flex items-center gap-1 text-[11px] font-bold text-slate-500">
            <Wand2 className="h-3.5 w-3.5" /> قوالب جاهزة
          </p>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATE_PRESETS.map((pr) => (
              <button
                key={pr.key}
                id={`${idPrefix}-preset-${pr.key}`}
                type="button"
                onClick={() => onChange({ ...pr.template, parts: pr.template.parts.map((p) => ({ ...p })) })}
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
              >
                {pr.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
