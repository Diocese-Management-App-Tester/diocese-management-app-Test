'use client';

// Family module gate (العائلات) — every /family/* page renders only when the
// `family` module is granted to the caller's scope (owner always passes).

import { type ReactNode } from 'react';
import { ModuleGate } from '@/components/ModuleGate';

export default function FamilyModuleLayout({ children }: { children: ReactNode }) {
  return (
    <ModuleGate module="family" shell>
      {children}
    </ModuleGate>
  );
}
