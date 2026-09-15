'use client';

// ---------- Child portal — المكتبة (home) ----------
// Search (subjects · books · lectures · authors · speakers) → المواضيع
// cards (cover · name · books · lectures) | ⭐ المفضلة. Data from the shared
// ChildProvider (child_portal_library RPC, realtime on library_*).

import { useMemo, useState, type ReactNode } from 'react';
import { Library, Loader2, Search, Star, BookOpen, Video, X, LayoutGrid } from 'lucide-react';
import ChildShell, { useChildLibrary } from '@/components/child/ChildShell';
import { SubjectCard, BookCard, LectureCard, MediaPlayerModal, Empty } from '@/components/library/LibraryBits';
import { searchLibrary, type ChildLibraryLecture } from '@/lib/library';

type Tab = 'subjects' | 'favorites';

export default function ChildLibraryPage() {
  return (
    <ChildShell>
      <Content />
    </ChildShell>
  );
}

function SectionTitle({ icon, label, count }: { icon: ReactNode; label: string; count?: number }) {
  return (
    <h3 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-slate-500">
      {icon} {label}
      {count !== undefined && <span className="badge bg-slate-100 text-slate-500 tabular-nums">{count}</span>}
    </h3>
  );
}

function Content() {
  const { data, isFav, toggleFav } = useChildLibrary();
  const [tab, setTab] = useState<Tab>('subjects');
  const [q, setQ] = useState('');
  const [playing, setPlaying] = useState<ChildLibraryLecture | null>(null);

  const counts = useMemo(() => {
    const books = new Map<string, number>(); const lectures = new Map<string, number>();
    data?.books.forEach((b) => books.set(b.subject_id, (books.get(b.subject_id) ?? 0) + 1));
    data?.lectures.forEach((l) => lectures.set(l.subject_id, (lectures.get(l.subject_id) ?? 0) + 1));
    return { books, lectures };
  }, [data]);
  const subjectName = (id: string) => data?.subjects.find((s) => s.id === id)?.name ?? '';
  const searching = q.trim().length > 0;
  const results = useMemo(() => (data && searching ? searchLibrary(data, q) : null), [data, q, searching]);
  const favBooks = useMemo(() => (data?.books ?? []).filter((b) => isFav('book', b.id)), [data, isFav]);
  const favLectures = useMemo(() => (data?.lectures ?? []).filter((l) => isFav('lecture', l.id)), [data, isFav]);
  const favCount = favBooks.length + favLectures.length;

  return (
    <>
      <section className="mb-4 flex items-center gap-2">
        <h2 className="flex items-center gap-2 text-lg font-extrabold"><Library className="h-5 w-5 text-lime-700" /> المكتبة</h2>
        {data && <span className="badge bg-lime-100 text-lime-800 tabular-nums">{data.subjects.length}</span>}
      </section>

      {!data ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-lime-600" /></div>
      ) : (
        <>
          <section className="mb-3 grid grid-cols-3 gap-2">
            <div className="card !p-2 text-center"><p className="text-lg font-extrabold tabular-nums text-lime-700">{data.subjects.length}</p><p className="text-[10px] font-bold text-slate-400">موضوع</p></div>
            <div className="card !p-2 text-center"><p className="text-lg font-extrabold tabular-nums text-emerald-600">{data.books.length}</p><p className="text-[10px] font-bold text-slate-400">كتاب</p></div>
            <div className="card !p-2 text-center"><p className="text-lg font-extrabold tabular-nums text-rose-600">{data.lectures.length}</p><p className="text-[10px] font-bold text-slate-400">محاضرة</p></div>
          </section>

          <div className="relative mb-3">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input id="child-lib-search" className="input-field pr-9 pl-9" placeholder="ابحث في المواضيع والكتب والمحاضرات…" value={q} onChange={(e) => setQ(e.target.value)} />
            {q && <button type="button" aria-label="مسح" onClick={() => setQ('')} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>}
          </div>

          {searching && results ? (
            <div id="child-lib-results" className="space-y-4">
              {results.subjects.length + results.books.length + results.lectures.length === 0 && <Empty icon={<Search className="h-7 w-7" />} text={`لا نتائج لـ «${q}»`} />}
              {results.subjects.length > 0 && (
                <section>
                  <SectionTitle icon={<Library className="h-4 w-4" />} label="المواضيع" count={results.subjects.length} />
                  <div className="grid grid-cols-2 gap-3">
                    {results.subjects.map((s) => <SubjectCard key={s.id} href={`/child/library/${s.id}`} name={s.name} description={s.description} image_url={s.image_url} books={counts.books.get(s.id) ?? 0} lectures={counts.lectures.get(s.id) ?? 0} />)}
                  </div>
                </section>
              )}
              {results.books.length > 0 && (
                <section>
                  <SectionTitle icon={<BookOpen className="h-4 w-4" />} label="الكتب" count={results.books.length} />
                  <div className="space-y-2">{results.books.map((b) => <BookCard key={b.id} {...b} sub={subjectName(b.subject_id)} fav={isFav('book', b.id)} onFav={() => toggleFav('book', b.id)} />)}</div>
                </section>
              )}
              {results.lectures.length > 0 && (
                <section>
                  <SectionTitle icon={<Video className="h-4 w-4" />} label="المحاضرات" count={results.lectures.length} />
                  <div className="grid gap-3 sm:grid-cols-2">{results.lectures.map((l) => <LectureCard key={l.id} {...l} sub={subjectName(l.subject_id)} fav={isFav('lecture', l.id)} onFav={() => toggleFav('lecture', l.id)} onPlay={() => setPlaying(l)} />)}</div>
                </section>
              )}
            </div>
          ) : (
            <>
              <nav id="child-lib-tabs" className="mb-3 grid grid-cols-2 gap-2">
                {([['subjects', 'المواضيع', <LayoutGrid key="g" className="h-4 w-4" />, data.subjects.length], ['favorites', 'المفضلة', <Star key="s" className="h-4 w-4" />, favCount]] as [Tab, string, ReactNode, number][]).map(([v, label, icon, n]) => (
                  <button key={v} id={`child-lib-tab-${v}`} type="button" onClick={() => setTab(v)} aria-pressed={tab === v}
                    className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-extrabold transition active:scale-95 ${tab === v ? 'bg-lime-700 text-white shadow ring-2 ring-lime-300' : 'bg-white text-slate-600 border border-slate-200'}`}>
                    {icon} {label} <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${tab === v ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>{n}</span>
                  </button>
                ))}
              </nav>
              {tab === 'subjects' && (
                data.subjects.length === 0 ? <Empty icon={<Library className="h-7 w-7" />} text="لا توجد مواضيع متاحة لك بعد" /> : (
                  <div id="child-lib-subjects" className="grid grid-cols-2 gap-3">
                    {data.subjects.map((s) => <SubjectCard key={s.id} id={`child-lib-subject-${s.id}`} href={`/child/library/${s.id}`} name={s.name} description={s.description} image_url={s.image_url} books={counts.books.get(s.id) ?? 0} lectures={counts.lectures.get(s.id) ?? 0} />)}
                  </div>
                )
              )}
              {tab === 'favorites' && (
                favCount === 0 ? <Empty icon={<Star className="h-7 w-7" />} text="لا مفضلة بعد — اضغط ⭐ على أي كتاب أو محاضرة" /> : (
                  <div id="child-lib-favorites" className="space-y-4">
                    {favBooks.length > 0 && (
                      <section>
                        <SectionTitle icon={<BookOpen className="h-4 w-4" />} label="كتبي المفضلة" count={favBooks.length} />
                        <div className="space-y-2">{favBooks.map((b) => <BookCard key={b.id} {...b} sub={subjectName(b.subject_id)} fav onFav={() => toggleFav('book', b.id)} />)}</div>
                      </section>
                    )}
                    {favLectures.length > 0 && (
                      <section>
                        <SectionTitle icon={<Video className="h-4 w-4" />} label="محاضراتي المفضلة" count={favLectures.length} />
                        <div className="grid gap-3 sm:grid-cols-2">{favLectures.map((l) => <LectureCard key={l.id} {...l} sub={subjectName(l.subject_id)} fav onFav={() => toggleFav('lecture', l.id)} onPlay={() => setPlaying(l)} />)}</div>
                      </section>
                    )}
                  </div>
                )
              )}
            </>
          )}
        </>
      )}
      {playing && <MediaPlayerModal title={playing.title} speaker={playing.speaker} kind={playing.kind} url={playing.media_url} onClose={() => setPlaying(null)} />}
    </>
  );
}
