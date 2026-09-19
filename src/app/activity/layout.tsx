'use client';

// Activity log module gate (سجل النشاط) — every /activity/* page renders
// only when the `activity` module is granted to the caller's scope (owner
// always passes). Pages render their own <AppShell>; the gate supplies one
// for the loading / blocked states.

import { type ReactNode } from 'react';
import { ModuleGate } from '@/components/ModuleGate';

export default function ActivityModuleLayout({ children }: { children: ReactNode }) {
  return <ModuleGate module="activity" shell>{children}</ModuleGate>;
}
