import type { ReactNode } from 'react';
import { PriestProvider } from '@/lib/priest-context';

// Priest portal (بوابة الكاهن) — everything under /priest/* shares the
// session token (migration 20260927120000).
export default function PriestLayout({ children }: { children: ReactNode }) {
  return <PriestProvider>{children}</PriestProvider>;
}
