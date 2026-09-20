'use client';

// Reports & tables module gate (تقارير وجداول) — every /reports/* page
// renders only when the `reports` module is granted to the caller's scope
// (owner always passes).

import { type ReactNode } from 'react';
import { ModuleGate } from '@/components/ModuleGate';

export default function ReportsModuleLayout({ children }: { children: ReactNode }) {
  return <ModuleGate module="reports" shell>{children}</ModuleGate>;
}
