'use client';

// Finance module gate (الخزينة) — every /finance/* page renders only when
// the `finance` module is granted to the caller's scope (owner always passes).

import { type ReactNode } from 'react';
import { ModuleGate } from '@/components/ModuleGate';

export default function FinanceModuleLayout({ children }: { children: ReactNode }) {
  return (
    <ModuleGate module="finance" shell>
      {children}
    </ModuleGate>
  );
}
