'use client';

// ---------- Messages module — shared UI bits ----------
// MessagesHeader : back arrow + title (+ badge / actions)
// ChatAvatar     : round picture / initial
// MessageBubble  : one message (mine → start side, theirs → end side)
// DayDivider     : «اليوم» / «أمس» / date
// Composer       : text + picture + send (handles compression + upload)
// Toast / EmptyChat / ImageViewer
// compressImage  : ≤1280px webp

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, MessageCircle, Send, ImagePlus, X, Loader2, Megaphone, Trash2, User } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { uploadPhoto } from '@/lib/upload';
import { ROLE_LABELS } from '@/lib/types';
import { fmtMsgTime, type ChatMessage } from '@/lib/chat';
import { useNavLabel } from '@/lib/customization-context';

export async function compressImage(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new window.Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const max = 1280;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.82));
    return blob ?? file;
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function MessagesHeader({
  title, sub, badge, back = '/messages', actions, icon,
}: { title?: string; sub?: string; badge?: ReactNode; back?: string; actions?: ReactNode; icon?: ReactNode }) {
  const name = useNavLabel('messages');
  return (
    <section className="mb-3 flex items-center gap-2">
      <Link href={back} aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
        <ArrowRight className="h-5 w-5" />
      </Link>
      {icon}
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-2 text-lg font-extrabold leading-tight">
          {!icon && <MessageCircle className="h-5 w-5 shrink-0 text-sky-600" />}
          <span className="truncate">{title ?? name}</span>
          {badge}
        </h2>
        {sub && <p className="truncate text-xs font-bold text-slate-400">{sub}</p>}
      </div>
      {actions}
    </section>
  );
}

export function ChatAvatar({ url, name, size = 44, tone = 'sky', className = '' }: {
  url: string | null | undefined; name: string | null | undefined; size?: number; tone?: 'sky' | 'violet' | 'emerald' | 'slate'; className?: string;
}) {
  const bg = { sky: 'from-sky-500 to-primary-600', violet: 'from-violet-500 to-fuchsia-600', emerald: 'from-emerald-500 to-teal-600', slate: 'from-slate-400 to-slate-600' }[tone];
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-full bg-gradient-to-br ${bg} text-white ring-2 ring-white shadow ${className}`}
      style={{ width: size, height: size }}
    >
      {url ? (
        <Image src={url} alt={name ?? ''} fill sizes={`${size}px`} className="object-cover" />
      ) : name ? (
        <span className="absolute inset-0 flex items-center justify-center font-extrabold" style={{ fontSize: size * 0.42 }}>{name.trim().charAt(0)}</span>
      ) : (
        <User className="absolute inset-0 m-auto" style={{ width: size * 0.5, height: size * 0.5 }} />
      )}
    </div>
  );
}

export function UnreadDot({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-sky-600 px-1.5 text-[10px] font-extrabold text-white tabular-nums">
      {n > 99 ? '99+' : n}
    </span>
  );
}

export function DayDivider({ label }: { label: string }) {
  return (
    <div className="my-3 flex items-center gap-2">
      <hr className="flex-1 border-slate-200" />
      <span className="rounded-full bg-slate-100 px-3 py-0.5 text-[11px] font-extrabold text-slate-500">{label}</span>
      <hr className="flex-1 border-slate-200" />
    </div>
  );
}

/**
 * One bubble. `showSender` — put the sender name above (group threads).
 * «mine» sits at the START side (right in RTL), theirs at the END side.
 */
export function MessageBubble({
  m, showSender = true, onDelete, onImage,
}: { m: ChatMessage; showSender?: boolean; onDelete?: (m: ChatMessage) => void; onImage?: (url: string) => void }) {
  const mine = m.is_me;
  const broadcast = m.is_broadcast;
  return (
    <div id={`msg-${m.id}`} className={`group flex w-full gap-2 ${mine ? 'justify-start' : 'justify-end'}`}>
      {!mine && (
        <ChatAvatar url={m.sender_photo} name={m.sender_name} size={30} tone={m.sender_kind === 'child' ? 'emerald' : broadcast ? 'violet' : 'sky'} className="mt-auto" />
      )}
      <div className={`relative max-w-[82%] ${mine ? 'order-first' : ''}`}>
        <div
          className={`rounded-2xl px-3.5 py-2 shadow-sm ${
            mine
              ? 'rounded-tr-md bg-gradient-to-l from-primary-600 to-primary-500 text-white'
              : broadcast
                ? 'rounded-tl-md border border-violet-200 bg-violet-50 text-slate-800'
                : m.sender_kind === 'child'
                  ? 'rounded-tl-md border border-emerald-200 bg-emerald-50 text-slate-800'
                  : 'rounded-tl-md border border-slate-200 bg-white text-slate-800'
          }`}
        >
          {(showSender && !mine) && (
            <p className={`mb-0.5 flex items-center gap-1 text-[11px] font-extrabold ${broadcast ? 'text-violet-700' : m.sender_kind === 'child' ? 'text-emerald-700' : 'text-sky-700'}`}>
              {broadcast && <Megaphone className="h-3 w-3" />}
              {m.sender_name ?? '—'}
              {m.sender_role && <span className="font-bold text-slate-400">· {ROLE_LABELS[m.sender_role]}</span>}
            </p>
          )}
          {broadcast && m.audience_label && (
            <p className={`mb-1 text-[10px] font-bold ${mine ? 'text-indigo-100' : 'text-violet-500'}`}>
              <Megaphone className="ml-0.5 inline h-3 w-3" /> إعلان إلى: {m.audience_label}
            </p>
          )}
          {m.image_url && (
            <button type="button" onClick={() => onImage?.(m.image_url!)} className="mb-1.5 block overflow-hidden rounded-xl">
              <Image src={m.image_url} alt="صورة" width={320} height={240} className="h-auto max-h-64 w-full object-cover" unoptimized />
            </button>
          )}
          {m.body && <p className="whitespace-pre-wrap break-words text-sm font-medium leading-relaxed">{m.body}</p>}
          <p className={`mt-1 text-left text-[10px] font-bold tabular-nums ${mine ? 'text-indigo-100/90' : 'text-slate-400'}`}>{fmtMsgTime(m.created_at)}</p>
        </div>
        {onDelete && m.can_delete && (
          <button
            type="button" aria-label="حذف الرسالة" onClick={() => onDelete(m)}
            className={`absolute -top-2 ${mine ? '-left-2' : '-right-2'} rounded-full bg-white p-1 text-red-500 shadow ring-1 ring-red-100 opacity-70 hover:opacity-100`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Full-screen image viewer */
export function ImageViewer({ url, onClose }: { url: string | null; onClose: () => void }) {
  if (!url) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4" onClick={onClose}>
      <button aria-label="إغلاق" className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white"><X className="h-6 w-6" /></button>
      <Image src={url} alt="صورة" width={1200} height={1200} className="max-h-full w-auto max-w-full rounded-xl object-contain" unoptimized />
    </div>
  );
}

/**
 * Composer — sticky at the bottom. `onSend(body, imageUrl)` is called after
 * the picture (if any) is compressed + uploaded to `photos/<folder>/`.
 */
export function Composer({
  supabase, folder, onSend, disabled, placeholder = 'اكتب رسالتك…', autoFocus,
}: {
  supabase: SupabaseClient;
  folder: 'messages' | 'child-messages';
  onSend: (body: string, imageUrl: string | null) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = '0px';
    ta.style.height = Math.min(140, ta.scrollHeight) + 'px';
  }, [text]);

  const canSend = !busy && !disabled && (text.trim().length > 0 || !!file);

  const submit = async () => {
    if (!canSend) return;
    setBusy(true); setErr(null);
    try {
      let url: string | null = null;
      if (file) {
        const blob = await compressImage(file);
        url = await uploadPhoto(supabase, folder, blob, 'msg.webp');
      }
      await onSend(text.trim(), url);
      setText(''); setFile(null);
      taRef.current?.focus();
    } catch (e) {
      setErr((e as { message?: string })?.message ?? 'تعذر الإرسال');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="chat-composer" className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 -mx-4 border-t border-indigo-100 bg-white/95 px-3 py-2 backdrop-blur">
      {err && <p className="mb-1 rounded-xl bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600">{err}</p>}
      {preview && (
        <div className="mb-2 flex items-center gap-2">
          <div className="relative h-16 w-16 overflow-hidden rounded-xl ring-1 ring-slate-200">
            <Image src={preview} alt="" fill sizes="64px" className="object-cover" unoptimized />
          </div>
          <button type="button" onClick={() => setFile(null)} className="rounded-full bg-slate-100 p-1.5 text-slate-500"><X className="h-4 w-4" /></button>
          <span className="text-xs font-bold text-slate-400">صورة مرفقة</span>
        </div>
      )}
      <div className="flex items-end gap-2">
        <label aria-label="إرفاق صورة" className={`flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition hover:bg-slate-200 ${disabled ? 'pointer-events-none opacity-40' : ''}`}>
          <ImagePlus className="h-5 w-5" />
          <input type="file" accept="image/*" className="hidden" disabled={disabled} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <textarea
          ref={taRef}
          id="chat-input"
          rows={1}
          value={text}
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}
          placeholder={disabled ? 'لا يمكنك الإرسال هنا' : placeholder}
          className="input-field max-h-[140px] flex-1 resize-none !py-2.5 leading-relaxed"
        />
        <button
          id="chat-send"
          type="button"
          aria-label="إرسال"
          onClick={submit}
          disabled={!canSend}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-l from-primary-600 to-primary-500 text-white shadow-md transition active:scale-95 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 -scale-x-100" />}
        </button>
      </div>
    </div>
  );
}

export function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div id="chat-toast" role="status" className="fixed inset-x-4 bottom-24 z-[70] mx-auto max-w-md rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm font-bold text-white shadow-xl">
      {msg}
    </div>
  );
}

export function EmptyChat({ text, sub }: { text: string; sub?: string }) {
  return (
    <div className="card py-12 text-center">
      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-50 text-sky-400">
        <MessageCircle className="h-7 w-7" />
      </div>
      <p className="font-extrabold text-slate-700">{text}</p>
      {sub && <p className="mt-1 text-xs font-bold text-slate-400">{sub}</p>}
    </div>
  );
}
