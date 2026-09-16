'use client';

// ---------- تخصيص التطبيق → نظام الأكواد ----------
// The owner designs how every code the app generates looks:
//   1. النظام الافتراضي — ONE template (parts joined by a separator, e.g.
//      P-1702655732293) followed by every generator set to «الافتراضي».
//   2. المولّدات — each generator (كود المخدوم · كود الخادم · كود منتج
//      المتجر · كود تذكرة المناسبة) picks: النظام الافتراضي · تصميم خاص
//      (its own template) · الطريقة الأصلية (the app's built-in generator).
//   3. اختصارات الكنائس والخدمات والفصول — the abbreviation each scope
//      contributes when a template contains a church / service / class part.
// Saving writes app_settings.codes (migration 0040, realtime → all devices).

import { useEffect, useMemo, useState } from 'react';
import {
  Hash, Info, ChevronDown, ChevronUp, Church, Layers, School, Search, Sparkles, Settings2, History, Wand2, RotateCcw,
  type LucideIcon,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { OwnerGate } from '@/components/ModuleGate';
import { EditorHeader, SaveBar } from '@/components/customize/shared';
import TemplateEditor, { TemplatePreview } from '@/components/customize/TemplateEditor';
import { useCustomization } from '@/lib/customization-context';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import type { Church as ChurchRow, Service, ClassRoom } from '@/lib/types';
import {
  CODE_GENERATORS, DEFAULT_TEMPLATE, MODE_LABELS, MAX_ABBREVIATION_LENGTH,
  normalizeCodes, sanitizeSegment, usesScopes, describeTemplate, legacyCode,
  type CodesConfig, type CodeKind, type CodeTemplate, type GeneratorMode, type ScopeAbbreviations,
} from '@/lib/code-templates';

const MODE_ICONS: Record<GeneratorMode, LucideIcon> = { default: Sparkles, custom: Settings2, legacy: History };
const MODE_HINTS: Record<GeneratorMode, string> = {
  default: 'يتبع النظام الافتراضي أعلاه',
  custom: 'تصميم مستقل لهذا الكود فقط',
  legacy: 'كما كان التطبيق يولّده قبل هذا النظام',
};
const MODE_BADGE: Record<GeneratorMode, string> = {
  default: 'bg-primary-50 text-primary-700',
  custom: 'bg-violet-50 text-violet-700',
  legacy: 'bg-slate-100 text-slate-500',
};

/** a generator's own template starts as a copy of the default */
const cloneTemplate = (t: CodeTemplate): CodeTemplate => ({ ...t, parts: t.parts.map((p) => ({ ...p })) });

interface AbbrRow { id: string; name: string; sub: string }

function AbbrGroup({
  icon: Icon, tone, title, idPrefix, rows, values, onChange,
}: {
  icon: LucideIcon; tone: string; title: string; idPrefix: string;
  rows: AbbrRow[]; values: Record<string, string>; onChange: (id: string, v: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-3">
      <p className={`mb-1 flex items-center gap-1 text-xs font-extrabold ${tone}`}>
        <Icon className="h-3.5 w-3.5" /> {title}
      </p>
      <ul className="divide-y divide-indigo-50 rounded-2xl border border-indigo-100 bg-white">
        {rows.map((r) => (
          <li key={r.id} id={`${idPrefix}-${r.id}`} className="flex items-center gap-2 px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold">{r.name}</span>
              {r.sub && <span className="block truncate text-[10px] font-bold text-slate-400">{r.sub}</span>}
            </span>
            <input
              dir="ltr"
              aria-label={`اختصار ${r.name}`}
              className={`input-field !py-1.5 !px-2 w-24 text-center font-mono text-sm font-extrabold ${values[r.id] ? '!border-primary-300 !bg-primary-50/40' : ''}`}
              value={values[r.id] ?? ''}
              maxLength={MAX_ABBREVIATION_LENGTH}
              placeholder="—"
              onChange={(e) => onChange(r.id, e.target.value)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function CustomizeCodesPage() {
  const { profile } = useAuth();
  const { codes, codesCustomized, loading, saveCodes, resetCodes } = useCustomization();
  const [supabase] = useState(() => createClient());

  const [draft, setDraft] = useState<CodesConfig>(codes);
  const [pristine, setPristine] = useState(JSON.stringify(codes));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [openGen, setOpenGen] = useState<CodeKind | null>(null);
  const [scopesOpen, setScopesOpen] = useState(false);
  const [scopeQ, setScopeQ] = useState('');

  // scope rows for the abbreviations section
  const [churches, setChurches] = useState<ChurchRow[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  useEffect(() => {
    if (profile?.status !== 'approved') return;
    (async () => {
      const [{ data: ch }, { data: sv }, { data: cl }] = await Promise.all([
        supabase.from('churches').select('*').order('name'),
        supabase.from('services').select('*').order('name'),
        supabase.from('classes').select('*').order('name'),
      ]);
      setChurches(ch ?? []); setServices(sv ?? []); setClasses(cl ?? []);
    })();
  }, [profile?.status, supabase]);

  // follow remote changes while nothing is edited locally
  useEffect(() => {
    const remote = JSON.stringify(codes);
    if (JSON.stringify(draft) === pristine) setDraft(codes);
    setPristine(remote);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codes]);

  const dirty = JSON.stringify(draft) !== pristine;
  const touch = () => setSaved(false);

  const setDefault = (t: CodeTemplate) => { touch(); setDraft((d) => ({ ...d, default: t })); };
  const withMode = (d: CodesConfig, kind: CodeKind, mode: GeneratorMode) => {
    const cur = d.generators[kind] ?? { mode: 'legacy' as GeneratorMode };
    const next = { ...cur, mode };
    if (mode === 'custom' && (!next.template || next.template.parts.length === 0)) next.template = cloneTemplate(d.default);
    return next;
  };
  const setMode = (kind: CodeKind, mode: GeneratorMode) => {
    touch();
    setDraft((d) => ({ ...d, generators: { ...d.generators, [kind]: withMode(d, kind, mode) } }));
  };
  const setAllModes = (mode: GeneratorMode) => {
    touch();
    setDraft((d) => {
      const generators = { ...d.generators };
      for (const g of CODE_GENERATORS) generators[g.key] = withMode(d, g.key, mode);
      return { ...d, generators };
    });
  };
  const setGenTemplate = (kind: CodeKind, t: CodeTemplate) => {
    touch();
    setDraft((d) => ({ ...d, generators: { ...d.generators, [kind]: { ...d.generators[kind], template: t } } }));
  };
  const setAbbr = (group: keyof ScopeAbbreviations, id: string, v: string) => {
    touch();
    setDraft((d) => {
      const map = { ...d.scopes[group] };
      const s = sanitizeSegment(v, MAX_ABBREVIATION_LENGTH);
      if (s) map[id] = s; else delete map[id];
      return { ...d, scopes: { ...d.scopes, [group]: map } };
    });
  };

  const allModes = CODE_GENERATORS.map((g) => draft.generators[g.key]?.mode ?? 'legacy');
  const uniformMode: GeneratorMode | null = allModes.every((m) => m === allModes[0]) ? allModes[0] : null;

  const anyScopeParts = useMemo(() => {
    if (usesScopes(draft.default) && allModes.some((m) => m === 'default')) return true;
    return CODE_GENERATORS.some((g) => {
      const gc = draft.generators[g.key];
      return gc?.mode === 'custom' && gc.template && usesScopes(gc.template);
    });
  }, [draft, allModes]);

  const abbrCount = Object.keys(draft.scopes.churches).length
    + Object.keys(draft.scopes.services).length + Object.keys(draft.scopes.classes).length;

  const validate = (): string | null => {
    if (draft.default.parts.length === 0) return 'النظام الافتراضي يحتاج جزءاً واحداً على الأقل';
    for (const g of CODE_GENERATORS) {
      const gc = draft.generators[g.key];
      if (gc?.mode === 'custom' && (!gc.template || gc.template.parts.length === 0)) return `«${g.label}»: التصميم الخاص فارغ`;
    }
    return null;
  };

  const save = async () => {
    const v = validate();
    if (v) { setError(v); return; }
    setSaving(true); setError('');
    const cleaned = normalizeCodes(draft);
    const err = await saveCodes(cleaned);
    setSaving(false);
    if (err) { setError(`تعذر الحفظ — تأكد من تشغيل الترحيل 0040 (${err})`); return; }
    setDraft(cleaned);
    setPristine(JSON.stringify(cleaned));
    setSaved(true);
  };

  const reset = async () => {
    if (!confirm('إرجاع كل الأكواد إلى الطريقة الأصلية وحذف الاختصارات؟')) return;
    setSaving(true); setError('');
    const err = await resetCodes();
    setSaving(false);
    if (err) { setError(`تعذر الحفظ — تأكد من تشغيل الترحيل 0040 (${err})`); return; }
    setSaved(true);
  };

  // abbreviation rows (filtered)
  const q = scopeQ.trim();
  const churchById = useMemo(() => new Map(churches.map((c) => [c.id, c.name])), [churches]);
  const serviceById = useMemo(() => new Map(services.map((s) => [s.id, s.name])), [services]);
  const match = (name: string, abbr: string | undefined) =>
    !q || name.includes(q) || (abbr ?? '').toLowerCase().includes(q.toLowerCase());

  return (
    <AppShell>
      <OwnerGate>
        <EditorHeader back="/owner/customize" icon={Hash} title="نظام الأكواد" badge={codesCustomized ? 'مخصص' : undefined} />

        <p className="mb-4 flex items-start gap-2 rounded-2xl bg-indigo-50 px-4 py-3 text-xs font-bold text-indigo-700">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            صمّم شكل الأكواد التي يولّدها التطبيق: أجزاء متتابعة (بادئة · الوقت · تاريخ · عشوائي · اختصار الكنيسة أو
            الخدمة أو الفصل) بينها فاصل. يمكن تطبيق <b>نظام واحد على الكل</b> أو تصميم كل كود على حدة أو إبقاء{' '}
            <b>الطريقة الأصلية</b>. الأكواد المولّدة سابقاً لا تتغير.
          </span>
        </p>

        {loading ? null : (
          <>
            {/* ================= 1. default system ================= */}
            <section id="codes-default" className="card mb-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-extrabold">
                  <Sparkles className="h-4 w-4 text-primary-600" /> النظام الافتراضي
                </h3>
                <button
                  id="codes-default-reset"
                  type="button"
                  onClick={() => setDefault(cloneTemplate(DEFAULT_TEMPLATE))}
                  className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-50"
                >
                  <RotateCcw className="h-3 w-3" /> P + الوقت
                </button>
              </div>
              <TemplateEditor value={draft.default} onChange={setDefault} idPrefix="codes-default" scopes={draft.scopes} />
            </section>

            {/* ================= 2. generators ================= */}
            <section id="codes-generators" className="mb-4">
              <div className="mb-2 flex items-center justify-between px-1">
                <h3 className="flex items-center gap-2 text-sm font-extrabold">
                  <Settings2 className="h-4 w-4 text-primary-600" /> المولّدات
                </h3>
                <div className="flex items-center gap-1 text-[11px] font-bold text-slate-500">
                  الكل:
                  {(['default', 'legacy'] as GeneratorMode[]).map((m) => (
                    <button
                      key={m}
                      id={`codes-all-${m}`}
                      type="button"
                      onClick={() => setAllModes(m)}
                      className={`rounded-full border px-2 py-0.5 ${
                        uniformMode === m ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {MODE_LABELS[m]}
                    </button>
                  ))}
                </div>
              </div>

              <ul className="card !p-0 divide-y divide-indigo-50 overflow-hidden">
                {CODE_GENERATORS.map((g) => {
                  const gc = draft.generators[g.key] ?? { mode: 'legacy' as GeneratorMode };
                  const mode = gc.mode;
                  const open = openGen === g.key;
                  const effective: CodeTemplate | null =
                    mode === 'legacy' ? null : mode === 'custom' ? (gc.template ?? draft.default) : draft.default;
                  return (
                    <li key={g.key} id={`codes-gen-${g.key}`}>
                      <button
                        type="button"
                        onClick={() => setOpenGen(open ? null : g.key)}
                        className="flex w-full items-center gap-3 px-3 py-3 text-right hover:bg-indigo-50/40"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-extrabold">{g.label}</span>
                            <span className={`badge ${MODE_BADGE[mode]}`}>{MODE_LABELS[mode]}</span>
                            {g.serverSide && <span className="badge bg-amber-50 text-amber-700">قاعدة البيانات</span>}
                          </span>
                          <span className="mt-1.5 block">
                            {effective ? (
                              <TemplatePreview template={effective} compact />
                            ) : (
                              <span dir="ltr" className="inline-block rounded-lg border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-xs font-extrabold text-slate-600">
                                {g.legacyExample}
                              </span>
                            )}
                          </span>
                        </span>
                        {open ? <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />}
                      </button>

                      {open && (
                        <div className="border-t border-indigo-50 bg-slate-50/60 px-3 py-3">
                          <p className="mb-1 text-[11px] font-bold text-slate-500">{g.desc}</p>
                          <p className="mb-3 text-[11px] font-bold text-slate-400">يُستخدم في: {g.where}</p>

                          <div className="mb-2 grid grid-cols-3 gap-1.5">
                            {(['default', 'custom', 'legacy'] as GeneratorMode[]).map((m) => {
                              const Icon = MODE_ICONS[m];
                              const active = mode === m;
                              return (
                                <button
                                  key={m}
                                  id={`codes-gen-${g.key}-mode-${m}`}
                                  type="button"
                                  onClick={() => setMode(g.key, m)}
                                  className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2 text-[11px] font-extrabold transition ${
                                    active ? 'border-primary-400 bg-white text-primary-700 shadow-sm' : 'border-slate-200 bg-white/60 text-slate-500 hover:bg-white'
                                  }`}
                                >
                                  <Icon className="h-4 w-4" />
                                  {MODE_LABELS[m]}
                                </button>
                              );
                            })}
                          </div>
                          <p className="mb-3 text-center text-[11px] font-bold text-slate-400">{MODE_HINTS[mode]}</p>

                          {mode === 'custom' && (
                            <TemplateEditor
                              value={gc.template ?? cloneTemplate(draft.default)}
                              onChange={(t) => setGenTemplate(g.key, t)}
                              idPrefix={`codes-gen-${g.key}`}
                              scopes={draft.scopes}
                            />
                          )}
                          {mode === 'default' && (
                            <p className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-500">{describeTemplate(draft.default)}</p>
                          )}
                          {mode === 'legacy' && (
                            <p dir="ltr" className="rounded-xl bg-white px-3 py-2 text-center font-mono text-sm font-extrabold text-slate-600">
                              {legacyCode(g.key)}
                            </p>
                          )}
                          {g.serverSide && (
                            <p className="mt-2 text-[10px] font-bold text-amber-600">
                              هذا الكود تولّده قاعدة البيانات مباشرة — يتطلب تشغيل الترحيل 0040.
                            </p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* ================= 3. scope abbreviations ================= */}
            <section id="codes-scopes" className="card mb-2 !p-0 overflow-hidden">
              <button type="button" onClick={() => setScopesOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-right">
                <span className="rounded-xl bg-amber-50 p-2"><Church className="h-5 w-5 text-amber-600" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-extrabold">اختصارات الكنائس والخدمات والفصول</span>
                  <span className="block text-[11px] font-bold text-slate-400">
                    {abbrCount ? `${abbrCount} اختصار محدد` : 'لا اختصارات بعد'}
                    {anyScopeParts && !abbrCount ? ' — التصميم يستخدم اختصارات، حدّدها هنا' : ''}
                  </span>
                </span>
                {scopesOpen ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
              </button>

              {scopesOpen && (
                <div className="border-t border-indigo-50 px-3 py-3">
                  <p className="mb-3 text-[11px] font-bold text-slate-500">
                    الاختصار يُستخدم مكان جزء «اختصار الكنيسة / الخدمة / الفصل» في القالب — حروف وأرقام لاتينية فقط
                    (حتى {MAX_ABBREVIATION_LENGTH}). كنيسة أو خدمة أو فصل بدون اختصار يُستبدل بالنص البديل أو يُحذف الجزء.
                  </p>
                  <div className="relative mb-3">
                    <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="codes-scope-search"
                      className="input-field !pr-9 text-sm"
                      placeholder="ابحث عن كنيسة أو خدمة أو فصل…"
                      value={scopeQ}
                      onChange={(e) => setScopeQ(e.target.value)}
                    />
                  </div>

                  <AbbrGroup
                    icon={Church} tone="text-amber-600" title="الكنائس" idPrefix="abbr-church"
                    rows={churches.filter((c) => match(c.name, draft.scopes.churches[c.id])).map((c) => ({ id: c.id, name: c.name, sub: '' }))}
                    values={draft.scopes.churches}
                    onChange={(id, v) => setAbbr('churches', id, v)}
                  />
                  <AbbrGroup
                    icon={Layers} tone="text-emerald-600" title="الخدمات" idPrefix="abbr-service"
                    rows={services.filter((s) => match(s.name, draft.scopes.services[s.id])).map((s) => ({
                      id: s.id, name: s.name, sub: churchById.get(s.church_id) ?? '',
                    }))}
                    values={draft.scopes.services}
                    onChange={(id, v) => setAbbr('services', id, v)}
                  />
                  <AbbrGroup
                    icon={School} tone="text-rose-600" title="الفصول" idPrefix="abbr-class"
                    rows={classes.filter((c) => match(c.name, draft.scopes.classes[c.id])).map((c) => ({
                      id: c.id, name: c.name,
                      sub: [serviceById.get(c.service_id), churchById.get(c.church_id)].filter(Boolean).join(' — '),
                    }))}
                    values={draft.scopes.classes}
                    onChange={(id, v) => setAbbr('classes', id, v)}
                  />
                </div>
              )}
            </section>

            <p className="flex items-center gap-1 px-1 text-[11px] font-bold text-slate-400">
              <Wand2 className="h-3.5 w-3.5" /> الأكواد المولّدة سابقاً تبقى كما هي — التصميم يسري على الأكواد الجديدة فقط.
            </p>
          </>
        )}

        <SaveBar dirty={dirty} saving={saving} saved={saved} customized={codesCustomized} onSave={save} onReset={reset} error={error} />
      </OwnerGate>
    </AppShell>
  );
}
