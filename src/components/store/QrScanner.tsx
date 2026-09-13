'use client';

// ---------- Compact QR scanner (camera) for the POS ----------
// Native BarcodeDetector when available, jsQR fallback otherwise (same
// decoding helpers as the child portal login). Debounces identical codes
// (4 s) and pauses while `paused` is true (e.g. a confirm dialog is open).

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Images, Loader2 } from 'lucide-react';
import { decodeImageFile, decodeVideoFrame, nativeDetector } from '@/lib/qr-decode';

export default function QrScanner({
  onCode, paused = false, hint, className = '', idPrefix = 'pos', autoStart = false,
}: {
  onCode: (code: string) => Promise<void> | void;
  paused?: boolean;
  hint?: string;
  className?: string;
  /** Prefix for the button element ids (avoid duplicates when reused on a page) */
  idPrefix?: string;
  /** Open the camera as soon as the component mounts */
  autoStart?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(false);
  const handlerRef = useRef(onCode);
  handlerRef.current = onCode;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const fileRef = useRef<HTMLInputElement>(null);

  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const stop = useCallback(() => {
    scanningRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setOn(false);
  }, []);
  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setOn(true);
      scanningRef.current = true;
      const detector = nativeDetector();
      if (!canvasRef.current) canvasRef.current = document.createElement('canvas');
      let lastCode = '';
      let lastAt = 0;
      let handling = false;

      const tick = async () => {
        if (!scanningRef.current || !videoRef.current) return;
        try {
          if (!handling && !pausedRef.current) {
            let value: string | null = null;
            if (detector) {
              const codes = await detector.detect(videoRef.current);
              value = codes[0]?.rawValue ?? null;
            } else {
              value = decodeVideoFrame(videoRef.current, canvasRef.current!);
            }
            if (value) {
              const t = Date.now();
              if (value !== lastCode || t - lastAt > 4000) {
                lastCode = value; lastAt = t; handling = true;
                try { await handlerRef.current(value); } finally { handling = false; }
              }
            }
          }
        } catch { /* frame not ready */ }
        if (scanningRef.current) {
          if (detector) requestAnimationFrame(tick);
          else setTimeout(tick, 120);
        }
      };
      tick();
    } catch {
      setError('تعذر فتح الكاميرا — تأكد من منح الإذن أو استخدم البحث');
    }
  }, []);

  // Optional auto-start (e.g. when opened inside a modal)
  const autoStartRef = useRef(autoStart);
  useEffect(() => {
    if (autoStartRef.current) start();
  }, [start]);

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const code = await decodeImageFile(file);
      if (!code) setError('لم يُعثر على QR في الصورة');
      else await handlerRef.current(code);
    } finally { setBusy(false); }
  };

  return (
    <div className={className}>
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-slate-900">
        <video ref={videoRef} playsInline muted className={`h-full w-full object-cover ${on ? '' : 'hidden'}`} />
        {!on && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-400">
            <Camera className="h-10 w-10" />
            <p className="text-xs font-bold">{hint ?? 'شغّل الكاميرا لمسح الكود'}</p>
          </div>
        )}
        {on && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className={`h-40 w-40 rounded-2xl border-4 ${paused ? 'border-slate-400/60' : 'border-orange-400/80 animate-pulse'}`} />
          </div>
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <button id={`${idPrefix}-camera-toggle`} type="button" onClick={on ? stop : start}
          className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-extrabold transition active:scale-95 ${on ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'btn-primary !from-orange-600 !to-orange-500 !py-2.5'}`}>
          {on ? <CameraOff className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
          {on ? 'إيقاف الكاميرا' : 'مسح الكود'}
        </button>
        <button id={`${idPrefix}-gallery`} type="button" onClick={() => fileRef.current?.click()} disabled={busy} aria-label="صورة من المعرض"
          className="btn-secondary flex items-center gap-1.5 !py-2.5 !px-3 text-sm">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Images className="h-4 w-4" />}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
      </div>
      {error && <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
    </div>
  );
}
