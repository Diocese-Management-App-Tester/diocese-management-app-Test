'use client';

// ---------- Bottom bar (شريط المهام) — 5 slots decided by the OWNER ----------
// The slots come from تخصيص التطبيق (app_settings.navigation, migration 0035)
// resolved for the signed-in user: a slot whose module isn't granted to him
// falls back to a default core page. Defaults = الرئيسية · المخدومين ·
// الماسح · الإحصائيات · الإعدادات.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCustomization } from '@/lib/customization-context';

export default function BottomNav() {
  const pathname = usePathname();
  const { taskbar } = useCustomization();

  return (
    <nav
      id="bottom-nav"
      className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-indigo-100 shadow-nav pb-[env(safe-area-inset-bottom)]"
    >
      <div className="grid grid-cols-5 max-w-3xl mx-auto">
        {taskbar.map(({ key, href, label, icon: Icon, kind }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          const owner = kind === 'owner';
          return (
            <Link
              key={key}
              id={`nav-${key}`}
              href={href}
              className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-bold transition ${
                active
                  ? owner ? 'text-gold-600' : 'text-primary-600'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <span
                className={`rounded-xl px-3 py-1 transition ${
                  active ? (owner ? 'bg-gold-100' : 'bg-primary-100') : ''
                }`}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="max-w-full truncate px-0.5">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
