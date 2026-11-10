'use client';

// ---------- Child portal — التاريخ + آية اليوم ----------
// Same date chips (Gregorian + Coptic) and verse of the day as the servant home's
// WelcomeWidget (src/components/widgets/CoreWidgets.tsx), using the same helpers:
// cairoToday / formatCairoDate (Cairo time), copticOf / formatCoptic, verseOfDay.
// Pure client-side computation — no request, works offline, same verse for everyone on a given day.

import { useAppDate } from '@/lib/app-date-context';
import { cairoToday, formatCairoDate } from '@/lib/time';
import { copticOf, formatCoptic } from '@/lib/coptic';
import { verseOfDay } from '@/lib/verses';
import { CalendarDays } from 'lucide-react';

export default function DateVerseCard() {
  const { now } = useAppDate();
  const at = now();
  const today = cairoToday(at);
  const coptic = formatCoptic(copticOf(today));
  const verse = verseOfDay(today);

  return (
    <section id="child-date-verse" className="relative mb-4 overflow-hidden rounded-2xl bg-gradient-to-l from-primary-700 via-primary-600 to-accent-600 p-4 text-white shadow-card">
      <div className="relative flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold">
        <span className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1"><CalendarDays className="h-3.5 w-3.5" /> {formatCairoDate(at)}</span>
        <span className="flex items-center gap-1 rounded-full bg-gold-400/25 px-2.5 py-1 text-gold-100">☦ {coptic}</span>
      </div>
      <blockquote className="relative mt-3 rounded-xl bg-white/10 px-3 py-2">
        <p className="text-sm font-bold leading-relaxed">«{verse.text}»</p>
        <footer className="mt-1 text-[11px] font-bold text-indigo-100">— {verse.ref}</footer>
      </blockquote>
    </section>
  );
}
