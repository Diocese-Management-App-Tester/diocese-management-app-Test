'use client';

// Library module gate (المكتبة) — every /library/* page renders only when
// the `library` module is granted to the caller's scope (owner always
// passes). Pages render their own <AppShell>; the gate supplies one for the
// loading / blocked states. The provider loads the whole library ONCE.

import { type ReactNode } from 'react';
import { ModuleGate } from '@/components/ModuleGate';
import { LibraryProvider } from '@/lib/library-context';

export default function LibraryModuleLayout({ children }: { children: ReactNode }) {
  return (
    <ModuleGate module="library" shell>
      <LibraryProvider>{children}</LibraryProvider>
    </ModuleGate>
  );
}
