'use client';

// Exam Results module gate (نتائج الامتحانات) — every /results/* page renders
// only when the `results` module is granted to the caller's scope (owner
// always passes). Pages render their own <AppShell>.

import { type ReactNode } from 'react';
import { ModuleGate } from '@/components/ModuleGate';

export default function ResultsModuleLayout({ children }: { children: ReactNode }) {
  return (
    <ModuleGate module="results" shell>
      {children}
    </ModuleGate>
  );
}
