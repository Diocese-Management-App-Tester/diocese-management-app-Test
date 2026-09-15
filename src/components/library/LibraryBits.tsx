'use client';

// ---------- Library — shared UI bits ----------
// LibraryHeader    : back arrow + module name + optional title / badge / action
// Cover            : image from ANY url with a themed placeholder
// SubjectCard      : cover · name · books count · lectures count
// BookCard         : cover · title · author · ⭐ · open PDF
// LectureCard      : thumbnail · title · speaker · 🎥/🎙️ · date · ⭐ · play
// AudienceBadge / KindBadge / FavButton / MediaPlayerModal / Toast / Empty

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowRight, Library, BookOpen, Video, Mic, Star, ExternalLink, Play, X, Globe, Users, Layers, School,
  Pencil, Trash2, CalendarDays, User, FileText, Headphones,
} from 'lucide-react';
import { useNavLabel } from '@/lib/customization-context';
import {
  type Audience, type LectureKind, AUDIENCE_LABELS, embedUrl, autoThumbnail, detectProvider, fmtLectureDate,
} from '@/lib/library';

// ---------- Header ----------
export function LibraryHeader({ title, badge, back = '/settings', right }: {
  title?: string; badge?: ReactNode; back?: string; right?: ReactNode;
}) {
  const name = useNavLabel('library');
  return (
    <section className="mb-3 flex items-center gap-2">
      <Link href={back} aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
        <ArrowRight className="h-5 w-5" />
      </Link>
      <h2 className="flex min-w-0 flex-1 items-center gap-2 text-lg font-extrabold">
        <Library className="h-5 w-5 shrink-0 text-lime-700" />
        <span className="truncate">{title ?? name}</span>
        {badge}
      </h2>
      {right}
    </section>
  );
}

// ---------- Cover / thumbnail ----------
/** Plain <img> — covers come from arbitrary hosts (Drive, publishers…). */
export function Cover({ url, alt, icon, className = '', tone = 'lime' }: {
  url: string | null | undefined; alt: string; icon?: ReactNode; className?: string; tone?: 'lime' | 'sky' | 'rose' | 'amber';
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  const tones = {
    lime: 'from-lime-100 to-emerald-50 text-lime-600',
    sky: 'from-sky-100 to-indigo-50 text-sky-600',
    rose: 'from-rose-100 to-orange-50 text-rose-500',
    amber: 'from-amber-100 to-yellow-50 text-amber-600',
  }[tone];
  return (
    <div className={`relative overflow-hidden bg-gradient-to-br ${tones} ${className}`}>
      {url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center opacity-70">{icon ?? <Library className="h-1/3 w-1/3" />}</div>
      )}
    </div>
  );
}

// ---------- Badges ----------
const AUDIENCE_ICON: Record<Audience, ReactNode> = {
  everyone: <Globe className="h-3 w-3" />,
  servants: <Users className="h-3 w-3" />,
  service: <Layers className="h-3 w-3" />,
  class: <School className="h-3 w-3" />,
};
export function AudienceBadge({ audience, label }: { audience: Audience; label?: string }) {
  const cls = {
    everyone: 'bg-emerald-100 text-emerald-700',
    servants: 'bg-slate-200 text-slate-700',
    service: 'bg-sky-100 text-sky-700',
    class: 'bg-violet-100 text-violet-700',
  }[audience];
  return <span className={`badge ${cls}`}>{AUDIENCE_ICON[audience]} {label ?? AUDIENCE_LABELS[audience]}</span>;
}

export function KindBadge({ kind, small = false }: { kind: LectureKind; small?: boolean }) {
  const sz = small ? '!px-1.5 !py-0 text-[10px]' : '';
  return kind === 'video'
    ? <span className={`badge bg-rose-100 text-rose-700 ${sz}`}><Video className="h-3 w-3" /> فيديو</span>
    : <span className={`badge bg-sky-100 text-sky-700 ${sz}`}><Mic className="h-3 w-3" /> صوت</span>;
}

export function FavButton({ on, onToggle, id, size = 'md' }: { on: boolean; onToggle: () => void; id?: string; size?: 'sm' | 'md' }) {
  return (
    <button
      id={id} type="button" aria-pressed={on} aria-label={on ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(); }}
      className={`rounded-full bg-white/90 shadow ring-1 ring-black/5 transition active:scale-90 ${size === 'sm' ? 'p-1.5' : 'p-2'} ${on ? 'text-gold-500' : 'text-slate-400 hover:text-gold-500'}`}
    >
      <Star className={`${size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'} ${on ? 'fill-current' : ''}`} />
    </button>
  );
}

const plural = (n: number, one: string, two: string, few: string, many: string) =>
  n === 1 ? one : n === 2 ? two : n <= 10 ? few : many;

// ---------- Subject card ----------
export function SubjectCard({ id, href, name, description, image_url, books, lectures, onEdit, onDelete, badge }: {
  id?: string; href: string; name: string; description: string | null; image_url: string | null;
  books: number; lectures: number; onEdit?: () => void; onDelete?: () => void; badge?: ReactNode;
}) {
  return (
    <div id={id} className="card relative !p-0 overflow-hidden transition hover:shadow-lg">
      <Link href={href} className="block">
        <Cover url={image_url} alt={name} className="aspect-[4/3] w-full" icon={<Library className="h-12 w-12" />} />
        <div className="p-3">
          <p className="truncate font-extrabold text-slate-800">{name}</p>
          {description && <p className="mt-0.5 line-clamp-2 text-[11px] font-bold text-slate-400">{description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="badge bg-lime-100 text-lime-800"><BookOpen className="h-3 w-3" /> {books} {plural(books, 'كتاب', 'كتابان', 'كتب', 'كتاباً')}</span>
            <span className="badge bg-rose-100 text-rose-700"><Video className="h-3 w-3" /> {lectures} {plural(lectures, 'محاضرة', 'محاضرتان', 'محاضرات', 'محاضرة')}</span>
            {badge}
          </div>
        </div>
      </Link>
      {(onEdit || onDelete) && (
        <div className="absolute top-2 left-2 flex gap-1">
          {onEdit && <button type="button" aria-label="تعديل" onClick={onEdit} className="rounded-full bg-white/90 p-1.5 text-primary-600 shadow hover:bg-white"><Pencil className="h-4 w-4" /></button>}
          {onDelete && <button type="button" aria-label="حذف" onClick={onDelete} className="rounded-full bg-white/90 p-1.5 text-red-500 shadow hover:bg-white"><Trash2 className="h-4 w-4" /></button>}
        </div>
      )}
    </div>
  );
}

// ---------- Book card ----------
export function BookCard({ domId, title, author, description, cover_url, pdf_url, fav, onFav, onEdit, onDelete, sub, badge }: {
  domId?: string; title: string; author: string | null; description: string | null; cover_url: string | null; pdf_url: string;
  fav?: boolean; onFav?: () => void; onEdit?: () => void; onDelete?: () => void; sub?: string; badge?: ReactNode;
}) {
  const provider = detectProvider(pdf_url);
  return (
    <div id={domId} className="card relative flex gap-3 !p-3">
      <a href={pdf_url} target="_blank" rel="noopener noreferrer" className="shrink-0" aria-label={`فتح ${title}`}>
        <Cover url={cover_url} alt={title} className="h-28 w-20 rounded-xl ring-1 ring-black/5" icon={<BookOpen className="h-8 w-8" />} />
      </a>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 font-extrabold leading-snug text-slate-800">{title}</p>
        {author && <p className="mt-0.5 flex items-center gap-1 truncate text-xs font-bold text-slate-500"><User className="h-3 w-3" /> {author}</p>}
        {sub && <p className="truncate text-[11px] font-bold text-lime-700">{sub}</p>}
        {description && <p className="mt-1 line-clamp-2 text-[11px] text-slate-400">{description}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <a id={domId ? `${domId}-open` : undefined} href={pdf_url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-full bg-lime-600 px-3 py-1 text-xs font-extrabold text-white shadow hover:bg-lime-700 active:scale-95">
            <FileText className="h-3.5 w-3.5" /> قراءة{provider === 'drive' ? ' · Drive' : provider === 'pdf' ? ' · PDF' : ''}
            <ExternalLink className="h-3 w-3 opacity-70" />
          </a>
          {badge}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        {onFav && <FavButton on={!!fav} onToggle={onFav} id={domId ? `${domId}-fav` : undefined} size="sm" />}
        {onEdit && <button type="button" aria-label="تعديل" onClick={onEdit} className="rounded-full bg-primary-50 p-1.5 text-primary-600 hover:bg-primary-100"><Pencil className="h-4 w-4" /></button>}
        {onDelete && <button type="button" aria-label="حذف" onClick={onDelete} className="rounded-full bg-red-50 p-1.5 text-red-500 hover:bg-red-100"><Trash2 className="h-4 w-4" /></button>}
      </div>
    </div>
  );
}

// ---------- Lecture card ----------
export function LectureCard({ domId, title, speaker, description, lecture_date, kind, media_url, thumbnail_url, fav, onFav, onEdit, onDelete, onPlay, sub, badge }: {
  domId?: string; title: string; speaker: string | null; description: string | null; lecture_date: string | null;
  kind: LectureKind; media_url: string; thumbnail_url: string | null;
  fav?: boolean; onFav?: () => void; onEdit?: () => void; onDelete?: () => void; onPlay: () => void; sub?: string; badge?: ReactNode;
}) {
  const thumb = thumbnail_url || autoThumbnail(media_url);
  return (
    <div id={domId} className="card relative !p-0 overflow-hidden">
      <button type="button" onClick={onPlay} className="relative block w-full text-right" aria-label={`تشغيل ${title}`}>
        <Cover url={thumb} alt={title} className="aspect-video w-full" tone={kind === 'video' ? 'rose' : 'sky'}
          icon={kind === 'video' ? <Video className="h-12 w-12" /> : <Headphones className="h-12 w-12" />} />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow-lg ring-1 ring-black/10">
            <Play className="h-6 w-6 fill-current" />
          </span>
        </span>
        <span className="absolute top-2 right-2"><KindBadge kind={kind} small /></span>
      </button>
      {onFav && <div className="absolute top-2 left-2"><FavButton on={!!fav} onToggle={onFav} id={domId ? `${domId}-fav` : undefined} size="sm" /></div>}
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 font-extrabold leading-snug text-slate-800">{title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs font-bold text-slate-500">
            {speaker && <span className="inline-flex items-center gap-1 truncate"><User className="h-3 w-3" /> {speaker}</span>}
            {lecture_date && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" /> {fmtLectureDate(lecture_date)}</span>}
          </p>
          {sub && <p className="truncate text-[11px] font-bold text-lime-700">{sub}</p>}
          {description && <p className="mt-1 line-clamp-2 text-[11px] text-slate-400">{description}</p>}
          {badge && <div className="mt-1.5 flex flex-wrap gap-1.5">{badge}</div>}
        </div>
        {(onEdit || onDelete) && (
          <div className="flex flex-col gap-1">
            {onEdit && <button type="button" aria-label="تعديل" onClick={onEdit} className="rounded-full bg-primary-50 p-1.5 text-primary-600 hover:bg-primary-100"><Pencil className="h-4 w-4" /></button>}
            {onDelete && <button type="button" aria-label="حذف" onClick={onDelete} className="rounded-full bg-red-50 p-1.5 text-red-500 hover:bg-red-100"><Trash2 className="h-4 w-4" /></button>}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Media player modal ----------
export function MediaPlayerModal({ title, speaker, kind, url, onClose }: {
  title: string; speaker: string | null; kind: LectureKind; url: string; onClose: () => void;
}) {
  const embed = embedUrl(url);
  const provider = detectProvider(url);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div id="library-player" className="w-full max-w-2xl overflow-hidden rounded-t-3xl bg-slate-900 text-white sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3">
          <KindBadge kind={kind} small />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-extrabold">{title}</p>
            {speaker && <p className="truncate text-[11px] text-slate-300">{speaker}</p>}
          </div>
          <a href={url} target="_blank" rel="noopener noreferrer" aria-label="فتح في نافذة جديدة" className="rounded-full p-2 hover:bg-white/10"><ExternalLink className="h-4 w-4" /></a>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-full p-2 hover:bg-white/10"><X className="h-5 w-5" /></button>
        </div>
        <div className="bg-black">
          {embed ? (
            <iframe src={embed} title={title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen
              className={`w-full ${kind === 'voice' && provider === 'drive' ? 'h-24' : 'aspect-video'}`} />
          ) : provider === 'audio' || kind === 'voice' ? (
            <div className="flex flex-col items-center gap-4 p-6">
              <span className="flex h-20 w-20 items-center justify-center rounded-full bg-sky-600/30 text-sky-300"><Headphones className="h-10 w-10" /></span>
              <audio id="library-audio" controls autoPlay src={url} className="w-full" preload="metadata">
                المتصفح لا يدعم تشغيل الصوت — <a href={url} className="underline">افتح الرابط</a>
              </audio>
            </div>
          ) : provider === 'video' ? (
            <video id="library-video" controls autoPlay src={url} className="aspect-video w-full" playsInline />
          ) : (
            <div className="p-8 text-center">
              <p className="text-sm font-bold text-slate-300">لا يمكن تشغيل هذا الرابط داخل التطبيق</p>
              <a href={url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-extrabold text-slate-900">
                <ExternalLink className="h-4 w-4" /> فتح الرابط
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div id="library-toast" role="status" className="fixed inset-x-4 bottom-24 z-[70] mx-auto max-w-md rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm font-bold text-white shadow-xl">
      {msg}
    </div>
  );
}

export function Empty({ icon, text, action }: { icon: ReactNode; text: string; action?: ReactNode }) {
  return (
    <div className="card py-12 text-center text-slate-400">
      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-lime-50 text-lime-300">{icon}</div>
      <p className="font-bold">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
