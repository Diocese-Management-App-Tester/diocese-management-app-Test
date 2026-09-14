'use client';

import { Hourglass, XCircle, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

export default function PendingApproval() {
  const { profile, signOut } = useAuth();
  const rejected = profile?.status === 'rejected';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div
        className={`mb-6 rounded-full p-6 ${
          rejected ? 'bg-red-100' : 'bg-gold-100'
        }`}
      >
        {rejected ? (
          <XCircle className="h-14 w-14 text-red-500" />
        ) : (
          <Hourglass className="h-14 w-14 text-gold-500 animate-pulse" />
        )}
      </div>

      <h2 className="text-2xl font-extrabold mb-2">
        {rejected ? 'تم رفض الطلب' : 'طلبك قيد المراجعة'}
      </h2>
      <p className="text-slate-500 mb-8 max-w-sm leading-relaxed">
        {rejected
          ? 'نأسف، تم رفض طلب انضمامك. يرجى التواصل مع المسؤول لمزيد من التفاصيل.'
          : 'تم إرسال طلب التسجيل بنجاح. سيتم تفعيل حسابك فور موافقة المسؤول، وستنتقل لهذه الصفحة تلقائياً عند القبول.'}
      </p>

      <div className="card w-full max-w-sm mb-6 text-right">
        <p className="text-sm">
          <span className="text-slate-400">الاسم: </span>
          <span className="font-bold">{profile?.full_name ?? '...'}</span>
        </p>
        <p className="text-sm mt-1">
          <span className="text-slate-400">الكود: </span>
          <span className="font-bold">{profile?.user_id}</span>
        </p>
        <p className="text-sm mt-1">
          <span className="text-slate-400">الهاتف: </span>
          <span className="font-bold" dir="ltr">{profile?.phone}</span>
        </p>
      </div>

      <button onClick={signOut} className="btn-secondary flex items-center gap-2">
        <LogOut className="h-4 w-4" />
        تسجيل الخروج
      </button>
    </div>
  );
}
