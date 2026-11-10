'use client';

// ---------- Child portal — الإنجازات ----------
// ALL the achievements available to his scope (20261020120000 `catalog`), split into
//   • حققتها    — he got it at least once (date · how many times)
//   • لم أحققها — never got it (how to earn it · attendance progress bar)
// with a filter (الكل / حققتها / لم أحققها). Without the migration the page falls back to the
// previous view (earned cards + «في الطريق» bars) so nothing breaks.
// Data comes from the shared ChildProvider (child_portal_achievements RPC, realtime on user_achievements).

import { useMemo, useState } from 'react';
import { Trophy, Star, Loader2, Flag, Zap, Hand, CheckCircle2, Lock, CalendarDays, Repeat } from 'lucide-react';
import ChildShell, { useChildAchievements } from '@/components/child/ChildShell';
import { EarnedCard, ProgressBar, AchievementThumb, fmtDate } from '@/components/achievements/AchievementBits';
import { useChild } from '@/lib/child-context';
import { ruleLabel, awardModeLabel, type ChildCatalogItem } from '@/lib/achievements';
import { buildChildAchievementView, pickAchievements, howToEarn, isAchieved, type AchievementFilter } from '@/lib/child-achievements-view';

export default function ChildAchievementsPage() {
  return (
    <ChildShell>
      <Content />
    </ChildShell>
  );
}

function Content() {
  const { data } = useChildAchievements();
  if (!data) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /></div>;
  return data.catalog ? <CatalogContent catalog={data.catalog} /> : <LegacyContent />;
}

// =====================================================================
// All available · achieved · not achieved
// =====================================================================
const FILTERS: { key: AchievementFilter; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'achieved', label: 'حققتها' },
  { key: 'missing', label: 'لم أحققها' },
];

function CatalogContent({ catalog }: { catalog: ChildCatalogItem[] }) {
  const { profile } = useChild();
  const multi = (profile?.enrollments.length ?? 0) > 1;
  const view = useMemo(() => buildChildAchievementView(catalog), [catalog]);
  const [filter, setFilter] = useState<AchievementFilter>('all');
  const shown = pickAchievements(view, filter);
  const { available, achieved, missing } = view.counts;
  const countOf = (k: AchievementFilter) => (k === 'all' ? available : k === 'achieved' ? achieved : missing);

  return (
    <>
      <section className="mb-4 flex items-center gap-2">
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <Trophy className="h-5 w-5 text-amber-600" /> الإنجازات
        </h2>
        <span className="badge bg-amber-100 text-amber-700 tabular-nums">{available}</span>
      </section>

      <section id="child-ach-kpis" className="mb-4 grid grid-cols-3 gap-2">
        <div className="card border border-slate-100 bg-slate-50 !p-3 text-center">
          <p className="text-2xl font-extrabold tabular-nums text-slate-700">{available}</p>
          <p className="text-[11px] font-bold text-slate-500">متاحة لك</p>
        </div>
        <div className="card border border-emerald-100 bg-emerald-50 !p-3 text-center">
          <p className="text-2xl font-extrabold tabular-nums text-emerald-700">{achieved}</p>
          <p className="text-[11px] font-bold text-slate-500">حققتها</p>
        </div>
        <div className="card border border-amber-100 bg-amber-50 !p-3 text-center">
          <p className="text-2xl font-extrabold tabular-nums text-amber-700">{missing}</p>
          <p className="text-[11px] font-bold text-slate-500">لم أحققها</p>
        </div>
      </section>

      <div id="child-ach-filter" role="tablist" className="mb-4 flex gap-1 rounded-xl bg-slate-100 p-1">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} id={`child-ach-filter-${f.key}`}
            onClick={() => setFilter(f.key)}
            className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-extrabold transition ${filter === f.key ? 'bg-white text-amber-700 shadow-sm' : 'text-slate-500'}`}>
            {f.label} <span className="tabular-nums">({countOf(f.key)})</span>
          </button>
        ))}
      </div>

      {available === 0 ? (
        <div className="card py-10 text-center text-slate-400">
          <Trophy className="mx-auto mb-3 h-10 w-10 text-amber-200" />
          <p className="font-bold">لا توجد إنجازات متاحة لفصلك حاليًا</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="card py-10 text-center text-slate-400">
          <Trophy className="mx-auto mb-3 h-10 w-10 text-amber-200" />
          <p className="font-bold">{filter === 'achieved' ? 'لم تحقق إنجازات بعد' : 'ما شاء الله — حققت كل الإنجازات المتاحة 🎉'}</p>
          {filter === 'achieved' && <p className="mt-1 text-xs font-bold">واظب على الحضور وشارك في المناسبات!</p>}
        </div>
      ) : (
        <div id="child-ach-list" className="space-y-2">
          {shown.map((c) => <CatalogCard key={`${c.achievement_id}-${c.enrollment_id}`} c={c} showClass={multi} />)}
        </div>
      )}
    </>
  );
}

function CatalogCard({ c, showClass }: { c: ChildCatalogItem; showClass: boolean }) {
  const done = isAchieved(c);
  const showBar = c.kind === 'attendance' && c.target != null && (!done || c.block === null);
  const meta = [
    c.kind === 'attendance' ? ruleLabel({ attendance_rule: c.rule, attendance_target: c.target }) : null,
    c.event_name,
    showClass ? c.class_name : null,
  ].filter(Boolean).join(' · ');
  return (
    <div id={`child-ach-${c.achievement_id}`} data-state={done ? 'achieved' : 'missing'}
      className={`card !p-3 ${done ? 'ring-1 ring-emerald-200' : 'ring-1 ring-slate-100'}`}>
      <div className="flex items-start gap-3">
        <AchievementThumb url={c.image_url} name={c.name} size={52} muted={!done} />
        <div className="min-w-0 flex-1">
          <p className={`truncate font-extrabold ${done ? 'text-slate-800' : 'text-slate-600'}`}>{c.name}</p>
          {c.description && <p className="line-clamp-2 text-[11px] font-bold text-slate-500">{c.description}</p>}
          {meta && <p className="truncate text-[11px] font-bold text-slate-400">{meta}</p>}
          {done ? (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] font-bold text-emerald-700">
              <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" /> {c.last_awarded_at ? fmtDate(c.last_awarded_at) : ''}</span>
              {c.awards_count > 1 && <span className="flex items-center gap-1"><Repeat className="h-3 w-3" /> {c.awards_count}×</span>}
            </p>
          ) : (
            <p className="mt-0.5 text-[11px] font-bold text-amber-700">{howToEarn(c)}</p>
          )}
          {c.award_mode === 'multiple' && (
            <p className="truncate text-[10px] font-bold text-slate-400">{awardModeLabel(c)}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`badge ${done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            {done ? <CheckCircle2 className="h-3 w-3" /> : <Lock className="h-3 w-3" />} {done ? 'حققتها' : 'لم تحققها'}
          </span>
          <span className="badge bg-gold-100 text-gold-700"><Star className="h-3 w-3" /> {c.points > 0 ? `+${c.points}` : '—'}</span>
        </div>
      </div>
      {showBar && (
        <ProgressBar current={c.current ?? 0} target={c.target ?? 0}
          label={(c.current ?? 0) >= (c.target ?? 0) ? 'اكتمل الشرط 🎉' : c.rule === 'streak' ? 'حضور متتالٍ' : 'الحضور'} />
      )}
    </div>
  );
}

// =====================================================================
// Previous view — used until migration 20261020120000 is applied
// =====================================================================
function LegacyContent() {
  const { profile } = useChild();
  const { data, earnedCount } = useChildAchievements();
  const multi = (profile?.enrollments.length ?? 0) > 1;
  const totalPoints = (data?.earned ?? []).reduce((s, e) => s + e.points, 0);

  return (
    <>
      <section className="mb-4 flex items-center gap-2">
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <Trophy className="h-5 w-5 text-amber-600" /> إنجازاتي
        </h2>
        {data && <span className="badge bg-amber-100 text-amber-700 tabular-nums">{earnedCount}</span>}
      </section>

      {!data ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /></div>
      ) : (
        <>
          {/* KPIs */}
          <section className="mb-4 grid grid-cols-2 gap-3">
            <div className="card border border-amber-100 bg-amber-50 !p-3">
              <p className="text-2xl font-extrabold tabular-nums text-amber-700">{earnedCount}</p>
              <p className="text-xs font-bold text-slate-500">إنجاز حصلت عليه</p>
            </div>
            <div className="card border border-gold-100 bg-gold-50 !p-3">
              <p className="text-2xl font-extrabold tabular-nums text-gold-700">+{totalPoints}</p>
              <p className="text-xs font-bold text-slate-500">نقطة من الإنجازات</p>
            </div>
          </section>

          {/* progress */}
          {data.progress.length > 0 && (
            <section className="mb-4">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-slate-500"><Flag className="h-4 w-4" /> في الطريق</h3>
              <div id="child-ach-progress" className="space-y-2">
                {data.progress.map((p) => {
                  const done = p.current >= p.target;
                  return (
                    <div key={`${p.achievement_id}-${p.enrollment_id}`} id={`child-ach-progress-${p.achievement_id}`} className="card !p-3">
                      <div className="flex items-center gap-3">
                        <AchievementThumb url={p.image_url} name={p.name} size={48} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-extrabold">{p.name}</p>
                          <p className="truncate text-[11px] font-bold text-slate-400">
                            {ruleLabel({ attendance_rule: p.rule, attendance_target: p.target })}
                            {p.event_name ? ` · ${p.event_name}` : ''}
                            {multi ? ` · ${p.class_name}` : ''}
                            {p.awards_count > 0 ? ` · حصلت عليه ${p.awards_count}× قبل ذلك` : ''}
                          </p>
                        </div>
                        <span className="badge shrink-0 bg-gold-100 text-gold-700"><Star className="h-3 w-3" /> +{p.points}</span>
                      </div>
                      <ProgressBar current={p.current} target={p.target}
                        label={done ? 'اكتمل الشرط 🎉' : p.rule === 'streak' ? 'حضور متتالٍ' : 'الحضور'} />
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* earned */}
          <section className="mb-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-slate-500"><Trophy className="h-4 w-4" /> حصلت عليها</h3>
            {data.earned.length === 0 ? (
              <div className="card py-10 text-center text-slate-400">
                <Trophy className="mx-auto mb-3 h-10 w-10 text-amber-200" />
                <p className="font-bold">لم تحصل على إنجازات بعد</p>
                <p className="mt-1 text-xs font-bold">واظب على الحضور وشارك في المناسبات!</p>
              </div>
            ) : (
              <div id="child-ach-earned" className="space-y-2">
                {data.earned.map((e) => (
                  <EarnedCard key={e.id} id={`child-ach-earned-${e.id}`} name={e.name} image_url={e.image_url} points={e.points} awarded_at={e.awarded_at}
                    sub={[
                      e.source === 'attendance' ? 'بالحضور' : 'من خادمك',
                      e.event_name,
                      multi ? e.class_name : null,
                    ].filter(Boolean).join(' · ')}
                    action={e.source === 'attendance'
                      ? <Zap className="h-4 w-4 shrink-0 text-emerald-500" aria-label="تلقائي" />
                      : <Hand className="h-4 w-4 shrink-0 text-primary-500" aria-label="يدوي" />}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
