'use client';

// ---------- Child portal — موضوع في المكتبة ----------
// Subject banner → 📚 الكتب | 🎓 المحاضرات tabs with ⭐ and an inline player.

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowRight, Loader2, BookOpen, Video, GraduationCap, Search, X } from 'lucide-react';
import ChildShell, { useChildLibrary } from '@/components/child/ChildShell';
import { Cover, BookCard, LectureCard, MediaPlayerModal, Empty } from '@/components/library/LibraryBits';
import { matches, type ChildLibraryLecture } from '@/lib/library';

type Tab = 'books' | 'lectures';

export default function ChildSubjectPage() {
  return (
    <ChildShell>
      <Content />
    </ChildShell>
  );
}

function Content() {
  const { id } = useParams<{ id: string }>();
  const { data, isFav, toggleFav } = useChildLibrary();
  const [tab, setTab] = useState<Tab>('books');
  const [q, setQ] = useState('');
  const [playing, setPlaying] = useState<ChildLibraryLecture | null>(null);

  const subject = data?.subjects.find((s) => s.id === id) ?? null;
  const allBooks = useMemo(() => (data?.books ?? []).filter((b) => b.subject_id === id), [data, id]);
  const allLectures = useMemo(() => (data?.lectures ?? []).filter((l) => l.subject_id === id), [data, id]);
  const books = allBooks.filter((b) => matches(q, b.title, b.author, b.description));
  const lectures = allLectures.filter((l) => matches(q, l.title, l.speaker, l.description));

  const header = (
    <section className="mb-3 flex items-center gap-2">
      <Link href="/child/library" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100"><ArrowRight className="h-5 w-5" /></Link>
      <h2 className="truncate text-lg font-extrabold">{subject?.name ?? 'المكتبة'}</h2>
    </section>
  );

  if (!data) return <>{header}<div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-lime-600" /></div></>;
  if (!subject) return <>{header}<Empty icon={<BookOpen className="h-7 w-7" />} text="هذا الموضوع غير موجود أو غير متاح لك" /></>;

  const tabBtn = (value: Tab, label: string, icon: ReactNode, count: number, active: string) => (
    <button id={`child-lib-tab-${value}`} type="button" onClick={() => setTab(value)} aria-pressed={tab === value}
      className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-extrabold transition active:scale-95 ${tab === value ? `${active} text-white shadow ring-2` : 'bg-white text-slate-600 border border-slate-200'}`}>
      {icon} {label} <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${tab === value ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>{count}</span>
    </button>
  );

  return (
    <>
      {header}
      <section id="child-lib-banner" className="card relative mb-3 !p-0 overflow-hidden">
        <Cover url={subject.image_url} alt={subject.name} className="h-32 w-full" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-4 text-white">
          <h1 className="text-xl font-extrabold drop-shadow">{subject.name}</h1>
          {subject.description && <p className="mt-0.5 line-clamp-2 text-xs font-bold text-white/85">{subject.description}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="badge bg-white/90 text-lime-800"><BookOpen className="h-3 w-3" /> {allBooks.length} كتاب</span>
            <span className="badge bg-white/90 text-rose-700"><Video className="h-3 w-3" /> {allLectures.length} محاضرة</span>
          </div>
        </div>
      </section>

      <nav className="mb-3 grid grid-cols-2 gap-2">
        {tabBtn('books', 'الكتب', <BookOpen className="h-4 w-4" />, allBooks.length, 'bg-lime-700 ring-lime-300')}
        {tabBtn('lectures', 'المحاضرات', <GraduationCap className="h-4 w-4" />, allLectures.length, 'bg-rose-600 ring-rose-300')}
      </nav>

      <div className="relative mb-3">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input id="child-lib-subject-search" className="input-field pr-9 pl-9" placeholder={tab === 'books' ? 'ابحث بالعنوان أو المؤلف…' : 'ابحث بالعنوان أو المتحدث…'} value={q} onChange={(e) => setQ(e.target.value)} />
        {q && <button type="button" aria-label="مسح" onClick={() => setQ('')} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>}
      </div>

      {tab === 'books' && (
        books.length === 0 ? <Empty icon={<BookOpen className="h-7 w-7" />} text={allBooks.length === 0 ? 'لا كتب في هذا الموضوع بعد' : 'لا نتائج'} /> : (
          <div id="child-lib-books" className="space-y-2">
            {books.map((b) => <BookCard key={b.id} domId={`child-lib-book-${b.id}`} {...b} fav={isFav('book', b.id)} onFav={() => toggleFav('book', b.id)} />)}
          </div>
        )
      )}
      {tab === 'lectures' && (
        lectures.length === 0 ? <Empty icon={<GraduationCap className="h-7 w-7" />} text={allLectures.length === 0 ? 'لا محاضرات في هذا الموضوع بعد' : 'لا نتائج'} /> : (
          <div id="child-lib-lectures" className="grid gap-3 sm:grid-cols-2">
            {lectures.map((l) => <LectureCard key={l.id} domId={`child-lib-lecture-${l.id}`} {...l} fav={isFav('lecture', l.id)} onFav={() => toggleFav('lecture', l.id)} onPlay={() => setPlaying(l)} />)}
          </div>
        )
      )}
      {playing && <MediaPlayerModal title={playing.title} speaker={playing.speaker} kind={playing.kind} url={playing.media_url} onClose={() => setPlaying(null)} />}
    </>
  );
}
