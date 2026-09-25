'use client';

// ---------- التحقق عند البوابة — scan a QR / type a code / search a person ----------
// Sends the code to `access_check` for the selected event and shows the
// DecisionCard. Every check is logged (access_log) unless «تجربة» is on.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Loader2, Keyboard, ScanLine, FlaskConical, Hash, Volume2, VolumeX } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import QrScanner from '@/components/store/QrScanner';
import { PersonAvatar } from '@/components/CallFeedback';
import { accessCheck, searchPersonsForAccess, type AccessCheckResult, type AccessEvent, type AccessSearchHit, type RuleLookups } from '@/lib/access';
import { DecisionCard } from '@/components/access/AccessBits';

type Mode = 'scan' | 'search';

/** Two short tones — no asset needed (WebAudio). */
function beep(ok: boolean) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine';
    o.frequency.value = ok ? 880 : 220;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (ok ? 0.25 : 0.5));
    o.start(); o.stop(ctx.currentTime + (ok ? 0.25 : 0.5));
    setTimeout(() => ctx.close(), 700);
  } catch { /* no audio */ }
}

export default function CheckPanel({ event, lookups, onChecked }: { event: AccessEvent; lookups: RuleLookups; onChecked?: (r: AccessCheckResult) => void }) {
  const [supabase] = useState(() => createClient());
  const [mode, setMode] = useState<Mode>('scan');
  const [code, setCode] = useState('');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<AccessSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AccessCheckResult | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [sound, setSound] = useState(true);
  const codeRef = useRef<HTMLInputElement>(null);

  const run = useCallback(async (target: { code?: string; personId?: string }) => {
    setBusy(true); setError('');
    try {
      const r = await accessCheck(supabase, event.id, target, !dryRun);
      setResult(r);
      if (sound) beep(r.granted);
      if (navigator.vibrate) navigator.vibrate(r.granted ? 80 : [120, 60, 120]);
      onChecked?.(r);
    } catch (e) {
      const msg = (e as { message?: string }).message ?? '';
      setError(msg.includes('event_not_found') ? 'بوابة الدخول غير متاحة لنطاقك' : msg.includes('forbidden') ? 'ليس لديك صلاحية التحقق' : 'تعذر التحقق، حاول مجدداً');
    } finally {
      setBusy(false);
    }
  }, [supabase, event.id, dryRun, sound, onChecked]);

  // live search
  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) { setHits([]); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await searchPersonsForAccess(supabase, s, 20);
        if (!cancelled) setHits(res);
      } catch { if (!cancelled) setHits([]); }
      finally { if (!cancelled) setSearching(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, supabase]);

  const submitCode = (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim();
    if (!c) return;
    run({ code: c });
    setCode('');
    codeRef.current?.focus();
  };

  return (
    <div className="space-y-3">
      {/* mode + options */}
      <div className="flex items-center gap-2">
        <div className="grid flex-1 grid-cols-2 gap-1 rounded-2xl bg-emerald-50 p-1">
          {([{ key: 'scan' as Mode, label: 'مسح / كود', icon: ScanLine }, { key: 'search' as Mode, label: 'بحث بالاسم', icon: Search }]).map((t) => {
            const Icon = t.icon;
            const active = mode === t.key;
            return (
              <button key={t.key} id={`access-mode-${t.key}`} type="button" onClick={() => setMode(t.key)} aria-pressed={active}
                className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-extrabold transition ${active ? 'bg-white text-emerald-700 shadow' : 'text-slate-500'}`}>
                <Icon className="h-4 w-4" /> {t.label}
              </button>
            );
          })}
        </div>
        <button type="button" id="access-sound" onClick={() => setSound((v) => !v)} aria-pressed={sound} title="صوت النتيجة"
          className={`rounded-xl p-2 ${sound ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
          {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </button>
        <button type="button" id="access-dry-run" onClick={() => setDryRun((v) => !v)} aria-pressed={dryRun} title="تجربة بدون تسجيل في السجل"
          className={`flex items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-extrabold ${dryRun ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
          <FlaskConical className="h-4 w-4" /> تجربة
        </button>
      </div>
      {dryRun && <p className="rounded-xl bg-amber-50 px-3 py-1.5 text-[11px] font-bold text-amber-700">وضع التجربة: النتيجة تُعرض ولا تُسجَّل في سجل الدخول (قاعدة «لم يدخل من قبل» لن تتأثر)</p>}

      {mode === 'scan' ? (
        <div className="card !p-3">
          <QrScanner idPrefix="access" hint="شغّل الكاميرا لمسح كود الشخص" paused={busy} onCode={(c) => run({ code: c })} />
          <form onSubmit={submitCode} className="mt-3 flex gap-2">
            <div className="relative flex-1">
              <Keyboard className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input ref={codeRef} id="access-code" className="input-field pr-9 font-mono" dir="ltr" placeholder="أو اكتب الكود هنا" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
            </div>
            <button id="access-code-submit" type="submit" disabled={busy || !code.trim()} className="btn-primary !px-4">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'تحقق'}
            </button>
          </form>
        </div>
      ) : (
        <div className="card !p-3">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input id="access-search" className="input-field pr-9" placeholder="ابحث بالاسم أو الهاتف أو الكود…" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
            {searching && <Loader2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />}
          </div>
          {q.trim().length >= 2 && (
            <ul id="access-search-hits" className="mt-2 max-h-72 space-y-1 overflow-y-auto no-scrollbar">
              {hits.length === 0 && !searching && <li className="py-3 text-center text-xs font-bold text-slate-400">لا نتائج</li>}
              {hits.map((h) => (
                <li key={h.person.id}>
                  <button type="button" disabled={busy} onClick={() => run({ personId: h.person.id })}
                    className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-right hover:bg-emerald-50 disabled:opacity-50">
                    <PersonAvatar name={h.person.name} imageUrl={h.person.image_url} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-extrabold">{h.person.name}</span>
                      <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400">
                        <Hash className="h-3 w-3" /><span className="font-mono" dir="ltr">{h.person.national_id}</span>
                        {h.places.length > 0 && <span>· {h.places.reduce((s, p) => s + p.points, 0)} نقطة</span>}
                      </span>
                    </span>
                    <span className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-extrabold text-white">تحقق</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}

      {result && <DecisionCard result={result} lookups={lookups} onClose={() => setResult(null)} />}
    </div>
  );
}
