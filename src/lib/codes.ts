// ---------- Person code (national id / QR) helpers ----------
// The OWNER designs how codes look from تخصيص التطبيق → نظام الأكواد
// (`src/lib/code-templates.ts`). Components should use `useCodeGenerator()`
// (customization-context) so the owner's template + scope abbreviations are
// applied. This file keeps the built-in (legacy) generator for callers that
// have no access to the context.

import { legacyCode } from '@/lib/code-templates';

/** Built-in random readable person code, e.g. P-4F7K9Q2M */
export const generatePersonCode = () => legacyCode('person');
