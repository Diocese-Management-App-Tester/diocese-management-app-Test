'use client';

// ---------- BIRTHDAYS — settings (إعدادات الوحدة) ----------
// Per church (church manager / owner) or global (owner): default gift
// points and the default greeting text. The month view seeds its message
// template from here; the gift NumPad opens on gift_points.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Save, Gift, MessageSquareText, Globe, Church as ChurchIcon } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { cachedLookup } from '@/lib/queries';
import type { Church } from '@/lib/types';
import { BirthdayHeader, Toast } from '@/components/birthdays/BirthdayBits';
import {
  type BirthdaySettings, fetchBirthdaySettings, DEFAULT_GIFT_POINTS, DEFAULT_MESSAGE_TEMPLATE, MSG_VARS,
  isMigrationMissing, MIGRATION_HINT, birthdayErrorMessage,
} from '@/lib/birthdays';

const GLOBAL = '__global__';

export default function BirthdaySettingsPage() {
  const { profile } = useAuth();
  const [supabase] = useState(() => createClient());
  const enabled = profile?.status === 'approved';
  const isOwner = profile?.role === 'owner';
  const canEdit = isOwner || profile?.role === 'church_manager';

  const [churches, setChurches] = useState<Church[]>([]);
  const [rows, setRows] = useState<BirthdaySettings[] | null>(null);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [target, setTarget] = useState<string>('');        // church id | GLOBAL
  const [points, setPoints] = useState(DEFAULT_GIFT_POINTS);
  const [text, setText] = useState(DEFAULT_MESSAGE_TEMPLATE);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600); };

  const load = useCallback(async () => {
    try {
      const [chs, s] = await Promise.all([cachedLookup<Church>(supabase, 'churches'), fetchBirthdaySettings(supabase)]);
      setChurches(chs); setRows(s);
    } catch (e) { if (isMigrationMissing(e)) setMigrationMissing(true); setRows([]); }
  }, [supabase]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);
  useDebouncedRealtime(supabase, 'birthday-settings', [{ table: 'birthday_settings' }], load, { enabled });

  // default target: my church, or global for the owner without a church
  useEffect(() => {
    if (target) return;
    if (profile?.church_id) setTarget(profile.church_id);
    else if (churches.length === 1) setTarget(churches[0].id);
    else if (isOwner) setTarget(GLOBAL);
  }, [profile?.church_id, churches, isOwner, target]);

  const current = useMemo(() => rows?.find((r) => (target === GLOBAL ? r.church_id === null : r.church_id === target)) ?? null, [rows, target]);
  const globalRow = useMemo(() => rows?.find((r) => r.church_id === null) ?? null, [rows]);
  useEffect(() => {
    setPoints(current?.gift_points ?? globalRow?.gift_points ?? DEFAULT_GIFT_POINTS);
    setText(current?.message_template ?? globalRow?.message_template ?? DEFAULT_MESSAGE_TEMPLATE);
  }, [current, globalRow]);

  const save = async () => {
    if (!target) return;
    setSaving(true);
    const payload = {
      church_id: target === GLOBAL ? null : target,
      gift_points: Math.max(0, Math.round(points)),
      message_template: text.trim() || DEFAULT_MESSAGE_TEMPLATE,
      edited_by: profile?.id,
    };
    const { error } = current
      ? await supabase.from('birthday_settings').update(payload).eq('id', current.id)
      : await supabase.from('birthday_settings').insert(payload);
    setSaving(false);
    if (error) { flash(birthdayErrorMessage(error)); return; }
    flash('تم حفظ الإعدادات ✓'); load();
  };

  const insertVar = (token: string) => {
    const el = document.getElementById('bd-settings-textarea') as HTMLTextAreaElement | null;
    if (!el) { setText((t) => t + token); return; }
    const start = el.selectionStart ?? text.length; const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + token + text.slice(end);
    setText(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
  };

  return (
    <AppShell>
      <BirthdayHeader title="الإعدادات" info="هدية النقاط الافتراضية ونص التهنئة الافتراضي. الإعداد على مستوى الكنيسة يغلب الإعداد العام. يستطيع كل خادم تعديل النص لنفسه من صفحة الشهر دون تغيير هذا الافتراضي." />
      {migrationMissing && <p className="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">⚠️ {MIGRATION_HINT}</p>}

      {rows === null ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-pink-500" /></div>
      ) : (
        <>
          {(churches.length > 1 || isOwner) && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {isOwner && (
                <button onClick={() => setTarget(GLOBAL)} className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-extrabold ${target === GLOBAL ? 'bg-pink-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                  <Globe className="h-3.5 w-3.5" /> عام (كل الكنائس)
                </button>
              )}
              {churches.map((c) => (
                <button key={c.id} onClick={() => setTarget(c.id)} className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-extrabold ${target === c.id ? 'bg-pink-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                  <ChurchIcon className="h-3.5 w-3.5" /> {c.name}
                  {rows.some((r) => r.church_id === c.id) && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                </button>
              ))}
            </div>
          )}

          <section className="card mb-3">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-extrabold text-slate-600"><Gift className="h-4 w-4 text-amber-500" /> هدية عيد الميلاد (نقاط)</h3>
            <input id="bd-settings-points" type="number" min={0} className="input-field text-center text-2xl font-extrabold tabular-nums" value={points} dir="ltr"
              onChange={(e) => setPoints(Number(e.target.value))} disabled={!canEdit} />
            <p className="mt-1 text-[11px] font-bold text-slate-400">تُضاف مرة واحدة لكل مخدوم في السنة — يمكن تغيير الرقم لحظة الإهداء.</p>
          </section>

          <section className="card mb-3">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-extrabold text-slate-600"><MessageSquareText className="h-4 w-4 text-pink-500" /> نص التهنئة الافتراضي</h3>
            <textarea id="bd-settings-textarea" className="input-field" rows={5} value={text} onChange={(e) => setText(e.target.value)} disabled={!canEdit} />
            {canEdit && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {MSG_VARS.map((v) => (
                  <button key={v.token} type="button" onClick={() => insertVar(v.token)} className="rounded-full bg-pink-50 px-3 py-1 text-[11px] font-bold text-pink-700 hover:bg-pink-100">+ {v.label}</button>
                ))}
              </div>
            )}
          </section>

          {canEdit ? (
            <button onClick={save} disabled={saving || !target} className="btn-primary flex w-full items-center justify-center gap-2 !py-3">
              {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />} حفظ {target === GLOBAL ? 'الإعداد العام' : 'إعداد الكنيسة'}
            </button>
          ) : (
            <p className="rounded-2xl bg-slate-50 px-4 py-3 text-center text-xs font-bold text-slate-400">التعديل لمدير الكنيسة أو المالك — يمكنك تغيير نصك الخاص من صفحة الشهر.</p>
          )}
        </>
      )}
      <Toast msg={toast} />
    </AppShell>
  );
}
