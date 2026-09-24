'use client';

// Access module gate (التحكم في الدخول) — every /access/* page renders only
// when the `access` module is granted to the caller's scope (owner always passes).

import { type ReactNode } from 'react';
import { ModuleGate } from '@/components/ModuleGate';

export default function AccessModuleLayout({ children }: { children: ReactNode }) {
  return (
    <ModuleGate module="access" shell>
      {children}
    </ModuleGate>
  );
}
