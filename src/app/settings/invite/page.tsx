'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { ArrowRight, Copy, Check, Share2, QrCode as QrIcon, Link2 } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import type { Church, Service, ClassRoom } from '@/lib/types';

export default function InvitePage() {
  const { profile } = useAuth();
  const supabase = createClient();

  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);

  const [churchId, setChurchId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [classId, setClassId] = useState('');

  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const role = profile?.role;
  // Locking per level: each manager can only invite within his own scope
  const canPickChurch = role === 'owner';
  const canPickService = role === 'owner' || role === 'church_manager';
  const canPickClass = role !== 'class_servant';

  // Initialize scope from the manager's own assignment
  useEffect(() => {
    if (!profile) return;
    setChurchId(profile.church_id ?? '');
    setServiceId(profile.service_id ?? '');
    setClassId(profile.class_id ?? '');
  }, [profile]);

  useEffect(() => {
    supabase.from('churches').select('*').order('name').then(({ data }) => setChurches(data ?? []));
    supabase.from('services').select('*').order('name').then(({ data }) => setServices(data ?? []));
    supabase.from('classes').select('*').order('name').then(({ data }) => setClasses(data ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inviteUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const url = new URL('/signup', window.location.origin);
    if (churchId) url.searchParams.set('church', churchId);
    if (serviceId) url.searchParams.set('service', serviceId);
    if (classId) url.searchParams.set('class', classId);
    return url.toString();
  }, [churchId, serviceId, classId]);

  useEffect(() => {
    if (!inviteUrl) return;
    QRCode.toDataURL(inviteUrl, {
      width: 480,
      margin: 2,
      color: { dark: '#1e3a8a', light: '#ffffff' },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [inviteUrl]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* noop */
    }
  };

  const shareLink = async () => {
    try {
      await navigator.share({ title: 'دعوة للانضمام كخادم', url: inviteUrl });
    } catch {
      /* user cancelled or unsupported */
    }
  };

  const filteredServices = churchId ? services.filter((s) => s.church_id === churchId) : services;
  const filteredClasses = serviceId ? classes.filter((c) => c.service_id === serviceId) : classes;

  const selectCls = (locked: boolean) =>
    `input-field ${locked ? 'bg-primary-50 text-primary-800 pointer-events-none opacity-80' : ''}`;

  return (
    <AppShell>
      <section className="mb-4 flex items-center gap-2">
        <Link href="/settings" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
          <ArrowRight className="h-5 w-5" />
        </Link>
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <QrIcon className="h-5 w-5 text-primary-600" />
          دعوة خادم جديد
        </h2>
      </section>

      <section id="invite-scope" className="card space-y-3 mb-4">
        <p className="text-sm font-bold text-gray-600">
          نطاق الدعوة — سيتم تحديد هذه الاختيارات مسبقاً للخادم عند التسجيل:
        </p>

        <div>
          <label className="mb-1 block text-xs font-bold text-gray-500">الكنيسة</label>
          <select
            value={churchId}
            onChange={(e) => {
              setChurchId(e.target.value);
              setServiceId('');
              setClassId('');
            }}
            className={selectCls(!canPickChurch)}
            aria-disabled={!canPickChurch}
          >
            <option value="">كل الكنائس (بدون تحديد)</option>
            {churches.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold text-gray-500">الخدمة</label>
          <select
            value={serviceId}
            onChange={(e) => {
              setServiceId(e.target.value);
              setClassId('');
            }}
            className={selectCls(!canPickService)}
            aria-disabled={!canPickService}
          >
            <option value="">كل الخدمات (بدون تحديد)</option>
            {filteredServices.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold text-gray-500">الفصل</label>
          <select
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            className={selectCls(!canPickClass)}
            aria-disabled={!canPickClass}
          >
            <option value="">كل الفصول (بدون تحديد)</option>
            {filteredClasses.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </section>

      <section id="invite-qr" className="card flex flex-col items-center gap-4 mb-4">
        {qrDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrDataUrl}
            alt="QR دعوة التسجيل"
            className="h-56 w-56 rounded-2xl border-4 border-primary-100 shadow-md"
          />
        ) : (
          <div className="h-56 w-56 animate-pulse rounded-2xl bg-gray-100" />
        )}

        <div className="w-full rounded-xl bg-gray-50 p-3 flex items-center gap-2">
          <Link2 className="h-4 w-4 shrink-0 text-gray-400" />
          <p className="break-all text-xs text-gray-600 leading-relaxed" dir="ltr">{inviteUrl}</p>
        </div>

        <div className="flex w-full gap-3">
          <button onClick={copyLink} className="btn-primary flex-1 flex items-center justify-center gap-2">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'تم النسخ!' : 'نسخ الرابط'}
          </button>
          <button onClick={shareLink} className="btn-secondary flex-1 flex items-center justify-center gap-2">
            <Share2 className="h-4 w-4" />
            مشاركة
          </button>
        </div>
      </section>

      <p className="px-2 text-center text-xs text-gray-400 leading-relaxed">
        الخادم الذي يفتح هذا الرابط سيجد النطاق المحدد مقفولاً في الخطوة الأولى، ثم يُدخل كوده
        (كتابةً أو بمسح الـ QR) وبياناته وكلمة المرور — ويصبح شخصاً في «الأشخاص» وتسجيل خادم قيد المراجعة.
      </p>
    </AppShell>
  );
}
