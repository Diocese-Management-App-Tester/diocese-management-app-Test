'use client';

import { useState } from 'react';
import { BRANDING, dioceseLogo } from '@/lib/branding';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { LogIn, Loader2, User, Lock, QrCode } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { userIdToEmail, codeToUserId } from '@/lib/types';

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error: err } = await supabase.auth.signInWithPassword({
      // 0037: the login name IS the servant's code (national id / QR)
      email: userIdToEmail(codeToUserId(userId)),
      password,
    });

    if (err) {
      setError('بيانات الدخول غير صحيحة، تأكد من الكود وكلمة المرور');
      setLoading(false);
      return;
    }
    router.replace('/');
    router.refresh();
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <section id="login-card" className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 h-28 w-28 overflow-hidden rounded-3xl shadow-lg ring-2 ring-gold-300/50">
            <Image
              src={dioceseLogo(192)}
              alt={`شعار ${BRANDING.dioceseName}`}
              width={112}
              height={112}
              priority
              className="h-full w-full object-cover"
            />
          </div>
          <h1 className="text-2xl font-extrabold">{BRANDING.dioceseName}</h1>
          <p className="text-sm text-slate-500 mt-1">سجّل دخولك للمتابعة</p>
        </div>

        <form onSubmit={handleLogin} className="card space-y-4">
          <div>
            <label htmlFor="login-user-id" className="mb-1.5 block text-sm font-bold">
              الكود (اسم الدخول)
            </label>
            <div className="relative">
              <User className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                id="login-user-id"
                className="input-field pr-9"
                placeholder="الكود / الرقم القومي"
                dir="ltr"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                required
                autoComplete="username"
              />
            </div>
          </div>

          <div>
            <label htmlFor="login-password" className="mb-1.5 block text-sm font-bold">
              كلمة المرور
            </label>
            <div className="relative">
              <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                id="login-password"
                type="password"
                className="input-field pr-9"
                placeholder="••••••••"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
          </div>

          {error && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">
              {error}
            </p>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}
            تسجيل الدخول
          </button>
        </form>

        {/* Child portal entry — scan the card QR instead of a password */}
        <div className="my-5 flex items-center gap-3 text-xs font-bold text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          أو
          <span className="h-px flex-1 bg-slate-200" />
        </div>
        <Link
          id="child-login-btn"
          href="/child/login"
          className="card flex items-center gap-3 !py-3.5 hover:bg-gold-50 transition active:scale-[0.98]"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-gold-400 to-gold-600 text-white shadow">
            <QrCode className="h-6 w-6" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-extrabold">دخول المخدوم</span>
            <span className="block text-xs text-slate-400">امسح كود الكارت أو اختر صورته من المعرض</span>
          </span>
        </Link>

        <p className="mt-6 text-center text-sm text-slate-500">
          خادم جديد؟{' '}
          <Link href="/signup" className="font-bold text-primary-600 hover:underline">
            إنشاء حساب
          </Link>
        </p>
      </section>
    </main>
  );
}
